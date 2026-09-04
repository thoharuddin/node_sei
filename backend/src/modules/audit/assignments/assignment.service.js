'use strict';

const { prisma } = require('../../../database/prisma');
const repository = require('./assignment.repository');
const programRepository = require('../programs/program.repository');
const scopeService = require('../../../services/audit-scope.service');
const { notFound, conflict, forbidden, badRequest } = require('../../../utils/errors');
const { parsePagination, meta } = require('../../../utils/pagination');
const serialize = require('../../../utils/serialize');

async function decorate(rows) {
  const [hydrated, stats] = await Promise.all([
    repository.hydrate(rows),
    repository.sessionStats(rows.map((r) => r.id)),
  ]);
  return hydrated.map((row) =>
    serialize.auditAssignment({ ...row, stats: stats.get(row.id) || repository.EMPTY_STATS }),
  );
}

async function list(query, actor) {
  const pagination = parsePagination(query);
  const filters = { ...query };

  if (actor.role === 'staff') {
    filters.ids = await repository.idsForStaff(actor.id);
    if (filters.ids.length === 0) return { data: [], meta: meta(0, pagination) };
  } else if (query.assignedUserId) {
    filters.ids = await repository.idsForStaff(query.assignedUserId);
    if (filters.ids.length === 0) return { data: [], meta: meta(0, pagination) };
  }

  const { rows, total } = await repository.list({ filters, pagination });
  return { data: await decorate(rows), meta: meta(total, pagination) };
}

const listForProgram = (programId, query, actor) =>
  list({ ...query, programId: Number(programId) }, actor);

/** §18: the staff "My Assignments" screen. */
async function listMine(actor) {
  const ids = await repository.idsForStaff(actor.id);
  if (ids.length === 0) return { data: [], meta: { total: 0 } };

  const rows = await prisma.auditAssignment.findMany({
    where: { id: { in: ids }, status: { not: 'cancelled' } },
    include: { createdBy: true, program: true },
    orderBy: { id: 'desc' },
  });

  const decorated = await decorate(rows);
  const mySessions = await prisma.auditSession.findMany({
    where: { auditAssignmentId: { in: ids }, staffId: actor.id },
    orderBy: { id: 'desc' },
  });

  const byAssignment = new Map();
  for (const session of mySessions) {
    const list_ = byAssignment.get(session.auditAssignmentId) || [];
    list_.push(serialize.auditSession(session));
    byAssignment.set(session.auditAssignmentId, list_);
  }

  return {
    data: decorated.map((assignment) => ({
      ...assignment,
      mySessions: byAssignment.get(assignment.id) || [],
    })),
    meta: { total: decorated.length },
  };
}

async function getById(id, actor) {
  const assignment = await repository.findById(id);
  if (!assignment) throw notFound(`Audit assignment ${id} not found`);
  if (actor.role === 'staff' && !assignment.assignedUserIds.includes(actor.id)) {
    throw forbidden('This assignment is not assigned to you');
  }

  const [decorated] = await decorate([assignment]);
  const sessions = await prisma.auditSession.findMany({
    where: {
      auditAssignmentId: id,
      ...(actor.role === 'staff' ? { staffId: actor.id } : {}),
    },
    include: { staff: true, approvedBy: true, rejectedBy: true, adjustment: true },
    orderBy: { id: 'asc' },
  });

  const scope = await scopeService.resolveScope(assignment);
  return {
    ...decorated,
    sessions: sessions.map(serialize.auditSession),
    scopePreview: { pairCount: scope.pairs.length },
  };
}

async function create(programId, payload, actor) {
  const program = await programRepository.findById(Number(programId));
  if (!program) throw notFound(`Audit program ${programId} not found`);
  if (['completed', 'cancelled'].includes(program.status)) {
    throw conflict(`Cannot add assignments to a ${program.status} program`);
  }

  const created = await repository.create({
    auditProgramId: program.id,
    assignedUserIds: payload.assignedUserIds,
    assignmentType: payload.assignmentType,
    productIds: payload.assignmentType === 'product' ? payload.productIds : [],
    locationIds: payload.assignmentType === 'location' ? payload.locationIds : [],
    notes: payload.notes ?? null,
    createdById: actor.id,
  });

  // A program becomes in_progress as soon as it has work in it (§9).
  if (program.status === 'draft') {
    await programRepository.update(program.id, { status: 'in_progress' });
  }

  const [decorated] = await decorate([created]);
  return decorated;
}

async function update(id, payload, actor) {
  const existing = await repository.findById(id);
  if (!existing) throw notFound(`Audit assignment ${id} not found`);

  const sessionCount = await prisma.auditSession.count({ where: { auditAssignmentId: id } });
  const data = { notes: payload.notes, status: payload.status };

  // Once counting has started, the audited scope is frozen: changing it would invalidate
  // the snapshots already taken (§16).
  if (payload.productIds || payload.locationIds || payload.assignedUserIds) {
    if (payload.productIds || payload.locationIds) {
      if (sessionCount > 0) {
        throw conflict('Cannot change the scope of an assignment that already has audit sessions');
      }
      if (existing.assignmentType === 'product') {
        if (payload.locationIds?.length) throw badRequest('A product assignment must not carry location ids');
        if (payload.productIds) data.productIds = payload.productIds;
      } else {
        if (payload.productIds?.length) throw badRequest('A location assignment must not carry product ids');
        if (payload.locationIds) data.locationIds = payload.locationIds;
      }
    }
    if (payload.assignedUserIds) {
      // Staff who already produced a session cannot be removed from the assignment.
      const owners = await prisma.auditSession.findMany({
        where: { auditAssignmentId: id },
        select: { staffId: true },
        distinct: ['staffId'],
      });
      const missing = owners.map((o) => o.staffId).filter((sid) => !payload.assignedUserIds.includes(sid));
      if (missing.length > 0) {
        throw conflict(`Staff ${missing.join(', ')} already have audit sessions on this assignment`);
      }
      data.assignedUserIds = payload.assignedUserIds;
    }
  }

  if (payload.status && payload.status === 'cancelled') {
    const approved = await prisma.auditSession.count({ where: { auditAssignmentId: id, status: 'approved' } });
    if (approved > 0) throw conflict('Cannot cancel an assignment whose session has been approved');
  }

  Object.keys(data).forEach((key) => data[key] === undefined && delete data[key]);
  const updated = await repository.update(id, data);
  const [decorated] = await decorate([updated]);
  return decorated;
}

/** Authorization helper used by the session module (§31, §34.4). */
async function assertStaffAssigned(assignmentId, actor) {
  const assignment = await repository.findById(assignmentId);
  if (!assignment) throw notFound(`Audit assignment ${assignmentId} not found`);
  if (actor.role === 'staff' && !assignment.assignedUserIds.includes(actor.id)) {
    throw forbidden('This assignment is not assigned to you');
  }
  return assignment;
}

module.exports = { list, listForProgram, listMine, getById, create, update, assertStaffAssigned, decorate };
