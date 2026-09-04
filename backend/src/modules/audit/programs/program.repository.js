'use strict';

const { prisma } = require('../../../database/prisma');

const include = { createdBy: true };

function buildWhere({ search, status, programIds }) {
  const where = {};
  if (status) where.status = status;
  if (programIds) where.id = { in: programIds };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}

async function list({ filters, pagination }) {
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.auditProgram.findMany({
      where,
      include,
      orderBy: { id: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.auditProgram.count({ where }),
  ]);
  return { rows, total };
}

const findById = (id) => prisma.auditProgram.findUnique({ where: { id }, include });
const create = (data) => prisma.auditProgram.create({ data, include });
const update = (id, data) => prisma.auditProgram.update({ where: { id }, data, include });

/** Programs a given staff member is involved in, through assignment.assigned_user_ids. */
async function programIdsForStaff(staffId) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT audit_program_id AS id
      FROM audit_assignment
     WHERE assigned_user_ids @> ARRAY[${staffId}]::integer[]
  `;
  return rows.map((r) => Number(r.id));
}

/** Dashboard counters for §32 (assignments / sessions / submitted / approved / pending review). */
async function statsFor(programIds) {
  if (programIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT a.audit_program_id                                              AS program_id,
           count(DISTINCT a.id)::int                                       AS assignments,
           count(DISTINCT a.id) FILTER (WHERE a.status = 'done')::int      AS assignments_done,
           count(s.id)::int                                               AS sessions,
           count(s.id) FILTER (WHERE s.status = 'draft')::int              AS sessions_draft,
           count(s.id) FILTER (WHERE s.status = 'submitted')::int          AS sessions_submitted,
           count(s.id) FILTER (WHERE s.status = 'approved')::int           AS sessions_approved,
           count(s.id) FILTER (WHERE s.status = 'rejected')::int           AS sessions_rejected
      FROM audit_assignment a
      LEFT JOIN audit_session s ON s.audit_assignment_id = a.id
     WHERE a.audit_program_id = ANY (${programIds}::integer[])
     GROUP BY a.audit_program_id
  `;
  return new Map(
    rows.map((r) => [
      Number(r.program_id),
      {
        assignments: r.assignments,
        assignmentsDone: r.assignments_done,
        sessions: r.sessions,
        draft: r.sessions_draft,
        submitted: r.sessions_submitted,
        approved: r.sessions_approved,
        rejected: r.sessions_rejected,
        pendingReview: r.sessions_submitted,
      },
    ]),
  );
}

const EMPTY_STATS = {
  assignments: 0,
  assignmentsDone: 0,
  sessions: 0,
  draft: 0,
  submitted: 0,
  approved: 0,
  rejected: 0,
  pendingReview: 0,
};

module.exports = { list, findById, create, update, programIdsForStaff, statsFor, EMPTY_STATS };
