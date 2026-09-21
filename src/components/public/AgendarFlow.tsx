'use client';
// ═══════════════════════════════════════════════════════════════
// FLUXO PÚBLICO DE AGENDAMENTO — /agendar + widget (A2-B2 · F1)
// ═══════════════════════════════════════════════════════════════
// Mesma arquitetura da página pública: NUNCA cria um segundo motor.
//   • dados do negócio vêm do Server Component (fonte canônica getPublicData
//     via lib/agendar.ts) — nada de checkout-info;
//   • slots/dias vêm de GET /api/bookings (motor computeSlots);
//   • reserva via POST /api/bookings → createBookingTx (caminho único);
//   • GUEST conclui sem conta (DECISÃO 5); cliente autenticado reutiliza a
//     identidade da sessão (GET /api/customer/me) sem redigitar nada;
//   • o servidor continua validando TUDO (tenant, serviço, bookable, slot,
//     horizonte, leadMin) — a UI nunca é a autoridade.
import { useEffect, useMemo, useRef, useState } from 'react';
import { money, onlyDigits, cn } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { upcomingDays, publicHorizonDays, type PublicBookingTarget } from '@/lib/agendar';
import type { Professional, Service } from '@/lib/types';

interface DayInfo { closed?: boolean; free?: number; state?: string; reason?: string }

interface Props {
  business: PublicBookingTarget;
  services: Service[];
  professionals: Professional[];
  /** Hoje no fuso do NEGÓCIO (servidor) — a lista de dias nunca usa o fuso do navegador. */
  today: string;
  initialServiceId?: string;
  initialDate?: string;
  leadId?: string;
  embed?: boolean;
}

interface CustomerInfo { id: string; name: string; phone: string; email: string }

export default function AgendarFlow({ business, services, professionals, today, initialServiceId, initialDate, leadId, embed }: Props) {
  const [me, setMe] = useState<CustomerInfo | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);

  const [serviceId, setServiceId] = useState(
    initialServiceId && services.some((s) => s.id === initialServiceId) ? initialServiceId : (services[0]?.id || ''),
  );
  const [date, setDate] = useState(initialDate && initialDate >= today ? initialDate : '');
  const [serverToday, setServerToday] = useState(today);
  const [dayInfo, setDayInfo] = useState<Record<string, DayInfo>>({});
  const [slots, setSlots] = useState<string[]>([]);
  const [occupied, setOccupied] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [time, setTime] = useState('');
  // 409 (horário ocupado na transação) ⇒ a grade é revalidada no servidor.
  const [slotRetry, setSlotRetry] = useState(0);

  // Identidade (guest × sessão)
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  const submitLock = useRef(false);
  const [daysError, setDaysError] = useState('');
  const [daysTry, setDaysTry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ status: string; time: string; date: string; professionalName?: string } | null>(null);

  const service = services.find((s) => s.id === serviceId);
  const horizon = publicHorizonDays(business.booking);

  // Sessão do consumidor: se existir, a identidade conhecida é reutilizada
  // (nada de digitar de novo) — mas o formulário guest continua disponível
  // para complementar quando a conta está incompleta.
  useEffect(() => {
    let alive = true;
    fetch('/api/customer/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.customer) setMe(d.customer); })
      .catch(() => {})
      .finally(() => { if (alive) setMeLoaded(true); });
    return () => { alive = false; };
  }, []);

  // Dias do fluxo: SEMPRE ancorados no hoje do SERVIDOR (fuso do negócio),
  // por aritmética de calendário — nunca Date.now() no fuso do navegador.
  const days = useMemo(
    () => upcomingDays(serverToday, Math.min(horizon, 14)),
    [serverToday, horizon],
  );

  // Mapa de dias (mesma API da página pública — mesmo motor).
  useEffect(() => {
    if (!serviceId || days.length === 0) return;
    let alive = true;
    setDaysError(''); setDayInfo({});
    fetch(`/api/bookings?businessId=${business.id}&serviceId=${serviceId}&from=${days[0]}&to=${days[days.length - 1]}`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw Error('Não foi possível consultar a disponibilidade dos dias.'); return d; })
      .then((d) => {
        if (!alive) return;
        setDayInfo(d.days || {});
        if (d.today) setServerToday(d.today);
      })
      .catch(() => { if (alive) setDaysError('Não foi possível consultar a disponibilidade dos dias.'); });
    return () => { alive = false; };
  }, [serviceId, business.id, days[0], days.length, daysTry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Slots do dia selecionado.
  useEffect(() => {
    if (!serviceId || !date) { setSlots([]); setOccupied([]); setSlotsError(''); return; }
    let alive = true;
    setSlotsLoading(true);
    setSlotsError('');
    setTime('');
    fetch(`/api/bookings?businessId=${business.id}&serviceId=${serviceId}&date=${date}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) throw new Error(d.error || 'Não foi possível carregar os horários.');
        setSlots(d.slots || []);
        setOccupied(d.occupied || []);
        if (d.today) setServerToday(d.today);
      })
      .catch((e: any) => { if (alive) { setSlots([]); setOccupied([]); setSlotsError(e.message || 'Não foi possível carregar os horários.'); } })
      .finally(() => { if (alive) setSlotsLoading(false); });
    return () => { alive = false; };
  }, [serviceId, date, business.id, slotRetry]);

  // Auto-troca para o primeiro dia com vaga quando o dia selecionado está fechado.
  useEffect(() => {
    if (!date || !dayInfo[date]) return;
    const info = dayInfo[date];
    if (info.closed && info.state !== 'full') {
      // Prefere dia ABERTO COM VAGA; aceita dia lotado (a causa é mostrada);
      // nunca pede dia fechado.
      const first = days.find((d) => dayInfo[d] && !dayInfo[d].closed && dayInfo[d].state !== 'full')
        || days.find((d) => dayInfo[d] && !dayInfo[d].closed);
      if (first) setDate(first);
    }
  }, [dayInfo, date, days]); // eslint-disable-line react-hooks/exhaustive-deps

  // Widget (iframe): reporta a altura real para o pai ajustar o embed.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!embed || typeof window === 'undefined' || window.parent === window) return;
    const post = () => {
      const h = rootRef.current?.scrollHeight || document.documentElement?.scrollHeight || 0;
      if (h > 0) window.parent.postMessage({ type: 'instalink:height', height: h }, '*');
    };
    post();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(post) : null;
    if (ro && rootRef.current) ro.observe(rootRef.current);
    return () => ro?.disconnect();
  }, [embed]);

  const needIdentity = !me || onlyDigits(me.phone || '').length < 10 || !String(me.name || '').trim();
  const canSubmit = !!serviceId && !!date && !!time
    && (!needIdentity || (name.trim().length > 0 && onlyDigits(phone).length >= 10));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!serviceId || !date || !time) { setError('Escolha serviço, dia e horário.'); return; }
    if (needIdentity && (!name.trim() || onlyDigits(phone).length < 10)) {
      setError('Informe seu nome e um WhatsApp válido.');
      return;
    }
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          serviceId,
          date,
          time,
          // Guest informa a identidade; com sessão completa o servidor usa a
          // conta (os campos abaixo são simplesmente ignorados por ele).
          customerName: name.trim() || undefined,
          customerPhone: onlyDigits(phone) || undefined,
          customerEmail: email.trim() || undefined,
          note: note.trim() || undefined,
          marketingOptIn,
          leadId: leadId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'phone_required' && !onlyDigits(phone).length) {
          setError('Precisamos do seu WhatsApp para confirmar.');
        } else {
          setError(data.error || 'Não foi possível confirmar o agendamento.');
        }
        // 409 = o horário acabou de ser ocupado: recarrega a grade do dia.
        if (res.status === 409) setSlotRetry((n) => n + 1);
        return;
      }
      setDone({ status: String(data.status || 'pending'), time, date, professionalName: data.professionalName });
    } catch (err: any) {
      setError(err.message || 'Falha ao agendar. Tente novamente.');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  if (done) {
    const pending = done.status !== 'confirmed';
    return (
      <div ref={rootRef} className={cn('max-w-lg mx-auto p-4 sm:p-6', !embed && 'my-8')}>
        <div className="bg-white rounded-2xl border border-zinc-200 p-6 sm:p-8 text-center shadow-sm">
          <div className={cn(
            'w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold',
            pending ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600',
          )}>
            {pending ? '⏳' : '✓'}
          </div>
          <h2 className="text-xl font-bold text-zinc-900 mb-1">
            {pending ? 'Agendamento recebido!' : 'Agendamento confirmado!'}
          </h2>
          <p className="text-sm text-zinc-600 mb-6">
            {pending
              ? `Recebemos seu pedido na ${business.name}. A confirmação depende da clínica; confira os canais de contato disponíveis.`
              : `Sua reserva na ${business.name} está confirmada.`}
          </p>
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-left text-sm space-y-2 mb-6">
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Serviço:</span>
              <span className="font-semibold text-zinc-900 text-right">{service?.name}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Data e hora:</span>
              <span className="font-semibold text-zinc-900">{humanDay(done.date, serverToday)} às {done.time}</span>
            </div>
            {done.professionalName && (
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Profissional:</span>
                <span className="font-semibold text-zinc-900">{done.professionalName}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Cliente:</span>
              <span className="font-semibold text-zinc-900">{me?.name || name}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-zinc-500">Situação:</span>
              <span className={cn('font-semibold', pending ? 'text-amber-600' : 'text-emerald-600')}>
                {pending ? 'Aguardando confirmação do negócio' : 'Confirmado'}
              </span>
            </div>
          </div>
          <button
            onClick={() => { setDone(null); setTime(''); setError(''); }}
            className="w-full bg-zinc-900 text-white font-medium py-2.5 rounded-lg text-sm hover:bg-zinc-800 transition"
          >
            Fazer outro agendamento
          </button>
          <a href={`/${business.slug}?conta=1`} className="block text-sm underline mt-4">{me ? 'Acessar minha conta na clínica' : 'Entrar ou criar acesso na clínica'}</a>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn('public-booking-flow max-w-2xl mx-auto p-4 sm:p-6', !embed && 'my-6')}>
      <div className={cn('bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden', embed && 'border-none shadow-none')}>
        {/* Cabeçalho do negócio */}
        <div className="p-5 border-b border-zinc-100 flex items-center gap-3.5 bg-zinc-50/50">
          {business.logo ? (
            <img src={business.logo} alt={business.name} className="w-24 max-h-16 object-contain" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-zinc-900 text-white flex items-center justify-center font-bold text-lg">
              {business.name?.[0]?.toUpperCase() || '•'}
            </div>
          )}
          <div>
            <h1 className="text-base font-bold text-zinc-900 leading-snug">{business.name}</h1>
            <p className="text-xs text-zinc-500">Agendamento online · confira os dados antes de confirmar</p>
          </div>
        </div>

        {error && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="p-5 sm:p-6 space-y-6">
          {!embed && <a href={`/${business.slug}`} className="inline-block text-sm underline">← Voltar à clínica</a>}
          {/* 1. Serviço */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">1. Escolha o serviço</label>
            {services.length === 0 ? (
              <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 p-3 rounded-lg">
                Esta clínica ainda não tem serviços com agendamento online. Entre em contato com a equipe.
              </p>
            ) : (
              <div className="grid gap-2">
                {services.map((svc) => (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => { setServiceId(svc.id); setDate(''); }}
                    className={cn(
                      'w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between',
                      serviceId === svc.id
                        ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm'
                        : 'border-zinc-200 hover:border-zinc-300 bg-white text-zinc-900',
                    )}
                  >
                    <div>
                      <p className="font-semibold text-sm">{svc.name}</p>
                      <p className={cn('text-xs mt-0.5', serviceId === svc.id ? 'text-zinc-300' : 'text-zinc-500')}>
                        {svc.description || '\u00A0'}
                      </p>
                    </div>
                    <div className="text-right pl-3 font-semibold text-sm">
                      {svc.price > 0 ? money(svc.price) : 'A combinar'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 2. Dia */}
          {serviceId && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">2. Escolha o dia</label>
              {daysError && <div role="alert" className="text-sm mb-3"><p>{daysError}</p><button type="button" className="border rounded-md px-3 py-2 mt-2" onClick={() => setDaysTry(n => n+1)}>Tentar consultar os dias novamente</button></div>}
              <div className="flex gap-2 overflow-x-auto pb-2">
                {days.map((d) => {
                  const info = dayInfo[d];
                  // F4 (A2-B3): fechado por regra/exceção fica desabilitado;
                  // dia "lotado" permanece clicável com aviso honesto.
                  const off = !!info && !!info.closed && info.state !== 'full';
                  const isFull = info?.state === 'full';
                  const [y, m, dayNum] = d.split('-');
                  const dateObj = new Date(Number(y), Number(m) - 1, Number(dayNum));
                  const weekday = dateObj.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
                  const month = dateObj.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => { if (!off) setDate(d); }}
                      disabled={off}
                      aria-disabled={off}
                      title={info?.closed
                        ? (isFull ? 'Dia lotado — sem vagas' : 'Fechado neste dia')
                        : info ? `${info.free ?? 0} horário(s) livre(s)` : undefined}
                      className={cn(
                        'flex-shrink-0 w-16 py-2.5 rounded-xl border text-center transition flex flex-col items-center justify-center',
                        date === d
                          ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm'
                          : 'bg-white border-zinc-200 hover:border-zinc-300 text-zinc-800',
                        off && 'opacity-35',
                      )}
                    >
                      <span className={cn('text-[10px] uppercase font-semibold', date === d ? 'text-zinc-300' : 'text-zinc-400')}>{weekday}</span>
                      <span className="text-base font-bold leading-tight my-0.5">{dayNum}</span>
                      <span className={cn('text-[10px] uppercase', date === d ? 'text-zinc-300' : 'text-zinc-500')}>
                        {info?.closed ? (isFull ? 'lotado' : 'fechado') : month}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. Horário */}
          {serviceId && date && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">3. Escolha o horário</label>
              {slotsLoading ? (
                <p className="text-xs text-zinc-400 py-3">Consultando horários disponíveis…</p>
              ) : slotsError ? (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 p-3 rounded-lg">
                  {slotsError}{' '}
                  <button type="button" className="font-bold underline" onClick={() => setDate((d) => d)}>Tentar novamente</button>
                </p>
              ) : slots.length === 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-3 rounded-lg">
                  {dayInfo[date]?.state === 'full'
                    ? 'Todos os horários deste dia estão ocupados. Escolha outro dia.'
                    : dayInfo[date]?.closed
                      ? 'Fechado neste dia. Escolha outro dia.'
                      : 'Nenhum horário livre nesta data. Por favor selecione outro dia.'}
                </p>
              ) : (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {slots.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setTime(s)}
                      className={cn(
                        'py-2 px-1 text-center rounded-lg text-xs font-semibold border transition',
                        time === s
                          ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm'
                          : 'bg-white border-zinc-200 hover:border-zinc-300 text-zinc-800',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4. Seus dados */}
          {time && (
            <div className="pt-2 border-t border-zinc-100 space-y-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500">4. Seus dados de contato</label>
              {meLoaded && me && !needIdentity ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-3 flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                    {me.name?.[0]?.toUpperCase() || '?'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-zinc-900 truncate">{me.name}</p>
                    <p className="text-xs text-emerald-800 truncate">{me.phone}{me.email ? ` · ${me.email}` : ''} · conta InstaLink</p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs text-zinc-500">
                    Sem conta? Sem problema — informe como a equipe te encontra no WhatsApp.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <span className="block text-xs text-zinc-600 mb-1">Seu nome *</span>
                      <input
                        type="text"
                        required
                        placeholder="Ex: Carlos Alberto"
                        aria-label="Seu nome" value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                      />
                    </div>
                    <div>
                      <span className="block text-xs text-zinc-600 mb-1">Seu WhatsApp *</span>
                      <input
                        type="tel"
                        required
                        inputMode="tel"
                        placeholder="(11) 99999-9999"
                        aria-label="WhatsApp" value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                      />
                    </div>
                  </div>
                  <div>
                    <span className="block text-xs text-zinc-600 mb-1">E-mail (opcional)</span>
                    <input
                      type="email"
                      placeholder="seu@email.com"
                      aria-label="E-mail" value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                    />
                  </div>
                </>
              )}

              <div>
                <span className="block text-xs text-zinc-600 mb-1">Observações ou dúvidas (opcional)</span>
                <textarea
                  rows={2}
                  placeholder="Algum detalhe sobre seu atendimento?"
                  aria-label="Observações ou dúvidas" value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
              </div>

              <label className="flex items-start gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-xs text-zinc-600">
                  Aceito receber lembretes e novidades deste estabelecimento pelo WhatsApp.
                </span>
              </label>
            </div>
          )}

          {time && service && <section className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 text-sm" aria-label="Resumo da reserva"><h2 className="font-semibold mb-2">Confira antes de confirmar</h2><p>{business.name}</p><p className="font-semibold">{service.name} · {humanDay(date, serverToday)} às {time}</p><p className="text-zinc-600 mt-1">{me?.name || name || 'Informe seu nome acima'}</p><p className="text-xs text-zinc-500 mt-2">Profissional definido pela disponibilidade da clínica. A confirmação só aparece depois de salvar a reserva.</p></section>}
          <button
            type="submit"
            disabled={submitting || !canSubmit}
            className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition shadow-sm"
          >
            {submitting ? 'Confirmando agendamento…' : time ? `Confirmar · ${humanDay(date, serverToday)} às ${time}` : 'Escolha serviço, dia e horário'}
          </button>
          <p className="text-[11px] text-zinc-400 text-center -mt-3">
            Ao agendar você informa nome e WhatsApp para o negócio confirmar seu atendimento.
          </p>
        </form>
      </div>
    </div>
  );
}
