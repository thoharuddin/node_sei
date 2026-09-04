'use strict';

const { api, prisma, resetDatabase, seedWorld, login, auth, balanceOf, ledgerDrift } = require('./helpers/fixtures');
const stockRepository = require('../src/modules/stock/stock.repository');

let world;
let manager;
let budi;

beforeEach(async () => {
  await resetDatabase();
  world = await seedWorld();
  [manager, budi] = await Promise.all([login('manager'), login('budi')]);
});

describe('stock ledger and balance cache (Phase 4)', () => {
  test('a receipt appends to the ledger and moves the cache in the same transaction (§8)', async () => {
    const productId = world.products.SKU001.id;
    const locationId = world.locations['RACK-A'].id;

    const res = await api()
      .post('/api/stock/movements')
      .set(auth(manager))
      .send({ movementType: 'receipt', lines: [{ productId, locationId, quantity: 25 }] });

    expect(res.status).toBe(201);
    expect(await balanceOf(productId, locationId)).toBe(125);

    const ledger = await prisma.stockQuant.findMany({ where: { productId, locationId }, orderBy: { id: 'asc' } });
    expect(ledger.map((q) => [q.movementType, Number(q.quantity)])).toEqual([
      ['opening', 100],
      ['receipt', 25],
    ]);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('a delivery is stored as a negative movement (§7.1)', async () => {
    const productId = world.products.SKU001.id;
    const locationId = world.locations['RACK-A'].id;

    await api()
      .post('/api/stock/movements')
      .set(auth(manager))
      .send({ movementType: 'delivery', lines: [{ productId, locationId, quantity: 20 }] });

    const last = await prisma.stockQuant.findFirst({ where: { productId, locationId }, orderBy: { id: 'desc' } });
    expect(Number(last.quantity)).toBe(-20);
    expect(await balanceOf(productId, locationId)).toBe(80);
  });

  test('a transfer writes transfer_out and transfer_in as one atomic pair', async () => {
    const productId = world.products.SKU001.id;
    const from = world.locations['RACK-A'].id;
    const to = world.locations['RACK-C'].id;

    const res = await api()
      .post('/api/stock/transfers')
      .set(auth(manager))
      .send({ productId, fromLocationId: from, toLocationId: to, quantity: 30 });

    expect(res.status).toBe(201);
    expect(await balanceOf(productId, from)).toBe(70);
    expect(await balanceOf(productId, to)).toBe(30);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('refuses to drive a balance negative and rolls the whole request back', async () => {
    const productId = world.products.SKU001.id;
    const locationId = world.locations['RACK-A'].id;
    const before = await prisma.stockQuant.count();

    const res = await api()
      .post('/api/stock/movements')
      .set(auth(manager))
      .send({
        movementType: 'delivery',
        lines: [
          { productId, locationId, quantity: 10 },
          { productId, locationId, quantity: 10_000 },
        ],
      });

    expect(res.status).toBe(409);
    // neither line survived: ledger and cache are both untouched
    expect(await prisma.stockQuant.count()).toBe(before);
    expect(await balanceOf(productId, locationId)).toBe(100);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('a zero-quantity movement is rejected before it reaches the ledger (§23)', async () => {
    const res = await api()
      .post('/api/stock/movements')
      .set(auth(manager))
      .send({ movementType: 'receipt', lines: [{ productId: world.products.SKU001.id, locationId: world.locations['RACK-A'].id, quantity: 0 }] });
    expect(res.status).toBe(400);
  });

  test('the ledger is append-only: updates and deletes are refused by the database (§26)', async () => {
    const row = await prisma.stockQuant.findFirst();
    await expect(
      prisma.stockQuant.update({ where: { id: row.id }, data: { quantity: 1 } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.stockQuant.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  test('current stock never merges locations of the same product (§12)', async () => {
    const res = await api().get(`/api/stock?productId=${world.products.SKU001.id}`).set(auth(budi));
    expect(res.body.data.map((b) => [b.location.code, b.quantity]).sort()).toEqual([
      ['RACK-A', 100],
      ['RACK-B', 40],
    ]);
  });

  test('stock of a parent location can be expanded over its subtree', async () => {
    const res = await api()
      .get(`/api/stock?locationId=${world.locations['WH-STOCK'].id}&includeChildren=1`)
      .set(auth(manager));
    const codes = [...new Set(res.body.data.map((b) => b.location.code))].sort();
    expect(codes).toEqual(['RACK-A', 'RACK-B']);
  });

  test('movement history is filterable and paginated', async () => {
    const res = await api().get('/api/stock/movements?movementType=opening&limit=2').set(auth(budi));
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(5);
    expect(res.body.data.every((m) => m.movementType === 'opening')).toBe(true);
  });

  test('balance detail returns the recent movements of that product/location', async () => {
    const res = await api()
      .get(`/api/stock/${world.products.SKU001.id}/${world.locations['RACK-A'].id}`)
      .set(auth(budi));
    expect(res.body.data.quantity).toBe(100);
    expect(res.body.data.recentMovements).toHaveLength(1);
  });

  test('postMovements rolls back the cache when the ledger insert fails', async () => {
    const productId = world.products.SKU002.id;
    const locationId = world.locations['RACK-A'].id;

    await expect(
      prisma.$transaction(async (tx) =>
        stockRepository.postMovements(tx, {
          actorId: world.users.manager.id,
          movements: [
            { productId, locationId, quantity: 5, movementType: 'receipt' },
            // 99999 is not a product: the FK blows up after the first row was staged
            { productId: 99999, locationId, quantity: 5, movementType: 'receipt' },
          ],
        }),
      ),
    ).rejects.toBeDefined();

    expect(await balanceOf(productId, locationId)).toBe(50);
    expect(await prisma.stockQuant.count({ where: { productId, movementType: 'receipt' } })).toBe(0);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('concurrent postings on the same product/location stay consistent', async () => {
    const productId = world.products.SKU001.id;
    const locationId = world.locations['RACK-A'].id;

    await Promise.all(
      Array.from({ length: 10 }, () =>
        api()
          .post('/api/stock/movements')
          .set(auth(manager))
          .send({ movementType: 'receipt', lines: [{ productId, locationId, quantity: 3 }] }),
      ),
    );

    expect(await balanceOf(productId, locationId)).toBe(130);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('the consistency endpoint proves cache == ledger', async () => {
    const res = await api().get('/api/stock/consistency').set(auth(manager));
    expect(res.body.data).toMatchObject({ consistent: true, driftCount: 0 });
  });
});
