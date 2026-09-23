'use client';
// Detalhe do agendamento (painel): status, histórico, ações de fechamento e
// remarcação. Regras de negócio vêm de lib/booking-ops (mesma verdade da API):
//  • atendimento passado e ainda aberto = PENDÊNCIA DE FECHAMENTO (o sistema
//    nunca conclui sozinho);
//  • reagendar um atendimento já concluído/faltou/cancelado cria um NOVO
//    agendamento — o registro antigo permanece no histórico;
//  • a remarcação sempre pede confirmação e é validada no servidor
//    (disponibilidade, conflito, duração, buffer, horizonte).
//
// P1.1 — DRAWER OPERACIONAL:
//  • ações principais no topo com HIERARQUIA (Componentes compartilhados
//    ui.Button): Concluir = sucesso/verde · Não compareceu = atenção ·
//    Reagendar = neutro · Cancelar = destrutivo/vermelho. Status do
//    atendimento ≠ cor do botão.
//  • contexto real, sem navegação genérica: Cliente (ficha filtrada pelo
//    telefone do agendamento), WhatsApp (só quando há telefone) e o
//    histórico/timeline real — nada de fileira de links sem contexto.
// A lógica de ações e transições é exatamente a mesma do P1.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { StatusBadge, Button, Drawer, buttonCls, type ButtonVariant } from '@/components/ui';
import { EncounterSheet } from '@/components/dashboard/EncounterSheet';
import { Pet360Sheet } from '@/components/dashboard/Pet360Sheet';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { canReopenEncounter } from '@/lib/encounters';
import type { FollowUpSeed } from '@/components/dashboard/EncounterSheet';
import { BOOKING_STATUS } from '@/lib/status';
import { todayISO, nowHM, formatDateBR, humanDay } from '@/lib/tz';
import { waLink, cn, money } from '@/lib/utils';
import { adminBookingMaxDate, bookingActions, bookingDuration, needsClosure, rescheduleDecision, type ClosureAction } from '@/lib/booking-ops';
import { SLOT_STATE_MESSAGE } from '@/lib/slot-states';
import type { Booking } from '@/lib/types';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';

interface ServiceRef { id: string; name: string; durationMin: number; price?: number; questions?: string[] }
interface ProRef { id: string; name: string }

// Hierarquia de ação (tone da regra de negócio → variante do componente):
// ok = sucesso · warn = atenção · danger = destrutivo · neutral = secundário.
const TONE_TO_VARIANT: Record<ClosureAction['tone'], ButtonVariant> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  neutral: 'secondary',
};

const ROW = 'flex items-baseline justify-between gap-3 py-2';
const ROW_DT = 'text-xs font-medium text-zinc-500 shrink-0';
const ROW_DD = 'text-sm text-zinc-900 text-right font-medium';

export function BookingDetailSheet({ booking, service, pro, businessId, timezone, onScheduleReturn, onClose, onSaved, onChanged }: {
  booking: Booking;
  service: ServiceRef | undefined;
  pro: ProRef | undefined;
  businessId: string;
  timezone?: string;
  /** "Agendar retorno" do pós-atendimento: quem abre o agendamento é o pai. */
  onScheduleReturn?: (info: FollowUpSeed) => void;
  /** Fechamento pedido pelo usuário (ESC/X) — nunca por autosave. */
  onClose: () => void;
  /**
   * Save silencioso do atendimento: sincroniza o pai SEM fechar este sheet
   * nem o EncounterSheet (P0-1).
   */
  onSaved?: () => void;
  /**
   * Mudança estrutural (status/check-in/reagendar/finalizar): o pai
   * atualiza dados. Quem fecha é só `onClose` (após ação explícita).
   */
  onChanged: () => void;
}) {
  const [acting, setActing] = useState('');
  // A3.4 · Bloco 5 — registro do atendimento: permissão própria + quem reabre.
  const { permissions, role } = usePanelPermissions();
  const [encounterOpen, setEncounterOpen] = useState(false);
  // P0-3/P1 — Pet 360 a partir do nome do pet no detalhe.
  const [pet360Open, setPet360Open] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelSeries, setCancelSeries] = useState(false);
  const [serverToday, setServerToday] = useState('');
  const [date, setDate] = useState(booking.date);
  const [slots, setSlots] = useState<string[]>([]);
  const [time, setTime] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  // Falha de rede/erro ≠ "nenhum horário livre": os estados não se misturam.
  const [slotsError, setSlotsError] = useState('');
  // Histórico aprovado do P1: timeline REAL aberta por padrão.
  const [historyOpen, setHistoryOpen] = useState(true);
  const historyRef = useRef<HTMLDivElement>(null);

  const def = BOOKING_STATUS[booking.status];
  const dur = bookingDuration(service as any);
  const today = serverToday || todayISO(new Date(), timezone || undefined);
  const late = needsClosure(booking, dur, today, nowHM(new Date(), timezone || undefined));
  const decision = rescheduleDecision(booking.status);
  const actions = bookingActions(booking.status);
  const [h, m] = booking.time.split(':').map(Number);
  const end = h * 60 + m + dur;
  const endHM = `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;

  useEffect(() => {
    if (!rescheduling) return;
    setLoadingSlots(true);
    setSlotsError('');
    setTime('');
    fetch(`/api/bookings?mode=slots-admin&businessId=${businessId}&serviceId=${booking.serviceId}&date=${date}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || SLOT_STATE_MESSAGE.error);
        setSlots(d.slots || []);
        if (d.today) setServerToday(d.today);
      })
      .catch((e: any) => {
        setSlots([]);
        setSlotsError(e?.message || SLOT_STATE_MESSAGE.error);
      })
      .finally(() => setLoadingSlots(false));
  }, [rescheduling, date, businessId, booking.serviceId]);

  async function act(status: string, extra: Record<string, any> = {}) {
    setError(''); setNotice('');
    setActing(status);
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, id: booking.id, status, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setActing('');
    }
  }

  /** A3.4 · Bloco 4 — check-in do cliente no balcão (não muda o status). */
  async function checkIn(undo = false) {
    setError(''); setNotice('');
    setActing(undo ? 'checkin-undo' : 'checkin');
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, id: booking.id, action: undo ? 'check-in-undo' : 'check-in' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setActing('');
    }
  }

  async function reschedule() {
    setError(''); setNotice('');
    setActing('reschedule');
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, id: booking.id, date, time }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfirming(false);
      setRescheduling(false);
      if (data.created) {
        // Reagendar um atendimento já fechado gera um NOVO agendamento.
        setNotice(`Novo atendimento criado para ${formatDateBR(date)} às ${time} (aguardando confirmação). Este registro anterior continua no histórico do cliente.`);
        onChanged();
      } else {
        onChanged();
        onClose();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActing('');
    }
  }

  const waMsg = `Olá, ${(booking.customerName || '').split(' ')[0]}! Sobre seu agendamento de ${service?.name || 'atendimento'} (${formatDateBR(booking.date)} às ${booking.time}):`;

  // Drawer recebe o foco e fecha em ESC (como qualquer painel do workspace).

  function showHistory() {
    setHistoryOpen(true);
    requestAnimationFrame(() => historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  const hasHistory = (booking.history || []).length > 0;
  const checkedInHM = booking.checkedInAt
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: timezone || undefined })
      .format(new Date(booking.checkedInAt))
    : '';

  return (
    <WorkspaceSheet
      open
      onClose={onClose}
      title="Detalhe do agendamento"
      icon="calendar"
      width="max-w-[620px]"
      >
        {/* ── Cabeçalho denso ── */}
        <header className="shrink-0 px-4 py-3 flex items-start justify-between gap-3 border-b border-zinc-200">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-zinc-600 tabular-nums">{formatDateBR(booking.date)} · {booking.time}–{endHM}</span>
              <StatusBadge tone={def.tone}>{def.panel}</StatusBadge>
              {booking.bookingKind === 'fit_in' && <StatusBadge tone="amber">Encaixe</StatusBadge>}
              {booking.checkedInAt && <StatusBadge tone="emerald">Chegou</StatusBadge>}
            </div>
            <p className="font-semibold text-sm mt-1 leading-snug truncate">{service?.name || 'Serviço'}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{humanDay(booking.date, today)} · {dur} min</p>
          </div>

        </header>

        {pet360Open && booking.petId && booking.petName && (
          <Pet360Sheet
            open={pet360Open}
            onClose={() => setPet360Open(false)}
            businessId={businessId}
            pet={{
              id: booking.petId, businessId, tutorId: booking.customerId || '',
              name: booking.petName, photo: '', species: '', breed: '', sex: '', birthDate: '',
              weightKg: 0, notes: '', active: true, createdAt: '', updatedAt: '',
            }}
            tutorName={booking.customerName}
            tutorPhone={booking.customerPhone}
          />
        )}
        {encounterOpen && (
        <EncounterSheet
          businessId={businessId}
          bookingId={booking.id}
          seed={{
            customerName: booking.customerName,
            serviceId: booking.serviceId,
            professionalId: booking.professionalId,
            date: booking.date,
            time: booking.time,
            customerId: booking.customerId,
          }}
          canReopen={canReopenEncounter(role)}
          onScheduleReturn={onScheduleReturn ? (info: FollowUpSeed) => onScheduleReturn(info) : undefined}
          onClose={() => setEncounterOpen(false)}
          onSaved={onSaved}
          onChanged={onChanged}
        />
      )}

      <div className="flex-1 min-h-0 ws-scroll">
          {/* ── Pendência: passado e ainda aberto (aviso, decisão fica nas ações) ── */}
          {late && !rescheduling && (
            <div className="px-4 py-2.5 bg-amber-50/60 border-b border-amber-200/60">
              <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5"><Icon n="alert" size={13} /> Este atendimento precisa de fechamento</p>
              <p className="text-[11px] text-amber-800/80 mt-0.5 leading-snug">
                O horário já passou e o status continua “{def.panel}”. O InstaLink não conclui atendimento sozinho — escolha o que aconteceu.
              </p>
            </div>
          )}

          {/* ── Ações principais do atendimento (hierarquia, não cor de status) ── */}
          {!rescheduling && (
            <div className="px-4 py-3 border-b border-zinc-100">
              <div className="flex flex-wrap gap-1.5">
                {actions.map((a) => (
                  <Button key={a.status} size="sm" variant={TONE_TO_VARIANT[a.tone]}
                    onClick={() => act(a.status)} disabled={!!acting}>
                    {acting === a.status ? 'Salvando…' : a.label}
                  </Button>
                ))}
                <Button size="sm" variant="secondary" onClick={() => { setRescheduling(true); setError(''); }} disabled={!!acting}>
                  <Icon n="calendar" size={13} /> Reagendar
                </Button>
                {/* A3.4 · Bloco 4 — chegada do cliente. Fica junto das ações
                    porque é decisão do balcão, e é REVERSÍVEL (engano acontece). */}
                {permissions.atendimento && (
                  <Button size="sm" variant="soft" onClick={() => setEncounterOpen(true)} disabled={!!acting}>
                    <Icon n="fileText" size={13} /> Atendimento
                  </Button>
                )}
                {booking.checkedInAt ? (
                  <Button size="sm" variant="ghost" onClick={() => checkIn(true)} disabled={!!acting}
                    title="Desfazer o check-in deste atendimento">
                    <Icon n="check" size={13} /> Chegou às {checkedInHM}
                  </Button>
                ) : (
                  <Button size="sm" variant="soft" onClick={() => checkIn(false)} disabled={!!acting}>
                    <Icon n="check" size={13} /> {acting === 'checkin' ? 'Registrando…' : 'Registrar chegada'}
                  </Button>
                )}
              </div>
              {booking.checkedInAt && (
                <p className="text-[11px] text-[var(--text-muted)] mt-2">
                  Check-in registrado{booking.checkedInByName ? ` por ${booking.checkedInByName}` : ''} — o status do atendimento continua “{def.panel}”.
                </p>
              )}
            </div>
          )}

          {booking.seriesId && <div className="px-4 py-3 border-b border-zinc-100 space-y-2">
            <p className="text-xs text-zinc-500">Série · {booking.seriesIndex} de {booking.seriesCount}. Reagendar altera somente este atendimento.</p>
            {!cancelSeries ? <Button size="sm" variant="secondary" disabled={!!acting} onClick={() => setCancelSeries(true)}>Cancelar ocorrências futuras da série</Button> : <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-xs text-red-900">Cancelar todos os atendimentos futuros ainda pendentes ou confirmados desta série, incluindo este se estiver no futuro? Atendimentos passados e encerrados serão preservados.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="danger" disabled={!!acting} onClick={() => act('cancelled', { action: 'cancel-series-future' })}>Confirmar cancelamento</Button>
                <Button size="sm" variant="secondary" disabled={!!acting} onClick={() => setCancelSeries(false)}>Voltar</Button>
              </div>
            </div>}
          </div>}

          {/* ── Dados do atendimento (linhas com separadores discretos) ── */}
          <dl className="px-4 py-1 divide-y divide-zinc-100">
            <div className={ROW}>
              <dt className={ROW_DT}>{booking.petName ? 'Pet / Tutor' : 'Cliente'}</dt>
              <dd className={ROW_DD}>
                {/* FASE 2 · P6 — veterinária: PET em primeiro; tutor identificado.
                    Clique no pet abre o Pet 360 (HOMOLOGAÇÃO P1). */}
                {booking.petId && booking.petName ? (
                  <button type="button" className="font-semibold hover:underline text-[var(--brand-fg)]"
                    onClick={() => setPet360Open(true)} title={`Abrir ficha de ${booking.petName}`}>
                    {booking.petName}
                  </button>
                ) : (booking.petName || booking.customerName)}
                {(booking.petName || booking.customerPhone) && (
                  <span className="block text-xs text-zinc-500 font-normal">
                    {booking.petName ? `Tutor: ${booking.customerName}` : ''}
                    {booking.petName && booking.customerPhone ? ' · ' : ''}
                    {booking.customerPhone || ''}
                  </span>
                )}
              </dd>
            </div>
            <div className={ROW}>
              <dt className={ROW_DT}>Profissional</dt>
              <dd className={ROW_DD}>{pro?.name || 'Automático'}</dd>
            </div>
            <div className={ROW}>
              <dt className={ROW_DT}>Valor</dt>
              <dd className={ROW_DD}>{service?.price !== undefined ? money(service.price) : '—'}</dd>
            </div>
            {booking.note && (
              <div className={ROW}>
                <dt className={ROW_DT}>Observação</dt>
                <dd className={`${ROW_DD} font-normal text-zinc-700`}>“{booking.note}”</dd>
              </div>
            )}
            {(booking.rescheduleCount || 0) > 0 && (
              <div className={ROW}>
                <dt className={ROW_DT}>Reagendamentos</dt>
                <dd className={ROW_DD}>{booking.rescheduleCount}×</dd>
              </div>
            )}
            {(booking.answers || []).some(Boolean) && (
              <div className="py-2">
                <dt className={`${ROW_DT} mb-1`}>Respostas do cliente</dt>
                {(booking.answers || []).map((a, i) => a && (
                  <dd key={i} className="text-xs text-zinc-700 mb-1">
                    <span className="text-zinc-400 font-medium">{(service?.questions || [])[i] || `Pergunta ${i + 1}`}: </span>{a}
                  </dd>
                ))}
              </div>
            )}
          </dl>

          {/* ── Contexto: só o que tem ação real com os dados existentes ── */}
          <div className="px-4 py-3 border-t border-zinc-100">
            <p className={`${ROW_DT} uppercase tracking-wide mb-2`}>Contexto</p>
            <div className="flex flex-wrap gap-1.5">
              {booking.customerPhone && (
                <Link href={`/clientes?b=${businessId}&q=${encodeURIComponent(booking.customerPhone)}`}
                  className={cn(buttonCls('secondary', 'sm'))}>
                  <Icon n="user" size={13} /> Cliente
                </Link>
              )}
              {booking.customerPhone && (
                <a href={waLink(booking.customerPhone, waMsg)} target="_blank" rel="noreferrer"
                  className={cn(buttonCls('secondary', 'sm'))}>
                  <Icon n="whatsapp" size={13} className="text-emerald-600" /> WhatsApp
                </a>
              )}
              {hasHistory && (
                <Button size="sm" variant="secondary" onClick={showHistory}>
                  <Icon n="clock" size={13} /> Ver histórico
                </Button>
              )}
              {!booking.customerPhone && !hasHistory && (
                <span className="text-xs text-zinc-400">Sem telefone nem histórico registrado.</span>
              )}
            </div>
          </div>

          {error && <p className="px-4 py-2 text-sm font-medium text-red-600 border-t border-zinc-100">{error}</p>}
          {notice && <p className="px-4 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border-t border-emerald-100">{notice}</p>}

          {rescheduling && (
            <div className="px-4 py-3 border-t border-zinc-200 space-y-2.5">
              <p className="text-sm font-semibold">Reagendar atendimento</p>
              {decision.kind === 'recreate' && (
                <p className="text-[11px] bg-amber-50 border border-amber-200/70 text-amber-900 rounded-md px-3 py-2 leading-snug">
                  Este atendimento está <strong>{def.panel.toLowerCase()}</strong>. {decision.reason}
                </p>
              )}
              <label className="block">
                <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Nova data</span>
                <input type="date" value={date} min={today} max={adminBookingMaxDate(today)} onChange={(e) => setDate(e.target.value)}
                  className="block w-full mt-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--action)]" />
              </label>
              {loadingSlots ? (
                <p className="text-xs text-zinc-500">Buscando horários livres…</p>
              ) : slotsError ? (
                <p className="text-xs font-medium text-red-600">{slotsError}</p>
              ) : (
                <div>
                  <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Horários livres</span>
                  {slots.length === 0 ? (
                    <p className="text-xs text-amber-700 mt-1">Nenhum horário livre nesta data.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {slots.map((t) => (
                        <button key={t} onClick={() => setTime(t)}
                          className={cn('text-xs font-semibold px-2.5 py-1.5 rounded-md border', time === t ? 'bg-[var(--action)] text-[var(--action-contrast)] border-[var(--action)]' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50')}>
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Confirmação explícita: nunca remarcamos em silêncio. */}
              {confirming ? (
                <div className="rounded-md border border-zinc-300 bg-zinc-50 p-3">
                  <p className="text-xs font-semibold text-zinc-800">Confirmar reagendamento?</p>
                  <p className="text-[11px] text-zinc-600 mt-1 leading-snug">
                    {decision.kind === 'recreate' ? 'Cria um novo atendimento para' : 'Move este atendimento para'}{' '}
                    <strong>{formatDateBR(date)} às {time}</strong>. O cliente não é avisado automaticamente.
                  </p>
                  <div className="flex gap-2 mt-2.5">
                    <Button size="sm" className="flex-1" onClick={reschedule} disabled={!!acting}>
                      {acting === 'reschedule' ? 'Salvando…' : 'Confirmar'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Voltar</Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => setConfirming(true)} disabled={!date || !time || !!acting}>
                    Revisar e confirmar
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => { setRescheduling(false); setError(''); }}>Cancelar</Button>
                </div>
              )}
            </div>
          )}

          {hasHistory && (
            <div ref={historyRef} className="px-4 py-3 border-t border-zinc-100">
              <button onClick={() => setHistoryOpen((v) => !v)} className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-700">
                Histórico ({booking.history.length}) {historyOpen ? '▲' : '▼'}
              </button>
              {/* Timeline operacional: só eventos REAIS gravados (nada de
                  etapas futuras inventadas). A estrutura já comporta novos
                  tipos de evento quando existirem no sistema. */}
              {historyOpen && (
                <ol className="mt-2 relative border-l border-zinc-200 ml-1 space-y-3">
                  {[...booking.history].reverse().map((h, i) => (
                    <li key={i} className="relative pl-4">
                      <span aria-hidden="true" className={`absolute -left-[5px] top-1 w-2 h-2 rounded-full ${i === 0 ? 'bg-[var(--brand)]' : 'bg-[var(--border)]'}`} />
                      <p className="text-[11px] font-semibold text-zinc-500 tabular-nums">
                        {formatDateBR((h.at || '').slice(0, 10))} {(h.at || '').slice(11, 16)}
                      </p>
                      <p className="text-xs text-zinc-700 mt-0.5">
                        {h.from || 'criado'} → <strong>{h.to}</strong>
                        {h.note ? ` · ${h.note}` : ''}
                      </p>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        {h.by === 'customer' ? 'cliente' : h.by === 'owner' ? 'equipe' : h.by === 'master' ? 'suporte' : 'sistema'}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
        </WorkspaceSheet>
  );
}
