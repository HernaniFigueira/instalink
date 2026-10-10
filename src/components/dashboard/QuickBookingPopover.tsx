'use client';
// ═══════════════════════════════════════════════════════════════
// DS 1.0 · §5 — QUICK CREATE ANCORADO NO SLOT DA AGENDA
// ═══════════════════════════════════════════════════════════════
// Clicar (ou arrastar) num espaço vago da grade abre ESTE popover, ancorado no
// ponto clicado, com o mínimo para marcar: Paciente · Serviço · Profissional ·
// Data · Hora · Duração. A ação primária cria o agendamento pelo MESMO endpoint
// do fluxo completo (`POST /api/bookings`, ver `lib/booking-quick-create.ts`) e
// "Mais opções" leva ao fluxo completo já pré-preenchido (cadastro novo,
// encaixe, série, observação, pet) — nada da criação rápida é um caminho
// paralelo de regra: o servidor revalida tudo.
//
// Componentes: todos canônicos (`Popover`, `Field`, `Input`, `Select`,
// `DatePicker`, `Button`, `Notice`, `StatusBadge`). Nenhum controle desenhado
// na mão, nenhum X decorativo, nenhuma sombra pesada.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Combobox, DatePicker, Field, IconButton, Input, Notice, Popover } from '@/components/ui';
import { Icon } from '@/components/icons';
import { durationLabel } from '@/lib/duration-label';
import { nowHM, todayISO } from '@/lib/tz';
import { bookingPastTimeError } from '@/lib/booking-past-time';
import { timeToMin } from '@/lib/utils';
import {
  fetchSlotTimes, searchContacts, submitBookingIntent, type Contact,
} from '@/lib/booking-quick-create';
import type { Professional, Service } from '@/lib/types';

const DURATIONS = [15, 30, 45, 60, 90, 120];

export interface QuickBookingAnchor {
  /** Ponto do clique, em coordenadas de viewport (posição do popover). */
  x: number;
  y: number;
  date: string;
  time: string;
  professionalId: string;
  /** Duração sugerida pelo arraste na grade (drag), quando houver. */
  durationMin?: number;
}

export interface QuickBookingSeed {
  /** Contato real escolhido no CRM; vazio quando o termo seguirá para cadastro. */
  contactId: string;
  customerName: string;
  customerPhone: string;
  /** Só existe quando a pessoa realmente escolheu um serviço no Quick Create. */
  serviceId: string;
  professionalId: string;
  date: string;
  time: string;
  durationMin?: number;
  /** Termo digitado sem contato selecionado — não vira contato sintético. */
  searchQuery?: string;
  /** CTA de ausência de resultado: abre o formulário completo já no cadastro. */
  openRegistration?: boolean;
}

export function QuickBookingPopover({ anchor, businessId, services, pros, timezone, vetMode = false, onClose, onCreated, onMore }: {
  anchor: QuickBookingAnchor;
  businessId: string;
  services: Service[];
  pros: Professional[];
  /** Fuso do negócio: "hoje" e limites vêm daí, nunca do navegador. */
  timezone?: string;
  /** Terminologia do cadastro: veterinária registra tutor e pet juntos. */
  vetMode?: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** "Mais opções" → fluxo completo, preservando só a intenção explícita. */
  onMore: (seed: QuickBookingSeed) => void;
}) {
  const bookable = useMemo(() => services.filter((s) => s.bookable && s.active !== false), [services]);
  const [serviceId, setServiceId] = useState('');
  const [professionalId, setProfessionalId] = useState(anchor.professionalId);
  const [date, setDate] = useState(anchor.date);
  const [time, setTime] = useState(anchor.time);
  const [durationMin, setDurationMin] = useState<number | undefined>(anchor.durationMin);
  // Data/duração recolhidos por padrão; abrem sozinhos quando o gesto já trouxe duração.
  const [moreTime, setMoreTime] = useState<boolean>(anchor.durationMin != null);
  const [contactId, setContactId] = useState('');
  // O contato escolhido é guardado por INTEIRO (a lista de resultados é
  // limpa ao escolher) — o nome/telefone vão no payload, como no fluxo completo.
  const [picked, setPicked] = useState<Contact | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  /** Termo da última busca que de fato terminou; evita CTA sobre resultado antigo. */
  const [searchedTerm, setSearchedTerm] = useState('');
  const [slots, setSlots] = useState<{ times: string[]; empty: boolean; loading: boolean; error: string }>(
    { times: [], empty: false, loading: false, error: '' },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const today = todayISO(new Date(), timezone);
  const now = nowHM(new Date(), timezone);
  const pastIssue = bookingPastTimeError(date, time, today, now);

  // Busca no CRM (nome ou WhatsApp) — mesma rota da busca do fluxo completo.
  // O CTA de cadastro só aparece DEPOIS de uma busca concluída para este termo;
  // não transforma falha/resultado velho em "paciente inexistente".
  useEffect(() => {
    const term = query.trim();
    const mySeq = ++seq.current;
    if (term.length < 2 || contactId) {
      setResults([]); setSearching(false); setSearchedTerm('');
      return;
    }
    setResults([]); setSearchedTerm(''); setSearching(true);
    const timer = window.setTimeout(() => {
      searchContacts(businessId, term)
        .then((rows) => {
          if (mySeq !== seq.current) return;
          setResults(rows); setSearchedTerm(term);
        })
        .finally(() => { if (mySeq === seq.current) setSearching(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, contactId, businessId]);

  // Horários REAIS do intervalo (o mesmo endpoint que o fluxo completo usa).
  useEffect(() => {
    if (!serviceId || !date) { setSlots({ times: [], empty: false, loading: false, error: '' }); return; }
    let on = true;
    setSlots((s) => ({ ...s, loading: true, error: '' }));
    fetchSlotTimes({ businessId, serviceId, date, professionalId, durationMin })
      .then((r) => { if (on) setSlots(r); })
      .catch(() => { /* fetchSlotTimes nunca lança; guarda por segurança */ });
    return () => { on = false; };
  }, [businessId, serviceId, date, professionalId, durationMin]);

  function pick(contact: Contact) {
    setContactId(contact.id);
    setPicked(contact);
    setQuery(contact.name || contact.phone || '');
    setResults([]);
    setError('');
  }

  /**
   * Handoff estrito: contato REAL ou termo de busca (nunca os dois fingindo ser
   * a mesma coisa), serviço somente se foi selecionado, e o contexto temporal
   * do gesto. Assim o formulário completo não inventa serviço/contato ao abrir.
   */
  function seedIntent(extra: Pick<QuickBookingSeed, 'openRegistration'> = {}): QuickBookingSeed {
    const term = query.trim();
    return {
      contactId,
      customerName: picked?.name || '',
      customerPhone: picked?.phone || '',
      serviceId, professionalId, date, time,
      ...(durationMin ? { durationMin } : {}),
      ...(!picked && term ? { searchQuery: term } : {}),
      ...extra,
    };
  }

  const noContactFound = !contactId && query.trim().length >= 2 && !searching
    && searchedTerm === query.trim() && results.length === 0;

  async function create() {
    if (saving) return;
    setError('');
    if (!contactId || !picked) { setError('Escolha um paciente já cadastrado — ou use "Mais opções" para cadastrar.'); return; }
    if (!serviceId) { setError('Escolha o serviço.'); return; }
    if (!date || !time) { setError('Escolha data e horário.'); return; }
    if (pastIssue) { setError(pastIssue); return; }
    setSaving(true);
    const res = await submitBookingIntent(businessId, {
      contactId,
      customerName: picked.name || '',
      customerPhone: picked.phone || '',
      serviceId, professionalId, date, time,
      ...(durationMin ? { durationMin } : {}),
    });
    setSaving(false);
    if (!res.ok) {
      // A mensagem é a do SERVIDOR (conflito, bloqueio, permissão, fuso).
      setError(res.message);
      // O horário pode ter sido ocupado entre a leitura e o clique: relê.
      if (res.conflict) {
        void fetchSlotTimes({ businessId, serviceId, date, professionalId, durationMin }).then(setSlots);
      }
      return;
    }
    onCreated();
  }

  return (
    <Popover
      open
      onClose={onClose}
      label="Criar agendamento neste horário"
      side="bottom-start"
      anchorStyle={{ position: 'fixed', left: anchor.x, top: anchor.y, width: 0, height: 0 }}
      trigger={<span aria-hidden="true" />}
    >
      <div className="w-[344px] p-1" data-quick-create="compact">
        {/* CABEÇALHO DE CONTEXTO — data, hora e profissional do gesto aparecem
            como LEITURA (já escolhidos pelo slot), não como campos a preencher. */}
        <div className="flex items-start justify-between gap-2 pb-2.5">
          <div className="min-w-0">
            <p className="gd-ovl__title">Novo agendamento</p>
            <p className="mt-0.5 truncate text-[12px] tabular-nums text-[var(--gd-text-muted)]">
              {formatDayLabel(date)} · {time || 'escolha o horário'}{professionalId ? ` · ${pros.find((p) => p.id === professionalId)?.name ?? ''}` : ''}
            </p>
          </div>
          <IconButton type="button" icon="x" label="Fechar criação rápida" onClick={onClose} />
        </div>

        {/* ESSENCIAIS — paciente, serviço, profissional e hora, nesta ordem. */}
        <div className="space-y-2.5">
          <Field label="Paciente" required hint="Nome ou WhatsApp — o cadastro abre no fluxo completo">
            <Input
              value={query}
              autoFocus
              placeholder="Buscar no cadastro"
              onChange={(e) => { setQuery(e.target.value); setContactId(''); setPicked(null); }}
            />
          </Field>
          {contactId && picked && (
            <p className="-mt-1.5 text-[12px] font-medium text-[var(--gd-text-muted)]">
              Selecionado: {picked.name || picked.phone}
            </p>
          )}
          {!contactId && (searching || results.length > 0) && (
            <ul className="max-h-32 overflow-y-auto rounded-[var(--gd-radius-sm)] border border-[var(--gd-border)] bg-[var(--gd-bg-surface)]">
              {searching && results.length === 0 && (
                <li className="px-2 py-1.5 text-[12px] text-[var(--gd-text-muted)]">Buscando…</li>
              )}
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => pick(c)}
                    className="flex w-full flex-col items-start px-2 py-1.5 text-left hover:bg-[var(--gd-nav-hover)]">
                    <span className="text-[13px] font-medium text-[var(--gd-text)]">{c.name || '(sem nome)'}</span>
                    <span className="text-[11.5px] tabular-nums text-[var(--gd-text-muted)]">{c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {noContactFound && (
            <div className="rounded-[var(--gd-radius-sm)] bg-[var(--gd-bg-surface-2)] p-2" data-quick-create-empty-search="true">
              <p className="text-[12px] text-[var(--gd-text-muted)]">
                Nenhum {vetMode ? 'tutor ou paciente' : 'paciente'} encontrado para “{query.trim()}”.
              </p>
              <Button type="button" variant="secondary" className="mt-2 w-full justify-start"
                onClick={() => onMore(seedIntent({ openRegistration: true }))}>
                {vetMode ? '+ Cadastrar tutor e pet' : '+ Cadastrar paciente'}
              </Button>
            </div>
          )}

          <Field label="Serviço" required>
            {/* DS · Combobox canônico (lista do DS, não o select nativo do navegador). */}
            <Combobox label="Serviço" value={serviceId} disabled={saving} placeholder="Selecione…"
              onChange={(v) => { setServiceId(String(v)); setTime(anchor.time); }}
              options={[{ value: '', label: 'Selecione…' }, ...bookable.map((s) => ({ value: s.id, label: `${s.name} · ${durationLabel(s.durationMin)}` }))]} />
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Profissional">
              <Combobox label="Profissional" value={professionalId} disabled={saving} placeholder="Automático"
                onChange={(v) => setProfessionalId(String(v))}
                options={[{ value: '', label: 'Automático' }, ...pros.filter((p) => p.active !== false).map((p) => ({ value: p.id, label: p.name }))]} />
            </Field>
            {/* Os campos de hora explicam o estado; o horário do gesto continua
                visível mesmo fora da lista (o servidor decide o encaixe). */}
            <Field
              label="Hora"
              hint={!serviceId ? 'Escolha o serviço' : slots.empty ? 'Nenhum horário livre' : undefined}
            >
              <Combobox label="Hora" value={time}
                disabled={saving || !serviceId || slots.loading || slots.times.length === 0}
                onChange={(v) => setTime(String(v))}
                options={[
                  ...(time && (!serviceId || !slots.times.includes(time)) ? [{ value: time, label: time, hint: 'na grade' }] : []),
                  ...(slots.loading ? [{ value: '', label: 'Carregando…' }] : []),
                  ...(!slots.loading && serviceId && slots.times.length === 0 ? [{ value: '', label: 'Sem horários' }] : []),
                  ...slots.times.map((t) => ({ value: t, label: t })),
                ]} />
            </Field>
          </div>
        </div>

        {/* PROGRESSIVE DISCLOSURE — data e duração só ocupam espaço quando a
            pessoa quer ajustá-los. O resumo fica visível: nada se esconde. */}
        <div className="mt-2.5 border-t border-[var(--gd-border-soft)] pt-2">
          <button type="button" aria-expanded={moreTime} aria-controls="qc-time-adjust"
            onClick={() => setMoreTime((o) => !o)}
            className="flex w-full items-center justify-between gap-2 rounded-[var(--gd-radius-sm)] px-1 py-1 text-left text-[12.5px] hover:bg-[var(--gd-nav-hover)]">
            <span className="font-medium text-[var(--gd-text-secondary)]">Data e duração</span>
            <span className="flex items-center gap-1.5 truncate tabular-nums text-[var(--gd-text-muted)]">
              {formatDayLabel(date)} · {durationMin ? durationLabel(durationMin) : 'padrão do serviço'}
              <Icon n="chevD" size={12} className={moreTime ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </span>
          </button>
          {moreTime && (
            <div id="qc-time-adjust" className="mt-2 grid grid-cols-2 gap-2.5">
              <Field label="Data">
                <DatePicker value={date} onChange={setDate} min={today} label="Data do agendamento" className="w-full" />
              </Field>
              <Field label="Duração">
                <Combobox label="Duração" value={durationMin != null ? String(durationMin) : ''} disabled={saving}
                  onChange={(v) => { const x = String(v); setDurationMin(x === '' ? undefined : Number(x)); }}
                  options={[{ value: '', label: 'Padrão do serviço' }, ...DURATIONS.map((d) => ({ value: String(d), label: durationLabel(d) }))]} />
              </Field>
            </div>
          )}
        </div>

        <div className="mt-2 space-y-2">
          {slots.error && <Notice tone="warning" title="Horários">{slots.error}</Notice>}
          {pastIssue && <Notice tone="warning" title="Horário indisponível">{pastIssue}</Notice>}
          {error && error !== pastIssue && <Notice tone="error" title="Não foi possível criar">{error}</Notice>}
        </div>

        {/* RODAPÉ — uma ação primária; "Mais opções" é o caminho secundário. */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--gd-border-soft)] pt-2.5">
          <Button variant="ghost" disabled={saving} onClick={() => onMore(seedIntent())}>Mais opções</Button>
          <Button disabled={saving || !!pastIssue} onClick={() => void create()}>
            {saving ? 'Criando…' : 'Criar agendamento'}
          </Button>
        </div>
        {time && (
          <p className="mt-1.5 text-right text-[11px] tabular-nums text-[var(--gd-text-faint)]">
            Faixa do atendimento: {time}–{endLabel(time, durationMin || 30)}
          </p>
        )}
      </div>
    </Popover>
  );
}

/** Rótulo curto da data no fuso do negócio: "Sáb 10/10". Sem Date local. */
function formatDayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const wd = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][dt.getUTCDay()];
  return `${wd} ${m[3]}/${m[2]}`;
}

function endLabel(time: string, durationMin: number): string {
  const end = (timeToMin(time) + durationMin) % (24 * 60);
  const h = String(Math.floor(end / 60)).padStart(2, '0');
  const m = String(end % 60).padStart(2, '0');
  return `${h}:${m}`;
}
