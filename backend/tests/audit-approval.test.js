'use strict';

const { api, prisma, resetDatabase, seedWorld, login, auth, balanceOf, ledgerDrift, createAssignment, countAndSubmit } = require('./helpers/fixtures');

let world;
let manager;
let budi;
let andi;

beforeEach(async () => {
  await resetDatabase();
  world = await seedWorld();
  [manager, budi, andi] = await Promise.all([login('manager'), login('budi'), login('andi')]);
});

const start = async (token, assignmentId) =>
  (await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(token))).body.data;

/** Rack A assignment shared by budi and andi, both counted and submitted. */
async function twoSubmittedSessions() {
  const { assignmentId } = await createAssignment({
    managerToken: manager,
    type: 'location',
    targets: [world.locations['RACK-A'].id],
    staffIds: [world.users.budi.id, world.users.andi.id],
  });
  const budiSession = await start(budi, assignmentId);
  const andiSession = await start(andi, assignmentId);

  // Budi: 98 / 50 / 25   Andi: 100 / 49 / 24  (§14 example)
  await countAndSubmit({ token: budi, sessionId: budiSession.id, counts: { SKU001: 98, SKU003: 25 } });
  await countAndSubmit({ token: andi, sessionId: andiSession.id, counts: { SKU002: 49, SKU003: 24 } });

  return { assignmentId, budiSession, andiSession };
}

describe('session comparison (Phase 6, §14)', () => {
  test('lays every session side by side per product/location and flags disagreements', async () => {
    const { assignmentId, budiSession, andiSession } = await twoSubmittedSessions();

    const res = await api().get(`/api/audit-assignments/${assignmentId}/comparison`).set(auth(manager));
    expect(res.status).toBe(200);
    const { rows, sessions, summary } = res.body.data;

    expect(sessions.map((s) => s.staff.username)).toEqual(['budi', 'andi']);
    const sku001 = rows.find((r) => r.product.sku === 'SKU001');
    expect(sku001.systemQuantity).toBe(100);
    expect(sku001.counts[budiSession.id].countedQuantity).toBe(98);
    expect(sku001.counts[andiSession.id].countedQuantity).toBe(100);
    expect(sku001.agree).toBe(false);

    const sku002 = rows.find((r) => r.product.sku === 'SKU002');
    expect([sku002.counts[budiSession.id].countedQuantity, sku002.counts[andiSession.id].countedQuantity]).toEqual([50, 49]);

    expect(summary).toMatchObject({ rows: 3, sessionsCompared: 2, disagreements: 3 });
  });
});

describe('approving a session (Phase 6, §21)', () => {
  test('creates one adjustment, posts only non-zero differences and updates the balances', async () => {
    const { budiSession } = await twoSubmittedSessions();
    const productA = world.products.SKU001.id;
    const productB = world.products.SKU002.id;
    const productC = world.products.SKU003.id;
    const rackA = world.locations['RACK-A'].id;

    const res = await api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager)).send({ notes: 'Budi count accepted' });

    expect(res.status).toBe(200);
    expect(res.body.data.session).toMatchObject({ status: 'approved' });
    expect(res.body.data.session.approvedBy.username).toBe('manager');
    expect(res.body.data.session.approvedAt).not.toBeNull();
    expect(res.body.data.movementsPosted).toBe(2);

    // §23: SKU002 had difference 0 -> no movement at all
    const movements = await prisma.stockQuant.findMany({ where: { movementType: 'audit_adjustment' }, orderBy: { productId: 'asc' } });
    expect(movements.map((m) => [m.productId, Number(m.quantity)])).toEqual([
      [productA, -2],
      [productC, 5],
    ]);
    expect(movements.every((m) => m.adjustmentId === res.body.data.adjustment.id)).toBe(true);
    expect(movements.every((m) => m.referenceType === 'audit_session' && m.referenceId === budiSession.id)).toBe(true);

    // §29 expected end state
    expect(await balanceOf(productA, rackA)).toBe(98);
    expect(await balanceOf(productB, rackA)).toBe(50);
    expect(await balanceOf(productC, rackA)).toBe(25);
    expect(await ledgerDrift()).toHaveLength(0);

    // exactly one adjustment for the session (§22)
    expect(await prisma.stockAdjustment.count()).toBe(1);
    const adjustment = await prisma.stockAdjustment.findUnique({ where: { auditSessionId: budiSession.id } });
    expect(adjustment.postingStatus).toBe('posted');
    expect(adjustment.notes).toBe('Budi count accepted');
  });

  test('auto-rejects the sibling sessions of the assignment (§21)', async () => {
    const { assignmentId, budiSession, andiSession } = await twoSubmittedSessions();

    const res = await api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager));
    expect(res.body.data.autoRejectedSessions).toEqual([andiSession.id]);

    const andiReloaded = await prisma.auditSession.findUnique({ where: { id: andiSession.id } });
    expect(andiReloaded.status).toBe('rejected');
    expect(andiReloaded.rejectedById).toBe(world.users.manager.id);
    expect(andiReloaded.rejectionReason).toMatch(/was approved/);

    const assignment = await prisma.auditAssignment.findUnique({ where: { id: assignmentId } });
    expect(assignment.status).toBe('done');
  });

  test('a second approval of the same session is idempotent (§34.12)', async () => {
    const { budiSession } = await twoSubmittedSessions();

    const first = await api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager));
    const second = await api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager));

    expect(first.body.data.idempotent).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.data.idempotent).toBe(true);
    expect(second.body.data.adjustment.id).toBe(first.body.data.adjustment.id);
    expect(second.body.data.movementsPosted).toBe(0);

    expect(await prisma.stockAdjustment.count()).toBe(1);
    expect(await prisma.stockQuant.count({ where: { movementType: 'audit_adjustment' } })).toBe(2);
    expect(await balanceOf(world.products.SKU001.id, world.locations['RACK-A'].id)).toBe(98);
  });

  test('two concurrent approvals of the same session post the movements exactly once', async () => {
    const { budiSession } = await twoSubmittedSessions();

    const results = await Promise.all([
      api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager)),
      api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager)),
    ]);

    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(await prisma.stockAdjustment.count()).toBe(1);
    expect(await prisma.stockQuant.count({ where: { movementType: 'audit_adjustment' } })).toBe(2);
    expect(await balanceOf(world.products.SKU001.id, world.locations['RACK-A'].id)).toBe(98);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('two concurrent approvals of DIFFERENT sessions of one assignment: only one wins (§34.11)', async () => {
    const { budiSession, andiSession } = await twoSubmittedSessions();

    const results = await Promise.all([
      api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager)),
      api().post(`/api/audit-sessions/${andiSession.id}/approve`).set(auth(manager)),
    ]);

    const approved = results.filter((r) => r.status === 200 && r.body.data?.session?.status === 'approved');
    expect(approved).toHaveLength(1);
    expect(await prisma.auditSession.count({ where: { status: 'approved' } })).toBe(1);
    expect(await prisma.stockAdjustment.count()).toBe(1);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('an approved session cannot be edited, rejected, reopened or re-approved', async () => {
    const { budiSession } = await twoSubmittedSessions();
    await api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager));

    const edit = await api().put(`/api/audit-session-items/${budiSession.items[0].id}`).set(auth(manager)).send({ countedQuantity: 1 });
    expect(edit.status).toBe(409);
    expect((await api().post(`/api/audit-sessions/${budiSession.id}/reject`).set(auth(manager)).send({ reason: 'nope' })).status).toBe(409);
    expect((await api().post(`/api/audit-sessions/${budiSession.id}/reopen`).set(auth(manager))).status).toBe(409);
  });

  test('a session that was never submitted cannot be approved (§34.8)', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id],
    });
    const session = await start(budi, assignmentId);

    const res = await api().post(`/api/audit-sessions/${session.id}/approve`).set(auth(manager));
    expect(res.status).toBe(409);
    expect(await prisma.stockAdjustment.count()).toBe(0);
    expect(await prisma.stockQuant.count({ where: { movementType: 'audit_adjustment' } })).toBe(0);
  });

  test('the whole approval rolls back when posting the movements fails (§21)', async () => {
    const { budiSession } = await twoSubmittedSessions();
    const rackA = world.locations['RACK-A'].id;
    const productA = world.products.SKU001.id;

    // Force a failure inside step 7 of the approval transaction.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_break_audit_posting() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected failure while posting audit adjustment';
      END; $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_break_audit_posting
        BEFORE INSERT ON stock_quant FOR EACH ROW
        WHEN (NEW.movement_type = 'audit_adjustment')
        EXECUTE FUNCTION test_break_audit_posting()
    `);

    try {
      const res = await api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager));
      expect(res.status).toBeGreaterThanOrEqual(400);

      // nothing at all survived: no adjustment, no movement, session still submitted
      expect(await prisma.stockAdjustment.count()).toBe(0);
      expect(await prisma.stockQuant.count({ where: { movementType: 'audit_adjustment' } })).toBe(0);
      expect((await prisma.auditSession.findUnique({ where: { id: budiSession.id } })).status).toBe('submitted');
      expect(await balanceOf(productA, rackA)).toBe(100);
      expect(await ledgerDrift()).toHaveLength(0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_break_audit_posting ON stock_quant');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_break_audit_posting()');
    }

    // and the approval succeeds once the failure is gone
    const retry = await api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager));
    expect(retry.status).toBe(200);
    expect(await balanceOf(productA, rackA)).toBe(98);
  });

  test('the approval applies the difference, not the counted value, when stock moved after the snapshot', async () => {
    const { budiSession } = await twoSubmittedSessions();
    const productA = world.products.SKU001.id;
    const rackA = world.locations['RACK-A'].id;

    // +10 arrives between snapshot (100) and approval; Budi counted 98 -> difference -2
    await api()
      .post('/api/stock/movements')
      .set(auth(manager))
      .send({ movementType: 'receipt', lines: [{ productId: productA, locationId: rackA, quantity: 10 }] });

    await api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager));

    expect(await balanceOf(productA, rackA)).toBe(108);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('the movement is fully traceable back to the staff member and program (§24)', async () => {
    const { budiSession } = await twoSubmittedSessions();
    const approved = await api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager));
    const adjustmentId = approved.body.data.adjustment.id;

    const movement = await prisma.stockQuant.findFirst({ where: { movementType: 'audit_adjustment' } });
    const res = await api().get(`/api/stock/movements/${movement.id}`).set(auth(manager));

    expect(res.body.data.trace).toMatchObject({
      reason: 'audit_adjustment',
      stockAdjustmentId: adjustmentId,
      auditSessionId: budiSession.id,
    });
    expect(res.body.data.trace.countedBy.username).toBe('budi');
    expect(res.body.data.trace.approvedBy.username).toBe('manager');
    expect(res.body.data.trace.auditProgram.name).toBe('Test Opname');

    const detail = await api().get(`/api/stock-adjustments/${adjustmentId}`).set(auth(manager));
    expect(detail.body.data.movements).toHaveLength(2);
    expect(detail.body.data.session.staff.username).toBe('budi');
    expect(detail.body.data.session.assignment.program.name).toBe('Test Opname');
  });
});

describe('rejecting and reopening (Phase 6)', () => {
  test('a rejection needs a reason and produces no stock movement', async () => {
    const { budiSession } = await twoSubmittedSessions();

    expect((await api().post(`/api/audit-sessions/${budiSession.id}/reject`).set(auth(manager)).send({})).status).toBe(400);

    const res = await api().post(`/api/audit-sessions/${budiSession.id}/reject`).set(auth(manager)).send({ reason: 'Counts look wrong, please recount' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'rejected', rejectionReason: 'Counts look wrong, please recount' });
    expect(res.body.data.rejectedBy.username).toBe('manager');
    expect(await prisma.stockQuant.count({ where: { movementType: 'audit_adjustment' } })).toBe(0);
    expect(await prisma.stockAdjustment.count()).toBe(0);
  });

  test('a manager can reopen a rejected session so the staff member can recount', async () => {
    const { budiSession } = await twoSubmittedSessions();
    await api().post(`/api/audit-sessions/${budiSession.id}/reject`).set(auth(manager)).send({ reason: 'recount' });

    const reopened = await api().post(`/api/audit-sessions/${budiSession.id}/reopen`).set(auth(manager));
    expect(reopened.status).toBe(200);
    expect(reopened.body.data).toMatchObject({ status: 'draft', submittedAt: null, rejectionReason: null });

    // and the staff member can edit again
    const edit = await api()
      .put(`/api/audit-sessions/${budiSession.id}/items`)
      .set(auth(budi))
      .send({ items: [{ id: budiSession.items[0].id, countedQuantity: 97 }] });
    expect(edit.status).toBe(200);
  });

  test('reopening is refused once another session of the assignment was approved', async () => {
    const { budiSession, andiSession } = await twoSubmittedSessions();
    await api().post(`/api/audit-sessions/${budiSession.id}/approve`).set(auth(manager));

    const res = await api().post(`/api/audit-sessions/${andiSession.id}/reopen`).set(auth(manager));
    expect(res.status).toBe(409);
  });
});
