'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { humanDateTime } from '@/lib/tz';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';

interface Conversation { id: string; name: string; phone: string; status: string; unread: number; lastMessageAt: string; lastMessagePreview: string; registered: boolean; }
interface Message { id: string; direction: 'in' | 'out'; body: string; status: string; at: string }
interface WaData {
  status: 'not_connected' | 'pending' | 'connected';
  label: { state: string; label: string; detail: string };
  integration: { displayPhone: string; connectedAt: string; lastWebhookAt: string; requestedAt: string; phoneNumberId: string };
  server: { configured: boolean; missingEnv: string[]; envVars: readonly string[] };
  inbox: { conversations: number; open: number; unread: number };
  linkFallback: string;
}

export default function WhatsappPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [data, setData] = useState<WaData | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<{ conversation: Conversation; messages: Message[] } | null>(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'open'>('all');

  // 403 → aviso amigável (a sessão continua); nada de skeleton infinito.
  const { denied, report } = useAreaLoad('WhatsApp');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<WaData>(`/api/whatsapp?businessId=${businessId}`, { scope: 'area', area: 'WhatsApp' });
    if (!report(res)) return;
    setData(res.data);
    const conv = await apiGet<{ conversations?: Conversation[] }>(`/api/conversations?businessId=${businessId}`, { scope: 'area', area: 'WhatsApp' });
    setConversations(conv.ok ? (conv.data?.conversations || []) : []);
  }, [businessId, report]);

  useEffect(() => { load(); }, [load]);

  async function openConversation(id: string) {
    const res = await apiGet<{ conversation: Conversation; messages?: Message[] }>(
      `/api/conversations?businessId=${businessId}&id=${id}`, { scope: 'action', area: 'WhatsApp' },
    );
    if (res.ok && res.data) setActive({ conversation: res.data.conversation, messages: res.data.messages || [] });
    else if (!res.ok) setError(res.message);
  }

  async function connect() {
    setBusy(true); setMsg(''); setError('');
    try {
      const res = await apiSend<{ message?: string; missingEnv?: string[] }>(
        '/api/whatsapp', 'POST', { businessId, action: 'connect', displayPhone: phone },
        { scope: 'action', area: 'WhatsApp' },
      );
      const d = res.data || {};
      if (!res.ok) throw new Error(res.message + (d.missingEnv?.length ? ` Faltando: ${d.missingEnv.join(', ')}` : ''));
      setMsg(d.message || res.message || '');
      load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  if (denied) return <AccessDenied area="WhatsApp" />;
  if (!data) return <PageSkeleton />;
  const q = `?b=${businessId}`;
  const connected = data.status === 'connected';
  const filtered = conversations.filter((c) => {
    if (filter === 'unread') return c.unread > 0;
    if (filter === 'open') return c.status === 'open';
    return true;
  });

  // ── NÃO CONECTADO: workspace vazio, sem inbox falsa ──
  if (!connected) {
    return (
      <>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-base font-semibold">WhatsApp</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Central de conversas — conecta quando quiser.</p>
          </div>
          <Link href={`/clientes${q}`} className="text-xs font-medium bg-white border border-zinc-200 rounded-md px-3 py-1.5">Ver clientes</Link>
        </div>
        {msg && <p className="mb-3 text-sm font-medium bg-zinc-900 text-white rounded-md px-3 py-2">{msg}</p>}
        {error && <p className="mb-3 text-sm font-medium bg-amber-600 text-white rounded-md px-3 py-2">{error}</p>}

        <div className="bg-white border border-zinc-200">
          <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
            <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Estado da conexão</p>
            <span className="text-xs font-medium bg-zinc-100 border border-zinc-200 rounded-full px-2 py-0.5">{data.label.label}</span>
          </div>
          <div className="px-6 py-10 text-center max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-md bg-zinc-900 text-white flex items-center justify-center mx-auto"><Icon n="whatsapp" size={24} /></div>
            <h2 className="font-semibold mt-4">WhatsApp ainda não conectado</h2>
            <p className="text-sm text-zinc-500 mt-1">Conecte sua conta oficial do WhatsApp para receber e responder conversas pelo InstaLink. Enquanto isso, os atalhos de link externo continuam funcionando.</p>
            <p className="text-xs text-zinc-500 mt-2">{data.label.detail}</p>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-2">
              <div className="flex items-center gap-2">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 99999-9999" className="rounded-md border border-zinc-300 px-3 py-2 text-sm w-56" />
                <button onClick={connect} disabled={busy} className="text-sm font-semibold bg-zinc-900 text-white px-4 py-2 rounded-md disabled:opacity-50">{busy ? 'Registrando…' : 'Conectar WhatsApp'}</button>
              </div>
            </div>
            {data.linkFallback && <a href={data.linkFallback} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 mt-4 underline">Abrir WhatsApp (link externo) <Icon n="external" size={12} /></a>}
            <details className="mt-6 text-left bg-zinc-50 border border-zinc-200 rounded-md p-3">
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
      </>
    );
  }

  // ── CONECTADO: workspace 3 colunas ──
  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="text-base font-semibold">WhatsApp</h1>
          <p className="text-xs text-zinc-500">{data.inbox.open} abertas · {data.inbox.unread} não lidas · {data.integration.displayPhone && <span className="font-medium text-zinc-700">{data.integration.displayPhone}</span>}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-full px-2.5 py-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-600" /> Conectado</span>
          <Link href={`/clientes${q}`} className="text-xs font-medium bg-white border border-zinc-200 rounded-md px-3 py-1.5">Clientes</Link>
        </div>
      </div>
      {msg && <p className="mb-3 text-sm font-medium bg-emerald-600 text-white rounded-md px-3 py-2">{msg}</p>}
      {error && <p className="mb-3 text-sm font-medium bg-amber-600 text-white rounded-md px-3 py-2">{error}</p>}

      <div className="bg-white border border-zinc-200 overflow-hidden">
        {/* Toolbar compacta */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 bg-zinc-50">
          <span className="text-xs font-semibold tracking-wide uppercase text-zinc-500 hidden sm:inline">Inbox</span>
          <div className="flex gap-1 ml-auto sm:ml-2">
            {(['all', 'unread', 'open'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`text-xs font-medium px-2.5 py-1 rounded-md border ${filter === f ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 text-zinc-600'}`}>
                {f === 'all' ? 'Todas' : f === 'unread' ? 'Não lidas' : 'Em atendimento'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-[260px_1fr_240px] min-h-[480px] divide-y lg:divide-y-0 lg:divide-x divide-zinc-200">
          {/* Col 1: Conversas */}
          <div className="flex flex-col min-h-[280px] lg:min-h-0">
            <div className="px-3 py-2 border-b border-zinc-100 bg-white">
              <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Conversas · {filtered.length}</p>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[320px] lg:max-h-[520px]">
              {filtered.length === 0 ? <p className="text-sm text-zinc-500 px-3 py-8 text-center">Nenhuma conversa neste filtro.</p> : (
                <div className="divide-y divide-zinc-100">
                  {filtered.map((c) => (
                    <button key={c.id} onClick={() => openConversation(c.id)} className={cn('w-full text-left px-3 py-2.5 hover:bg-zinc-50 flex flex-col gap-0.5', active?.conversation.id === c.id && 'bg-zinc-50')}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{c.name}</span>
                        {c.unread > 0 && <span className="text-xs font-bold bg-zinc-900 text-white px-1.5 py-0.5 rounded-full shrink-0">{c.unread}</span>}
                      </span>
                      <span className="text-xs text-zinc-500 truncate">{c.lastMessagePreview || c.phone}</span>
                      <span className="text-xs text-zinc-400">{c.phone}{c.registered ? ' · cliente' : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Col 2: Conversa */}
          <div className="flex flex-col min-h-[320px]">
            {active ? (
              <>
                <div className="px-3 py-2 border-b border-zinc-100 flex items-center justify-between gap-2 bg-white">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{active.conversation.name}</p>
                    <p className="text-xs text-zinc-500 truncate">{active.conversation.phone}{active.conversation.registered ? ' · cliente ✓' : ''}</p>
                  </div>
                  <Link href={`/clientes${q}`} className="text-xs font-medium text-zinc-600 hover:underline shrink-0">Histórico 360</Link>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-zinc-50 max-h-[360px] lg:max-h-[420px]">
                  {active.messages.map((m) => (
                    <div key={m.id} className={m.direction === 'out' ? 'flex justify-end' : 'flex justify-start'}>
                      <div className={cn('max-w-[78%] px-3 py-2 rounded-lg text-sm', m.direction === 'out' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200')}>
                        {m.body}
                        <span className="block text-xs opacity-60 mt-1">{m.at.slice(11, 16)} · {m.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-2 border-t border-zinc-200 bg-white flex gap-2">
                  <input placeholder="Escreva uma mensagem…" className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                  <button className="text-sm font-semibold bg-zinc-900 text-white px-4 py-2 rounded-md">Enviar</button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
                <div className="w-10 h-10 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="whatsapp" size={20} /></div>
                <p className="text-sm font-semibold mt-3">Selecione uma conversa</p>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm">Cada mensagem vira histórico do cliente. O agente pode responder com os dados do negócio.</p>
              </div>
            )}
          </div>

          {/* Col 3: Contato */}
          <div className="bg-zinc-50">
            {active ? (
              <div className="p-3 space-y-3">
                <div className="bg-white border border-zinc-200 p-3">
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Contato</p>
                  <p className="text-sm font-semibold mt-1">{active.conversation.name}</p>
                  <p className="text-xs text-zinc-500">{active.conversation.phone}</p>
                  <span className={`inline-block mt-2 text-xs font-medium px-1.5 py-0.5 rounded border ${active.conversation.registered ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 text-zinc-600'}`}>{active.conversation.registered ? 'Cliente cadastrado' : 'Lead'}</span>
                </div>
                <div className="bg-white border border-zinc-200 p-3">
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Atalhos</p>
                  <div className="space-y-1.5">
                    <Link href={`/clientes${q}`} className="block text-xs font-medium bg-white border border-zinc-200 rounded-md px-3 py-2 hover:bg-zinc-50">Ver histórico 360</Link>
                    <a href={data.linkFallback} target="_blank" rel="noreferrer" className="block text-xs font-medium bg-white border border-zinc-200 rounded-md px-3 py-2 hover:bg-zinc-50 inline-flex items-center gap-1.5">
                      Abrir no WhatsApp <Icon n="external" size={12} />
                    </a>
                  </div>
                </div>
                <div className="text-xs text-zinc-500 px-1">
                  <p>Última mensagem: {active.conversation.lastMessageAt ? humanDateTime(active.conversation.lastMessageAt.slice(0, 10), active.conversation.lastMessageAt.slice(11, 16)) : '—'}</p>
                </div>
              </div>
            ) : (
              <div className="p-6 text-center">
                <p className="text-xs text-zinc-500">Escolha uma conversa para ver o contato.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
