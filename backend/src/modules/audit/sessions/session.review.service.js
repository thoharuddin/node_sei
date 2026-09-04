'use strict';

const config = require('../../../config');
const { prisma, withTransaction } = require('../../../database/prisma');
const repository = require('./session.repository');
const assignmentRepository = require('../assignments/assignment.repository');
const adjustmentService = require('../adjustments/adjustment.service');
const { notFound, conflict, unprocessable } = require('../../../utils/errors');
const serialize = require('../../../utils/serialize');

/* ------------------------------------------------------------- comparison */

/**
 * §14/§19: every session of one assignment side by side.
 *
 *   Product   Location   System   Budi   Andi   Candra
 *   SKU001    Rack A       100     98     100     98
 */
async function comparison(assignmentId, actor) {
  const id = Number(assignmentId);
  const assignment = await assignmentRepository.findById(id);
  if (!assignment) throw notFound(`Audit assignment ${id} not found`);

  const [decorated] = await require('../assignments/assignment.service').decorate([assignment]);

  const sessions = await prisma.auditSession.findMany({
    where: { auditAssignmentId: id, status: { not: 'cancelled' } },
    include: { staff: true, approvedBy: true, rejectedBy: true, adjustment: true },
    orderBy: { id: 'asc' },
  });
  if (sessions.length === 0) {
    return { assignment: decorated, sessions: [], rows: [], summary: { rows: 0, disagreements: 0 } };
  }

  const rows = await prisma.$queryRaw`
    SELECT i.audit_session_id,
           i.product_id,
           i.location_id,
           i.system_quantity,
           i.counted_quantity,
           i.difference,
           i.note,
           i.edited_by,
           p.sku,
           p.name  AS product_name,
           l.code  AS location_code,
           l.name  AS location_name
      FROM audit_session_item i
      JOIN audit_session s ON s.id = i.audit_session_id
      JOIN products p      ON p.id = i.product_id
      JOIN locations l     ON l.id = i.location_id
     WHERE s.audit_assignment_id = ${id}
       AND s.status <> 'cancelled'
     ORDER BY l.code, p.sku, i.audit_session_id
  `;

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.product_id}:${row.location_id}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        productId: Number(row.product_id),
        product: { id: Number(row.product_id), sku: row.sku, name: row.product_name },
        locationId: Number(row.location_id),
        location: { id: Number(row.location_id), code: row.location_code, name: row.location_name },
        systemQuantity: Number(row.system_quantity),
        systemQuantityVaries: false,
        counts: {},
      });
    }
    const entry = grouped.get(key);
    // Sessions started at different times may hold different snapshots — surface that.
    if (Number(row.system_quantity) !== entry.systemQuantity) entry.systemQuantityVaries = true;
    entry.counts[Number(row.audit_session_id)] = {
      countedQuantity: Number(row.counted_quantity),
      difference: Number(row.difference),
      systemQuantity: Number(row.system_quantity),
      note: row.note,
      editedById: row.edited_by ? Number(row.edited_by) : null,
    };
  }

  const sessionIds = sessions.map((s) => s.id);
  const result = [...grouped.values()].map((entry) => {
    const counted = sessionIds
      .map((sid) => entry.counts[sid]?.countedQuantity)
      .filter((v) => v !== undefined);
    const agree = counted.length > 0 && counted.every((v) => v === counted[0]);
    return { ...entry, agree, missingSessions: sessionIds.filter((sid) => !entry.counts[sid]) };
  });

  const stats = await Promise.all(sessions.map((s) => repository.itemStats(s.id)));

  return {
    assignment: decorated,
    sessions: sessions.map((s, i) => serialize.auditSession({ ...s, stats: stats[i] })),
    rows: result,
    summary: {
      rows: result.length,
      disagreements: result.filter((r) => !r.agree).length,
      sessionsCompared: sessions.length,
    },
  };
}

/* ---------------------------------------------------------------- approval */

/**
 * §21 — approving a session, entirely inside one PostgreSQL transaction:
 *
 *   1. lock the audit session                       7. create stock_quant for non-zero diffs
 *   2. verify status = submitted                    8. update stock_balance
 *   3. verify it was not already approved           9. mark session approved
 *   4. validate the audit items                    10. record approved_by / approved_at
 *   5. calculate each difference                   11. reject sibling sessions, close assignment
 *   6. create one stock_adjustment                 12. commit
 *
 * Safe against duplicate requests: the row lock serialises them, an already-approved session
 * returns the same result without a second adjustment, and UNIQUE(audit_session_id) on
 * stock_adjustment is the final guard.
 */
async function approve(sessionId, payload, actor) {
  const id = Number(sessionId);

  const outcome = await withTransaction(prisma, async (tx) => {
    // 1. lock
    const session = await repository.lockById(tx, id);
    if (!session) throw notFound(`Audit session ${id} not found`);

    // 3. idempotency: a repeated approval is not an error, it is a no-op
    if (session.status === 'approved') {
      const existing = await tx.stockAdjustment.findUnique({ where: { auditSessionId: id } });
      return { session, adjustment: existing, idempotent: true, posted: 0 };
    }

    // 2. only a submitted session can be approved (§34.8)
    if (session.status !== 'submitted') {
      throw conflict(`Cannot approve a session with status ${session.status}; it must be submitted`);
    }

    // one approved session per assignment (§34.11) — the partial unique index also enforces it
    const otherApproved = await tx.auditSession.count({
      where: { auditAssignmentId: session.auditAssignmentId, status: 'approved', id: { not: id } },
    });
    if (otherApproved > 0) {
      throw conflict('Another session of this assignment has already been approved');
    }

    // 4./5. validate items (differences come from the generated column)
    const itemCount = await tx.auditSessionItem.count({ where: { auditSessionId: id } });
    if (itemCount === 0) throw unprocessable('Cannot approve a session without audit items');

    // 6. exactly one stock_adjustment per session (§22)
    const adjustment = await tx.stockAdjustment.create({
      data: {
        auditSessionId: id,
        createdById: actor.id,
        notes: payload?.notes ?? null,
        postingStatus: 'pending',
      },
    });

    // 7./8. post the movements and move the balance cache in this same transaction
    const posting = await adjustmentService.postAdjustment(tx, adjustment.id);

    // 9./10. mark approved
    await repository.update(
      id,
      { status: 'approved', approvedAt: new Date(), approvedById: actor.id },
      tx,
    );

    // 11. the other sessions of this assignment are rejected automatically (§21)
    const siblings = await tx.auditSession.findMany({
      where: { auditAssignmentId: session.auditAssignmentId, id: { not: id }, status: { in: ['draft', 'submitted'] } },
      select: { id: true },
    });
    if (siblings.length > 0) {
      await tx.auditSession.updateMany({
        where: { id: { in: siblings.map((s) => s.id) } },
        data: {
          status: 'rejected',
          rejectedAt: new Date(),
          rejectedById: actor.id,
          rejectionReason: `Session ${id} was approved for this assignment`,
        },
      });
    }

    await assignmentRepository.recomputeStatus(session.auditAssignmentId, tx);

    return {
      session: await repository.findWithItems(id, tx),
      adjustment: await tx.stockAdjustment.findUnique({ where: { id: adjustment.id } }),
      autoRejected: siblings.map((s) => s.id),
      posted: posting.movements,
      idempotent: false,
    };
  });

  const stats = await repository.itemStats(id);
  return {
    session: serialize.auditSession({ ...outcome.session, stats }),
    adjustment: outcome.adjustment ? serialize.stockAdjustment(outcome.adjustment) : null,
    movementsPosted: outcome.posted,
    autoRejectedSessions: outcome.autoRejected || [],
    idempotent: outcome.idempotent,
    postingMode: config.stock.postingMode,
  };
}

/* --------------------------------------------------------------- rejection */

async function reject(sessionId, payload, actor) {
  const id = Number(sessionId);

  const session = await withTransaction(prisma, async (tx) => {
    const locked = await repository.lockById(tx, id);
    if (!locked) throw notFound(`Audit session ${id} not found`);
    if (locked.status === 'approved') throw conflict('An approved session cannot be rejected');
    if (locked.status === 'rejected') return repository.findWithItems(id, tx);
    if (!['draft', 'submitted'].includes(locked.status)) {
      throw conflict(`Cannot reject a session with status ${locked.status}`);
    }

    await repository.update(
      id,
      {
        status: 'rejected',
        rejectedAt: new Date(),
        rejectedById: actor.id,
        rejectionReason: payload.reason,
      },
      tx,
    );
    await assignmentRepository.recomputeStatus(locked.auditAssignmentId, tx);
    return repository.findWithItems(id, tx);
  });

  const stats = await repository.itemStats(id);
  return serialize.auditSession({ ...session, stats });
}

/** §18: the explicit "manager reopens a session" path, back to draft for the staff member. */
async function reopen(sessionId, actor) {
  const id = Number(sessionId);

  const session = await withTransaction(prisma, async (tx) => {
    const locked = await repository.lockById(tx, id);
    if (!locked) throw notFound(`Audit session ${id} not found`);
    if (locked.status === 'approved') throw conflict('An approved session is final and cannot be reopened');
    if (!['submitted', 'rejected'].includes(locked.status)) {
      throw conflict(`Cannot reopen a session with status ${locked.status}`);
    }

    const approved = await tx.auditSession.count({
      where: { auditAssignmentId: locked.auditAssignmentId, status: 'approved' },
    });
    if (approved > 0) throw conflict('This assignment already has an approved session');

    const openDraft = await tx.auditSession.findFirst({
      where: { auditAssignmentId: locked.auditAssignmentId, staffId: locked.staffId, status: 'draft' },
    });
    if (openDraft) throw conflict('This staff member already has an open session for the assignment');

    await repository.update(
      id,
      {
        status: 'draft',
        submittedAt: null,
        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,
      },
      tx,
    );
    await assignmentRepository.recomputeStatus(locked.auditAssignmentId, tx);
    return repository.findWithItems(id, tx);
  });

  const stats = await repository.itemStats(id);
  return serialize.auditSession({ ...session, stats });
}

module.exports = { comparison, approve, reject, reopen };
