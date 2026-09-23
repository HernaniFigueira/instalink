'use client';
// "+ Novo agendamento" — o fluxo COMEÇA pelo cliente:
//   1. busca no CRM por nome ou WhatsApp (não cria cadastro duplicado);
//   2. seleciona a pessoa → nome/WhatsApp/e-mail preenchidos e vinculados;
//   3. só oferece "+ Novo cliente" quando a busca não encontra ninguém;
//   4. serviço → data → horário (grade real da agenda) → observação.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { PhoneBRInput } from '@/components/dashboard/PhoneBRInput';
import { nowHM, todayISO } from '@/lib/tz';
import { fitInPastError } from '@/lib/fit-in';
import { adminBookingMaxDate } from '@/lib/booking-ops';
import { BookingRecurrence } from './BookingRecurrence';
import type { BookingOccurrence } from '@/lib/booking-recurrence';
import type { OccurrencePreview } from '@/lib/booking-series';
import { onlyDigits } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { Pet, Professional, Service } from '@/lib/types';
import { apiGet, apiSend } from '@/lib/api-client';
import { breedSuggestions, PET_SPECIES, PET_SPECIES_LABELS, validatePet } from '@/lib/pets';
import { Drawer, Avatar, Badge, Button, Checkbox, Field, IconButton, Input, Notice, Select } from '@/components/ui';

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
  /**
   * P0-2 — fluxo EXPLÍCITO de cliente novo:
   *   search     → busca no CRM
   *   new-form   → cadastro temporário (ainda NÃO existe no CRM)
   *   new-ready  → rascunho confirmado ("Usar neste agendamento"); o contato
   *                só nasce na criação do agendamento.
   * `newClient` legado vira `stage !== 'search' && !contactId`.
   */
  type ClientStage = 'search' | 'new-form' | 'new-ready';
  const [clientStage, setClientStage] = useState<ClientStage>(initial?.contactId || initial?.name ? (initial?.contactId ? 'search' : 'new-ready') : 'search');
  const [serviceId, setServiceId] = useState(initial?.serviceId || '');
  const [proId, setProId] = useState(initial?.professionalId || '');
  const [date, setDate] = useState(initial?.date || '');
  const [time, setTime] = useState(initial?.time || '');
  const [note, setNote] = useState('');
  // FASE 2 · P6 — veterinária: pet do tutor selecionado (paciente da agenda).
  const [pets, setPets] = useState<Pet[]>([]);
  const [isVet, setIsVet] = useState(false);
  const [petId, setPetId] = useState('');
  // P0-3 — cadastro de pet DENTRO do fluxo (tutor sem pet).
  const [petFormOpen, setPetFormOpen] = useState(false);
  const [petDraft, setPetDraft] = useState({ name: '', species: 'cachorro', breed: '', sex: '', birthDate: '', weightKg: '' as string | number, notes: '' });
  const [petBusy, setPetBusy] = useState(false);
  const [petError, setPetError] = useState('');
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
  // A3.4 (teste humano): encaixe não fura o passado. A régua é a MESMA do
  // servidor (`fitInPastError`, no fuso do negócio) — aqui ela AVISA antes.
  const fitInPast = fitInOpen ? fitInPastError(date, fitInTime, today, nowHM(new Date(), timezone || undefined)) : '';
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

  // Selecionado = contato existente OU rascunho novo confirmado (new-ready).
  const picked = !!contactId || clientStage === 'new-ready';

  // FASE 2 · P6 — pets do tutor (só clínica veterinária devolve `vet: true`).
  useEffect(() => {
    setPetId('');
    setPetFormOpen(false);
    setPetError('');
    if (!contactId) { setPets([]); setIsVet(false); return; }
    let on = true;
    apiGet<{ vet: boolean; pets: Pet[] }>(
      `/api/pets?businessId=${encodeURIComponent(businessId)}&tutorId=${encodeURIComponent(contactId)}`,
      { scope: 'area', area: 'Agenda' },
    ).then((r) => {
      if (!on) return;
      setIsVet(!!r.data?.vet);
      setPets(r.data?.pets?.filter((p) => p.active !== false) || []);
    }).catch(() => { if (on) { setPets([]); setIsVet(false); } });
    return () => { on = false; };
  }, [contactId, businessId]);

  function pick(c: Contact) {
    setContactId(c.id);
    setName(c.name);
    setPhone(c.phone);
    setEmail(c.email || '');
    setClientStage('search');
    setResults([]);
    setQuery('');
  }

  function startNew() {
    const digits = onlyDigits(query);
    setContactId('');
    setName(digits.length >= 10 ? '' : query.trim());
    setPhone(digits.length >= 10 ? query.trim() : '');
    setEmail('');
    setClientStage('new-form');
    setResults([]);
  }

  /** "Usar neste agendamento": mantém o rascunho selecionado (ainda sem CRM). */
  function confirmNewDraft() {
    if (!name.trim()) { setError('Informe o nome do novo cliente.'); return; }
    if (onlyDigits(phone).length < 10) { setError('Informe um WhatsApp válido.'); return; }
    setError('');
    setClientStage('new-ready');
  }

  /** "Cancelar" do cadastro temporário: LIMPA tudo e volta para a busca. */
  function cancelNewDraft() {
    setContactId(''); setName(''); setPhone(''); setEmail('');
    setClientStage('search'); setQuery(''); setResults([]); setError('');
  }

  function resetClient() {
    setContactId(''); setName(''); setPhone(''); setEmail('');
    setClientStage('search'); setQuery(''); setResults([]); setError('');
    setPetId(''); setPets([]); setIsVet(false);
  }

  function payload(rows = occurrences) {
    if (!requestId.current) requestId.current = crypto.randomUUID();
    return {
      businessId, asOwner: true, customerName: name, customerPhone: phone, customerEmail: email,
      contactId: contactId || undefined, serviceId, professionalId: proId, date, time, note,
      // FASE 2 · P6 — pet escolhido (o servidor revalida na unidade).
      ...(isVet && petId ? { petId } : {}),
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
    if (!picked || !name.trim()) { setError('Busque o cliente ou cadastre um novo para usar neste agendamento.'); return; }
    if (!contactId && clientStage !== 'new-ready') { setError('Confirme o novo cliente em “Usar neste agendamento”.'); return; }
    // P0-3 — veterinária com pets no tutor: o PET é o paciente (obrigatório).
    if (isVet && contactId && pets.length > 0 && !petId) {
      setError('Em clínica veterinária, escolha o pet (paciente) deste agendamento.');
      return;
    }
    if (onlyDigits(phone).length < 10) { setError('Informe um WhatsApp válido.'); return; }
    const when = opts.timeOverride || time;
    if (!serviceId || !date || !when) { setError('Escolha serviço, data e horário.'); return; }
    // Encaixe em horário que já passou: recusado AQUI, sem chamar o servidor
    // (que recusaria do mesmo jeito — a frase é a mesma).
    if (opts.fitIn) {
      const past = fitInPastError(date, when, today, nowHM(new Date(), timezone || undefined));
      if (past) { setError(past); return; }
    }
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
    <Drawer open onClose={() => { if (!saving && !reviewing) onClose(); }} title="Novo agendamento" subtitle="Paciente → serviço → data e horário → confirmação" width="max-w-xl">
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
              <div className="flex flex-wrap items-center gap-3 bg-[var(--success-bg)] border border-[var(--success-border)] rounded-lg px-3.5 py-3">
                <Avatar name={name || '?'} size={36} />
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block text-sm font-semibold text-[var(--text)] break-words">{name}</span>
                  <span className="block text-xs text-[var(--success-fg)] break-words">
                    {phone}{email ? ` · ${email}` : ''}
                  </span>
                </span>
                <Badge tone={contactId ? 'green' : 'blue'} icon={contactId ? 'check' : 'spark'}>
                  {contactId ? 'Cadastro vinculado' : 'Novo cliente'}
                </Badge>
                <Button type="button" variant="ghost" size="xs" onClick={resetClient}>Trocar</Button>
              </div>
            ) : clientStage === 'new-form' ? (
              /* ── Cadastro temporário (P0-2): ainda NÃO existe no CRM ── */
              <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5" data-new-client-form="true">
                <p className="text-xs font-semibold text-[var(--text-muted)]">Cadastrar novo cliente</p>
                <Field label="Nome" required>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Marlene Silva" autoFocus />
                </Field>
                <Field label="WhatsApp" required>
                  <PhoneBRInput value={phone} onChange={setPhone} />
                </Field>
                <Field label="E-mail" hint="Opcional">
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="nome@email.com" />
                </Field>
                <p className="text-xs text-[var(--text-muted)] rounded-md bg-[var(--info-bg)] border border-[var(--info-border)] px-2.5 py-2">
                  O cliente será cadastrado quando este agendamento for confirmado.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="primary" size="sm" onClick={confirmNewDraft}>Usar neste agendamento</Button>
                  <Button type="button" variant="secondary" size="sm" onClick={cancelNewDraft}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                  placeholder="Buscar cliente por nome ou WhatsApp…" aria-label="Buscar cliente" />
                <p className="text-xs text-[var(--text-muted)] mt-1.5">
                  Buscamos no CRM para não duplicar cadastro — o cliente pode já ter conta na sua página.
                </p>
                {searching && <p className="text-xs text-[var(--text-faint)] mt-1.5">Buscando…</p>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <Button type="button" variant="soft" onClick={startNew} className="mt-2 w-full justify-start" data-new-client-trigger="true">
                    + Cadastrar novo cliente “{query.trim()}”
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
              </>
            )}
          </div>

          {/* FASE 2 · P6 / P0-3 — veterinária: o PET é o paciente (obrigatório
              quando o tutor já tem pet; sem pet, o cadastro nasce aqui). */}
          {picked && contactId && isVet && !petFormOpen && (
            pets.length > 0 ? (
              <Field label="Pet (paciente)" required
                hint="Em clínica veterinária a agenda identifica pelo pet; o tutor continua sendo o contato.">
                <Select value={petId} disabled={saving || reviewing} onChange={(e) => setPetId(e.target.value)}>
                  <option value="">Selecione o pet…</option>
                  {pets.map((p) => <option key={p.id} value={p.id}>{p.name}{p.breed ? ` · ${p.breed}` : ''}</option>)}
                </Select>
              </Field>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3" data-vet-pet-empty="true">
                <p className="text-xs font-semibold text-[var(--text)]">Este tutor ainda não tem pet cadastrado.</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Em clínica veterinária o pet é o paciente do agendamento.</p>
                <Button type="button" variant="secondary" size="sm" className="mt-2" disabled={saving || reviewing}
                  onClick={() => { setPetError(''); setPetFormOpen(true); }}>
                  <Icon n="plus" size={13} /> Cadastrar pet
                </Button>
              </div>
            )
          )}
          {/* Cadastro de pet inline — após salvar, o pet recém-criado é SELECIONADO. */}
          {picked && contactId && isVet && petFormOpen && (
            <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3.5" data-pet-form="true">
              <p className="text-xs font-semibold text-[var(--text-muted)]">Novo pet — paciente de {name || 'tutor'}</p>
              {petError && <Notice tone="error">{petError}</Notice>}
              <Field label="Nome do pet" required>
                <Input value={petDraft.name} onChange={(e) => setPetDraft({ ...petDraft, name: e.target.value })} placeholder="Ex: Greg" autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Espécie">
                  <Select value={petDraft.species} onChange={(e) => setPetDraft({ ...petDraft, species: e.target.value, breed: '' })}>
                    {PET_SPECIES.map((s) => <option key={s} value={s}>{PET_SPECIES_LABELS[s]}</option>)}
                  </Select>
                </Field>
                <Field label="Raça" hint="Autocomplete — pode digitar outra.">
                  <Input value={petDraft.breed} list="nb-pet-breeds" onChange={(e) => setPetDraft({ ...petDraft, breed: e.target.value })} placeholder="Ex: Bulldog" />
                  <datalist id="nb-pet-breeds">
                    {breedSuggestions(petDraft.species).map((b) => <option key={b} value={b} />)}
                  </datalist>
                </Field>
                <Field label="Sexo">
                  <Select value={petDraft.sex} onChange={(e) => setPetDraft({ ...petDraft, sex: e.target.value })}>
                    <option value="">Não informado</option>
                    <option value="M">Macho</option>
                    <option value="F">Fêmea</option>
                  </Select>
                </Field>
                <Field label="Nascimento">
                  <Input type="date" value={petDraft.birthDate} onChange={(e) => setPetDraft({ ...petDraft, birthDate: e.target.value })} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="primary" size="sm" disabled={petBusy}
                  onClick={async () => {
                    const problem = validatePet(petDraft as any);
                    if (problem) { setPetError(problem); return; }
                    setPetBusy(true); setPetError('');
                    const res = await apiSend<{ pet: Pet }>('/api/pets', 'POST', {
                      action: 'create', businessId, tutorId: contactId, pet: petDraft,
                    }, { scope: 'action', area: 'Agenda' });
                    setPetBusy(false);
                    if (!res.ok || !res.data?.pet) { setPetError(res.message || 'Não foi possível salvar o pet.'); return; }
                    const created = res.data.pet;
                    setPets((list) => [created, ...list]);
                    setPetId(created.id);
                    setPetFormOpen(false);
                    setPetDraft({ name: '', species: 'cachorro', breed: '', sex: '', birthDate: '', weightKg: '', notes: '' });
                  }}>
                  {petBusy ? 'Salvando…' : 'Salvar e usar neste agendamento'}
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={petBusy} onClick={() => { setPetFormOpen(false); setPetError(''); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

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
                    <Button type="button" variant="warning" size="sm" disabled={saving || !fitInTime || !!fitInPast}
                      title={fitInPast || undefined}
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
                  {fitInPast && !fitInMessage && <Notice tone="warning">{fitInPast}</Notice>}
                  {!fitInMessage && !fitInPast && (
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
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ex: paciente solicitou um retorno" />
          </Field>

          {service && date && (time || repeat) && <section aria-label="Revise o agendamento" className="rounded-lg bg-[var(--surface-3)] p-4 text-sm space-y-1">
            <h3 className="font-semibold">Confira antes de confirmar</h3><p>{name || 'Cadastro selecionado'} · {service.name}</p><p>{date.split('-').reverse().join('/')} às {time || 'Horários da recorrência'}</p><p className="text-xs text-[var(--text-muted)]">{eligiblePros.find(p => p.id === proId)?.name || 'Distribuição automática entre profissionais elegíveis'}{repeat ? ` · ${occurrences.length} ocorrências` : ''}</p>
          </section>}
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="button" variant="primary" size="lg" onClick={() => save()}
            disabled={saving || reviewing || (repeat && (!preview || preview.some((r) => r.state !== 'available')))}
            className="w-full">
            {saving ? 'Agendando…' : reviewing ? 'Validando…' : repeat ? `Confirmar ${occurrences.length} atendimentos` : 'Salvar agendamento'}
          </Button>
          </div>
          )}
        </div>
    </Drawer>
  );
}
