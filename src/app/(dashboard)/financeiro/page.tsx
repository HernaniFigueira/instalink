'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { centsToBR, cn } from '@/lib/utils';
import { Icon } from '@/components/icons';
import {
  Badge, Button, Card, Field, FilterPill, IconButton, Input, Kpi, ListSkeleton,
  Notice, PageHeader, Select, EmptyState, Tabs, Textarea,
} from '@/components/ui';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { AccessDenied, AreaLoadError } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import {
  FINANCE_METHODS, FINANCE_STATUS_LABEL, filterEntries, methodSlices,
  periodBars, plannedVsRealized, summarize,
} from '@/lib/finance';
import type { FinanceEntry, FinanceKind, FinanceStatus, Professional, Service } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P7 — GESTÃO → FINANCEIRO (básico, não é ERP)
// Movimentações registradas: receita/despesa, previsto→pago, filtros,
// totais, gráficos simples. PIX/cartão são FORMAS registradas (sem gateway).
// ═══════════════════════════════════════════════════════════════
interface Summary {
  receitaPrevista: number; receitaRecebida: number; receitaPendente: number;
  despesasPagas: number; despesasProjetadas: number; saldo: number;
  ticketMedio: number; pagamentosCount: number;
}
const EMPTY_SUMMARY: Summary = {
  receitaPrevista: 0, receitaRecebida: 0, receitaPendente: 0,
  despesasPagas: 0, despesasProjetadas: 0, saldo: 0, ticketMedio: 0, pagamentosCount: 0,
};

const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);

function blankEntry(): FinanceEntry {
  return {
    id: '', businessId: '', kind: 'receita', status: 'pendente', amount: 0,
    description: '', dueDate: todayISO(), paidAt: '', method: 'pix',
    contactId: '', bookingId: '', serviceId: '', professionalId: '', encounterId: '',
    note: '', createdAt: '', updatedAt: '', createdBy: '',
  };
}

export default function FinanceiroPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [denied, setDenied] = useState(false);
  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [periodEntries, setPeriodEntries] = useState<FinanceEntry[]>([]);
  const [pros, setPros] = useState<Professional[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState<FinanceStatus | ''>('');
  const [kind, setKind] = useState<FinanceKind | ''>('');
  const [professionalId, setProfessionalId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [method, setMethod] = useState('');

  const [editing, setEditing] = useState<FinanceEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [flash, setFlash] = useState('');

  const qs = useMemo(() => {
    const q = new URLSearchParams({ businessId, from, to });
    if (status) q.set('status', status);
    if (kind) q.set('kind', kind);
    if (professionalId) q.set('professionalId', professionalId);
    if (serviceId) q.set('serviceId', serviceId);
    if (method) q.set('method', method);
    return q.toString();
  }, [businessId, from, to, status, kind, professionalId, serviceId, method]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoaded(false);
    const res = await apiGet<any>(`/api/finance?${qs}`, { scope: 'area', area: 'Financeiro' });
    if (!res.ok) {
      setLoadError(res.message || 'Falha de conexão.');
      setDenied(res.status === 403);
      setLoaded(true);
      return;
    }
    setLoadError('');
    setEntries(res.data?.entries || []);
    setSummary({ ...EMPTY_SUMMARY, ...(res.data?.summary || {}) });
    setPeriodEntries(res.data?.charts?.period || []);
    setLoaded(true);
  }, [businessId, qs]);

  // Catálogo (profissionais/serviços) para os filtros — uma carga, sem polling.
  useEffect(() => {
    if (!businessId) return;
    apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Financeiro' })
      .then((r) => {
        if (!r.ok) return;
        setPros(r.data?.professionals || []);
        setServices((r.data?.services || []).filter((s: Service) => s.active));
      }).catch(() => { /* filtros seguem sem opções */ });
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!editing) return;
    setSaving(true); setFormError('');
    const res = await apiSend('/api/finance', 'POST', {
      action: editing.id ? 'update' : 'create', businessId, entry: editing,
    }, { scope: 'area', area: 'Financeiro' });
    setSaving(false);
    if (!res.ok) { setFormError(res.message || 'Não foi possível salvar.'); return; }
    setEditing(null);
    setFlash('Movimentação salva.');
    load();
  }

  async function remove(id: string) {
    setSaving(true);
    const res = await apiSend('/api/finance', 'POST', { action: 'delete', businessId, id }, { scope: 'area', area: 'Financeiro' });
    setSaving(false);
    if (!res.ok) { setFlash(res.message || 'Não foi possível excluir.'); return; }
    setFlash('Movimentação excluída.');
    load();
  }

  const bars = useMemo(() => periodBars(periodEntries, from, to), [periodEntries, from, to]);
  const planned = useMemo(() => plannedVsRealized(periodEntries), [periodEntries]);
  const methods = useMemo(() => methodSlices(periodEntries), [periodEntries]);
  const maxBar = Math.max(1, ...bars.map((b) => Math.max(b.receita, b.despesa)));

  const header = (
    <PageHeader
      icon="wallet"
      title="Financeiro"
      hint="O que entrou, o que está pendente e o que sai — por período e com formas de pagamento registradas."
      action={loaded && !denied && !loadError ? (
        <Button variant="primary" onClick={() => { setFormError(''); setEditing(blankEntry()); }}>
          <Icon n="plus" size={14} /> Movimentação
        </Button>
      ) : undefined}
    />
  );

  if (denied) return <>{header}<AccessDenied area="Financeiro" /></>;
  if (loadError) return <>{header}<AreaLoadError area="Financeiro" message={loadError} onRetry={load} /></>;

  const statusTone = (s: FinanceStatus): 'green' | 'amber' | 'blue' | 'zinc' =>
    s === 'pago' ? 'green' : s === 'pendente' ? 'amber' : s === 'previsto' ? 'blue' : 'zinc';

  const pct = (part: number, whole: number) => (whole ? Math.min(100, Math.round((part / whole) * 100)) : 0);
  const plannedTotal = Math.max(1, planned.reduce((a, p) => a + p.realizado + p.previsto, 0));

  return (
    <>
      {header}
      {flash ? <Notice tone="success">{flash}</Notice> : null}

      {!loaded ? <ListSkeleton rows={6} /> : (
        <>
          {/* ── Totais ── */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Receita prevista" value={centsToBR(summary.receitaPrevista)} hint="A receber no período" tone="brand" icon="calendar" />
            <Kpi label="Receita recebida" value={centsToBR(summary.receitaRecebida)} hint={`${summary.pagamentosCount} pagamento(s)`} tone="success" icon="checkCircle" />
            <Kpi label="Pendente" value={centsToBR(summary.receitaPendente)} hint="Receitas em aberto" tone="warning" icon="clock" />
            <Kpi label="Despesas pagas" value={centsToBR(summary.despesasPagas)} hint="Saída realizada" tone="danger" icon="receipt" />
            <Kpi label="Saldo" value={centsToBR(summary.saldo)} hint="Recebido − despesas pagas" tone={summary.saldo >= 0 ? 'success' : 'danger'} icon="wallet" />
            <Kpi label="Ticket médio" value={centsToBR(summary.ticketMedio)} hint="Por recebimento pago" tone="brand" icon="chart" />
          </div>

          {/* ── Filtros ── */}
          <Card className="p-4">
            <div className="flex flex-wrap gap-2 items-end">
              <Field label="De" htmlFor="fin-from"><Input id="fin-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[150px]" /></Field>
              <Field label="Até" htmlFor="fin-to"><Input id="fin-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[150px]" /></Field>
              <Field label="Status" htmlFor="fin-status">
                <Select id="fin-status" value={status} onChange={(e) => setStatus(e.target.value as FinanceStatus | '')} className="w-[140px]">
                  <option value="">Todos</option>
                  {(['previsto', 'pendente', 'pago', 'cancelado'] as FinanceStatus[]).map((s) => <option key={s} value={s}>{FINANCE_STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
              <div className="flex gap-1.5 pb-0.5">
                <FilterPill active={kind === ''} onClick={() => setKind('')}>Tudo</FilterPill>
                <FilterPill active={kind === 'receita'} onClick={() => setKind('receita')}>Receitas</FilterPill>
                <FilterPill active={kind === 'despesa'} onClick={() => setKind('despesa')}>Despesas</FilterPill>
              </div>
              <Field label="Profissional" htmlFor="fin-pro">
                <Select id="fin-pro" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} className="w-[170px]">
                  <option value="">Todos</option>
                  {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Serviço" htmlFor="fin-svc">
                <Select id="fin-svc" value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="w-[170px]">
                  <option value="">Todos</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Forma" htmlFor="fin-method">
                <Select id="fin-method" value={method} onChange={(e) => setMethod(e.target.value)} className="w-[140px]">
                  <option value="">Todas</option>
                  {FINANCE_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          {/* ── Gráficos simples (CSS, sem lib pesada) ── */}
          <div className="grid gap-3 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-1">
              <h3 className="text-[13px] font-extrabold text-[var(--text)] mb-3">Receitas por período</h3>
              <div className="flex items-end gap-1 h-32" role="img" aria-label="Barras de receita e despesa por período">
                {bars.length === 0 ? <p className="text-[12px] text-[var(--text-muted)]">Sem dados no período.</p> : bars.map((b) => (
                  <div key={b.from} className="flex-1 flex flex-col justify-end gap-0.5 min-w-[6px]" title={`${b.label}: +${centsToBR(b.receita)} / −${centsToBR(b.despesa)}`}>
                    <div className="rounded-t bg-[var(--success)]" style={{ height: `${pct(b.receita, maxBar) * 1.1}px`, minHeight: b.receita ? 3 : 0 }} />
                    <div className="rounded-b bg-[var(--danger)]" style={{ height: `${pct(b.despesa, maxBar) * 1.1}px`, minHeight: b.despesa ? 3 : 0 }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-2 text-[11px] text-[var(--text-muted)]">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[var(--success)]" /> Receita</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[var(--danger)]" /> Despesa</span>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-[13px] font-extrabold text-[var(--text)] mb-3">Previsto × realizado</h3>
              <div className="space-y-3">
                {planned.map((row) => (
                  <div key={row.label}>
                    <p className="text-[12px] text-[var(--text-muted)] mb-1">{row.label}</p>
                    <div className="flex h-4 rounded overflow-hidden bg-[var(--surface-3)]">
                      <div className="bg-[var(--success)] h-full" style={{ width: `${pct(row.realizado, plannedTotal)}%` }} title={`Realizado: ${centsToBR(row.realizado)}`} />
                      <div className="bg-[var(--brand-soft)] h-full border-l border-[var(--border)]" style={{ width: `${pct(row.previsto, plannedTotal)}%` }} title={`Previsto/pendente: ${centsToBR(row.previsto)}`} />
                    </div>
                    <p className="text-[11.5px] text-[var(--text-muted)] mt-1">{centsToBR(row.realizado)} realizados · {centsToBR(row.previsto)} previstos</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-[13px] font-extrabold text-[var(--text)] mb-3">Formas de pagamento (recebido)</h3>
              {methods.length === 0 ? <p className="text-[12px] text-[var(--text-muted)]">Nenhum recebimento pago no período.</p> : (
                <div className="space-y-2">
                  {methods.map((m) => {
                    const total = methods.reduce((a, x) => a + x.amount, 0) || 1;
                    return (
                      <div key={m.method}>
                        <div className="flex justify-between text-[12px]"><span className="text-[var(--text)] font-semibold">{m.label}</span><span className="text-[var(--text-muted)]">{centsToBR(m.amount)}</span></div>
                        <div className="h-2 rounded-full bg-[var(--surface-3)] mt-1"><div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${pct(m.amount, total)}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* ── Lista ── */}
          <Card className="overflow-hidden">
            <div className="px-4 pt-4 pb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-extrabold text-[var(--text)]">Movimentações ({entries.length})</h3>
            </div>
            {entries.length === 0 ? (
              <div className="p-4">
                <EmptyState icon="wallet" title="Nenhuma movimentação no recorte"
                  hint="Registre um recebimento ao concluir um atendimento ou lance uma despesa."
                  action={<Button variant="primary" onClick={() => { setFormError(''); setEditing(blankEntry()); }}><Icon n="plus" size={14} /> Movimentação</Button>} />
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {entries.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-3 flex-wrap">
                    <span className={cn('grid place-items-center h-8 w-8 rounded-lg shrink-0',
                      e.kind === 'receita' ? 'bg-[var(--success-bg)] text-[var(--success-fg)]' : 'bg-[var(--danger-bg,rgba(220,38,38,.08))] text-[var(--danger)]')}>
                      <Icon n={e.kind === 'receita' ? 'plus' : 'minus'} size={15} />
                    </span>
                    <div className="flex-1 min-w-[180px]">
                      <p className="text-[13.5px] font-bold text-[var(--text)] truncate">{e.description}</p>
                      <p className="text-[11.5px] text-[var(--text-muted)]">
                        {e.dueDate ? e.dueDate.split('-').reverse().join('/') : '—'}
                        {e.method ? ` · ${FINANCE_METHODS.find((m) => m.id === e.method)?.label || e.method}` : ''}
                        {e.paidAt ? ` · pago em ${e.paidAt.split('-').reverse().join('/')}` : ''}
                      </p>
                    </div>
                    <Badge tone={statusTone(e.status)}>{FINANCE_STATUS_LABEL[e.status]}</Badge>
                    <span className={cn('text-[14px] font-extrabold tabular-nums w-[110px] text-right', e.kind === 'receita' ? 'text-[var(--success-fg)]' : 'text-[var(--danger)]')}>
                      {e.kind === 'receita' ? '+' : '−'}{centsToBR(e.amount)}
                    </span>
                    <IconButton icon="pencil" label="Editar movimentação" size="sm" onClick={() => { setFormError(''); setEditing({ ...e }); }} />
                    <IconButton icon="x" label="Excluir movimentação" size="sm" variant="ghost" onClick={() => remove(e.id)} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ── Sheet de criar/editar ── */}
      <WorkspaceSheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar movimentação' : 'Nova movimentação'}
        subtitle="Registro de caixa — não há cobrança automática nesta fase."
        icon="wallet"
        width="max-w-[560px]"
        footer={
          <div className="flex gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
          </div>
        }
      >
        {editing && (
          <div className="p-1 space-y-3">
            {formError ? <Notice tone="error">{formError}</Notice> : null}
            <div className="flex gap-2">
              <FilterPill active={editing.kind === 'receita'} onClick={() => setEditing({ ...editing, kind: 'receita' })}>Receita</FilterPill>
              <FilterPill active={editing.kind === 'despesa'} onClick={() => setEditing({ ...editing, kind: 'despesa' })}>Despesa</FilterPill>
            </div>
            <Field label="Descrição" required htmlFor="fe-desc">
              <Input id="fe-desc" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Ex.: Consulta — João Silva" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valor (R$)" required htmlFor="fe-amount">
                <Input id="fe-amount" type="number" min="0" step="0.01" value={editing.amount ? (editing.amount / 100).toFixed(2) : ''} onChange={(e) => setEditing({ ...editing, amount: Math.round(Number(e.target.value || 0) * 100) })} />
              </Field>
              <Field label="Status" htmlFor="fe-status">
                <Select id="fe-status" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as FinanceStatus })}>
                  {(['previsto', 'pendente', 'pago', 'cancelado'] as FinanceStatus[]).map((s) => <option key={s} value={s}>{FINANCE_STATUS_LABEL[s]}</option>)}
                </Select>
              </Field>
              <Field label="Data prevista" htmlFor="fe-due">
                <Input id="fe-due" type="date" value={editing.dueDate} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} />
              </Field>
              <Field label="Data de pagamento" htmlFor="fe-paid" hint={editing.status === 'pago' ? undefined : 'Preenchida quando o status for Pago.'}>
                <Input id="fe-paid" type="date" value={editing.paidAt} onChange={(e) => setEditing({ ...editing, paidAt: e.target.value })} disabled={editing.status === 'cancelado'} />
              </Field>
              <Field label="Forma de pagamento" htmlFor="fe-method">
                <Select id="fe-method" value={editing.method} onChange={(e) => setEditing({ ...editing, method: e.target.value })}>
                  <option value="">Não informado</option>
                  {FINANCE_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </Select>
              </Field>
              <Field label="Profissional" htmlFor="fe-pro">
                <Select id="fe-pro" value={editing.professionalId} onChange={(e) => setEditing({ ...editing, professionalId: e.target.value })}>
                  <option value="">—</option>
                  {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Serviço" htmlFor="fe-svc">
                <Select id="fe-svc" value={editing.serviceId} onChange={(e) => setEditing({ ...editing, serviceId: e.target.value })}>
                  <option value="">—</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Observações" htmlFor="fe-note">
              <Textarea id="fe-note" rows={2} value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            </Field>
          </div>
        )}
      </WorkspaceSheet>
    </>
  );
}
