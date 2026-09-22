import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireMaster } from '@/lib/access';
import { updateDB } from '@/lib/db';
import { pushAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/auth';
import {
  listMastersSafe,
  listEnvOnlyMastersSafe,
  promoteToMaster,
  revokeMaster,
  upsertMasterUser,
  masterAuditAction,
  countMasters,
} from '@/lib/master';

// Gestão de contas Master — somente quem JÁ é Master.
// Fonte administrativa: role='master'. MASTER_EMAILS é fallback visível à parte.

export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('Master · contas master');
  if (blocked) return blocked;

  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const masters = listMastersSafe(guard.db);
  const envOnly = listEnvOnlyMastersSafe(guard.db);
  return NextResponse.json({
    total: masters.length,
    masters,
    // Fallback env (sem role=master): visível, mas NÃO gerenciável por revoke de role
    // e NÃO conta para a proteção do último Master.
    envOnlyMasters: envOnly,
    envOnlyTotal: envOnly.length,
    // Nunca retorna senha/hash.
  });
}

export async function POST(req: NextRequest) {
  const blocked = blockIfRelational('Master · contas master');
  if (blocked) return blocked;

  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { user: actor } = guard;
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 80);
  const password = String(body.password || '');
  const confirm = body.confirm === true;

  if (!confirm) {
    return NextResponse.json(
      { error: 'Ação crítica: confirme explicitamente (confirm: true).' },
      { status: 400 },
    );
  }
  if (!email.includes('@')) {
    return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
  }

  // Se o usuário já existe, só promove (senha do próprio usuário permanece).
  // Se é novo, exige senha forte definida pelo Master atual.
  const existing = guard.db.users.find((u) => u.email.toLowerCase() === email);
  if (!existing && password.length < 8) {
    return NextResponse.json(
      { error: 'Para criar um Master novo, defina uma senha com ao menos 8 caracteres.' },
      { status: 400 },
    );
  }

  const result = await updateDB((db) => {
    const r = existing
      ? promoteToMaster(db, email)
      : upsertMasterUser(db, {
        email,
        name: name || undefined,
        passwordHash: hashPassword(password),
      });
    if (r.ok) {
      pushAudit(db, {
        action: masterAuditAction(r.action),
        actor: { ...actor, role: 'master' },
        meta: { email: r.email, userId: r.userId, created: r.created },
      });
    }
    return r;
  });

  if (!result.ok) {
    const status = result.code === 'not_found' ? 404
      : result.code === 'already' ? 409
        : result.code === 'last_master' ? 409
          : 400;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({
    ok: true,
    action: result.action,
    userId: result.userId,
    email: result.email,
    // Nunca retorna senha.
  });
}

export async function DELETE(req: NextRequest) {
  const blocked = blockIfRelational('Master · contas master');
  if (blocked) return blocked;

  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { user: actor } = guard;
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId || body.id || '');
  const confirm = body.confirm === true;

  if (!confirm) {
    return NextResponse.json(
      { error: 'Ação crítica: confirme explicitamente (confirm: true).' },
      { status: 400 },
    );
  }
  if (!userId) {
    return NextResponse.json({ error: 'Informe o usuário.' }, { status: 400 });
  }

  // Proteção extra: se só existe 1 master, bloquear antes mesmo do update.
  if (countMasters(guard.db) <= 1) {
    return NextResponse.json(
      { error: 'Não é possível remover o último Master da plataforma.', code: 'last_master' },
      { status: 409 },
    );
  }

  const result = await updateDB((db) => {
    const r = revokeMaster(db, userId);
    if (r.ok) {
      pushAudit(db, {
        action: 'master.revoked',
        actor: { ...actor, role: 'master' },
        meta: { email: r.email, userId: r.userId },
      });
      // Sessões do usuário revogado: invalidamos para o acesso cair na hora.
      db.sessions = db.sessions.filter((s) => s.userId !== userId);
    }
    return r;
  });

  if (!result.ok) {
    const status = result.code === 'not_found' ? 404
      : result.code === 'last_master' ? 409
        : 400;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({ ok: true, action: 'revoked', userId: result.userId, email: result.email });
}
