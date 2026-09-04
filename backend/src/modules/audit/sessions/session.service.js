'use strict';

const { prisma, Prisma, withTransaction } = require('../../../database/prisma');
const repository = require('./session.repository');
const assignmentRepository = require('../assignments/assignment.repository');
const stockRepository = require('../../stock/stock.repository');
const scopeService = require('../../../services/audit-scope.service');
const { notFound, conflict, forbidden, badRequest, unprocessable } = require('../../../utils/errors');
const { parsePagination, meta } = require('../../../utils/pagination');
const serialize = require('../../../utils/serialize');

const OPEN_STATUSES = ['draft', 'submitted'];

/* ------------------------------------------------------------------ reading */

async function list(query, actor) {
  const pagination = parsePagination(query);
  const filters = { ...query };
  // Staff may only ever see their own sessions (§2, §31).
  if (actor.role === 'staff') filters.staffId = actor.id;

  const { rows, total } = await repository.list({ filters, pagination });
  const stats = await Promise.all(rows.map((row) => repository.itemStats(row.id)));
  const data = rows.map((row, index) => serialize.auditSession({ ...row, stats: stats[index] }));
  return { data, meta: meta(total, pagination) };
}

async function assertReadable(id, actor) {
  const session = await repository.findWithItems(id);
  if (!session) throw notFound(`Audit session ${id} not found`);
  if (actor.role === 'staff' && session.staffId !== actor.id) {
    throw forbidden('This audit session belongs to another staff member');
  }
  return session;
}

async function getById(id, actor) {
  const session = await assertReadable(id, actor);
  const stats = await repository.itemStats(id);
  return serialize.auditSession({ ...session, stats });
}

async function listItems(id, actor) {
  await assertReadable(id, actor);
  const items = await repository.listItems(id);
  return items.map(serialize.auditSessionItem);
}

/* ----------------------------------------------------------- starting audit */

/**
 * §15: start an audit session from an assignment.
 * One transaction: authorize -> create session -> resolve scope -> snapshot the current
 * stock as system_quantity -> generate items with counted_quantity = system_quantity.
 */
async function start(assignmentId, actor) {
  const id = Number(assignmentId);

  const session = await withTransaction(prisma, async (tx) => {
    const assignment = await assignmentRepository.findByIdForUpdate(id, tx);
    if (!assignment) throw notFound(`Audit assignment ${id} not found`);

    // 1. authorization: staff must be assigned to this assignment (§34.4)
    if (!assignment.assignedUserIds.includes(actor.id)) {
      throw forbidden('This assignment is not assigned to you');
    }
    if (assignment.status === 'cancelled') throw conflict('This assignment has been cancelled');
    if (['completed', 'cancelled'].includes(assignment.program.status)) {
      throw conflict(`The audit program is ${assignment.program.status}`);
    }

    const [approved, existingDraft] = await Promise.all([
      tx.auditSession.count({ where: { auditAssignmentId: id, status: 'approved' } }),
      tx.auditSession.findFirst({ where: { auditAssignmentId: id, staffId: actor.id, status: 'draft' } }),
    ]);
    if (approved > 0) throw conflict('A session of this assignment has already been approved');
    if (existingDraft) {
      throw conflict('You already have an open audit session for this assignment', {
        auditSessionId: existingDraft.id,
      });
    }

    // 2. create the session
    const created = await repository.create(
      { auditAssignmentId: id, staffId: actor.id, status: 'draft', startedAt: new Date() },
      tx,
    );

    // 3./4. determine the covered product/location pairs and read their current stock
    const { pairs } = await scopeService.resolveScope(assignment, tx);
    if (pairs.length === 0) {
      throw unprocessable(
        'This assignment covers no product/location with stock records; nothing to count',
      );
    }
    const balances = await stockRepository.balancesFor(pairs, tx);

    // 5./6./7. snapshot: system_quantity is frozen here and counted starts equal to it (§16)
    await repository.createItems(
      pairs.map((pair) => {
        const quantity = balances.get(`${pair.productId}:${pair.locationId}`) || new Prisma.Decimal(0);
        return {
          auditSessionId: created.id,
          productId: pair.productId,
          locationId: pair.locationId,
          systemQuantity: quantity,
          countedQuantity: quantity,
        };
      }),
      tx,
    );

    await assignmentRepository.recomputeStatus(id, tx);
    return repository.findWithItems(created.id, tx);
  });

  const stats = await repository.itemStats(session.id);
  return serialize.auditSession({ ...session, stats });
}

/* ------------------------------------------------------------ counting flow */

/**
 * Who may write to a session's items:
 *   staff   -> only their own session, only while it is draft (§18)
 *   manager -> any session before approval (§20/§34.10)
 */
const article = (status) => (/^[aeiou]/i.test(status) ? 'An' : 'A');

function assertItemsWritable(session, actor) {
  if (actor.role === 'staff') {
    if (session.staffId !== actor.id) throw forbidden('This audit session belongs to another staff member');
    if (session.status !== 'draft') {
      throw conflict(`${article(session.status)} ${session.status} session can no longer be edited by staff`);
    }
    return;
  }
  if (!OPEN_STATUSES.includes(session.status)) {
    throw conflict(`${article(session.status)} ${session.status} session can no longer be edited`);
  }
}

function changeLogRows({ item, patch, actor, reason }) {
  const rows = [];
  if (patch.countedQuantity !== undefined && !item.countedQuantity.equals(patch.countedQuantity)) {
    rows.push({
      auditSessionItemId: item.id,
      field: 'counted_quantity',
      oldValue: item.countedQuantity.toString(),
      newValue: new Prisma.Decimal(patch.countedQuantity).toString(),
      reason: reason ?? null,
      changedById: actor.id,
    });
  }
  if (patch.note !== undefined && (item.note ?? null) !== (patch.note ?? null)) {
    rows.push({
      auditSessionItemId: item.id,
      field: 'note',
      oldValue: item.note ?? null,
      newValue: patch.note ?? null,
      reason: reason ?? null,
      changedById: actor.id,
    });
  }
  return rows;
}

/** Bulk save of counted quantities — the [Save] button of the counting screen (§32). */
async function saveItems(sessionId, payload, actor) {
  const id = Number(sessionId);

  const result = await withTransaction(prisma, async (tx) => {
    const session = await repository.lockById(tx, id);
    if (!session) throw notFound(`Audit session ${id} not found`);
    assertItemsWritable(session, actor);

    const existing = await tx.auditSessionItem.findMany({ where: { auditSessionId: id } });
    const byId = new Map(existing.map((item) => [item.id, item]));

    const logs = [];
    for (const patch of payload.items) {
      const item = byId.get(patch.id);
      if (!item) throw badRequest(`Audit item ${patch.id} does not belong to session ${id}`);

      logs.push(...changeLogRows({ item, patch, actor, reason: payload.reason }));

      const data = {};
      if (patch.countedQuantity !== undefined) {
        data.countedQuantity = new Prisma.Decimal(patch.countedQuantity);
        data.countedAt = new Date();
      }
      if (patch.note !== undefined) data.note = patch.note;
      if (actor.role === 'manager') {
        data.editedById = actor.id;
        data.editedAt = new Date();
      }
      if (Object.keys(data).length > 0) await tx.auditSessionItem.update({ where: { id: item.id }, data });
    }

    await repository.logChanges(logs, tx);

    if (payload.notes !== undefined) {
      await tx.auditSession.update({ where: { id }, data: { notes: payload.notes } });
    }

    return { session: await repository.findWithItems(id, tx), changes: logs.length };
  });

  const stats = await repository.itemStats(id);
  return { ...serialize.auditSession({ ...result.session, stats }), changesLogged: result.changes };
}

/** Single item update — PUT /audit-session-items/:id (§30). */
async function updateItem(itemId, payload, actor) {
  const id = Number(itemId);

  const updated = await withTransaction(prisma, async (tx) => {
    const item = await tx.auditSessionItem.findUnique({ where: { id } });
    if (!item) throw notFound(`Audit session item ${id} not found`);

    const session = await repository.lockById(tx, item.auditSessionId);
    assertItemsWritable(session, actor);

    const fresh = await tx.auditSessionItem.findUnique({ where: { id } });
    const logs = changeLogRows({ item: fresh, patch: payload, actor, reason: payload.reason });

    const data = {};
    if (payload.countedQuantity !== undefined) {
      data.countedQuantity = new Prisma.Decimal(payload.countedQuantity);
      data.countedAt = new Date();
    }
    if (payload.note !== undefined) data.note = payload.note;
    if (actor.role === 'manager') {
      data.editedById = actor.id;
      data.editedAt = new Date();
    }

    const row = Object.keys(data).length ? await repository.updateItem(id, data, tx) : await repository.findItem(id, tx);
    await repository.logChanges(logs, tx);
    return row;
  });

  return serialize.auditSessionItem(updated);
}

/** Adds a product/location the system did not know about, within the assignment scope. */
async function addItem(sessionId, payload, actor) {
  const id = Number(sessionId);

  const created = await withTransaction(prisma, async (tx) => {
    const session = await repository.lockById(tx, id);
    if (!session) throw notFound(`Audit session ${id} not found`);
    assertItemsWritable(session, actor);

    const assignment = await assignmentRepository.findById(session.auditAssignmentId, tx);
    const inScope = await scopeService.isInScope(assignment, payload, tx);
    if (!inScope) throw unprocessable('This product/location is outside the assignment scope');

    await stockRepository.assertActive(
      { productIds: [payload.productId], locationIds: [payload.locationId] },
      tx,
    );

    const balances = await stockRepository.balancesFor([payload], tx);
    const systemQuantity = balances.get(`${payload.productId}:${payload.locationId}`) || new Prisma.Decimal(0);

    return repository.addItem(
      {
        auditSessionId: id,
        productId: payload.productId,
        locationId: payload.locationId,
        systemQuantity,
        countedQuantity: new Prisma.Decimal(payload.countedQuantity ?? systemQuantity),
        note: payload.note ?? null,
        countedAt: payload.countedQuantity !== undefined ? new Date() : null,
      },
      tx,
    );
  });

  return serialize.auditSessionItem(created);
}

/** §18: staff submits; after this the session is read-only for staff. */
async function submit(sessionId, payload, actor) {
  const id = Number(sessionId);

  const session = await withTransaction(prisma, async (tx) => {
    const locked = await repository.lockById(tx, id);
    if (!locked) throw notFound(`Audit session ${id} not found`);
    if (locked.staffId !== actor.id) throw forbidden('Only the counting staff member can submit this session');
    if (locked.status !== 'draft') throw conflict(`Cannot submit a session with status ${locked.status}`);

    const itemCount = await tx.auditSessionItem.count({ where: { auditSessionId: id } });
    if (itemCount === 0) throw unprocessable('Cannot submit a session without audit items');

    const updated = await repository.update(
      id,
      {
        status: 'submitted',
        submittedAt: new Date(),
        ...(payload?.notes !== undefined ? { notes: payload.notes } : {}),
      },
      tx,
    );
    await assignmentRepository.recomputeStatus(updated.auditAssignmentId, tx);
    return repository.findWithItems(id, tx);
  });

  const stats = await repository.itemStats(id);
  return serialize.auditSession({ ...session, stats });
}

async function itemLogs(itemId, actor) {
  const item = await repository.findItem(Number(itemId));
  if (!item) throw notFound(`Audit session item ${itemId} not found`);
  if (actor.role === 'staff') {
    const session = await repository.findById(item.auditSessionId);
    if (session.staffId !== actor.id) throw forbidden('This audit session belongs to another staff member');
  }
  const logs = await repository.listItemLogs(Number(itemId));
  return logs.map(serialize.itemLog);
}

module.exports = {
  list,
  getById,
  listItems,
  start,
  saveItems,
  updateItem,
  addItem,
  submit,
  itemLogs,
  assertReadable,
};
