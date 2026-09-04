'use strict';

process.env.NODE_ENV = 'test';

const bcrypt = require('bcryptjs');
const request = require('supertest');

const config = require('../../src/config');
const { prisma, Prisma } = require('../../src/database/prisma');
const { createApp } = require('../../src/app');
const stockRepository = require('../../src/modules/stock/stock.repository');

const app = createApp();
const api = () => request(app);

const TABLES = [
  'audit_session_item_log',
  'stock_quant',
  'stock_adjustment',
  'audit_session_item',
  'audit_session',
  'audit_assignment',
  'audit_program',
  'stock_balance',
  'products',
  'locations',
  'users',
];

async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/**
 * Baseline world used by most tests:
 *   users     : manager + 3 staff (password123)
 *   locations : WH -> WH-STOCK -> RACK-A / RACK-B / RACK-C
 *   products  : SKU001..SKU005
 *   stock     : SKU001 100 / SKU002 50 / SKU003 20 in Rack A, SKU001 40 + SKU004 10 in Rack B
 */
async function seedWorld() {
  const hash = await bcrypt.hash('password123', config.bcryptRounds);

  const users = {};
  for (const [key, role, name] of [
    ['manager', 'manager', 'Sari Manager'],
    ['budi', 'staff', 'Budi Santoso'],
    ['andi', 'staff', 'Andi Wijaya'],
    ['candra', 'staff', 'Candra Putra'],
  ]) {
    users[key] = await prisma.user.create({
      data: { username: key, passwordHash: hash, name, email: `${key}@example.com`, role },
    });
  }

  const locations = {};
  locations.WH = await prisma.location.create({
    data: { code: 'WH', name: 'Warehouse', createUid: users.manager.id },
  });
  locations['WH-STOCK'] = await prisma.location.create({
    data: { code: 'WH-STOCK', name: 'Stock', parentId: locations.WH.id, createUid: users.manager.id },
  });
  for (const code of ['RACK-A', 'RACK-B', 'RACK-C']) {
    locations[code] = await prisma.location.create({
      data: { code, name: code.replace('-', ' '), parentId: locations['WH-STOCK'].id, createUid: users.manager.id },
    });
  }

  const products = {};
  for (let i = 1; i <= 5; i += 1) {
    const sku = `SKU00${i}`;
    products[sku] = await prisma.product.create({
      data: { sku, name: `Product ${i}`, createUid: users.manager.id },
    });
  }

  const opening = [
    ['SKU001', 'RACK-A', 100],
    ['SKU002', 'RACK-A', 50],
    ['SKU003', 'RACK-A', 20],
    ['SKU001', 'RACK-B', 40],
    ['SKU004', 'RACK-B', 10],
  ];
  await prisma.$transaction(async (tx) =>
    stockRepository.postMovements(tx, {
      actorId: users.manager.id,
      movements: opening.map(([sku, code, quantity]) => ({
        productId: products[sku].id,
        locationId: locations[code].id,
        quantity,
        movementType: 'opening',
        referenceType: 'test_fixture',
      })),
    }),
  );

  return { users, locations, products };
}

async function login(username, password = 'password123') {
  const res = await api().post('/api/auth/login').send({ username, password });
  if (!res.body?.data?.token) {
    throw new Error(`login failed for ${username}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.token;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Current stock of one product/location straight from the cache table. */
async function balanceOf(productId, locationId) {
  const row = await prisma.stockBalance.findUnique({
    where: { productId_locationId: { productId, locationId } },
  });
  return row ? Number(row.quantity) : 0;
}

/** §28: stock_balance must always equal SUM(stock_quant). */
async function ledgerDrift() {
  return prisma.$queryRaw`
    SELECT product_id, location_id, drift FROM stock_balance_consistency WHERE drift <> 0
  `;
}

/** Creates a program (unless one is given) plus an assignment. */
async function createAssignment({ managerToken, type, targets, staffIds, programId }) {
  let program = programId;
  if (!program) {
    const res = await api()
      .post('/api/audit-programs')
      .set(auth(managerToken))
      .send({ name: 'Test Opname', auditDateFrom: '2026-09-01', auditDateTo: '2026-09-30' });
    program = res.body.data.id;
  }
  const res = await api()
    .post(`/api/audit-programs/${program}/assignments`)
    .set(auth(managerToken))
    .send({
      assignedUserIds: staffIds,
      assignmentType: type,
      ...(type === 'product' ? { productIds: targets } : { locationIds: targets }),
    });
  if (!res.body?.data?.id) throw new Error(`assignment failed: ${JSON.stringify(res.body)}`);
  return { programId: program, assignmentId: res.body.data.id };
}

/** Starts nothing; counts an existing session from a { SKU001: 98 } mapping and submits it. */
async function countAndSubmit({ token, sessionId, counts, submit = true }) {
  const items = (await api().get(`/api/audit-sessions/${sessionId}/items`).set(auth(token))).body.data;
  const patch = items
    .filter((i) => counts[i.product.sku] !== undefined)
    .map((i) => ({ id: i.id, countedQuantity: counts[i.product.sku] }));
  if (patch.length) {
    await api().put(`/api/audit-sessions/${sessionId}/items`).set(auth(token)).send({ items: patch });
  }
  if (submit) await api().post(`/api/audit-sessions/${sessionId}/submit`).set(auth(token));
  return items;
}

module.exports = {
  app,
  api,
  prisma,
  Prisma,
  resetDatabase,
  seedWorld,
  login,
  auth,
  balanceOf,
  ledgerDrift,
  createAssignment,
  countAndSubmit,
};
