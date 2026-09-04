'use strict';

const { Prisma } = require('@prisma/client');

/** NUMERIC(18,3) columns arrive as Prisma.Decimal — expose plain JSON numbers. */
function toNum(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === 'string') return Number(value);
  if (typeof value === 'bigint') return Number(value);
  return value;
}

function dec(value) {
  return new Prisma.Decimal(value ?? 0);
}

/** Same arithmetic as the generated column audit_session_item.difference. */
function difference(item) {
  return dec(item.countedQuantity).minus(dec(item.systemQuantity)).toNumber();
}

const userPublic = (u) =>
  u && {
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };

const userRef = (u) => u && { id: u.id, username: u.username, name: u.name, role: u.role };

const productRef = (p) => p && { id: p.id, sku: p.sku, name: p.name };

const locationRef = (l) => l && { id: l.id, code: l.code, name: l.name };

const product = (p) => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  isActive: p.isActive,
  createUid: p.createUid,
  writeUid: p.writeUid,
  createdBy: userRef(p.createdBy),
  writtenBy: userRef(p.writtenBy),
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  ...(p.quantity !== undefined ? { quantity: toNum(p.quantity) } : {}),
});

const location = (l) => ({
  id: l.id,
  code: l.code,
  name: l.name,
  parentId: l.parentId,
  parent: l.parent ? locationRef(l.parent) : null,
  isActive: l.isActive,
  createUid: l.createUid,
  writeUid: l.writeUid,
  createdBy: userRef(l.createdBy),
  writtenBy: userRef(l.writtenBy),
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
  ...(l.children ? { children: l.children.map(location) } : {}),
  ...(l.quantity !== undefined ? { quantity: toNum(l.quantity) } : {}),
});

const stockBalance = (b) => ({
  id: b.id,
  productId: b.productId,
  locationId: b.locationId,
  quantity: toNum(b.quantity),
  updatedAt: b.updatedAt,
  product: productRef(b.product),
  location: locationRef(b.location),
});

const stockQuant = (q) => ({
  id: q.id,
  productId: q.productId,
  locationId: q.locationId,
  quantity: toNum(q.quantity),
  movementType: q.movementType,
  referenceType: q.referenceType,
  referenceId: q.referenceId,
  adjustmentId: q.adjustmentId,
  createdById: q.createdById,
  createdBy: userRef(q.createdBy),
  createdAt: q.createdAt,
  product: productRef(q.product),
  location: locationRef(q.location),
});

const auditProgram = (p) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  auditDateFrom: p.auditDateFrom,
  auditDateTo: p.auditDateTo,
  status: p.status,
  createdById: p.createdById,
  createdBy: userRef(p.createdBy),
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  ...(p.stats ? { stats: p.stats } : {}),
});

const auditAssignment = (a) => ({
  id: a.id,
  auditProgramId: a.auditProgramId,
  program: a.program
    ? {
        id: a.program.id,
        name: a.program.name,
        status: a.program.status,
        auditDateFrom: a.program.auditDateFrom,
        auditDateTo: a.program.auditDateTo,
      }
    : undefined,
  assignedUserIds: a.assignedUserIds,
  assignedUsers: a.assignedUsers ? a.assignedUsers.map(userRef) : undefined,
  assignmentType: a.assignmentType,
  productIds: a.productIds,
  products: a.products ? a.products.map(productRef) : undefined,
  locationIds: a.locationIds,
  locations: a.locations ? a.locations.map(locationRef) : undefined,
  status: a.status,
  notes: a.notes,
  createdById: a.createdById,
  createdBy: userRef(a.createdBy),
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  ...(a.sessions ? { sessions: a.sessions.map(auditSession) } : {}),
  ...(a.stats ? { stats: a.stats } : {}),
});

const auditSessionItem = (i) => ({
  id: i.id,
  auditSessionId: i.auditSessionId,
  productId: i.productId,
  locationId: i.locationId,
  product: productRef(i.product),
  location: locationRef(i.location),
  systemQuantity: toNum(i.systemQuantity),
  countedQuantity: toNum(i.countedQuantity),
  // mirrors the generated column audit_session_item.difference
  difference: i.difference !== undefined ? toNum(i.difference) : difference(i),
  note: i.note,
  countedAt: i.countedAt,
  editedById: i.editedById,
  editedBy: userRef(i.editedBy),
  editedAt: i.editedAt,
});

function auditSession(s) {
  return {
    id: s.id,
    auditAssignmentId: s.auditAssignmentId,
    assignment: s.assignment ? auditAssignment(s.assignment) : undefined,
    staffId: s.staffId,
    staff: userRef(s.staff),
    status: s.status,
    startedAt: s.startedAt,
    submittedAt: s.submittedAt,
    approvedAt: s.approvedAt,
    approvedById: s.approvedById,
    approvedBy: userRef(s.approvedBy),
    rejectedAt: s.rejectedAt,
    rejectedById: s.rejectedById,
    rejectedBy: userRef(s.rejectedBy),
    rejectionReason: s.rejectionReason,
    notes: s.notes,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    ...(s.items ? { items: s.items.map(auditSessionItem) } : {}),
    ...(s.adjustment ? { adjustment: stockAdjustment(s.adjustment) } : {}),
    ...(s.stats ? { stats: s.stats } : {}),
  };
}

function stockAdjustment(a) {
  return {
    id: a.id,
    auditSessionId: a.auditSessionId,
    createdById: a.createdById,
    createdBy: userRef(a.createdBy),
    notes: a.notes,
    postingStatus: a.postingStatus,
    postedAt: a.postedAt,
    postingError: a.postingError,
    createdAt: a.createdAt,
    ...(a.quants ? { movements: a.quants.map(stockQuant) } : {}),
    ...(a.session ? { session: auditSession(a.session) } : {}),
  };
}

const itemLog = (l) => ({
  id: l.id,
  auditSessionItemId: l.auditSessionItemId,
  field: l.field,
  oldValue: l.oldValue,
  newValue: l.newValue,
  reason: l.reason,
  changedById: l.changedById,
  changedBy: userRef(l.changedBy),
  changedAt: l.changedAt,
});

module.exports = {
  toNum,
  dec,
  difference,
  userPublic,
  userRef,
  productRef,
  locationRef,
  product,
  location,
  stockBalance,
  stockQuant,
  auditProgram,
  auditAssignment,
  auditSession,
  auditSessionItem,
  stockAdjustment,
  itemLog,
};
