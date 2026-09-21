import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { readDB, updateDB } from '@/lib/db';
import { requireUser } from '@/lib/access';
import { resolveAccess } from '@/lib/access-core';
import { pushAudit } from '@/lib/audit';
import { instagramRedirectUri } from '@/lib/instagram';
import {
  applyInstagramAuthorization, encryptInstagramToken, exchangeInstagramCode, fetchInstagramAccount,
  instagramAppSecret, instagramKeyFingerprint, readInstagramState, subscribeInstagramAccount,
} from '@/lib/instagram-api';

// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 9 — RETORNO DA AUTORIZAÇÃO DO INSTAGRAM
// ═══════════════════════════════════════════════════════════════
// O Instagram devolve o NAVEGADOR para cá com `?code=&state=`. Passos:
//
//   1. conferir o `state` (assinatura + validade; o HMAC identifica a unidade
//      e o usuário — modelo B8, com segredo derivado por canal);
//   2. reconferir o ACESSO desse usuário àquela unidade (o estado é uma
//      capacidade de curta duração, não uma sessão);
//   3. trocar o código pelo token LONGO (60 dias) — só no servidor;
//   4. guardar a credencial CRIPTOGRAFADA (AES-256-GCM, mesmo cofre);
//   5. ASSINAR o webhook desta conta (sem isso nada chega);
//   6. voltar para Canais com um resultado CURTO (nunca token/ID na URL).
//
// Nada aqui diz "conectado" só porque a autorização terminou: o estado fica
// "webhook_pending" ou "aguardando a primeira mensagem".
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PANEL_PATH = '/canais';
const RESULT_CODES = new Set(['ok', 'pending', 'denied', 'error']);

function backToPanel(req: NextRequest, result: string, businessId = '', detail = ''): NextResponse {
  const safe = RESULT_CODES.has(result) ? result : 'error';
  const url = new URL(PANEL_PATH, req.nextUrl.origin);
  url.searchParams.set('tab', 'canais');
  if (businessId) url.searchParams.set('b', businessId);
  url.searchParams.set('instagram', safe);
  if (detail) url.searchParams.set('detalhe', detail.slice(0, 160));
  return NextResponse.redirect(url, 303);
}

export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('Canais · Instagram (callback)');
  if (blocked) return blocked;

  const params = req.nextUrl.searchParams;
  const code = String(params.get('code') || '').trim();
  const state = String(params.get('state') || '').trim();
  const stateError = String(params.get('error') || '').trim();

  // A pessoa pode ter recusado a autorização na tela do Instagram.
  if (stateError) {
    return backToPanel(req, stateError === 'access_denied' ? 'denied' : 'error', '', 'A autorização não foi concluída no Instagram.');
  }
  if (!code || !state) {
    return backToPanel(req, 'error', '', 'O Instagram não devolveu o código de autorização.');
  }
  if (!instagramAppSecret()) {
    return backToPanel(req, 'error', '', 'A plataforma não tem o app do Instagram configurado.');
  }

  // 1. Estado assinado (modelo B8, segredo derivado por canal).
  const decoded = readInstagramState(state);
  if (!decoded.ok) return backToPanel(req, 'error', '', decoded.reason);

  // 2. O usuário do estado continua com acesso à unidade?
  const auth = await requireUser(req);
  if (!auth.ok) return backToPanel(req, 'error', decoded.businessId, 'Sua sessão expirou — entre novamente e reconecte.');
  if (auth.user.id !== decoded.userId) {
    return backToPanel(req, 'error', decoded.businessId, 'Esta autorização foi iniciada por outro usuário.');
  }
  const dbBefore = await readDB();
  const access = resolveAccess(dbBefore, auth.user, decoded.businessId, null);
  if (!access || access.readOnly || access.permissions?.whatsapp !== true) {
    await updateDB((db) => {
      pushAudit(db, {
        action: 'instagram.onboarding_failed',
        actor: { id: auth.user.id, email: auth.user.email, role: access?.role || 'system' },
        businessId: decoded.businessId,
        meta: { step: 'return', reason: 'acesso negado ao voltar da autorização' },
      });
    });
    return backToPanel(req, 'error', decoded.businessId, 'Sua conta não tem acesso à conexão desta unidade.');
  }

  // 3. Troca do código (curto → longo). O redirect_uri precisa ser o MESMO
  //    cadastrado no app e usado na autorização.
  const exchanged = await exchangeInstagramCode({
    code,
    redirectUri: instagramRedirectUri(req.nextUrl.origin),
  });
  if (!exchanged.ok) {
    await updateDB((db) => {
      pushAudit(db, {
        action: 'instagram.onboarding_failed',
        actor: { id: auth.user.id, email: auth.user.email, role: access.role },
        businessId: decoded.businessId,
        meta: { step: 'exchange', reason: exchanged.error },
      });
    });
    return backToPanel(req, 'error', decoded.businessId, exchanged.error);
  }

  // 3.1 Rótulo público da conta (não é crítico: falhar aqui não impede nada).
  const account = await fetchInstagramAccount({
    igUserId: exchanged.igUserId,
    accessToken: exchanged.accessToken,
  });
  const now = new Date().toISOString();
  const expiresAt = exchanged.expiresIn > 0
    ? new Date(Date.now() + exchanged.expiresIn * 1000).toISOString()
    : '';

  // 4. Credencial criptografada + estado inicial (autorizado, webhook pendente).
  //    A conta é ÚNICA: se outra unidade já tem este `igUserId`, nada é gravado
  //    (o webhook ficaria ambíguo) e a tela explica o motivo.
  const saved = await updateDB((db) => {
    const applied = applyInstagramAuthorization(db, {
      businessId: decoded.businessId,
      igUserId: exchanged.igUserId,
      username: account.ok ? account.username : '',
      displayName: account.ok ? account.name : '',
      encryptedAccessToken: encryptInstagramToken(exchanged.accessToken),
      now,
      tokenExpiresAt: expiresAt,
      actor: { id: auth.user.id, email: auth.user.email, role: access.role },
    });
    if (!applied.ok) return applied;
    pushAudit(db, {
      action: 'instagram.connected',
      actor: { id: auth.user.id, email: auth.user.email, role: access.role },
      businessId: decoded.businessId,
      meta: {
        step: 'authorized',
        username: account.ok ? account.username : '',
        keyFingerprint: instagramKeyFingerprint(),
      },
    });
    return applied;
  });

  if (!saved.ok) {
    const detail = saved.reason === 'account_already_linked'
      ? 'Esta conta do Instagram já está conectada a outra unidade.'
      : 'Não foi possível guardar a autorização desta unidade.';
    return backToPanel(req, 'error', decoded.businessId, detail);
  }

  // 5. Assinatura do webhook desta conta — sem isso as mensagens não chegam.
  const sub = await subscribeInstagramAccount({
    igUserId: exchanged.igUserId,
    accessToken: exchanged.accessToken,
  });
  await updateDB((db) => {
    const business = db.businesses.find((b) => b.id === decoded.businessId);
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
        actor: { id: auth.user.id, email: auth.user.email, role: access.role },
        businessId: decoded.businessId,
        meta: { step: 'subscribe', reason: sub.error },
      });
    }
  });

  // 6. Resultado curto para a tela; o resto o painel lê da própria API.
  return sub.ok
    ? backToPanel(req, 'ok', decoded.businessId, 'Conta autorizada. Envie uma mensagem direta para confirmar a entrega.')
    : backToPanel(req, 'pending', decoded.businessId, `Conta autorizada, mas a Meta não confirmou o webhook: ${sub.error}`);
}
