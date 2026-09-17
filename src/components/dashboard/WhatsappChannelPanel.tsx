'use client';
// ═══════════════════════════════════════════════════════════════
// CANAL WHATSAPP — estado da conexão (Canais & Integrações → Canais)
// ═══════════════════════════════════════════════════════════════
// CONECTAR um canal é configuração: mora aqui. A operação diária (ler e
// responder) mora em /conversas. Separar os dois verbos é o que impede uma
// tela de acumular "conectar" e "conversar" — o lojista conecta uma vez e
// depois só conversa.
//
// Nada foi inventado aqui: é o MESMO /api/whatsapp (action 'connect'), o mesmo
// checklist de variáveis de ambiente, o mesmo webhook e o mesmo link externo de
// contingência que existiam em /whatsapp. Mudou o endereço, não o comportamento.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import { humanDateTime } from '@/lib/tz';

export interface WaChannelData {
  status: 'not_connected' | 'pending' | 'connected';
  label: { state: string; label: string; detail: string };
  integration: { displayPhone: string; connectedAt: string; lastWebhookAt: string; requestedAt: string; phoneNumberId: string };
  server: { configured: boolean; missingEnv: string[]; envVars: readonly string[] };
  inbox: { conversations: number; open: number; unread: number };
  linkFallback: string;
}

export function WhatsappChannelPanel({ businessId }: { businessId: string }) {
  const [data, setData] = useState<WaChannelData | null>(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<WaChannelData>(`/api/whatsapp?businessId=${businessId}`, {
      scope: 'area', area: 'Canais',
    });
    if (!res.ok) { setError(res.message); return; }
    setData(res.data || null);
    setError('');
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function connect() {
    setBusy(true); setMsg(''); setError('');
    try {
      const res = await apiSend<{ message?: string; missingEnv?: string[] }>(
        '/api/whatsapp', 'POST', { businessId, action: 'connect', displayPhone: phone },
        { scope: 'action', area: 'Canais' },
      );
      const d = res.data || {};
      if (!res.ok) throw new Error(res.message + (d.missingEnv?.length ? ` Faltando: ${d.missingEnv.join(', ')}` : ''));
      setMsg(d.message || res.message || '');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível conectar.'); }
    finally { setBusy(false); }
  }

  if (!data) return <PageSkeleton />;

  const q = `?b=${businessId}`;
  const connected = data.status === 'connected';

  return (
    <div className="space-y-3">
      {msg && <p className="text-sm font-medium bg-zinc-900 text-white rounded-md px-3 py-2">{msg}</p>}
      {error && <p className="text-sm font-medium bg-amber-600 text-white rounded-md px-3 py-2">{error}</p>}

      <div className="bg-white border border-zinc-200">
        <div className="px-4 py-3 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">WhatsApp · estado da conexão</p>
            <p className="text-xs text-zinc-500 mt-0.5">{data.label.detail}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium border rounded-full px-2 py-0.5 ${
              connected
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-zinc-100 border-zinc-200 text-zinc-600'
            }`}>{data.label.label}</span>
            {connected && (
              <Link href={`/conversas${q}`} className="text-xs font-semibold bg-zinc-900 text-white rounded-md px-3 py-1.5">
                Abrir conversas
              </Link>
            )}
          </div>
        </div>

        {connected ? (
          <div className="px-4 py-4 grid sm:grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-zinc-500">Número exibido</p>
              <p className="text-sm font-semibold mt-0.5">{data.integration.displayPhone || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Conectado em</p>
              <p className="text-sm font-semibold mt-0.5">
                {data.integration.connectedAt
                  ? humanDateTime(data.integration.connectedAt.slice(0, 10), data.integration.connectedAt.slice(11, 16))
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Último evento recebido</p>
              <p className="text-sm font-semibold mt-0.5">
                {data.integration.lastWebhookAt
                  ? humanDateTime(data.integration.lastWebhookAt.slice(0, 10), data.integration.lastWebhookAt.slice(11, 16))
                  : '—'}
              </p>
            </div>
            <p className="sm:col-span-3 text-xs text-zinc-500">
              Inbox: {data.inbox.open} conversa(s) aberta(s) · {data.inbox.unread} não lida(s).
            </p>
          </div>
        ) : (
          <div className="px-6 py-8 text-center max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-md bg-zinc-900 text-white flex items-center justify-center mx-auto"><Icon n="whatsapp" size={24} /></div>
            <h3 className="font-semibold mt-4">WhatsApp ainda não conectado</h3>
            <p className="text-sm text-zinc-500 mt-1">Conecte sua conta oficial do WhatsApp para receber e responder conversas pelo InstaLink. Enquanto isso, os atalhos de link externo continuam funcionando.</p>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-2">
              <div className="flex items-center gap-2">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 99999-9999" aria-label="Número de WhatsApp" className="rounded-md border border-zinc-300 px-3 py-2 text-sm w-56" />
                <button onClick={connect} disabled={busy} className="text-sm font-semibold bg-zinc-900 text-white px-4 py-2 rounded-md disabled:opacity-50">{busy ? 'Registrando…' : 'Conectar WhatsApp'}</button>
              </div>
            </div>
            {data.linkFallback && (
              <a href={data.linkFallback} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 mt-4 underline">
                Abrir WhatsApp (link externo) <Icon n="external" size={12} />
              </a>
            )}
          </div>
        )}

        <details className="border-t border-zinc-200 text-left bg-zinc-50 p-3">
          <summary className="text-xs font-semibold cursor-pointer">O que falta no servidor</summary>
          <ul className="text-xs font-mono mt-2 space-y-1">
            {data.server.envVars.map((v) => (
              <li key={v} className={data.server.missingEnv.includes(v) ? 'text-amber-700' : 'text-emerald-700'}>{data.server.missingEnv.includes(v) ? '• ' : '✓ '}{v}</li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500 mt-2">Configure em Vercel → Settings → Environment Variables e reinicie. Webhook: <span className="font-mono">/api/whatsapp/webhook</span></p>
        </details>
      </div>
    </div>
  );
}
