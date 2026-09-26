import './helpers/temp-db';

import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession, hashPassword, verifyPassword } from '../auth';
import { GET as setupStatus, POST as setupMaster } from '@/app/api/setup-master/route';
import type { DB, User } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const OWNER_ID = 'setup-owner';
const OWNER_EMAIL = 'owner@example.test';
const OWNER_PASSWORD = 'owner-password-8';
const MASTER_EMAIL = 'first-master@example.test';
const MASTER_PASSWORD = 'master-password-8';

function request(body?: unknown, token?: string) {
  return new NextRequest('http://localhost:3000/api/setup-master', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function seedUser(role: User['role'] = 'owner') {
  const db: DB = emptyDB();
  db.users.push({
    id: OWNER_ID,
    name: 'Owner de teste',
    email: OWNER_EMAIL,
    passwordHash: hashPassword(OWNER_PASSWORD),
    createdAt: '2026-09-25T12:00:00.000Z',
    role,
    lastLoginAt: '',
  });
  await writeDB(db);
  return createSession(OWNER_ID);
}

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
});

describe('bootstrap do primeiro Master no Preview', () => {
  it('exige autenticação Owner/Admin', async () => {
    const response = await setupMaster(request({
      email: MASTER_EMAIL,
      name: 'Primeiro Master',
      password: MASTER_PASSWORD,
      confirmPassword: MASTER_PASSWORD,
    }));
    expect(response.status).toBe(401);

    const db = await readDB();
    expect(db.users).toHaveLength(0);
  });

  it('cria somente o usuário master e registra auditoria', async () => {
    const token = await seedUser('owner');
    const response = await setupMaster(request({
      email: MASTER_EMAIL,
      name: 'Primeiro Master',
      password: MASTER_PASSWORD,
      confirmPassword: MASTER_PASSWORD,
    }, token));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, email: MASTER_EMAIL });
    expect(JSON.stringify(body)).not.toContain(MASTER_PASSWORD);

    const db = await readDB();
    const master = db.users.find((user) => user.email === MASTER_EMAIL)!;
    expect(master.role).toBe('master');
    expect(master.passwordHash).not.toContain(MASTER_PASSWORD);
    expect(verifyPassword(MASTER_PASSWORD, master.passwordHash)).toBe(true);
    expect(master).not.toHaveProperty('organizationId');
    expect(master).not.toHaveProperty('businessId');
    expect(db.organizations).toHaveLength(0);
    expect(db.businesses).toHaveLength(0);
    expect(db.members).toHaveLength(0);
    expect(db.organizationMembers).toHaveLength(0);
    expect(db.sessions.filter((session) => session.userId === master.id)).toHaveLength(0);

    const audit = db.audit[db.audit.length - 1];
    expect(audit.action).toBe('master.created');
    expect(audit.meta).toMatchObject({ via: 'setup-master', userId: master.id, email: MASTER_EMAIL });
    expect(JSON.stringify(audit)).not.toContain(MASTER_PASSWORD);
  });

  it('permite Admin e mantém a política mínima de oito caracteres', async () => {
    const token = await seedUser('admin');
    const response = await setupMaster(request({
      email: MASTER_EMAIL,
      name: 'Primeiro Master',
      password: '1234567',
      confirmPassword: '1234567',
    }, token));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('8');
  });

  it('autobloqueia GET e POST depois do primeiro Master, inclusive em corrida', async () => {
    const token = await seedUser('owner');
    const payload = {
      email: MASTER_EMAIL,
      name: 'Primeiro Master',
      password: MASTER_PASSWORD,
      confirmPassword: MASTER_PASSWORD,
    };
    const concurrent = await Promise.all([
      setupMaster(request(payload, token)),
      setupMaster(request({
        email: 'second-master@example.test',
        name: 'Segundo Master',
        password: MASTER_PASSWORD,
        confirmPassword: MASTER_PASSWORD,
      }, token)),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 410]);

    const status = await setupStatus(request(undefined, token));
    expect(status.status).toBe(410);
    expect((await setupMaster(request({
      email: 'third-master@example.test',
      name: 'Terceiro Master',
      password: MASTER_PASSWORD,
      confirmPassword: MASTER_PASSWORD,
    }, token))).status).toBe(410);

    expect((await readDB()).users.filter((user) => user.role === 'master')).toHaveLength(1);
  });

  it('recusa usuário autenticado que não é Owner/Admin', async () => {
    const token = await seedUser('master');
    const response = await setupStatus(request(undefined, token));
    expect(response.status).toBe(403);
  });
});
