// ═══════════════════════════════════════════════════════════════
// AUTH/SESSÕES/PERMISSÕES no MODO RELACIONAL — consultas específicas.
// ═══════════════════════════════════════════════════════════════
// PRESERVADO: cookie il_session/il_cust_session/il_support, formato do hash
// scrypt (`scrypt:salt:hash`), TTLs, papéis/permissões de access-core
// (resolveAccess continua sendo A porta única — aqui só alimentamos o núcleo
// com as linhas certas do SQL, nunca o documento inteiro).
// ELIMINADO no modo relacional: qualquer leitura do documento legado para
// autenticar (usuário, sessão, membro, vínculo de profissional, suporte).
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { getPool } from './pool';
import type { DB, SupportSession, User } from '../types';
import { resolveAccess, type AccessContext } from '../access-core';
import { rowToBusiness } from './business-row';

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : '');
const s = (v: unknown): string => String(v ?? '');

// ── Linha → domínio ──
export function rowToUser(r: any): User {
  return {
    id: s(r.id), name: s(r.name), email: s(r.email),
    passwordHash: s(r.password_hash), role: (s(r.role) || 'owner') as User['role'],
    ...(r.active === false ? { active: false } : {}),
    ...(r.last_login_at ? { lastLoginAt: iso(r.last_login_at) } : {}),
    createdAt: iso(r.created_at),
  } as User;
}

// ── Sessões de lojista ──
export async function relUserBySession(sessionId: string | undefined): Promise<User | null> {
  if (!sessionId) return null;
  const pool = getPool();
  const r = await pool.query(
    `SELECT u.* FROM app.sessions se JOIN app.users u ON u.id = se.user_id
      WHERE se.id = $1 AND se.expires_at > now()`,
    [sessionId],
  );
  return r.rows[0] ? rowToUser(r.rows[0]) : null;
}

export async function relUserByEmail(email: string): Promise<User | null> {
  const pool = getPool();
  const r = await pool.query('SELECT * FROM app.users WHERE lower(email) = lower($1)', [email]);
  return r.rows[0] ? rowToUser(r.rows[0]) : null;
}

export async function relUserById(id: string): Promise<User | null> {
  const pool = getPool();
  const r = await pool.query('SELECT * FROM app.users WHERE id = $1', [id]);
  return r.rows[0] ? rowToUser(r.rows[0]) : null;
}

export const SESSION_DAYS = 30;

export async function relCreateSession(userId: string): Promise<string> {
  const id = randomUUID();
  const pool = getPool();
  await pool.query(
    `INSERT INTO app.sessions (id, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [id, userId, String(SESSION_DAYS)],
  );
  return id;
}

export async function relDestroySession(sessionId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM app.sessions WHERE id = $1', [sessionId]);
}

/** Auditoria pontual (mesma forma do pushAudit do documento). */
export async function relAudit(entry: {
  action: string; businessId?: string; supportSessionId?: string;
  actor?: Partial<Pick<User, 'id' | 'email' | 'role'>> | null; meta?: Record<string, unknown>;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO app.audit (id, at, action, actor_user_id, actor_email, actor_role,
                            business_id, support_session_id, meta)
     VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(), entry.action,
      entry.actor?.id || '', entry.actor?.email || '', entry.actor?.role || '',
      entry.businessId || '', entry.supportSessionId || '',
      JSON.stringify(entry.meta ?? {}),
    ],
  );
}

/** Login bem-sucedido: último acesso + trilha de auditoria (idempotente por sessão). */
export async function relTouchLogin(user: User): Promise<void> {
  const pool = getPool();
  await pool.query('UPDATE app.users SET last_login_at = now() WHERE id = $1', [user.id]);
  await relAudit({ action: 'user.login', actor: { id: user.id, email: user.email, role: user.role || 'owner' }, meta: { via: 'password' } });
}

export async function relCreateUser(input: {
  name: string; email: string; passwordHash: string; role?: 'owner' | 'admin' | 'master';
}): Promise<User> {
  const pool = getPool();
  const id = randomUUID();
  try {
    const r = await pool.query(
      `INSERT INTO app.users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, input.name, input.email.trim().toLowerCase(), input.passwordHash, input.role || 'owner'],
    );
    return rowToUser(r.rows[0]);
  } catch (e: any) {
    if (e?.code === '23505') throw Object.assign(new Error('Este e-mail já está cadastrado. Tente entrar.'), { code: 'email_taken' });
    throw e;
  }
}

// ── Redefinição de senha (app.forgot/reset) ──
export async function relCreatePasswordReset(kind: 'user' | 'customer', accountId: string, tokenHash: string, ttlMs: number): Promise<void> {
  const pool = getPool();
  // Um pedido novo invalida os anteriores da conta.
  await pool.query('UPDATE app.password_resets SET used_at = now() WHERE kind = $1 AND account_id = $2 AND used_at IS NULL', [kind, accountId]);
  await pool.query(
    `INSERT INTO app.password_resets (id, kind, account_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)`,
    [randomUUID(), kind, accountId, tokenHash, String(ttlMs)],
  );
}

export async function relFindPasswordReset(tokenHash: string): Promise<{ id: string; kind: string; accountId: string } | null> {
  const pool = getPool();
  const r = await pool.query(
    `SELECT id, kind, account_id FROM app.password_resets
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  return r.rows[0] ? { id: s(r.rows[0].id), kind: s(r.rows[0].kind), accountId: s(r.rows[0].account_id) } : null;
}

export async function relConsumePasswordReset(resetId: string, newPasswordHash: string): Promise<void> {
  const pool = getPool();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('UPDATE app.password_resets SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING kind, account_id', [resetId]);
    if (!r.rows[0]) throw new Error('Pedido de redefinição já utilizado.');
    const { kind, account_id } = r.rows[0];
    if (kind === 'user') {
      await client.query('UPDATE app.users SET password_hash = $2 WHERE id = $1', [account_id, newPasswordHash]);
      await client.query('DELETE FROM app.sessions WHERE user_id = $1', [account_id]);
    } else {
      await client.query('UPDATE app.customers SET password_hash = $2 WHERE id = $1', [account_id, newPasswordHash]);
      await client.query('DELETE FROM app.customer_sessions WHERE customer_id = $1', [account_id]);
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
}

// ── Sessão de SUPORTE (master) ──
export function rowToSupport(r: any): SupportSession {
  return {
    id: s(r.id), masterUserId: s(r.master_user_id), masterEmail: s(r.master_email),
    businessId: s(r.business_id), mode: (s(r.mode) || 'view') as SupportSession['mode'],
    reason: s(r.reason), createdAt: iso(r.created_at), expiresAt: iso(r.expires_at),
    endedAt: r.ended_at ? iso(r.ended_at) : '',
  };
}

export async function relSupportById(id: string): Promise<SupportSession | null> {
  if (!id) return null;
  const pool = getPool();
  const r = await pool.query('SELECT * FROM app.support_sessions WHERE id = $1', [id]);
  if (!r.rows[0]) return null;
  const support = rowToSupport(r.rows[0]);
  if (support.endedAt) return null;
  if (new Date(support.expiresAt).getTime() < Date.now()) return null;
  return support;
}

export async function relSupportStart(input: {
  masterUserId: string; masterEmail: string; businessId: string;
  mode: 'view' | 'admin'; reason: string; expiresAt: string;
}): Promise<SupportSession> {
  const pool = getPool();
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE app.support_sessions SET ended_at = now() WHERE master_user_id = $1 AND ended_at IS NULL', [input.masterUserId]);
    await client.query(
      `INSERT INTO app.support_sessions (id, master_user_id, master_email, business_id, mode, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, input.masterUserId, input.masterEmail, input.businessId, input.mode, input.reason, input.expiresAt],
    );
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* */ }
    throw e;
  } finally {
    client.release();
  }
  return {
    id, masterUserId: input.masterUserId, masterEmail: input.masterEmail,
    businessId: input.businessId, mode: input.mode, reason: input.reason,
    createdAt: new Date().toISOString(), expiresAt: input.expiresAt, endedAt: '',
  };
}

export async function relSupportEnd(id: string, masterUserId: string): Promise<boolean> {
  const pool = getPool();
  const r = await pool.query(
    'UPDATE app.support_sessions SET ended_at = now() WHERE id = $1 AND master_user_id = $2 AND ended_at IS NULL',
    [id, masterUserId],
  );
  return (r.rowCount || 0) > 0;
}

// ── Contexto de acesso — o NÚCLEO resolveAccess continua sendo a regra ──
// Consultas pontuais: negócio, membership (usuário × unidade), papel na
// organização e vínculo de profissional. Nada de documento global.
export async function relResolveAccess(
  user: User,
  businessId: string,
  support: SupportSession | null,
): Promise<AccessContext | null> {
  const pool = getPool();
  const biz = await pool.query('SELECT * FROM app.businesses WHERE id = $1', [businessId]);
  if (!biz.rows[0]) return null;
  const db = {} as any;
  // O ctx.business vai para as rotas: mapeamos a linha completa pelo MESMO
  // mapper do slice (uma só fonte, sem drift).
  db.businesses = [rowToBusiness(biz.rows[0])];
  const members = await pool.query(
    'SELECT * FROM app.members WHERE business_id = $1 AND user_id = $2 AND active = true',
    [businessId, user.id],
  );
  db.members = members.rows.map((m: any) => ({
    id: s(m.id), businessId: s(m.business_id), userId: s(m.user_id),
    role: s(m.role), permissions: typeof m.permissions === 'object' ? m.permissions : JSON.parse(m.permissions || '{}'),
    active: m.active !== false, note: s(m.note), invitedBy: s(m.invited_by),
    createdAt: iso(m.created_at), updatedAt: iso(m.updated_at),
  }));
  const bizOrgId = s(biz.rows[0].organization_id);
  if (bizOrgId) {
    const orgs = await pool.query('SELECT * FROM app.organizations WHERE id = $1', [bizOrgId]);
    db.organizations = orgs.rows.map((o: any) => ({
      id: s(o.id), name: s(o.name), ownerId: s(o.owner_id),
      metadata: typeof o.metadata === 'object' ? o.metadata : JSON.parse(o.metadata || '{}'),
      publicBusinessId: s(o.public_business_id), createdAt: iso(o.created_at), updatedAt: iso(o.updated_at),
    }));
    const om = await pool.query(
      'SELECT * FROM app.organization_members WHERE organization_id = $1 AND user_id = $2 AND active = true',
      [bizOrgId, user.id],
    );
    db.organizationMembers = om.rows.map((m: any) => ({
      id: s(m.id), organizationId: s(m.organization_id), userId: s(m.user_id),
      role: s(m.role), active: m.active !== false, createdAt: iso(m.created_at), updatedAt: iso(m.updated_at),
    }));
  }
  const pros = await pool.query(
    'SELECT * FROM app.professionals WHERE business_id = $1 AND user_id = $2 AND active = true',
    [businessId, user.id],
  );
  db.professionals = pros.rows.map((p: any) => ({
    id: s(p.id), businessId: s(p.business_id), name: s(p.name), role: s(p.role),
    photo: s(p.photo), active: p.active !== false, userId: s(p.user_id),
    followBusinessHours: p.follow_business_hours !== false,
  }));
  return resolveAccess(db as DB, user, businessId, support);
}

/**
 * Documento mínimo ( só o que o USUÁRIO alcança ) para /api/auth/me:
 * unidades próprias + onde é membro + unidades das organizações que governa,
 * páginas dessas unidades e vínculos de profissional.
 */
export async function relAccessibleDoc(user: User, support: SupportSession | null): Promise<DB> {
  const pool = getPool();
  const db = { businesses: [], members: [], organizations: [], organizationMembers: [], pages: [], professionals: [] } as any;
  if (support) {
    // Master em suporte: somente a unidade alvo.
    const b = await pool.query('SELECT * FROM app.businesses WHERE id = $1', [support.businessId]);
    db.businesses = b.rows.map((r: any) => rowToBusiness(r));
    return db as DB;
  }
  const memberRows = await pool.query('SELECT * FROM app.members WHERE user_id = $1 AND active = true', [user.id]);
  db.members = memberRows.rows.map((m: any) => ({
    id: s(m.id), businessId: s(m.business_id), userId: s(m.user_id), role: s(m.role),
    permissions: typeof m.permissions === 'object' ? m.permissions : JSON.parse(m.permissions || '{}'),
    active: m.active !== false, note: s(m.note), invitedBy: s(m.invited_by),
    createdAt: iso(m.created_at), updatedAt: iso(m.updated_at),
  }));
  const memberIds = db.members.map((m: any) => m.businessId);
  const owned = await pool.query('SELECT * FROM app.businesses WHERE owner_id = $1', [user.id]);
  const byMember = memberIds.length
    ? await pool.query('SELECT * FROM app.businesses WHERE id = ANY($1)', [memberIds])
    : { rows: [] };
  const orgRows = await pool.query(
    `SELECT * FROM app.organizations WHERE owner_id = $1
        OR id IN (SELECT organization_id FROM app.organization_members WHERE user_id = $1 AND active = true AND role IN ('OWNER','ADMIN'))`,
    [user.id],
  );
  const orgIds = orgRows.rows.map((o: any) => s(o.id));
  const byOrg = orgIds.length
    ? await pool.query('SELECT * FROM app.businesses WHERE organization_id = ANY($1) AND owner_id <> $2', [orgIds, user.id])
    : { rows: [] };
  const bizById = new Map<string, any>();
  for (const r of [...owned.rows, ...byMember.rows, ...byOrg.rows]) bizById.set(s(r.id), r);
  db.businesses = [...bizById.values()].map((r: any) => rowToBusiness(r));
  db.organizations = orgRows.rows.map((o: any) => ({
    id: s(o.id), name: s(o.name), ownerId: s(o.owner_id),
    metadata: typeof o.metadata === 'object' ? o.metadata : JSON.parse(o.metadata || '{}'),
    publicBusinessId: s(o.public_business_id), createdAt: iso(o.created_at), updatedAt: iso(o.updated_at),
  }));
  const omRows = await pool.query('SELECT * FROM app.organization_members WHERE user_id = $1 AND active = true', [user.id]);
  db.organizationMembers = omRows.rows.map((m: any) => ({
    id: s(m.id), organizationId: s(m.organization_id), userId: s(m.user_id),
    role: s(m.role), active: m.active !== false, createdAt: iso(m.created_at), updatedAt: iso(m.updated_at),
  }));
  const bizAll = [...bizById.keys()];
  if (bizAll.length) {
    const pages = await pool.query('SELECT * FROM app.pages WHERE business_id = ANY($1)', [bizAll]);
    db.pages = pages.rows.map((p: any) => ({
      id: s(p.id), businessId: s(p.business_id), presetId: s(p.preset_id),
      theme: typeof p.theme === 'object' ? p.theme : JSON.parse(p.theme || '{}'),
      blocks: typeof p.blocks === 'object' ? p.blocks : JSON.parse(p.blocks || '[]'),
      updatedAt: iso(p.updated_at),
    }));
  }
  const pros = await pool.query('SELECT * FROM app.professionals WHERE user_id = $1 AND active = true', [user.id]);
  db.professionals = pros.rows.map((p: any) => ({
    id: s(p.id), businessId: s(p.business_id), name: s(p.name), role: s(p.role),
    photo: s(p.photo), active: p.active !== false, userId: s(p.user_id),
    followBusinessHours: p.follow_business_hours !== false,
  }));
  return db as DB;
}

/** requireMaster no modo relacional: o que o painel master lê (alvo do suporte). */
export async function relAccessibleDocForMaster(support: SupportSession | null): Promise<DB> {
  const pool = getPool();
  const db = { businesses: [] as any[] } as any;
  if (support) {
    const b = await pool.query('SELECT * FROM app.businesses WHERE id = $1', [support.businessId]);
    db.businesses = b.rows.map((r: any) => rowToBusiness(r));
  }
  return db as DB;
}

// ── Consumidor (paciente) ──
export function rowToCustomer(r: any) {
  return {
    id: s(r.id), name: s(r.name), phone: s(r.phone), email: s(r.email),
    passwordHash: s(r.password_hash), googleId: s(r.google_id), avatar: s(r.avatar),
    mustChangePassword: r.must_change_password === true,
    ...(r.access_created_at ? { accessCreatedAt: iso(r.access_created_at) } : {}),
    createdAt: iso(r.created_at),
  };
}

export const CUSTOMER_SESSION_DAYS = 90;

export async function relCustomerBySession(sessionId: string | undefined) {
  if (!sessionId) return null;
  const pool = getPool();
  const r = await pool.query(
    `SELECT c.* FROM app.customer_sessions cs JOIN app.customers c ON c.id = cs.customer_id
      WHERE cs.id = $1 AND cs.expires_at > now()`,
    [sessionId],
  );
  return r.rows[0] ? rowToCustomer(r.rows[0]) : null;
}

export async function relCustomerByLogin(login: string) {
  const pool = getPool();
  const digits = login.replace(/\D/g, '');
  const email = login.trim().toLowerCase();
  const r = await pool.query(
    'SELECT * FROM app.customers WHERE ($1 <> \'\' AND phone = $1) OR ($2 <> \'\' AND lower(email) = $2) LIMIT 1',
    [digits, email],
  );
  return r.rows[0] ? rowToCustomer(r.rows[0]) : null;
}

export async function relCreateCustomerSession(customerId: string): Promise<string> {
  const id = randomUUID();
  const pool = getPool();
  await pool.query(
    `INSERT INTO app.customer_sessions (id, customer_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [id, customerId, String(CUSTOMER_SESSION_DAYS)],
  );
  return id;
}

export async function relDestroyCustomerSession(sessionId: string): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM app.customer_sessions WHERE id = $1', [sessionId]);
}

/** upsertContact no modo relacional (mesma regra do lib/contacts — por telefone). */
export async function relUpsertContactOnLogin(client: PoolClient, input: {
  businessId: string; customerId: string; name: string; phone: string; email: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO app.contacts (id, business_id, customer_id, name, phone, email, source, last_interaction, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'login', now(), now(), now())
     ON CONFLICT (id) DO NOTHING`,
    [randomUUID(), input.businessId, input.customerId || null, input.name, input.phone, input.email],
  );
  // Contato existente da unidade com o MESMO telefone ganha o vínculo de conta.
  await client.query(
    `UPDATE app.contacts SET customer_id = $3, updated_at = now()
      WHERE business_id = $1 AND phone = $2 AND (customer_id IS NULL OR customer_id = '')`,
    [input.businessId, input.phone, input.customerId || null],
  );
}
