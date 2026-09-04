'use strict';

const { api, prisma, resetDatabase, seedWorld, login, auth } = require('./helpers/fixtures');

let world;
let manager;
let budi;

beforeEach(async () => {
  await resetDatabase();
  world = await seedWorld();
  [manager, budi] = await Promise.all([login('manager'), login('budi')]);
});

describe('products (Phase 3)', () => {
  test('list exposes quantity as the sum of stock_balance over every location (§5)', async () => {
    const res = await api().get('/api/products?limit=10').set(auth(manager));
    const sku001 = res.body.data.find((p) => p.sku === 'SKU001');
    // 100 in Rack A + 40 in Rack B
    expect(sku001.quantity).toBe(140);
    const sku005 = res.body.data.find((p) => p.sku === 'SKU005');
    expect(sku005.quantity).toBe(0);
  });

  test('detail returns the per-location breakdown, never a merged number', async () => {
    const res = await api().get(`/api/products/${world.products.SKU001.id}`).set(auth(manager));
    expect(res.body.data.quantity).toBe(140);
    expect(res.body.data.balances.map((b) => [b.location.code, b.quantity]).sort()).toEqual([
      ['RACK-A', 100],
      ['RACK-B', 40],
    ]);
  });

  test('enforces a unique SKU', async () => {
    const first = await api().post('/api/products').set(auth(manager)).send({ sku: 'NEW-1', name: 'New' });
    expect(first.status).toBe(201);
    const dup = await api().post('/api/products').set(auth(manager)).send({ sku: 'NEW-1', name: 'Other' });
    expect(dup.status).toBe(409);
  });

  test('refuses a physical delete when stock history exists and soft-deletes instead (§26)', async () => {
    const id = world.products.SKU001.id;
    const hard = await api().delete(`/api/products/${id}?hard=1`).set(auth(manager));
    expect(hard.status).toBe(409);
    expect(await prisma.product.count({ where: { id } })).toBe(1);

    const soft = await api().delete(`/api/products/${id}`).set(auth(manager));
    expect(soft.status).toBe(200);
    expect(soft.body.data.deleted).toBe('soft');
    expect((await prisma.product.findUnique({ where: { id } })).isActive).toBe(false);
    // history untouched
    expect(await prisma.stockQuant.count({ where: { productId: id } })).toBe(2);
  });

  test('allows a physical delete only for a product without any history', async () => {
    const created = await api().post('/api/products').set(auth(manager)).send({ sku: 'TEMP', name: 'Temp' });
    const res = await api().delete(`/api/products/${created.body.data.id}?hard=1`).set(auth(manager));
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe('hard');
    expect(await prisma.product.count({ where: { sku: 'TEMP' } })).toBe(0);
  });

  test('records create_uid / write_uid', async () => {
    const created = await api().post('/api/products').set(auth(manager)).send({ sku: 'AUD-1', name: 'Audited' });
    expect(created.body.data.createUid).toBe(world.users.manager.id);

    const other = await prisma.user.create({
      data: { username: 'manager2', passwordHash: 'x', name: 'M2', email: 'm2@example.com', role: 'manager' },
    });
    await prisma.product.update({ where: { id: created.body.data.id }, data: { writeUid: other.id } });
    const fetched = await api().get(`/api/products/${created.body.data.id}`).set(auth(manager));
    expect(fetched.body.data.writeUid).toBe(other.id);
  });
});

describe('locations (Phase 3)', () => {
  test('returns the hierarchy as a tree (§6)', async () => {
    const res = await api().get('/api/locations?tree=1').set(auth(budi));
    expect(res.body.data).toHaveLength(1);
    const wh = res.body.data[0];
    expect(wh.code).toBe('WH');
    expect(wh.children[0].code).toBe('WH-STOCK');
    expect(wh.children[0].children.map((c) => c.code).sort()).toEqual(['RACK-A', 'RACK-B', 'RACK-C']);
  });

  test('enforces a unique code and rejects an unknown parent', async () => {
    expect((await api().post('/api/locations').set(auth(manager)).send({ code: 'RACK-A', name: 'dup' })).status).toBe(409);
    expect((await api().post('/api/locations').set(auth(manager)).send({ code: 'RACK-D', name: 'd', parentId: 9999 })).status).toBe(400);
  });

  test('refuses hierarchy cycles', async () => {
    const res = await api()
      .put(`/api/locations/${world.locations.WH.id}`)
      .set(auth(manager))
      .send({ parentId: world.locations['RACK-A'].id });
    expect(res.status).toBe(409);
  });

  test('a location with stock history cannot be physically deleted', async () => {
    const res = await api().delete(`/api/locations/${world.locations['RACK-A'].id}?hard=1`).set(auth(manager));
    expect(res.status).toBe(409);
    const soft = await api().delete(`/api/locations/${world.locations['RACK-A'].id}`).set(auth(manager));
    expect(soft.body.data.deleted).toBe('soft');
  });
});

describe('users (Phase 3)', () => {
  test('creates a user with a hashed password and unique username', async () => {
    const res = await api()
      .post('/api/users')
      .set(auth(manager))
      .send({ username: 'newstaff', password: 'password123', name: 'New Staff', email: 'new@example.com', role: 'staff' });
    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('passwordHash');

    const stored = await prisma.user.findUnique({ where: { username: 'newstaff' } });
    expect(stored.passwordHash).not.toBe('password123');

    const dup = await api()
      .post('/api/users')
      .set(auth(manager))
      .send({ username: 'newstaff', password: 'password123', name: 'X', email: 'x@example.com', role: 'staff' });
    expect(dup.status).toBe(409);

    // the new password actually works
    expect((await api().post('/api/auth/login').send({ username: 'newstaff', password: 'password123' })).status).toBe(200);
  });

  test('a manager cannot deactivate themselves or change their own role', async () => {
    expect((await api().delete(`/api/users/${world.users.manager.id}`).set(auth(manager))).status).toBe(400);
    const res = await api().put(`/api/users/${world.users.manager.id}`).set(auth(manager)).send({ role: 'staff' });
    expect(res.status).toBe(400);
  });

  test('deactivation is a soft delete and keeps the user row', async () => {
    const res = await api().delete(`/api/users/${world.users.candra.id}`).set(auth(manager));
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe('soft');
    expect((await prisma.user.findUnique({ where: { id: world.users.candra.id } })).isActive).toBe(false);
  });

  test('a staff member with an open session cannot be deactivated', async () => {
    const program = await prisma.auditProgram.create({
      data: {
        name: 'P',
        auditDateFrom: new Date('2026-09-01'),
        auditDateTo: new Date('2026-09-02'),
        createdById: world.users.manager.id,
      },
    });
    const assignment = await prisma.auditAssignment.create({
      data: {
        auditProgramId: program.id,
        assignedUserIds: [world.users.budi.id],
        assignmentType: 'location',
        locationIds: [world.locations['RACK-A'].id],
        createdById: world.users.manager.id,
      },
    });
    await api().post(`/api/audit-assignments/${assignment.id}/start`).set(auth(budi));

    const res = await api().delete(`/api/users/${world.users.budi.id}`).set(auth(manager));
    expect(res.status).toBe(409);
  });
});
