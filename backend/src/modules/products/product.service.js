'use strict';

const repository = require('./product.repository');
const { notFound, conflict } = require('../../utils/errors');
const { parsePagination, meta } = require('../../utils/pagination');
const serialize = require('../../utils/serialize');

async function list(query) {
  const pagination = parsePagination(query);
  const sort = { by: query.sortBy || 'sku', dir: query.sortDir || 'asc' };
  const { rows, total } = await repository.list({ filters: query, pagination, sort });

  const quantities = await repository.totalQuantities(rows.map((r) => r.id));
  const data = rows.map((row) =>
    serialize.product({ ...row, quantity: quantities.get(row.id) ?? 0 }),
  );

  return { data, meta: meta(total, pagination) };
}

async function getById(id) {
  const product = await repository.findById(id);
  if (!product) throw notFound(`Product ${id} not found`);
  const [quantities, rows] = await Promise.all([
    repository.totalQuantities([id]),
    repository.balances(id),
  ]);
  return {
    ...serialize.product({ ...product, quantity: quantities.get(id) ?? 0 }),
    balances: rows.map(serialize.stockBalance),
  };
}

async function getBalances(id) {
  const product = await repository.findById(id);
  if (!product) throw notFound(`Product ${id} not found`);
  const rows = await repository.balances(id);
  return rows.map(serialize.stockBalance);
}

async function create(payload, actor) {
  const created = await repository.create({
    sku: payload.sku,
    name: payload.name,
    isActive: payload.isActive ?? true,
    createUid: actor.id,
    writeUid: actor.id,
  });
  return serialize.product({ ...created, quantity: 0 });
}

async function update(id, payload, actor) {
  const existing = await repository.findById(id);
  if (!existing) throw notFound(`Product ${id} not found`);

  const updated = await repository.update(id, { ...payload, writeUid: actor.id });
  const quantities = await repository.totalQuantities([id]);
  return serialize.product({ ...updated, quantity: quantities.get(id) ?? 0 });
}

/**
 * §26: products with stock or audit history are never physically deleted.
 * The default is a soft delete; `hard` is only honoured for records with no history.
 */
async function remove(id, { hard }, actor) {
  const existing = await repository.findById(id);
  if (!existing) throw notFound(`Product ${id} not found`);

  const refs = await repository.referenceCounts(id);
  const hasHistory = refs.movements > 0 || refs.auditItems > 0 || refs.assignments > 0;

  if (hard) {
    if (hasHistory) {
      throw conflict(
        'Product has stock or audit history and cannot be physically deleted; deactivate it instead',
        refs,
      );
    }
    await repository.remove(id);
    return { deleted: 'hard', id };
  }

  const updated = await repository.update(id, { isActive: false, writeUid: actor.id });
  return { deleted: 'soft', product: serialize.product(updated), references: refs };
}

module.exports = { list, getById, getBalances, create, update, remove };
