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
//
// BASE GRANDE SAI EM PARTES. "Base completa" que corta em 5.000 contatos é
// mentira: a saída é PAGINADA (`cursor`/`nextCursor`, `part`, `hasMore`) e cada
// arquivo DIZ se está completo (`complete: true/false`). A tela baixa todas as
// partes; quem pegar só a primeira sabe, pelo próprio arquivo, que faltam
// contatos.
import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite, runRelationalRead } from '@/lib/relational/slice';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { effectiveTimezone, todayISO } from '@/lib/tz';
import { encounterInScope, encountersForCustomer } from '@/lib/encounters';
import { EXPORT_PART_SIZE, compareContactsForExport } from '@/lib/client-export';


/**
 * Papéis que podem levar a base inteira embora. A rota do Next só pode
 * exportar handlers, então isto é `const` de módulo — não `export`.
 */
const FULL_EXPORT_ROLES = ['OWNER', 'ADMIN', 'MASTER'];

/** Teto de mensagens por conversa (o arquivo é de migração, não de auditoria). */
const MESSAGES_PER_CONVERSATION = 200;
/** Teto de contatos por PARTE (a página pode ser menor, nunca maior). */
const MAX_PART_SIZE = 5000;

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

  // DOIS MOTORES: a base completa é da unidade (contatos + referências de
  // agenda/esteira/inbox/tarefas/atendimentos). No relacional chega da fatia
  // direcionada; a auditoria da saída é gravada na transação da fatia.
  const db: any = relationalActive()
    ? await runRelationalRead(businessId, {
        contacts: {}, bookings: {}, leads: {}, orders: {}, conversations: {},
        messages: {}, tasks: {}, encounters: {},
      })
    : guard.db;
  const business = guard.ctx.business;
  const tz = effectiveTimezone(business.businessTimezone);
  const today = todayISO(new Date(), tz);

  // Permissão de ATENDIMENTO do próprio solicitante — não a de administrar.
  // Ser dono ou gerente dá a base inteira, mas o registro de atendimento é
  // dado clínico: sai só para quem já pode abri-lo no produto.
  const canSeeEncounters = guard.ctx.permissions?.atendimento === true;

  // Ordem estável: as partes não podem repetir nem pular ninguém.
  const allContacts = db.contacts
    .filter((c: any) => c.businessId === businessId)
    .slice()
    .sort(compareContactsForExport);
  const totalContacts = allContacts.length;

  // Paginação explícita (offset + tamanho), com teto por parte.
  const rawCursor = String(req.nextUrl.searchParams.get('cursor') || '0').trim();
  const cursor = Number(rawCursor);
  if (!Number.isInteger(cursor) || cursor < 0) {
    return NextResponse.json({
      error: 'Posição da parte inválida (cursor). Recomece o download do começo.',
      code: 'invalid_cursor',
    }, { status: 400 });
  }
  const rawPartSize = Number(req.nextUrl.searchParams.get('partSize') || EXPORT_PART_SIZE);
  if (!Number.isInteger(rawPartSize) || rawPartSize < 1 || rawPartSize > MAX_PART_SIZE) {
    return NextResponse.json({
      error: `O tamanho da parte precisa estar entre 1 e ${MAX_PART_SIZE} contatos.`,
      code: 'invalid_part_size',
    }, { status: 400 });
  }
  const partSize = rawPartSize;
  const part = Math.floor(cursor / partSize) + 1;
  const contacts = allContacts.slice(cursor, cursor + partSize);
  const hasMore = cursor + partSize < totalContacts;
  const nextCursor = hasMore ? String(cursor + partSize) : '';
  const complete = !hasMore && cursor === 0;
  const byCustomer = new Map<string, typeof contacts[number]>();
  for (const c of contacts) {
    if (c.customerId) byCustomer.set(c.customerId, c);
  }
  const entries = contacts.map((c: any) => {
    const profile = (c.profile || {}) as Record<string, any>;
    const bookings = db.bookings
      .filter((b: any) => b.businessId === businessId && ((c.customerId && b.customerId === c.customerId) || (c.phone && b.customerPhone === c.phone)))
      .map((b: any) => ({
        id: b.id, serviceId: b.serviceId, professionalId: b.professionalId, date: b.date, time: b.time,
        status: b.status, createdAt: b.createdAt,
      }));
    const leads = db.leads
      .filter((l: any) => l.businessId === businessId && ((c.customerId && l.customerId === c.customerId) || (c.phone && l.phone === c.phone)))
      .map((l: any) => ({ id: l.id, name: l.name, origin: l.origin, status: l.status, createdAt: l.createdAt, lastInteraction: l.lastInteraction }));
    const tasks = db.tasks
      .filter((t: any) => t.businessId === businessId && ((c.customerId && t.customerId === c.customerId) || (c.id && t.customerId === c.id)))
      .map((t: any) => ({ id: t.id, title: t.title, status: t.status, dueAt: t.dueAt, createdAt: t.createdAt, encounterId: t.encounterId || '' }));
    const conversations = db.conversations
      .filter((cv: any) => cv.businessId === businessId && ((c.customerId && cv.customerId === c.customerId) || (c.id && cv.contactId === c.id)))
      .map((cv: any) => ({
        id: cv.id, channel: cv.channel, status: cv.status, createdAt: cv.createdAt,
        // Mensagens: só o conteúdo da conversa (texto/direção/quando). Mídia e
        // metadados internos de canal ficam de fora.
        messages: db.messages
          .filter((m: any) => m.conversationId === cv.id)
          .slice(-MESSAGES_PER_CONVERSATION)
          .map((m: any) => ({ id: m.id, direction: m.direction, text: m.body, at: m.at })),
      }));
    const encounters = canSeeEncounters
      ? encountersForCustomer(db.encounters || [], businessId, { contactId: c.id, customerId: c.customerId })
        .filter((e: any) => encounterInScope(e, guard.ctx.professionalScope))
        .map((e: any) => ({
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
      administrativeNotes: (c.notes || []).map((n: any) => ({ id: n.id, text: n.text, by: n.by, byName: n.byName, at: n.at })),
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
    // O arquivo DIZ se está completo — nunca corta em silêncio.
    complete,
    pagination: {
      part,
      partSize,
      cursor,
      totalContacts,
      exportedContacts: entries.length,
      exportedFrom: entries.length > 0 ? cursor + 1 : cursor,
      exportedTo: cursor + entries.length,
      hasMore,
      nextCursor,
    },
    totals: {
      contacts: entries.length,
      bookings: entries.reduce((n: number, e: any) => n + e.bookings.length, 0),
      leads: entries.reduce((n: number, e: any) => n + e.leads.length, 0),
      tasks: entries.reduce((n: number, e: any) => n + e.tasks.length, 0),
      conversations: entries.reduce((n: number, e: any) => n + e.conversations.length, 0),
      encounters: canSeeEncounters ? entries.reduce((n: number, e: any) => n + (e.encounters?.length || 0), 0) : 0,
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
  const auditEntry: any = {
    action: 'contact.exported',
    actor: guard.ctx.user,
    businessId,
    meta: {
      format: 'json', scope: 'full', rows: entries.length, part, partSize, cursor,
      totalContacts, complete, includeEncounters: canSeeEncounters,
      totals: payload.totals, date: new Date().toISOString(),
    },
  };
  if (relationalActive()) {
    await runRelationalWrite(businessId, (d: any) => {
      pushAudit(d, auditEntry);
      return true;
    }, { load: {} });
  } else {
    await updateDB((db2) => {
      pushAudit(db2, auditEntry);
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `base-completa-${business.slug || businessId}-${stamp}`;
  const totalParts = Math.max(1, Math.ceil(totalContacts / partSize));
  const fileName = totalParts > 1 ? `${baseName}-parte-${part}-de-${totalParts}.json` : `${baseName}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  });
}
