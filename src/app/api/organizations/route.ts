import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/access';
import { readDB, updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { relAudit } from '@/lib/relational/auth-store';
import { getPool } from '@/lib/relational/pool';
import { relationalOverviewDoc } from '@/lib/relational/overview-doc';
import { organizationOverview } from '@/lib/organization-overview';
import { resolvePeriodSpec } from '@/lib/periods';
import { todayISO, DEFAULT_TIMEZONE } from '@/lib/tz';
import { pushAudit } from '@/lib/audit';

// Contexto consolidado. Só agrega unidades às quais o usuário já tem acesso;
// organizationId enviado pelo cliente nunca amplia o escopo.
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.res;
  const { user } = guard;
  try {
    const q = req.nextUrl.searchParams;
    const period = resolvePeriodSpec({ period: q.get('period'), from: q.get('from'), to: q.get('to'), today: todayISO() });
    let organizations: ReturnType<typeof organizationOverview>;
    if (relationalActive()) {
      const db = await relationalOverviewDoc(user.id, period);
      organizations = organizationOverview(db, user, period);
    } else {
      const db = await readDB();
      organizations = organizationOverview(db, user, period);
    }
    const requested = q.get('organizationId');
    if (requested && !organizations.some((o) => o.id === requested)) return NextResponse.json({ error: 'Organização não disponível.' }, { status: 403 });
    return NextResponse.json({ organizations, period, referenceTimezone: DEFAULT_TIMEZONE }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Não foi possível carregar a organização.' }, { status: 500 }); }

}

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.res;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: 'Informe o nome da organização.' }, { status: 400 });
  const now = new Date().toISOString();
  const organization = { id: randomUUID(), name, ownerId: guard.user.id, metadata: {}, createdAt: now, updatedAt: now };
  if (relationalActive()) {
    // Organização não pertence a unidade: INSERT direto + auditoria pontual
    // (mesma forma do login/cadastro — fora da fatia por unidade).
    const pool = getPool();
    await pool.query(
      `INSERT INTO app.organizations (id, name, owner_id, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [organization.id, organization.name, organization.ownerId, JSON.stringify(organization.metadata),
        new Date(organization.createdAt), new Date(organization.updatedAt)],
    );
    await relAudit({ action: 'organization.created', actor: guard.user, businessId: '', meta: { organizationId: organization.id } });
    return NextResponse.json({ ok: true, organization }, { status: 201 });
  }
  await updateDB((db) => {
    db.organizations.push(organization);
    pushAudit(db, { action: 'organization.created', actor: guard.user, businessId: '', meta: { organizationId: organization.id } });
  });
  return NextResponse.json({ ok: true, organization }, { status: 201 });
}
