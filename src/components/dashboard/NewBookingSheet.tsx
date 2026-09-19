'use client';
// "+ Novo agendamento" — o fluxo COMEÇA pelo cliente:
//   1. busca no CRM por nome ou WhatsApp (não cria cadastro duplicado);
//   2. seleciona a pessoa → nome/WhatsApp/e-mail preenchidos e vinculados;
//   3. só oferece "+ Novo cliente" quando a busca não encontra ninguém;
//   4. serviço → data → horário (grade real da agenda) → observação.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { todayISO } from '@/lib/tz';
import { adminBookingMaxDate } from '@/lib/booking-ops';
import { BookingRecurrence } from './BookingRecurrence';
import type { BookingOccurrence } from '@/lib/booking-recurrence';
import type { OccurrencePreview } from '@/lib/booking-series';
import { onlyDigits } from '@/lib/utils';
import type { Professional, Service } from '@/lib/types';

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
  initial?: { contactId?: string; name: string; phone: string; email?: string };
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
  const [serviceId, setServiceId] = useState('');
  const [proId, setProId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
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
  } | null>(null);
  const seq = useRef(0);
  const slotSeq = useRef(0);

  // A2-B5 (F9): "hoje" no fuso do negócio (o servidor continua validando).
  const today = todayISO(new Date(), timezone || undefined);
  const maxDate = adminBookingMaxDate(today);
  const service = bookable.find((s) => s.id === serviceId);
  const eligiblePros = service?.professionalIds?.length
    ? pros.filter((p) => p.active !== false && service.professionalIds.includes(p.id))
    : pros.filter((p) => p.active !== false);

  useEffect(() => { setProId(''); setTime(''); setSlots([]); setSlotsError(''); }, [serviceId]);

  useEffect(() => {
    if (!serviceId || !date) { setSlots([]); setSlotsError(''); setDayState(null); setLoadingSlots(false); return; }
    const mySeq = ++slotSeq.current;
    setLoadingSlots(true);
    setSlotsError('');
    setTime('');
    const professionalQuery = proId ? `&professionalId=${encodeURIComponent(proId)}` : '';
    fetch(`/api/bookings?mode=slots-admin&businessId=${businessId}&serviceId=${serviceId}&date=${date}${professionalQuery}`)
      .then(async (r) => {
        const d = await r.json();
        if (mySeq !== slotSeq.current) return;
        if (!r.ok) throw new Error(d.error || 'Não foi possível carregar os horários.');
        setSlots(d.slots || []);
        setDayState(d.closed || d.state ? { state: d.state, full: d.full, reason: d.reason } : null);
        if ((d.slots || []).length === 0 && d.closed) setSlotsError('');
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
  async function save() {
    if (saving || reviewing) return;
    if (repeat && (!preview || preview.some((r) => r.state !== 'available'))) { setError('Valide e corrija todas as ocorrências antes de confirmar.'); return; }
    setError('');
    if (!name.trim()) { setError('Busque o cliente ou toque em “+ Novo cliente”.'); return; }
    if (onlyDigits(phone).length < 10) { setError('Informe um WhatsApp válido.'); return; }
    if (!serviceId || !date || !time) { setError('Escolha serviço, data e horário.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const data = await res.json();
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
        time: data.occurrences?.[0]?.time || time,
      });
    } catch (e: any) {
      setError(e.message || 'Não foi possível criar o agendamento.');
    } finally {
      setSaving(false);
    }
  }

  const input = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900';
  const label = 'text-xs font-semibold tracking-wide uppercase text-zinc-500';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Novo agendamento">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-lg border border-zinc-200 max-h-[92vh] overflow-y-auto shadow-lg">
        <div className="sticky top-0 bg-white px-5 py-3 flex items-center justify-between border-b border-zinc-200">
          <p className="font-semibold">Novo agendamento</p>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 p-1.5" aria-label="Fechar"><Icon n="x" size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          {created ? (
            <div className="space-y-4" data-booking-created="true">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                <p className="text-base font-bold text-emerald-900 flex items-center gap-2"><span className="text-lg">✓</span> {created.count ? `${created.count} atendimentos criados` : 'Agendamento criado'}</p>
                <dl className="mt-3 space-y-1.5 text-sm text-emerald-950">
                  <div className="flex gap-2"><dt className="font-semibold min-w-24">Cliente</dt><dd>{created.customer}</dd></div>
                  <div className="flex gap-2"><dt className="font-semibold min-w-24">Serviço</dt><dd>{created.service}</dd></div>
                  <div className="flex gap-2"><dt className="font-semibold min-w-24">Profissional</dt><dd>{created.professional}</dd></div>
                  <div className="flex gap-2"><dt className="font-semibold min-w-24">{created.count ? 'Primeira data' : 'Data'}</dt><dd>{created.date}</dd></div>
                  <div className="flex gap-2"><dt className="font-semibold min-w-24">Horário</dt><dd>{created.time}</dd></div>
                </dl>
                {created.occurrences && <ol className="mt-3 space-y-1 text-xs">
                  {created.occurrences.map((row, i) => <li key={row.id}>{String(i + 1).padStart(2, '0')}. {row.date.split('-').reverse().join('/')} · {row.time} · {row.professionalName}</li>)}
                </ol>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button type="button" onClick={onClose} className="rounded-lg bg-zinc-900 text-white px-3 py-2.5 text-sm font-semibold">Fechar</button>
                <button type="button" onClick={() => { window.location.assign(`/agenda?b=${encodeURIComponent(businessId)}&data=${created.date}`); }} className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-800">Ver na agenda</button>
                <button type="button" onClick={() => { setCreated(null); setRepeat(false); setOccurrences([]); setPreview(null); requestId.current = ''; setServiceId(''); setDate(''); setTime(''); setNote(''); setError(''); }} className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-800">Novo agendamento</button>
              </div>
            </div>
          ) : (
          <div className="space-y-3">
          {/* 1. Cliente */}
          <div>
            <span className={label}>1. CLIENTE</span>
            {picked ? (
              <div className="mt-1 flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-3.5 py-3">
                <span className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-black shrink-0">
                  {(name || '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold truncate">{name}</span>
                  <span className="block text-[11px] text-emerald-800 truncate">
                    {phone}{email ? ` · ${email}` : ''}{contactId ? ' · vinculado ao cadastro ✓' : ' · novo cliente'}
                  </span>
                </span>
                <button onClick={resetClient} className="text-xs font-bold text-emerald-800 underline shrink-0">Trocar</button>
              </div>
            ) : (
              <>
                <input value={query} onChange={(e) => setQuery(e.target.value)} className={input + ' mt-1'} autoFocus
                  placeholder="Buscar por nome ou WhatsApp…" aria-label="Buscar cliente" />
                <p className="text-[11px] text-zinc-500 mt-1">
                  Buscamos no CRM para não duplicar cadastro — o cliente pode já ter conta na sua página.
                </p>
                {searching && <p className="text-[11px] text-zinc-400 mt-1">Buscando…</p>}
                {!searching && query.trim().length >= 2 && results.length === 0 && !newClient && (
                  <button onClick={startNew} className="mt-2 w-full text-left text-sm font-bold bg-emerald-50 border-2 border-emerald-300 text-emerald-900 rounded-xl px-3.5 py-2.5">
                    + Novo cliente “{query.trim()}”
                  </button>
                )}
                {!searching && results.length > 0 && (
                  <ul className="mt-2 border border-zinc-200 rounded-xl divide-y divide-zinc-100 overflow-hidden">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button onClick={() => pick(c)} className="w-full text-left px-3.5 py-2.5 hover:bg-zinc-50">
                          <span className="flex items-center gap-2">
                            <span className="font-bold text-sm truncate">{c.name || 'Sem nome'}</span>
                            {c.registered && <span className="text-[9px] font-extrabold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full">CADASTRADO</span>}
                          </span>
                          <span className="block text-[11px] text-zinc-500">{c.phone || 'sem telefone'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {newClient && (
                  <div className="mt-3 space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-[11px] font-bold text-zinc-600">NOVO CLIENTE — criamos o contato junto com o agendamento</p>
                    <label className="block"><span className={label}>NOME *</span>
                      <input value={name} onChange={(e) => setName(e.target.value)} className={input + ' mt-1'} placeholder="Ex: Marlene Silva" /></label>
                    <label className="block"><span className={label}>WHATSAPP *</span>
                      <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input + ' mt-1'} inputMode="tel" placeholder="(11) 99999-9999" /></label>
                    <label className="block"><span className={label}>E-MAIL</span>
                      <input value={email} onChange={(e) => setEmail(e.target.value)} className={input + ' mt-1'} inputMode="email" placeholder="Opcional" /></label>
                    <button onClick={() => setNewClient(false)} className="text-[11px] font-bold text-zinc-500 underline">Voltar para a busca</button>
                  </div>
                )}
              </>
            )}
          </div>

          <label className="block"><span className={label}>2. SERVIÇO *</span>
            <select value={serviceId} disabled={saving || reviewing} onChange={(e) => setServiceId(e.target.value)} className={input + ' mt-1'}>
              <option value="">Selecione…</option>
              {bookable.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} min</option>)}
            </select></label>

          {service && eligiblePros.length > 1 && (
            <label className="block"><span className={label}>PROFISSIONAL (OPCIONAL)</span>
              <select value={proId} disabled={saving || reviewing} onChange={(e) => setProId(e.target.value)} className={input + ' mt-1'}>
                <option value="">Automático (equilibrar equipe)</option>
                {eligiblePros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
          )}

          <label className="block"><span className={label}>3. DATA *</span>
            <input type="date" min={today} max={maxDate} value={date} disabled={saving || reviewing} onChange={(e) => setDate(e.target.value)} className={input + ' mt-1'} /></label>

          {date && serviceId && (
            <div>
              <span className={label}>HORÁRIO *</span>
              {loadingSlots ? (
                <p className="text-xs text-zinc-500 mt-1.5 flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" /> Carregando horários…</p>
              ) : slotsError ? (
                <p className="text-xs font-medium text-red-600 mt-1.5">{slotsError}</p>
              ) : slots.length === 0 ? (
                <p className="text-xs text-amber-700 mt-1.5 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  {dayState?.full
                    ? 'Todos os horários deste dia estão ocupados. Escolha outro dia.'
                    : dayState?.state === 'closed'
                      ? 'Fechado neste dia. Escolha outro dia.'
                      : 'Nenhum horário disponível.'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {slots.map((t) => (
                    <button key={t} disabled={saving || reviewing} onClick={() => setTime(t)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-md border ${time === t ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 hover:border-zinc-300'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={repeat} disabled={saving || reviewing} onChange={(e) => setRepeat(e.target.checked)} />
            Repetir este agendamento
          </label>
          {repeat && <BookingRecurrence first={{ date, time, professionalId: proId }} rows={occurrences} preview={preview}
            pros={eligiblePros} min={today} max={maxDate} busy={saving || reviewing}
            onChange={changeOccurrences} onReview={review} onDisable={() => setRepeat(false)} />}

          <label className="block"><span className={label}>OBSERVAÇÃO</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={input + ' mt-1'} placeholder="Opcional — fica no histórico do atendimento" /></label>

          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          <button onClick={save} disabled={saving || reviewing || (repeat && (!preview || preview.some((r) => r.state !== 'available')))} className="w-full font-bold bg-zinc-900 text-white py-3 rounded-xl disabled:opacity-50">
            {saving ? 'Agendando…' : reviewing ? 'Validando…' : repeat ? `Confirmar ${occurrences.length} atendimentos` : 'Salvar agendamento'}
          </button>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
