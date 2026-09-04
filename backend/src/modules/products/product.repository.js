'use strict';

const { prisma } = require('../../database/prisma');

const withAudit = { createdBy: true, writtenBy: true };

function buildWhere({ search, isActive }) {
  const where = {};
  if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;
  if (search) {
    where.OR = [
      { sku: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
}

async function list({ filters, pagination, sort }) {
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: withAudit,
      orderBy: { [sort.by]: sort.dir },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.product.count({ where }),
  ]);
  return { rows, total };
}

/** §5: the UI quantity of a product is the sum of stock_balance across every location. */
async function totalQuantities(productIds) {
  if (productIds.length === 0) return new Map();
  const grouped = await prisma.stockBalance.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds } },
    _sum: { quantity: true },
  });
  return new Map(grouped.map((g) => [g.productId, g._sum.quantity]));
}

const findById = (id) => prisma.product.findUnique({ where: { id }, include: withAudit });
const findBySku = (sku) => prisma.product.findUnique({ where: { sku } });

const create = (data) => prisma.product.create({ data, include: withAudit });
const update = (id, data) => prisma.product.update({ where: { id }, data, include: withAudit });
const remove = (id) => prisma.product.delete({ where: { id } });

const balances = (productId) =>
  prisma.stockBalance.findMany({
    where: { productId },
    include: { location: true, product: true },
    orderBy: { locationId: 'asc' },
  });

/** Historical references that make a physical delete unacceptable (§26). */
async function referenceCounts(productId) {
  const [movements, auditItems, assignments] = await Promise.all([
    prisma.stockQuant.count({ where: { productId } }),
    prisma.auditSessionItem.count({ where: { productId } }),
    prisma.$queryRaw`SELECT count(*)::int AS n FROM audit_assignment WHERE product_ids @> ARRAY[${productId}]::integer[]`,
  ]);
  return { movements, auditItems, assignments: assignments[0].n };
}

module.exports = {
  list,
  totalQuantities,
  findById,
  findBySku,
  create,
  update,
  remove,
  balances,
  referenceCounts,
};
