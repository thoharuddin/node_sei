'use strict';

const repository = require('./location.repository');
const { notFound, conflict, badRequest } = require('../../utils/errors');
const { parsePagination, meta } = require('../../utils/pagination');
const serialize = require('../../utils/serialize');

/** Builds the WH -> Stock -> Rack A/B/C hierarchy the UI renders (§6). */
function buildTree(rows) {
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

async function list(query) {
  if (['true', '1'].includes(String(query.tree))) {
    const rows = await repository.listAll(query);
    return { data: buildTree(rows).map(serialize.location), meta: { total: rows.length, tree: true } };
  }
  const pagination = parsePagination(query);
  const { rows, total } = await repository.list({ filters: query, pagination });
  return { data: rows.map(serialize.location), meta: meta(total, pagination) };
}

async function getById(id) {
  const location = await repository.findById(id);
  if (!location) throw notFound(`Location ${id} not found`);
  const children = await repository.listAll({ parentId: id });
  return { ...serialize.location(location), children: children.map(serialize.location) };
}

async function create(payload, actor) {
  if (payload.parentId) await assertExists(payload.parentId);
  const created = await repository.create({
    code: payload.code,
    name: payload.name,
    parentId: payload.parentId ?? null,
    isActive: payload.isActive ?? true,
    createUid: actor.id,
    writeUid: actor.id,
  });
  return serialize.location(created);
}

async function update(id, payload, actor) {
  const existing = await repository.findById(id);
  if (!existing) throw notFound(`Location ${id} not found`);

  if (payload.parentId !== undefined && payload.parentId !== null) {
    if (payload.parentId === id) throw badRequest('A location cannot be its own parent');
    await assertExists(payload.parentId);
    // The database trigger is the hard guarantee; this gives a friendlier error first.
    const descendants = await repository.subtreeIds([id]);
    if (descendants.includes(payload.parentId)) {
      throw conflict('Cannot move a location under one of its own descendants');
    }
  }

  const updated = await repository.update(id, { ...payload, writeUid: actor.id });
  return serialize.location(updated);
}

async function remove(id, { hard }, actor) {
  const existing = await repository.findById(id);
  if (!existing) throw notFound(`Location ${id} not found`);

  const refs = await repository.referenceCounts(id);
  const hasHistory = refs.movements > 0 || refs.auditItems > 0 || refs.assignments > 0;

  if (hard) {
    if (hasHistory || refs.children > 0) {
      throw conflict(
        'Location has stock history or child locations and cannot be physically deleted; deactivate it instead',
        refs,
      );
    }
    await repository.remove(id);
    return { deleted: 'hard', id };
  }

  const updated = await repository.update(id, { isActive: false, writeUid: actor.id });
  return { deleted: 'soft', location: serialize.location(updated), references: refs };
}

async function assertExists(id) {
  const parent = await repository.findById(id);
  if (!parent) throw badRequest(`Parent location ${id} does not exist`);
  return parent;
}

module.exports = { list, getById, create, update, remove };
