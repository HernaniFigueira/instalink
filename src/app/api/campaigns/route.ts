import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { audienceCount, audienceFor, hasMarketingConsent } from '@/lib/campaigns';
import { integrationStatus, serverCredentialsConfigured } from '@/lib/whatsapp';
import { createWinBackLeads, winBackCandidates } from '@/lib/automations';
import { todayISO } from '@/lib/tz';
import { CAMPAIGN_SEGMENTS, campaignStatusDef, VALID_CAMPAIGN_STATUSES } from '@/lib/types';
import type { Campaign, CampaignSegment, CampaignStatus, DB } from '@/lib/types';

// CAMPANHAS — estrutura para disparos futuros (WhatsApp oficial).
// Consentimento é pré-requisito absoluto: só entram contatos com
// marketingOptIn === true. Cadastro/agendamento/pedido NUNCA viram opt-in.
function audienceCtx(db: DB, businessId: string) {
  return {
    contacts: db.contacts.filter((c) => c.businessId === businessId),
    bookings: db.bookings.filter((b) => b.businessId === businessId),
    orders: db.orders.filter((o) => o.businessId === businessId),
    leads: db.leads.filter((l) => l.businessId === businessId),
    todayISO: todayISO(),
  };
}

function dto(c: Campaign, eligible: number) {
  return { ...c, liveEligible: eligible };
}

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'campanhas');
  if (!guard.ok) return guard.res;
  const { db, ctx } = guard;
  const ctxAudience = audienceCtx(db, businessId);
  const campaigns = db.campaigns
    .filter((c) => c.businessId === businessId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((c) => dto(c, audienceCount(c.segment, c.segmentRef, ctxAudience)));

  const segment = (req.nextUrl.searchParams.get('segment') || 'all_optin') as CampaignSegment;
  const segmentRef = req.nextUrl.searchParams.get('segmentRef') || '';
  const preview = audienceFor(
    CAMPAIGN_SEGMENTS.some((s) => s.id === segment) ? segment : 'all_optin',
    segmentRef,
    ctxAudience,
  );

    const withConsent = ctxAudience.contacts.filter(hasMarketingConsent).length;
    // Oportunidade interna (automação "cliente sem retorno"): contagem real,
    // criação sob demanda — nunca dispara mensagem sem campanha+consentimento.
    const winBack = winBackCandidates(db, businessId, todayISO());
    return NextResponse.json({
      campaigns,
      segments: CAMPAIGN_SEGMENTS,
      // Contagem por segmento já considerando o consentimento (o lojista vê o
      // número real ANTES de escolher o público).
      audience: CAMPAIGN_SEGMENTS.map((s) => ({
        segment: s.id,
        label: s.label,
        count: audienceCount(s.id, '', ctxAudience),
      })),
      consent: {
        total: ctxAudience.contacts.length,
        optedIn: withConsent,
        optedOut: ctxAudience.contacts.length - withConsent,
        totalContacts: ctxAudience.contacts.length,
        withConsent,
        rule: 'Somente contatos com consentimento explícito entram em campanhas.',
      },
      preview: { segment, count: preview.length, sample: preview.slice(0, 10) },
      opportunities: {
        winBack: winBack.length,
        sample: winBack.slice(0, 5).map((w) => ({
          name: w.contact.name, phone: w.contact.phone,
          lastBooking: w.lastBookingDate, days: w.daysSince,
        })),
      },
      whatsapp: {
        status: integrationStatus(ctx.business, serverCredentialsConfigured()).status,
        connected: integrationStatus(ctx.business, serverCredentialsConfigured()).status === 'connected',
        canSend: integrationStatus(ctx.business, serverCredentialsConfigured()).status === 'connected',
      },
    });
  }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'campanhas');
    if (!guard.ok) return guard.res;
    const { db, ctx } = guard;

    const name = String(body.name || '').trim().slice(0, 80);
    const message = String(body.message || '').trim().slice(0, 1000);
    const segment: CampaignSegment = CAMPAIGN_SEGMENTS.some((s) => s.id === body.segment)
      ? body.segment
      : 'all_optin';
    if (!name) return NextResponse.json({ error: 'Dê um nome à campanha.' }, { status: 400 });
    if (!message) return NextResponse.json({ error: 'Escreva a mensagem.' }, { status: 400 });

    const eligible = audienceCount(segment, String(body.segmentRef || ''), audienceCtx(db, businessId));
    const now = new Date().toISOString();
    const campaign: Campaign = {
      id: randomUUID(), businessId, name, message, segment,
      segmentRef: String(body.segmentRef || '').slice(0, 60),
      status: 'draft', channel: 'whatsapp',
      counts: { eligible, sent: 0, delivered: 0, failed: 0 },
      createdBy: ctx.user.id, createdAt: now, updatedAt: now, sentAt: '',
    };
    await updateDB((d) => {
      d.campaigns.push(campaign);
      pushAudit(d, {
        action: 'campaign.created', actor: { ...ctx.user, role: ctx.role }, businessId,
        supportSessionId: ctx.support?.id, meta: { name, segment, eligible },
      });
    });
    return NextResponse.json({ ok: true, campaign: dto(campaign, eligible) });
  } catch {
    return NextResponse.json({ error: 'Não foi possível criar a campanha.' }, { status: 500 });
  }
}

// PATCH { businessId, id, action: 'update' | 'ready' | 'send' | 'cancel' | 'duplicate' | 'winback', ... }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'campanhas');
    if (!guard.ok) return guard.res;
    const { db, ctx } = guard;

    // Ação interna (automação "cliente sem retorno"): cria oportunidades na
    // base — leads com action 'retorno'. Nenhum disparo acontece aqui.
    if (body.action === 'winback') {
      const created = await updateDB((d) => createWinBackLeads(d, businessId, todayISO()));
      return NextResponse.json({
        ok: true,
        created,
        message: created > 0
          ? `${created} oportunidade(s) de retorno criadas em Clientes (origem: automação).`
          : 'Nenhum cliente sem retorno no momento — tudo em dia por aqui.',
      });
    }

    const campaign = db.campaigns.find((c) => c.id === String(body.id) && c.businessId === businessId);
    if (!campaign) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });

    const action = String(body.action || '');
    // Edição de rascunho (nome/mensagem/público) sem apagar histórico.
    if (action === 'update' || !action) {
      const def = campaignStatusDef(campaign.status);
      const updated = await updateDB((d) => {
        const c = d.campaigns.find((x) => x.id === campaign.id)!;
        // Enviadas (sent/partial/failed) e "enviando" são HISTÓRICO — nunca reescritas.
        if (!def.editable) return null;
        if (body.name !== undefined) c.name = String(body.name || '').trim().slice(0, 80) || c.name;
        if (body.message !== undefined) c.message = String(body.message || '').trim().slice(0, 1000) || c.message;
        if (CAMPAIGN_SEGMENTS.some((s) => s.id === body.segment)) c.segment = body.segment;
        if (body.segmentRef !== undefined) c.segmentRef = String(body.segmentRef || '').slice(0, 60);
        c.counts.eligible = audienceCount(c.segment, c.segmentRef, audienceCtx(d, businessId));
        c.updatedAt = new Date().toISOString();
        return c;
      });
      if (!updated) return NextResponse.json({ error: 'Campanha enviada não pode ser editada.' }, { status: 409 });
      return NextResponse.json({ ok: true, campaign: updated });
    }

    if (action === 'ready') {
      const def = campaignStatusDef(campaign.status);
      if (!def.editable) {
        return NextResponse.json({ error: 'Somente rascunhos podem ficar prontos.' }, { status: 409 });
      }
      const updated = await updateDB((d) => {
        const c = d.campaigns.find((x) => x.id === campaign.id)!;
        c.counts.eligible = audienceCount(c.segment, c.segmentRef, audienceCtx(d, businessId));
        if (c.counts.eligible === 0) return null;
        c.status = 'ready';
        c.updatedAt = new Date().toISOString();
        pushAudit(d, {
          action: 'campaign.ready', actor: { ...ctx.user, role: ctx.role }, businessId,
          supportSessionId: ctx.support?.id, meta: { id: c.id, eligible: c.counts.eligible },
        });
        return c;
      });
      if (!updated) return NextResponse.json({ error: 'Nenhum contato com consentimento neste público.' }, { status: 400 });
      return NextResponse.json({
        ok: true, campaign: updated,
        message: `${updated.counts.eligible} contato(s) com consentimento estão prontos. O disparo usa a integração oficial do WhatsApp.`,
      });
    }

    if (action === 'send') {
      // O disparo real depende da integração oficial: sem ela, a campanha
      // permanece 'ready' — nunca marcamos como enviada sem ter enviado.
      if (integrationStatus(ctx.business, serverCredentialsConfigured()).status !== 'connected') {
        return NextResponse.json({
          error: 'WhatsApp ainda não conectado. A campanha fica pronta e o disparo acontece quando a integração oficial estiver ativa.',
          code: 'not_connected',
        }, { status: 409 });
      }
      if (!['ready', 'sending'].includes(campaign.status)) {
        return NextResponse.json({ error: 'Deixe a campanha pronta antes de enviar.' }, { status: 409 });
      }
      const requested = body.status as CampaignStatus;
      const status: CampaignStatus = VALID_CAMPAIGN_STATUSES.includes(requested) ? requested : 'sent';
      const updated = await updateDB((d) => {
        const c = d.campaigns.find((x) => x.id === campaign.id)!;
        c.status = status;
        c.sentAt = new Date().toISOString();
        c.updatedAt = c.sentAt;
        c.counts.eligible = audienceCount(c.segment, c.segmentRef, audienceCtx(d, businessId));
        // Histórico de disparo: registra os destinatários elegíveis (auditoria).
        if (status === 'sent' || status === 'partial') {
          const audience = audienceFor(c.segment, c.segmentRef, audienceCtx(d, businessId));
          const existing = new Set(
            d.campaignRecipients.filter((r) => r.campaignId === c.id).map((r) => r.contactId),
          );
          for (const m of audience) {
            if (existing.has(m.contactId)) continue;
            d.campaignRecipients.push({
              id: randomUUID(), businessId, campaignId: c.id, contactId: m.contactId,
              name: m.name, phone: m.phone, status: 'sent', error: '', at: c.sentAt,
            });
          }
          c.counts.sent = audience.length;
        }
        pushAudit(d, {
          action: 'campaign.sent', actor: { ...ctx.user, role: ctx.role }, businessId,
          supportSessionId: ctx.support?.id, meta: { id: c.id, status },
        });
        return c;
      });
      return NextResponse.json({ ok: true, campaign: updated });
    }

    // CANCELAR — permitido enquanto não saiu disparo real (draft/ready/sending).
    if (action === 'cancel') {
      const def = campaignStatusDef(campaign.status);
      if (!def.cancellable) {
        return NextResponse.json({ error: 'Campanhas já enviadas fazem parte do histórico e não podem ser canceladas.' }, { status: 409 });
      }
      const updated = await updateDB((d) => {
        const c = d.campaigns.find((x) => x.id === campaign.id)!;
        c.status = 'cancelled';
        c.updatedAt = new Date().toISOString();
        pushAudit(d, {
          action: 'campaign.cancelled', actor: { ...ctx.user, role: ctx.role }, businessId,
          supportSessionId: ctx.support?.id, meta: { id: c.id },
        });
        return c;
      });
      return NextResponse.json({
        ok: true, campaign: updated,
        message: 'Campanha cancelada. Ela continua na lista como registro.',
      });
    }

    if (action === 'duplicate') {
      const now = new Date().toISOString();
      const copy: Campaign = {
        ...campaign,
        id: randomUUID(),
        name: `${campaign.name} (cópia)`.slice(0, 80),
        status: 'draft',
        counts: { eligible: campaign.counts.eligible, sent: 0, delivered: 0, failed: 0 },
        createdBy: ctx.user.id,
        createdAt: now, updatedAt: now, sentAt: '',
      };
      await updateDB((d) => {
        d.campaigns.push(copy);
        pushAudit(d, {
          action: 'campaign.created', actor: { ...ctx.user, role: ctx.role }, businessId,
          supportSessionId: ctx.support?.id, meta: { duplicatedFrom: campaign.id },
        });
      });
      return NextResponse.json({ ok: true, campaign: dto(copy, copy.counts.eligible), message: 'Cópia criada como rascunho.' });
    }

    return NextResponse.json({ error: 'Ação não suportada.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar a campanha.' }, { status: 500 });
  }
}

// DELETE ?businessId=&id= — EXCLUSÃO SOMENTE DE RASCUNHO.
// Campanhas prontas/enviadas/canceladas permanecem: enviadas são auditoria;
// a ação correta delas é cancelar (ou excluir depois de reabrir como rascunho).
export async function DELETE(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId') || '';
    const id = req.nextUrl.searchParams.get('id') || '';
    const guard = await requireBusiness(req, businessId, 'campanhas');
    if (!guard.ok) return guard.res;
    const { db, ctx } = guard;
    const campaign = db.campaigns.find((c) => c.id === id && c.businessId === businessId);
    if (!campaign) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });
    if (campaign.status !== 'draft') {
      return NextResponse.json({
        error: 'Somente rascunhos podem ser excluídos. Campanhas já disparadas ficam como histórico — use cancelar.',
        code: 'not_deletable',
      }, { status: 409 });
    }
    await updateDB((d) => {
      d.campaigns = d.campaigns.filter((c) => !(c.id === id && c.businessId === businessId));
      d.campaignRecipients = d.campaignRecipients.filter((r) => r.campaignId !== id);
      pushAudit(d, {
        action: 'campaign.deleted', actor: { ...ctx.user, role: ctx.role }, businessId,
        supportSessionId: ctx.support?.id, meta: { id, name: campaign.name },
      });
    });
    return NextResponse.json({ ok: true, message: `Rascunho "${campaign.name}" excluído.` });
  } catch {
    return NextResponse.json({ error: 'Não foi possível excluir a campanha.' }, { status: 500 });
  }
}
