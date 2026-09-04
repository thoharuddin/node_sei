'use strict';

const { prisma, withTransaction } = require('../../database/prisma');
const repository = require('./stock.repository');
const locationRepository = require('../locations/location.repository');
const { notFound } = require('../../utils/errors');
const { parsePagination, meta } = require('../../utils/pagination');
const serialize = require('../../utils/serialize');

const truthy = (v) => ['true', '1', true].includes(v);

async function listBalances(query) {
  const pagination = parsePagination(query);
  const filters = { ...query, nonZero: truthy(query.nonZero) };

  // Asking for a parent location can include everything below it in the hierarchy.
  if (query.locationId && truthy(query.includeChildren)) {
    filters.locationIds = await locationRepository.subtreeIds([query.locationId]);
    delete filters.locationId;
  }

  const { rows, total } = await repository.listBalances({ filters, pagination });
  return { data: rows.map(serialize.stockBalance), meta: meta(total, pagination) };
}

async function getBalance(productId, locationId) {
  const balance = await repository.findBalance(productId, locationId);
  const movements = await repository.listMovements({
    filters: { productId, locationId },
    pagination: { skip: 0, take: 20 },
  });

  if (!balance && movements.total === 0) {
    const exists = await prisma.product.count({ where: { id: productId } });
    if (!exists) throw notFound(`Product ${productId} not found`);
  }

  return {
    productId,
    locationId,
    quantity: balance ? serialize.toNum(balance.quantity) : 0,
    product: balance ? serialize.productRef(balance.product) : undefined,
    location: balance ? serialize.locationRef(balance.location) : undefined,
    updatedAt: balance ? balance.updatedAt : null,
    recentMovements: movements.rows.map(serialize.stockQuant),
  };
}

async function listMovements(query) {
  const pagination = parsePagination(query);
  const { rows, total } = await repository.listMovements({ filters: query, pagination });
  return { data: rows.map(serialize.stockQuant), meta: meta(total, pagination) };
}

/** §24: expose the traceability chain of one ledger row. */
async function getMovement(id) {
  const row = await repository.findMovementWithTrace(id);
  if (!row) throw notFound(`Stock movement ${id} not found`);

  const adjustment = row.adjustment;
  const session = adjustment?.session;
  const trace = adjustment
    ? {
        reason: 'audit_adjustment',
        stockAdjustmentId: adjustment.id,
        auditSessionId: session?.id,
        auditAssignmentId: session?.assignment?.id,
        auditProgram: session?.assignment?.program
          ? { id: session.assignment.program.id, name: session.assignment.program.name }
          : null,
        countedBy: serialize.userRef(session?.staff),
        approvedBy: serialize.userRef(session?.approvedBy),
        approvedAt: session?.approvedAt,
      }
    : {
        reason: row.movementType,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        createdBy: serialize.userRef(row.createdBy),
      };

  return { ...serialize.stockQuant(row), trace };
}

/** Manual stock movements (§30 "Stock movement creation") — one transaction per request. */
async function createMovement(payload, actor) {
  const sign = payload.movementType === 'delivery' ? -1 : 1;

  await repository.assertActive({
    productIds: [...new Set(payload.lines.map((l) => l.productId))],
    locationIds: [...new Set(payload.lines.map((l) => l.locationId))],
  });

  const result = await withTransaction(prisma, async (tx) =>
    repository.postMovements(tx, {
      actorId: actor.id,
      movements: payload.lines.map((l) => ({
        productId: l.productId,
        locationId: l.locationId,
        quantity: sign * l.quantity,
        movementType: payload.movementType,
        referenceType: payload.referenceType ?? 'manual',
        referenceId: payload.referenceId ?? null,
      })),
    }),
  );

  return {
    movementType: payload.movementType,
    posted: result.posted,
    balances: result.balances.map((b) => ({ ...b, quantity: serialize.toNum(b.quantity) })),
  };
}

/** A transfer is two ledger rows (out + in) written in one transaction. */
async function createTransfer(payload, actor) {
  await repository.assertActive({
    productIds: [payload.productId],
    locationIds: [payload.fromLocationId, payload.toLocationId],
  });

  const result = await withTransaction(prisma, async (tx) =>
    repository.postMovements(tx, {
      actorId: actor.id,
      movements: [
        {
          productId: payload.productId,
          locationId: payload.fromLocationId,
          quantity: -payload.quantity,
          movementType: 'transfer_out',
          referenceType: payload.referenceType ?? 'manual_transfer',
          referenceId: payload.referenceId ?? null,
        },
        {
          productId: payload.productId,
          locationId: payload.toLocationId,
          quantity: payload.quantity,
          movementType: 'transfer_in',
          referenceType: payload.referenceType ?? 'manual_transfer',
          referenceId: payload.referenceId ?? null,
        },
      ],
    }),
  );

  return {
    movementType: 'transfer',
    posted: result.posted,
    balances: result.balances.map((b) => ({ ...b, quantity: serialize.toNum(b.quantity) })),
  };
}

/** §28: prove stock_balance still equals SUM(stock_quant). */
async function consistency() {
  const drifts = await repository.consistencyReport();
  return {
    consistent: drifts.length === 0,
    driftCount: drifts.length,
    drifts: drifts.map((d) => ({
      productId: d.product_id,
      locationId: d.location_id,
      balanceQuantity: serialize.toNum(d.balance_quantity),
      ledgerQuantity: serialize.toNum(d.ledger_quantity),
      drift: serialize.toNum(d.drift),
    })),
  };
}

module.exports = {
  listBalances,
  getBalance,
  listMovements,
  getMovement,
  createMovement,
  createTransfer,
  consistency,
};
