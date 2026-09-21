'use client';
// ═══════════════════════════════════════════════════════════════
// CANAL INSTAGRAM — estado da conexão (Canais & Integrações → Canais)
// ═══════════════════════════════════════════════════════════════
// A tela mostra a VERDADE em duas camadas (mesmo desenho do B8):
//
//   PLATAFORMA — o que só o dono do GoDoutor configura (app, segredo, cofre).
//   UNIDADE    — o que esta unidade resolve no fluxo oficial do Instagram.
//
// Nada de token, segredo ou identificador técnico na tela: só o @ e o nome de
// exibição da conta, que são públicos. "Conectado" só aparece quando a Meta já
// entregou uma mensagem de verdade — autorizar não é conectar.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Icon } from '@/components/icons';
import { Button, PageSkeleton } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import type { InstagramPlan } from '@/lib/instagram';

interface OnboardingItemView { key: string; label: string; why: string; ok: boolean; secret: boolean; required: boolean }
interface OnboardingLayerView {
  id: 'platform' | 'unit'; title: string; owner: string; items: OnboardingItemView[]; ready: boolean; missing: string[];
}

export interface InstagramChannelData {
  plan: InstagramPlan & { layers: OnboardingLayerView[] };
  state: string;
  authorizeUrl: string;
  inbox: { conversations: number; open: number; unread: number };
  server: { configured: boolean; missingEnv: string[] };
  integration: {
    username: string; displayName: string; authorizedAt: string; webhookSubscribedAt: string;
    connectedAt: string; lastWebhookAt: string; lastError: string;
    tokenIssuedAt: string; tokenExpiresAt: string;
  } | null;
}

const TONE: Record<string, string> = {
  ok: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  pending: 'bg-amber-50 border-amber-200 text-amber-800',
  error: 'bg-rose-50 border-rose-200 text-rose-800',
  off: 'bg-zinc-100 border-zinc-200 text-zinc-600',
};

function LayerCard({ layer }: { layer: OnboardingLayerView }) {
  return (
    <div className="border border-zinc-200 rounded-md p-3 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{layer.title}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{layer.owner}</p>
        </div>
        <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${layer.ready ? TONE.ok : layer.id === 'platform' ? TONE.pending : TONE.off}`}>
          {layer.ready ? 'Pronto' : layer.id === 'platform' ? 'Bloqueio da plataforma' : 'Pendente'}
        </span>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {layer.items.map((item) => (
          <li key={item.key} className="flex items-start gap-2">
            <span className={`mt-0.5 text-xs ${item.ok ? 'text-emerald-700' : item.required ? 'text-rose-700' : 'text-zinc-400'}`}>
              {item.ok ? '✓' : '•'}
            </span>
            <span className="min-w-0">
              <span className={`text-xs font-medium ${item.ok ? 'text-zinc-800' : 'text-zinc-700'}`}>
                {item.label}{item.secret && !item.ok ? ' (segredo — só no servidor)' : ''}
              </span>
              {!item.ok && <span className="block text-[11px] text-zinc-500">{item.why}</span>}
            </span>
          </li>
        ))}
      </ul>
      {!layer.ready && layer.missing.length > 0 && (
        <p className="text-[11px] font-mono text-amber-800 mt-2">falta: {layer.missing.join(', ')}</p>
      )}
    </div>
  );
}

/** Resultado do retorno da autorização (`?instagram=ok|pending|denied|error`). */
function RedirectBanner() {
  const params = useSearchParams();
  const result = params.get('instagram') || '';
  const detail = params.get('detalhe') || '';
  if (!result) return null;
  const map: Record<string, { tone: string; title: string }> = {
    ok: { tone: 'bg-emerald-700', title: 'Conta autorizada.' },
    pending: { tone: 'bg-amber-600', title: 'Conta autorizada, webhook pendente.' },
    denied: { tone: 'bg-amber-600', title: 'Autorização cancelada no Instagram.' },
    error: { tone: 'bg-rose-700', title: 'Não foi possível concluir a conexão.' },
  };
  const info = map[result] || map.error;
  return (
    <p className={`text-sm font-medium ${info.tone} text-white rounded-md px-3 py-2`}>
      {info.title} {detail}
    </p>
  );
}

export function InstagramChannelPanel({ businessId }: { businessId: string }) {
  const [data, setData] = useState<InstagramChannelData | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<InstagramChannelData>(`/api/instagram/onboarding?businessId=${businessId}`, {
      scope: 'area', area: 'Canais',
    });
    if (!res.ok) { setError(res.message); return; }
    setData(res.data || null);
    setError('');
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function action(name: 'retry_subscribe' | 'refresh' | 'disconnect') {
    if (name === 'disconnect' && !confirm('Desconectar o Instagram desta unidade? O histórico das conversas é preservado.')) return;
    setBusy(name); setMsg(''); setError('');
    try {
      const res = await apiSend<{ message?: string }>('/api/instagram/onboarding', 'POST', { businessId, action: name }, { scope: 'action', area: 'Canais' });
      if (!res.ok) throw new Error(res.message || 'Não foi possível concluir a operação.');
      setMsg(res.data?.message || 'Operação concluída.');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir a operação.');
    } finally { setBusy(''); }
  }

  if (!data) return <PageSkeleton />;
  const plan = data.plan;
  const ig = data.integration;
  const connected = plan.state === 'connected';
  const canAuthorize = !!data.authorizeUrl;

  return (
    <div className="space-y-3">
      <RedirectBanner />
      {msg && <p className="text-sm font-medium bg-emerald-700 text-white rounded-md px-3 py-2">{msg}</p>}
      {error && <p role="alert" className="text-sm font-medium bg-amber-600 text-white rounded-md px-3 py-2">{error}</p>}

      <div className="bg-white border border-zinc-200">
        <div className="px-4 py-3 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Instagram · estado da conexão</p>
            <p className="text-xs text-zinc-500 mt-0.5">{plan.statusLabel.detail}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-semibold border rounded-full px-2.5 py-0.5 ${TONE[plan.statusLabel.tone]}`}>
              {plan.statusLabel.label}
            </span>
          </div>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-zinc-800">{plan.headline}</p>
            <p className="text-xs text-zinc-600 mt-1">{plan.detail}</p>
          </div>

          {ig && (ig.username || ig.displayName) && (
            <p className="text-xs text-zinc-600">
              Conta: <span className="font-semibold text-zinc-800">{ig.displayName || ig.username}</span>
              {ig.username && <span className="text-zinc-500"> · @{ig.username}</span>}
            </p>
          )}

          {/* Manutenção da credencial: o cron renova antes do vencimento (nunca
              no meio de um envio). Só a DATA — nunca o token. */}
          {ig?.tokenExpiresAt && (
            <p className="text-[11px] text-zinc-500">
              Credencial renovada automaticamente · vence em {ig.tokenExpiresAt.slice(0, 10)}
              {ig.tokenIssuedAt ? ` (emitida em ${ig.tokenIssuedAt.slice(0, 10)})` : ''}
            </p>
          )}

          {/* Etapas reais: a ordem que a Meta impõe. */}
          <ol className="space-y-1.5">
            {plan.steps.map((step) => (
              <li key={step.id} className="flex items-start gap-2">
                <span className={`mt-0.5 text-xs ${step.ok ? 'text-emerald-700' : step.current ? 'text-amber-700' : 'text-zinc-400'}`}>
                  {step.ok ? '✓' : step.current ? '→' : '•'}
                </span>
                <span className="min-w-0">
                  <span className={`text-xs font-medium ${step.ok ? 'text-zinc-800' : 'text-zinc-600'}`}>{step.label}</span>
                  <span className="block text-[11px] text-zinc-500">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {canAuthorize && plan.nextAction.kind === 'authorize' && (
              <a href={data.authorizeUrl}
                className="text-xs font-semibold bg-[var(--brand)] text-white px-3 py-1.5 rounded-md shadow-brand hover:bg-[var(--brand-strong)] inline-flex items-center gap-1.5">
                <Icon n="instagram" size={13} /> {plan.nextAction.label}
              </a>
            )}
            {plan.nextAction.kind === 'retry_subscribe' && (
              <Button onClick={() => action('retry_subscribe')} disabled={busy === 'retry_subscribe'}>
                {busy === 'retry_subscribe' ? 'Ativando…' : plan.nextAction.label}
              </Button>
            )}
            {plan.nextAction.kind === 'reconnect' && canAuthorize && (
              <a href={data.authorizeUrl}
                className="text-xs font-semibold bg-[var(--brand)] text-white px-3 py-1.5 rounded-md shadow-brand hover:bg-[var(--brand-strong)] inline-flex items-center gap-1.5">
                <Icon n="instagram" size={13} /> {plan.nextAction.label}
              </a>
            )}
            {ig && !connected && ig.webhookSubscribedAt && (
              <button onClick={() => action('refresh')} disabled={busy === 'refresh'}
                className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-1.5 rounded-md hover:bg-zinc-50 disabled:opacity-50">
                {busy === 'refresh' ? 'Renovando…' : 'Renovar credencial'}
              </button>
            )}
            {ig && (
              <button onClick={() => action('disconnect')} disabled={busy === 'disconnect'}
                className="text-xs font-semibold bg-white border border-rose-200 text-rose-700 px-3 py-1.5 rounded-md hover:bg-rose-50 disabled:opacity-50">
                {busy === 'disconnect' ? 'Desconectando…' : 'Desconectar'}
              </button>
            )}
            <Link href={`/conversas?b=${businessId}${data.inbox.conversations > 0 ? '' : '&canal=instagram'}`}
              className="text-xs font-semibold text-[var(--brand-fg)] underline underline-offset-2">
              Abrir Conversas
            </Link>
          </div>

          {data.inbox.conversations > 0 && (
            <p className="text-[11px] text-zinc-500">
              {data.inbox.conversations} conversa(s) do Instagram · {data.inbox.open} aberta(s) · {data.inbox.unread} não lida(s)
            </p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-100 grid gap-3 sm:grid-cols-2">
          {plan.layers.map((layer) => <LayerCard key={layer.id} layer={layer} />)}
        </div>

        {/* O que a plataforma precisa cadastrar no app da Meta. Nada de segredo:
            a URL de retorno e o caminho do webhook são configuração pública. */}
        {plan.clientConfig && (
          <div className="px-4 pb-3">
            <p className="text-[11px] text-zinc-500">
              URL de retorno: <span className="font-mono">{plan.clientConfig.redirectUri}</span>
            </p>
            <p className="text-[11px] text-zinc-500">
              Webhook: <span className="font-mono">{plan.webhookPath}</span> · campos: <span className="font-mono">{plan.clientConfig.webhookFields.join(', ')}</span>
              {' '}· permissões: <span className="font-mono">{plan.clientConfig.scopes.join(', ')}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
