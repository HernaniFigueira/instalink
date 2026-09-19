'use client';
// "+ Novo agendamento" — o fluxo COMEÇA pelo cliente:
//   1. busca no CRM por nome ou WhatsApp (não cria cadastro duplicado);
//   2. seleciona a pessoa → nome/WhatsApp/e-mail preenchidos e vinculados;
//   3. só oferece "+ Novo cliente" quando a busca não encontra ninguém;
//   4. serviço → data → horário (grade real da agenda) → observação.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { maskPhoneBR } from '@/lib/field-quality';
import { todayISO } from '@/lib/tz';
import { adminBookingMaxDate } from '@/lib/booking-ops';
import { BookingRecurrence } from './BookingRecurrence';
import type { BookingOccurrence } from '@/lib/booking-recurrence';
import type { OccurrencePreview } from '@/lib/booking-series';
import { onlyDigits } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { Professional, Service } from '@/lib/types';
import { Avatar, Badge, Button, Checkbox, Field, IconButton, Input, Notice, Select } from '@/components/ui';

interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  registered: boolean;
  lastInteraction: string;
}

export function NewBookingSheet({ businessId, services, pros, timezone, initial, onClose, onCreated }: {
  businessId: string;
  services: Service[];
  pros: Professional[];
  /** Compatibilidade com chamadores existentes; limite público não restringe a equipe. */
  horizonDays: number;
  /** A2-B5 (F9): fuso do negócio — "hoje" da lista de dias (opcional; ''/ausente = default). */
  timezone?: string;
  /** Cliente já definido (ex.: aberto a partir do CRM) — pula a busca. */
  initial?: {
    contactId?: string; name: string; phone: string; email?: string;
    /** A3.4: agenda pré-preenchida ao clicar num horário vago da grade. */
    date?: string; time?: string; professionalId?: string; serviceId?: string;
  };
  onClose: () => void;
  onCreated: () => void;
}) {
  const bookable = useMemo(() => services.filter((s) => s.bookable && s.active !== false), [services]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [contactId, setContactId] = useState(initial?.contactId || '');
  const [name, setName] = useState(initial?.name || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [newClient, setNewClient] = useState(false);
  const [serviceId, setServiceId] = useState(initial?.serviceId || '');
  const [proId, setProId] = useState(initial?.professionalId || '');
  const [date, setDate] = useState(initial?.date || '');
  const [time, setTime] = useState(initial?.time || '');
  const [note, setNote] = useState('');
  // A3.4 · Bloco 4 — ENCAIXE: horário fora da grade, com conflito mostrado.
  const [fitInOpen, setFitInOpen] = useState(false);
  const [fitInTime, setFitInTime] = useState(initial?.time || '');
  const [fitInConflicts, setFitInConflicts] = useState<Array<{ id: string; customerName: string; time: string; endTime: string; professionalName: string }>>([]);
  const [fitInMessage, setFitInMessage] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [occurrences, setOccurrences] = useState<BookingOccurrence[]>([]);
  const [preview, setPreview] = useState<OccurrencePreview[] | null>(null);
  const requestId = useRef('');
  const [reviewing, setReviewing] = useState(false);
  function changeOccurrences(rows: BookingOccurrence[]) { setOccurrences(rows); setPreview(null); }
  useEffect(() => { setOccurrences([]); setPreview(null); }, [serviceId, date, time, proId, repeat]);
  const [slots, setSlots] = useState<string[]>([]);
  // A2-B3 (F4): estado honesto do dia (fechado × lotado) para a mensagem.
  const [dayState, setDayState] = useState<{ state?: string; full?: boolean; reason?: string } | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{
    count?: number;
    occurrences?: Array<{ id: string; date: string; time: string; professionalName: string }>;
    customer: string;
    service: string;
    professional: string;
    date: string;
    time: string;
    /** A3.4 · Bloco 4: este atendimento nasceu de um encaixe. */
    fitIn?: boolean;
  } | null>(null);
  const seq = useRef(0);
  const slotSeq = useRef(0);
  /** Horário pedido de fora (clique na agenda) — só vale se a grade confirmar. */
  const intendedTime = useRef(initial?.time || '');

  // A2-B5 (F9): "hoje" no fuso do negócio (o servidor continua validando).
  const today = todayISO(new Date(), timezone || undefined);
  const maxDate = adminBookingMaxDate(today);
  const service = bookable.find((s) => s.id === serviceId);
  const eligiblePros = service?.professionalIds?.length
    ? pros.filter((p) => p.active !== false && service.professionalIds.includes(p.id))
    : pros.filter((p) => p.active !== false);

  // Trocar o serviço invalida o profissional escolhido (a lista de elegíveis
  // muda) — mas a PRIMEIRA montagem não conta como troca: o pré-preenchimento
  // vindo da agenda precisa sobreviver.
  const firstService = useRef(true);
  useEffect(() => {
    if (firstService.current) { firstService.current = false; return; }
    setProId(''); setTime(''); setSlots([]); setSlotsError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  useEffect(() => {
    if (!serviceId || !date) { setSlots([]); setSlotsError(''); setDayState(null); setLoadingSlots(false); return; }
    const mySeq = ++slotSeq.current;
    setLoadingSlots(true);
    setSlotsError('');
    // A3.4: não zera o horário às cegas. Se o horário atual (digitado ou
    // pré-preenchido pela agenda) existe na grade real deste dia/ serviço /
    // profissional, ele permanece selecionado; se não existe, sai.
    const intended = intendedTime.current;
    const professionalQuery = proId ? `&professionalId=${encodeURIComponent(proId)}` : '';
    fetch(`/api/bookings?mode=slots-admin&businessId=${businessId}&serviceId=${serviceId}&date=${date}${professionalQuery}`)
      .then(async (r) => {
        const d = await r.json();
        if (mySeq !== slotSeq.current) return;
        if (!r.ok) throw new Error(d.error || 'Não foi possível carregar os horários.');
        const list: string[] = d.slots || [];
        setSlots(list);
        setDayState(d.closed || d.state ? { state: d.state, full: d.full, reason: d.reason } : null);
        setTime((prev) => {
          const want = prev || intended;
          return want && list.includes(want) ? want : '';
        });
        if (list.length === 0 && d.closed) setSlotsError('');
      })
      .catch((e: any) => {
        if (mySeq !== slotSeq.current) return;
        setSlots([]);
        setSlotsError(e.message || 'Não foi possível carregar os horários.');
      })
      .finally(() => {
        if (mySeq !== slotSeq.current) return;
        setLoadingSlots(false);
      });
  }, [businessId, serviceId, date, proId]);

  // Busca no CRM (nome OU WhatsApp) com debounce.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); setSearching(false); return; }
    const mySeq = ++seq.current;
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/contacts?businessId=${businessId}&q=${encodeURIComponent(term)}&limit=8`)
        .then((r) => r.json())
        .then((d) => { if (mySeq === seq.current) setResults(d.contacts || []); })
        .catch(() => {})
        .finally(() => { if (mySeq === seq.current) setSearching(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [query, businessId]);

  const picked = !!contactId || (!!name && !newClient);

  function pick(c: Contact) {
    setContactId(c.id);
    setName(c.name);
    setPhone(c.phone);
    setEmail(c.email || '');
    setNewClient(false);
    setResults([]);
    setQuery('');
  }

  function startNew() {
    const digits = onlyDigits(query);
    setContactId('');
    setName(digits.length >= 10 ? '' : query.trim());
    setPhone(digits.length >= 10 ? query.trim() : '');
    setEmail('');
    setNewClient(true);
    setResults([]);
  }

  function resetClient() {
    setContactId(''); setName(''); setPhone(''); setEmail('');
    setNewClient(false); setQuery(''); setResults([]);
  }

  function payload(rows = occurrences) {
    if (!requestId.current) requestId.current = crypto.randomUUID();
    return {
      businessId, asOwner: true, customerName: name, customerPhone: phone, customerEmail: email,
      contactId: contactId || undefined, serviceId, professionalId: proId, date, time, note,
      ...(repeat ? { series: { requestId: requestId.current, occurrences: rows } } : {}),
    };
  }
  async function review(rows: BookingOccurrence[]) {
    setReviewing(true); setError(''); setPreview(null);
    try {
      const res = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload(rows), preview: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPreview(data.occurrences);
    } catch (e: any) { setError(e.message || 'Não foi possível validar a série.'); }
    finally { setReviewing(false); }
  }
  /**
   * `fitIn` reaproveita o MESMO caminho de criação (createBookingTx): sem
   * `confirmFitIn`, o servidor devolve os conflitos e não grava nada — a tela
   * mostra com quem o horário bate e só então confirma.
   */
  async function save(opts: { fitIn?: boolean; confirmFitIn?: boolean; timeOverride?: string } = {}) {
    if (saving || reviewing) return;
    if (repeat && (!preview || preview.some((r) => r.state !== 'available'))) { setError('Valide e corrija todas as ocorrências antes de confirmar.'); return; }
    setError('');
    if (!name.trim()) { setError('Busque o cliente ou toque em “+ Novo cliente”.'); return; }
    if (onlyDigits(phone).length < 10) { setError('Informe um WhatsApp válido.'); return; }
    const when = opts.timeOverride || time;
    if (!serviceId || !date || !when) { setError('Escolha serviço, data e horário.'); return; }
    if (opts.fitIn && repeat) { setError('Encaixe não cria série — desligue a repetição.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload(),
          ...(opts.timeOverride ? { time: opts.timeOverride } : {}),
          ...(opts.fitIn ? { bookingKind: 'fit_in', confirmFitIn: opts.confirmFitIn === true } : {}),
        }),
      });
      const data = await res.json();
      if (opts.fitIn && res.status === 409) {
        // Conflito: NADA foi criado. Dizemos com quem bate e esperamos o "sim".
        setFitInConflicts(data.conflicts || []);
        setFitInMessage(data.error || 'Este horário tem conflito.');
        setSaving(false);
        return;
      }
      if (!res.ok) {
        if (data.occurrences) setPreview(data.occurrences);
        throw new Error(data.error);
      }
      onCreated();
      setCreated({
        count: data.count,
        occurrences: data.occurrences,
        customer: name,
        service: service?.name || 'Serviço',
        professional: data.occurrences ? 'Veja as ocorrências abaixo' : data.professionalName || eligiblePros.find((p) => p.id === proId)?.name || 'Definido pela agenda',
        date: data.occurrences?.[0]?.date || date,
        time: data.occurrences?.[0]?.time || when,
        fitIn: opts.fitIn === true,
      });
    } catch (e: any) {
      setError(e.message || 'Não foi possível criar o agendamento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Novo agendamento">
      <button type="button" aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-[1px]" />
      <div className="relative w-full sm:max-w-xl bg-[var(--surface)] rounded-t-xl sm:rounded-xl border border-[var(--border)] max-h-[92vh] overflow-y-auto ws-scroll shadow-xl">
        <div className="sticky top-0 z-10 bg-[var(--surface)] px-5 py-3.5 flex items-center justify-between gap-3 border-b border-[var(--border)]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text)]">Novo agendamento</p>
            <p className="text-xs text-[var(--text-muted)]">Cliente → serviço → data → horário</p>
          </div>
          <IconButton icon="x" label="Fechar" size="sm" variant="ghost" onClick={onClose} />
        </div>
        <div className="px-5 py-4 space-y-3.5">
          {created ? (
            <div className="space-y-4" data-booking-created="true">
              <div className="rounded-xl border border-[var(--success-border)] bg-[var(--success-bg)] px-4 py-4">
                <p className="text-base font-bold text-[var(--success-fg)] flex items-center gap-2">
                  <Icon n="check" size={18} strokeWidth={3} /> {created.count ? `${created.count} atendimentos criados` : 'Agendamento criado'}
                  {created.fitIn && <Badge tone="amber">Encaixe</Badge>}
                </p>
                {created.fitIn && (
                  <p className="text-xs text-[var(--success-fg)] mt-1">
                    Encaixe registrado: este horário estava fora da grade e a decisão foi da equipe.
                  </p>
                )}
                <dl className="mt-3 space-y-1.5 text-sm text-[var(--text)]">
                  <div className="flex gap-2"><dt className="font-semibold min-w-24 text-[var(--text-muted)]">Cliente</dt><dd>{created.customer}</dd></div>
                  <div className="flex gap-2"><dt className="font-semibold min-w-24 text-[var(--text-muted)]">Serviço</dt><dd>{created.service}</dd></div>
                  <div className="flex gap-2"><dt className="font-semibold min-w-24 text-[var(--text-muted)]">Profissional</dt><dd>{created.professional}</dd></div>
                  <div className="flex gap-2"><dt className="font-semibold min-w-24 text-[var(--text-muted)]">{created.count ? 'Primeira data' : 'Data'}</dt><dd>{created.date}</dd></div>
                  <div className="flex gap-2"><dt className="font-semibold min-w-24 text-[var(--text-muted)]">Horário</dt><dd>{created.time}</dd></div>
                </dl>
                {created.occurrences && <ol className="mt-3 space-y-1 text-xs tabular-nums">
                  {created.occurrences.map((row, i) => <li key={row.id}>{String(i + 1).padStart(2, '0')}. {row.date.split('-').reverse().join('/')} · {row.time} · {row.professionalName}</li>)}
                </ol>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Button type="button" variant="primary" onClick={onClose}>Fechar</Button>
                <Button type="button" variant="secondary" onClick={() => { window.location.assign(`/agenda?b=${encodeURIComponent(businessId)}&data=${created.date}`); }}>Ver na agenda</Button>
                <Button type="button" variant="secondary" onClick={() => { setCreated(null); setRepeat(false); setOccurrences([]); setPreview(null); requestId.current = ''; setServiceId(''); setDate(''); setTime(''); setNote(''); setError(''); }}>Novo agendamento</Button>
              </div>
            </div>
          ) : (
          <div className="space-y-3">
          {/* 1. Cliente */}
          <div>
            <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">1. Cliente <span className="text-[var(--danger)]">*</span></span>
            {picked ? (
              <div className="flex items-center gap-3 bg-[var(--success-bg)] border border-[var(--success-border)] rounded-lg px-3.5 py-3">
                <Avatar name={name || '?'} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--text)] truncate">{name}</span>
                  <span className="block text-xs text-[var(--success-fg)] truncate">
                    {phone}{email ? ` · ${email}` : ''}
                  </span>
                </span>
                <Badge tone={contactId ? 'green' : 'blue'} icon={contactId ? 'check' : 'spark'}>
                  {contactId ? 'Cadastro vinculado' : 'Novo cliente'}
                </Badge>
                <Button type="button" variant="ghost" size="xs" onClick={resetClient}>Trocar</Button>
              </div>
            ) : (
              <>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                  placeholder="Buscar por nome ou WhatsApp…" aria-label="Buscar cliente" />
                <p className="text-xs text-[var(--text-muted)] mt-1.5">
                  Buscamos no CRM para não duplicar cadastro — o cliente pode já ter conta na sua página.
                </p>
                {searching && <p className="text-xs text-[var(--text-faint)] mt-1.5">Buscando…</p>}
                {!searching && query.trim().length >= 2 && results.length === 0 && !newClient && (
                  <Button type="button" variant="soft" onClick={startNew} className="mt-2 w-full justify-start">
                    + Novo cliente “{query.trim()}”
                  </Button>
                )}
                {!searching && results.length > 0 && (
                  <ul className="mt-2 border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] overflow-hidden">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => pick(c)} className="w-full text-left px-3.5 py-2.5 hover:bg-[var(--surface-hover)] flex items-center gap-2.5">
                          <Avatar name={c.name || '?'} size={30} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-[var(--text)] truncate">{c.name || 'Sem nome'}</span>
                              {c.registered && <Badge tone="green">Já é cliente</Badge>}
                            </span>
                            <span className="block text-xs text-[var(--text-muted)]">{c.phone || 'sem telefone'}</span>
                          </span>
                          <Icon n="chevR" size={14} className="text-[var(--text-faint)] shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {newClient && (
                  <div className="mt-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
                    <p className="text-xs font-semibold text-[var(--text-muted)]">Novo cliente — o contato é criado junto com o agendamento</p>
                    <Field label="Nome" required>
                      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Marlene Silva" />
                    </Field>
                    <Field label="WhatsApp" required>
                      <Input value={maskPhoneBR(phone)} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="(11) 99999-9999" />
                    </Field>
                    <Field label="E-mail" hint="Opcional">
                      <Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="nome@email.com" />
                    </Field>
                    <Button type="button" variant="ghost" size="xs" onClick={() => setNewClient(false)}>Voltar para a busca</Button>
                  </div>
                )}
              </>
            )}
          </div>

          <Field label="2. Serviço" required>
            <Select value={serviceId} disabled={saving || reviewing} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Selecione…</option>
              {bookable.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} min</option>)}
            </Select>
          </Field>

          {service && eligiblePros.length > 1 && (
            <Field label="Profissional" hint="Opcional — em branco a agenda equilibra a equipe automaticamente">
              <Select value={proId} disabled={saving || reviewing} onChange={(e) => setProId(e.target.value)}>
                <option value="">Automático (equilibrar equipe)</option>
                {eligiblePros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          )}

          <Field label="3. Data" required>
            <Input type="date" min={today} max={maxDate} value={date} disabled={saving || reviewing} onChange={(e) => setDate(e.target.value)} />
          </Field>

          {date && serviceId && (
            <div>
              <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">4. Horário <span className="text-[var(--danger)]">*</span></span>
              {loadingSlots ? (
                <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-[var(--border-strong)] border-t-[var(--brand)] rounded-full animate-spin" /> Carregando horários…
                </p>
              ) : slotsError ? (
                <Notice tone="error">{slotsError}</Notice>
              ) : slots.length === 0 ? (
                <Notice tone="warning">
                  {dayState?.full
                    ? 'Todos os horários deste dia estão ocupados. Escolha outro dia.'
                    : dayState?.state === 'closed'
                      ? 'Fechado neste dia. Escolha outro dia.'
                      : 'Nenhum horário disponível.'}
                </Notice>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((t) => (
                    <button key={t} type="button" disabled={saving || reviewing} onClick={() => setTime(t)}
                      aria-pressed={time === t}
                      className={cn('text-xs font-semibold px-3 py-1.5 rounded-md border tabular-nums transition-colors',
                        time === t
                          ? 'bg-[var(--brand)] text-white border-[var(--brand)] shadow-brand'
                          : 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)] hover:border-[var(--brand-border)] hover:text-[var(--brand-fg)]')}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* A3.4 · Bloco 4 — ENCAIXE. Fica DEPOIS da grade: primeiro o que
              está livre de verdade; o encaixe é a exceção, e o conflito é dito
              com nome e horário antes de qualquer coisa ser gravada. */}
          {date && serviceId && !repeat && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3">
              {!fitInOpen ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--text)]">Precisa de um horário que não está na lista?</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">O encaixe aceita fora da grade — mostra o conflito e é registrado como encaixe.</p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={() => { setFitInOpen(true); setFitInMessage(''); setFitInConflicts([]); setFitInTime(time || '09:00'); }}>
                    <Icon n="clock" size={13} /> Encaixar
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Horário do encaixe">
                      <Input type="time" value={fitInTime} onChange={(e) => { setFitInTime(e.target.value); setFitInConflicts([]); setFitInMessage(''); }} className="w-32" />
                    </Field>
                    <Button type="button" variant="warning" size="sm" disabled={saving || !fitInTime}
                      onClick={() => save({ fitIn: true, confirmFitIn: false, timeOverride: fitInTime })}>
                      {saving ? 'Verificando…' : 'Verificar e encaixar'}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setFitInOpen(false); setFitInConflicts([]); setFitInMessage(''); }}>
                      Cancelar
                    </Button>
                  </div>
                  {fitInMessage && (
                    <Notice tone="warning" title="Este horário tem conflito">
                      <span className="block">{fitInMessage} Nada foi agendado ainda.</span>
                      <span className="block mt-1.5 space-y-1">
                        {fitInConflicts.map((c) => (
                          <span key={c.id} className="block text-xs">
                            • {c.time}–{c.endTime} · {c.customerName}{c.professionalName ? ` · ${c.professionalName}` : ''}
                          </span>
                        ))}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" variant="warning" size="sm" disabled={saving}
                          onClick={() => save({ fitIn: true, confirmFitIn: true, timeOverride: fitInTime })}>
                          {saving ? 'Encaixando…' : 'Encaixar mesmo assim'}
                        </Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => { setFitInConflicts([]); setFitInMessage(''); }}>
                          Escolher outro
                        </Button>
                      </span>
                    </Notice>
                  )}
                  {!fitInMessage && (
                    <p className="text-xs text-[var(--text-muted)]">
                      O horário precisa estar dentro do funcionamento do dia e a equipe confirma o conflito quando existir.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <Checkbox label="Repetir este agendamento" hint="Séries (semanal, quinzenal…) com conferência ocorrência por ocorrência."
            checked={repeat} disabled={saving || reviewing} onChange={setRepeat} />
          {repeat && <BookingRecurrence first={{ date, time, professionalId: proId }} rows={occurrences} preview={preview}
            pros={eligiblePros} min={today} max={maxDate} busy={saving || reviewing}
            onChange={changeOccurrences} onReview={review} onDisable={() => setRepeat(false)} />}

          <Field label="Observação" hint="Opcional — fica no histórico do atendimento">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ex: cliente prefere esmalte claro" />
          </Field>

          {error && <Notice tone="error">{error}</Notice>}
          <Button type="button" variant="primary" size="lg" onClick={() => save()}
            disabled={saving || reviewing || (repeat && (!preview || preview.some((r) => r.state !== 'available')))}
            className="w-full">
            {saving ? 'Agendando…' : reviewing ? 'Validando…' : repeat ? `Confirmar ${occurrences.length} atendimentos` : 'Salvar agendamento'}
          </Button>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
