'use strict';

const { prisma } = require('../../../database/prisma');

const include = { createdBy: true, program: true };

function buildWhere({ status, assignmentType, programId, ids }) {
  const where = {};
  if (status) where.status = status;
  if (assignmentType) where.assignmentType = assignmentType;
  if (programId) where.auditProgramId = programId;
  if (ids) where.id = { in: ids };
  return where;
}

async function list({ filters, pagination }) {
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.auditAssignment.findMany({
      where,
      include,
      orderBy: { id: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.auditAssignment.count({ where }),
  ]);
  return { rows, total };
}

const findById = (id, client = prisma) =>
  client.auditAssignment.findUnique({ where: { id }, include });

/** Locks the assignment row so status recomputation cannot race (§25). */
const findByIdForUpdate = async (id, tx) => {
  const rows = await tx.$queryRaw`SELECT id FROM audit_assignment WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) return null;
  return findById(id, tx);
};

const create = (data) => prisma.auditAssignment.create({ data, include });
const update = (id, data, client = prisma) =>
  client.auditAssignment.update({ where: { id }, data, include });

/** Assignment ids a staff member is assigned to (array membership). */
async function idsForStaff(staffId) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM audit_assignment
     WHERE assigned_user_ids @> ARRAY[${staffId}]::integer[]
     ORDER BY id DESC
  `;
  return rows.map((r) => Number(r.id));
}

const isStaffAssigned = async (assignmentId, staffId) => {
  const rows = await prisma.$queryRaw`
    SELECT 1 AS ok FROM audit_assignment
     WHERE id = ${assignmentId} AND assigned_user_ids @> ARRAY[${staffId}]::integer[]
  `;
  return rows.length > 0;
};

/** Resolves the array columns into real records for API output. */
async function hydrate(rows) {
  const userIds = new Set();
  const productIds = new Set();
  const locationIds = new Set();
  for (const row of rows) {
    row.assignedUserIds.forEach((id) => userIds.add(id));
    row.productIds.forEach((id) => productIds.add(id));
    row.locationIds.forEach((id) => locationIds.add(id));
  }

  const [users, products, locations] = await Promise.all([
    userIds.size ? prisma.user.findMany({ where: { id: { in: [...userIds] } } }) : [],
    productIds.size ? prisma.product.findMany({ where: { id: { in: [...productIds] } } }) : [],
    locationIds.size ? prisma.location.findMany({ where: { id: { in: [...locationIds] } } }) : [],
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const productMap = new Map(products.map((p) => [p.id, p]));
  const locationMap = new Map(locations.map((l) => [l.id, l]));

  return rows.map((row) => ({
    ...row,
    assignedUsers: row.assignedUserIds.map((id) => userMap.get(id)).filter(Boolean),
    products: row.productIds.map((id) => productMap.get(id)).filter(Boolean),
    locations: row.locationIds.map((id) => locationMap.get(id)).filter(Boolean),
  }));
}

async function sessionStats(assignmentIds) {
  if (assignmentIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT audit_assignment_id                                        AS assignment_id,
           count(*)::int                                             AS sessions,
           count(*) FILTER (WHERE status = 'draft')::int              AS draft,
           count(*) FILTER (WHERE status = 'submitted')::int          AS submitted,
           count(*) FILTER (WHERE status = 'approved')::int           AS approved,
           count(*) FILTER (WHERE status = 'rejected')::int           AS rejected
      FROM audit_session
     WHERE audit_assignment_id = ANY (${assignmentIds}::integer[])
     GROUP BY audit_assignment_id
  `;
  return new Map(
    rows.map((r) => [
      Number(r.assignment_id),
      {
        sessions: r.sessions,
        draft: r.draft,
        submitted: r.submitted,
        approved: r.approved,
        rejected: r.rejected,
        pendingReview: r.submitted,
      },
    ]),
  );
}

const EMPTY_STATS = { sessions: 0, draft: 0, submitted: 0, approved: 0, rejected: 0, pendingReview: 0 };

/** Used by the program dashboard (§32 assignment table). */
async function listForProgramWithStats(programId) {
  const rows = await prisma.auditAssignment.findMany({
    where: { auditProgramId: programId },
    include,
    orderBy: { id: 'asc' },
  });
  const [hydrated, stats] = await Promise.all([hydrate(rows), sessionStats(rows.map((r) => r.id))]);
  const serialize = require('../../../utils/serialize');
  return hydrated.map((row) =>
    serialize.auditAssignment({ ...row, stats: stats.get(row.id) || EMPTY_STATS }),
  );
}

const countOpenSessions = async (programId) => {
  const rows = await prisma.$queryRaw`
    SELECT count(*)::int AS n
      FROM audit_session s
      JOIN audit_assignment a ON a.id = s.audit_assignment_id
     WHERE a.audit_program_id = ${programId}
       AND s.status IN ('draft', 'submitted')
  `;
  return rows[0].n;
};

/**
 * §10 status derivation: pending (no sessions) -> in_progress (some session still open)
 * -> done (every session submitted/approved/rejected).
 */
async function recomputeStatus(assignmentId, tx) {
  const rows = await tx.$queryRaw`
    SELECT count(*)::int                                    AS total,
           count(*) FILTER (WHERE status = 'draft')::int     AS draft,
           count(*) FILTER (WHERE status = 'approved')::int  AS approved
      FROM audit_session
     WHERE audit_assignment_id = ${assignmentId}
  `;
  const { total, draft, approved } = rows[0];

  const current = await tx.auditAssignment.findUnique({
    where: { id: assignmentId },
    select: { status: true },
  });
  if (!current || current.status === 'cancelled') return current?.status ?? null;

  let status = 'pending';
  if (approved > 0) status = 'done';
  else if (total === 0) status = 'pending';
  else if (draft > 0) status = 'in_progress';
  else status = 'done';

  if (status !== current.status) {
    await tx.auditAssignment.update({ where: { id: assignmentId }, data: { status } });
  }
  return status;
}

module.exports = {
  list,
  findById,
  findByIdForUpdate,
  create,
  update,
  idsForStaff,
  isStaffAssigned,
  hydrate,
  sessionStats,
  listForProgramWithStats,
  countOpenSessions,
  recomputeStatus,
  EMPTY_STATS,
};
