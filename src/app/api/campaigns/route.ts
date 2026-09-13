import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { audienceCount, audienceFor, hasMarketingConsent } from '@/lib/campaigns';
import { integrationStatus, serverCredentialsConfigured } from '@/lib/whatsapp';
import { todayISO } from '@/lib/tz';
import { CAMPAIGN_SEGMENTS, VALID_CAMPAIGN_STATUSES } from '@/lib/types';
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

// PATCH { businessId, id, action: 'ready' | 'send' | 'cancel', ... }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'campanhas');
    if (!guard.ok) return guard.res;
    const { db, ctx } = guard;
    const campaign = db.campaigns.find((c) => c.id === String(body.id) && c.businessId === businessId);
    if (!campaign) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 });

    const action = String(body.action || '');
    // Edição de rascunho (nome/mensagem/público) sem apagar histórico.
    if (action === 'update' || !action) {
      const updated = await updateDB((d) => {
        const c = d.campaigns.find((x) => x.id === campaign.id)!;
        if (c.status === 'sent' || c.status === 'partial') return null; // enviada não se reescreve
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
      const requested = body.status as CampaignStatus;
      const status: CampaignStatus = VALID_CAMPAIGN_STATUSES.includes(requested) ? requested : 'sent';
      const updated = await updateDB((d) => {
        const c = d.campaigns.find((x) => x.id === campaign.id)!;
        c.status = status;
        c.sentAt = new Date().toISOString();
        c.updatedAt = c.sentAt;
        c.counts.eligible = audienceCount(c.segment, c.segmentRef, audienceCtx(d, businessId));
        pushAudit(d, {
          action: 'campaign.sent', actor: { ...ctx.user, role: ctx.role }, businessId,
          supportSessionId: ctx.support?.id, meta: { id: c.id, status },
        });
        return c;
      });
      return NextResponse.json({ ok: true, campaign: updated });
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
