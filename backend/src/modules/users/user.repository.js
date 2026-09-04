'use strict';

const { prisma } = require('../../database/prisma');

function buildWhere({ search, role, isActive }) {
  const where = {};
  if (role) where.role = role;
  if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;
  if (search) {
    where.OR = [
      { username: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}

async function list({ filters, pagination }) {
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { username: 'asc' }, skip: pagination.skip, take: pagination.take }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

const findById = (id) => prisma.user.findUnique({ where: { id } });
const create = (data) => prisma.user.create({ data });
const update = (id, data) => prisma.user.update({ where: { id }, data });

async function referenceCounts(userId) {
  const [sessions, assignments, movements] = await Promise.all([
    prisma.auditSession.count({ where: { staffId: userId } }),
    prisma.$queryRaw`SELECT count(*)::int AS n FROM audit_assignment WHERE assigned_user_ids @> ARRAY[${userId}]::integer[]`,
    prisma.stockQuant.count({ where: { createdById: userId } }),
  ]);
  return { sessions, assignments: assignments[0].n, movements };
}

/** Open work that must be finished before a staff account can be deactivated. */
async function openSessionCount(userId) {
  return prisma.auditSession.count({ where: { staffId: userId, status: { in: ['draft', 'submitted'] } } });
}

module.exports = { list, findById, create, update, referenceCounts, openSessionCount };
