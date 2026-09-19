'use client';
// ═══════════════════════════════════════════════════════════════
// HORÁRIOS — empresa × profissional (herança, personalização, aplicar a todos)
// ═══════════════════════════════════════════════════════════════
// Regras de produto implementadas aqui (a lógica pura vive em lib/schedule):
//
//   1. existe UM horário geral da empresa;
//   2. todo profissional HERDA esse horário por padrão (novo = herda);
//   3. alterar o horário geral atualiza automaticamente QUEM HERDA e não
//      toca em quem personalizou (a UI diz exatamente quem é afetado);
//   4. dá para personalizar o horário de um profissional (ele deixa de herdar);
//   5. "Aplicar horário a todos" alinha quem segue a empresa e NUNCA
//      sobrescreve personalização em silêncio (mostra quem será ignorado);
//   6. apresentação em LISTA simples — um dia por linha, sem cards aninhados.
//
// Erros de permissão (403) aparecem como mensagem amigável nesta tela: nada
// aqui desloga o usuário (ver lib/http.ts e lib/client-auth.ts).
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/icons';
import { apiSend } from '@/lib/api-client';
import { PermissionNotice } from './AccessNotice';
import {
  businessHoursChangeImpact, businessRules, customRulesFor, followTogglePatch,
  hoursTable, planApplyBusinessHoursToAll, professionalHoursSummary, sanitizeWindows,
} from '@/lib/schedule';
import type { DayWindow } from '@/lib/schedule';
import type { Availability, Professional } from '@/lib/types';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SLOT_OPTIONS = [
  { value: 0, label: 'Duração do serviço' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
];

interface Period { start: string; end: string; slotMin: number }

interface Notice { tone: 'ok' | 'error' | 'denied'; text: string; hint?: string }

const inputCls = 'rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900';
const btnGhost = 'text-xs font-semibold bg-white border border-zinc-300 px-3 py-1.5 rounded-md hover:bg-zinc-50 disabled:opacity-50';
/* A3.3 (ponto 4): o primário desta tela é o AZUL do design system — preto
   nunca é CTA. Nome mantido para não tocar em cada chamada. */
const btnDark = 'text-xs font-semibold bg-[var(--brand)] text-white px-3.5 py-2 rounded-md shadow-brand hover:bg-[var(--brand-strong)] disabled:opacity-50';

function periodsFrom(rules: Availability[]): Period[][] {
  const days: Period[][] = Array.from({ length: 7 }, () => []);
  for (const r of rules || []) {
    if (r.weekday >= 0 && r.weekday <= 6) {
      days[r.weekday].push({ start: r.start, end: r.end, slotMin: r.slotMin ?? 0 });
    }
  }
  return days.map((list) => list.sort((a, b) => (a.start < b.start ? -1 : 1)));
}

function toWindows(days: Period[][]): DayWindow[] {
  return days.flatMap((list, weekday) => list.map((p) => ({ weekday, start: p.start, end: p.end, slotMin: p.slotMin })));
}

/** Resumo de uma linha do horário (ex.: "Seg–Sex 09:00 — 18:00"). */
export function hoursSummaryLine(rules: Availability[]): string {
  const open = hoursTable(rules).filter((r) => !r.closed);
  if (open.length === 0) return 'Sem dias abertos';
  return open.map((r) => `${r.label.slice(0, 3)} ${r.windows.map((w) => `${w.start} — ${w.end}`).join(', ')}`).join(' · ');
}

// ── Lista de dias (um dia por linha, períodos extras quando precisar) ──
export function DayHoursList({ initial, onSubmit, saving, submitLabel, footer }: {
  initial: Availability[];
  onSubmit: (windows: DayWindow[]) => Promise<void> | void;
  saving?: boolean;
  submitLabel?: string;
  footer?: React.ReactNode;
}) {
  const [days, setDays] = useState<Period[][]>(() => periodsFrom(initial));
  const [error, setError] = useState('');

  function toggleDay(i: number) {
    setDays((d) => d.map((list, idx) => (idx === i ? (list.length ? [] : [{ start: '09:00', end: '18:00', slotMin: 0 }]) : list)));
  }

  function addPeriod(i: number) {
    setDays((d) => d.map((list, idx) => (idx !== i || list.length >= 3 ? list : [...list, { start: '09:00', end: '18:00', slotMin: 0 }])));
  }

  function setPeriod(i: number, j: number, patch: Partial<Period>) {
    setDays((d) => d.map((list, idx) => (idx === i ? list.map((p, k) => (k === j ? { ...p, ...patch } : p)) : list)));
  }

  function removePeriod(i: number, j: number) {
    setDays((d) => d.map((list, idx) => (idx === i ? list.filter((_, k) => k !== j) : list)));
  }

  async function submit() {
    const windows = toWindows(days);
    if (windows.length === 0) {
      setError('Abra ao menos um dia — ou use exceções para fechar datas específicas.');
      return;
    }
    const valid = sanitizeWindows(windows);
    if (valid.length !== windows.length) {
      setError('Há período com horário inválido (o fim precisa ser depois do início).');
      return;
    }
    setError('');
    await onSubmit(valid);
  }

  return (
    <div>
      <div className="space-y-2">
        {DAYS.map((label, i) => (
          <div key={label} className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => toggleDay(i)}
              aria-pressed={days[i].length > 0}
              className={cn(
                'w-14 shrink-0 text-xs font-bold py-2 rounded-md border',
                days[i].length ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-zinc-200 text-zinc-400',
              )}
            >
              {label}
            </button>
            {days[i].length === 0 ? (
              <span className="text-xs text-zinc-400 py-2">Fechado</span>
            ) : (
              <div className="space-y-2 flex-1 min-w-0">
                {days[i].map((p, j) => (
                  <span key={j} className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="time" value={p.start} onChange={(e) => setPeriod(i, j, { start: e.target.value })} className={inputCls} aria-label={`${label} início`} />
                    <span className="text-zinc-400 text-xs">até</span>
                    <input type="time" value={p.end} onChange={(e) => setPeriod(i, j, { end: e.target.value })} className={inputCls} aria-label={`${label} fim`} />
                    <select value={p.slotMin} onChange={(e) => setPeriod(i, j, { slotMin: Number(e.target.value) })} className={inputCls} aria-label={`${label} intervalo`}>
                      {SLOT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {days[i].length > 1 && (
                      <button type="button" onClick={() => removePeriod(i, j)} className="text-zinc-400 hover:text-red-500 px-1" aria-label={`Remover período de ${label}`}>
                        <Icon n="x" size={14} />
                      </button>
                    )}
                  </span>
                ))}
                {days[i].length < 3 && (
                  <button type="button" onClick={() => addPeriod(i)} className="text-xs font-semibold text-emerald-700 hover:underline">+ período (ex: almoço separado)</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="text-xs font-semibold text-red-600 mt-3">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button type="button" onClick={submit} disabled={saving} className={btnDark}>{saving ? 'Salvando…' : (submitLabel || 'Salvar horários')}</button>
        {footer}
      </div>
    </div>
  );
}

// ── Painel completo (horário geral + por profissional) ──
export function BusinessHoursPanel({ businessId, professionals, rules, onChanged }: {
  businessId: string;
  professionals: Professional[];
  rules: Availability[];
  /** Recarrega os dados da tela após qualquer mutação bem-sucedida. */
  onChanged: () => void;
}) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(''); // '' | 'business' | professionalId
  const [applyAsk, setApplyAsk] = useState(false);
  const [inheritAsk, setInheritAsk] = useState<Professional | null>(null);

  const impact = useMemo(() => businessHoursChangeImpact(professionals, rules), [professionals, rules]);
  const plan = useMemo(() => planApplyBusinessHoursToAll(professionals, rules), [professionals, rules]);
  const summaries = useMemo(() => professionals.map((p) => professionalHoursSummary(p, rules)), [professionals, rules]);

  async function send(action: string, payload: Record<string, any>, key: string): Promise<{ ok: boolean; message?: string }> {
    setBusy(key);
    setNotice(null);
    const res = await apiSend<{ message?: string }>('/api/catalog', 'POST', { businessId, action, ...payload }, { scope: 'action', area: 'Serviços' });
    setBusy('');
    if (!res.ok) {
      // 403 → mensagem amigável nesta tela (a sessão continua intacta).
      setNotice(res.denied
        ? { tone: 'denied', text: res.denied.title, hint: res.denied.hint }
        : { tone: 'error', text: res.message || 'Não foi possível salvar os horários.' });
      return { ok: false };
    }
    onChanged();
    return { ok: true, message: res.data?.message };
  }

  async function saveBusiness(windows: DayWindow[]) {
    const res = await send('availability.save', { scope: { professionalId: '' }, rules: windows }, 'business');
    if (res.ok) {
      setEditing('');
      setNotice({
        tone: 'ok',
        text: impact.following.length > 0
          ? `Horário da empresa salvo. ${impact.following.length === 1 ? 'Atualizado automaticamente' : 'Atualizados automaticamente'}: ${impact.followingNames.join(', ')}.`
          : 'Horário da empresa salvo.',
        hint: impact.custom.length > 0 ? `Quem tem horário personalizado não foi alterado (${impact.customNames.join(', ')}).` : undefined,
      });
    }
  }

  async function saveProfessional(pro: Professional, windows: DayWindow[]) {
    const res = await send('professional.hours', { id: pro.id, follow: false, rules: windows }, pro.id);
    if (res.ok) {
      setEditing('');
      setNotice({ tone: 'ok', text: `Horário personalizado de ${pro.name} salvo. Ele deixa de seguir o horário da empresa.` });
    }
  }

  async function followBusiness(pro: Professional) {
    const res = await send('professional.hours', { id: pro.id, follow: true }, `follow-${pro.id}`);
    setInheritAsk(null);
    if (res.ok) setNotice({ tone: 'ok', text: `${pro.name} voltou a seguir o horário da empresa.` });
  }

  async function applyToAll() {
    const res = await send('availability.applyToAll', {}, 'apply');
    setApplyAsk(false);
    if (res.ok) setNotice({ tone: 'ok', text: res.message || 'Horário da empresa aplicado.' });
  }

  const general = businessRules(rules);

  return (
    <div className="space-y-4">
      {notice && (
        notice.tone === 'denied'
          ? <PermissionNotice message={notice.text} hint={notice.hint} onDismiss={() => setNotice(null)} />
          : (
            <div className={cn('flex items-start gap-2 rounded-md border px-3 py-2.5', notice.tone === 'ok' ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')} role="status" aria-live="polite">
              <Icon n={notice.tone === 'ok' ? 'check' : 'alert'} size={15} className={notice.tone === 'ok' ? 'text-emerald-700 mt-0.5' : 'text-red-600 mt-0.5'} />
              <div className="min-w-0 flex-1">
                <p className={cn('text-xs font-semibold', notice.tone === 'ok' ? 'text-emerald-900' : 'text-red-700')}>{notice.text}</p>
                {notice.hint && <p className="text-[11px] text-zinc-600 mt-0.5">{notice.hint}</p>}
              </div>
              <button onClick={() => setNotice(null)} aria-label="Fechar aviso" className="text-zinc-400 hover:text-zinc-700 shrink-0"><Icon n="x" size={13} /></button>
            </div>
          )
      )}

      {/* ── 1. Horário geral da empresa ── */}
      <section className="bg-white border border-zinc-200 rounded-lg p-5" aria-labelledby="bh-general">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="bh-general" className="font-semibold text-sm">Horário da empresa</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Estes são os períodos em que vocês atendem. Quem segue o horário da empresa é atualizado automaticamente quando você altera aqui.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {professionals.length > 0 && (
              <button type="button" onClick={() => { setApplyAsk(true); setNotice(null); }} className={btnGhost} disabled={busy === 'apply'}>
                Aplicar a todos
              </button>
            )}
            <button type="button" onClick={() => setEditing((v) => (v === 'business' ? '' : 'business'))} className={btnGhost}>
              {editing === 'business' ? 'Fechar' : 'Editar horário'}
            </button>
          </div>
        </div>

        {editing === 'business' ? (
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <DayHoursList
              key={`business-${general.length}`}
              initial={general}
              saving={busy === 'business'}
              onSubmit={saveBusiness}
              footer={<button type="button" onClick={() => setEditing('')} className={btnGhost}>Cancelar</button>}
            />
          </div>
        ) : (
          <p className="text-sm font-medium text-zinc-800 mt-3">{hoursSummaryLine(general)}</p>
        )}

        {professionals.length > 0 && (
          <div className="mt-4 border-t border-zinc-100 pt-3 space-y-1">
            <p className="text-xs text-zinc-600">
              <strong className="font-semibold">{impact.following.length}</strong> {impact.following.length === 1 ? 'profissional segue' : 'profissionais seguem'} este horário
              {impact.followingNames.length > 0 && <> ({impact.followingNames.join(', ')})</>}
              {' '}— alterações aqui valem para eles automaticamente.
            </p>
            {impact.custom.length > 0 && (
              <p className="text-xs text-zinc-500">
                <strong className="font-semibold">{impact.custom.length}</strong> com horário personalizado não {impact.custom.length === 1 ? 'é afetado' : 'são afetados'}: {impact.customNames.join(', ')}.
              </p>
            )}
          </div>
        )}

        {applyAsk && (
          <div className="mt-4 border border-zinc-300 rounded-md p-4 bg-zinc-50" role="dialog" aria-label="Aplicar horário a todos">
            <p className="text-sm font-semibold">Aplicar o horário da empresa a todos?</p>
            <p className="text-xs text-zinc-600 mt-1">{plan.confirmation}</p>
            <ul className="text-xs text-zinc-600 mt-2 space-y-1">
              <li><strong className="font-semibold">{plan.update.length}</strong> {plan.update.length === 1 ? 'vai seguir' : 'vão seguir'} o horário da empresa{plan.updateNames.length > 0 && <> ({plan.updateNames.join(', ')})</>}.</li>
              {plan.skip.length > 0 && (
                <li><strong className="font-semibold">{plan.skip.length}</strong> com horário personalizado {plan.skip.length === 1 ? 'não será alterado' : 'não serão alterados'} ({plan.skipNames.join(', ')}).</li>
              )}
            </ul>
            <div className="flex gap-2 mt-3">
              <button type="button" onClick={applyToAll} disabled={busy === 'apply'} className={btnDark}>{busy === 'apply' ? 'Aplicando…' : 'Aplicar'}</button>
              <button type="button" onClick={() => setApplyAsk(false)} className={btnGhost}>Cancelar</button>
            </div>
          </div>
        )}
      </section>

      {/* ── 2. Horário por profissional (lista simples) ── */}
      {professionals.length > 0 && (
        <section className="bg-white border border-zinc-200 rounded-lg" aria-labelledby="bh-team">
          <div className="px-5 py-4 border-b border-zinc-100">
            <h3 id="bh-team" className="font-semibold text-sm">Horário por profissional</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Todo profissional começa seguindo o horário da empresa. Personalize apenas quem atende em horários diferentes.</p>
          </div>
          <ul className="divide-y divide-zinc-100">
            {summaries.map((s) => {
              const pro = professionals.find((p) => p.id === s.id);
              if (!pro) return null;
              const isOpen = editing === s.id;
              const inherited = s.origin === 'inherited';
              // Ponto de partida da personalização: cópia do horário atual
              // (nunca uma agenda vazia, que derrubaria todos os horários).
              const seed = followTogglePatch({ follow: false, rules, professionalId: s.id }).rules;
              return (
                <li key={s.id} className={cn('px-5 py-3.5', pro.active === false && 'opacity-60')}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-zinc-900 flex flex-wrap items-center gap-2">
                        {s.name}
                        <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border', inherited ? 'border-zinc-200 bg-zinc-50 text-zinc-600' : 'border-blue-200 bg-blue-50 text-blue-700')}>
                          {inherited ? 'Segue a empresa' : 'Personalizado'}
                        </span>
                        {pro.active === false && <span className="text-[11px] font-medium text-zinc-400">inativo</span>}
                      </p>
                      <p className="text-xs text-zinc-500 mt-0.5">{s.summary}</p>
                      {s.daysOff.length > 0 && (
                        <p className="text-[11px] text-zinc-400 mt-0.5">Não atende: {s.daysOff.map((d) => DAYS[d]).join(', ')}</p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button type="button" onClick={() => { setEditing(isOpen ? '' : s.id); setNotice(null); }} className={btnGhost} disabled={busy === s.id}>
                        {isOpen ? 'Fechar' : s.actionLabel}
                      </button>
                      {!inherited && (
                        <button type="button" onClick={() => { setInheritAsk(pro); setNotice(null); }} className={btnGhost} disabled={busy === `follow-${s.id}`}>
                          Seguir a empresa
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3 border-t border-zinc-100 pt-4">
                      <p className="text-xs text-zinc-600 mb-3">
                        {inherited
                          ? <>Salvar cria um <strong className="font-semibold">horário personalizado</strong> para {s.name} a partir do horário da empresa. Ele deixa de acompanhar as alterações gerais.</>
                          : <>Você está editando o horário personalizado de {s.name}. Para voltar ao horário da empresa, use “Seguir a empresa”.</>}
                      </p>
                      <DayHoursList
                        key={`${s.id}-${seed.length}-${customRulesFor(s.id, rules).length}`}
                        initial={seed.map((w) => ({ id: '', businessId, professionalId: s.id, serviceId: '', weekday: w.weekday, start: w.start, end: w.end, slotMin: w.slotMin }) as Availability)}
                        saving={busy === s.id}
                        submitLabel="Salvar horário personalizado"
                        onSubmit={(windows) => saveProfessional(pro, windows)}
                        footer={<button type="button" onClick={() => setEditing('')} className={btnGhost}>Cancelar</button>}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {inheritAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Voltar a seguir o horário da empresa">
          <div className="absolute inset-0 bg-[var(--overlay)]" onClick={() => busy !== `follow-${inheritAsk.id}` && setInheritAsk(null)} />
          <div className="relative w-full sm:max-w-sm bg-white rounded-lg border border-zinc-200 p-5 shadow-lg">
            <p className="font-semibold text-sm">{inheritAsk.name} vai seguir o horário da empresa?</p>
            <p className="text-xs text-zinc-600 mt-1.5">
              O horário personalizado dele será removido e ele passa a atender no horário geral ({hoursSummaryLine(general)}), incluindo as próximas alterações que você fizer lá.
            </p>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => followBusiness(inheritAsk)} disabled={busy === `follow-${inheritAsk.id}`} className={cn(btnDark, 'flex-1')}>
                {busy === `follow-${inheritAsk.id}` ? 'Salvando…' : 'Seguir horário da empresa'}
              </button>
              <button type="button" onClick={() => setInheritAsk(null)} className={btnGhost} disabled={busy === `follow-${inheritAsk.id}`}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
