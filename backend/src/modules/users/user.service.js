'use strict';

const repository = require('./user.repository');
const { hashPassword } = require('../auth/auth.service');
const { notFound, conflict, badRequest } = require('../../utils/errors');
const { parsePagination, meta } = require('../../utils/pagination');
const { userPublic } = require('../../utils/serialize');

async function list(query) {
  const pagination = parsePagination(query);
  const { rows, total } = await repository.list({ filters: query, pagination });
  return { data: rows.map(userPublic), meta: meta(total, pagination) };
}

async function getById(id) {
  const user = await repository.findById(id);
  if (!user) throw notFound(`User ${id} not found`);
  const references = await repository.referenceCounts(id);
  return { ...userPublic(user), references };
}

async function create(payload) {
  const passwordHash = await hashPassword(payload.password);
  const created = await repository.create({
    username: payload.username,
    passwordHash,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    isActive: payload.isActive ?? true,
  });
  return userPublic(created);
}

async function update(id, payload, actor) {
  const existing = await repository.findById(id);
  if (!existing) throw notFound(`User ${id} not found`);

  const data = { ...payload };
  if (payload.password) {
    data.passwordHash = await hashPassword(payload.password);
    delete data.password;
  }

  if (id === actor.id) {
    if (data.isActive === false) throw badRequest('You cannot deactivate your own account');
    if (data.role && data.role !== existing.role) throw badRequest('You cannot change your own role');
  }

  // A staff member with unfinished audit work must not silently lose access to it.
  if (data.isActive === false && existing.role === 'staff') {
    const open = await repository.openSessionCount(id);
    if (open > 0) {
      throw conflict(`User has ${open} audit session(s) in draft/submitted state; resolve them first`);
    }
  }

  const updated = await repository.update(id, data);
  return userPublic(updated);
}

/** §26: users are never physically deleted — deactivate instead. */
async function deactivate(id, actor) {
  if (id === actor.id) throw badRequest('You cannot deactivate your own account');
  const existing = await repository.findById(id);
  if (!existing) throw notFound(`User ${id} not found`);

  if (existing.role === 'staff') {
    const open = await repository.openSessionCount(id);
    if (open > 0) {
      throw conflict(`User has ${open} audit session(s) in draft/submitted state; resolve them first`);
    }
  }

  const updated = await repository.update(id, { isActive: false });
  const references = await repository.referenceCounts(id);
  return { deleted: 'soft', user: userPublic(updated), references };
}

module.exports = { list, getById, create, update, deactivate };
