'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, Field, DatePicker, Button, SelectMenu, Combobox } from '@/components/ui';
import { durationLabel } from '@/lib/duration-label';
import { adminBookingMaxDate, bookingDurationOf, rescheduleDecision } from '@/lib/booking-ops';
import { eligibleProfessionalIds } from '@/lib/booking';
import { todayISO, formatDateBR } from '@/lib/tz';
import type { Booking, Professional, Service } from '@/lib/types';

/**
 * Central, explicit edit surface for fields the existing booking PATCH accepts.
 * Patient/service/duration/observation are read here, not silently dropped or
 * turned into a duplicate; broad editing needs a separate server contract.
 */
export function BookingEditDialog({ booking, businessId, services, pros, timezone, onClose, onChanged, returnFocus }: {
  booking: Booking;
  businessId: string;
  services: Service[];
  pros: Professional[];
  timezone?: string;
  onClose: () => void;
  onChanged: () => void;
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  const service = services.find((entry) => entry.id === booking.serviceId);
  const [date, setDate] = useState(booking.date);
  const [time, setTime] = useState(booking.time);
  const [professionalId, setProfessionalId] = useState(booking.professionalId || '');
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const today = todayISO(new Date(), timezone || undefined);
  const eligible = useMemo(() => new Set(service ? eligibleProfessionalIds(service as any, pros) : []), [service, pros]);
  const eligiblePros = pros.filter((pro) => pro.active !== false && eligible.has(pro.id));
  const duration = bookingDurationOf(booking, service);
  const unavailableForEdit = rescheduleDecision(booking.status).kind !== 'move';

  useEffect(() => {
    let live = true;
    if (!date || !booking.serviceId || unavailableForEdit) {
      setSlots([]); setSlotsError(''); setLoadingSlots(false); return;
    }
    setLoadingSlots(true); setSlotsError('');
    const query = new URLSearchParams({
      mode: 'slots-admin', businessId, serviceId: booking.serviceId, date,
      gestureBookingId: booking.id, internalSnap: '15',
    });
    if (professionalId) query.set('professionalId', professionalId);
    fetch(`/api/bookings?${query.toString()}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível carregar os horários.');
        if (!live) return;
        const available = Array.isArray(data.slots) ? data.slots as string[] : [];
        setSlots(available);
        setTime((current) => available.includes(current) ? current : '');
      })
      .catch((reason: unknown) => {
        if (!live) return;
        setSlots([]); setTime('');
        setSlotsError(reason instanceof Error ? reason.message : 'Não foi possível carregar os horários.');
      })
      .finally(() => { if (live) setLoadingSlots(false); });
    return () => { live = false; };
  }, [booking.id, booking.serviceId, businessId, date, professionalId, unavailableForEdit]);

  async function save() {
    if (saving || loadingSlots || unavailableForEdit || !date || !time) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/bookings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, id: booking.id, date, time, professionalId: professionalId || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 409
        ? 'Esse horário acabou de ficar indisponível. Escolha outro.'
        : data.error || 'Não foi possível salvar as alterações.');
      onChanged();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar as alterações.');
    } finally { setSaving(false); }
  }

  const dirty = date !== booking.date || time !== booking.time || professionalId !== (booking.professionalId || '');
  const canSave = !unavailableForEdit && dirty && !!time;
  const savedRecordLabel = booking.petName
    ? `${booking.petName} · tutor ${booking.customerName}`
    : booking.customerName;

  return (
    <Dialog
      open
      onClose={onClose}
      returnFocus={returnFocus}
      title="Editar agendamento"
      subtitle="Alterações disponíveis no fluxo atual da Agenda"
      width="600px"
      dismissGuard={{ dirty, saving, context: 'edit' }}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Voltar</Button>
          <Button type="submit" form="booking-edit-form" disabled={!canSave || loadingSlots || saving}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </>
      )}
    >
      <form id="booking-edit-form" onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="gd-readonly-summary"><span>Paciente / tutor</span><strong>{savedRecordLabel}</strong></div>
          <div className="gd-readonly-summary"><span>Serviço</span><strong>{service?.name || 'Serviço'}</strong></div>
          <div className="gd-readonly-summary"><span>Duração</span><strong>{durationLabel(duration)}</strong></div>
          <div className="gd-readonly-summary"><span>Observação</span><strong>{booking.note?.trim() || 'Sem observação'}</strong></div>
        </div>
        <p className="text-xs text-[var(--gd-text-muted)]">
          Paciente, serviço, duração e observação aparecem para conferência, mas não podem ser gravados como edição no contrato atual da Agenda. Use <strong>Reagendar</strong> para a operação de reagendamento, que segue a política de status e histórico.
        </p>
        {unavailableForEdit ? (
          <p role="status" className="rounded-md border border-[var(--gd-border)] bg-[var(--gd-bg-subtle)] p-3 text-sm text-[var(--gd-text-muted)]">
            Este status segue o fluxo próprio de reagendamento; a edição direta não altera nem recria o agendamento.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Data">
              <DatePicker value={date} onChange={(value) => { setDate(value); setTime(''); }} label="Data" min={today} max={adminBookingMaxDate(today)} />
            </Field>
            <Field label="Profissional">
              <SelectMenu aria-label="Profissional" value={professionalId} onChange={(v) => { setProfessionalId(v); setTime(''); }}
                options={[{ value: '', label: 'Definido pela agenda' }, ...eligiblePros.map((pro) => ({ value: pro.id, label: pro.name }))]} />
            </Field>
            <Field label="Horário" hint={loadingSlots ? 'Carregando disponibilidade…' : slotsError || `${slots.length} horários disponíveis`}>
              {/* Horários: lista de volume (digitar "14" acha 14:00/14:30) → Combobox. */}
              <Combobox label="Horário" value={time} disabled={loadingSlots || !!slotsError || slots.length === 0}
                placeholder={loadingSlots ? 'Carregando…' : 'Selecione um horário'}
                options={slots.map((slot) => ({ value: slot, label: slot }))}
                onChange={(v) => setTime(String(v))} />
            </Field>
            <div className="gd-readonly-summary"><span>Horário atual</span><strong>{formatDateBR(booking.date)} · {booking.time}</strong></div>
          </div>
        )}
        {(slotsError || error) && <p role="alert" className="text-sm text-[var(--gd-danger-fg)]">{error || slotsError}</p>}
      </form>
    </Dialog>
  );
}
