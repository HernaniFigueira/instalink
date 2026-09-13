import { NextRequest, NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { updateDB } from '@/lib/db';
import { featureState, normalizeFeatures } from '@/lib/features';
import { integrationStatus } from '@/lib/whatsapp';
import { todayISO } from '@/lib/tz';

// ÁREA MASTER — visão de suporte de UMA empresa (somente leitura).
// Registra no histórico/auditoria o acesso (quem, quando, qual empresa).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { db, user } = guard;
  const business = db.businesses.find((b) => b.id === params.id);
  if (!business) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

  const today = todayISO();
  const owner = db.users.find((u) => u.id === business.ownerId);
  const page = db.pages.find((p) => p.businessId === business.id);
  const bookings = db.bookings.filter((b) => b.businessId === business.id);
  const contacts = db.contacts.filter((c) => c.businessId === business.id);

  // Auditoria de visualização (ação relevante para trilha de suporte).
  await updateDB((d) => {
    pushAudit(d, { action: 'business.viewed', actor: user, businessId: business.id, meta: { via: 'admin' } });
  });

  return NextResponse.json({
    business: {
      id: business.id, name: business.name, slug: business.slug, niche: business.niche,
      description: business.description, published: business.published,
      createdAt: business.createdAt, updatedAt: business.updatedAt,
      address: business.address, whatsapp: business.whatsapp, email: business.email,
      subscription: business.subscription?.status || 'none',
      features: normalizeFeatures(business, page?.blocks || []),
      whatsappIntegration: integrationStatus(business, true),
    },
    owner: owner ? { id: owner.id, name: owner.name, email: owner.email, createdAt: owner.createdAt, lastLoginAt: owner.lastLoginAt || '' } : null,
    team: db.members.filter((m) => m.businessId === business.id).map((m) => {
      const u = db.users.find((x) => x.id === m.userId);
      return { id: m.id, name: u?.name || '', email: u?.email || '', role: m.role, active: m.active !== false, lastLoginAt: u?.lastLoginAt || '' };
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
    agent: db.agents.find((a) => a.businessId === business.id) || null,
    recentAudit: db.audit.filter((a) => a.businessId === business.id).slice(-20).reverse(),
  });
}
