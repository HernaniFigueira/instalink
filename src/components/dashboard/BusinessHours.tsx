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
import { Avatar, Button, HoursChips, IconButton, Notice, buttonCls } from '@/components/ui';
import { apiSend } from '@/lib/api-client';
import { PermissionNotice } from './AccessNotice';
import {
  businessHoursChangeImpact, businessHoursTable, businessRules, customRulesFor, followTogglePatch,
  hoursTable, planApplyBusinessHoursToAll, professionalHoursSummary, professionalHoursTable,
  sanitizeWindows,
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

/** Aviso local da tela (o componente visual é o `Notice` do design system). */
interface NoticeInfo { tone: 'ok' | 'error' | 'denied'; text: string; hint?: string }

const inputCls = 'rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)] focus:outline-none focus:shadow-focus';
/* A3.4: os botões desta tela usam a MESMA linguagem do design system. As
   classes vêm de `buttonCls` (fonte única), não de um estilo paralelo. */
const btnGhost = buttonCls('secondary', 'sm');
const btnDark = buttonCls('primary', 'sm');

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
                'w-14 shrink-0 text-xs font-semibold py-2 rounded-md border',
                days[i].length ? 'bg-[var(--brand)] border-[var(--brand)] text-white' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-faint)]',
              )}
            >
              {label}
            </button>
            {days[i].length === 0 ? (
              <span className="text-xs text-[var(--text-faint)] py-2">Fechado</span>
            ) : (
              <div className="space-y-2 flex-1 min-w-0">
                {days[i].map((p, j) => (
                  <span key={j} className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="time" value={p.start} onChange={(e) => setPeriod(i, j, { start: e.target.value })} className={inputCls} aria-label={`${label} início`} />
                    <span className="text-[var(--text-faint)] text-xs">até</span>
                    <input type="time" value={p.end} onChange={(e) => setPeriod(i, j, { end: e.target.value })} className={inputCls} aria-label={`${label} fim`} />
                    <select value={p.slotMin} onChange={(e) => setPeriod(i, j, { slotMin: Number(e.target.value) })} className={inputCls} aria-label={`${label} intervalo`}>
                      {SLOT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {days[i].length > 1 && (
                      <button type="button" onClick={() => removePeriod(i, j)} className="text-[var(--text-faint)] hover:text-[var(--danger)] px-1" aria-label={`Remover período de ${label}`}>
                        <Icon n="x" size={14} />
                      </button>
                    )}
                  </span>
                ))}
                {days[i].length < 3 && (
                  <button type="button" onClick={() => addPeriod(i)} className="text-xs font-semibold text-[var(--brand-fg)] hover:underline">+ período (ex: almoço separado)</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <Notice tone="error" className="mt-3">{error}</Notice>}
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
  const [notice, setNotice] = useState<NoticeInfo | null>(null);
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
            /* A3.4: mesmo aviso do design system (nada de caixa paralela). */
            <div className="flex items-start gap-2" role="status" aria-live="polite">
              <Notice tone={notice.tone === 'ok' ? 'success' : 'error'} className="flex-1">
                <span className="font-semibold">{notice.text}</span>
                {notice.hint && <span className="block text-[11px] font-normal mt-0.5">{notice.hint}</span>}
              </Notice>
              <IconButton icon="x" label="Fechar aviso" size="sm" variant="ghost" onClick={() => setNotice(null)} />
            </div>
          )
      )}

      {/* ── 1. Horário geral da empresa ── */}
      <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-5 shadow-xs" aria-labelledby="bh-general">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="bh-general" className="font-semibold text-sm">Horário da empresa</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
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
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <DayHoursList
              key={`business-${general.length}`}
              initial={general}
              saving={busy === 'business'}
              onSubmit={saveBusiness}
              footer={<button type="button" onClick={() => setEditing('')} className={btnGhost}>Cancelar</button>}
            />
          </div>
        ) : (
          /* A3.4: chips por dia — "SEG 08:00 → 20:00" um por vez. A linha
             corrida ("Seg 08:00 — 20:00 · Ter 08:00 — …") era ilegível de
             relance e é o que o lojista mais precisa conferir nesta tela. */
          <div className="mt-3">
            <HoursChips days={businessHoursTable(rules)} />
          </div>
        )}

        {professionals.length > 0 && (
          <div className="mt-4 border-t border-[var(--border)] pt-3 space-y-1">
            <p className="text-xs text-[var(--text-muted)]">
              <strong className="font-semibold">{impact.following.length}</strong> {impact.following.length === 1 ? 'profissional segue' : 'profissionais seguem'} este horário
              {impact.followingNames.length > 0 && <> ({impact.followingNames.join(', ')})</>}
              {' '}— alterações aqui valem para eles automaticamente.
            </p>
            {impact.custom.length > 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                <strong className="font-semibold">{impact.custom.length}</strong> com horário personalizado não {impact.custom.length === 1 ? 'é afetado' : 'são afetados'}: {impact.customNames.join(', ')}.
              </p>
            )}
          </div>
        )}

        {applyAsk && (
          <div className="mt-4 border border-[var(--border-strong)] rounded-md p-4 bg-[var(--surface-3)]" role="dialog" aria-label="Aplicar horário a todos">
            <p className="text-sm font-semibold">Aplicar o horário da empresa a todos?</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{plan.confirmation}</p>
            <ul className="text-xs text-[var(--text-muted)] mt-2 space-y-1">
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
        <section className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xs" aria-labelledby="bh-team">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 id="bh-team" className="font-semibold text-sm">Horário por profissional</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Todo profissional começa seguindo o horário da empresa. Personalize apenas quem atende em horários diferentes.</p>
          </div>
          <ul className="divide-y divide-[var(--border)]">
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
                    <Avatar name={s.name} src={pro.photo || undefined} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--text)] flex flex-wrap items-center gap-2">
                        {s.name}
                        <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border', inherited ? 'border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-muted)]' : 'border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-fg)]')}>
                          {inherited ? 'Segue a empresa' : 'Personalizado'}
                        </span>
                        {pro.active === false && <span className="text-[11px] font-medium text-[var(--text-faint)]">inativo</span>}
                      </p>
                      {/* A3.4: o horário efetivo do profissional nos MESMOS chips
                          usados para a empresa — comparar deixa de exigir leitura
                          de duas frases diferentes. */}
                      <HoursChips className="mt-1.5" size="sm" days={professionalHoursTable(pro, rules)} />
                      {s.daysOff.length > 0 && (
                        <p className="text-[11px] text-[var(--text-faint)] mt-1">Não atende: {s.daysOff.map((d) => DAYS[d]).join(', ')}</p>
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
                    <div className="mt-3 border-t border-[var(--border)] pt-4">
                      <p className="text-xs text-[var(--text-muted)] mb-3">
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
          <div className="relative w-full sm:max-w-sm bg-[var(--surface)] rounded-lg border border-[var(--border)] p-5 shadow-xl">
            <p className="font-semibold text-sm">{inheritAsk.name} vai seguir o horário da empresa?</p>
            <p className="text-xs text-[var(--text-muted)] mt-1.5">
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
