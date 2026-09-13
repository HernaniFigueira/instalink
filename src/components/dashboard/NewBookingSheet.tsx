'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { todayISO, addDaysISO } from '@/lib/tz';
import { onlyDigits } from '@/lib/utils';
import type { Professional, Service } from '@/lib/types';

// "+ Novo agendamento" (painel): o dono agendar por um cliente. O servidor
// resolve o profissional (ou aceita a indicação do dono, validada).
export function NewBookingSheet({ businessId, services, pros, horizonDays, onClose, onCreated }: {
  businessId: string;
  services: Service[];
  pros: Professional[];
  horizonDays: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const bookable = services.filter((s) => s.bookable && s.active !== false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [proId, setProId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const today = todayISO();
  const maxDate = addDaysISO(today, Math.max(1, horizonDays || 60));
  const service = bookable.find((s) => s.id === serviceId);
  const eligiblePros = service?.professionalIds?.length
    ? pros.filter((p) => p.active !== false && service.professionalIds.includes(p.id))
    : pros.filter((p) => p.active !== false);

  useEffect(() => {
    setProId('');
    setTime('');
    setSlots([]);
  }, [serviceId]);

  useEffect(() => {
    if (!serviceId || !date) { setSlots([]); return; }
    setLoadingSlots(true);
    setTime('');
    fetch(`/api/bookings?businessId=${businessId}&serviceId=${serviceId}&date=${date}`)
      .then((r) => r.json())
      .then((d) => setSlots(d.slots || []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [businessId, serviceId, date]);

  async function save() {
    setError('');
    if (!name.trim()) { setError('Informe o nome do cliente.'); return; }
    if (onlyDigits(phone).length < 10) { setError('Informe um WhatsApp válido.'); return; }
    if (!serviceId || !date || !time) { setError('Escolha serviço, data e horário.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, asOwner: true, customerName: name, customerPhone: phone, serviceId, professionalId: proId, date, time, note }),
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

  const input = 'w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Novo agendamento">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white/95 backdrop-blur px-5 py-4 flex items-center justify-between border-b border-zinc-100">
          <p className="font-bold text-lg">Novo agendamento</p>
          <button onClick={onClose} className="font-bold text-zinc-400 p-2 inline-flex" aria-label="Fechar"><Icon n="x" size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <label className="block"><span className="text-xs font-bold text-zinc-500">NOME DO CLIENTE *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={input + ' mt-1'} autoFocus placeholder="Ex: Marlene Silva" /></label>
          <label className="block"><span className="text-xs font-bold text-zinc-500">WHATSAPP *</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input + ' mt-1'} inputMode="tel" placeholder="(11) 99999-9999" /></label>
          <label className="block"><span className="text-xs font-bold text-zinc-500">SERVIÇO *</span>
            <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={input + ' mt-1'}>
              <option value="">Selecione…</option>
              {bookable.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} min</option>)}
            </select></label>
          {service && eligiblePros.length > 1 && (
            <label className="block"><span className="text-xs font-bold text-zinc-500">PROFISSIONAL (opcional)</span>
              <select value={proId} onChange={(e) => setProId(e.target.value)} className={input + ' mt-1'}>
                <option value="">Automático (equilibrar equipe)</option>
                {eligiblePros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
          )}
          <label className="block"><span className="text-xs font-bold text-zinc-500">DATA *</span>
            <input type="date" min={today} max={maxDate} value={date} onChange={(e) => setDate(e.target.value)} className={input + ' mt-1'} /></label>
          {date && serviceId && (
            <div>
              <span className="text-xs font-bold text-zinc-500">HORÁRIO *</span>
              {loadingSlots ? <p className="text-xs text-zinc-500 mt-1">Buscando…</p> : slots.length === 0 ? (
                <p className="text-xs text-zinc-500 mt-1">Sem horários livres nesta data.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {slots.map((t) => (
                    <button key={t} onClick={() => setTime(t)}
                      className={`text-xs font-bold px-3 py-2 rounded-lg border ${time === t ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <label className="block"><span className="text-xs font-bold text-zinc-500">OBSERVAÇÃO</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={input + ' mt-1'} placeholder="Opcional" /></label>
          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          <button onClick={save} disabled={saving} className="w-full font-bold bg-zinc-900 text-white py-3 rounded-xl disabled:opacity-50">
            {saving ? 'Agendando…' : 'Salvar agendamento'}
          </button>
        </div>
      </div>
    </div>
  );
}
