'use strict';

const { prisma } = require('../../../database/prisma');
const stockRepository = require('../../stock/stock.repository');
const { notFound, forbidden } = require('../../../utils/errors');
const { parsePagination, meta } = require('../../../utils/pagination');
const serialize = require('../../../utils/serialize');

/**
 * Turns one approved audit session into stock movements (§23).
 *
 * Must be called inside a transaction. It is idempotent: the stock_adjustment row is locked
 * and a row already marked `posted` short-circuits, so a retry (a duplicate approval request
 * or a re-delivered queue job) can never post the movements twice (§25).
 *
 * Only non-zero differences produce a stock_quant row; a zero difference produces nothing.
 */
async function postAdjustment(tx, adjustmentId) {
  const locked = await tx.$queryRaw`
    SELECT id, audit_session_id, created_by, posting_status
      FROM stock_adjustment
     WHERE id = ${adjustmentId}
       FOR UPDATE
  `;
  if (locked.length === 0) throw notFound(`Stock adjustment ${adjustmentId} not found`);
  const adjustment = locked[0];

  if (adjustment.posting_status === 'posted') {
    return { adjustmentId, alreadyPosted: true, movements: 0 };
  }

  // The database owns the arithmetic: read the generated difference column directly.
  const items = await tx.$queryRaw`
    SELECT product_id, location_id, difference
      FROM audit_session_item
     WHERE audit_session_id = ${adjustment.audit_session_id}
       AND difference <> 0
     ORDER BY product_id, location_id
  `;

  if (items.length > 0) {
    await stockRepository.postMovements(tx, {
      actorId: adjustment.created_by,
      // A physical count is the truth even if the ledger moved after the snapshot.
      allowNegative: true,
      movements: items.map((item) => ({
        productId: Number(item.product_id),
        locationId: Number(item.location_id),
        quantity: item.difference,
        movementType: 'audit_adjustment',
        referenceType: 'audit_session',
        referenceId: Number(adjustment.audit_session_id),
        adjustmentId,
      })),
    });
  }

  await tx.stockAdjustment.update({
    where: { id: adjustmentId },
    data: { postingStatus: 'posted', postedAt: new Date(), postingError: null },
  });

  return { adjustmentId, alreadyPosted: false, movements: items.length };
}

/* ------------------------------------------------------------------ reading */

async function list(query) {
  const pagination = parsePagination(query);
  const where = {};
  if (query.postingStatus) where.postingStatus = query.postingStatus;
  if (query.auditSessionId) where.auditSessionId = query.auditSessionId;

  const [rows, total] = await Promise.all([
    prisma.stockAdjustment.findMany({
      where,
      include: {
        createdBy: true,
        session: { include: { staff: true, approvedBy: true, assignment: { include: { program: true } } } },
      },
      orderBy: { id: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.stockAdjustment.count({ where }),
  ]);

  return { data: rows.map(serialize.stockAdjustment), meta: meta(total, pagination) };
}

async function getById(id, actor) {
  if (actor.role !== 'manager') throw forbidden('Only managers can inspect stock adjustments');
  const row = await prisma.stockAdjustment.findUnique({
    where: { id },
    include: {
      createdBy: true,
      quants: { include: { product: true, location: true, createdBy: true }, orderBy: { id: 'asc' } },
      session: {
        include: {
          staff: true,
          approvedBy: true,
          items: { include: { product: true, location: true } },
          assignment: { include: { program: true } },
        },
      },
    },
  });
  if (!row) throw notFound(`Stock adjustment ${id} not found`);
  return serialize.stockAdjustment(row);
}

module.exports = { postAdjustment, list, getById };
