'use strict';

const { api, resetDatabase, seedWorld, login, auth, createAssignment } = require('./helpers/fixtures');

let world;
let manager;
let budi;
let andi;

beforeAll(async () => {
  await resetDatabase();
  world = await seedWorld();
  [manager, budi, andi] = await Promise.all([login('manager'), login('budi'), login('andi')]);
});

describe('role authorization (Phase 2 / §31 / §34)', () => {
  const managerOnlyWrites = () => [
    ['post', '/api/products', { sku: 'X1', name: 'X' }],
    ['put', `/api/products/${world.products.SKU001.id}`, { name: 'renamed' }],
    ['delete', `/api/products/${world.products.SKU001.id}`, undefined],
    ['post', '/api/locations', { code: 'X1', name: 'X' }],
    ['put', `/api/locations/${world.locations['RACK-A'].id}`, { name: 'renamed' }],
    ['post', '/api/users', { username: 'hacker', password: 'password123', name: 'H', email: 'h@e.com', role: 'staff' }],
    ['get', '/api/users', undefined],
    ['post', '/api/audit-programs', { name: 'P', auditDateFrom: '2026-09-01', auditDateTo: '2026-09-02' }],
    ['post', '/api/stock/movements', { movementType: 'receipt', lines: [{ productId: 1, locationId: 3, quantity: 1 }] }],
    ['post', '/api/stock/transfers', { productId: 1, fromLocationId: 3, toLocationId: 4, quantity: 1 }],
    ['get', '/api/stock-adjustments', undefined],
  ];

  test('staff cannot manage products, locations, users, programs or stock', async () => {
    for (const [method, path, body] of managerOnlyWrites()) {
      const res = await api()[method](path).set(auth(budi)).send(body);
      expect([403]).toContain(res.status);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  test('staff may read products, locations and stock', async () => {
    for (const path of ['/api/products', '/api/locations', '/api/stock', '/api/stock/movements']) {
      expect((await api().get(path).set(auth(budi))).status).toBe(200);
    }
  });

  test('every protected endpoint refuses an anonymous caller', async () => {
    for (const path of ['/api/products', '/api/locations', '/api/stock', '/api/users', '/api/audit-programs', '/api/audit-sessions']) {
      expect((await api().get(path)).status).toBe(401);
    }
  });

  test('staff cannot create assignments and cannot start another staff member\'s assignment', async () => {
    const { programId, assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id],
    });

    const created = await api()
      .post(`/api/audit-programs/${programId}/assignments`)
      .set(auth(budi))
      .send({ assignedUserIds: [world.users.budi.id], assignmentType: 'location', locationIds: [world.locations['RACK-B'].id] });
    expect(created.status).toBe(403);

    // andi is not on this assignment
    const start = await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(andi));
    expect(start.status).toBe(403);

    // ... and cannot even read it
    expect((await api().get(`/api/audit-assignments/${assignmentId}`).set(auth(andi))).status).toBe(403);
  });

  test('a manager cannot start or submit a session (those are staff actions)', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id],
    });
    expect((await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(manager))).status).toBe(403);

    const session = await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi));
    expect(session.status).toBe(201);
    expect((await api().post(`/api/audit-sessions/${session.body.data.id}/submit`).set(auth(manager))).status).toBe(403);
  });

  test('staff cannot approve, reject, reopen or compare sessions', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-B'].id],
      staffIds: [world.users.budi.id],
    });
    const session = (await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi))).body.data;
    await api().post(`/api/audit-sessions/${session.id}/submit`).set(auth(budi));

    for (const path of [`/api/audit-sessions/${session.id}/approve`, `/api/audit-sessions/${session.id}/reject`, `/api/audit-sessions/${session.id}/reopen`]) {
      const res = await api().post(path).set(auth(budi)).send({ reason: 'because' });
      expect(res.status).toBe(403);
    }
    expect((await api().get(`/api/audit-assignments/${assignmentId}/comparison`).set(auth(budi))).status).toBe(403);
  });

  test('staff cannot see another staff member\'s session or items', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id, world.users.andi.id],
    });
    const budiSession = (await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi))).body.data;

    expect((await api().get(`/api/audit-sessions/${budiSession.id}`).set(auth(andi))).status).toBe(403);
    expect((await api().get(`/api/audit-sessions/${budiSession.id}/items`).set(auth(andi))).status).toBe(403);

    const item = budiSession.items[0];
    expect((await api().put(`/api/audit-session-items/${item.id}`).set(auth(andi)).send({ countedQuantity: 1 })).status).toBe(403);

    // the session list is scoped to the caller
    const list = await api().get('/api/audit-sessions').set(auth(andi));
    expect(list.body.data.every((s) => s.staffId === world.users.andi.id)).toBe(true);
  });
});
