import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { updateDB } from '@/lib/db';
import { SUPPORT_COOKIE, requireMaster, supportExpiry, supportFromRequest } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import type { SupportMode } from '@/lib/types';
import { relationalActive } from '@/lib/relational/config';
import { relSupportEnd, relAudit } from '@/lib/relational/auth-store';

// MODO SUPORTE — o master entra na visão de uma empresa SEM se misturar com a
// conta do proprietário. A sessão é explícita, expira em 60 minutos, é
// auditada e, no modo 'view', TODA escrita é bloqueada pelas APIs.
export async function GET(req: NextRequest) {
  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const session = await supportFromRequest(req, guard.user.id);
  return NextResponse.json({ support: session });
}

export async function POST(req: NextRequest) {
  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { db, user } = guard;
  const body = await req.json().catch(() => ({}));
  const businessId = String(body.businessId || '');
  const mode: SupportMode = body.mode === 'admin' ? 'admin' : 'view';
  const reason = String(body.reason || '').slice(0, 300);
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

  const id = randomUUID();
  const session = {
    id, masterUserId: user.id, masterEmail: user.email, businessId,
    mode, reason,
    createdAt: new Date().toISOString(),
    expiresAt: supportExpiry(),
    endedAt: '',
  };
  await updateDB((d) => {
    // Encerra sessões anteriores do mesmo master e registra a nova.
    for (const s of d.supportSessions) {
      if (s.masterUserId === user.id && !s.endedAt) s.endedAt = new Date().toISOString();
    }
    d.supportSessions.push(session);
    pushAudit(d, {
      action: mode === 'admin' ? 'support.admin_started' : 'support.view_started',
      actor: user, businessId, supportSessionId: id, meta: { reason },
    });
  });

  const res = NextResponse.json({ ok: true, support: session });
  res.cookies.set(SUPPORT_COOKIE, id, {
    httpOnly: true, sameSite: 'none', secure: true, partitioned: true, path: '/', maxAge: 3600,
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { user } = guard;
  const session = await supportFromRequest(req, guard.user.id);
  if (session && relationalActive()) {
    await relSupportEnd(session.id, user.id);
    await relAudit({ action: 'support.ended', actor: user, businessId: session.businessId, supportSessionId: session.id });
  }
  if (session && !relationalActive()) {
    await updateDB((d) => {
      const s = d.supportSessions.find((x) => x.id === session.id);
      if (s) s.endedAt = new Date().toISOString();
      pushAudit(d, { action: 'support.ended', actor: user, businessId: session.businessId, supportSessionId: session.id });
    });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SUPPORT_COOKIE, '', { httpOnly: true, sameSite: 'none', secure: true, partitioned: true, path: '/', maxAge: 0 });
  return res;
}
