'use strict';

const { prisma } = require('../database/prisma');
const locationRepository = require('../modules/locations/location.repository');

/**
 * Resolves the (product, location) pairs an assignment covers (§11, §12).
 *
 * location assignment -> every product that has a stock record in the assigned locations,
 *                        including their descendants (WH/Stock -> Rack A/B/C).
 * product  assignment -> every location where the assigned products have a stock record.
 *
 * Pairs are always kept separate: quantities of the same product in different locations are
 * never combined (§12).
 */
async function resolveScope(assignment, client = prisma) {
  if (assignment.assignmentType === 'location') {
    const locationIds = await locationRepository.subtreeIds(assignment.locationIds, client);
    if (locationIds.length === 0) return { pairs: [], locationIds: [] };

    const rows = await client.$queryRaw`
      SELECT b.product_id, b.location_id
        FROM stock_balance b
        JOIN products p ON p.id = b.product_id
        JOIN locations l ON l.id = b.location_id
       WHERE b.location_id = ANY (${locationIds}::integer[])
         AND p.is_active
         AND l.is_active
       ORDER BY b.location_id, b.product_id
    `;
    return {
      pairs: rows.map((r) => ({ productId: Number(r.product_id), locationId: Number(r.location_id) })),
      locationIds,
    };
  }

  const productIds = assignment.productIds;
  if (productIds.length === 0) return { pairs: [], locationIds: [] };

  const rows = await client.$queryRaw`
    SELECT b.product_id, b.location_id
      FROM stock_balance b
      JOIN products p ON p.id = b.product_id
      JOIN locations l ON l.id = b.location_id
     WHERE b.product_id = ANY (${productIds}::integer[])
       AND p.is_active
       AND l.is_active
     ORDER BY b.product_id, b.location_id
  `;
  return {
    pairs: rows.map((r) => ({ productId: Number(r.product_id), locationId: Number(r.location_id) })),
    locationIds: [],
  };
}

/** Is this product/location pair inside the assignment's scope? (used when adding items) */
async function isInScope(assignment, { productId, locationId }, client = prisma) {
  if (assignment.assignmentType === 'product') {
    return assignment.productIds.includes(productId);
  }
  const locationIds = await locationRepository.subtreeIds(assignment.locationIds, client);
  return locationIds.includes(locationId);
}

module.exports = { resolveScope, isInScope };
