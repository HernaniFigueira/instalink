import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { canAccessConversation, isProfessionalScoped, scopeReadableContacts, scopeReadablePets } from '@/lib/data-scope';
import { scopeBookings } from '@/lib/access-core';
import { buildPeople360IdentityIndex, people360Phone, type People360Identity } from '@/lib/people360-identity';
import { clinicalPeople360Key } from '@/lib/clinical-people360-key';
import { entityMatches } from '@/lib/entity-search';

// GET ?businessId=&q= — BUSCA GLOBAL AGRUPADA (GODOUTOR final · FASE C).
//
// Um único endpoint leve para a topbar achar de verdade: pessoas (nome/
// telefone/e-mail), pacientes (pets), agendamentos e conversas. As ROTAS
// continuam calculadas no cliente (nav por permissão) — nada de duplicar
// catálogo no servidor.
//
// PERMISSÃO POR GRUPO (a regra é do servidor, nunca do cliente):
//   pessoas/pacientes → 'clientes' (360 é da unidade, como o /api/people360)
//   agendamentos      → 'agenda' (com recorte de profissional: scopeBookings)
//   conversas         → 'whatsapp'
// Sem a permissão, o grupo simplesmente NÃO EXISTE na resposta.
//
// Payload MINÚSCULO (title/subtitle/href): é um atalho, não um relatório.
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const query = (req.nextUrl.searchParams.get('q') || '').trim();
  if (query.length < 2) return NextResponse.json({ groups: [] }, { headers: { 'Cache-Control': 'no-store' } });

  // A busca lê as fontes que cada grupo pede — permissões diferentes não
  // podem pagar (nem receber) o que não é delas.
  const guard = await requireBusiness(req, businessId);
  if (!guard.ok) return guard.res;
  const { ctx } = guard;
  const clinicalProjection = isProfessionalScoped(ctx);
  // CLINICAL ACCESS: quem atende ENCONTRA os pacientes da unidade (pessoas e
  // pets com pegada clínica) — é a porta para abrir a ficha e o histórico.
  // Agendamentos, conversas e o resto do CRM continuam no vínculo OPERACIONAL:
  // busca não é atalho para a agenda/conversas de outro profissional.
  const db = guard.db;
  const canClients = ctx.permissions.clientes === true;
  const canAgenda = ctx.permissions.agenda === true;
  const canWhats = ctx.permissions.whatsapp === true;
  if (!canClients && !canAgenda && !canWhats) return NextResponse.json({ groups: [] }, { headers: { 'Cache-Control': 'no-store' } });

  const unitQuery = `?b=${encodeURIComponent(businessId)}`;
  type Hit = { id: string; group: 'pessoas' | 'pets' | 'agendamentos' | 'conversas'; title: string; subtitle: string; icon: string; href: string };
  const hits: Hit[] = [];

  // ── Pessoas + Pacientes (pets) ────────────────────────────────
  if (canClients) {
    const readableContacts = scopeReadableContacts(db, ctx, db.contacts.filter((c) => c.businessId === businessId));
    const readablePets = scopeReadablePets(db, ctx, db.pets.filter((p) => p.businessId === businessId && p.active !== false));
    // Mesma chave estável do /api/people360: o resultado abre a ficha 360
    // REAL da pessoa, não uma URL que 404aria.
    const identityRecords: People360Identity[] = readableContacts
      .map((c) => ({ customerId: c.customerId, phone: c.phone, contactId: c.id }));
    for (const b of db.bookings.filter((x) => x.businessId === businessId)) {
      identityRecords.push({ customerId: b.customerId, phone: b.customerPhone });
    }
    const identity = buildPeople360IdentityIndex(identityRecords);
    const keyOf = (customerId: string, phone: string, name: string, contactId = '') =>
      identity.key({ customerId, phone: people360Phone(phone), contactId }, name);

    const contacts = readableContacts;
    const phoneOf = (c: { phone: string }) => c.phone.replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) $2-$3');
    for (const c of contacts) {
      const matches = clinicalProjection
        ? entityMatches(query, { name: c.name, phone: c.phone })
        : entityMatches(query, { name: c.name, phone: c.phone, email: c.email });
      if (!matches) continue;
      const identityKey = keyOf(c.customerId, c.phone, c.name, c.id);
      const routeKey = clinicalProjection ? clinicalPeople360Key(identityKey) : identityKey;
      if (!routeKey) continue;
      hits.push({
        id: `pessoa:${routeKey}`, group: 'pessoas', icon: 'users',
        title: c.name || phoneOf(c),
        subtitle: [phoneOf(c), ...(clinicalProjection ? [] : [c.email])].filter(Boolean).join(' · ') || 'Contato',
        href: `/clientes/${encodeURIComponent(routeKey)}${unitQuery}`,
      });
    }

    // Pets (clínicas veterinárias): o resultado é o PACIENTE, o destino é a
    // ficha do tutor (Responsável ≠ Paciente).
    const tutorById = new Map(contacts.map((c) => [c.id, c]));
    for (const pet of readablePets) {
      if (!entityMatches(query, { name: pet.name, extra: [pet.species, pet.breed].filter(Boolean).join(' ') })) continue;
      const tutor = tutorById.get(pet.tutorId);
      const identityKey = tutor ? keyOf(tutor.customerId, tutor.phone, tutor.name, tutor.id) : '';
      const routeKey = identityKey && clinicalProjection ? clinicalPeople360Key(identityKey) : identityKey;
      if (!routeKey) continue;
      hits.push({
        id: `pet:${pet.id}`, group: 'pets', icon: 'paw',
        title: pet.name || 'Paciente',
        subtitle: [pet.species, tutor?.name ? `tutor: ${tutor.name}` : ''].filter(Boolean).join(' · '),
        href: `/clientes/${encodeURIComponent(routeKey)}${unitQuery}`,
      });
    }
  }

  // ── Agendamentos ─────────────────────────────────────────────
  if (canAgenda) {
    const services = new Map(db.services.filter((s) => s.businessId === businessId).map((s) => [s.id, s.name]));
    // Profissional com vínculo vê só a PRÓPRIA agenda (mesmo recorte do painel).
    const scoped = scopeBookings(db.bookings.filter((b) => b.businessId === businessId), ctx.professionalScope || '');
    for (const b of scoped) {
      const service = services.get(b.serviceId) || '';
      if (!entityMatches(query, { name: b.customerName, phone: b.customerPhone, extra: service })) continue;
      hits.push({
        id: `booking:${b.id}`, group: 'agendamentos', icon: 'calendar',
        title: [service || 'Atendimento', b.customerName].filter(Boolean).join(' — '),
        subtitle: `${b.date} ${b.time || ''}`.trim(),
        // Leva ao DIA da agenda — o destino que o painel consegue abrir.
        href: `/agenda${unitQuery}&data=${encodeURIComponent(b.date)}`,
      });
    }
  }

  // ── Conversas ────────────────────────────────────────────────
  if (canWhats) {
    const conversations = isProfessionalScoped(ctx)
      ? db.conversations.filter((c) => c.businessId === businessId && canAccessConversation(db, ctx, c))
      : db.conversations.filter((c) => c.businessId === businessId);
    for (const c of conversations) {
      if (!entityMatches(query, { name: c.name, phone: c.phone, extra: c.channelUsername })) continue;
      hits.push({
        id: `conversation:${c.id}`, group: 'conversas', icon: 'chat',
        title: c.name || c.phone,
        subtitle: `${c.channel === 'instagram' ? 'Instagram' : 'WhatsApp'} · ${c.lastMessageAt ? c.lastMessageAt.slice(0, 10) : ''}`.trim(),
        href: `/conversas${unitQuery}&c=${encodeURIComponent(c.id)}`,
      });
    }
  }

  return NextResponse.json(
    { groups: hits },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
