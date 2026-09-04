'use strict';

const { prisma } = require('../../database/prisma');

const withAudit = { createdBy: true, writtenBy: true, parent: true };

function buildWhere({ search, isActive, parentId }) {
  const where = {};
  if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;
  if (parentId !== undefined) where.parentId = parentId;
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}

async function list({ filters, pagination }) {
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.location.findMany({
      where,
      include: withAudit,
      orderBy: { code: 'asc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.location.count({ where }),
  ]);
  return { rows, total };
}

const listAll = (filters) =>
  prisma.location.findMany({ where: buildWhere(filters), include: withAudit, orderBy: { code: 'asc' } });

const findById = (id) => prisma.location.findUnique({ where: { id }, include: withAudit });

const create = (data) => prisma.location.create({ data, include: withAudit });
const update = (id, data) => prisma.location.update({ where: { id }, data, include: withAudit });
const remove = (id) => prisma.location.delete({ where: { id } });

/** A location and all of its descendants — the audit scope of a location assignment (§11). */
async function subtreeIds(rootIds, client = prisma) {
  if (!rootIds || rootIds.length === 0) return [];
  const rows = await client.$queryRaw`
    SELECT location_subtree_ids(${rootIds}::integer[]) AS id
  `;
  return rows.map((r) => Number(r.id));
}

async function referenceCounts(locationId) {
  const [movements, auditItems, assignments, children] = await Promise.all([
    prisma.stockQuant.count({ where: { locationId } }),
    prisma.auditSessionItem.count({ where: { locationId } }),
    prisma.$queryRaw`SELECT count(*)::int AS n FROM audit_assignment WHERE location_ids @> ARRAY[${locationId}]::integer[]`,
    prisma.location.count({ where: { parentId: locationId } }),
  ]);
  return { movements, auditItems, assignments: assignments[0].n, children };
}

module.exports = { list, listAll, findById, create, update, remove, subtreeIds, referenceCounts };
