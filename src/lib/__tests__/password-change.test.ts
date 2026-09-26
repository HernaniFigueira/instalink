import './helpers/temp-db';

import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession, hashPassword, verifyPassword } from '../auth';
import { POST as changePassword } from '@/app/api/auth/password/route';
import type { DB, User } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const USER_ID = 'password-user';
const EMAIL = 'password-user@example.test';
const CURRENT = 'current-password-8';
const NEXT = 'new-password-8';
const NOW = '2026-09-25T12:00:00.000Z';

function request(body: unknown, token?: string) {
  return new NextRequest('http://localhost:3000/api/auth/password', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  const db: DB = emptyDB();
  const user: User = {
    id: USER_ID, name: 'Conta de teste', email: EMAIL, passwordHash: hashPassword(CURRENT),
    createdAt: NOW, role: 'owner', lastLoginAt: '',
  };
  db.users.push(user);
  await writeDB(db);
});

describe('alteração de senha da conta autenticada', () => {
  it('exige sessão e não revela dados da senha', async () => {
    const res = await changePassword(request({ currentPassword: CURRENT, newPassword: NEXT, confirmPassword: NEXT }));
    expect(res.status).toBe(401);
  });

  it('recusa senha atual incorreta com mensagem simples', async () => {
    const token = await createSession(USER_ID);
    const res = await changePassword(request({ currentPassword: 'wrong-current', newPassword: NEXT, confirmPassword: NEXT }, token));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'Senha atual incorreta' });
  });

  it('recusa confirmação divergente e mantém o hash anterior', async () => {
    const token = await createSession(USER_ID);
    const before = (await readDB()).users[0].passwordHash;
    const res = await changePassword(request({ currentPassword: CURRENT, newPassword: NEXT, confirmPassword: 'different-password' }, token));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'As senhas não coincidem' });
    expect((await readDB()).users[0].passwordHash).toBe(before);
  });

  it('salva somente hash scrypt, preserva a sessão atual e invalida as outras', async () => {
    const currentSession = await createSession(USER_ID);
    const otherSession = await createSession(USER_ID);
    const res = await changePassword(request({ currentPassword: CURRENT, newPassword: NEXT, confirmPassword: NEXT }, currentSession));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, message: 'Senha alterada com sucesso' });

    const db = await readDB();
    const user = db.users.find((item) => item.id === USER_ID)!;
    expect(user.role).toBe('owner');
    expect(user.passwordHash).not.toContain(NEXT);
    expect(verifyPassword(NEXT, user.passwordHash)).toBe(true);
    expect(db.sessions.map((session) => session.id)).toEqual([currentSession]);
    const audit = db.audit[db.audit.length - 1];
    expect(audit.action).toBe('user.password_changed');
    expect(JSON.stringify(audit)).not.toContain(CURRENT);
    expect(JSON.stringify(audit)).not.toContain(NEXT);
    expect(JSON.stringify(db)).not.toContain(NEXT);
    expect(otherSession).not.toBe(currentSession);
  });

  it('não reduz a política mínima de oito caracteres', async () => {
    const token = await createSession(USER_ID);
    const res = await changePassword(request({ currentPassword: CURRENT, newPassword: '1234567', confirmPassword: '1234567' }, token));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('8');
  });
});
