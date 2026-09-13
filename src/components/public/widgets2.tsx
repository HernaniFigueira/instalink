'use client';
import { useEffect, useState } from 'react';
import { openSheet, gcalLink } from './sheet-bus';
import { useCustomerForm } from './use-customer-form';
import { Icon } from '@/components/icons';
import type { Business, Professional, PublicBusiness, Service } from '@/lib/types';
import { money, trackEvent, waLink } from './widgets';

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// ── AGENDAMENTO ──────────────────────────────────────────
export function BookingIsland({ business, services, professionals, title, initialServiceId, rescheduleId, bare }: {
  business: PublicBusiness;
  services: Service[];
  professionals: Professional[];
  title: string;
  initialServiceId?: string;
  rescheduleId?: string;
  bare?: boolean;
}) {
  const bookable = services.filter((s) => s.bookable);
  const [serviceId, setServiceId] = useState(() =>
    initialServiceId && bookable.some((s) => s.id === initialServiceId) ? initialServiceId : '');
  const [date, setDate] = useState('');
  const [dayInfo, setDayInfo] = useState<Record<string, { closed: boolean; free: number }>>({});
  const [slots, setSlots] = useState<string[]>([]);
  const [occupied, setOccupied] = useState<string[]>([]);
  const [serverToday, setServerToday] = useState('');
  const [closed, setClosed] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const form = useCustomerForm();

  const service = bookable.find((s) => s.id === serviceId);

  function selectService(id: string) {
    setAnswers([]);
    setServiceId(id);
    setDate('');
    setTime('');
    setSlots([]);
    setOccupied([]);
    setDayInfo({});
  }

  const horizon = Math.max(1, Math.min(90, business.booking?.horizonDays || 60));
  const allDays: Array<{ iso: string; label: string; dow: string }> = [];
  for (let i = 0; i < horizon; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    allDays.push({ iso, label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, dow: WEEK[d.getDay()] });
  }
  // Nunca exibe dia anterior ao hoje do servidor (fuso do negócio).
  const days = serverToday ? allDays.filter((x) => x.iso >= serverToday) : allDays;

  useEffect(() => {
    if (!serviceId) { setDayInfo({}); return; }
    if (days.length === 0) return;
    fetch(`/api/bookings?businessId=${business.id}&serviceId=${serviceId}&from=${days[0].iso}&to=${days[days.length - 1].iso}`)
      .then((r) => r.json())
      .then((d) => {
        setDayInfo(d.days || {});
        if (d.today) setServerToday(d.today);
      })
      .catch(() => setDayInfo({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, business.id, serverToday]);

  useEffect(() => {
    if (!serviceId || Object.keys(dayInfo).length === 0) return;
    if (!date || dayInfo[date]?.closed) {
      const first = days.find((x) => dayInfo[x.iso] && !dayInfo[x.iso].closed);
      if (first && first.iso !== date) { setDate(first.iso); setTime(''); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayInfo, serviceId]);

  useEffect(() => {
    if (!serviceId || !date) { setSlots([]); return; }
    setLoadingSlots(true);
    setTime('');
    fetch(`/api/bookings?businessId=${business.id}&serviceId=${serviceId}&date=${date}`)
      .then((r) => r.json())
      .then((d) => {
        setSlots(d.slots || []);
        setOccupied(d.occupied || []);
        setClosed(!!d.closed);
        if (d.today) setServerToday(d.today);
      })
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [serviceId, date, business.id]);

  function endTime(t: string, dur: number): string {
    const [h, m] = t.split(':').map(Number);
    const e = h * 60 + m + dur;
    return `${String(Math.floor(e / 60) % 24).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
  }

  // Grade unificada: livres primeiro, ocupados visíveis e desabilitados.
  const grid = [...slots.map((t) => ({ t, busy: false })), ...occupied.map((t) => ({ t, busy: true }))].sort((a, b) => (a.t < b.t ? -1 : 1));
  const groups = [
    { id: 'manha', label: 'Manhã', items: grid.filter((g) => g.t < '12:00') },
    { id: 'tarde', label: 'Tarde', items: grid.filter((g) => g.t >= '12:00' && g.t < '18:00') },
    { id: 'noite', label: 'Noite', items: grid.filter((g) => g.t >= '18:00') },
  ].filter((g) => g.items.length > 0);

  // O cliente NUNCA escolhe profissional: o servidor resolve e devolve o
  // nome apenas para uso interno (painel) — nunca é exibido aqui.
  async function submit() {
    setError('');
    if (!serviceId) { setError('Escolha um serviço.'); return; }
    if (!date || !time) { setError('Escolha data e horário.'); return; }
    if (!(await form.ensure({ phone: true }))) { form.afterAuth(() => submit()); return; }
    setLoading(true);
    try {
      if (!rescheduleId) trackEvent(business.id, 'booking_started');
      const url = rescheduleId ? '/api/customer/bookings' : '/api/bookings';
      const res = await fetch(url, {
        method: rescheduleId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rescheduleId
          ? { id: rescheduleId, date, time, serviceId, note, answers }
          : { businessId: business.id, serviceId, date, time, note, answers }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'login_required') { openSheet('auth', {}); form.afterAuth(() => submit()); return; }
        if (data.code === 'phone_required') { openSheet('phone', {}); form.afterAuth(() => submit()); return; }
        throw new Error(data.error);
      }
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (bookable.length === 0) return null;

  if (done && service) {
    const [y, m, d] = date.split('-');
    return (
      <div id="agendar" className={bare ? 'text-center py-2' : 'il-card p-6 text-center scroll-mt-20'}>
        <span className="inline-flex w-16 h-16 rounded-full items-center justify-center" style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}><Icon n="calendar" size={30} /></span>
        <h3 className="text-xl font-extrabold mt-3">{rescheduleId ? 'Horário remarcado!' : 'Agendamento recebido!'}</h3>
        <p className="il-muted text-sm mt-1">{service.name} · {d}/{m} às {time}–{endTime(time, service.durationMin)}</p>
        <p className="il-muted text-sm">vamos confirmar pelo seu WhatsApp.</p>
        <div className="mt-4 space-y-2">
          {business.whatsapp && !rescheduleId && (
            <a className="il-btn block font-extrabold py-3.5" target="_blank" rel="noreferrer"
              href={waLink(business.whatsapp, `Olá! Agendei ${service.name} para ${d}/${m} às ${time} (${form.name}).`)}
              onClick={() => trackEvent(business.id, 'whatsapp_click', { from: 'booking_success' })}>
              Confirmar no WhatsApp
            </a>
          )}
          <a target="_blank" rel="noreferrer"
            href={gcalLink({ title: `${service.name} — ${business.name}`, date, time, durationMin: service.durationMin, location: business.address || undefined })}
            className="il-card block font-bold py-3 text-sm">
            Adicionar ao Google Agenda
          </a>
          <button onClick={() => openSheet('account', {})} className="il-card w-full font-bold py-3 text-sm">Meus agendamentos</button>
        </div>
      </div>
    );
  }

  return (
    <div id="agendar" className="scroll-mt-20">
      {!bare && <h2 className="text-xl font-extrabold tracking-tight mb-3">{title || 'Agende seu horário'}</h2>}
      <div className="il-card p-4 space-y-4">
        {rescheduleId && (
          <p className="text-xs font-bold px-3 py-2 rounded-xl" style={{ background: 'color-mix(in srgb, var(--il-primary) 10%, transparent)' }}>
            Escolha o novo horário — seu agendamento atual só muda quando você confirmar.
          </p>
        )}
        <div>
          <p className="text-xs font-bold il-muted mb-1.5">1 · SERVIÇO</p>
          {service ? (
            <div className="il-chip-active px-4 py-3 flex justify-between items-center gap-2" style={{ borderRadius: 'var(--il-radius)' }}>
              <span><span className="font-bold text-sm block">{service.name}</span>
                <span className="text-xs opacity-80">{service.durationMin} min · {money(service.price)}</span></span>
              <button onClick={() => selectService('')} className="text-xs font-bold underline shrink-0">trocar</button>
            </div>
          ) : (
          <div className="space-y-2">
            {bookable.map((s) => (
              <button key={s.id} onClick={() => selectService(s.id)}
                className={`w-full text-left px-4 py-3 border flex justify-between items-center gap-2 ${serviceId === s.id ? 'il-chip-active border-transparent' : 'il-card'}`}
                style={{ borderRadius: 'var(--il-radius)' }}>
                <span><span className="font-bold text-sm block">{s.name}</span>
                  <span className={`text-xs ${serviceId === s.id ? 'opacity-80' : 'il-muted'}`}>{s.durationMin} min</span></span>
                <span className="font-extrabold text-sm">{money(s.price)}</span>
              </button>
            ))}
          </div>
          )}
        </div>

        {serviceId && (
          <div>
            <p className="text-xs font-bold il-muted mb-1.5">2 · DIA</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {days.map((d) => {
                const info = dayInfo[d.iso];
                const off = !!info && info.closed;
                return (
                  <button key={d.iso} onClick={() => !off && setDate(d.iso)} disabled={off}
                    title={off ? 'Sem vaga neste dia' : info ? `${info.free} horário(s) livre(s)` : undefined}
                    className={`shrink-0 px-3.5 py-2 border text-center ${date === d.iso ? 'il-chip-active border-transparent' : 'il-card'} ${off ? 'opacity-35' : ''}`}
                    style={{ borderRadius: 'var(--il-radius)' }}>
                    <span className="block text-[11px] font-semibold opacity-70">{d.dow}</span>
                    <span className="block text-sm font-extrabold">{d.label}</span>
                    {info && !off && (
                      <span className={`block text-[10px] font-bold mt-0.5 ${date === d.iso ? 'opacity-80' : 'il-accent'}`}>
                        {info.free} {info.free === 1 ? 'vaga' : 'vagas'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {date && serviceId && (
          <div>
            <p className="text-xs font-bold il-muted mb-1.5">HORÁRIO{slots.length > 0 && ` · ${slots.length} LIVRE(S)`}</p>
            {loadingSlots ? <p className="il-muted text-sm">Buscando horários…</p>
              : closed || grid.length === 0 ? <p className="il-muted text-sm">Sem horários livres neste dia. Tente outro dia.</p>
              : (
                <div className="space-y-3">
                  {groups.map((g) => (
                    <div key={g.id}>
                      <p className="text-[11px] font-extrabold uppercase tracking-wider il-muted mb-1.5">{g.label}</p>
                      <div className="flex flex-wrap gap-2">
                        {g.items.map(({ t, busy }) => (
                          <button key={t} onClick={() => !busy && setTime(t)} disabled={busy}
                            title={busy ? 'Horário ocupado' : `${t} disponível`}
                            className={`text-sm font-bold px-4 py-2.5 border ${time === t ? 'il-chip-active border-transparent' : 'il-card'} ${busy ? 'opacity-40 line-through cursor-not-allowed' : ''}`}
                            style={{ borderRadius: 'var(--il-radius)' }}>{t}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}

        {time && service && (
          <div className="rounded-2xl p-3.5" style={{ background: 'color-mix(in srgb, var(--il-primary) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--il-primary) 28%, transparent)' }}>
            <p className="font-extrabold text-sm">Resumo</p>
            <p className="text-sm mt-1 font-bold">{service.name}</p>
            <p className="il-muted text-xs mt-0.5">
              {date.split('-').reverse().join('/')} · {time}–{endTime(time, service.durationMin)}
            </p>
            <p className="font-extrabold il-accent text-sm mt-1">{money(service.price)} · {service.durationMin} min</p>
          </div>
        )}

        {time && (
          <div className="space-y-2.5">
            {form.logged ? (
              <div className="il-card px-4 py-3 flex items-center gap-2.5">
                <Icon n="userCircle" size={20} className="shrink-0 il-muted" />
                <p className="text-sm"><span className="font-bold">{form.customer?.name}</span> <span className="il-muted">· {form.customer?.phone}</span></p>
              </div>
            ) : (
              <div className="rounded-2xl p-4 text-center" style={{ background: 'color-mix(in srgb, var(--il-primary) 8%, transparent)', border: '1px dashed color-mix(in srgb, var(--il-primary) 30%, transparent)' }}>
                <span className="inline-flex w-11 h-11 rounded-full items-center justify-center mb-2" style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}><Icon n="shield" size={22} /></span>
                <p className="text-sm font-bold">Para confirmar seu agendamento, entre na sua conta.</p>
                <p className="il-muted text-xs mt-0.5">Uma conta para agendar e acompanhar tudo.</p>
                <button onClick={() => submit()} className="il-btn w-full font-extrabold py-3 mt-3">
                  Efetuar login
                </button>
              </div>
            )}
            {form.logged && (
              <>
                <label className="block"><span className="text-xs font-bold il-muted">OBSERVAÇÃO (OPCIONAL)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Alguma preferência?" maxLength={300} className="il-card w-full text-sm px-4 py-3 outline-none mt-1" /></label>
                {(service?.questions || []).map((q: string, i: number) => (
                  <label key={i} className="block"><span className="text-xs font-bold il-muted">{q.toUpperCase().slice(0, 60)}</span>
                    <input value={answers[i] || ''} onChange={(e) => setAnswers((v) => { const n = [...v]; n[i] = e.target.value; return n; })}
                      placeholder="Sua resposta" maxLength={300} className="il-card w-full text-sm px-4 py-3 outline-none mt-1" /></label>
                ))}
              </>
            )}
          </div>
        )}

        {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
        <div className="sticky bottom-0 -mx-1 px-1 pt-2 pb-1" style={{ background: 'linear-gradient(transparent, color-mix(in srgb, var(--il-bg) 94%, transparent) 35%)' }}>
          <button onClick={submit} disabled={loading || !time || !serviceId} className="il-btn w-full font-extrabold py-3.5 disabled:opacity-50">
            {loading ? 'Confirmando…' : time ? `${rescheduleId ? 'Remarcar' : 'Confirmar'} · ${time}` : serviceId ? 'Escolha um horário' : 'Escolha um serviço'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── FORMULÁRIO DE ORÇAMENTO (guest permitido) ─────────────
export function QuoteIsland({ businessId, title, bare }: { businessId: string; title: string; bare?: boolean }) {
  const [interest, setInterest] = useState('');
  const [done, setDone] = useState<{ guest: boolean } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const form = useCustomerForm();

  async function submit() {
    setError('');
    if (!form.logged) {
      if (!form.name.trim()) { setError('Informe seu nome.'); return; }
      if (form.phone.replace(/\D/g, '').length < 10) { setError('Informe um WhatsApp válido.'); return; }
    }
    setLoading(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, name: form.name, phone: form.phone, interest, origin: 'orcamento', action: 'orcamento' }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'login_required') { openSheet('auth', {}); form.afterAuth(() => submit()); return; }
        throw new Error(data.error);
      }
      setDone({ guest: !!data.guest });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="orcamento" className="scroll-mt-20">
      {!bare && <h2 className="text-xl font-extrabold tracking-tight mb-3">{title || 'Solicite um orçamento'}</h2>}
      <div className="il-card p-4">
        {done ? (
          <div className="text-center py-2">
            <span className="inline-flex w-14 h-14 rounded-full items-center justify-center" style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}><Icon n="checkCircle" size={28} /></span>
            <p className="text-sm font-bold mt-2">Pedido enviado! Retornamos rapidinho.</p>
            {done.guest && (
              <button onClick={() => openSheet('auth', {})} className="il-btn w-full font-extrabold py-3 mt-3 text-sm">
                Criar conta grátis para acompanhar
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {form.logged ? (
              <div className="il-card px-4 py-3 flex items-center gap-2.5">
                <Icon n="userCircle" size={20} className="shrink-0 il-muted" />
                <p className="text-sm"><span className="font-bold">{form.customer?.name}</span> <span className="il-muted">· {form.customer?.phone}</span></p>
              </div>
            ) : (
              <>
                <label className="block"><span className="text-xs font-bold il-muted">SEU NOME *</span>
                  <input value={form.name} onChange={(e) => form.setName(e.target.value)} placeholder="Como podemos te chamar?" autoComplete="name" className="il-card w-full text-sm px-4 py-3 outline-none mt-1" /></label>
                <label className="block"><span className="text-xs font-bold il-muted">WHATSAPP *</span>
                  <input value={form.phone} onChange={(e) => form.setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" autoComplete="tel" className="il-card w-full text-sm px-4 py-3 outline-none mt-1" /></label>
              </>
            )}
            <label className="block"><span className="text-xs font-bold il-muted">O QUE VOCÊ PRECISA?</span>
              <textarea value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="Descreva o que você precisa…" rows={3} className="il-card w-full text-sm px-4 py-3 outline-none resize-none mt-1" /></label>
            {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
            <button onClick={submit} disabled={loading} className="il-btn w-full font-extrabold py-3 disabled:opacity-50">
              {loading ? 'Enviando…' : 'Solicitar orçamento'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CONCIERGE IA ─────────────────────────────────────────
interface Msg { from: 'bot' | 'user'; text: string; actions?: Array<{ label: string; target: string }> }

export function ConciergeIsland({ business, title }: { business: PublicBusiness; title: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  function start() {
    setOpen(true);
    if (msgs.length === 0) {
      setLoading(true);
      fetch('/api/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: business.id, message: 'oi' }),
      })
        .then((r) => r.json())
        .then((d) => setMsgs([{ from: 'bot', text: d.reply, actions: d.actions }]))
        .catch(() => setMsgs([{ from: 'bot', text: 'Olá! Como posso ajudar?' }]))
        .finally(() => setLoading(false));
    }
  }

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || loading) return;
    setInput('');
    setMsgs((m) => [...m, { from: 'user', text: clean }]);
    setLoading(true);
    try {
      const res = await fetch('/api/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: business.id, message: clean }),
      });
      const d = await res.json();
      setMsgs((m) => [...m, { from: 'bot', text: d.reply, actions: d.actions }]);
    } catch {
      setMsgs((m) => [...m, { from: 'bot', text: 'Tive um probleminha. Tente de novo ou fale no WhatsApp!', actions: [{ label: 'Falar no WhatsApp', target: 'whatsapp' }] }]);
    } finally {
      setLoading(false);
    }
  }

  function go(target: string) {
    if (target === 'whatsapp') {
      trackEvent(business.id, 'whatsapp_click', { from: 'concierge' });
      window.open(waLink(business.whatsapp, 'Olá! Vim pelo site.'), '_blank');
    } else if (target === '#produtos' || target === '#agendar' || target === '#orcamento' || target === '#contato') {
      setOpen(false);
      const sheet: 'products' | 'booking' | 'quote' = target === '#produtos' ? 'products' : target === '#agendar' ? 'booking' : 'quote';
      openSheet(sheet, {});
      trackEvent(business.id, 'button_click', { from: 'concierge', target });
    } else {
      setOpen(false);
      document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
      trackEvent(business.id, 'button_click', { from: 'concierge', target });
    }
  }

  return (
    <div>
      <button onClick={start} className="il-card w-full p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-transform">
        <span className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}><Icon n="spark" size={24} /></span>
        <span>
          <span className="font-extrabold block">{title || 'Precisa de ajuda?'}</span>
          <span className="il-muted text-sm">Nosso assistente te guia rapidinho</span>
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="il-page relative w-full sm:max-w-md h-[85vh] sm:h-[600px] rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden" style={{ background: 'var(--il-bg)' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ background: 'var(--il-primary)' }}>
              <div className="flex items-center gap-2.5 text-white">
                <span className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-white/20"><Icon n="spark" size={20} /></span>
                <div>
                  <p className="font-extrabold text-sm">Assistente {business.name}</p>
                  <p className="text-xs opacity-80 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-300" /> online agora</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-white font-bold p-2" aria-label="Fechar"><Icon n="x" size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {msgs.map((m, i) => (
                <div key={i} className={m.from === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={`max-w-[85%] px-4 py-2.5 text-sm ${m.from === 'user' ? 'il-chip-active' : 'il-card'}`}
                    style={{ borderRadius: 'var(--il-radius)' }}>
                    {m.text}
                    {m.actions && m.actions.length > 0 && (
                      <span className="block mt-2 space-y-1.5">
                        {m.actions.map((a) => (
                          <button key={a.label} onClick={() => go(a.target)}
                            className="il-btn block w-full text-xs font-extrabold px-3 py-2">
                            {a.label}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {loading && <p className="il-muted text-xs">digitando…</p>}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="p-3 flex gap-2" style={{ background: 'var(--il-surface)' }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Digite sua dúvida…"
                className="il-card flex-1 text-sm px-4 py-3 outline-none" aria-label="Digite sua dúvida" />
              <button type="submit" className="il-btn font-extrabold px-5 flex items-center" aria-label="Enviar"><Icon n="send" size={18} /></button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BOTÃO WHATSAPP FLUTUANTE ─────────────────────────────
export function WaFloat({ business, label }: { business: PublicBusiness; label: string }) {
  if (!business.whatsapp) return null;
  return (
    <a
      href={waLink(business.whatsapp, `Olá! Vim pelo site da ${business.name}.`)}
      target="_blank" rel="noreferrer"
      onClick={() => trackEvent(business.id, 'whatsapp_click', { from: 'float' })}
      className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-2xl text-white"
      style={{ background: '#22c55e' }}
      aria-label={label || 'Falar no WhatsApp'}
      title={label || 'Falar no WhatsApp'}
    >
      <Icon n="phone" size={24} className="text-white" />
    </a>
  );
}
