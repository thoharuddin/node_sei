'use strict';

const { prisma } = require('../../../database/prisma');

const detail = {
  staff: true,
  approvedBy: true,
  rejectedBy: true,
  adjustment: { include: { createdBy: true } },
  assignment: { include: { program: true, createdBy: true } },
};

const itemInclude = { product: true, location: true, editedBy: true };

function buildWhere({ status, assignmentId, staffId, programId, ids }) {
  const where = {};
  if (status) where.status = status;
  if (assignmentId) where.auditAssignmentId = assignmentId;
  if (staffId) where.staffId = staffId;
  if (programId) where.assignment = { auditProgramId: programId };
  if (ids) where.id = { in: ids };
  return where;
}

async function list({ filters, pagination }) {
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.auditSession.findMany({
      where,
      include: detail,
      orderBy: { id: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.auditSession.count({ where }),
  ]);
  return { rows, total };
}

const findById = (id, client = prisma) =>
  client.auditSession.findUnique({ where: { id }, include: detail });

const findWithItems = (id, client = prisma) =>
  client.auditSession.findUnique({
    where: { id },
    include: { ...detail, items: { include: itemInclude, orderBy: [{ locationId: 'asc' }, { productId: 'asc' }] } },
  });

/**
 * Locks the session row for the duration of the transaction. Every state change
 * (save, submit, approve, reject) goes through this so two requests can never interleave
 * (§25, §21 step 1).
 */
async function lockById(tx, id) {
  const rows = await tx.$queryRaw`SELECT id FROM audit_session WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) return null;
  return findById(id, tx);
}

const create = (data, client = prisma) => client.auditSession.create({ data });
const update = (id, data, client = prisma) =>
  client.auditSession.update({ where: { id }, data, include: detail });

const createItems = (rows, client = prisma) => client.auditSessionItem.createMany({ data: rows });

const listItems = (sessionId, client = prisma) =>
  client.auditSessionItem.findMany({
    where: { auditSessionId: sessionId },
    include: itemInclude,
    orderBy: [{ locationId: 'asc' }, { productId: 'asc' }],
  });

const findItem = (id, client = prisma) =>
  client.auditSessionItem.findUnique({ where: { id }, include: itemInclude });

const updateItem = (id, data, client = prisma) =>
  client.auditSessionItem.update({ where: { id }, data, include: itemInclude });

const addItem = (data, client = prisma) =>
  client.auditSessionItem.create({ data, include: itemInclude });

const logChanges = (rows, client = prisma) =>
  rows.length ? client.auditSessionItemLog.createMany({ data: rows }) : Promise.resolve();

const listItemLogs = (itemId) =>
  prisma.auditSessionItemLog.findMany({
    where: { auditSessionItemId: itemId },
    include: { changedBy: true },
    orderBy: { changedAt: 'desc' },
  });

const itemStats = async (sessionId, client = prisma) => {
  const rows = await client.$queryRaw`
    SELECT count(*)::int                                      AS items,
           count(*) FILTER (WHERE difference <> 0)::int        AS differences,
           coalesce(sum(system_quantity), 0)                   AS system_total,
           coalesce(sum(counted_quantity), 0)                  AS counted_total,
           coalesce(sum(difference), 0)                        AS difference_total
      FROM audit_session_item
     WHERE audit_session_id = ${sessionId}
  `;
  const r = rows[0];
  return {
    items: r.items,
    differences: r.differences,
    systemTotal: Number(r.system_total),
    countedTotal: Number(r.counted_total),
    differenceTotal: Number(r.difference_total),
  };
};

module.exports = {
  list,
  findById,
  findWithItems,
  lockById,
  create,
  update,
  createItems,
  listItems,
  findItem,
  updateItem,
  addItem,
  logChanges,
  listItemLogs,
  itemStats,
};
