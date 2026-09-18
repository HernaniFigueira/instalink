'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { BookingConfig, LeadStatus, BusinessPipeline, PipelineStage } from '@/lib/types';
import { stagesInOrder } from '@/lib/pipeline-stages';
import { cn, money, paginate, waLink } from '@/lib/utils';
import { humanDay, humanDateTime } from '@/lib/tz';
import { BOOKING_STATUS, LEAD_STATUS, toneCls, type StatusDef } from '@/lib/status';
import { leadOriginLabel } from '@/lib/leads';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { effectiveHorizonDays } from '@/lib/booking-ops';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { apiGet, apiSend } from '@/lib/api-client';

// Observações do cliente (P2): histórico append-only com autor e data.
// `legacy: true` marca o registro antigo (campo único), preservado como está.
interface VisibleNote { id: string; at: string; by: string; byName: string; text: string; bookingId?: string; legacy?: boolean }

interface Person {
  key: string; contactId: string; note: string;
  notes?: VisibleNote[];
  customerId: string; name: string; phone: string; email: string;
  registered: boolean; customerSince: string; source: string; marketingOptIn: boolean;
  orders: number; spent: number; lastOrderAt: string;
  bookings: Array<{
    id: string; customerName: string; date: string; time: string; status: string; service: string;
    professional?: string; rescheduleCount?: number; previousId?: string;
  }>;
  leads: Array<{ id: string; origin: string; status: string; stageId: string; stageName: string; interest: string; action: string; createdAt: string; stageHistory?: any[]; priority?: string; assignedUserId?: string; lastInteraction?: string }>;
  conversations?: Array<{ id: string; channel: string; status: string; at: string; preview: string; unread: number }>;
  lastSeen: string;
}

// Data curta do evento ("14 SET · 10:00") — leitura rápida no histórico.
function eventDay(iso: string): string {
  const [, m, d] = (iso || '').slice(0, 10).split('-');
  if (!d) return '';
  const MES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  return `${Number(d)} ${MES[Number(m) - 1] || m}`;
}

// A3: etapa é a verdade; LEAD_STATUS é projeção. Navegação sequencial via pipeline quando disponível.
const NEXT_LEAD: Record<string, LeadStatus | ''> = { new: 'contacted', contacted: 'qualified', qualified: 'converted' };
const NEXT_LEAD_LABEL: Record<string, string> = { new: 'Marcar contato', contacted: 'Qualificar', qualified: 'Marcar conversão' };

export default function ClientesPage() {
  const params = useSearchParams();
  const router = useRouter();
  const businessId = params.get('b') || '';
  const [people, setPeople] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  // Busca profunda: /clientes?b=…&q=telefone abre já filtrada (usado pelo
  // "Cliente e histórico" do detalhe do agendamento).
  const [q, setQ] = useState(params.get('q') || '');
  const [search, setSearch] = useState(params.get('q') || '');
  // A1.2 · Bloco 1: a esteira tinha DUAS portas (a rota /esteira e esta visão
  // dentro de Clientes). Agora existe UMA: /funil. O link antigo
  // (/clientes?view=esteira) continua chegando no lugar certo.
  const legacyEsteira = params.get('view') === 'esteira';
  useEffect(() => {
    if (!legacyEsteira) return;
    router.replace(`/funil${businessId ? `?b=${businessId}` : ''}`);
  }, [legacyEsteira, businessId, router]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // Página do HISTÓRICO expandido (auditoria §18): cliente com 20, 30, 50
  // eventos não pode transformar a tela numa parede infinita. 5 por página,
  // sempre com total e controles — a paginação é do histórico, não da lista.
  const [histPage, setHistPage] = useState(1);
  useEffect(() => { setHistPage(1); }, [open]);
  const [error, setError] = useState('');
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [legacyDraft, setLegacyDraft] = useState<Record<string, string>>({});
  const [editingLegacy, setEditingLegacy] = useState('');
  const [bookingFor, setBookingFor] = useState<Person | null>(null);
  const [services, setServices] = useState<any[]>([]);
  const [pros, setPros] = useState<any[]>([]);

  // 403 → aviso amigável (sessão preservada), nunca lista "carregando" para sempre.
  const { denied, report } = useAreaLoad('Clientes');
  // A1.2 · Bloco 2: a UI concorda com o guard — o atalho para o Funil só
  // aparece para quem tem a permissão 'leads' (a mesma que /funil exige).
  // Nada de oferecer porta que o servidor vai negar em seguida.
  const { permissions, ready: permsReady } = usePanelPermissions();
  const canFunil = permsReady && permissions.leads === true;
  const [pipeline, setPipeline] = useState<BusinessPipeline | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<{ people?: Person[]; total?: number; pages?: number }>(
      `/api/people360?businessId=${businessId}&q=${encodeURIComponent(search)}&page=${page}`,
      { scope: 'area', area: 'Clientes' },
    );
    if (!report(res)) { setLoaded(true); return; }
    const d = res.data || {};
    setPeople(d.people || []);
    setTotal(d.total || 0);
    setPages(d.pages || 1);
    setLoaded(true);
    // Busca esteira para renderizar etapa real (stageId) e ações contextuais
    try {
      const pRes = await apiGet<{ pipeline?: BusinessPipeline }>(`/api/pipeline?businessId=${businessId}`, { scope: 'area', area: 'Clientes' });
      if (pRes.ok && (pRes.data as any)?.pipeline) setPipeline((pRes.data as any).pipeline);
    } catch {}
  }, [businessId, search, page, report]);

  useEffect(() => { load(); }, [load]);

  // A2-B3 (F5): horizonte real do negócio para o "+ Novo agendamento".
  const [bookingCfg, setBookingCfg] = useState<BookingConfig | null>(null);
  // A2-B5 (F9): fuso do negócio para o sheet de agendamento.
  const [bizTz, setBizTz] = useState('');

  function openBooking(p: Person) {
    setBookingFor(p);
    apiGet<{ services?: any[]; professionals?: any[]; business?: { booking?: BookingConfig; businessTimezone?: string } }>(`/api/catalog/get?businessId=${businessId}`, { scope: 'action', area: 'Clientes' })
      .then((res) => {
        if (!res.ok) { setError(res.message); return; }
        if (res.data?.business?.booking) setBookingCfg(res.data.business.booking);
        setBizTz(res.data?.business?.businessTimezone || '');
        setServices(res.data?.services || []);
        setPros(res.data?.professionals || []);
      });
  }

  async function setConsent(p: Person, value: boolean) {
    if (!p.contactId) { setError('Este contato ainda não tem cadastro no CRM.'); return; }
    setError('');
    const res = await apiSend('/api/contacts', 'PATCH', { businessId, id: p.contactId, marketingOptIn: value }, { scope: 'action', area: 'Clientes' });
    if (!res.ok) { setError(res.message || 'Não foi possível atualizar.'); return; }
    load();
  }

  // ACRESCENTA uma observação (nunca sobrescreve): o histórico inteiro fica
  // visível, com autor e data — continuidade de atendimento entre profissionais.
  async function addNote(p: Person) {
    if (!p.contactId) return;
    const text = (noteDraft[p.contactId] ?? '').trim();
    if (!text) return;
    setError('');
    const res = await apiSend('/api/contacts', 'PATCH', { businessId, id: p.contactId, addNote: { text } }, { scope: 'action', area: 'Clientes' });
    if (!res.ok) { setError(res.message || 'Não foi possível salvar a observação.'); return; }
    setNoteDraft((d) => ({ ...d, [p.contactId]: '' }));
    load();
  }

  // Edição do REGISTRO ANTERIOR (campo legado): continua existindo, atrás de
  // um clique — o fluxo padrão é acrescentar, para não perder histórico.
  async function saveLegacyNote(p: Person) {
    if (!p.contactId) return;
    setError('');
    const note = legacyDraft[p.contactId] ?? p.note;
    const res = await apiSend('/api/contacts', 'PATCH', { businessId, id: p.contactId, note }, { scope: 'action', area: 'Clientes' });
    if (!res.ok) { setError(res.message || 'Não foi possível salvar.'); return; }
    setEditingLegacy('');
    load();
  }

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setSearch(q); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  async function setLead(id: string, statusOrStage: string) {
    setError('');
    // A3: envia stageId quando corresponde a uma etapa real; fallback status para compatibilidade
    let payload: any = { businessId, id };
    if (pipeline && pipeline.stages.some((s) => s.id === statusOrStage)) payload.stageId = statusOrStage;
    else payload.status = statusOrStage;
    const res = await apiSend('/api/leads', 'PATCH', payload, { scope: 'action', area: 'Clientes' });
    if (!res.ok) { setError(res.message || 'Não foi possível atualizar.'); return; }
    load();
  }
  function nextStageForLead(lead: { stageId?: string; status: string }): string {
    if (!pipeline) return NEXT_LEAD[lead.status] || '';
    const curId = lead.stageId || (lead.status as string);
    // tenta encontrar índice atual na ordem
    const ordered = [...pipeline.stages].sort((a,b)=>a.order-b.order);
    const idx = ordered.findIndex((s)=> s.id === curId);
    if (idx >=0 && idx+1 < ordered.length) return ordered[idx+1].id;
    return NEXT_LEAD[lead.status] || '';
  }
  function nextStageLabelForLead(lead: { stageId?: string; status: string }): string {
    const nid = nextStageForLead(lead);
    if (!nid) return '';
    if (pipeline) { const s = pipeline.stages.find((x)=>x.id===nid); if (s) return `Avançar → ${s.name}`; }
    return (NEXT_LEAD_LABEL as any)[lead.status] || `Avançar`;
  }
  

  const bookDef = (s: string): StatusDef => (BOOKING_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' };
  const leadDef = (s: string): StatusDef => (LEAD_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' };
  const stageDef = (lead: { stageId?: string; status: string }): StatusDef => {
    if (lead.stageId && pipeline) {
      const st = pipeline.stages.find((x)=>x.id===lead.stageId);
      if (st) return { panel: st.name, tone: (st.color as any) || 'zinc', consumer: st.name, desc: '' } as unknown as StatusDef;
    }
    return leadDef(lead.status);
  };

  // Monta a linha do tempo unificada (histórico 360): agendamentos,
  // conversas e leads misturados por data — eventos independentes.
  type HistoryEvent = {
    kind: 'booking' | 'conversation' | 'lead';
    id: string;
    sortKey: string;
    icon: string;
    when: string;
    title: string;
    subtitle?: string;
    badge?: string;
    badgeCls?: string;
    tone?: StatusDef['tone'];
    status?: string;
    actions?: React.ReactNode;
  };
  function historyEvents(p: Person): HistoryEvent[] {
    const out: HistoryEvent[] = [];
    for (const b of p.bookings) {
      const d = bookDef(b.status);
      out.push({
        kind: 'booking', id: b.id, sortKey: `${b.date}T${b.time || '00:00'}`, icon: 'calendar',
        when: `${eventDay(b.date)}${b.time ? ` · ${b.time}` : ''}`,
        title: b.service,
        subtitle: [b.professional, (b.rescheduleCount || 0) > 0 ? `reagendado ${b.rescheduleCount}×` : ''].filter(Boolean).join(' · ') || 'Atendimento',
        badge: d.panel, tone: d.tone, status: b.status,
        actions: (
          <div className="mt-2">
            <Link href={`/agenda?b=${businessId}&data=${b.date}`} className="text-xs font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900">
              Ver na agenda
            </Link>
          </div>
        ),
      });
    }
    for (const c of p.conversations || []) {
      out.push({
        kind: 'conversation', id: c.id, sortKey: c.at || '', icon: 'whatsapp',
        when: `${eventDay((c.at || '').slice(0, 10))}${(c.at || '').length >= 16 ? ` · ${c.at.slice(11, 16)}` : ''}`,
        title: c.channel === 'whatsapp' ? 'Conversa pelo WhatsApp' : 'Conversa com o assistente',
        subtitle: c.preview ? `“${c.preview.slice(0, 140)}”` : (c.status === 'open' ? 'Em aberto' : 'Encerrada'),
        badge: (c.unread || 0) > 0 ? `${c.unread} não lida${c.unread > 1 ? 's' : ''}` : undefined,
        badgeCls: (c.unread || 0) > 0 ? 'bg-blue-100 text-blue-800 border-blue-200' : undefined,
        tone: 'blue',
      });
    }
    for (const l of p.leads) {
      const d = stageDef(l as any);
      const nextId = nextStageForLead(l as any);
      const nextLabel = nextStageLabelForLead(l as any);
      out.push({
        kind: 'lead', id: l.id, sortKey: l.createdAt, icon: 'spark',
        when: eventDay(l.createdAt.slice(0, 10)),
        title: `Lead via ${leadOriginLabel(l.origin)}${(l as any).stageName ? ` · ${(l as any).stageName}` : ''}`,
        subtitle: [l.interest, l.action].filter(Boolean).join(' · ') || undefined,
        badge: d.panel, tone: d.tone as any,
        actions: (
          <div className="flex gap-1.5 mt-2">
            {nextId && (
              <button onClick={() => setLead(l.id, nextId)} className="text-xs font-medium bg-zinc-900 text-white px-2.5 py-1 rounded-md">{nextLabel}</button>
            )}
            {l.status !== 'lost' && l.status !== 'converted' && l.stageId !== 'converted' && (
              <button onClick={() => setLead(l.id, 'lost')} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md">Perdido</button>
            )}
            <Link href={`/funil?b=${businessId}#${l.id}`} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md inline-flex items-center gap-1">Ver no funil <Icon n="chevR" size={10} /></Link>
          </div>
        ),
      });
    }
    return out.sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Base única — agendamentos, histórico e relacionamento (visão 360){canFunil ? '. As oportunidades por etapa estão no Funil' : ''}.</p>
        </div>
        <span className="text-xs font-medium text-zinc-500 bg-white border border-zinc-200 rounded-md px-2.5 py-1 hidden sm:inline">{total} contatos</span>
      </div>
      {error && <p className="mb-3 text-sm font-medium bg-red-600 text-white rounded-md px-3 py-2">{error}</p>}

      {/* Uma porta por conceito: aqui é a lista de clientes (CRM); as
          oportunidades por etapa vivem em /funil. O atalho contextual
          permanece — o que saiu foi a SEGUNDA cópia da mesma tela. A1.2 ·
          Bloco 2: o atalho só aparece com a permissão que /funil exige —
          a UI nunca oferece uma porta que o guard vai negar. */}
      {canFunil && (
        <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 rounded-lg w-fit mb-3 max-w-full">
          <span className="text-xs font-semibold px-3 py-1.5 rounded-md bg-white shadow-sm border border-zinc-200 text-zinc-900">
            Lista de Clientes (CRM)
          </span>
          <Link href={`/funil?b=${businessId}`}
            className="text-xs font-semibold px-3 py-1.5 rounded-md text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1">
            Funil de oportunidades <Icon n="chevR" size={12} />
          </Link>
        </div>
      )}

      {legacyEsteira ? null : (
        <>
          {/* Toolbar workspace — filtros + busca em linha, não card */}
          <div className="bg-white border border-zinc-200 flex items-center gap-2 px-3 py-2 mb-3">
            <div className="relative flex-1">
              <Icon n="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou WhatsApp…"
                className="w-full bg-zinc-50 border border-zinc-200 rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-zinc-300 focus:bg-white" />
            </div>
            <span className="text-xs text-zinc-500 hidden sm:inline">{total} · pág {page}/{pages}</span>
          </div>

          {denied ? <AccessDenied area="Clientes" /> : !loaded ? <ListSkeleton rows={4} /> : people.length === 0 ? (
            <div className="bg-white border border-zinc-200 text-center py-12 px-6">
              <div className="mx-auto w-10 h-10 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="users" size={20} /></div>
              <h3 className="font-semibold text-sm mt-3">{search ? 'Ninguém encontrado' : 'Nenhum cliente ainda'}</h3>
              <p className="text-sm text-zinc-500 mt-1">{search ? 'Tente outro termo.' : 'Agendamentos, cadastros na página e conversas criam o perfil automaticamente.'}</p>
            </div>
          ) : (
            <div className="bg-white border border-zinc-200">
              {/* Header da tabela — denso, divisórias */}
              <div className="hidden sm:grid grid-cols-[1fr_140px_120px_80px] gap-3 px-4 py-2 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide uppercase text-zinc-500">
                <span>Nome</span><span>WhatsApp</span><span>Último contato</span><span className="text-right">Ações</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {people.map((p) => (
                  <div key={p.key} className="bg-white">
                    <button onClick={() => setOpen(open === p.key ? null : p.key)} className="w-full text-left hover:bg-zinc-50">
                      <div className="flex sm:grid sm:grid-cols-[1fr_140px_120px_80px] items-center gap-3 px-4 py-3">
                        <span className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
                            {(p.name || '?').slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{p.name || 'Sem nome'}</span>
                          {p.registered && <span className="text-[10px] font-semibold bg-zinc-900 text-white px-1.5 py-0.5 rounded">CAD</span>}
                        </span>
                        <span className="block text-xs text-zinc-500 truncate sm:hidden">{p.phone || '—'} · {p.lastSeen ? humanDay(p.lastSeen.slice(0, 10)) : '—'}</span>
                      </span>
                    </span>
                    <span className="hidden sm:block text-sm text-zinc-700 truncate">{p.phone || '—'}</span>
                    <span className="hidden sm:block text-xs text-zinc-500">{p.lastSeen ? humanDay(p.lastSeen.slice(0, 10)) : '—'}</span>
                    <span className="hidden sm:flex justify-end items-center gap-1.5 text-xs text-zinc-500 shrink-0">
                      {p.orders > 0 && <span className="font-medium text-zinc-900">{money(p.spent)}</span>}
                      <Icon n={open === p.key ? 'chevU' : 'chevD'} size={14} className="text-zinc-400" />
                    </span>
                    <span className="sm:hidden text-zinc-400"><Icon n={open === p.key ? 'chevU' : 'chevD'} size={14} /></span>
                  </div>
                  <div className="sm:hidden px-4 pb-1 -mt-1 flex gap-2 text-xs text-zinc-500">
                    {p.orders > 0 && <span>{p.orders} ped.</span>}
                    {p.bookings.length > 0 && <span>{p.bookings.length} agend.</span>}
                    {p.marketingOptIn && <span className="text-emerald-700">consentido</span>}
                  </div>
                </button>
                {open === p.key && (
                  <div className="border-t border-zinc-200 bg-zinc-50/50 px-4 py-4 space-y-4">
                    {/* ── HISTÓRICO (Customer 360) ──
                        Cada evento é um bloco independente: data·hora, o quê,
                        quem, status. Alternância claro/branco muito sutil,
                        borda fina — separação visual + leitura rápida.
                        Agendamentos, conversas e leads convivem na mesma
                        linha do tempo; atendimento concluído permanece aqui
                        mesmo depois de um reagendamento. */}
                    {p.bookings.length + (p.conversations?.length ?? 0) + p.leads.length > 0 ? (
                      (() => {
                        const events = historyEvents(p);
                        const H = paginate(events, histPage, 5);
                        return (
                      <div>
                        <p className="text-[11px] font-semibold tracking-wide uppercase text-zinc-500 mb-2">
                          Histórico <span className="font-normal normal-case text-zinc-400">· {H.total} {H.total === 1 ? 'evento' : 'eventos'}</span>
                        </p>
                        <div className="space-y-1.5">
                          {H.slice.map((e, i) => (
                            <div key={`${e.kind}-${e.id}`} className={cn('border border-zinc-200 rounded-md px-3 py-2.5', i % 2 === 0 ? 'bg-zinc-50/70' : 'bg-white')}>
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[11px] font-semibold text-zinc-500 tabular-nums inline-flex items-center gap-1.5">
                                  <Icon n={e.icon} size={12} className="text-zinc-400" />
                                  {e.when}
                                </p>
                                {e.badge && (
                                  <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${e.badgeCls || toneCls(e.tone || 'zinc')}`}>
                                    {e.badge}{e.kind === 'booking' && e.status === 'completed' ? ' · ✓' : ''}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm font-medium text-zinc-900 mt-1 leading-snug">{e.title}</p>
                              {e.subtitle && <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{e.subtitle}</p>}
                              {e.actions}
                            </div>
                          ))}
                        </div>
                        {H.pages > 1 && (
                          <div className="flex items-center justify-between gap-2 mt-2">
                            <button onClick={() => setHistPage((x) => Math.max(1, x - 1))} disabled={H.page <= 1}
                              className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md disabled:opacity-40">Anterior</button>
                            <div className="flex items-center gap-1" role="navigation" aria-label="Páginas do histórico">
                              {Array.from({ length: H.pages }, (_, i) => i + 1).map((n) => (
                                <button key={n} onClick={() => setHistPage(n)} aria-current={n === H.page ? 'page' : undefined}
                                  className={cn('w-7 h-7 text-xs font-semibold rounded-md border',
                                    n === H.page ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50')}>
                                  {n}
                                </button>
                              ))}
                            </div>
                            <button onClick={() => setHistPage((x) => Math.min(H.pages, x + 1))} disabled={H.page >= H.pages}
                              className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md disabled:opacity-40">Próxima</button>
                          </div>
                        )}
                      </div>
                        );
                      })()
                    ) : (
                      <p className="text-sm text-zinc-500">Sem eventos ainda — agendamentos, conversas e leads aparecem aqui.</p>
                    )}
                    <div className="flex items-center justify-between gap-3 bg-white border border-zinc-200 px-3 py-2.5">
                      <div>
                        <p className="text-xs font-semibold">Autoriza receber promoções</p>
                        <p className="text-xs text-zinc-500">Sem isso não entra em campanha.</p>
                      </div>
                      <button onClick={() => setConsent(p, !p.marketingOptIn)} role="switch" aria-checked={p.marketingOptIn} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${p.marketingOptIn ? 'bg-zinc-900' : 'bg-zinc-300'}`}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow ${p.marketingOptIn ? 'left-4.5' : 'left-0.5'}`} style={{ left: p.marketingOptIn ? '18px' : '2px' }} />
                      </button>
                    </div>
                    {p.contactId && (
                      <div>
                        <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Observações da equipe</p>
                        {(p.notes || []).length === 0 ? (
                          <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2">
                            Nenhuma observação ainda. O que você escrever aqui fica no histórico do cliente e ajuda quem atender depois.
                          </p>
                        ) : (
                          <ul className="space-y-1.5 mb-2">
                            {(p.notes || []).map((n) => (
                              <li key={n.id} className="bg-white border border-zinc-200 rounded-md px-3 py-2">
                                <p className="text-sm text-zinc-800 whitespace-pre-wrap break-words">{n.text}</p>
                                <p className="text-[11px] text-zinc-400 mt-1">
                                  {n.legacy
                                    ? 'Registro anterior (sem autor/data)'
                                    : <>{n.byName || 'Equipe'}{n.at ? ` · ${humanDateTime(n.at.slice(0, 10), n.at.slice(11, 16))}` : ''}{n.bookingId ? ' · sobre um agendamento' : ''}</>}
                                </p>
                                {n.legacy && (
                                  editingLegacy === n.id ? (
                                    <div className="flex gap-2 mt-2">
                                      <input defaultValue={p.note} onChange={(e) => setLegacyDraft((d) => ({ ...d, [p.contactId]: e.target.value }))} className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                                      <button onClick={() => saveLegacyNote(p)} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-1.5 rounded-md">Salvar</button>
                                      <button onClick={() => setEditingLegacy('')} className="text-xs font-medium text-zinc-500 px-2">Cancelar</button>
                                    </div>
                                  ) : (
                                    <button onClick={() => setEditingLegacy(n.id)} className="text-[11px] font-medium text-zinc-500 underline mt-1">Editar registro anterior</button>
                                  )
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="flex gap-2">
                          <input
                            value={noteDraft[p.contactId] ?? ''}
                            onChange={(e) => setNoteDraft((d) => ({ ...d, [p.contactId]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') addNote(p); }}
                            placeholder="Nova observação (ex: prefere manhã, alergia a X…)"
                            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                          />
                          <button onClick={() => addNote(p)} disabled={!(noteDraft[p.contactId] || '').trim()} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md disabled:opacity-40">Adicionar</button>
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1">As observações anteriores nunca são apagadas — o histórico é preservado.</p>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button onClick={() => openBooking(p)} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Icon n="calendarPlus" size={14} /> Novo agendamento</button>
                      <Link href={`/agenda?b=${businessId}`} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Icon n="calendar" size={14} /> Abrir agenda</Link>
                      {p.phone && (
                        <a href={waLink(p.phone, `Olá, ${(p.name || '').split(' ')[0]}!`)} target="_blank" rel="noreferrer" className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Icon n="whatsapp" size={14} /> WhatsApp</a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 bg-zinc-50 text-xs">
              <button onClick={() => setPage((x) => Math.max(1, x - 1))} disabled={page <= 1} className="font-medium bg-white border border-zinc-200 px-3 py-1.5 rounded-md disabled:opacity-40">Anterior</button>
              <span className="text-zinc-500 font-medium">{page} de {pages} · {total} contatos</span>
              <button onClick={() => setPage((x) => Math.min(pages, x + 1))} disabled={page >= pages} className="font-medium bg-white border border-zinc-200 px-3 py-1.5 rounded-md disabled:opacity-40">Próxima</button>
            </div>
          )}
        </div>
      )}
        </>
      )}

      {bookingFor && (
        <NewBookingSheet
          businessId={businessId}
          services={services}
          pros={pros}
          horizonDays={effectiveHorizonDays(bookingCfg)}
          timezone={bizTz}
          initial={{ contactId: bookingFor.contactId, name: bookingFor.name, phone: bookingFor.phone, email: bookingFor.email }}
          onClose={() => setBookingFor(null)}
          onCreated={load}
        />
      )}
    </>
  );
}
