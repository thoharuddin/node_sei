'use strict';

const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { api, prisma, resetDatabase, seedWorld, login, auth } = require('./helpers/fixtures');

let world;

beforeAll(async () => {
  await resetDatabase();
  world = await seedWorld();
});

describe('authentication (Phase 2)', () => {
  test('logs a manager in and returns a JWT carrying the role', async () => {
    const res = await api().post('/api/auth/login').send({ username: 'manager', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ username: 'manager', role: 'manager' });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');

    const payload = jwt.verify(res.body.data.token, config.jwt.secret);
    expect(payload).toMatchObject({ sub: world.users.manager.id, role: 'manager' });
  });

  test('never stores the password in plain text', async () => {
    const user = await prisma.user.findUnique({ where: { username: 'budi' } });
    expect(user.passwordHash).not.toBe('password123');
    expect(user.passwordHash.startsWith('$2')).toBe(true);
  });

  test('rejects a wrong password and an unknown user identically', async () => {
    const wrong = await api().post('/api/auth/login').send({ username: 'budi', password: 'nope-nope' });
    const unknown = await api().post('/api/auth/login').send({ username: 'ghost', password: 'nope-nope' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  test('validates the login payload', async () => {
    const res = await api().post('/api/auth/login').send({ username: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  test('GET /auth/me requires a bearer token and returns the caller', async () => {
    const anonymous = await api().get('/api/auth/me');
    expect(anonymous.status).toBe(401);

    const token = await login('budi');
    const res = await api().get('/api/auth/me').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('budi');
  });

  test('rejects a tampered or expired token', async () => {
    const tampered = jwt.sign({ sub: 1, role: 'manager' }, 'not-the-secret');
    expect((await api().get('/api/auth/me').set(auth(tampered))).status).toBe(401);

    const expired = jwt.sign({ sub: world.users.manager.id, role: 'manager' }, config.jwt.secret, { expiresIn: '-1s' });
    const res = await api().get('/api/auth/me').set(auth(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Token expired');
  });

  test('a deactivated account loses access immediately, before token expiry', async () => {
    const token = await login('candra');
    expect((await api().get('/api/auth/me').set(auth(token))).status).toBe(200);

    await prisma.user.update({ where: { id: world.users.candra.id }, data: { isActive: false } });
    const res = await api().get('/api/auth/me').set(auth(token));
    expect(res.status).toBe(403);

    // and cannot log in again
    const relogin = await api().post('/api/auth/login').send({ username: 'candra', password: 'password123' });
    expect(relogin.status).toBe(403);

    await prisma.user.update({ where: { id: world.users.candra.id }, data: { isActive: true } });
  });
});
