import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireMaster } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { updateDB } from '@/lib/db';
import { featureState, normalizeFeatures } from '@/lib/features';
import { integrationStatus } from '@/lib/whatsapp';
import { todayISO } from '@/lib/tz';
import { safeUserView } from '@/lib/master';

// Detalhe de uma unidade (leitura de plataforma). NÃO concede acesso
// operacional — para operar, o Master inicia SupportSession.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const blocked = blockIfRelational('Master · unidade');
  if (blocked) return blocked;

  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { db, user } = guard;
  const business = db.businesses.find((b) => b.id === params.id);
  if (!business) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 });

  const today = todayISO();
  const owner = db.users.find((u) => u.id === business.ownerId);
  const org = db.organizations.find((o) => o.id === business.organizationId);
  const page = db.pages.find((p) => p.businessId === business.id);
  const bookings = db.bookings.filter((b) => b.businessId === business.id);
  const contacts = db.contacts.filter((c) => c.businessId === business.id);

  await updateDB((d) => {
    pushAudit(d, {
      action: 'business.viewed',
      actor: user,
      businessId: business.id,
      meta: { via: 'master', organizationId: business.organizationId || '' },
    });
  });

  return NextResponse.json({
    unit: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      niche: business.niche,
      description: business.description,
      published: business.published,
      status: business.published ? 'published' : 'draft',
      createdAt: business.createdAt,
      updatedAt: business.updatedAt,
      address: business.address,
      whatsapp: business.whatsapp,
      email: business.email,
      organizationId: business.organizationId || '',
      organizationName: org?.name || '',
      subscription: business.subscription?.status || 'none',
      features: normalizeFeatures(business, page?.blocks || []),
      whatsappIntegration: integrationStatus(business, true),
    },
    owner: owner ? safeUserView(db, owner) : null,
    team: db.members.filter((m) => m.businessId === business.id).map((m) => {
      const u = db.users.find((x) => x.id === m.userId);
      return {
        id: m.id,
        name: u?.name || '',
        email: u?.email || '',
        role: m.role,
        active: m.active !== false,
        lastLoginAt: u?.lastLoginAt || '',
      };
    }),
    modules: featureState(business).map(({ def, enabled }) => ({ id: def.id, label: def.label, enabled })),
    totals: {
      contacts: contacts.length,
      registeredCustomers: contacts.filter((c) => !!c.customerId).length,
      leads: db.leads.filter((x) => x.businessId === business.id).length,
      bookings: bookings.length,
      upcoming: bookings.filter((b) => b.date >= today && b.status !== 'cancelled').length,
      orders: db.orders.filter((o) => o.businessId === business.id).length,
      professionals: db.professionals.filter((p) => p.businessId === business.id).length,
      reviews: (db.reviews || []).filter((r) => r.businessId === business.id).length,
      conversations: db.conversations.filter((c) => c.businessId === business.id).length,
      campaigns: db.campaigns.filter((c) => c.businessId === business.id).length,
    },
    agent: (() => {
      const a = db.agents.find((x) => x.businessId === business.id);
      return a ? { name: a.name, enabled: a.enabled, tone: a.tone, updatedAt: a.updatedAt } : null;
    })(),
    recentAudit: db.audit
      .filter((a) => a.businessId === business.id)
      .slice(-20)
      .reverse()
      .map((a) => ({
        id: a.id,
        action: a.action,
        actorEmail: a.actorEmail,
        actorRole: a.actorRole,
        supportSessionId: a.supportSessionId,
        at: a.at,
        meta: a.meta,
      })),
  });
}
