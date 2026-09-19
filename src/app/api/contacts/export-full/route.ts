// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — SAÍDA COMPLETA DA BASE (JSON)
// ═══════════════════════════════════════════════════════════════
// O CSV serve para portabilidade simples; este arquivo é a saída COMPLETA da
// unidade: cadastro, perfil, endereço, responsável, etiquetas, observações
// administrativas e o histórico (agendamentos, leads, tarefas, conversas e
// mensagens).
//
// Quem pode levar: **OWNER / ADMIN / MASTER** — não é permissão genérica de
// Clientes. Quem exporta dados pessoais de toda a base precisa ser quem
// responde pela unidade.
//
// REGRA DE OURO: aqui não se espalha objeto do banco. Cada seção é escrita à
// mão, campo a campo, para que nada sensível possa vazar por acidente:
// `passwordHash`, sessões, chaves de API, segredos de webhook, tokens da Meta
// (`encryptedAccessToken`) e dados de OUTRA unidade não entram — nunca.
//
// Atendimento (`encounters`) é dado clínico: só vai para quem tem a permissão
// própria `atendimento`. Sem ela, o arquivo sai sem essa seção (e diz isso).
import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { effectiveTimezone, todayISO } from '@/lib/tz';
import { encounterInScope, encountersForCustomer } from '@/lib/encounters';


/**
 * Papéis que podem levar a base inteira embora. A rota do Next só pode
 * exportar handlers, então isto é `const` de módulo — não `export`.
 */
const FULL_EXPORT_ROLES = ['OWNER', 'ADMIN', 'MASTER'];

/** Teto de mensagens por conversa (o arquivo é de migração, não de auditoria). */
const MESSAGES_PER_CONVERSATION = 200;
/** Teto de contatos por exportação. */
const MAX_CONTACTS = 5000;

export async function GET(req: NextRequest) {
  const businessId = String(req.nextUrl.searchParams.get('businessId') || '');
  const guard = await requireBusiness(req, businessId, 'clientes');
  if (!guard.ok) return guard.res;

  const role = String(guard.ctx.role || '');
  if (!FULL_EXPORT_ROLES.includes(role.toUpperCase())) {
    return NextResponse.json({
      error: 'A saída completa da base é de quem administra a unidade (dono ou administração).',
    }, { status: 403 });
  }

  const db = guard.db;
  const business = guard.ctx.business;
  const tz = effectiveTimezone(business.businessTimezone);
  const today = todayISO(new Date(), tz);

  // Permissão de ATENDIMENTO do próprio solicitante — não a de administrar.
  // Ser dono ou gerente dá a base inteira, mas o registro de atendimento é
  // dado clínico: sai só para quem já pode abri-lo no produto.
  const canSeeEncounters = guard.ctx.permissions?.atendimento === true;

  const contacts = db.contacts.filter((c) => c.businessId === businessId).slice(0, MAX_CONTACTS);
  const byCustomer = new Map<string, typeof contacts[number]>();
  for (const c of contacts) {
    if (c.customerId) byCustomer.set(c.customerId, c);
  }
  const entries = contacts.map((c) => {
    const profile = (c.profile || {}) as Record<string, any>;
    const bookings = db.bookings
      .filter((b) => b.businessId === businessId && ((c.customerId && b.customerId === c.customerId) || (c.phone && b.customerPhone === c.phone)))
      .map((b) => ({
        id: b.id, serviceId: b.serviceId, professionalId: b.professionalId, date: b.date, time: b.time,
        status: b.status, createdAt: b.createdAt,
      }));
    const leads = db.leads
      .filter((l) => l.businessId === businessId && ((c.customerId && l.customerId === c.customerId) || (c.phone && l.phone === c.phone)))
      .map((l) => ({ id: l.id, name: l.name, origin: l.origin, status: l.status, createdAt: l.createdAt, lastInteraction: l.lastInteraction }));
    const tasks = db.tasks
      .filter((t) => t.businessId === businessId && ((c.customerId && t.customerId === c.customerId) || (c.id && t.customerId === c.id)))
      .map((t) => ({ id: t.id, title: t.title, status: t.status, dueAt: t.dueAt, createdAt: t.createdAt, encounterId: t.encounterId || '' }));
    const conversations = db.conversations
      .filter((cv) => cv.businessId === businessId && ((c.customerId && cv.customerId === c.customerId) || (c.id && cv.contactId === c.id)))
      .map((cv) => ({
        id: cv.id, channel: cv.channel, status: cv.status, createdAt: cv.createdAt,
        // Mensagens: só o conteúdo da conversa (texto/direção/quando). Mídia e
        // metadados internos de canal ficam de fora.
        messages: db.messages
          .filter((m) => m.conversationId === cv.id)
          .slice(-MESSAGES_PER_CONVERSATION)
          .map((m) => ({ id: m.id, direction: m.direction, text: m.body, at: m.at })),
      }));
    const encounters = canSeeEncounters
      ? encountersForCustomer(db.encounters || [], businessId, { contactId: c.id, customerId: c.customerId })
        .filter((e) => encounterInScope(e, guard.ctx.professionalScope))
        .map((e) => ({
          id: e.id, date: e.date, time: e.time, bookingId: e.bookingId, queueId: e.queueId,
          serviceId: e.serviceId, professionalId: e.professionalId, status: e.status,
          complaint: e.complaint, evolution: e.evolution, guidance: e.guidance, followUp: e.followUp,
          internalNote: e.internalNote, tags: e.tags, version: e.version,
          finalizedAt: e.finalizedAt, signedBy: e.signedBy,
        }))
      : undefined;

    return {
      contactId: c.id,
      customerId: c.customerId,
      registration: {
        name: c.name, phone: c.phone, email: c.email, marketingOptIn: c.marketingOptIn === true,
        source: c.source, createdAt: c.createdAt, updatedAt: c.updatedAt, lastInteraction: c.lastInteraction,
      },
      profile: {
        cpf: profile.cpf || '', birthDate: profile.birthDate || '', gender: profile.gender || '',
        adminNote: profile.adminNote || '', tags: Array.isArray(profile.tags) ? profile.tags : [],
        address: profile.address || null,
        guardian: profile.guardian || null,
      },
      administrativeNotes: (c.notes || []).map((n) => ({ id: n.id, text: n.text, by: n.by, byName: n.byName, at: n.at })),
      legacyNote: c.note || '',
      bookings, leads, tasks, conversations,
      ...(encounters === undefined ? {} : { encounters }),
    };
  });

  const payload = {
    format: 'instalink.customers.full',
    version: 1,
    generatedAt: new Date().toISOString(),
    business: {
      id: business.id, name: business.name, slug: business.slug,
      timezone: tz, today,
    },
    totals: {
      contacts: entries.length,
      bookings: entries.reduce((n, e) => n + e.bookings.length, 0),
      leads: entries.reduce((n, e) => n + e.leads.length, 0),
      tasks: entries.reduce((n, e) => n + e.tasks.length, 0),
      conversations: entries.reduce((n, e) => n + e.conversations.length, 0),
      encounters: canSeeEncounters ? entries.reduce((n, e) => n + (e.encounters?.length || 0), 0) : 0,
    },
    /** O que NÃO foi incluído, dito na cara — transparência para quem migra. */
    omitted: [
      'credenciais de login (senha, sessões)',
      'chaves de API e segredos de webhook',
      'tokens de WhatsApp/Meta',
      ...(canSeeEncounters ? [] : ['registros de atendimento (exigem a permissão "atendimento")']),
      'dados de outras unidades',
    ],
    contacts: entries,
  };

  // Auditoria da saída de dados: quem, o quê, quanto, quando.
  await updateDB((db2) => {
    pushAudit(db2, {
      action: 'contact.exported',
      actor: guard.ctx.user,
      businessId,
      meta: {
        format: 'json', scope: 'full', rows: entries.length,
        includeEncounters: canSeeEncounters, totals: payload.totals, date: new Date().toISOString(),
      },
    });
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="base-completa-${business.slug || businessId}-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  });
}
