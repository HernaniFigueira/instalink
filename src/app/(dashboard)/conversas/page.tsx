'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { humanDateTime } from '@/lib/tz';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import type { WaChannelData } from '@/components/dashboard/WhatsappChannelPanel';

// ═══════════════════════════════════════════════════════════════
// CONVERSAS — o inbox (operação diária)
// Era /whatsapp. A tela é o que o lojista abre todo dia: ler e responder.
// Conectar o canal é configuração e mora em Canais & Integrações
// (/canais?tab=canais) — daqui sai um único atalho claro, com a unidade
// preservada, em vez de um formulário de conexão no meio do inbox.
//
// A1.2 · Bloco 2:
//   • A tela fala de CANAL, não de WhatsApp: o estado vazio e os CTAs levam a
//     Canais & Integrações, e o dia a dia funciona para qualquer canal que a
//     plataforma conecte (o inbox não está preso conceitualmente a um
//     provedor).
//   • Busca contextual pela URL (?q=): /conversas?q=98765 abre já filtrando.
//     A busca é um filtro CLIENT-SIDE sobre a lista que a API já devolve
//     guardada (permissão 'whatsapp', escopo da unidade) — nenhum dado novo é
//     exposto, por isso é segura. `?q=` sobrevive a refresh e deep-link.
// ═══════════════════════════════════════════════════════════════
interface Conversation { id: string; name: string; phone: string; status: string; unread: number; lastMessageAt: string; lastMessagePreview: string; registered: boolean; }
interface Message { id: string; direction: 'in' | 'out'; body: string; status: string; at: string }

export default function ConversasPage() {
  const params = useSearchParams();
  const router = useRouter();
  const businessId = params.get('b') || '';
  // Busca = URL: deep-link (/conversas?q=telefone) abre já filtrada e o
  // refresh preserva o termo.
  const q = (params.get('q') || '').trim();
  const [data, setData] = useState<WaChannelData | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<{ conversation: Conversation; messages: Message[] } | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'open'>('all');

  // ── COMPOSER (A1.2 · Bloco 3): o envio usa a API EXISTENTE do inbox ──
  // POST /api/conversations { businessId, conversationId, body } — mesmo
  // contrato de antes, com tenant/business scoping e permissão 'whatsapp'
  // mantidos no servidor. Honestidade: enquanto envia, o botão desabilita;
  // qualquer falha (409 canal não conectado, 404, rede) aparece na tela e o
  // texto digitado NÃO se perde.
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    if (!active || sending) return;
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setSendError('');
    const res = await apiSend<{ message?: Message }>(
      '/api/conversations', 'POST',
      { businessId, conversationId: active.conversation.id, body: text },
      { scope: 'action', area: 'Conversas' },
    );
    setSending(false);
    if (!res.ok || !res.data?.message) {
      // Erro honesto: a mensagem do servidor (409 canal não conectado, etc.)
      // ou a mensagem amigável do wrapper — nunca um "enviado" falso.
      setSendError(res.message || 'Não foi possível enviar a mensagem.');
      return;
    }
    const sent = res.data.message;
    setActive((prev) => prev ? { conversation: { ...prev.conversation, lastMessagePreview: sent.body.slice(0, 120) }, messages: [...prev.messages, sent] } : prev);
    setConversations((list) => list.map((c) => c.id === active.conversation.id ? { ...c, lastMessagePreview: sent.body.slice(0, 120), lastMessageAt: sent.at } : c));
    setDraft('');
  }

  /** Escreve o termo de busca na URL (mantendo ?b= e o restante do estado). */
  function setQuery(next: string) {
    const qs = new URLSearchParams(params.toString());
    if (next.trim()) qs.set('q', next.trim());
    else qs.delete('q');
    if (businessId) qs.set('b', businessId);
    router.replace(`/conversas?${qs.toString()}`, { scroll: false });
  }

  // 403 → aviso amigável (a sessão continua); nada de skeleton infinito.
  const { denied, report } = useAreaLoad('Conversas');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<WaChannelData>(`/api/whatsapp?businessId=${businessId}`, { scope: 'area', area: 'Conversas' });
    if (!report(res)) return;
    setData(res.data || null);
    if (res.data?.status !== 'connected') { setConversations([]); return; }
    const conv = await apiGet<{ conversations?: Conversation[] }>(`/api/conversations?businessId=${businessId}`, { scope: 'area', area: 'Conversas' });
    setConversations(conv.ok ? (conv.data?.conversations || []) : []);
  }, [businessId, report]);

  useEffect(() => { load(); }, [load]);

  async function openConversation(id: string) {
    const res = await apiGet<{ conversation: Conversation; messages?: Message[] }>(
      `/api/conversations?businessId=${businessId}&id=${id}`, { scope: 'action', area: 'Conversas' },
    );
    if (res.ok && res.data) {
      setActive({ conversation: res.data.conversation, messages: res.data.messages || [] });
      setDraft('');
      setSendError('');
    } else if (!res.ok) setError(res.message);
  }

  if (denied) return <AccessDenied area="Conversas" />;
  if (!data) return <PageSkeleton />;
  const clientesQ = `?b=${businessId}`;
  // Link para o canal: mantém a unidade ativa (?b=) e abre já na aba Canais.
  const channelsHref = `/canais?tab=canais${businessId ? `&b=${businessId}` : ''}`;
  const connected = data.status === 'connected';
  // Busca (?q=): nome, telefone ou prévia da última mensagem — aplicada sobre
  // a lista já guardada por permissão/unidade (nenhum dado novo é exposto).
  const qLower = q.toLowerCase();
  const filtered = conversations.filter((c) => {
    if (filter === 'unread' && c.unread <= 0) return false;
    if (filter === 'open' && c.status !== 'open') return false;
    if (qLower) {
      const hay = `${c.name} ${c.phone} ${c.lastMessagePreview || ''}`.toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  // ── CANAL NÃO CONECTADO: inbox vazio honesto + a porta certa para conectar ──
  if (!connected) {
    return (
      <>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-base font-semibold">Conversas</h1>
            <p className="text-sm text-zinc-500 mt-0.5">As conversas com os seus clientes em um só lugar.</p>
          </div>
          <Link href={`/clientes${clientesQ}`} className="text-xs font-medium bg-white border border-zinc-200 rounded-md px-3 py-1.5">Ver clientes</Link>
        </div>
        {error && <p className="mb-3 text-sm font-medium bg-amber-600 text-white rounded-md px-3 py-2">{error}</p>}

        <div className="bg-white border border-zinc-200">
          <div className="px-6 py-12 text-center max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-md bg-zinc-100 text-zinc-500 flex items-center justify-center mx-auto"><Icon n="chat" size={24} /></div>
            <h2 className="font-semibold mt-4">Nenhuma conversa ainda</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Para receber e responder por aqui é preciso conectar um canal. {data.label.detail}
            </p>
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-2">
              <Link href={channelsHref} className="text-sm font-semibold bg-zinc-900 text-white px-4 py-2 rounded-md">
                Conectar canal
              </Link>
              {data.linkFallback && (
                <a href={data.linkFallback} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 underline">
                  Abrir WhatsApp (link externo) <Icon n="external" size={12} />
                </a>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-4">
              Nada é perdido enquanto o canal não está conectado: cadastros, agendamentos e leads continuam chegando normalmente.
            </p>
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
          <h1 className="text-base font-semibold">Conversas</h1>
          <p className="text-xs text-zinc-500">{data.inbox.open} abertas · {data.inbox.unread} não lidas · {data.integration.displayPhone && <span className="font-medium text-zinc-700">{data.integration.displayPhone}</span>}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={channelsHref} className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-full px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" /> Conectado
          </Link>
          <Link href={`/clientes${clientesQ}`} className="text-xs font-medium bg-white border border-zinc-200 rounded-md px-3 py-1.5">Clientes</Link>
        </div>
      </div>
      {error && <p className="mb-3 text-sm font-medium bg-amber-600 text-white rounded-md px-3 py-2">{error}</p>}

      <div className="bg-white border border-zinc-200 overflow-hidden">
        {/* Toolbar compacta */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-zinc-200 bg-zinc-50">
          <span className="text-xs font-semibold tracking-wide uppercase text-zinc-500 hidden sm:inline">Inbox</span>
          {/* Busca contextual (A1.2 · Bloco 2): estado na URL (?q=), filtro
              client-side sobre a lista já autorizada — deep-link e refresh
              preservam o termo. */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Icon n="search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou telefone…"
              aria-label="Buscar conversas"
              className="w-full bg-white border border-zinc-200 rounded-md pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:border-zinc-400"
            />
          </div>
          <div className="flex gap-1 ml-auto sm:ml-2">
            {(['all', 'unread', 'open'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`text-xs font-medium px-2.5 py-1 rounded-md border ${filter === f ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 text-zinc-600'}`}>
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
              {filtered.length === 0 ? (
                <p className="text-sm text-zinc-500 px-3 py-8 text-center">
                  {q ? `Nenhuma conversa para “${q}”.` : 'Nenhuma conversa neste filtro.'}
                </p>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {filtered.map((c) => (
                    <button key={c.id} onClick={() => openConversation(c.id)} className={cn('w-full text-left px-3 py-2.5 hover:bg-zinc-50 flex flex-col gap-0.5', active?.conversation.id === c.id && 'bg-zinc-50')} aria-current={active?.conversation.id === c.id}>
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
                  <Link href={`/clientes${clientesQ}`} className="text-xs font-medium text-zinc-600 hover:underline shrink-0">Histórico 360</Link>
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
                <div className="p-2 border-t border-zinc-200 bg-white">
                  {sendError && <p role="alert" className="mb-2 text-xs font-medium bg-amber-600 text-white rounded-md px-2.5 py-1.5">{sendError}</p>}
                  <form onSubmit={sendMessage} className="flex gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Escreva uma mensagem…"
                      aria-label="Mensagem"
                      className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                    />
                    {/* O botão só parece funcional quando é: desabilitado sem
                        texto e durante o envio — nunca um "Enviar" de mentira. */}
                    <button type="submit" disabled={sending || !draft.trim()}
                      className="text-sm font-semibold bg-zinc-900 text-white px-4 py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed">
                      {sending ? 'Enviando…' : 'Enviar'}
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
                <div className="w-10 h-10 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="chat" size={20} /></div>
                <p className="text-sm font-semibold mt-3">Selecione uma conversa</p>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm">Cada mensagem vira histórico do cliente. O assistente pode responder com os dados do negócio.</p>
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
                    <Link href={`/clientes${clientesQ}`} className="block text-xs font-medium bg-white border border-zinc-200 rounded-md px-3 py-2 hover:bg-zinc-50">Ver histórico 360</Link>
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
