'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { LeadStatus } from '@/lib/types';
import { cn, money, waLink } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { BOOKING_STATUS, LEAD_STATUS, toneCls, type StatusDef } from '@/lib/status';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';

interface Person {
  key: string; contactId: string; note: string; customerId: string; name: string; phone: string; email: string;
  registered: boolean; customerSince: string; source: string; marketingOptIn: boolean;
  orders: number; spent: number; lastOrderAt: string;
  bookings: Array<{
    id: string; customerName: string; date: string; time: string; status: string; service: string;
    professional?: string; rescheduleCount?: number; previousId?: string;
  }>;
  leads: Array<{ id: string; origin: string; status: string; interest: string; action: string; createdAt: string }>;
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

const NEXT_LEAD: Record<string, LeadStatus | ''> = { new: 'contacted', contacted: 'qualified', qualified: 'converted' };
const NEXT_LEAD_LABEL: Record<string, string> = { new: 'Marcar contato', contacted: 'Qualificar', qualified: 'Marcar conversão' };
const ORIGIN_LABEL: Record<string, string> = {
  chat_ai: 'chat', quote: 'orçamento', booking_cta: 'reserva', whatsapp_click: 'WhatsApp',
  share: 'indicação', cart_abandoned: 'carrinho', manual: 'manual',
};

export default function ClientesPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [people, setPeople] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [bookingFor, setBookingFor] = useState<Person | null>(null);
  const [services, setServices] = useState<any[]>([]);
  const [pros, setPros] = useState<any[]>([]);

  // 403 → aviso amigável (sessão preservada), nunca lista "carregando" para sempre.
  const { denied, report } = useAreaLoad('Clientes');

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
  }, [businessId, search, page, report]);

  useEffect(() => { load(); }, [load]);

  function openBooking(p: Person) {
    setBookingFor(p);
    apiGet<{ services?: any[]; professionals?: any[] }>(`/api/catalog/get?businessId=${businessId}`, { scope: 'action', area: 'Clientes' })
      .then((res) => {
        if (!res.ok) { setError(res.message); return; }
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

  async function saveNote(p: Person) {
    if (!p.contactId) return;
    setError('');
    const note = noteDraft[p.contactId] ?? p.note;
    const res = await apiSend('/api/contacts', 'PATCH', { businessId, id: p.contactId, note }, { scope: 'action', area: 'Clientes' });
    if (!res.ok) { setError(res.message || 'Não foi possível salvar.'); return; }
    load();
  }

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setSearch(q); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  async function setLead(id: string, status: string) {
    setError('');
    const res = await apiSend('/api/leads', 'PATCH', { businessId, id, status }, { scope: 'action', area: 'Clientes' });
    if (!res.ok) { setError(res.message || 'Não foi possível atualizar.'); return; }
    load();
  }

  const bookDef = (s: string): StatusDef => (BOOKING_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' };
  const leadDef = (s: string): StatusDef => (LEAD_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' };

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
      const d = leadDef(l.status);
      out.push({
        kind: 'lead', id: l.id, sortKey: l.createdAt, icon: 'spark',
        when: eventDay(l.createdAt.slice(0, 10)),
        title: `Lead via ${ORIGIN_LABEL[l.origin] || l.origin}`,
        subtitle: [l.interest, l.action].filter(Boolean).join(' · ') || undefined,
        badge: d.panel, tone: d.tone,
        actions: (
          <div className="flex gap-1.5 mt-2">
            {NEXT_LEAD[l.status] && (
              <button onClick={() => setLead(l.id, NEXT_LEAD[l.status])} className="text-xs font-medium bg-zinc-900 text-white px-2.5 py-1 rounded-md">{NEXT_LEAD_LABEL[l.status]}</button>
            )}
            {l.status !== 'lost' && l.status !== 'converted' && (
              <button onClick={() => setLead(l.id, 'lost')} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md">Perdido</button>
            )}
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
          <p className="text-sm text-zinc-500 mt-0.5">Base única — agendamentos, histórico, conversas e relacionamento no mesmo perfil (visão 360).</p>
        </div>
        <span className="text-xs font-medium text-zinc-500 bg-white border border-zinc-200 rounded-md px-2.5 py-1 hidden sm:inline">{total} contatos</span>
      </div>
      {error && <p className="mb-3 text-sm font-medium bg-red-600 text-white rounded-md px-3 py-2">{error}</p>}

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
                      <div>
                        <p className="text-[11px] font-semibold tracking-wide uppercase text-zinc-500 mb-2">Histórico</p>
                        <div className="space-y-1.5">
                          {historyEvents(p).map((e, i) => (
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
                      </div>
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
                        <div className="flex gap-2">
                          <input defaultValue={p.note} onChange={(e) => setNoteDraft((d) => ({ ...d, [p.contactId]: e.target.value }))} placeholder="Ex: prefere manhã, alergia a X…" className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                          <button onClick={() => saveNote(p)} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md">Salvar</button>
                        </div>
                      </div>
                    )}
                    {p.phone && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button onClick={() => openBooking(p)} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Icon n="calendarPlus" size={14} /> Novo agendamento</button>
                        <a href={waLink(p.phone, `Olá, ${(p.name || '').split(' ')[0]}!`)} target="_blank" rel="noreferrer" className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Icon n="whatsapp" size={14} /> WhatsApp</a>
                      </div>
                    )}
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

      {bookingFor && (
        <NewBookingSheet
          businessId={businessId}
          services={services}
          pros={pros}
          horizonDays={60}
          initial={{ contactId: bookingFor.contactId, name: bookingFor.name, phone: bookingFor.phone, email: bookingFor.email }}
          onClose={() => setBookingFor(null)}
          onCreated={load}
        />
      )}
    </>
  );
}
