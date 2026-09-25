import './helpers/temp-db';

import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { hashPassword } from '../auth';
import { POST as login } from '@/app/api/auth/login/route';
import type { DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const EMAIL = 'master@godoutor.com.br';
const PASSWORD = 'master-login-test-password';

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  const db: DB = emptyDB();
  db.users.push({
    id: 'master-login', name: 'Master GoDoutor', email: EMAIL,
    passwordHash: hashPassword(PASSWORD), createdAt: '2026-09-25T12:00:00.000Z', role: 'master', lastLoginAt: '',
  });
  await writeDB(db);
});

describe('login do primeiro Master', () => {
  it('redireciona role=master para /master sem criar contexto de tenant', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const res = await login(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, redirectTo: '/master', isMaster: true });
    expect(body.token).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(PASSWORD);

    const db = await readDB();
    expect(db.users[0].role).toBe('master');
    expect(db.businesses).toHaveLength(0);
    expect(db.organizations).toHaveLength(0);
    expect(db.members).toHaveLength(0);
    expect(db.organizationMembers).toHaveLength(0);
  });
});
