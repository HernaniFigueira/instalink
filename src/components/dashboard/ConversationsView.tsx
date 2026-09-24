'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { humanDateTime } from '@/lib/tz';
import { AccessDenied, AreaLoadError, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { INSTAGRAM_TEXT_MAX_BYTES, instagramTextBytes, instagramTextFits, instagramTextLimitError } from '@/lib/instagram';
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
interface Conversation {
  id: string; name: string; phone: string; status: string;
  mode?: 'automation' | 'human';
  agentState?: 'ai_active' | 'waiting_patient' | 'waiting_team' | 'human_active' | 'resolved';
  agentStateLabel?: string;
  handoff?: { at: string; summary: string; intent?: string; actions?: string[] } | null;
  unread: number; lastMessageAt: string; lastMessagePreview: string;
  outreachOrigin?: string;
  registered: boolean; channel?: 'whatsapp' | 'instagram' | 'agent'; channelUsername?: string;
}
interface ChannelsView { whatsapp: boolean; instagram: boolean }
interface InstagramInbox { connected: boolean; label: string; tone: 'ok' | 'pending' | 'error' | 'off'; username: string }
interface MessageWindow { phase: 'open' | 'human_agent' | 'closed' | 'unknown'; canReply: boolean; reason: string }
interface SideContext {
  tutor: { name: string; phone: string; registered: boolean };
  pets: Array<{ id: string; name: string; species: string }>;
  currentPatient?: { id: string; name: string };
  phone: string;
  nextAppointment?: { date: string; time: string; service: string };
  lastService?: string;
  responsible?: string;
  lead?: { id: string; stage?: string };
  channel: string;
}
interface Message { id: string; direction: 'in' | 'out'; body: string; status: string; by?: string; byName?: string; error?: string; at: string; meta?: { simulator?: boolean; provider?: string }; }

export function ConversationsView({ unitId, panel = false }: { unitId?: string; panel?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const businessId = unitId || params.get('b') || '';
  const [panelQuery,setPanelQuery] = useState('');
  const [panelChannel,setPanelChannel] = useState('all');
  // Busca = URL: deep-link (/conversas?q=telefone) abre já filtrada e o
  // refresh preserva o termo.
  const q = (panel ? panelQuery : params.get('q') || '').trim();
  const [data, setData] = useState<WaChannelData | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<{ conversation: Conversation; messages: Message[] } | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'open'>('all');
  // BLOCO 9 — o inbox é de CANAIS: o filtro por canal vive na URL (?canal=),
  // como a busca, para deep-link e refresh preservarem a visão.
  const [channels, setChannels] = useState<ChannelsView>({ whatsapp: false, instagram: false });
  const [igInfo, setIgInfo] = useState<InstagramInbox | null>(null);
  const [window, setWindow] = useState<MessageWindow | null>(null);
  // Conversa de uma conta do Instagram que não é mais a conectada: histórico
  // visível, envio bloqueado (o texto abaixo explica o porquê).
  const [accountMismatch, setAccountMismatch] = useState('');
  // F3-F — contexto lateral administrativo (nunca prontuário)
  const [side, setSide] = useState<SideContext | null>(null);

  // ── COMPOSER: envio real pelo conector oficial ──
  const [draft, setDraftState] = useState('');
  const drafts = useRef<Record<string,string>>({});
  function setDraft(value: string) { if (active) drafts.current[active.conversation.id] = value; setDraftState(value); }
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [switchingMode, setSwitchingMode] = useState(false);

  async function toggleMode() {
    if (!active || switchingMode) return;
    const st = active.conversation.agentState || (active.conversation.mode === 'human' ? 'human_active' : 'ai_active');
    const goingAi = st === 'human_active' || st === 'waiting_team';
    const targetMode: 'automation' | 'human' = goingAi ? 'automation' : 'human';
    setSwitchingMode(true);
    try {
      const res = await apiSend<{ mode: 'automation' | 'human'; agentState?: string; agentStateLabel?: string }>(
        '/api/conversations', 'POST',
        {
          businessId,
          conversationId: active.conversation.id,
          action: goingAi ? 'resume_ai' : 'pause_ai',
          mode: targetMode,
        },
        { scope: 'action', area: 'Conversas' },
      );
      if (res.ok) {
        const nextMode = targetMode;
        const nextAgentState = (res.data?.agentState as Conversation['agentState'])
          || (goingAi ? 'ai_active' as const : 'human_active' as const);
        setActive((prev) => prev ? { ...prev, conversation: { ...prev.conversation, mode: nextMode, agentState: nextAgentState, agentStateLabel: res.data?.agentStateLabel } } : prev);
        setConversations((list) => list.map((c) => c.id === active.conversation.id ? { ...c, mode: nextMode, agentState: nextAgentState, agentStateLabel: res.data?.agentStateLabel } : c));
      }
    } finally {
      setSwitchingMode(false);
    }
  }

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    if (!active || sending || !(active.conversation.channel === 'instagram' ? channels.instagram : channels.whatsapp)) return;
    const text = draft.trim();
    if (!text) return;
    // Limite oficial do Instagram medido em BYTES: recusa aqui (e no servidor)
    // para o histórico nunca mostrar um texto diferente do que saiu.
    if (active.conversation.channel === 'instagram' && !instagramTextFits(text, INSTAGRAM_TEXT_MAX_BYTES)) {
      setSendError(instagramTextLimitError(INSTAGRAM_TEXT_MAX_BYTES));
      return;
    }
    setSending(true);
    setSendError('');
    const res = await apiSend<{ message?: Message }>(
      '/api/conversations', 'POST',
      { businessId, conversationId: active.conversation.id, body: text },
      { scope: 'action', area: 'Conversas' },
    );
    setSending(false);
    if (!res.ok || !res.data?.message) {
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
    if (panel) { setPanelQuery(next); return; }
    const qs = new URLSearchParams(params.toString());
    if (next.trim()) qs.set('q', next.trim());
    else qs.delete('q');
    if (businessId) qs.set('b', businessId);
    router.replace(`/conversas?${qs.toString()}`, { scroll: false });
  }

  // 403 → aviso amigável (a sessão continua); nada de skeleton infinito.
  const { denied, failed, report } = useAreaLoad('Conversas');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<WaChannelData>(`/api/whatsapp?businessId=${businessId}`, { scope: 'area', area: 'Conversas' });
    if (!report(res)) return;
    setData(res.data || null);
    // A lista é do INBOX (todos os canais). Antes desta entrega o inbox só
    // existia se o WhatsApp estivesse conectado; agora a pergunta certa é
    // "existe algum canal conectado?".
    const conv = await apiGet<{
      conversations?: Conversation[]; channels?: ChannelsView; instagram?: InstagramInbox;
    }>(`/api/conversations?businessId=${businessId}`, { scope: 'area', area: 'Conversas' });
    if (!conv.ok || !conv.data) { report(conv); return; }
    setConversations(conv.data.conversations || []);
    setChannels(conv.data.channels || { whatsapp: false, instagram: false });
    setIgInfo(conv.data.instagram || null);
  }, [businessId, report]);

  useEffect(() => { load(); }, [load]);

  async function openConversation(id: string) {
    const res = await apiGet<{
      conversation: Conversation; messages?: Message[]; window?: MessageWindow | null;
      accountMismatch?: boolean; accountMismatchMessage?: string;
      sideContext?: SideContext | null;
    }>(`/api/conversations?businessId=${businessId}&id=${id}`, { scope: 'action', area: 'Conversas' });
    if (res.ok && res.data) {
      setActive({ conversation: res.data.conversation, messages: res.data.messages || [] });
      setWindow(res.data.conversation.channel === 'instagram' ? (res.data.window || null) : null);
      setAccountMismatch(res.data.accountMismatchMessage || '');
      setDraftState(drafts.current[id] || '');
      setSendError('');
      setSide(res.data.sideContext || null);
    } else if (!res.ok) setError(res.message);
  }

  if (denied) return <AccessDenied area="Conversas" />;
  if (failed) return <AreaLoadError area="Conversas" message={failed} onRetry={load} />;
  if (!data) return <PageSkeleton />;
  const clientesQ = `?b=${businessId}`;
  // Link para o canal: mantém a unidade ativa (?b=) e abre já na aba Canais.
  const channelsHref = `/canais?tab=canais${businessId ? `&b=${businessId}` : ''}`;
  const channelFilter = (panel ? panelChannel : params.get('canal') || 'all') as 'all' | 'whatsapp' | 'instagram';
  // Contador do limite do Instagram (aviso discreto perto do teto).
  const igComposer = active?.conversation.channel === 'instagram';
  const draftBytes = igComposer ? instagramTextBytes(draft) : 0;
  // Um canal é mostrado quando existe conexão OU conversa dele (histórico
  // antigo continua visível mesmo se a conta foi desconectada).
  const hasInstagram = channels.instagram || conversations.some((c) => c.channel === 'instagram');
  const hasWhatsapp = channels.whatsapp || conversations.some((c) => c.channel === 'whatsapp');
  const anyChannel = channels.whatsapp || channels.instagram;
  // Busca (?q=): nome, telefone ou prévia da última mensagem — aplicada sobre
  // a lista já guardada por permissão/unidade (nenhum dado novo é exposto).
  const qLower = q.toLowerCase();
  const filtered = conversations.filter((c) => {
    if (channelFilter !== 'all' && (c.channel || 'whatsapp') !== channelFilter) return false;
    if (filter === 'unread' && c.unread <= 0) return false;
    if (filter === 'open' && c.status !== 'open') return false;
    if (qLower) {
      const hay = `${c.name} ${c.phone} ${c.lastMessagePreview || ''}`.toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  /** Escreve o filtro de canal na URL (mesmo padrão da busca). */
  function setChannelFilter(next: 'all' | 'whatsapp' | 'instagram') {
    if (panel) { setPanelChannel(next); return; }
    const qs = new URLSearchParams(params.toString());
    if (next === 'all') qs.delete('canal');
    else qs.set('canal', next);
    if (businessId) qs.set('b', businessId);
    router.replace(`/conversas?${qs.toString()}`, { scroll: false });
  }

  // ── NENHUM CANAL CONECTADO: inbox vazio honesto + a porta certa ──
  if (!anyChannel && conversations.length === 0) {
    return (
      <div className="conversation-view" data-panel={panel} data-active={false}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-start gap-2.5">
            <span className="w-9 h-9 shrink-0 rounded-lg bg-[var(--brand)] text-white flex items-center justify-center shadow-md">
              <Icon n="inbox" size={18} />
            </span>
            <div>
              <h1 className="text-base font-semibold text-[var(--text)] leading-tight">Conversas</h1>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">As conversas com os seus clientes em um só lugar.</p>
            </div>
          </div>
          <Link href={`/clientes${clientesQ}`} className="text-xs font-semibold bg-white border border-[var(--border-strong)] text-[var(--text)] rounded-md px-3 py-1.5 shadow-xs hover:bg-[var(--surface-hover)]">Ver clientes</Link>
        </div>
        {error && <p role="alert" className="mb-3 text-sm font-semibold bg-[var(--warning-bg)] border border-[var(--warning-border)] text-[var(--warning-fg)] rounded-md px-3 py-2">{error}</p>}

        <div className="ws-panel">
          <div className="il-empty max-w-lg mx-auto">
            <div className="il-empty__icon"><Icon n="chat" size={24} /></div>
            <h2 className="font-semibold text-[var(--text)]">Nenhuma conversa ainda</h2>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Para receber e responder por aqui é preciso conectar um canal. {data.label.detail}
            </p>
            <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-2">
              <Link href={channelsHref} className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold bg-[var(--brand)] text-white px-4 py-2 rounded-md border border-[var(--brand-strong)]/40 shadow-brand hover:bg-[var(--brand-strong)]">
                <Icon n="plugs" size={15} /> Conectar canal
              </Link>
              {data.linkFallback && (
                <a href={data.linkFallback} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--brand-fg)] underline underline-offset-2">
                  Abrir WhatsApp (link externo) <Icon n="external" size={12} />
                </a>
              )}
            </div>
            <p className="text-xs text-[var(--text-faint)] mt-4">
              Nada é perdido enquanto o canal não está conectado: cadastros, agendamentos e leads continuam chegando normalmente.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── CONECTADO: workspace 3 colunas ──
  return (
    <div className="conversation-view" data-panel={panel} data-active={!!active}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="w-9 h-9 shrink-0 rounded-lg bg-[var(--brand)] text-white flex items-center justify-center shadow-md">
            <Icon n="inbox" size={18} />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-[var(--text)] leading-tight">Conversas</h1>
            <p className="text-xs text-[var(--text-muted)]">
              {data.inbox.open} abertas · {data.inbox.unread} não lidas
              {channels.whatsapp && data.integration.displayPhone && <> · <span className="font-semibold text-[var(--text)]">{data.integration.displayPhone}</span></>}
              {channels.instagram && igInfo?.username && <> · <span className="font-semibold text-[var(--text)]">@{igInfo.username}</span></>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {channels.whatsapp && (
            <Link href={channelsHref} className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success-fg)] rounded-pill px-2.5 py-1 shadow-xs">
              <Icon n="whatsapp" size={12} /> WhatsApp conectado
            </Link>
          )}
          {channels.instagram && (
            <Link href={channelsHref} className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success-fg)] rounded-pill px-2.5 py-1 shadow-xs">
              <Icon n="instagram" size={12} /> Instagram conectado
            </Link>
          )}
          {!channels.whatsapp && hasInstagram && (
            <Link href={channelsHref} className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold bg-[var(--warning-bg)] border border-[var(--warning-border)] text-[var(--warning-fg)] rounded-pill px-2.5 py-1 shadow-xs">
              <Icon n="whatsapp" size={12} /> WhatsApp não conectado
            </Link>
          )}
          <Link href={`/clientes${clientesQ}`} className="text-xs font-semibold bg-white border border-[var(--border-strong)] text-[var(--text)] rounded-md px-3 py-1.5 shadow-xs hover:bg-[var(--surface-hover)]">
            Ver clientes
          </Link>
        </div>
      </div>
      {error && <p role="alert" className="mb-3 text-sm font-semibold bg-[var(--warning-bg)] border border-[var(--warning-border)] text-[var(--warning-fg)] rounded-md px-3 py-2">{error}</p>}

      <div className="ws-panel overflow-hidden">
        {/* Toolbar compacta */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)] hidden sm:inline">Inbox</span>
          {/* Busca contextual (A1.2 · Bloco 2): estado na URL (?q=), filtro
              client-side sobre a lista já autorizada — deep-link e refresh
              preservam o termo. */}
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Icon n="search" size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input
              value={q}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou telefone…"
              aria-label="Buscar conversas"
              className="w-full bg-white border border-[var(--border-strong)] rounded-md pl-7 pr-3 py-1.5 text-xs shadow-xs focus:outline-none focus:shadow-focus focus:border-[var(--brand)]"
            />
          </div>
          {/* Filtro por CANAL (chip): aparece só para quem tem mais de um canal
              ou tem histórico do segundo — nada de chip vazio. */}
          {(hasWhatsapp && hasInstagram) && (
            <div className="flex gap-1" role="group" aria-label="Filtrar por canal">
              {([
                { id: 'all', label: 'Todos' },
                { id: 'whatsapp', label: 'WhatsApp' },
                { id: 'instagram', label: 'Instagram' },
              ] as const).map((c) => (
                <button key={c.id} onClick={() => setChannelFilter(c.id)} aria-pressed={channelFilter === c.id}
                  className="il-chip">
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1 ml-auto sm:ml-2">
            {(['all', 'unread', 'open'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className="il-chip">
                {f === 'all' ? 'Todas' : f === 'unread' ? 'Não lidas' : 'Em atendimento'}
              </button>
            ))}
          </div>
        </div>

        <div className="inbox-layout grid lg:grid-cols-[280px_1fr_250px] min-h-[480px] divide-y lg:divide-y-0 lg:divide-x divide-[var(--border)]">
          {/* Col 1: Conversas */}
          <div className="inbox-list flex flex-col min-h-[280px] lg:min-h-0">
            <div className="px-3 py-2 border-b border-[var(--border-soft)] bg-white">
              <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)]">Conversas · {filtered.length}</p>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[320px] lg:max-h-[520px]">
              {filtered.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] px-3 py-8 text-center">
                  {q ? `Nenhuma conversa para “${q}”.` : 'Nenhuma conversa neste filtro.'}
                </p>
              ) : (
                <div className="divide-y divide-[var(--border-soft)]">
                  {filtered.map((c) => {
                    const isActive = active?.conversation.id === c.id;
                    return (
                    <button key={c.id} onClick={() => openConversation(c.id)}
                      className={cn('relative w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors',
                        isActive ? 'bg-[var(--brand-soft)]' : 'hover:bg-[var(--surface-hover)]')}
                      aria-current={isActive}>
                      {isActive && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-pill bg-[var(--brand)]" />}
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <Icon n={c.channel === 'instagram' ? 'instagram' : c.channel === 'whatsapp' ? 'whatsapp' : 'chat'} size={12}
                            className={c.channel === 'instagram' ? 'shrink-0 text-[var(--lilac-fg)]' : 'shrink-0 text-[var(--success-fg)]'} />
                          <span className={cn('text-sm truncate', isActive ? 'font-semibold text-[var(--brand-fg)]' : 'font-semibold text-[var(--text)]')}>{c.name}</span>
                        </span>
                        {c.unread > 0 && <span className="text-[11px] font-semibold bg-[var(--brand)] text-white min-w-[18px] text-center px-1 py-0.5 rounded-pill shrink-0 tabular-nums">{c.unread}</span>}
                      </span>
                      <span className="text-xs text-[var(--text-muted)] truncate">
                        {c.outreachOrigin ? (
                          <span className="mr-1 inline-flex items-center gap-1 rounded bg-[var(--brand-soft)] px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text)]">
                            Origem: {c.outreachOrigin}
                          </span>
                        ) : null}
                        {c.lastMessagePreview || c.phone || c.channelUsername || ''}
                      </span>
                      <span className="text-[11px] text-[var(--text-faint)]">
                        {c.channel === 'instagram' ? `Instagram${c.channelUsername ? ` · @${c.channelUsername}` : ''}` : (c.phone || 'WhatsApp')}
                        {c.registered ? ' · cliente' : ''}
                      </span>
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Col 2: Conversa */}
          <div className="inbox-detail flex flex-col min-h-[320px]">
            {active ? (
              <>
                <button type="button" className="inbox-back workspace-link" onClick={() => setActive(null)}>← Voltar às conversas</button>
                <div className="px-3 py-2.5 border-b border-[var(--border-soft)] flex flex-wrap items-center justify-between gap-2 bg-white">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--text)] truncate">{active.conversation.name}</p>
                      {/* F3-F: 3 rótulos compreensíveis — IA / Recepção / Aguardando equipe. */}
                      <span className={cn('text-[11px] font-semibold border rounded-pill px-2 py-0.5 inline-flex items-center gap-1',
                        active.conversation.agentState === 'human_active'
                          ? 'bg-[var(--warning-bg)] border-[var(--warning-border)] text-[var(--warning-fg)]'
                          : active.conversation.agentState === 'waiting_team'
                            ? 'bg-[var(--surface-hover)] border-[var(--border-strong)] text-[var(--text-muted)]'
                            : 'bg-[var(--success-bg)] border-[var(--success-border)] text-[var(--success-fg)]'
                      )}>
                        <span aria-hidden="true" className={cn('w-1.5 h-1.5 rounded-full',
                          active.conversation.agentState === 'human_active' ? 'bg-[var(--warning)]'
                            : active.conversation.agentState === 'waiting_team' ? 'bg-[var(--text-muted)]'
                              : 'bg-[var(--success)]')} />
                        {active.conversation.agentStateLabel
                          || (active.conversation.agentState === 'human_active' ? 'Recepção atendendo'
                            : active.conversation.agentState === 'waiting_team' ? 'Aguardando equipe'
                              : '✨ IA atendendo')}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                      {active.conversation.channel === 'instagram'
                        ? (active.conversation.channelUsername ? `Instagram · @${active.conversation.channelUsername}` : 'Instagram · Direct')
                        : active.conversation.phone}
                      {active.conversation.registered ? ' · cliente cadastrado' : ' · ainda sem cadastro'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      onClick={toggleMode}
                      disabled={switchingMode}
                      className={cn('text-xs font-semibold rounded-md px-2.5 py-1.5 border shadow-xs disabled:opacity-50 inline-flex items-center gap-1.5',
                        active.conversation.mode === 'human'
                          ? 'bg-white border-[var(--border-strong)] text-[var(--text)] hover:bg-[var(--surface-hover)]'
                          : 'bg-[var(--warning-bg)] border-[var(--warning-border)] text-[var(--warning-fg)] hover:bg-[var(--attention-bg-hover)]')}
                    >
                      <Icon n={active.conversation.agentState === 'human_active' || active.conversation.agentState === 'waiting_team' ? 'sync' : 'handHeart'} size={13} />
                      {active.conversation.agentState === 'human_active' || active.conversation.agentState === 'waiting_team'
                        ? 'Devolver para IA'
                        : 'Pausar IA'}
                    </button>
                    <Link href={`/clientes?b=${businessId}&q=${encodeURIComponent(active.conversation.phone||'')}`}
                      className="text-xs font-semibold text-[var(--brand-fg)] bg-[var(--brand-soft)] border border-[var(--brand-border)] rounded-md px-2.5 py-1.5 hover:bg-[var(--brand-bg-hover)] inline-flex items-center gap-1.5">
                      <Icon n="wallet" size={13} /> Ver no CRM
                    </Link>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[var(--bg-tint)] max-h-[360px] lg:max-h-[420px]">
                  {active.messages.map((m) => (
                    <div key={m.id} className={m.direction === 'out' ? 'flex justify-end' : 'flex justify-start'}>
                      <div className={cn('max-w-[78%] px-3 py-2 rounded-lg text-sm shadow-xs', m.direction === 'out' ? 'bg-[var(--brand)] text-white rounded-br-sm' : 'bg-white border border-[var(--border)] rounded-bl-sm')}>
                        <span className="block text-[11px] font-semibold mb-0.5">
                          {m.byName || (m.direction === 'in' ? 'Cliente' : m.by === 'automation' ? 'Automação' : 'Equipe')}
                          {m.meta?.simulator && (
                            <span className="ml-1.5 inline-block text-[10px] font-bold uppercase tracking-wide bg-[var(--surface-3)] border border-[var(--border-strong)] text-[var(--text-muted)] rounded px-1 py-0">SIMULADOR</span>
                          )}
                        </span>
                        {m.body}
                        <span className="block text-xs mt-1">
                          {m.at.slice(11, 16)} · {m.status === 'sent' ? 'enviada' : m.status === 'delivered' ? 'entregue' : m.status === 'read' ? 'lida' : m.status === 'failed' ? 'falhou' : 'pendente'}
                          {m.error ? ` (${m.error})` : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="p-2.5 border-t border-[var(--border)] bg-white">
                  {sendError && <p role="alert" className="mb-2 text-xs font-semibold bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-fg)] rounded-md px-2.5 py-1.5">{sendError}</p>}
                  {/* Conta trocada: esta conversa é de uma conta que não está
                      mais conectada. O histórico fica em leitura. */}
                  {active.conversation.channel === 'instagram' && accountMismatch ? (
                    <p role="status" className="text-xs font-semibold bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger-fg)] rounded-md px-2.5 py-1.5">
                      {accountMismatch}
                    </p>
                  ) : active.conversation.channel === 'instagram' && window && !window.canReply ? (
                    /* Política do Instagram: fora da janela de 24 h a Meta recusa
                       o envio. A tela TROCA o compositor por um aviso — nada de
                       botão que promete o que a política não permite. */
                    <p role="status" className="text-xs font-semibold bg-[var(--warning-bg)] border border-[var(--warning-border)] text-[var(--warning-fg)] rounded-md px-2.5 py-1.5">
                      {window.reason} Você ainda pode responder no Direct do Instagram; aqui o compositor reabre quando a pessoa escrever de novo.
                    </p>
                  ) : (
                    <>
                    {/* Limite oficial do Instagram (1000 bytes): aviso discreto
                        antes do teto; acima dele o envio é recusado. */}
                    {igComposer && draftBytes >= 800 && (
                      <p className={`mb-2 text-[11px] font-semibold ${draftBytes > INSTAGRAM_TEXT_MAX_BYTES ? 'text-[var(--danger-fg)]' : 'text-[var(--text-muted)]'}`}>
                        {draftBytes} de {INSTAGRAM_TEXT_MAX_BYTES} bytes do Instagram
                        {draftBytes > INSTAGRAM_TEXT_MAX_BYTES ? ' — reduza para enviar.' : ''}
                      </p>
                    )}
                    {(active.conversation.channel === 'instagram' ? !channels.instagram : !channels.whatsapp) && <p className="text-sm text-[var(--text-muted)] mb-2">Canal desconectado. Seu rascunho fica aqui; o envio exige uma conexão ativa.</p>}
                    <form onSubmit={sendMessage} className="flex gap-2">
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={active.conversation.channel === 'instagram' ? 'Responder no Instagram…' : 'Escreva uma mensagem…'}
                        aria-label="Mensagem"
                        className="min-w-0 flex-1 rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm shadow-xs focus:outline-none focus:shadow-focus focus:border-[var(--brand)]"
                      />
                      {/* O botão só parece funcional quando é: desabilitado sem
                          texto e durante o envio — nunca um "Enviar" de mentira. */}
                      <button type="submit"
                        disabled={sending || !draft.trim() || (active.conversation.channel === 'instagram' ? !channels.instagram : !channels.whatsapp)}
                        className="text-sm font-semibold bg-[var(--brand)] text-white px-4 py-2 rounded-md border border-[var(--brand-strong)]/40 shadow-brand hover:bg-[var(--brand-strong)] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none inline-flex items-center gap-1.5">
                        <Icon n="send" size={14} /> {sending ? 'Enviando…' : 'Enviar'}
                      </button>
                    </form>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
                <div className="il-empty__icon"><Icon n="chat" size={22} /></div>
                <p className="text-sm font-semibold text-[var(--text)]">Escolha uma conversa</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 max-w-sm">Cada mensagem vira histórico do cliente. O assistente pode responder com os dados do negócio.</p>
              </div>
            )}
          </div>

          {/* Col 3: Contato */}
          <div className="inbox-contact bg-[var(--surface-2)]">
            {active ? (
              <div className="p-3 space-y-3">
                <div className="il-idcard rounded-lg border border-[var(--border)] p-3 shadow-sm">
                  <div className="relative flex items-center gap-2.5">
                    <span className="w-10 h-10 shrink-0 rounded-full il-avatar text-sm" aria-hidden="true">
                      {(active.conversation.name || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || '').join('')}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text)] truncate">{active.conversation.name}</p>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {active.conversation.channel === 'instagram'
                          ? (active.conversation.channelUsername ? `@${active.conversation.channelUsername}` : 'Contato do Instagram')
                          : active.conversation.phone}
                      </p>
                    </div>
                  </div>
                  <span className={cn('relative inline-flex items-center gap-1 mt-2.5 text-[11px] font-semibold px-2 py-0.5 rounded-pill border',
                    active.conversation.registered
                      ? 'bg-[var(--brand-soft)] border-[var(--brand-border)] text-[var(--brand-fg)]'
                      : 'bg-[var(--lilac-bg)] border-[var(--lilac-border)] text-[var(--lilac-fg)]')}>
                    <Icon n={active.conversation.registered ? 'wallet' : 'spark'} size={11} />
                    {active.conversation.registered ? 'Cliente cadastrado' : 'Lead (sem cadastro)'}
                  </span>
                </div>
                <div className="bg-white border border-[var(--border)] rounded-lg p-3 shadow-xs">
                  <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)] mb-2">Atalhos</p>
                  <div className="space-y-1.5">
                    <Link href={`/clientes?b=${businessId}&q=${encodeURIComponent(active.conversation.phone || active.conversation.channelUsername || active.conversation.name || '')}`} className="flex items-center gap-1.5 text-xs font-semibold bg-[var(--surface-3)] border border-[var(--border)] rounded-md px-3 py-2 hover:bg-[var(--brand-soft)] hover:text-[var(--brand-fg)] hover:border-[var(--brand-border)]"><Icon n="wallet" size={13} /> Ver no CRM</Link>
                    {/* F3-F · Contexto lateral — SÓ administrativo (nunca prontuário).
                        Tutor, pets e paciente corrente quando veterinária. */}
                    {side && (
                      <div className="mt-4 rounded-lg border border-[var(--border)] bg-white p-3 space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Contexto</p>
                        <div className="text-xs space-y-1">
                          <p><span className="text-[var(--text-muted)]">Tutor:</span> {side.tutor.name || active.conversation.name || '—'}</p>
                          {side.tutor.phone && (
                            <p><span className="text-[var(--text-muted)]">Telefone:</span> {side.tutor.phone}</p>
                          )}
                          {side.pets.length > 0 && (
                            <p>
                              <span className="text-[var(--text-muted)]">Pets:</span>{' '}
                              {side.pets.map((p) => p.name).join(', ')}
                            </p>
                          )}
                          {side.currentPatient && (
                            <p className="font-semibold text-[var(--brand-fg)]">
                              Paciente: {side.currentPatient.name}
                            </p>
                          )}
                          {side.nextAppointment && (
                            <p>
                              <span className="text-[var(--text-muted)]">Próximo:</span>{' '}
                              {side.nextAppointment.date} {side.nextAppointment.time}
                              {side.nextAppointment.service ? ` · ${side.nextAppointment.service}` : ''}
                            </p>
                          )}
                          {side.responsible && (
                            <p><span className="text-[var(--text-muted)]">Responsável:</span> {side.responsible}</p>
                          )}
                        </div>
                        {/* Ações administrativas (atalhos; sem prontuário) */}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <Link href={`/agenda?b=${businessId}`} className="text-[11px] px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--surface-hover)]">Agendar</Link>
                          <Link href={`/tarefas?b=${businessId}`} className="text-[11px] px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--surface-hover)]">Tarefa</Link>
                          <Link href={`/clientes?b=${businessId}&q=${encodeURIComponent(active.conversation.phone || '')}`} className="text-[11px] px-2 py-1 rounded border border-[var(--border)] hover:bg-[var(--surface-hover)]">Paciente</Link>
                        </div>
                        {active.conversation.handoff?.summary && (
                          <div className="pt-2 border-t border-[var(--border-soft)]">
                            <p className="text-[11px] font-semibold text-[var(--text-muted)]">Último handoff</p>
                            <p className="text-xs text-[var(--text)] mt-0.5">{active.conversation.handoff.summary}</p>
                            {active.conversation.handoff.actions?.length ? (
                              <ul className="text-[11px] text-[var(--text-muted)] mt-1 list-disc pl-4">
                                {active.conversation.handoff.actions.map((a) => <li key={a}>{a}</li>)}
                              </ul>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )}
                    <Link href={`/funil?b=${businessId}`} className="flex items-center gap-1.5 text-xs font-semibold bg-[var(--surface-3)] border border-[var(--border)] rounded-md px-3 py-2 hover:bg-[var(--lilac-bg)] hover:text-[var(--lilac-fg)] hover:border-[var(--lilac-border)]"><Icon n="funnel" size={13} /> Ver no funil</Link>
                    <Link href={`/agenda?b=${businessId}`} className="flex items-center gap-1.5 text-xs font-semibold bg-[var(--surface-3)] border border-[var(--border)] rounded-md px-3 py-2 hover:bg-[var(--brand-soft)] hover:text-[var(--brand-fg)] hover:border-[var(--brand-border)]"><Icon n="calendar" size={13} /> Ver agenda</Link>
                    {active.conversation.channel !== 'instagram' && data.linkFallback && (
                      <a href={`https://wa.me/${(active.conversation.phone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] border border-[var(--success-border)] rounded-md px-3 py-2 hover:bg-[var(--success-bg-hover)]">
                        <Icon n="whatsapp" size={13} /> Abrir no WhatsApp <Icon n="external" size={11} />
                      </a>
                    )}
                    {active.conversation.channel === 'instagram' && (
                      <p className="text-[11px] text-[var(--text-muted)] px-1">
                        Conversa do Instagram Direct. O Instagram não informa telefone nem e-mail — o vínculo é o perfil.
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-xs text-[var(--text-muted)] px-1">
                  <p>Última mensagem: {active.conversation.lastMessageAt ? humanDateTime(active.conversation.lastMessageAt.slice(0, 10), active.conversation.lastMessageAt.slice(11, 16)) : '—'}</p>
                  {active.conversation.channel === 'instagram' && window && (
                    <p className="mt-1">{window.reason}</p>
                  )}
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
    </div>
  );
}
