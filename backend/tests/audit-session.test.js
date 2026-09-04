'use strict';

const { api, prisma, resetDatabase, seedWorld, login, auth, createAssignment, countAndSubmit } = require('./helpers/fixtures');

let world;
let manager;
let budi;
let andi;

beforeEach(async () => {
  await resetDatabase();
  world = await seedWorld();
  [manager, budi, andi] = await Promise.all([login('manager'), login('budi'), login('andi')]);
});

const startFor = async (token, assignmentId) =>
  (await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(token))).body.data;

describe('starting an audit session (Phase 5, §15)', () => {
  test('a location assignment generates one item per product with stock in that rack (§11)', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id],
    });

    const session = await startFor(budi, assignmentId);
    expect(session.status).toBe('draft');
    expect(session.items.map((i) => [i.product.sku, i.location.code, i.systemQuantity, i.countedQuantity, i.difference])).toEqual([
      ['SKU001', 'RACK-A', 100, 100, 0],
      ['SKU002', 'RACK-A', 50, 50, 0],
      ['SKU003', 'RACK-A', 20, 20, 0],
    ]);
  });

  test('a location assignment on a parent location covers the whole subtree', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['WH-STOCK'].id],
      staffIds: [world.users.budi.id],
    });

    const session = await startFor(budi, assignmentId);
    expect(session.items.map((i) => `${i.product.sku}@${i.location.code}`).sort()).toEqual([
      'SKU001@RACK-A',
      'SKU001@RACK-B',
      'SKU002@RACK-A',
      'SKU003@RACK-A',
      'SKU004@RACK-B',
    ]);
  });

  test('a product assignment generates one item per location holding that product, never merged (§12)', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'product',
      targets: [world.products.SKU001.id],
      staffIds: [world.users.budi.id],
    });

    const session = await startFor(budi, assignmentId);
    expect(session.items.map((i) => [i.location.code, i.systemQuantity])).toEqual([
      ['RACK-A', 100],
      ['RACK-B', 40],
    ]);
    // and the sum is never collapsed into a single 140 row
    expect(session.items).toHaveLength(2);
  });

  test('counted_quantity starts equal to system_quantity and the difference is zero (§34.7)', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id],
    });
    const session = await startFor(budi, assignmentId);
    expect(session.items.every((i) => i.countedQuantity === i.systemQuantity && i.difference === 0)).toBe(true);
    expect(session.stats).toMatchObject({ items: 3, differences: 0 });
  });

  test('system_quantity is a snapshot: later movements do not change it (§16)', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id],
    });
    const session = await startFor(budi, assignmentId);

    await api()
      .post('/api/stock/movements')
      .set(auth(manager))
      .send({ movementType: 'receipt', lines: [{ productId: world.products.SKU001.id, locationId: world.locations['RACK-A'].id, quantity: 20 }] });

    const items = (await api().get(`/api/audit-sessions/${session.id}/items`).set(auth(budi))).body.data;
    const sku001 = items.find((i) => i.product.sku === 'SKU001');
    expect(sku001.systemQuantity).toBe(100);

    const live = await api().get(`/api/stock/${world.products.SKU001.id}/${world.locations['RACK-A'].id}`).set(auth(manager));
    expect(live.body.data.quantity).toBe(120);
  });

  test('the same staff member cannot open two sessions for one assignment', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id],
    });
    await startFor(budi, assignmentId);
    const second = await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi));
    expect(second.status).toBe(409);
    expect(await prisma.auditSession.count({ where: { auditAssignmentId: assignmentId } })).toBe(1);
  });

  test('two concurrent start requests still create only one session', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id],
    });

    const results = await Promise.all([
      api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi)),
      api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi)),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.auditSession.count({ where: { auditAssignmentId: assignmentId } })).toBe(1);
  });

  test('several staff members audit the same assignment in parallel (§14)', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id, world.users.andi.id],
    });
    const s1 = await startFor(budi, assignmentId);
    const s2 = await startFor(andi, assignmentId);

    expect(s1.id).not.toBe(s2.id);
    expect(s1.items).toHaveLength(3);
    expect(s2.items).toHaveLength(3);

    const assignment = await api().get(`/api/audit-assignments/${assignmentId}`).set(auth(manager));
    expect(assignment.body.data.stats).toMatchObject({ sessions: 2, draft: 2 });
    expect(assignment.body.data.status).toBe('in_progress');
  });

  test('an assignment covering nothing countable is refused with 422', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-C'].id],
      staffIds: [world.users.budi.id],
    });
    const res = await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi));
    expect(res.status).toBe(422);
    expect(await prisma.auditSession.count()).toBe(0);
  });
});

describe('counting, editing and submitting (Phase 5, §18)', () => {
  let assignmentId;
  let session;

  beforeEach(async () => {
    ({ assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id, world.users.andi.id],
    }));
    session = await startFor(budi, assignmentId);
  });

  test('staff edit counted quantities and the database computes the difference (§17)', async () => {
    const items = session.items;
    const res = await api()
      .put(`/api/audit-sessions/${session.id}/items`)
      .set(auth(budi))
      .send({
        items: [
          { id: items[0].id, countedQuantity: 98, note: '2 damaged' },
          { id: items[2].id, countedQuantity: 25 },
        ],
      });

    expect(res.status).toBe(200);
    const byId = new Map(res.body.data.items.map((i) => [i.id, i]));
    expect(byId.get(items[0].id)).toMatchObject({ systemQuantity: 100, countedQuantity: 98, difference: -2, note: '2 damaged' });
    expect(byId.get(items[2].id)).toMatchObject({ systemQuantity: 20, countedQuantity: 25, difference: 5 });
    expect(res.body.data.stats).toMatchObject({ items: 3, differences: 2 });

    // the stored generated column agrees
    const stored = await prisma.$queryRaw`SELECT difference FROM audit_session_item WHERE id = ${items[0].id}`;
    expect(Number(stored[0].difference)).toBe(-2);
  });

  test('a single item can be updated through /audit-session-items/:id', async () => {
    const res = await api()
      .put(`/api/audit-session-items/${session.items[1].id}`)
      .set(auth(budi))
      .send({ countedQuantity: 49, note: 'one broken' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ countedQuantity: 49, difference: -1, note: 'one broken' });
    expect(res.body.data.countedAt).not.toBeNull();
  });

  test('negative counted quantities are refused', async () => {
    const res = await api()
      .put(`/api/audit-session-items/${session.items[0].id}`)
      .set(auth(budi))
      .send({ countedQuantity: -5 });
    expect(res.status).toBe(400);
  });

  test('an item of another session cannot be smuggled into a bulk save', async () => {
    const other = await startFor(andi, assignmentId);
    const res = await api()
      .put(`/api/audit-sessions/${session.id}/items`)
      .set(auth(budi))
      .send({ items: [{ id: other.items[0].id, countedQuantity: 1 }] });
    expect(res.status).toBe(400);
  });

  test('staff can record stock found outside the system, but only inside the scope', async () => {
    const inScope = await api()
      .post(`/api/audit-sessions/${session.id}/items`)
      .set(auth(budi))
      .send({ productId: world.products.SKU005.id, locationId: world.locations['RACK-A'].id, countedQuantity: 7 });
    expect(inScope.status).toBe(201);
    expect(inScope.body.data).toMatchObject({ systemQuantity: 0, countedQuantity: 7, difference: 7 });

    const outOfScope = await api()
      .post(`/api/audit-sessions/${session.id}/items`)
      .set(auth(budi))
      .send({ productId: world.products.SKU005.id, locationId: world.locations['RACK-B'].id, countedQuantity: 1 });
    expect(outOfScope.status).toBe(422);

    const duplicate = await api()
      .post(`/api/audit-sessions/${session.id}/items`)
      .set(auth(budi))
      .send({ productId: world.products.SKU001.id, locationId: world.locations['RACK-A'].id });
    expect(duplicate.status).toBe(409);
  });

  test('submitting freezes the session for staff (§18)', async () => {
    const submitted = await api().post(`/api/audit-sessions/${session.id}/submit`).set(auth(budi));
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('submitted');
    expect(submitted.body.data.submittedAt).not.toBeNull();

    const edit = await api()
      .put(`/api/audit-sessions/${session.id}/items`)
      .set(auth(budi))
      .send({ items: [{ id: session.items[0].id, countedQuantity: 5 }] });
    expect(edit.status).toBe(409);

    const resubmit = await api().post(`/api/audit-sessions/${session.id}/submit`).set(auth(budi));
    expect(resubmit.status).toBe(409);
  });

  test('a manager may edit a submitted session and every change is traceable (§20)', async () => {
    await countAndSubmit({ token: budi, sessionId: session.id, counts: { SKU001: 98 } });

    const res = await api()
      .put(`/api/audit-session-items/${session.items[0].id}`)
      .set(auth(manager))
      .send({ countedQuantity: 99, reason: 'Recount together with staff' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ countedQuantity: 99, difference: -1 });
    expect(res.body.data.editedBy.username).toBe('manager');
    expect(res.body.data.editedAt).not.toBeNull();

    const logs = (await api().get(`/api/audit-session-items/${session.items[0].id}/logs`).set(auth(manager))).body.data;
    expect(logs[0]).toMatchObject({
      field: 'counted_quantity',
      oldValue: '98',
      newValue: '99',
      reason: 'Recount together with staff',
    });
    expect(logs[0].changedBy.username).toBe('manager');
    // the staff edit is in the trail as well
    expect(logs.some((l) => l.changedBy.username === 'budi' && l.newValue === '98')).toBe(true);
  });

  test('staff can list their own submitted and rejected sessions', async () => {
    await api().post(`/api/audit-sessions/${session.id}/submit`).set(auth(budi));
    await api().post(`/api/audit-sessions/${session.id}/reject`).set(auth(manager)).send({ reason: 'Recount needed' });

    const list = await api().get('/api/audit-sessions').set(auth(budi));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ status: 'rejected', rejectionReason: 'Recount needed' });
  });
});
