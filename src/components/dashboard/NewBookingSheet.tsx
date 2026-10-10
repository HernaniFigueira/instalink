'use client';
import { FIT_IN_MARK_CLS } from '@/lib/status';
// "+ Novo agendamento" — o fluxo COMEÇA pelo cliente:
//   1. busca no CRM por nome ou WhatsApp (não cria cadastro duplicado);
//   2. seleciona a pessoa → nome/WhatsApp/e-mail preenchidos e vinculados;
//   3. só oferece "+ Novo cliente" quando a busca não encontra ninguém;
//   4. serviço → data → horário (grade real da agenda) → observação.
import { durationLabel } from '@/lib/duration-label';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { PhoneBRInput } from '@/components/dashboard/PhoneBRInput';
import { nowHM, todayISO } from '@/lib/tz';
import { fitInPastError } from '@/lib/fit-in';
import { bookingPastTimeError } from '@/lib/booking-past-time';
import { adminBookingMaxDate } from '@/lib/booking-ops';
import { BookingRecurrence } from './BookingRecurrence';
import type { BookingOccurrence } from '@/lib/booking-recurrence';
import type { OccurrencePreview } from '@/lib/booking-series';
import { cn, minToTime, onlyDigits, timeToMin } from '@/lib/utils';
import { isLegacyPagesEnabled } from '@/lib/product';
import type { Pet, Professional, Service } from '@/lib/types';
import { apiGet, apiSend } from '@/lib/api-client';
import { breedSuggestions, PET_SPECIES, PET_SPECIES_LABELS, validatePet } from '@/lib/pets';
import { Drawer, Avatar, Badge, Button, Checkbox, Combobox, DatePicker, Disclosure, Field, IconButton, Input, Notice, Select, Tooltip, SelectMenu } from '@/components/ui';
import { WORKSPACE_SHEET_SIZES } from '@/lib/workspace-sheet-sizes';
import { uniqueEligibleServiceId } from '@/lib/agenda-cell-prefill';
import { eligibleProfessionalIds, professionalServesService } from '@/lib/booking';
import { NewClientForm } from '@/components/dashboard/NewClientSheet';

interface Contact {
  id: string;
  name: string;
  phone: string;
  // Campos opcionais no DTO clínico: ambos só existem na projeção administrativa.
  email?: string;
  registered?: boolean;
}

export function NewBookingSheet({ businessId, services, pros, timezone, initial, quick = false, onClose, onCreated }: {
  businessId: string;
  services: Service[];
  pros: Professional[];
  /** Compatibilidade com chamadores existentes; limite público não restringe a equipe. */
  horizonDays: number;
  /** A2-B5 (F9): fuso do negócio — "hoje" da lista de dias (opcional; ''/ausente = default). */
  timezone?: string;
  /** Grade Dia/Semana: formulário compacto, mesmos campos e mesma operação canônica. */
  quick?: boolean;
  /** Cliente já definido (ex.: aberto a partir do CRM) — pula a busca. */
  initial?: {
    contactId?: string; name: string; phone: string; email?: string;
    /** A3.4: agenda pré-preenchida ao clicar num horário vago da grade. */
    date?: string; time?: string; professionalId?: string; serviceId?: string; selectedDurationMin?: number;
    /** Termo vindo do Quick Create sem contato selecionado; continua sendo busca, não contato. */
    searchQuery?: string;
    /** CTA explícito do Quick Create: abre o cadastro real dentro do fluxo completo. */
    openRegistration?: boolean;
    /** Tipo da unidade já resolvido pela Agenda; é apenas terminologia do cadastro. */
    vetMode?: boolean;
    /** Só o chamador que veio DIRETAMENTE da célula pode pedir conveniência de serviço único. */
    allowSingleEligibleServicePrefill?: boolean;
    /** Prefill permitido ao duplicar agendamento (não inclui respostas/histórico). */
    petId?: string; note?: string;
  };
  onClose: () => void;
  onCreated: () => void;
}) {
  const bookable = useMemo(() => services.filter((s) => s.bookable && s.active !== false), [services]);
  /**
   * Serviço só chega pré-escolhido por duas intenções explícitas:
   *   1. `serviceId` que a pessoa de fato escolheu (Quick Create, duplicação,
   *      fila ou CRM); ou
   *   2. clique DIRETO de célula que declarou a conveniência de serviço único.
   *
   * Um handoff do Quick Create com serviço vazio NÃO pode cair no fallback de
   * um serviço elegível único: isso era o "serviço fantasma" observado ao abrir
   * "Mais opções". O vínculo continua decidido pelos ids reais do catálogo.
   */
  const presetServiceId = initial?.serviceId || (initial?.allowSingleEligibleServicePrefill
    ? uniqueEligibleServiceId(bookable, initial?.professionalId || '') : '');
  const initialSearchQuery = initial?.searchQuery || '';
  const initialSearchDigits = onlyDigits(initialSearchQuery);
  const initialRegistrationName = initial?.openRegistration && initialSearchDigits.length < 10 ? initialSearchQuery.trim() : '';
  const initialRegistrationPhone = initial?.openRegistration && initialSearchDigits.length >= 10 ? initialSearchQuery.trim() : '';
  const [query, setQuery] = useState(initialSearchQuery);
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [contactId, setContactId] = useState(initial?.contactId || '');
  const [name, setName] = useState(initial?.name || initialRegistrationName);
  const [phone, setPhone] = useState(initial?.phone || initialRegistrationPhone);
  const [email, setEmail] = useState(initial?.email || '');
  // A duplicação pode vir de um agendamento sem vínculo CRM. Preservamos e
  // mostramos os dados copiados como dados informados (não fingimos um contato
  // selecionado); a gravação segue o fluxo normal de criação.
  const [unlinkedPrefill, setUnlinkedPrefill] = useState(!initial?.contactId && !initial?.searchQuery && !!(initial?.name || initial?.phone));
  // HOMOLOGAÇÃO · fechamento — SEM cadastro temporário: "+ Cadastrar" abre o
  // CADASTRO REAL (NewClientSheet) que grava no CRM na hora. Abandonar o
  // agendamento depois NÃO apaga o paciente.
  const [registerOpen, setRegisterOpen] = useState(!!initial?.openRegistration);
  const [clientPersistence, setClientPersistence] = useState({ dirty: false, saving: false, error: '' });
  const [vetMode, setVetMode] = useState(!!initial?.vetMode);
  const [serviceId, setServiceId] = useState(presetServiceId);
  const [proId, setProId] = useState(initial?.professionalId || '');
  const [date, setDate] = useState(initial?.date || '');
  const [time, setTime] = useState(initial?.time || '');
  const [note, setNote] = useState(initial?.note || '');
  const [staffDuration, setStaffDuration] = useState<number | ''>(initial?.selectedDurationMin || '');
  const [advanced, setAdvanced] = useState(false);
  // FASE 2 · P6 — veterinária: pet do tutor selecionado (paciente da agenda).
  const [pets, setPets] = useState<Pet[]>([]);
  const [isVet, setIsVet] = useState(!!initial?.vetMode);
  const [petId, setPetId] = useState(initial?.petId || '');
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
  const rangeIntent = !!initial?.selectedDurationMin;
  const [editingTime, setEditingTime] = useState(false);
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
  const initialBookingSnapshot = useRef(JSON.stringify({
    query: initialSearchQuery, contactId: initial?.contactId || '', name: initial?.name || initialRegistrationName, phone: initial?.phone || initialRegistrationPhone, email: initial?.email || '',
    serviceId: presetServiceId, proId: initial?.professionalId || '', date: initial?.date || '', time: initial?.time || '',
    note: initial?.note || '', staffDuration: initial?.selectedDurationMin || '', petId: initial?.petId || '', fitInOpen: false, fitInTime: initial?.time || '', repeat: false, occurrences: [],
  }));
  const bookingSnapshot = JSON.stringify({ query, contactId, name, phone, email, serviceId, proId, date, time, note, staffDuration, petId, fitInOpen, fitInTime, repeat, occurrences });
  const bookingDirty = !created && bookingSnapshot !== initialBookingSnapshot.current;
  const wholeOverlayDirty = bookingDirty || clientPersistence.dirty;
  const overlayGuard = {
    dirty: wholeOverlayDirty, saving: saving || clientPersistence.saving,
    context: bookingDirty && clientPersistence.dirty ? 'combined' as const : clientPersistence.dirty ? 'new-client' as const : 'new-booking' as const,
  };

  // A2-B5 (F9): "hoje" no fuso do negócio (o servidor continua validando).
  const today = todayISO(new Date(), timezone || undefined);
  const maxDate = adminBookingMaxDate(today);
  // A3.4 (teste humano): encaixe não fura o passado. A régua é a MESMA do
  // servidor (`fitInPastError`, no fuso do negócio) — aqui ela AVISA antes.
  const fitInPast = fitInOpen ? fitInPastError(date, fitInTime, today, nowHM(new Date(), timezone || undefined)) : '';
  const service = bookable.find((s) => s.id === serviceId);
  const eligiblePros = service ? pros.filter((p) => professionalServesService(service as any, p.id, pros)) : pros.filter((p) => p.active !== false);

  // Keep the column context until the user explicitly chooses another professional.
  const incompatiblePro = !!proId && !!service && !professionalServesService(service as any, proId, pros);
  const activeProId = proId;
  const noEligiblePro = !!service && eligibleProfessionalIds(service as any, pros).length === 0;
  const proIssue = noEligiblePro ? 'Nenhum profissional está habilitado para este serviço.' : incompatiblePro ? `${pros.find(p => p.id === proId)?.name || 'Este profissional'} não realiza este serviço. Escolha outro profissional habilitado.` : '';
  const orderedServices = [...bookable].sort((a, b) => Number(!!proId && professionalServesService(b as any, proId, pros)) - Number(!!proId && professionalServesService(a as any, proId, pros)));
  const slotKey = `${serviceId}|${date}|${proId}|${staffDuration}`;
  const [checkedSlotKey, setCheckedSlotKey] = useState('');
  // Quick Create e formulário completo chamam esta mesma regra visual. O
  // POST em `booking-create.ts` continua revalidando a data no fuso da unidade.
  const pastIssue = bookingPastTimeError(date, time, today, nowHM(new Date(), timezone || undefined));
  const slotIssue = !proIssue && (pastIssue || (!incompatiblePro && time && checkedSlotKey === slotKey && !loadingSlots && !slotsError && !slots.includes(time)
    ? dayState?.reason === 'no_windows' ? 'O horário não está dentro da disponibilidade deste profissional.'
      : 'Este profissional não está disponível neste intervalo. Confira a disponibilidade, os atendimentos e os bloqueios.' : ''));
  const intervalPending = !!serviceId && !!date && (loadingSlots || checkedSlotKey !== slotKey);
  // Request errors belong to the attempted interval, not to a later selection.
  useEffect(() => { setError(''); }, [slotKey, time]);

  useEffect(() => {
    const mySeq = ++slotSeq.current;
    if (!serviceId || !date || incompatiblePro || noEligiblePro) { setSlots([]); setSlotsError(''); setDayState(null); setLoadingSlots(false); return; }
    setLoadingSlots(true);
    setSlotsError('');
    const professionalQuery = activeProId ? `&professionalId=${encodeURIComponent(activeProId)}` : '';
    fetch(`/api/bookings?mode=slots-admin&internalSnap=15&businessId=${businessId}&serviceId=${serviceId}&date=${date}${professionalQuery}${staffDuration ? `&staffDurationMin=${staffDuration}` : ''}`)
      .then(async (r) => {
        const d = await r.json();
        if (mySeq !== slotSeq.current) return;
        if (!r.ok) throw new Error(d.error || 'Não foi possível carregar os horários.');
        const list: string[] = d.slots || [];
        setSlots(list);
        setDayState(d.closed || d.state ? { state: d.state, full: d.full, reason: d.reason } : null);
        setCheckedSlotKey(slotKey);
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
  }, [businessId, serviceId, date, activeProId, staffDuration, incompatiblePro, noEligiblePro, slotKey]);

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

  // Selecionado = contato JÁ existente no CRM (cadastro real salvo).
  const picked = !!contactId;

  // FASE 2 · P6 — tipo da clínica vem do BUSINESS/contexto (nunca de
  // contactId preexistente). Pets do tutor carregam quando há tutor.
  useEffect(() => {
    let on = true;
    // Vet mode: flag do negócio (pets?businessId sem tutorId devolve `vet`).
    apiGet<{ vet: boolean }>(
      `/api/pets?businessId=${encodeURIComponent(businessId)}`,
      { scope: 'area', area: 'Agenda' },
    ).then((r) => { if (on) { setVetMode(!!r.data?.vet); setIsVet(!!r.data?.vet); } })
      .catch(() => { if (on) {
        // Se a leitura auxiliar falhar, preserva a informação já resolvida
        // pela Agenda; nunca infere veterinária a partir do contato.
        setVetMode(!!initial?.vetMode); setIsVet(!!initial?.vetMode);
      } });
    return () => { on = false; };
  }, [businessId]);

  /**
   * MISSÃO HOMOLOGAÇÃO · duplicação: o booking pode trazer petId SEM customerId
   * (agenda interna cria reserva pelo fluxo do profissional). Quando o contato
   * não veio, recupera o vínculo REAL do tutor pelo pet (`pet.tutorId`) — sem
   * simular seleção quando não há vínculo (contrato "sem vínculo CRM").
   */
  const initialPetRef = useRef(initial?.petId || '');
  useEffect(() => {
    if (contactId || !initialPetRef.current) return;
    let on = true;
    apiGet<{ pets: Pet[] }>(`/api/pets?businessId=${encodeURIComponent(businessId)}`, { scope: 'area', area: 'Agenda' })
      .then((r) => {
        if (!on) return;
        const pet = (r.data?.pets || []).find((p) => p.id === initialPetRef.current && p.active !== false);
        if (pet?.tutorId) setContactId(pet.tutorId);
      })
      .catch(() => {});
    return () => { on = false; };
  }, [businessId, contactId]);

  useEffect(() => {
    setPetId('');
    if (!contactId) { setPets([]); return; }
    let on = true;
    apiGet<{ vet: boolean; pets: Pet[] }>(
      `/api/pets?businessId=${encodeURIComponent(businessId)}&tutorId=${encodeURIComponent(contactId)}`,
      { scope: 'area', area: 'Agenda' },
    ).then((r) => {
      if (!on) return;
      setIsVet(!!r.data?.vet);
      const list = r.data?.pets?.filter((p) => p.active !== false) || [];
      setPets(list);
      // Prefill de duplicação: restaura o pet semeado quando ele pertence ao tutor.
      const seeded = initialPetRef.current;
      if (seeded && list.some((p) => p.id === seeded)) setPetId(seeded);
    }).catch(() => { if (on) setPets([]); });
    return () => { on = false; };
  }, [contactId, businessId]);

  function pick(c: Contact) {
    setUnlinkedPrefill(false);
    setContactId(c.id);
    setName(c.name);
    setPhone(c.phone);
    setEmail(c.email || '');
    
    setResults([]);
    setQuery('');
  }

  /** Abre o CADASTRO REAL (CRM). Prefill do que já foi digitado na busca. */
  function startNew() {
    setUnlinkedPrefill(false);
    const digits = onlyDigits(query);
    setContactId('');
    setName(digits.length >= 10 ? '' : query.trim());
    setPhone(digits.length >= 10 ? query.trim() : '');
    setEmail('');
    setResults([]);
    setRegisterOpen(true);
  }

  /**
   * Cadastro real salvo → volta ao agendamento com tutor selecionado e,
   * em veterinária, o pet recém-criado selecionado.
   */
  function onClientRegistered(contactId: string, extra?: { petId?: string }) {
    setUnlinkedPrefill(false);
    setRegisterOpen(false);
    setContactId(contactId);
    setQuery(''); setResults([]); setError('');
    // Recarrega dados do contato + pets (efeitos reagem ao contactId).
    fetch(`/api/contacts?businessId=${businessId}&q=${encodeURIComponent(name.trim())}&limit=5`)
      .then((r) => r.json())
      .then((d) => {
        const hit = (d.contacts || []).find((c: Contact) => c.id === contactId);
        if (hit) { setName(hit.name); setPhone(hit.phone); setEmail(hit.email || ''); }
      })
      .catch(() => { /* mantém o nome digitado */ });
    if (extra?.petId) {
      // Pet veio do cadastro unificado — seleciona após o load de pets.
      setTimeout(() => setPetId(extra.petId || ''), 0);
      // Também injeta na lista local para o <Select> ter a opção.
      apiGet<{ pets: Pet[] }>(
        `/api/pets?businessId=${encodeURIComponent(businessId)}&tutorId=${encodeURIComponent(contactId)}`,
        { scope: 'area', area: 'Agenda' },
      ).then((r) => {
        const list = r.data?.pets?.filter((x) => x.active !== false) || [];
        setPets(list);
        if (extra.petId) setPetId(extra.petId);
      }).catch(() => { if (extra.petId) setPetId(extra.petId); });
    }
  }

  function resetClient() {
    setUnlinkedPrefill(false);
    setContactId(''); setName(''); setPhone(''); setEmail('');
    setQuery(''); setResults([]); setError('');
    setPetId(''); setPets([]); setIsVet(false);
  }

  function payload(rows = occurrences) {
    if (!requestId.current) requestId.current = crypto.randomUUID();
    return {
      businessId, asOwner: true, customerName: name, customerPhone: phone, customerEmail: email,
      contactId: contactId || undefined, serviceId, professionalId: activeProId, date, time, note,
      ...(staffDuration !== '' && !repeat ? { staffDurationMin: staffDuration } : {}),
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
    if (pastIssue || proIssue || (!opts.fitIn && slotIssue)) { return; }
    // Campos obrigatórios ANTES da conferência de intervalo: formulário vazio
    // deve dizer o que falta (cliente/serviço), não "aguarde o intervalo".
    if (!picked || !name.trim()) { setError('Busque o cliente ou cadastre um novo para usar neste agendamento.'); return; }
    if (!contactId) { setError('Busque um paciente existente ou cadastre um novo (o cadastro fica no CRM).'); return; }
    if (!serviceId || !date) { setError('Escolha serviço, data e horário.'); return; }
    if (!opts.fitIn && (loadingSlots || slotsError || checkedSlotKey !== slotKey)) { setError(slotsError || 'Aguarde a conferência do intervalo.'); return; }
    if (!picked || !name.trim()) { setError('Busque o cliente ou cadastre um novo para usar neste agendamento.'); return; }
    if (!contactId) { setError('Busque um paciente existente ou cadastre um novo (o cadastro fica no CRM).'); return; }
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
        professional: data.occurrences ? 'Veja as ocorrências abaixo' : data.professionalName || eligiblePros.find((p) => p.id === activeProId)?.name || 'Definido pela agenda',
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
    <Drawer
      open
      /* MISSÃO UX CLOSURE · item 3C — NOVO/EDITAR AGENDAMENTO = MODAL CENTRAL.
         Antes: faixa lateral de até 95% da viewport (um formulário curto
         esticado contra a borda direita). Agora: modal central do DS, largura
         confortável (672px; criação rápida vinda do slot fica mais compacta) e
         o par 50/50 preservado quando o cadastro de paciente abre no MESMO
         overlay. Regras de agenda, guardas de descarte e presets: intactos. */
      variant="dialog"
      dialogWidth={quick && !advanced ? '560px' : '672px'}
      dialogClassName={initial?.time ? 'gd-booking-range-drawer' : undefined}
      onClose={() => { if (!saving && !reviewing) onClose(); }}
      dismissGuard={overlayGuard}
      sideDismissGuard={{ ...clientPersistence, context: 'new-client' }}
      title="Novo agendamento"
      width={quick && !advanced ? WORKSPACE_SHEET_SIZES.compact : WORKSPACE_SHEET_SIZES.standard}
      /* §19–25 — mesmo overlay: os dois painéis usam presets oficiais; em
         viewport estreita o cadastro ocupa a faixa sem comprimir agendamento. */
      side={registerOpen ? (
        <NewClientForm
          embedded
          businessId={businessId}
          vetMode={vetMode || isVet}
          initialName={onlyDigits(query).length >= 10 ? '' : query.trim()}
          initialPhone={onlyDigits(query).length >= 10 ? query.trim() : ''}
          onClose={() => setRegisterOpen(false)}
          onPersistenceChange={setClientPersistence}
          onSaved={(cid, extra) => { setClientPersistence({ dirty: false, saving: false, error: '' }); onClientRegistered(cid, extra); }}
        />
      ) : undefined}
      sideTitle="Cadastrar novo paciente"
      sideSubtitle="Dados do tutor e do paciente"
      sideWidth={WORKSPACE_SHEET_SIZES.nestedForm}
      onSideClose={() => setRegisterOpen(false)}
    >
        <div className="px-5 py-4 space-y-3.5">
          {created ? (
            <div className="space-y-4" data-booking-created="true">
              <div className="rounded-xl border border-[var(--success-border)] bg-[var(--success-bg)] px-4 py-4">
                <p className="text-base font-semibold text-[var(--success-fg)] flex items-center gap-2">
                  <Icon n="check" size={18} strokeWidth={3} /> {created.count ? `${created.count} atendimentos criados` : 'Agendamento criado'}
                  {created.fitIn && <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${FIT_IN_MARK_CLS}`}>Encaixe</span>}
                </p>
                {created.fitIn && (
                  <p className="text-xs text-[var(--success-fg)] mt-1">
                    Encaixe registrado: este horário estava fora da grade e a decisão foi da equipe.
                  </p>
                )}
                <dl className="mt-3 divide-y divide-[var(--success-border)] text-sm text-[var(--text)]">
                  {[
                    ['Cliente', created.customer], ['Serviço', created.service], ['Profissional', created.professional],
                    [created.count ? 'Primeira data' : 'Data', created.date.split('-').reverse().join('/')], ['Horário', created.time],
                  ].map(([label, value]) => <div key={label} className="py-3"><dt className="text-xs text-[var(--text-muted)]">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}
                </dl>
                {created.occurrences && <ol className="mt-3 space-y-1 text-xs tabular-nums">
                  {created.occurrences.map((row, i) => <li key={row.id}>{String(i + 1).padStart(2, '0')}. {row.date.split('-').reverse().join('/')} · {row.time} · {row.professionalName}</li>)}
                </ol>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Button type="button" variant="primary" onClick={onClose}>Fechar</Button>
                <Button type="button" variant="secondary" onClick={() => { window.location.assign(`/agenda?b=${encodeURIComponent(businessId)}&data=${created.date}`); }}>Ver na agenda</Button>
                <Button type="button" variant="secondary" onClick={() => { setCreated(null); setStaffDuration(''); setRepeat(false); setOccurrences([]); setPreview(null); requestId.current = ''; setServiceId(''); setDate(''); setTime(''); setNote(''); setError(''); }}>Novo agendamento</Button>
              </div>
            </div>
          ) : (
          <div className="space-y-3">
          {/* 1. Cliente — o rótulo usa o tipo canônico do DS (label 13/20 500);
              a nota de por que buscamos no CRM virou AJUDA CONTEXTUAL (tooltip),
              em vez de parágrafo permanente sob o campo (§13). */}
          <div>
            <span className="mb-1.5 flex items-center gap-1.5">
              <span className="gd-t-label text-[var(--text)]">1. Cliente <span className="text-[var(--danger)]">*</span></span>
              {!picked && (
                <Tooltip label={`Buscamos no CRM para não duplicar cadastro — ${isLegacyPagesEnabled() ? 'o cliente pode já ter conta na sua página.' : 'o cliente pode já ter uma conta.'}`}>
                  <button type="button" aria-label="Por que buscamos no CRM" className="il-icon-button p-0 gd-icon-control--xs text-[var(--text-muted)]">
                    <Icon n="help" size={13} />
                  </button>
                </Tooltip>
              )}
            </span>
            {picked ? (
              <div className="flex flex-wrap items-center gap-3 bg-[var(--success-bg)] border border-[var(--success-border)] rounded-lg px-3.5 py-3">
                <Avatar name={name || '?'} size={36} />
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block text-sm font-semibold text-[var(--text)] break-words">{name}</span>
                  <span className="block text-xs text-[var(--success-fg)] break-words">
                    {phone}{email ? ` · ${email}` : ''}
                  </span>
                </span>
                <Badge tone="green" icon="check">Cadastro vinculado</Badge>
                <Button type="button" variant="ghost" size="xs" onClick={resetClient}>Trocar</Button>
              </div>
            ) : unlinkedPrefill ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3" data-unlinked-client-prefill="true">
                <Avatar name={name || '?'} size={36} />
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block break-words text-sm font-semibold text-[var(--text)]">{name || 'Cliente sem nome'}</span>
                  <span className="block break-words text-xs text-[var(--text-muted)]">{phone || 'Sem WhatsApp informado'}{email ? ` · ${email}` : ''}</span>
                </span>
                <span className="text-xs font-medium text-[var(--text-muted)]">Dados copiados · sem vínculo CRM</span>
                <Button type="button" variant="ghost" size="xs" onClick={resetClient}>Trocar</Button>
              </div>
            ) : (
              <>
                <Input type="search" name="godoutor-client-search" autoComplete="off" spellCheck={false} autoCorrect="off" autoCapitalize="none" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                  placeholder="Buscar cliente por nome ou WhatsApp…" aria-label="Buscar cliente" />
                {searching && <p className="text-xs text-[var(--text-faint)] mt-1.5">Buscando…</p>}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <Button type="button" variant="secondary" onClick={startNew} className="mt-2 w-full justify-start" data-new-client-trigger="true">
                    + Cadastrar paciente {vetMode ? '(tutor e pet)' : `“${query.trim()}”`}
                  </Button>
                )}
                {!searching && query.trim().length < 2 && (
                  <Button type="button" variant="secondary" onClick={startNew}
                    className="mt-2 w-full justify-start" data-new-client-trigger="true">
                    + Cadastrar paciente
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

          {/* FASE 2 · P6 — veterinária: o PET é o paciente (obrigatório quando
              o tutor já tem pet; sem pet, use o cadastro unificado). */}
          {picked && contactId && (isVet || vetMode) && pets.length > 0 && (
            <Field label="Pet (paciente)" required
              hint="Em clínica veterinária a agenda identifica pelo pet; o tutor continua sendo o contato.">
              <SelectMenu value={petId} disabled={saving || reviewing} onChange={(v) => setPetId(v)} placeholder="Selecione o pet…"
                options={pets.map((p) => ({ value: p.id, label: p.name, hint: p.breed || undefined }))} />
            </Field>
          )}
          {picked && contactId && (isVet || vetMode) && pets.length === 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3" data-vet-pet-empty="true">
              <p className="text-xs font-semibold text-[var(--text)]">Este tutor ainda não tem pet cadastrado.</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Cadastre pelo fluxo “+ Cadastrar paciente” — o pet nasce junto com o tutor no CRM.</p>
            </div>
          )}

          <Field label="2. Serviço" required>
            {/* CP3 · Combobox do DS (busca + teclado), no lugar do select nativo. */}
            <Combobox
              label="Serviço"
              placeholder="Buscar serviço…"
              emptyLabel="Nenhum serviço encontrado"
              disabled={saving || reviewing}
              value={serviceId}
              onChange={(v) => setServiceId(String(v))}
              options={[{ value: '', label: 'Selecione…' }, ...orderedServices.map((s) => ({
                value: s.id,
                label: `${s.name} · ${durationLabel(s.durationMin)}`,
                hint: eligibleProfessionalIds(s as any, pros).length === 0 ? 'Sem profissional habilitado' : undefined,
              }))]}
            />
          </Field>



          {(eligiblePros.length > 0 || incompatiblePro) && (
            <Field label="Profissional" hint="Opcional — em branco a agenda equilibra a equipe automaticamente">
              <Combobox
                label="Profissional"
                placeholder="Buscar profissional…"
                emptyLabel="Nenhum profissional encontrado"
                disabled={saving || reviewing}
                value={activeProId}
                onChange={(v) => setProId(String(v))}
                options={[
                  { value: '', label: 'Automático (equilibrar equipe)' },
                  ...(incompatiblePro ? [{ value: proId, label: `${pros.find(p => p.id === proId)?.name} — não realiza este serviço` }] : []),
                  ...eligiblePros.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Field>
          )}

          {proIssue && <Notice tone="warning">{proIssue}</Notice>}
          <Field label="3. Data" required>
            {/* CP3 · DatePicker do DS: o input date nativo não é mais usado no produto. */}
            <DatePicker label="Data" min={today} max={maxDate} value={date} disabled={saving || reviewing} onChange={(iso) => setDate(iso)} />
          </Field>

          {slotIssue && <Notice tone="warning">{slotIssue}</Notice>}
          {date && serviceId && !proIssue && (!rangeIntent || editingTime) && (
            <div>
              <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">4. Horário <span className="text-[var(--danger)]">*</span></span>
              {loadingSlots ? (
                <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-[var(--border-strong)] border-t-[var(--brand)] rounded-full animate-spin" /> Carregando horários…
                </p>
              ) : slotsError ? (
                <Notice tone="error">{slotsError}</Notice>
              ) : slots.length === 0 ? (slotIssue ? null : (
                <Notice tone="warning">
                  {dayState?.full
                    ? 'Todos os horários deste dia estão ocupados. Escolha outro dia.'
                    : dayState?.state === 'closed'
                      ? 'Fechado neste dia. Escolha outro dia.'
                      : 'Nenhum horário disponível.'}
                </Notice>
              )) : (
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                  {slots.map((t) => (
                    <button key={t} type="button" disabled={saving || reviewing} onClick={() => setTime(t)}
                      aria-pressed={time === t}
                      className="il-option-choice il-option-choice--compact tabular-nums">
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {time && <section aria-label="Resumo do intervalo" data-testid="booking-range-summary" className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 space-y-3">
            <h3 className="text-sm font-semibold">Horário</h3>
            <dl className="grid grid-cols-2 gap-3 text-sm tabular-nums">
              <div><dt className="text-[var(--text-muted)]">Início</dt><dd className="font-medium">{time}</dd></div>
              <div><dt className="text-[var(--text-muted)]">Fim</dt><dd className="font-medium">{minToTime(timeToMin(time) + (staffDuration || service?.durationMin || 30))}</dd></div>
              <div className="col-span-2"><dt className="text-[var(--text-muted)]">Duração</dt><dd className="font-medium">{durationLabel(staffDuration || service?.durationMin || 30)}</dd></div>
            </dl>
            {rangeIntent && <Button type="button" variant="ghost" size="sm" aria-expanded={editingTime} disabled={saving || reviewing} onClick={() => setEditingTime(v => !v)}>{editingTime ? 'Manter horário selecionado' : 'Alterar horário'}</Button>}
            {rangeIntent && loadingSlots && <p role="status" className="text-sm text-[var(--text-muted)]">Verificando disponibilidade…</p>}
            {rangeIntent && !editingTime && slotsError && <Notice tone="error">{slotsError}</Notice>}
          </section>}
          {/* §9/§14 — as opções avançadas são DIVULGAÇÃO canônica (nasce
              fechada). O `<details>`+`<summary>` com chevron próprio desenhava
              um segundo padrão de abrir/fechar; agora é o `Disclosure` do DS,
              controlado pelo mesmo estado que decide o conteúdo. */}
          <Disclosure label="Opções avançadas" open={advanced} onOpenChange={setAdvanced} className="rounded-md border border-[var(--border)] bg-[var(--surface)]">
            <div className="space-y-3 p-3">
          <Field label="Duração deste atendimento (min)" hint={`Serviço sugere ${service?.durationMin ? durationLabel(service.durationMin) : '—'}; deixe vazio para usar o padrão`}>
            <Input type="number" min="5" max="720" step="5" aria-label="Duração deste atendimento em minutos"
              value={staffDuration} disabled={saving || reviewing || repeat}
              onChange={(e) => setStaffDuration(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          {/* A3.4 · Bloco 4 — ENCAIXE. Fica DEPOIS da grade: primeiro o que
              está livre de verdade; o encaixe é a exceção, e o conflito é dito
              com nome e horário antes de qualquer coisa ser gravada. */}
          {advanced && date && serviceId && !repeat && (
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
                    <Button type="button" variant="secondary" size="sm" disabled={saving || !fitInTime || !!fitInPast}
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
                        <Button type="button" variant="secondary" size="sm" disabled={saving}
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

          {advanced && <Checkbox label="Repetir este agendamento" hint="Séries (semanal, quinzenal…) com conferência ocorrência por ocorrência."
            checked={repeat} disabled={saving || reviewing} onChange={setRepeat} />}
          {repeat && <BookingRecurrence first={{ date, time, professionalId: activeProId }} rows={occurrences} preview={preview}
            pros={eligiblePros} min={today} max={maxDate} busy={saving || reviewing}
            onChange={changeOccurrences} onReview={review} onDisable={() => setRepeat(false)} />}

          {advanced && <Field label="Observação" hint="Opcional — fica no histórico do atendimento">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ex: paciente solicitou um retorno" />
          </Field>}

            </div>
          </Disclosure>
          {service && date && (time || repeat) && <section aria-label="Revise o agendamento" className="rounded-lg bg-[var(--surface-3)] p-4 text-sm space-y-1">
            <h3 className="font-semibold">Confira antes de confirmar</h3><p>{name || 'Cadastro selecionado'} · {service.name}</p><p>{date.split('-').reverse().join('/')} às {time || 'Horários da recorrência'}</p><p className="text-xs text-[var(--text-muted)]">{pros.find(p => p.id === activeProId)?.name || 'Distribuição automática entre profissionais elegíveis'}{repeat ? ` · ${occurrences.length} ocorrências` : ''}</p>
          </section>}
          {error && error !== proIssue && error !== slotIssue && error !== slotsError && <Notice tone="error">{error}</Notice>}
          <Button type="button" variant="primary" size="lg" onClick={() => save()}
            disabled={saving || reviewing || !!proIssue || (!repeat && (!!slotIssue || !!slotsError || intervalPending)) || (repeat && (!preview || preview.some((r) => r.state !== 'available')))}
            className="w-full">
            {saving ? 'Agendando…' : reviewing ? 'Validando…' : repeat ? `Confirmar ${occurrences.length} atendimentos` : 'Salvar agendamento'}
          </Button>
        </div>
      )}
        </div>
    </Drawer>
  );
}
