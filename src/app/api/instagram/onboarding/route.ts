import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { instagramAuthorizeUrl, instagramPlan } from '@/lib/instagram';
import {
  exchangeForLongLivedToken, encryptInstagramToken, getInstagramCredentials, issueInstagramState,
  subscribeInstagramAccount,
} from '@/lib/instagram-api';

// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 9 — ONBOARDING DO INSTAGRAM (Canais & Integrações)
// ═══════════════════════════════════════════════════════════════
// GET  ?businessId=  → plano (camadas + etapas) + URL oficial de autorização
//                      com `state` ligado à unidade e ao usuário (modelo B8).
// POST { businessId, action } → 'retry_subscribe' | 'refresh' | 'disconnect'.
//
// O código de autorização NÃO é trocado aqui: o Instagram devolve o usuário
// para `/api/instagram/onboarding/callback` (navegação), que faz a troca.
//
// Honestidade: nada nesta rota diz "conectado". Autorizar é uma etapa; a
// conexão só é declarada depois da entrega real de um evento da Meta.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function siteUrl(req: NextRequest): string {
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '').trim();
  return (configured || req.nextUrl.origin).replace(/\/+$/, '');
}

export async function GET(req: NextRequest) {
  const businessId = String(req.nextUrl.searchParams.get('businessId') || '').trim();
  const guard = await requireBusiness(req, businessId, 'whatsapp');
  if (!guard.ok) return guard.res;

  const origin = siteUrl(req);
  const plan = instagramPlan({ env: process.env, business: guard.ctx.business, siteUrl: origin });
  const state = plan.clientConfig ? issueInstagramState({ businessId, userId: guard.ctx.user.id }) : '';
  const authorizeUrl = plan.clientConfig && state
    ? instagramAuthorizeUrl({ appId: plan.clientConfig.appId, redirectUri: plan.clientConfig.redirectUri, state })
    : '';
  const inbox = guard.db.conversations.filter((c) => c.businessId === businessId && c.channel === 'instagram');
  const ig = guard.ctx.business.instagramIntegration;

  return NextResponse.json({
    ok: true,
    plan,
    state,
    authorizeUrl,
    inbox: {
      conversations: inbox.length,
      open: inbox.filter((c) => c.status === 'open').length,
      unread: inbox.reduce((sum, c) => sum + (c.unread || 0), 0),
    },
    server: {
      configured: plan.layers[0].ready,
      missingEnv: plan.layers[0].missing,
    },
    integration: ig
      ? {
          username: ig.username || '',
          displayName: ig.displayName || '',
          authorizedAt: ig.authorizedAt || '',
          webhookSubscribedAt: ig.webhookSubscribedAt || '',
          connectedAt: ig.connectedAt || '',
          lastWebhookAt: ig.lastWebhookAt || '',
          lastError: ig.lastError || '',
          // Manutenção preventiva: o cron renova a credencial antes de vencer.
          tokenIssuedAt: ig.tokenIssuedAt || '',
          tokenExpiresAt: ig.tokenExpiresAt || '',
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = String(body?.businessId || '').trim();
    const guard = await requireBusiness(req, businessId, 'whatsapp');
    if (!guard.ok) return guard.res;
    const action = String(body?.action || '').trim();
    const now = new Date().toISOString();

    if (action === 'disconnect') {
      await updateDB((db) => {
        const business = db.businesses.find((b) => b.id === businessId);
        if (!business) return;
        // A credencial sai do documento inteira; o histórico (conversas,
        // mensagens e leads) NÃO é tocado — desconectar não apaga atendimento.
        business.instagramIntegration = undefined;
        pushAudit(db, {
          action: 'instagram.disconnected',
          actor: { id: guard.ctx.user.id, email: guard.ctx.user.email, role: guard.ctx.role },
          businessId,
          meta: { via: 'panel' },
        });
      });
      return NextResponse.json({ ok: true, message: 'Instagram desconectado desta unidade.' });
    }

    if (action === 'retry_subscribe') {
      const creds = getInstagramCredentials(guard.ctx.business);
      if (!creds) {
        return NextResponse.json({ error: 'Conecte a conta do Instagram antes de ativar o webhook.', code: 'not_connected' }, { status: 409 });
      }
      const sub = await subscribeInstagramAccount({ igUserId: creds.igUserId, accessToken: creds.accessToken });
      await updateDB((db) => {
        const business = db.businesses.find((b) => b.id === businessId);
        if (!business?.instagramIntegration) return;
        if (sub.ok) {
          business.instagramIntegration.webhookSubscribedAt = now;
          business.instagramIntegration.status = 'waiting_first_event';
          business.instagramIntegration.lastError = undefined;
          business.instagramIntegration.lastErrorAt = undefined;
        } else {
          business.instagramIntegration.status = 'webhook_pending';
          business.instagramIntegration.lastError = sub.error;
          business.instagramIntegration.lastErrorAt = now;
          pushAudit(db, {
            action: 'instagram.onboarding_failed',
            actor: { id: guard.ctx.user.id, email: guard.ctx.user.email, role: guard.ctx.role },
            businessId,
            meta: { step: 'subscribe', reason: sub.error },
          });
        }
      });
      if (!sub.ok) return NextResponse.json({ error: sub.error, code: 'subscribe_failed' }, { status: 502 });
      return NextResponse.json({ ok: true, message: 'Webhook assinado: envie uma mensagem direta para a conta para confirmar a entrega.' });
    }

    if (action === 'refresh') {
      const creds = getInstagramCredentials(guard.ctx.business);
      if (!creds) {
        return NextResponse.json({ error: 'Não há credencial do Instagram para renovar.', code: 'not_connected' }, { status: 409 });
      }
      const renewed = await exchangeForLongLivedToken({ shortToken: creds.accessToken });
      if (!renewed.ok) {
        return NextResponse.json({ error: renewed.error, code: 'refresh_failed' }, { status: 502 });
      }
      const expiresAt = renewed.expiresIn > 0 ? new Date(Date.now() + renewed.expiresIn * 1000).toISOString() : '';
      await updateDB((db) => {
        const business = db.businesses.find((b) => b.id === businessId);
        if (!business?.instagramIntegration) return;
        business.instagramIntegration.encryptedAccessToken = encryptInstagramToken(renewed.accessToken);
        business.instagramIntegration.tokenIssuedAt = now;
        business.instagramIntegration.tokenExpiresAt = expiresAt;
        business.instagramIntegration.lastError = undefined;
        business.instagramIntegration.lastErrorAt = undefined;
      });
      return NextResponse.json({ ok: true, message: 'Credencial renovada.', tokenExpiresAt: expiresAt });
    }

    return NextResponse.json({ error: 'Ação desconhecida.', code: 'unknown_action' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Não foi possível concluir a operação do Instagram.' }, { status: 500 });
  }
}
