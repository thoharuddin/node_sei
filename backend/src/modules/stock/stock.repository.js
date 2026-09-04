'use strict';

const { prisma, Prisma } = require('../../database/prisma');
const { conflict, badRequest } = require('../../utils/errors');

const KEY = (productId, locationId) => `${productId}:${locationId}`;

/**
 * THE ONLY WRITE PATH FOR STOCK.
 *
 * Appends rows to the stock_quant ledger and moves the stock_balance cache by the same
 * amounts, inside the caller's transaction (§8, §16, §28). Callers must already be inside
 * a transaction — `tx` is a Prisma transaction client.
 *
 * movements: [{ productId, locationId, quantity, movementType, referenceType, referenceId, adjustmentId }]
 *   quantity is signed: +receipt, -delivery. Zero-quantity movements are dropped (§23).
 *
 * options.allowNegative — physical counts may legitimately drive a balance negative if the
 * ledger moved after the snapshot; manual issues/transfers may not.
 */
async function postMovements(tx, { movements, actorId, allowNegative = false }) {
  const effective = movements
    .map((m) => ({ ...m, quantity: new Prisma.Decimal(m.quantity) }))
    .filter((m) => !m.quantity.isZero());

  if (effective.length === 0) return { quants: [], balances: [] };

  // Net delta per product/location so a single statement never touches a key twice.
  const deltas = new Map();
  for (const m of effective) {
    const key = KEY(m.productId, m.locationId);
    const current = deltas.get(key) || {
      productId: m.productId,
      locationId: m.locationId,
      delta: new Prisma.Decimal(0),
    };
    current.delta = current.delta.plus(m.quantity);
    deltas.set(key, current);
  }

  // Deterministic lock order over the affected balance rows prevents deadlocks between
  // concurrent postings (§25).
  const ordered = [...deltas.values()].sort(
    (a, b) => a.productId - b.productId || a.locationId - b.locationId,
  );

  const pairs = Prisma.join(
    ordered.map((d) => Prisma.sql`(${d.productId}, ${d.locationId})`),
    ', ',
  );
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM stock_balance
     WHERE (product_id, location_id) IN (${pairs})
     ORDER BY product_id, location_id
       FOR UPDATE
  `);

  // 1) append the immutable ledger rows
  await tx.stockQuant.createMany({
    data: effective.map((m) => ({
      productId: m.productId,
      locationId: m.locationId,
      quantity: m.quantity,
      movementType: m.movementType,
      referenceType: m.referenceType ?? null,
      referenceId: m.referenceId ?? null,
      adjustmentId: m.adjustmentId ?? null,
      createdById: m.createdById ?? actorId,
    })),
  });

  // 2) move the cache by the same net deltas, in the same transaction
  const values = Prisma.join(
    ordered.map(
      (d) => Prisma.sql`(${d.productId}, ${d.locationId}, ${d.delta.toString()}::numeric, now())`,
    ),
    ', ',
  );
  const balances = await tx.$queryRaw(Prisma.sql`
    INSERT INTO stock_balance (product_id, location_id, quantity, updated_at)
    VALUES ${values}
    ON CONFLICT (product_id, location_id)
    DO UPDATE SET quantity = stock_balance.quantity + EXCLUDED.quantity, updated_at = now()
    RETURNING id, product_id, location_id, quantity
  `);

  if (!allowNegative) {
    const negative = balances.find((b) => new Prisma.Decimal(b.quantity).isNegative());
    if (negative) {
      throw conflict('Movement would drive stock below zero', {
        productId: negative.product_id,
        locationId: negative.location_id,
        resultingQuantity: new Prisma.Decimal(negative.quantity).toNumber(),
      });
    }
  }

  return {
    balances: balances.map((b) => ({
      id: b.id,
      productId: b.product_id,
      locationId: b.location_id,
      quantity: new Prisma.Decimal(b.quantity),
    })),
    posted: effective.length,
  };
}

/** Current stock snapshot for an explicit list of product/location pairs (§15/§16). */
async function balancesFor(pairs, client = prisma) {
  if (pairs.length === 0) return new Map();
  const conditions = Prisma.join(
    pairs.map((p) => Prisma.sql`(${p.productId}, ${p.locationId})`),
    ', ',
  );
  const rows = await client.$queryRaw(Prisma.sql`
    SELECT product_id, location_id, quantity
      FROM stock_balance
     WHERE (product_id, location_id) IN (${conditions})
  `);
  return new Map(rows.map((r) => [KEY(r.product_id, r.location_id), new Prisma.Decimal(r.quantity)]));
}

function balanceWhere({ productId, locationId, locationIds, nonZero, search }) {
  const where = {};
  if (productId) where.productId = productId;
  if (locationId) where.locationId = locationId;
  if (locationIds) where.locationId = { in: locationIds };
  if (nonZero) where.quantity = { not: 0 };
  if (search) {
    where.product = {
      OR: [
        { sku: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ],
    };
  }
  return where;
}

async function listBalances({ filters, pagination }) {
  const where = balanceWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.stockBalance.findMany({
      where,
      include: { product: true, location: true },
      orderBy: [{ productId: 'asc' }, { locationId: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.stockBalance.count({ where }),
  ]);
  return { rows, total };
}

const findBalance = (productId, locationId) =>
  prisma.stockBalance.findUnique({
    where: { productId_locationId: { productId, locationId } },
    include: { product: true, location: true },
  });

function movementWhere({ productId, locationId, movementType, adjustmentId, referenceType, from, to }) {
  const where = {};
  if (productId) where.productId = productId;
  if (locationId) where.locationId = locationId;
  if (movementType) where.movementType = movementType;
  if (adjustmentId) where.adjustmentId = adjustmentId;
  if (referenceType) where.referenceType = referenceType;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }
  return where;
}

async function listMovements({ filters, pagination }) {
  const where = movementWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.stockQuant.findMany({
      where,
      include: { product: true, location: true, createdBy: true },
      orderBy: { id: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.stockQuant.count({ where }),
  ]);
  return { rows, total };
}

/** §24: full "why did this quantity change?" chain for one ledger row. */
const findMovementWithTrace = (id) =>
  prisma.stockQuant.findUnique({
    where: { id },
    include: {
      product: true,
      location: true,
      createdBy: true,
      adjustment: {
        include: {
          createdBy: true,
          session: {
            include: {
              staff: true,
              approvedBy: true,
              assignment: { include: { program: true } },
            },
          },
        },
      },
    },
  });

const consistencyReport = () => prisma.$queryRaw`
  SELECT product_id, location_id, balance_quantity, ledger_quantity, drift
    FROM stock_balance_consistency
   WHERE drift <> 0
   ORDER BY product_id, location_id
`;

async function assertActive({ productIds = [], locationIds = [] }, client = prisma) {
  if (productIds.length) {
    const found = await client.product.findMany({ where: { id: { in: productIds } }, select: { id: true, isActive: true } });
    const map = new Map(found.map((p) => [p.id, p.isActive]));
    for (const id of productIds) {
      if (!map.has(id)) throw badRequest(`Product ${id} does not exist`);
      if (!map.get(id)) throw badRequest(`Product ${id} is inactive`);
    }
  }
  if (locationIds.length) {
    const found = await client.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, isActive: true } });
    const map = new Map(found.map((l) => [l.id, l.isActive]));
    for (const id of locationIds) {
      if (!map.has(id)) throw badRequest(`Location ${id} does not exist`);
      if (!map.get(id)) throw badRequest(`Location ${id} is inactive`);
    }
  }
}

module.exports = {
  postMovements,
  balancesFor,
  listBalances,
  findBalance,
  listMovements,
  findMovementWithTrace,
  consistencyReport,
  assertActive,
};
