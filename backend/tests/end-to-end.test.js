'use strict';

const { api, prisma, resetDatabase, seedWorld, login, auth, balanceOf, ledgerDrift } = require('./helpers/fixtures');

/**
 * The §29 scenario, walked end to end through the public API only.
 */
describe('end-to-end stock opname scenario (§29)', () => {
  let world;
  let manager;
  let budi;
  let andi;

  beforeAll(async () => {
    await resetDatabase();
    world = await seedWorld();
    [manager, budi, andi] = await Promise.all([login('manager'), login('budi'), login('andi')]);
  });

  test('initial stock is 100 / 50 / 20 in Rack A', async () => {
    const res = await api().get(`/api/stock?locationId=${world.locations['RACK-A'].id}`).set(auth(manager));
    expect(res.body.data.map((b) => [b.product.sku, b.quantity])).toEqual([
      ['SKU001', 100],
      ['SKU002', 50],
      ['SKU003', 20],
    ]);
  });

  let programId;
  let assignmentId;
  let budiSessionId;
  let andiSessionId;

  test('the manager creates the program and a Rack A assignment for Budi and Andi', async () => {
    const program = await api()
      .post('/api/audit-programs')
      .set(auth(manager))
      .send({
        name: 'September Stock Opname',
        description: 'Monthly warehouse physical inventory audit',
        auditDateFrom: '2026-09-01',
        auditDateTo: '2026-09-03',
      });
    programId = program.body.data.id;

    const assignment = await api()
      .post(`/api/audit-programs/${programId}/assignments`)
      .set(auth(manager))
      .send({
        assignedUserIds: [world.users.budi.id, world.users.andi.id],
        assignmentType: 'location',
        locationIds: [world.locations['RACK-A'].id],
      });
    assignmentId = assignment.body.data.id;
    expect(assignment.body.data.status).toBe('pending');
  });

  test('Budi starts the audit and the items are generated for him', async () => {
    const mine = await api().get('/api/audit-assignments/my').set(auth(budi));
    expect(mine.body.data[0].id).toBe(assignmentId);

    const session = await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi));
    budiSessionId = session.body.data.id;
    expect(session.body.data.items.map((i) => [i.product.sku, i.systemQuantity, i.countedQuantity])).toEqual([
      ['SKU001', 100, 100],
      ['SKU002', 50, 50],
      ['SKU003', 20, 20],
    ]);
  });

  test('Budi counts 98 / 50 / 25 and submits', async () => {
    const items = (await api().get(`/api/audit-sessions/${budiSessionId}/items`).set(auth(budi))).body.data;
    const patch = items.map((i) => ({
      id: i.id,
      countedQuantity: { SKU001: 98, SKU002: 50, SKU003: 25 }[i.product.sku],
    }));

    const saved = await api().put(`/api/audit-sessions/${budiSessionId}/items`).set(auth(budi)).send({ items: patch });
    expect(saved.body.data.items.map((i) => i.difference)).toEqual([-2, 0, 5]);

    const submitted = await api().post(`/api/audit-sessions/${budiSessionId}/submit`).set(auth(budi));
    expect(submitted.body.data.status).toBe('submitted');
  });

  test('Andi counts 100 / 49 / 24 in his own session and submits', async () => {
    const session = await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(andi));
    andiSessionId = session.body.data.id;

    const items = (await api().get(`/api/audit-sessions/${andiSessionId}/items`).set(auth(andi))).body.data;
    await api()
      .put(`/api/audit-sessions/${andiSessionId}/items`)
      .set(auth(andi))
      .send({
        items: items.map((i) => ({ id: i.id, countedQuantity: { SKU001: 100, SKU002: 49, SKU003: 24 }[i.product.sku] })),
      });
    await api().post(`/api/audit-sessions/${andiSessionId}/submit`).set(auth(andi));
  });

  test('the manager compares both sessions', async () => {
    const res = await api().get(`/api/audit-assignments/${assignmentId}/comparison`).set(auth(manager));
    const table = res.body.data.rows.map((r) => [
      r.product.sku,
      r.location.code,
      r.systemQuantity,
      r.counts[budiSessionId].countedQuantity,
      r.counts[andiSessionId].countedQuantity,
    ]);
    expect(table).toEqual([
      ['SKU001', 'RACK-A', 100, 98, 100],
      ['SKU002', 'RACK-A', 50, 50, 49],
      ['SKU003', 'RACK-A', 20, 25, 24],
    ]);
  });

  test('the manager approves Budi\'s session: two movements, Andi auto-rejected', async () => {
    const res = await api().post(`/api/audit-sessions/${budiSessionId}/approve`).set(auth(manager)).send({ notes: "Budi's count is the reasonable one" });

    expect(res.body.data.session.status).toBe('approved');
    expect(res.body.data.movementsPosted).toBe(2);
    expect(res.body.data.autoRejectedSessions).toEqual([andiSessionId]);

    const movements = (await api().get('/api/stock/movements?movementType=audit_adjustment').set(auth(manager))).body.data;
    expect(movements.map((m) => [m.product.sku, m.location.code, m.quantity]).sort()).toEqual([
      ['SKU001', 'RACK-A', -2],
      ['SKU003', 'RACK-A', 5],
    ]);
  });

  test('final balances are 98 / 50 / 25 and the ledger agrees', async () => {
    expect(await balanceOf(world.products.SKU001.id, world.locations['RACK-A'].id)).toBe(98);
    expect(await balanceOf(world.products.SKU002.id, world.locations['RACK-A'].id)).toBe(50);
    expect(await balanceOf(world.products.SKU003.id, world.locations['RACK-A'].id)).toBe(25);
    expect(await ledgerDrift()).toHaveLength(0);

    // SKU002 had no difference, so it has no audit movement at all
    const sku002 = await prisma.stockQuant.count({
      where: { productId: world.products.SKU002.id, movementType: 'audit_adjustment' },
    });
    expect(sku002).toBe(0);
  });

  test('the program can then be completed and reports its final counters', async () => {
    const res = await api().put(`/api/audit-programs/${programId}`).set(auth(manager)).send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.stats).toMatchObject({ assignments: 1, sessions: 2, approved: 1, rejected: 1, pendingReview: 0 });

    // and no new assignment can be added to a completed program
    const late = await api()
      .post(`/api/audit-programs/${programId}/assignments`)
      .set(auth(manager))
      .send({ assignedUserIds: [world.users.budi.id], assignmentType: 'location', locationIds: [world.locations['RACK-B'].id] });
    expect(late.status).toBe(409);
  });
});
