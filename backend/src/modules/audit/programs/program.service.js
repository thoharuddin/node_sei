'use strict';

const repository = require('./program.repository');
const assignmentRepository = require('../assignments/assignment.repository');
const { notFound, conflict, forbidden } = require('../../../utils/errors');
const { parsePagination, meta } = require('../../../utils/pagination');
const serialize = require('../../../utils/serialize');

// §9 program lifecycle
const TRANSITIONS = {
  draft: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

async function list(query, actor) {
  const pagination = parsePagination(query);
  const filters = { ...query };

  // Staff only ever see programs they are assigned to (§31).
  if (actor.role === 'staff') {
    filters.programIds = await repository.programIdsForStaff(actor.id);
    if (filters.programIds.length === 0) {
      return { data: [], meta: meta(0, pagination) };
    }
  }

  const { rows, total } = await repository.list({ filters, pagination });
  const stats = await repository.statsFor(rows.map((r) => r.id));
  const data = rows.map((row) =>
    serialize.auditProgram({ ...row, stats: stats.get(row.id) || repository.EMPTY_STATS }),
  );
  return { data, meta: meta(total, pagination) };
}

async function assertVisible(id, actor) {
  const program = await repository.findById(id);
  if (!program) throw notFound(`Audit program ${id} not found`);
  if (actor.role === 'staff') {
    const visible = await repository.programIdsForStaff(actor.id);
    if (!visible.includes(id)) throw forbidden('You are not assigned to this audit program');
  }
  return program;
}

async function getById(id, actor) {
  const program = await assertVisible(id, actor);
  const stats = await repository.statsFor([id]);
  return serialize.auditProgram({ ...program, stats: stats.get(id) || repository.EMPTY_STATS });
}

/** §32 manager dashboard: program counters plus its assignments with session breakdown. */
async function dashboard(id, actor) {
  const program = await assertVisible(id, actor);
  const [stats, assignments] = await Promise.all([
    repository.statsFor([id]),
    assignmentRepository.listForProgramWithStats(id),
  ]);
  return {
    program: serialize.auditProgram({ ...program, stats: stats.get(id) || repository.EMPTY_STATS }),
    assignments,
  };
}

async function create(payload, actor) {
  const created = await repository.create({
    name: payload.name,
    description: payload.description ?? null,
    auditDateFrom: new Date(`${payload.auditDateFrom}T00:00:00Z`),
    auditDateTo: new Date(`${payload.auditDateTo}T00:00:00Z`),
    status: payload.status ?? 'draft',
    createdById: actor.id,
  });
  return serialize.auditProgram({ ...created, stats: repository.EMPTY_STATS });
}

async function update(id, payload, actor) {
  const existing = await repository.findById(id);
  if (!existing) throw notFound(`Audit program ${id} not found`);

  const data = { ...payload };
  if (payload.auditDateFrom) data.auditDateFrom = new Date(`${payload.auditDateFrom}T00:00:00Z`);
  if (payload.auditDateTo) data.auditDateTo = new Date(`${payload.auditDateTo}T00:00:00Z`);

  if (payload.status && payload.status !== existing.status) {
    if (!TRANSITIONS[existing.status].includes(payload.status)) {
      throw conflict(`Cannot change program status from ${existing.status} to ${payload.status}`);
    }
    if (payload.status === 'completed') {
      const open = await assignmentRepository.countOpenSessions(id);
      if (open > 0) {
        throw conflict(`Program still has ${open} audit session(s) not yet approved or rejected`);
      }
    }
  }

  const from = data.auditDateFrom ?? existing.auditDateFrom;
  const to = data.auditDateTo ?? existing.auditDateTo;
  if (to < from) throw conflict('auditDateTo must not be earlier than auditDateFrom');

  const updated = await repository.update(id, data);
  const stats = await repository.statsFor([id]);
  return serialize.auditProgram({ ...updated, stats: stats.get(id) || repository.EMPTY_STATS });
}

module.exports = { list, getById, dashboard, create, update, assertVisible };
