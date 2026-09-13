import { NextRequest, NextResponse } from 'next/server';
import { requireMaster } from '@/lib/access';
import { enabledFeatureIds } from '@/lib/features';
import { integrationStatus } from '@/lib/whatsapp';
import { todayISO } from '@/lib/tz';

// ÁREA MASTER — lista de empresas da plataforma com os números que importam
// para operação/suporte. Nunca expõe segredos (pixKey, googleApiKey, hashes).
export async function GET(req: NextRequest) {
  const guard = await requireMaster(req);
  if (!guard.ok) return guard.res;
  const { db } = guard;
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const today = todayISO();

  const ownerOf = (ownerId: string) => db.users.find((u) => u.id === ownerId);

  let list = db.businesses.map((b) => {
    const owner = ownerOf(b.ownerId);
    const bookings = db.bookings.filter((x) => x.businessId === b.id);
    const contacts = db.contacts.filter((x) => x.businessId === b.id);
    const orders = db.orders.filter((x) => x.businessId === b.id);
    const upcoming = bookings.filter((x) => x.date >= today && x.status !== 'cancelled').length;
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      niche: b.niche,
      published: !!b.published,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email, lastLoginAt: owner.lastLoginAt || '' } : null,
      status: b.published ? 'published' : 'draft',
      staff: db.members.filter((m) => m.businessId === b.id && m.active !== false).length + 1,
      professionals: db.professionals.filter((p) => p.businessId === b.id && p.active !== false).length,
      customers: contacts.filter((c) => !!c.customerId).length,
      contacts: contacts.length,
      leads: db.leads.filter((x) => x.businessId === b.id).length,
      bookings: bookings.length,
      upcomingBookings: upcoming,
      orders: orders.length,
      reviews: (db.reviews || []).filter((r) => r.businessId === b.id).length,
      modules: enabledFeatureIds(b),
      whatsapp: integrationStatus(b, true).status,
      conversations: db.conversations.filter((c) => c.businessId === b.id).length,
      campaigns: db.campaigns.filter((c) => c.businessId === b.id).length,
      subscription: b.subscription?.status || 'none',
    };
  });

  if (q) {
    list = list.filter((b) =>
      b.name.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q) ||
      (b.owner?.email || '').toLowerCase().includes(q) || (b.owner?.name || '').toLowerCase().includes(q));
  }
  list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return NextResponse.json({
    total: list.length,
    totals: {
      businesses: db.businesses.length,
      published: db.businesses.filter((b) => b.published).length,
      users: db.users.length,
      contacts: db.contacts.length,
      bookings: db.bookings.length,
    },
    businesses: list,
  });
}
