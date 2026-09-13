'use client';
// "+ Novo agendamento" — o fluxo COMEÇA pelo cliente:
//   1. busca no CRM por nome ou WhatsApp (não cria cadastro duplicado);
//   2. seleciona a pessoa → nome/WhatsApp/e-mail preenchidos e vinculados;
//   3. só oferece "+ Novo cliente" quando a busca não encontra ninguém;
//   4. serviço → data → horário (grade real da agenda) → observação.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { todayISO, addDaysISO } from '@/lib/tz';
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

export function NewBookingSheet({ businessId, services, pros, horizonDays, initial, onClose, onCreated }: {
  businessId: string;
  services: Service[];
  pros: Professional[];
  horizonDays: number;
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
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const slotSeq = useRef(0);

  const today = todayISO();
  const maxDate = addDaysISO(today, Math.max(1, horizonDays || 60));
  const service = bookable.find((s) => s.id === serviceId);
  const eligiblePros = service?.professionalIds?.length
    ? pros.filter((p) => p.active !== false && service.professionalIds.includes(p.id))
    : pros.filter((p) => p.active !== false);

  useEffect(() => { setProId(''); setTime(''); setSlots([]); setSlotsError(''); }, [serviceId]);

  useEffect(() => {
    if (!serviceId || !date) { setSlots([]); setSlotsError(''); setLoadingSlots(false); return; }
    const mySeq = ++slotSeq.current;
    setLoadingSlots(true);
    setSlotsError('');
    setTime('');
    fetch(`/api/bookings?businessId=${businessId}&serviceId=${serviceId}&date=${date}`)
      .then(async (r) => {
        const d = await r.json();
        if (mySeq !== slotSeq.current) return;
        if (!r.ok) throw new Error(d.error || 'Não foi possível carregar os horários.');
        setSlots(d.slots || []);
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
  }, [businessId, serviceId, date]);

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

  async function save() {
    setError('');
    if (!name.trim()) { setError('Busque o cliente ou toque em “+ Novo cliente”.'); return; }
    if (onlyDigits(phone).length < 10) { setError('Informe um WhatsApp válido.'); return; }
    if (!serviceId || !date || !time) { setError('Escolha serviço, data e horário.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId, asOwner: true, customerName: name, customerPhone: phone, customerEmail: email,
          contactId: contactId || undefined,
          serviceId, professionalId: proId, date, time, note,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated();
      onClose();
    } catch (e: any) {
      setError(e.message);
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
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={input + ' mt-1'}>
              <option value="">Selecione…</option>
              {bookable.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} min</option>)}
            </select></label>

          {service && eligiblePros.length > 1 && (
            <label className="block"><span className={label}>PROFISSIONAL (OPCIONAL)</span>
              <select value={proId} onChange={(e) => setProId(e.target.value)} className={input + ' mt-1'}>
                <option value="">Automático (equilibrar equipe)</option>
                {eligiblePros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
          )}

          <label className="block"><span className={label}>3. DATA *</span>
            <input type="date" min={today} max={maxDate} value={date} onChange={(e) => setDate(e.target.value)} className={input + ' mt-1'} /></label>

          {date && serviceId && (
            <div>
              <span className={label}>HORÁRIO *</span>
              {loadingSlots ? (
                <p className="text-xs text-zinc-500 mt-1.5 flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" /> Carregando horários…</p>
              ) : slotsError ? (
                <p className="text-xs font-medium text-red-600 mt-1.5">{slotsError}</p>
              ) : slots.length === 0 ? (
                <p className="text-xs text-amber-700 mt-1.5 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">Nenhum horário disponível.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {slots.map((t) => (
                    <button key={t} onClick={() => setTime(t)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-md border ${time === t ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 hover:border-zinc-300'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="block"><span className={label}>OBSERVAÇÃO</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={input + ' mt-1'} placeholder="Opcional — fica no histórico do atendimento" /></label>

          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          <button onClick={save} disabled={saving} className="w-full font-bold bg-zinc-900 text-white py-3 rounded-xl disabled:opacity-50">
            {saving ? 'Agendando…' : 'Salvar agendamento'}
          </button>
        </div>
      </div>
    </div>
  );
}
