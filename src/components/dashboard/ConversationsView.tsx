'use client';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Avatar, PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { formatDateTimeBR } from '@/lib/tz';
import { AccessDenied, AreaLoadError, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { QuickRegisterSheet, type SavedContact } from '@/components/dashboard/QuickRegisterSheet';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { loadMe } from '@/lib/session-me';
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
  /** Mensagens da equipe que FALHARAM ao sair (filtro "Falhas"). */
  failedMessages?: number;
  registered: boolean; channel?: 'whatsapp' | 'instagram' | 'agent'; channelUsername?: string;
  /** Vínculo canônico persistido (link_contact / resolve). */
  contactId?: string; customerId?: string;
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
  /**
   * ESTADO MÍNIMO COERENTE (correção do flicker real):
   * a tela precisa do STATUS DO CANAL e da LISTA DE CONVERSAS para decidir o
   * que mostrar. Enquanto as duas não chegarem, ela mostra ESQUELETO — nunca
   * um "Nenhuma conversa / conecte um canal" que pode virar inbox um instante
   * depois. Antes o status era publicado sozinho (fetch sequencial) e o vazio
   * aparecia por um frame: UX mentirosa, mesmo com dado correto.
   */
  const [loaded, setLoaded] = useState(false);
  // FASE E — filtros que respondem à pergunta da recepção: o que não li, o
  // que espera POR MIM e o que FALHOU ao sair.
  const [filter, setFilter] = useState<'all' | 'unread' | 'waiting' | 'failed'>('all');
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
  const [contextOpen, setContextOpen] = useState(true);
  const [contextSheetOpen, setContextSheetOpen] = useState(false);
  const focusContextRestore = useRef<boolean | null>(null);
  const [compactLayout, setCompactLayout] = useState(false);
  const [focusMode, setFocusMode] = useState(() => params.get('focus') === '1' || params.get('standalone') === '1');
  const queryFocusMode = params.get('focus') === '1' || params.get('standalone') === '1';
  useEffect(() => { setFocusMode(queryFocusMode); }, [queryFocusMode]);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement | null>(null);
  // §11–15 — identidade: cadastro rápido do "Contato novo" + a clínica é vet?
  const [quickOpen, setQuickOpen] = useState(false);
  const [vetClinic, setVetClinic] = useState(false);
  useEffect(() => {
    let on = true;
    loadMe().then((m) => {
      const biz = m?.data?.businesses?.find((b) => b.id === businessId) || m?.data?.businesses?.[0];
      if (on && biz?.clinicType === 'veterinaria') setVetClinic(true);
    }).catch(() => {});
    return () => { on = false; };
  }, [businessId]);

  useEffect(() => {
    const media = globalThis.window.matchMedia?.('(max-width: 1199px)');
    if (!media) return;
    const update = () => setCompactLayout(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  useEffect(() => { if (!compactLayout) setContextSheetOpen(false); }, [compactLayout]);

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

  async function sendMessage(e?: React.FormEvent, overrideText?: string) {
    e?.preventDefault();
    if (!active || sending || !(active.conversation.channel === 'instagram' ? channels.instagram : channels.whatsapp)) return;
    const text = (overrideText ?? draft).trim();
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
    // The server already takes over on manual send. Reflect that same invariant
    // immediately: one owner at a time, and no stale AI badge after success.
    setActive((prev) => prev ? { conversation: { ...prev.conversation, mode: 'human', agentState: 'human_active', agentStateLabel: 'Equipe atendendo', lastMessagePreview: sent.body.slice(0, 120) }, messages: [...prev.messages, sent] } : prev);
    setConversations((list) => list.map((c) => c.id === active.conversation.id ? { ...c, mode: 'human', agentState: 'human_active', agentStateLabel: 'Equipe atendendo', lastMessagePreview: sent.body.slice(0, 120), lastMessageAt: sent.at } : c));
    setDraft('');
  }

  /** FASE E — mensagem que FALHOU pode ser REENVIADA com um clique: o texto
   * volta ao compositor e o envio é o MESMO caminho normal (nenhum atalho
   * paralelo). A mensagem antiga continua no histórico com o erro dela. */
  async function retryMessage(m: Message) {
    if (!active || sending) return;
    setDraft(m.body);
    setSendError('');
    // Reusa o mesmo caminho de envio sem depender do próximo render do draft.
    const event = { preventDefault: () => {} } as React.FormEvent;
    await sendMessage(event, m.body);
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

  function changeFocusMode(next: boolean) {
    setFocusMode(next);
    if (next) {
      focusContextRestore.current = contextOpen;
      setContextOpen(false);
      setContextSheetOpen(false);
    } else if (focusContextRestore.current !== null) {
      setContextOpen(focusContextRestore.current);
      focusContextRestore.current = null;
    }
    const query = new URLSearchParams(params.toString());
    if (businessId) query.set('b', businessId);
    if (next) query.set('focus', '1');
    else { query.delete('focus'); query.delete('standalone'); }
    router.replace(`/conversas?${query.toString()}`, { scroll: false });
  }

  /**
   * §11–15 — cadastro rápido concluído: vincula a conversa ao contato novo e
   * atualiza o badge para "Na base da clínica". O vínculo é explícito (ação
   * link_contact); a lista local é atualizada em seguida para a tela inteira
   * (lista + detalhe) concordarem na hora.
   */
  async function onQuickSaved(contact: SavedContact) {
    if (!active || !contact.id) return;
    const convId = active.conversation.id;
    // O vínculo é PERSISTENTE (link_contact grava conversation.contactId).
    // Só atualizamos o badge local quando o servidor confirma — nunca
    // maquiar a UI sem o vínculo gravado (F5 não pode regredir).
    const linked = await apiSend('/api/conversations', 'POST', {
      businessId, conversationId: convId, action: 'link_contact', contactId: contact.id,
    });
    if (!linked.ok) {
      setError(linked.message || 'Não foi possível vincular a conversa ao cliente.');
      return;
    }
    const patch = (c: Conversation): Conversation => ({
      ...c, registered: true, contactId: contact.id, name: c.name || contact.name, phone: c.phone || contact.phone,
    });
    setConversations((list) => list.map((c) => (c.id === convId ? patch(c) : c)));
    setActive((a) => (a && a.conversation.id === convId ? { ...a, conversation: patch(a.conversation) } : a));
  }

  // 403 → aviso amigável (a sessão continua); nada de skeleton infinito.
  const { denied, failed, report, reportFeature } = useAreaLoad('Conversas');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoaded(false);
    // AS DUAS REQUISIÇÕES SÃO INDEPENDENTES → saem juntas. Em série, a segunda
    // só começava depois da primeira responder (o dobro do tempo de rede).
    // A lista é do INBOX (todos os canais): a pergunta certa é "existe algum
    // canal conectado?", não "o WhatsApp está conectado?".
    const [res, conv] = await Promise.all([
      apiGet<WaChannelData>(`/api/whatsapp?businessId=${businessId}`, { scope: 'area', area: 'Conversas' }),
      apiGet<{ conversations?: Conversation[]; channels?: ChannelsView; instagram?: InstagramInbox }>(
        `/api/conversations?businessId=${businessId}`, { scope: 'area', area: 'Conversas' },
      ),
    ]);
    // §8–10 — PRINCIPAL × SECUNDÁRIA (causa raiz do falso 403 do painel):
    //   /api/conversations (o INBOX) é a request PRINCIPAL da área;
    //   /api/whatsapp (status do canal) é apoio SECUNDÁRIO — seu 403 só
    //   esconde o card de status do canal. NUNCA nega a tela de Conversas.
    if (!report(conv)) { setLoaded(true); return; }
    setConversations(conv.data?.conversations || []);
    setChannels(conv.data?.channels || { whatsapp: false, instagram: false });
    setIgInfo(conv.data?.instagram || null);
    setData(reportFeature(res) ? (res.data || null) : null);
    setLoaded(true);
  }, [businessId, report, reportFeature]);

  useEffect(() => { load(); }, [load]);

  // Deep-link da BUSCA GLOBAL (§FASE C): /conversas?c={id} abre a conversa
  // direto — o resultado da busca leva ao contexto, não só à lista.
  const deepLinkId = params.get('c') || '';
  const openedDeepLink = useRef('');
  useEffect(() => {
    if (panel || !deepLinkId || openedDeepLink.current === deepLinkId) return;
    if (!loaded || conversations.length === 0) return;
    if (conversations.some((c) => c.id === deepLinkId)) {
      openedDeepLink.current = deepLinkId;
      void openConversation(deepLinkId);
    }
  }, [deepLinkId, loaded, conversations, panel]);

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
      if (!panel) {
        const qs = new URLSearchParams(params.toString());
        qs.set('c', id);
        if (businessId) qs.set('b', businessId);
        router.replace(`/conversas?${qs.toString()}`, { scroll: false });
      }
    } else if (!res.ok) setError(res.message);
  }

  useEffect(() => {
    if (!active) return;
    detailHeadingRef.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => {
      const scroller = messagesRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [active?.conversation.id]);

  function closeActiveConversation() {
    setActive(null);
    setSide(null);
    setContextSheetOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.inbox-conversation[aria-current="true"]')?.focus({ preventScroll: true }));
    if (!panel) {
      const qs = new URLSearchParams(params.toString());
      qs.delete('c');
      router.replace(`/conversas${qs.size ? `?${qs.toString()}` : ''}`, { scroll: false });
    }
  }

  function toggleContext() {
    if (compactLayout) setContextSheetOpen(true);
    else setContextOpen((open) => !open);
  }

  if (denied) return <AccessDenied area="Conversas" />;
  if (failed) return <AreaLoadError area="Conversas" message={failed} onRetry={load} />;
  // Esqueleto enquanto o estado mínimo não está resolvido (canal + lista).
  if (!data || !loaded) return <PageSkeleton />;
  const clientesQ = `?b=${businessId}`;
  // Link para o canal: mantém a unidade ativa (?b=) e abre já na aba Canais.
  const channelsHref = `/canais?tab=canais${businessId ? `&b=${businessId}` : ''}`;
  const channelFilter = (panel ? panelChannel : params.get('canal') || 'all') as 'all' | 'whatsapp' | 'instagram';
  // Contador do limite do Instagram (aviso discreto perto do teto).
  const igComposer = active?.conversation.channel === 'instagram';
  const draftBytes = igComposer ? instagramTextBytes(draft) : 0;
  // Um canal é mostrado quando existe conexão OU conversa dele (histórico
  // antigo continua visível mesmo se a conta foi desconectada).
  // §F — o canal DESTA conversa está conectado? Um canal conectado em outra
  // conta não responde por esta: a régua é sempre a da conversa aberta.
  const channelOff = (c: Conversation) => (c.channel === 'instagram' ? !channels.instagram : !channels.whatsapp);

  const hasInstagram = channels.instagram || conversations.some((c) => c.channel === 'instagram');
  const hasWhatsapp = channels.whatsapp || conversations.some((c) => c.channel === 'whatsapp');
  const anyChannel = channels.whatsapp || channels.instagram;
  // Busca (?q=): nome, telefone ou prévia da última mensagem — aplicada sobre
  // a lista já guardada por permissão/unidade (nenhum dado novo é exposto).
  const qLower = q.toLowerCase();
  const filtered = conversations.filter((c) => {
    if (channelFilter !== 'all' && (c.channel || 'whatsapp') !== channelFilter) return false;
    if (filter === 'unread' && c.unread <= 0) return false;
    // Aguardando = espera pela EQUIPE (assumida no humano ou pedindo equipe) —
    // não é "status open", que mistura conversas que a IA cuida sozinha.
    if (filter === 'waiting' && !(c.mode === 'human' || c.agentState === 'waiting_team')) return false;
    if (filter === 'failed' && (c.failedMessages || 0) <= 0) return false;
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

  // ── NENHUM CANAL CONECTADO E SEM HISTÓRICO: vazio honesto + a porta certa ──
  if (!anyChannel && conversations.length === 0) {
    return (
      <div className="conversation-view" data-panel={panel} data-active="false">
        <header className="conversation-pagebar">
          <div className="conversation-pagebar__title">
            <span className="conversation-mark"><Icon n="inbox" size={18} /></span>
            <div><h1>Conversas</h1><p>Central de atendimento · {businessId ? 'unidade atual' : 'selecione uma clínica'}</p></div>
          </div>
          <Link href={`/clientes${clientesQ}`} className="conversation-action">Ver clientes</Link>
        </header>
        {error && <p role="alert" className="conversation-alert">{error}</p>}
        <section className="conversation-empty-workspace">
          <div className="conversation-empty-copy">
            <span className="conversation-empty-icon"><Icon n="chat" size={22} /></span>
            <h2>Nenhuma conversa ainda</h2>
            <p>Conecte um canal para receber e responder mensagens por aqui. {data.label.detail}</p>
            <div className="conversation-empty-actions">
              <Link href={channelsHref} className="il-control il-control--primary"><Icon n="external" size={14} /> Conectar canal</Link>
              {data.linkFallback && <a href={data.linkFallback} target="_blank" rel="noreferrer" className="il-control il-control--secondary">Abrir WhatsApp externo <Icon n="external" size={13} /></a>}
            </div>
            <p className="conversation-empty-note">Cadastros, agendamentos e oportunidades continuam disponíveis nas demais áreas.</p>
          </div>
        </section>
      </div>
    );
  }

  const contextContent = active ? (
    <div className="conversation-context-content">
      <section className="conversation-context-identity">
        <div className="conversation-context-person">
          <Avatar name={side?.tutor.name || active.conversation.name || '?'} size={42} />
          <div className="min-w-0">
            <p className="conversation-context-eyebrow">{vetClinic ? 'Tutor' : 'Contato'}</p>
            <h3>{side?.tutor.name || active.conversation.name || 'Contato'}</h3>
            <p>{active.conversation.channel === 'instagram'
              ? (active.conversation.channelUsername ? `Instagram · @${active.conversation.channelUsername}` : 'Instagram Direct')
              : side?.tutor.phone || active.conversation.phone || 'Telefone não informado'}</p>
          </div>
        </div>
        <span className={cn('conversation-contact-status', active.conversation.registered ? 'is-linked' : 'is-new')}>
          {active.conversation.registered ? 'Na base da clínica' : 'Contato novo'}
        </span>
        {!active.conversation.registered && (
          <button type="button" className="conversation-context-primary" onClick={() => setQuickOpen(true)}>
            Cadastrar cliente
          </button>
        )}
      </section>

      {vetClinic && (
        <section className="conversation-context-section" aria-labelledby="conversation-pets-heading">
          <h3 id="conversation-pets-heading">Pets e paciente</h3>
          {side?.pets.length ? (
            <ul className="conversation-pet-list">
              {side.pets.map((pet) => <li key={pet.id}>{pet.name}<span>{pet.species || 'Espécie não informada'}</span></li>)}
            </ul>
          ) : <p className="conversation-context-muted">Nenhum pet associado no contexto desta conversa.</p>}
          {side?.currentPatient ? (
            <div className="conversation-current-patient"><span>Paciente atual</span><strong>{side.currentPatient.name}</strong></div>
          ) : null}
        </section>
      )}

      <section className="conversation-context-section" aria-labelledby="conversation-details-heading">
        <h3 id="conversation-details-heading">Atendimento</h3>
        {side?.nextAppointment ? (
          <div className="conversation-context-row"><span>Próximo agendamento</span><strong>{formatDateTimeBR(side.nextAppointment.date, side.nextAppointment.time)}</strong>
            {side.nextAppointment.service && <small>{side.nextAppointment.service}</small>}</div>
        ) : <p className="conversation-context-muted">Nenhum próximo agendamento encontrado.</p>}
        {side?.responsible && <div className="conversation-context-row"><span>Responsável</span><strong>{side.responsible}</strong></div>}
        {side?.lead && <div className="conversation-context-row"><span>Oportunidade</span><strong>{side.lead.stage || 'Em acompanhamento'}</strong></div>}
        {active.conversation.handoff?.summary && (
          <div className="conversation-handoff">
            <span>Último handoff</span><p>{active.conversation.handoff.summary}</p>
            {active.conversation.handoff.actions?.length ? <ul>{active.conversation.handoff.actions.map((action) => <li key={action}>{action}</li>)}</ul> : null}
          </div>
        )}
      </section>

      <section className="conversation-context-section conversation-context-links" aria-label="Atalhos administrativos">
        <h3>Ações</h3>
        <Link href={`/agenda?b=${businessId}`}><Icon n="calendar" size={14} /> Agendar</Link>
        <Link href={`/tarefas?b=${businessId}`}><Icon n="check" size={14} /> Criar tarefa</Link>
        {vetClinic && side?.currentPatient && <Link href={`/clientes?b=${businessId}&q=${encodeURIComponent(active.conversation.phone || '')}`}><Icon n="user" size={14} /> Paciente</Link>}
        {side?.lead && <Link href={`/funil?b=${businessId}`}><Icon n="funnel" size={14} /> Oportunidade</Link>}
        {!side?.lead && <Link href={`/funil?b=${businessId}`}><Icon n="funnel" size={14} /> Ver oportunidades</Link>}
        {active.conversation.channel !== 'instagram' && data.linkFallback && (
          <a href={`https://wa.me/${(active.conversation.phone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><Icon n="whatsapp" size={14} /> WhatsApp externo <Icon n="external" size={11} /></a>
        )}
      </section>
      {active.conversation.channel === 'instagram' && <p className="conversation-context-muted">No Direct, o perfil é a identidade do canal; telefone e e-mail podem não estar disponíveis.</p>}
    </div>
  ) : <p className="conversation-context-empty">O contexto administrativo aparecerá aqui quando você selecionar uma conversa.</p>;

  return (
    <div className="conversation-view" data-panel={panel} data-active={!!active} data-context-open={contextOpen} data-focus={focusMode}>
      <header className="conversation-pagebar">
        <div className="conversation-pagebar__title">
          <span className="conversation-mark"><Icon n="inbox" size={18} /></span>
          <div className="conversation-pagebar__heading">
            <h1>Conversas</h1>
            <p>{data.inbox.open} abertas · {data.inbox.unread} não lidas
              {channels.whatsapp && data.integration.displayPhone && <> · WhatsApp {data.integration.displayPhone}</>}
              {channels.instagram && igInfo?.username && <> · Instagram @{igInfo.username}</>}
            </p>
          </div>
        </div>
        <div className="conversation-pagebar__actions">
          {!compactLayout && <button type="button" className="conversation-action" onClick={toggleContext}
            aria-expanded={contextOpen} aria-controls="conversation-context-panel">
            {contextOpen ? 'Ocultar contexto' : 'Mostrar contexto'}
          </button>}
          <button type="button" className="conversation-action conversation-focus-toggle" onClick={() => changeFocusMode(!focusMode)} aria-pressed={focusMode}>{focusMode ? 'Sair do modo foco' : 'Modo foco'}</button>
          <button type="button" className="conversation-action conversation-new-window" onClick={() => {
            const query = new URLSearchParams(params.toString());
            if (businessId) query.set('b', businessId);
            if (!query.has('canal') && panelChannel !== 'all') query.set('canal', panelChannel);
            query.set('focus', '1');
            query.set('standalone', '1');
            globalThis.window.open(`/conversas?${query.toString()}`, '_blank', 'noopener,noreferrer');
          }} aria-label="Abrir separado"><Icon n="external" size={13} /> <span>Abrir separado</span></button>
        </div>
      </header>
      {error && <p role="alert" className="conversation-alert">{error}</p>}

      <div className="conversation-workspace">
        <section className="inbox-list" aria-label="Inbox de conversas">
          <div className="inbox-controls">
            <div className="inbox-controls__heading"><h2>Inbox</h2><span>{filtered.length}</span></div>
            <label className="inbox-search">
              <Icon n="search" size={14} />
              <input value={q} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar nome, telefone ou mensagem" aria-label="Buscar conversas" />
            </label>
            {(hasWhatsapp && hasInstagram) && (
              <div className="inbox-filter-group" role="group" aria-label="Filtrar por canal">
                {([{ id: 'all', label: 'Todos' }, { id: 'whatsapp', label: 'WhatsApp' }, { id: 'instagram', label: 'Instagram' }] as const).map((channel) => (
                  <button key={channel.id} type="button" className="inbox-filter" onClick={() => setChannelFilter(channel.id)} aria-pressed={channelFilter === channel.id}>{channel.label}</button>
                ))}
              </div>
            )}
            <div className="inbox-filter-group inbox-filter-group--status" role="group" aria-label="Filtrar conversas">
              {(['all', 'unread', 'waiting', 'failed'] as const).map((key) => (
                <button key={key} type="button" className="inbox-filter" onClick={() => setFilter(key)} aria-pressed={filter === key}>
                  {key === 'all' ? 'Todas' : key === 'unread' ? 'Não lidas' : key === 'waiting' ? 'Aguardando' : 'Falhas'}
                </button>
              ))}
            </div>
            <div className="inbox-channel-status" aria-label="Estado dos canais">
              <span className={channels.whatsapp ? 'is-connected' : 'is-disconnected'}><Icon n="whatsapp" size={12} /> WhatsApp {channels.whatsapp ? 'conectado' : 'desconectado'}</span>
              {hasInstagram && <span className={channels.instagram ? 'is-connected' : 'is-disconnected'}><Icon n="instagram" size={12} /> Instagram {channels.instagram ? 'conectado' : 'desconectado'}</span>}
            </div>
          </div>
          <div className="inbox-list-scroll">
            {filtered.length === 0 ? <p className="inbox-list-empty">{q ? `Nenhuma conversa para “${q}”.` : 'Nenhuma conversa neste filtro.'}</p> : (
              <div className="inbox-conversation-list">
                {filtered.map((conversation) => {
                  const isActive = active?.conversation.id === conversation.id;
                  const agentLabel = conversation.agentStateLabel || (conversation.agentState === 'waiting_team' ? 'Aguardando equipe'
                    : conversation.agentState === 'human_active' ? 'Equipe atendendo'
                      : conversation.agentState === 'waiting_patient' ? 'Esperando paciente'
                        : conversation.agentState === 'resolved' ? 'Resolvido'
                          : conversation.mode === 'human' ? 'Equipe atendendo' : 'IA atendendo');
                  return (
                    <button key={conversation.id} type="button" onClick={() => { void openConversation(conversation.id); }}
                      className="inbox-conversation" data-selected={isActive} aria-current={isActive ? 'true' : undefined}
                      aria-label={`${conversation.name}${conversation.unread ? `, ${conversation.unread} não lidas` : ''}`}>
                      <span className="inbox-conversation__avatar"><Avatar name={conversation.name || '?'} size={40} /></span>
                      <span className="inbox-conversation__body">
                        <span className="inbox-conversation__top"><strong>{conversation.name || 'Contato'}</strong><time>{conversation.lastMessageAt ? formatDateTimeBR(conversation.lastMessageAt) : ''}</time></span>
                        <span className="inbox-conversation__preview">{conversation.lastMessagePreview || conversation.phone || conversation.channelUsername || 'Sem mensagens'}</span>
                        <span className="inbox-conversation__meta">
                          <span><Icon n={conversation.channel === 'instagram' ? 'instagram' : 'whatsapp'} size={11} /> {conversation.channel === 'instagram' ? 'Instagram' : 'WhatsApp'}</span>
                          <span>{agentLabel}</span>
                          {conversation.registered && <span>Na base</span>}
                          {(conversation.failedMessages || 0) > 0 && <span className="inbox-failure-count">{conversation.failedMessages} falha{conversation.failedMessages === 1 ? '' : 's'}</span>}
                        </span>
                      </span>
                      {conversation.unread > 0 && <span className="inbox-unread" aria-label={`${conversation.unread} mensagens não lidas`}>{conversation.unread}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="inbox-detail" aria-label="Conversa selecionada">
          {active ? (
            <>
              <header className="inbox-detail-header">
                <button type="button" className="inbox-back" onClick={closeActiveConversation} aria-label="Voltar à lista de conversas"><Icon n="chevL" size={18} /><span>Conversas</span></button>
                <Avatar name={active.conversation.name || '?'} size={38} />
                <div className="inbox-detail-header__identity">
                  <h2 ref={detailHeadingRef} tabIndex={-1}>{active.conversation.name || 'Contato'}</h2>
                  <p>{active.conversation.channel === 'instagram'
                    ? (active.conversation.channelUsername ? `Instagram · @${active.conversation.channelUsername}` : 'Instagram Direct')
                    : active.conversation.phone || 'WhatsApp'} · {active.conversation.registered ? 'na base da clínica' : 'contato novo'}</p>
                </div>
                <span className={cn('inbox-agent-state', `is-${active.conversation.agentState || active.conversation.mode || 'automation'}`)} role="status">
                  <span aria-hidden="true" />
                  {active.conversation.agentStateLabel || (active.conversation.agentState === 'waiting_team' ? 'Aguardando equipe'
                    : active.conversation.agentState === 'human_active' || active.conversation.mode === 'human' ? 'Equipe atendendo'
                      : active.conversation.agentState === 'waiting_patient' ? 'Esperando paciente'
                        : active.conversation.agentState === 'resolved' ? 'Resolvido' : 'IA atendendo')}
                </span>
                <div className="inbox-detail-actions">
                  {focusMode && <button type="button" className="conversation-action conversation-focus-exit-mobile" onClick={() => changeFocusMode(false)}>Sair do modo foco</button>}
                  <button type="button" onClick={toggleMode} disabled={switchingMode} className="conversation-action conversation-mode-action">
                    {active.conversation.agentState === 'human_active' || active.conversation.agentState === 'waiting_team' || active.conversation.mode === 'human' ? 'Devolver para IA' : 'Pausar IA'}
                  </button>
                  <Link href={`/clientes?b=${businessId}&q=${encodeURIComponent(active.conversation.phone || active.conversation.channelUsername || active.conversation.name || '')}`} className="conversation-action inbox-crm-link">Ver no CRM</Link>
                  <button type="button" className="conversation-action inbox-context-trigger" onClick={toggleContext}
                    aria-expanded={compactLayout ? contextSheetOpen : contextOpen}
                    aria-controls={compactLayout ? 'conversation-context-sheet' : 'conversation-context-panel'}>Contexto</button>
                </div>
              </header>

              {accountMismatch && <p role="status" className="conversation-channel-alert is-error">{accountMismatch}</p>}
              {active.conversation.channel === 'instagram' && window && !window.canReply && !accountMismatch && <p role="status" className="conversation-channel-alert is-warning">{window.reason} A resposta volta a ficar disponível quando a pessoa escrever novamente.</p>}

              <div className="conversation-message-scroll" role="log" aria-label={`Mensagens com ${active.conversation.name || 'contato'}`} aria-live="off" ref={messagesRef}>
                {active.messages.length === 0 && <p className="conversation-no-messages">Ainda não há mensagens nesta conversa.</p>}
                {active.messages.map((message) => (
                  <div key={message.id} className={cn('conversation-message-row', message.direction === 'out' ? 'is-outgoing' : 'is-incoming')}>
                    <article className={cn('conversation-message', message.direction === 'out' ? 'is-outgoing' : 'is-incoming', message.status === 'failed' && 'has-failed')}>
                      <div className="conversation-message__meta">
                        <strong>{message.byName || (message.direction === 'in' ? 'Cliente' : message.by === 'automation' ? 'Automação' : 'Equipe')}</strong>
                        {message.meta?.simulator && <span className="conversation-message__tag">Simulador</span>}
                      </div>
                      <p>{message.body}</p>
                      <div className="conversation-message__footer">
                        <time>{message.at.slice(11, 16)}</time>
                        <span>{message.status === 'sent' ? 'Enviada' : message.status === 'delivered' ? 'Entregue' : message.status === 'read' ? 'Lida' : message.status === 'failed' ? 'Falhou' : 'Pendente'}</span>
                      </div>
                      {message.status === 'failed' && message.direction === 'out' && message.by !== 'automation' && (
                        <div className="conversation-message__failure" role="status">
                          <span>{message.error || 'Não foi possível enviar esta mensagem.'}</span>
                          <button type="button" onClick={() => void retryMessage(message)}>Tentar novamente</button>
                        </div>
                      )}
                    </article>
                  </div>
                ))}
              </div>

              <footer className="conversation-composer">
                {active.conversation.mode !== 'human' && active.conversation.agentState !== 'human_active' && active.conversation.agentState !== 'waiting_team' && active.conversation.agentState !== 'resolved' && (
                  <p className="conversation-ai-takeover-note">IA atendendo · ao enviar uma resposta, você assume a conversa</p>
                )}
                {sendError && <p role="alert" className="conversation-channel-alert is-error">{sendError}</p>}
                {active.conversation.channel === 'instagram' && draftBytes >= 800 && <p className={cn('conversation-byte-count', draftBytes > INSTAGRAM_TEXT_MAX_BYTES && 'is-over-limit')}>{draftBytes} de {INSTAGRAM_TEXT_MAX_BYTES} bytes do Instagram{draftBytes > INSTAGRAM_TEXT_MAX_BYTES ? ' — reduza para enviar.' : ''}</p>}
                {channelOff(active.conversation) ? (
                  <div role="status" className="conversation-channel-alert is-neutral">
                    <span>Canal desconectado. O histórico continua disponível; conecte o canal para responder.</span><Link href={channelsHref}>Conectar</Link>
                  </div>
                ) : active.conversation.channel === 'instagram' && window && !window.canReply ? null : (
                  <form onSubmit={sendMessage} className="conversation-composer__form">
                    <label className="sr-only" htmlFor="conversation-message">Mensagem</label>
                    <input id="conversation-message" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={channelOff(active.conversation)}
                      placeholder={active.conversation.channel === 'instagram' ? 'Responder no Instagram…' : 'Escreva uma mensagem…'} aria-label="Mensagem" />
                    <button type="submit" aria-label={sending ? 'Enviando…' : 'Enviar'} disabled={sending || !draft.trim() || channelOff(active.conversation)}><Icon n="send" size={15} /><span>{sending ? 'Enviando…' : 'Enviar'}</span></button>
                  </form>
                )}
              </footer>
            </>
          ) : (
            <div className="conversation-selection-empty">
              <span><Icon n="chat" size={21} /></span>
              <h2>Escolha uma conversa</h2>
              <p>Selecione uma pessoa na inbox para ler e responder. O contexto da clínica aparece ao lado.</p>
            </div>
          )}
        </section>

        <aside className="inbox-context" id="conversation-context-panel" aria-label="Contexto da conversa" aria-hidden={compactLayout || !contextOpen}>
          {contextOpen && !compactLayout ? contextContent : null}
        </aside>
      </div>

      <WorkspaceSheet open={contextSheetOpen && compactLayout && !!active && !panel} onClose={() => setContextSheetOpen(false)}
        title={vetClinic ? 'Tutor e paciente' : 'Contexto do cliente'} subtitle="Informações administrativas da conversa" icon="inbox"
        width="max-w-sm">
        <div id="conversation-context-sheet" className="p-4">{contextContent}</div>
      </WorkspaceSheet>

      <QuickRegisterSheet open={quickOpen} onClose={() => setQuickOpen(false)} businessId={businessId} vet={vetClinic} source="conversa"
        initial={active ? { name: active.conversation.name || '', phone: active.conversation.phone || '', email: '' } : undefined}
        onSaved={onQuickSaved} />
    </div>
  );
}
