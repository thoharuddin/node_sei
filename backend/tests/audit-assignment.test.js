'use strict';

const { api, prisma, resetDatabase, seedWorld, login, auth, createAssignment } = require('./helpers/fixtures');

let world;
let manager;
let budi;

beforeEach(async () => {
  await resetDatabase();
  world = await seedWorld();
  [manager, budi] = await Promise.all([login('manager'), login('budi')]);
});

describe('audit programs and assignments (Phase 5)', () => {
  test('a program starts as draft and becomes in_progress once it has an assignment', async () => {
    const program = await api()
      .post('/api/audit-programs')
      .set(auth(manager))
      .send({ name: 'Stock Opname September 2026', description: 'Monthly count', auditDateFrom: '2026-09-01', auditDateTo: '2026-09-03' });
    expect(program.status).toBe(201);
    expect(program.body.data.status).toBe('draft');

    await createAssignment({
      managerToken: manager,
      programId: program.body.data.id,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id],
    });

    const reloaded = await api().get(`/api/audit-programs/${program.body.data.id}`).set(auth(manager));
    expect(reloaded.body.data.status).toBe('in_progress');
  });

  test('rejects an invalid audit date range', async () => {
    const res = await api()
      .post('/api/audit-programs')
      .set(auth(manager))
      .send({ name: 'Backwards', auditDateFrom: '2026-09-10', auditDateTo: '2026-09-01' });
    expect(res.status).toBe(400);
  });

  test('a product assignment must not carry location ids and vice versa (§10)', async () => {
    const program = (
      await api().post('/api/audit-programs').set(auth(manager)).send({ name: 'P', auditDateFrom: '2026-09-01', auditDateTo: '2026-09-30' })
    ).body.data;

    const mixed = await api()
      .post(`/api/audit-programs/${program.id}/assignments`)
      .set(auth(manager))
      .send({
        assignedUserIds: [world.users.budi.id],
        assignmentType: 'product',
        productIds: [world.products.SKU001.id],
        locationIds: [world.locations['RACK-A'].id],
      });
    expect(mixed.status).toBe(400);

    const empty = await api()
      .post(`/api/audit-programs/${program.id}/assignments`)
      .set(auth(manager))
      .send({ assignedUserIds: [world.users.budi.id], assignmentType: 'location', locationIds: [] });
    expect(empty.status).toBe(400);
  });

  test('the database CHECK constraint enforces the same scope rule as the API', async () => {
    const program = await prisma.auditProgram.create({
      data: { name: 'P', auditDateFrom: new Date('2026-09-01'), auditDateTo: new Date('2026-09-30'), createdById: world.users.manager.id },
    });
    await expect(
      prisma.auditAssignment.create({
        data: {
          auditProgramId: program.id,
          assignedUserIds: [world.users.budi.id],
          assignmentType: 'product',
          productIds: [world.products.SKU001.id],
          locationIds: [world.locations['RACK-A'].id],
          createdById: world.users.manager.id,
        },
      }),
    ).rejects.toThrow(/audit_assignment_type_scope/);
  });

  test('assigned_user_ids must reference active staff (trigger-enforced)', async () => {
    const asManager = await api()
      .post(`/api/audit-programs/${(await api().post('/api/audit-programs').set(auth(manager)).send({ name: 'P2', auditDateFrom: '2026-09-01', auditDateTo: '2026-09-30' })).body.data.id}/assignments`)
      .set(auth(manager))
      .send({ assignedUserIds: [world.users.manager.id], assignmentType: 'location', locationIds: [world.locations['RACK-A'].id] });
    expect(asManager.status).toBe(422);
  });

  test('one assignment can carry several staff members and several targets (§32)', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'product',
      targets: [world.products.SKU001.id, world.products.SKU002.id],
      staffIds: [world.users.budi.id, world.users.andi.id],
    });
    const res = await api().get(`/api/audit-assignments/${assignmentId}`).set(auth(manager));
    expect(res.body.data.assignedUsers.map((u) => u.username).sort()).toEqual(['andi', 'budi']);
    expect(res.body.data.products.map((p) => p.sku).sort()).toEqual(['SKU001', 'SKU002']);
    expect(res.body.data.locationIds).toEqual([]);
  });

  test('staff see only their own assignments in /audit-assignments/my (§18)', async () => {
    await createAssignment({ managerToken: manager, type: 'location', targets: [world.locations['RACK-A'].id], staffIds: [world.users.budi.id] });
    await createAssignment({ managerToken: manager, type: 'location', targets: [world.locations['RACK-B'].id], staffIds: [world.users.andi.id] });

    const mine = await api().get('/api/audit-assignments/my').set(auth(budi));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].locations[0].code).toBe('RACK-A');
    expect(mine.body.data[0].mySessions).toEqual([]);
  });

  test('the scope of an assignment freezes once a session exists', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id],
    });

    const ok = await api()
      .put(`/api/audit-assignments/${assignmentId}`)
      .set(auth(manager))
      .send({ locationIds: [world.locations['RACK-B'].id] });
    expect(ok.status).toBe(200);

    await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi));

    const frozen = await api()
      .put(`/api/audit-assignments/${assignmentId}`)
      .set(auth(manager))
      .send({ locationIds: [world.locations['RACK-C'].id] });
    expect(frozen.status).toBe(409);
  });

  test('a staff member who already counted cannot be removed from the assignment', async () => {
    const { assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id, world.users.andi.id],
    });
    await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi));

    const res = await api()
      .put(`/api/audit-assignments/${assignmentId}`)
      .set(auth(manager))
      .send({ assignedUserIds: [world.users.andi.id] });
    expect(res.status).toBe(409);
  });

  test('the program dashboard aggregates assignments and sessions (§32)', async () => {
    const { programId, assignmentId } = await createAssignment({
      managerToken: manager,
      type: 'location',
      targets: [world.locations['RACK-A'].id],
      staffIds: [world.users.budi.id, world.users.andi.id],
    });
    const session = (await api().post(`/api/audit-assignments/${assignmentId}/start`).set(auth(budi))).body.data;
    await api().post(`/api/audit-sessions/${session.id}/submit`).set(auth(budi));

    const res = await api().get(`/api/audit-programs/${programId}/dashboard`).set(auth(manager));
    expect(res.body.data.program.stats).toMatchObject({ assignments: 1, sessions: 1, submitted: 1, approved: 0, pendingReview: 1 });
    expect(res.body.data.assignments[0].status).toBe('done');
  });
});
