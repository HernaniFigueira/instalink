'use client';
import { useEffect, useState } from 'react';
import { centsToBR } from '@/lib/utils';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { Button, Field, FilterPill, Input, Notice, Select, Textarea } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import { FINANCE_METHODS, FINANCE_STATUS_LABEL } from '@/lib/finance';
import type { FinanceEntry, FinanceStatus, Service } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P7 × P3 — registrar pagamento AO CONCLUIR (opcional, nunca obrigatório)
// Pré-preenche a partir do atendimento (paciente, serviço, profissional,
// agendamento) e o preço do serviço quando cadastrado. Sem gateway: registro.
// ═══════════════════════════════════════════════════════════════
export interface PaymentSeed {
  businessId: string;
  contactId?: string;
  bookingId?: string;
  serviceId?: string;
  professionalId?: string;
  encounterId?: string;
  description?: string;
  dueDate?: string; // YYYY-MM-DD
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function RegisterPaymentSheet({ seed, onClose, onSaved }: {
  seed: PaymentSeed | null;
  onClose: () => void;
  onSaved?: (entry: FinanceEntry) => void;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<FinanceStatus>('pago');
  const [dueDate, setDueDate] = useState(todayISO());
  const [paidAt, setPaidAt] = useState(todayISO());
  const [method, setMethod] = useState('pix');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [priceHint, setPriceHint] = useState('');

  // Pré-preenchimento quando o sheet abre (carrega preço do serviço UMA vez).
  useEffect(() => {
    if (!seed) return;
    setDescription(seed.description || '');
    setDueDate(seed.dueDate || todayISO());
    setPaidAt(todayISO());
    setStatus('pago');
    setMethod('pix');
    setNote('');
    setError('');
    setAmount('');
    setPriceHint('');
    if (seed.serviceId) {
      apiGet<{ services: Service[] }>(`/api/catalog/get?businessId=${seed.businessId}`, { scope: 'area', area: 'Financeiro' })
        .then((r) => {
          const svc = (r.data?.services || []).find((s) => s.id === seed.serviceId);
          if (svc && svc.price > 0) {
            setAmount(String((svc.price / 100).toFixed(2)));
            setPriceHint(`Preço do serviço: ${centsToBR(svc.price)}`);
          }
        }).catch(() => { /* segue sem preço */ });
    }
  }, [seed]);

  async function save() {
    if (!seed) return;
    const cents = Math.round(Number(amount || 0) * 100);
    if (!cents || cents <= 0) { setError('Informe um valor maior que zero.'); return; }
    if (!description.trim()) { setError('Descreva o recebimento.'); return; }
    setSaving(true); setError('');
    const entry: Partial<FinanceEntry> = {
      kind: 'receita', status, amount: cents, description: description.trim().slice(0, 160),
      dueDate, paidAt: status === 'pago' ? (paidAt || dueDate) : '', method,
      contactId: seed.contactId || '', bookingId: seed.bookingId || '',
      serviceId: seed.serviceId || '', professionalId: seed.professionalId || '',
      encounterId: seed.encounterId || '', note,
    };
    const res = await apiSend<{ entry: FinanceEntry }>('/api/finance', 'POST', {
      action: 'create', businessId: seed.businessId, entry,
    }, { scope: 'area', area: 'Financeiro' });
    setSaving(false);
    if (!res.ok) { setError(res.message || 'Não foi possível registrar.'); return; }
    onSaved?.(res.data!.entry);
    onClose();
  }

  return (
    <WorkspaceSheet
      open={!!seed}
      onClose={onClose}
      title="Registrar recebimento"
      subtitle="Opcional — o atendimento já foi concluído. Sem cobrança automática."
      icon="wallet"
      width="max-w-[520px]"
      footer={
        <div className="flex gap-2 justify-end w-full">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Agora não</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Registrar'}</Button>
        </div>
      }
    >
      <div className="p-1 space-y-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="flex gap-2">
          {(['pago', 'pendente', 'previsto'] as FinanceStatus[]).map((s) => (
            <FilterPill key={s} active={status === s} onClick={() => setStatus(s)}>{FINANCE_STATUS_LABEL[s]}</FilterPill>
          ))}
        </div>
        <Field label="Descrição" required htmlFor="pay-desc">
          <Input id="pay-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor (R$)" required htmlFor="pay-amount" hint={priceHint || undefined}>
            <Input id="pay-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Forma de pagamento" htmlFor="pay-method">
            <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Não informado</option>
              {FINANCE_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Data prevista" htmlFor="pay-due">
            <Input id="pay-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          {status === 'pago' && (
            <Field label="Recebido em" htmlFor="pay-paid">
              <Input id="pay-paid" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label="Observações" htmlFor="pay-note">
          <Textarea id="pay-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </WorkspaceSheet>
  );
}
