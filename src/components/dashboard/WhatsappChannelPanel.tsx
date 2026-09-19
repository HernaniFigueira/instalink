'use client';
// ═══════════════════════════════════════════════════════════════
// CANAL WHATSAPP — estado da conexão (Canais & Integrações → Canais)
// ═══════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import { humanDateTime } from '@/lib/tz';

export interface WaChannelData {
  status: 'not_connected' | 'pending' | 'connected' | 'error';
  label: { state: string; label: string; detail: string };
  integration: {
    displayPhone: string;
    connectedAt: string;
    lastWebhookAt: string;
    lastInboundAt?: string;
    lastOutboundAt?: string;
    lastError?: string;
    requestedAt: string;
    phoneNumberId: string;
    wabaId?: string;
  };
  diagnostics?: {
    credentialsConfigured: boolean;
    credentialSource: string;
    hasPhoneNumberId: boolean;
    hasWabaId: boolean;
    webhookReceived: boolean;
    lastInboundAt: string;
    lastOutboundAt: string;
    recentError: string;
  };
  server: { configured: boolean; missingEnv: string[]; envVars: readonly string[] };
  inbox: { conversations: number; open: number; unread: number };
  linkFallback: string;
}

export function WhatsappChannelPanel({ businessId }: { businessId: string }) {
  const [data, setData] = useState<WaChannelData | null>(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
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

  async function testConnection() {
    setTesting(true); setMsg(''); setError('');
    try {
      const res = await apiSend<{ message?: string; verifiedName?: string }>(
        '/api/whatsapp', 'POST', { businessId, action: 'test' },
        { scope: 'action', area: 'Canais' },
      );
      if (!res.ok) throw new Error(res.message || 'Falha ao testar conexão.');
      setMsg(`Conexão confirmada com a Meta! Nome verificado: ${res.data?.verifiedName || 'Sim'}`);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao testar conexão.'); }
    finally { setTesting(false); }
  }

  async function disconnect() {
    if (!confirm('Tem certeza que deseja desconectar a conta do WhatsApp desta unidade?')) return;
    setBusy(true); setMsg(''); setError('');
    try {
      const res = await apiSend<{ message?: string }>(
        '/api/whatsapp', 'POST', { businessId, action: 'disconnect' },
        { scope: 'action', area: 'Canais' },
      );
      if (!res.ok) throw new Error(res.message || 'Não foi possível desconectar.');
      setMsg('WhatsApp desconectado com sucesso.');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao desconectar.'); }
    finally { setBusy(false); }
  }

  if (!data) return <PageSkeleton />;

  const q = `?b=${businessId}`;
  const status = data.status;
  const connected = status === 'connected';

  return (
    <div className="space-y-3">
      {msg && <p className="text-sm font-medium bg-emerald-700 text-white rounded-md px-3 py-2">{msg}</p>}
      {error && <p className="text-sm font-medium bg-amber-600 text-white rounded-md px-3 py-2">{error}</p>}

      <div className="bg-white border border-zinc-200">
        <div className="px-4 py-3 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">WhatsApp · estado da conexão</p>
            <p className="text-xs text-zinc-500 mt-0.5">{data.label.detail}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium border rounded-full px-2 py-0.5 ${
              status === 'connected'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : status === 'pending'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : status === 'error'
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-zinc-100 border-zinc-200 text-zinc-600'
            }`}>
              {status === 'connected' ? 'Conectado' : status === 'pending' ? 'Configurando' : status === 'error' ? 'Erro' : 'Não conectado'}
            </span>
            {connected && (
              <Link href={`/conversas${q}`} className="text-xs font-semibold bg-zinc-900 text-white rounded-md px-3 py-1.5">
                Abrir Conversas
              </Link>
            )}
          </div>
        </div>

        {connected ? (
          <div className="px-4 py-4 space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-zinc-500">Número</p>
                <p className="text-sm font-semibold mt-0.5">{data.integration.displayPhone || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Phone Number ID</p>
                <p className="text-sm font-mono text-zinc-700 mt-0.5">{data.integration.phoneNumberId || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">WABA ID</p>
                <p className="text-sm font-mono text-zinc-700 mt-0.5">{data.integration.wabaId || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Último webhook</p>
                <p className="text-sm font-semibold mt-0.5">
                  {data.integration.lastWebhookAt
                    ? humanDateTime(data.integration.lastWebhookAt.slice(0, 10), data.integration.lastWebhookAt.slice(11, 16))
                    : 'Nenhum evento recebido'}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Última mensagem recebida</p>
                <p className="text-sm font-semibold mt-0.5">
                  {data.integration.lastInboundAt
                    ? humanDateTime(data.integration.lastInboundAt.slice(0, 10), data.integration.lastInboundAt.slice(11, 16))
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Última mensagem enviada</p>
                <p className="text-sm font-semibold mt-0.5">
                  {data.integration.lastOutboundAt
                    ? humanDateTime(data.integration.lastOutboundAt.slice(0, 10), data.integration.lastOutboundAt.slice(11, 16))
                    : '—'}
                </p>
              </div>
            </div>

            {data.integration.lastError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-md p-2.5 text-xs">
                <span className="font-semibold">Erro recente:</span> {data.integration.lastError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-100">
              <Link href={`/conversas${q}`} className="text-xs font-semibold bg-zinc-900 text-white rounded-md px-3 py-1.5">
                Abrir Conversas
              </Link>
              <button
                onClick={testConnection}
                disabled={testing}
                className="text-xs font-medium bg-white border border-zinc-300 text-zinc-700 rounded-md px-3 py-1.5 hover:bg-zinc-50 disabled:opacity-50"
              >
                {testing ? 'Testando…' : 'Testar conexão'}
              </button>
              <button
                onClick={disconnect}
                disabled={busy}
                className="text-xs font-medium text-rose-700 border border-rose-200 bg-rose-50 rounded-md px-3 py-1.5 hover:bg-rose-100 disabled:opacity-50 ml-auto"
              >
                Desconectar
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-8 text-center max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-md bg-zinc-900 text-white flex items-center justify-center mx-auto"><Icon n="whatsapp" size={24} /></div>
            <h3 className="font-semibold mt-4">
              {status === 'error' ? 'Erro na conexão do WhatsApp' : 'WhatsApp não conectado'}
            </h3>
            <p className="text-sm text-zinc-500 mt-1">
              {status === 'error'
                ? data.integration.lastError || 'Houve uma falha na autenticação da conta junto à Meta.'
                : 'Conecte sua conta oficial do WhatsApp Business Cloud API para receber mensagens e agendamentos.'}
            </p>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-2">
              <div className="flex items-center gap-2">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 99999-9999" aria-label="Número de WhatsApp" className="rounded-md border border-zinc-300 px-3 py-2 text-sm w-56" />
                <button onClick={connect} disabled={busy} className="text-sm font-semibold bg-zinc-900 text-white px-4 py-2 rounded-md disabled:opacity-50">{busy ? 'Validando…' : 'Conectar WhatsApp'}</button>
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
          <summary className="text-xs font-semibold cursor-pointer">Diagnóstico técnico</summary>
          <ul className="text-xs font-mono mt-2 space-y-1">
            {data.server.envVars.map((v) => (
              <li key={v} className={data.server.missingEnv.includes(v) ? 'text-amber-700' : 'text-emerald-700'}>{data.server.missingEnv.includes(v) ? '• ' : '✓ '}{v}</li>
            ))}
          </ul>
          <p className="text-xs text-zinc-500 mt-2">Webhook URL da Meta: <span className="font-mono text-zinc-800">/api/whatsapp/webhook</span></p>
        </details>
      </div>
    </div>
  );
}
