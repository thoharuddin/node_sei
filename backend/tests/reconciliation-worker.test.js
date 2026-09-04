'use strict';

const { api, prisma, resetDatabase, seedWorld, login, auth, balanceOf, ledgerDrift, createAssignment, countAndSubmit } = require('./helpers/fixtures');
const { processAdjustmentJob } = require('../src/queue/stock-posting.worker');
const adjustmentService = require('../src/modules/audit/adjustments/adjustment.service');

let world;
let manager;
let budi;

beforeEach(async () => {
  await resetDatabase();
  world = await seedWorld();
  [manager, budi] = await Promise.all([login('manager'), login('budi')]);
});

/**
 * Phase 7. The suite runs in STOCK_POSTING_MODE=sync (see .env.test), so the worker's job
 * handler is exercised directly against an unposted adjustment — no Redis needed.
 */
async function approvedSessionWithUnpostedAdjustment() {
  const { assignmentId } = await createAssignment({
    managerToken: manager,
    type: 'location',
    targets: [world.locations['RACK-A'].id],
    staffIds: [world.users.budi.id],
  });
  const session = (await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi))).body.data;
  await countAndSubmit({ token: budi, sessionId: session.id, counts: { SKU001: 98, SKU003: 25 } });

  // Approve exactly as the async path does: session approved, adjustment left pending.
  const adjustment = await prisma.$transaction(async (tx) => {
    const created = await tx.stockAdjustment.create({
      data: { auditSessionId: session.id, createdById: world.users.manager.id, postingStatus: 'pending' },
    });
    await tx.auditSession.update({
      where: { id: session.id },
      data: { status: 'approved', approvedAt: new Date(), approvedById: world.users.manager.id },
    });
    return created;
  });

  return { session, adjustment };
}

describe('asynchronous reconciliation worker (Phase 7)', () => {
  test('the job posts the movements and marks the adjustment posted', async () => {
    const { session, adjustment } = await approvedSessionWithUnpostedAdjustment();
    expect(await prisma.stockQuant.count({ where: { movementType: 'audit_adjustment' } })).toBe(0);

    const result = await processAdjustmentJob({ data: { adjustmentId: adjustment.id } });

    expect(result).toMatchObject({ adjustmentId: adjustment.id, alreadyPosted: false, movements: 2 });
    expect(await balanceOf(world.products.SKU001.id, world.locations['RACK-A'].id)).toBe(98);
    expect(await balanceOf(world.products.SKU003.id, world.locations['RACK-A'].id)).toBe(25);
    expect(await ledgerDrift()).toHaveLength(0);

    const reloaded = await prisma.stockAdjustment.findUnique({ where: { id: adjustment.id } });
    expect(reloaded.postingStatus).toBe('posted');
    expect(reloaded.postedAt).not.toBeNull();

    const movements = await prisma.stockQuant.findMany({ where: { adjustmentId: adjustment.id } });
    expect(movements.every((m) => m.referenceType === 'audit_session' && m.referenceId === session.id)).toBe(true);
  });

  test('a redelivered job is a no-op: the movements are never posted twice', async () => {
    const { adjustment } = await approvedSessionWithUnpostedAdjustment();

    const first = await processAdjustmentJob({ data: { adjustmentId: adjustment.id } });
    const second = await processAdjustmentJob({ data: { adjustmentId: adjustment.id } });
    const third = await processAdjustmentJob({ data: { adjustmentId: adjustment.id } });

    expect(first.alreadyPosted).toBe(false);
    expect(second).toMatchObject({ alreadyPosted: true, movements: 0 });
    expect(third).toMatchObject({ alreadyPosted: true, movements: 0 });

    expect(await prisma.stockQuant.count({ where: { movementType: 'audit_adjustment' } })).toBe(2);
    expect(await balanceOf(world.products.SKU001.id, world.locations['RACK-A'].id)).toBe(98);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('two jobs running at the same time still post exactly once', async () => {
    const { adjustment } = await approvedSessionWithUnpostedAdjustment();

    const results = await Promise.all([
      processAdjustmentJob({ data: { adjustmentId: adjustment.id } }),
      processAdjustmentJob({ data: { adjustmentId: adjustment.id } }),
    ]);

    expect(results.filter((r) => !r.alreadyPosted)).toHaveLength(1);
    expect(await prisma.stockQuant.count({ where: { movementType: 'audit_adjustment' } })).toBe(2);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('a failing job marks the adjustment failed, leaves no partial posting and can be retried', async () => {
    const { adjustment } = await approvedSessionWithUnpostedAdjustment();

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_break_worker_posting() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'injected worker failure';
      END; $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_break_worker_posting
        BEFORE INSERT ON stock_quant FOR EACH ROW
        WHEN (NEW.movement_type = 'audit_adjustment')
        EXECUTE FUNCTION test_break_worker_posting()
    `);

    try {
      await expect(processAdjustmentJob({ data: { adjustmentId: adjustment.id } })).rejects.toThrow(/injected worker failure/);

      const failed = await prisma.stockAdjustment.findUnique({ where: { id: adjustment.id } });
      expect(failed.postingStatus).toBe('failed');
      expect(failed.postingError).toMatch(/injected worker failure/);
      expect(await prisma.stockQuant.count({ where: { movementType: 'audit_adjustment' } })).toBe(0);
      expect(await balanceOf(world.products.SKU001.id, world.locations['RACK-A'].id)).toBe(100);
      expect(await ledgerDrift()).toHaveLength(0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_break_worker_posting ON stock_quant');
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_break_worker_posting()');
    }

    // The retry (BullMQ attempt or manual endpoint) completes the posting.
    const retry = await api().post(`/api/stock-adjustments/${adjustment.id}/retry-posting`).set(auth(manager));
    expect(retry.status).toBe(200);
    expect((await prisma.stockAdjustment.findUnique({ where: { id: adjustment.id } })).postingStatus).toBe('posted');
    expect(await balanceOf(world.products.SKU001.id, world.locations['RACK-A'].id)).toBe(98);
    expect(await ledgerDrift()).toHaveLength(0);
  });

  test('postAdjustment refuses an unknown adjustment', async () => {
    await expect(
      prisma.$transaction(async (tx) => adjustmentService.postAdjustment(tx, 999_999)),
    ).rejects.toThrow(/not found/);
  });
});
