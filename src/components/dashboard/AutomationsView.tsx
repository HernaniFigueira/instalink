'use client';
// ═══════════════════════════════════════════════════════════════
// P4.10 — TELA DE AUTOMAÇÕES (simples por fora, grafo por dentro)
// ═══════════════════════════════════════════════════════════════
// O lojista monta "Quando → Se → Então → Depois → Senão". Nada de arrastar
// nós, nada de expressão: a tela escreve a projeção LINEAR e a API compila
// para o grafo (que é o modelo canônico — pronto para um editor visual ou para
// o agente do P5 gerarem a MESMA estrutura).
//
// O que a tela mostra é sempre o que o motor FEZ: estatísticas por automação,
// histórico de execuções passo a passo com o veredito de cada condição e as
// tarefas que nasceram delas. Nenhum número é decorativo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AreaLoadError } from './AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { Badge, Button, Card, Drawer, EmptyState, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea } from '@/components/ui';
import { Icon } from '@/components/icons';
import { cn } from '@/lib/utils';
import {
  AUTOMATION_ACTION_DEFS, AUTOMATION_EVENT_DEFS, CONDITION_OPERATORS, WAIT_MINUTE_PRESETS,
  automationActionDef, automationEventLabel, automationFieldLabel, describeCondition,
  fieldsForEvent, humanDuration, type LinearStep,
} from '@/lib/automation/ui';
import { useRevalidateOnFocus } from '@/components/dashboard/use-revalidate';
import { AiAutomations } from '@/components/dashboard/AiAutomations';
// Execuções e tarefas são componentes próprios (portas /execucoes e /tarefas):
// a tela de Automações continua mostrando os dois, mas a definição de como se
// lê uma execução e de como se opera uma tarefa existe em UM lugar só.
import { RunStatusBadge, formatWhen, type RunView } from '@/components/dashboard/RunsPanel';

interface ConditionRow { field: string; operator: string; value: string }
interface Group { logic: 'and' | 'or'; invert: boolean; rows: ConditionRow[] }
interface Step {
  id: string;
  kind: 'action' | 'wait';
  label: string;
  type: string;
  params: Record<string, any>;
  waitMinutes: number;
  waitUntil: string;
}

interface AutomationView {
  id: string;
  name: string;
  description: string;
  active: boolean;
  event: string;
  eventLabel: string;
  templateId: string;
  version: number;
  settings: Record<string, any>;
  summary: string;
  linear: { event: string; condition: any; steps: LinearStep[]; elseSteps: LinearStep[] } | null;
  stats: { runs: number; live: number; waiting: number; completed: number; failed: number; lastRunAt: string; lastStatus: string; lastError: string };
  issues: string[];
}

interface TemplateOffer {
  id: string; name: string; description: string; event: string; tags: string[];
  applicable: boolean; reason: string;
  preview: { when: string; ifText: string; thens: string[]; elseTexts: string[] };
}

interface Options {
  stages: { id: string; name: string }[];
  services: { id: string; name: string }[];
  members: { userId: string; name: string }[];
}

let stepSeq = 0;
function nextStepId(): string {
  stepSeq += 1;
  return `s_${Date.now().toString(36)}_${stepSeq}`;
}

// ── projeção linear ⇄ estado do editor ──────────────────────
function groupFromCondition(condition: any): Group {
  if (!condition || !Array.isArray(condition.conditions)) return { logic: 'and', invert: false, rows: [] };
  const logic = condition.logic === 'or' ? 'or' : 'and';
  if (condition.logic === 'not') {
    const inner = condition.conditions[0];
    const g = groupFromCondition(inner);
    return { ...g, invert: true };
  }
  return {
    logic,
    invert: false,
    rows: condition.conditions.map((c: any) => ({
      field: String(c?.field || ''),
      operator: String(c?.operator || 'equals'),
      value: c?.value === undefined || c?.value === null ? '' : String(c.value),
    })),
  };
}

function conditionFromGroup(group: Group): any {
  const rows = group.rows.filter((r) => r.field).map((r) => ({
    field: r.field,
    operator: r.operator,
    ...(['exists', 'not_exists'].includes(r.operator) ? {} : { value: r.value }),
  }));
  if (rows.length === 0) return null;
  const base = { logic: group.logic, conditions: rows };
  return group.invert ? { logic: 'not', conditions: [base] } : base;
}

function stepsFromLinear(steps: LinearStep[] = []): Step[] {
  return steps.map((s) => {
    if (s.kind === 'wait') {
      return {
        id: nextStepId(), kind: 'wait', label: s.label || 'Esperar',
        type: '', params: {},
        waitMinutes: Number(s.wait?.minutes || 0),
        waitUntil: s.wait?.mode === 'until' ? String(s.wait.at || '') : '',
      };
    }
    const action = (s as any).action || {};
    return {
      id: nextStepId(), kind: 'action', label: s.label || '',
      type: String(action.type || ''),
      params: { ...(action.params || {}) },
      waitMinutes: 0, waitUntil: '',
    };
  });
}

function linearToApiSteps(steps: Step[]): any[] {
  return steps.map((s) => s.kind === 'wait'
    ? {
      kind: 'wait', label: s.label || 'Esperar',
      wait: s.waitUntil
        ? { mode: 'until', at: s.waitUntil.replace(' ', 'T').slice(0, 16) }
        : { mode: 'duration', minutes: Number(s.waitMinutes) || 0 },
    }
    : {
      kind: 'action',
      label: s.label || automationActionDef(s.type)?.short || 'Ação',
      action: { type: s.type, params: s.params },
    });
}

export function AutomationsView() {
  const { businessId, noBusiness } = useBusinessId();
  // 'runs' e 'tasks' não são mais abas: viraram portas próprias (/execucoes e
  // /tarefas). Uma porta por conceito — aqui fica só o atalho contextual.
  const [tab, setTab] = useState<'list' | 'ai' | 'templates'>('list');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [automations, setAutomations] = useState<AutomationView[]>([]);
  const [templates, setTemplates] = useState<TemplateOffer[]>([]);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [options, setOptions] = useState<Options>({ stages: [], services: [], members: [] });
  const [limits, setLimits] = useState<any>(null);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null); // id | 'new'
  const [historyOf, setHistoryOf] = useState<AutomationView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AutomationView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/automations?businessId=${businessId}`, { scope: 'area', area: 'Automações' });
    if (!res.ok) { setLoadError(res.message || 'Falha de conexão.'); setLoading(false); return; }
    setLoadError('');
    setError('');
    setAutomations(res.data?.automations || []);
    setTemplates(res.data?.templates || []);
    setRuns(res.data?.recentRuns || []);
    setOptions(res.data?.options || { stages: [], services: [], members: [] });
    setLimits(res.data?.limits || null);
    setCapabilities(res.data?.capabilities || {});
    setLoading(false);
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);
  useRevalidateOnFocus(() => { void load(); });

  async function toggle(a: AutomationView) {
    const res = await apiSend('/api/automations', 'POST', { businessId, action: 'toggle', id: a.id, active: !a.active });
    if (!res.ok) { setError(res.message); return; }
    setNotice(a.active ? `“${a.name}” desligada.` : `“${a.name}” ligada.`);
    setAutomations((prev) => prev.map((x) => (x.id === a.id ? { ...x, active: !a.active } : x)));
  }

  async function duplicate(a: AutomationView) {
    const res = await apiSend('/api/automations', 'POST', { businessId, action: 'duplicate', id: a.id });
    if (!res.ok) { setError(res.message); return; }
    setNotice('Cópia criada desligada — revise antes de ligar.');
    await load();
  }

  async function remove(a: AutomationView) {
    const res = await apiSend('/api/automations', 'DELETE', { businessId, id: a.id });
    setConfirmDelete(null);
    if (!res.ok) { setError(res.message); return; }
    setNotice(`“${a.name}” excluída. O histórico das execuções continua aqui.`);
    await load();
  }

  async function createFromTemplate(t: TemplateOffer) {
    setBusy(true);
    const res = await apiSend('/api/automations', 'POST', { businessId, templateId: t.id });
    setBusy(false);
    if (!res.ok) { setError(res.message || 'Não foi possível criar a automação.'); return; }
    setNotice(`“${t.name}” criada. Ajuste o que quiser e ative.`);
    setTab('list');
    await load();
  }

  async function runQueueNow() {
    setBusy(true);
    let total = 0;
    for (const a of automations) {
      await apiSend(`/api/automations/${a.id}?businessId=${businessId}`, 'POST', { businessId, action: 'drain' });
      total += 1;
    }
    setBusy(false);
    setNotice(total ? `Fila processada (${total} automações verificadas).` : 'Nada na fila para processar.');
    await load();
  }

  const activeCount = automations.filter((a) => a.active).length;

  if (noBusiness) {
    return <Notice tone="info">Crie sua empresa primeiro para configurar automações.</Notice>;
  }

  const unitQuery = businessId ? `?b=${businessId}` : '';

  if (loadError) return <AreaLoadError area="Automações" message={loadError} onRetry={load} />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Automações"
        hint="Quando acontecer X, se Y, faça Z. O sistema trabalha sozinho nos bastidores — nada aqui envia mensagem por conta própria."
        action={(
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={runQueueNow} disabled={busy || !automations.length}>
              <Icon n="sync" size={14} /> Processar fila
            </Button>
            <Button size="sm" onClick={() => { setEditing('new'); setTab('list'); }}>
              <Icon n="plus" size={14} /> Nova automação
            </Button>
          </div>
        )}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {([['list', 'Minhas automações', automations.length], ['ai', 'Criar com IA', ''],
          ['templates', 'Começar de um modelo', templates.length]] as const).map(([key, label, count]) => (
          <button key={key} onClick={() => setTab(key as 'list' | 'ai' | 'templates')}
            aria-pressed={tab === key} className="il-chip">
            {label}{typeof count === 'number' && count > 0 ? ` · ${count}` : ''}
          </button>
        ))}

        {/* Atalhos contextuais para as portas que NASCERAM destas abas. Não são
            abas: são destinos do catálogo (Execuções fica fora do menu, Tarefas
            está em Operação). O destino é único — nada de segunda cópia aqui. */}
        <Link href={`/execucoes${unitQuery}`}
          className="ml-auto px-3 py-1.5 rounded-full border font-semibold transition bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50 inline-flex items-center gap-1.5">
          Execuções{runs.length > 0 ? ` · ${runs.length}` : ''} <Icon n="external" size={11} />
        </Link>
        <Link href={`/tarefas${unitQuery}`}
          className="px-3 py-1.5 rounded-full border font-semibold transition bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50 inline-flex items-center gap-1.5">
          Tarefas <Icon n="external" size={11} />
        </Link>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {capabilities['automation.basic'] === false && (
        <Notice tone="info">As automações estão desligadas para esta empresa. Nada será executado até o recurso ser liberado.</Notice>
      )}

      {tab === 'ai' && (
        <AiAutomations
          businessId={businessId}
          onPublished={(message) => { setNotice(message); setTab('list'); void load(); }}
        />
      )}

      {tab === 'list' && (loading ? <Skeleton className="h-40" /> : (
        <div className="space-y-3">
          {!automations.length && (
            <EmptyState
              title="Nenhuma automação ainda"
              hint="Descreva o que você quer em uma frase, comece de um modelo pronto, ou crie a sua: um gatilho, uma condição e uma ação já resolvem a maioria dos casos."
              action={(
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" onClick={() => setTab('ai')}>Criar com IA</Button>
                  <Button size="sm" variant="secondary" onClick={() => setTab('templates')}>Ver modelos</Button>
                </div>
              )}
            />
          )}
          {automations.length > 0 && (
            <p className="text-xs text-zinc-500">
              {activeCount} de {automations.length} ativas
              {limits ? ` · até ${limits.maxAutomations} por empresa · máx. ${limits.maxStepsPerRun} passos por execução` : ''}
            </p>
          )}
          {automations.map((a) => (
            <AutomationCard key={a.id} a={a}
              onToggle={() => toggle(a)} onEdit={() => setEditing(a.id)}
              onDuplicate={() => duplicate(a)} onHistory={() => setHistoryOf(a)} onDelete={() => setConfirmDelete(a)} />
          ))}
          {confirmDelete && (
            <ConfirmDelete name={confirmDelete.name} onCancel={() => setConfirmDelete(null)} onConfirm={() => remove(confirmDelete)} />
          )}
        </div>
      ))}

      {tab === 'templates' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => (
            <Card key={t.id} className="p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-zinc-900">{t.name}</h3>
                <Badge tone={t.applicable ? 'green' : 'amber'}>{t.applicable ? 'aplicável' : 'bloqueada'}</Badge>
              </div>
              <p className="text-xs text-zinc-600">{t.description}</p>
              <ul className="text-[11px] text-zinc-500 space-y-0.5 border-t border-zinc-100 pt-2">
                <li><span className="font-semibold text-zinc-700">Quando:</span> {t.preview.when}</li>
                {t.preview.ifText && <li><span className="font-semibold text-zinc-700">Se:</span> {t.preview.ifText}</li>}
                {t.preview.thens.map((x, i) => <li key={i}><span className="font-semibold text-zinc-700">{i === 0 ? 'Então:' : 'Depois:'}</span> {x}</li>)}
                {t.preview.elseTexts.map((x, i) => <li key={`e${i}`}><span className="font-semibold text-zinc-700">Senão:</span> {x}</li>)}
              </ul>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {t.tags.map((tag) => <span key={tag} className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 bg-zinc-100 rounded px-1.5 py-0.5">{tag}</span>)}
              </div>
              {!t.applicable && <p className="text-[11px] text-amber-800">{t.reason}</p>}
              <div className="mt-auto pt-1">
                <Button size="sm" variant={t.applicable ? 'primary' : 'secondary'} disabled={!t.applicable || busy} onClick={() => createFromTemplate(t)}>
                  Usar este modelo
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <AutomationEditor
          businessId={businessId}
          automationId={editing === 'new' ? null : editing}
          automations={automations}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={(message) => { setEditing(null); setNotice(message); void load(); }}
        />
      )}

      {historyOf && <HistorySheet automation={historyOf} businessId={businessId} onClose={() => setHistoryOf(null)} />}
    </div>
  );
}

function AutomationCard({ a, onToggle, onEdit, onDuplicate, onHistory, onDelete }: {
  a: AutomationView; onToggle: () => void; onEdit: () => void; onDuplicate: () => void; onHistory: () => void; onDelete: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <button onClick={onToggle} role="switch" aria-checked={a.active} aria-label={a.active ? 'Desativar automação' : 'Ativar automação'}
          className={cn('mt-0.5 w-10 h-6 rounded-full transition shrink-0 border',
            a.active ? 'bg-emerald-600 border-emerald-700' : 'bg-zinc-200 border-zinc-300')}>
          <span className={cn('block w-4.5 h-4.5 rounded-full bg-white shadow transition-transform', a.active ? 'translate-x-[22px]' : 'translate-x-[3px]')}
            style={{ width: 18, height: 18 }} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 truncate">{a.name}</h3>
            {!a.active && <Badge tone="zinc">inativa</Badge>}
            {a.stats.waiting > 0 && <Badge tone="amber">{a.stats.waiting} aguardando</Badge>}
            {a.stats.failed > 0 && <Badge tone="red">{a.stats.failed} com erro</Badge>}
            {a.templateId && <Badge tone="blue">modelo</Badge>}
          </div>
          <p className="text-xs text-zinc-600 mt-1">{a.summary}</p>
          {a.description && <p className="text-xs text-zinc-400 mt-1">{a.description}</p>}
          {a.issues.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Revisar: {a.issues.slice(0, 2).join(' · ')}
            </p>
          )}
          <p className="text-[11px] text-zinc-400 mt-2">
            {a.stats.runs ? `${a.stats.runs} execuções · ` : 'sem execuções · '}
            {a.stats.lastRunAt ? `última ${formatWhen(a.stats.lastRunAt)}` : '—'}
            {a.stats.lastError ? ` · ${a.stats.lastError}` : ''}
          </p>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <Button size="sm" variant="secondary" onClick={onEdit}>Editar</Button>
          <Button size="sm" variant="ghost" onClick={onHistory}>Histórico</Button>
          <div className="flex gap-1">
            <button onClick={onDuplicate} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 px-1">Duplicar</button>
            <button onClick={onDelete} className="text-[11px] font-semibold text-zinc-500 hover:text-red-700 px-1">Excluir</button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ConfirmDelete({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="border border-red-200 bg-red-50 rounded-lg p-4">
      <p className="text-sm font-semibold text-red-900">Excluir “{name}”?</p>
      <p className="text-xs text-red-800 mt-1">
        A automação para de receber gatilhos e as execuções em espera são encerradas. O histórico das execuções
        e tudo o que ela já fez (leads, tarefas, agendamentos) continua intacto.
      </p>
      <div className="flex gap-2 mt-3">
        <Button size="sm" variant="danger" onClick={onConfirm}>Sim, excluir</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

// ── editor linear ───────────────────────────────────────────
function AutomationEditor({ businessId, automationId, automations, options, onClose, onSaved }: {
  businessId: string;
  automationId: string | null;
  automations: AutomationView[];
  options: Options;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const current = automationId ? automations.find((a) => a.id === automationId) || null : null;
  const [name, setName] = useState(current?.name || '');
  const [description, setDescription] = useState(current?.description || '');
  const [active, setActive] = useState(current ? current.active : true);
  const [event, setEvent] = useState<string>(current?.event || 'lead.created');
  const [group, setGroup] = useState<Group>(groupFromCondition(current?.linear?.condition));
  const [steps, setSteps] = useState<Step[]>(stepsFromLinear(current?.linear?.steps));
  const [elseSteps, setElseSteps] = useState<Step[]>(stepsFromLinear(current?.linear?.elseSteps || []));
  const [useElse, setUseElse] = useState((current?.linear?.elseSteps?.length || 0) > 0);
  const [allowReentry, setAllowReentry] = useState(current?.settings?.allowReentry === true);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const graphOnly = !!current && !current.linear;

  const fields = useMemo(() => fieldsForEvent(event as any), [event]);

  // Ao trocar o gatilho, descarta condições/ações que ficaram sem sentido.
  function changeEvent(next: string) {
    setEvent(next);
    const allowed = new Set(fieldsForEvent(next as any).map((f) => f.path));
    setGroup((g) => ({ ...g, rows: g.rows.map((r) => (allowed.has(r.field) ? r : { ...r, field: '' })) }));
  }

  async function save() {
    setSaving(true);
    setErrors([]);
    const payload: Record<string, any> = {
      businessId,
      name,
      description,
      active,
      event,
      condition: conditionFromGroup(group),
      steps: linearToApiSteps(steps),
      settings: { ...(current?.settings || {}), allowReentry },
    };
    if (useElse) payload.elseSteps = linearToApiSteps(elseSteps);
    const res = current
      ? await apiSend(`/api/automations`, 'PATCH', { ...payload, id: current.id })
      : await apiSend(`/api/automations`, 'POST', payload);
    setSaving(false);
    if (!res.ok) {
      const list = Array.isArray(res.data?.errors) ? res.data.errors : [res.message];
      setErrors(list.filter(Boolean));
      return;
    }
    onSaved(current ? 'Automação atualizada.' : 'Automação criada. Ela já começa a valer para os próximos eventos.');
  }

  return (
    <Drawer open onClose={onClose} title={current ? 'Editar automação' : 'Nova automação'} subtitle="Quando acontecer X, se Y, faça Z." width="max-w-3xl">
        <div className="p-4 space-y-4">
          {graphOnly && (
            <Notice tone="info">Esta automação tem um grafo livre (criada por modelo avançado). A edição linear não consegue representá-la sem simplificar — use a API/grafo para alterá-la.</Notice>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lead do Instagram → qualificar" maxLength={80} />
            </Field>
            <Field label="Descrição (opcional)">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que ela faz, em uma linha" maxLength={300} />
            </Field>
          </div>

          <Block label="Quando" hint="O gatilho é um evento real do sistema — nada de esperar mensagem de canal externo.">
            <Select value={event} onChange={(e) => changeEvent(e.target.value)}>
              {AUTOMATION_EVENT_DEFS.map((ev) => (
                <option key={ev.id} value={ev.id}>{ev.label} — {ev.hint}</option>
              ))}
            </Select>
          </Block>

          <Block label="Se" hint="Opcional. Sem condição, a automação roda para todo evento do tipo.">
            <div className="space-y-2">
              {group.rows.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-zinc-400 w-8">{i === 0 ? '' : group.logic === 'or' ? 'ou' : 'e'}</span>
                  <Select className="max-w-[220px]" value={row.field} onChange={(e) => setGroup((g) => ({ ...g, rows: g.rows.map((r, j) => (j === i ? { ...r, field: e.target.value } : r)) }))}>
                    <option value="">Escolher campo…</option>
                    {fields.map((f) => <option key={f.path} value={f.path}>{f.label}</option>)}
                  </Select>
                  <Select className="max-w-[150px]" value={row.operator} onChange={(e) => setGroup((g) => ({ ...g, rows: g.rows.map((r, j) => (j === i ? { ...r, operator: e.target.value } : r)) }))}>
                    {CONDITION_OPERATORS.map((op) => <option key={op} value={op}>{operatorLabel(op)}</option>)}
                  </Select>
                  {!['exists', 'not_exists'].includes(row.operator) && (
                    <ConditionValue row={row} fields={fields}
                      onChange={(value) => setGroup((g) => ({ ...g, rows: g.rows.map((r, j) => (j === i ? { ...r, value } : r)) }))} />
                  )}
                  <button onClick={() => setGroup((g) => ({ ...g, rows: g.rows.filter((_, j) => j !== i) }))}
                    className="text-[11px] font-semibold text-zinc-400 hover:text-red-700" aria-label="Remover condição">×</button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setGroup((g) => ({ ...g, rows: [...g.rows, { field: '', operator: 'equals', value: '' }] }))}
                  className="text-xs font-semibold text-zinc-700 border border-zinc-300 rounded-md px-2.5 py-1.5 hover:bg-zinc-50">+ Condição</button>
                {group.rows.length > 1 && (
                  <Select className="max-w-[140px]" value={group.logic} onChange={(e) => setGroup((g) => ({ ...g, logic: e.target.value as any }))}>
                    <option value="and">todas (E)</option>
                    <option value="or">qualquer (OU)</option>
                  </Select>
                )}
                <label className="text-xs text-zinc-600 inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={group.invert} onChange={(e) => setGroup((g) => ({ ...g, invert: e.target.checked }))} />
                  NÃO é isso
                </label>
              </div>
            </div>
          </Block>

          <StepList label="Então" hint="Ações na ordem. Cada uma usa a função oficial do sistema — a automação não tem caminho paralelo."
            steps={steps} setSteps={setSteps} options={options} event={event} />

          <div className="border-t border-zinc-100 pt-3">
            <label className="text-xs font-semibold text-zinc-700 inline-flex items-center gap-2">
              <input type="checkbox" checked={useElse} onChange={(e) => { setUseElse(e.target.checked); if (e.target.checked && !elseSteps.length) setElseSteps([{ id: nextStepId(), kind: 'action', label: '', type: 'add_lead_note', params: {}, waitMinutes: 0, waitUntil: '' }]); }} />
              Adicionar caminho “Senão” (ramificação)
            </label>
            {useElse && (
              <div className="mt-3">
                <StepList label="Senão" hint="O que fazer quando a condição NÃO é atendida." steps={elseSteps} setSteps={setElseSteps} options={options} event={event} />
              </div>
            )}
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-zinc-600">Avançado (proteções)</summary>
            <div className="mt-2 space-y-2 text-zinc-600">
              <label className="flex items-start gap-2">
                <input className="mt-0.5" type="checkbox" checked={allowReentry} onChange={(e) => setAllowReentry(e.target.checked)} />
                <span>Permitir que as ações desta automação disparem outras automações. Deixe desligado para evitar eco entre automações.</span>
              </label>
              <p>Limites do sistema: execução para sozinha ao atingir o teto de passos, e um ciclo sem espera é recusado na gravação.</p>
            </div>
          </details>

          {errors.length > 0 && (
            <div className="border border-red-200 bg-red-50 rounded-md p-3">
              <p className="text-xs font-semibold text-red-900">Ainda não dá para salvar:</p>
              <ul className="mt-1 text-xs text-red-800 list-disc pl-4">
                {errors.slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-zinc-200 bg-zinc-50 rounded-b-lg">
          <label className="text-xs text-zinc-600 inline-flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Ativa
          </label>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" onClick={save} disabled={saving || !name.trim()}>
              {saving ? 'Salvando…' : 'Salvar automação'}
            </Button>
          </div>
        </div>
    </Drawer>
  );
}

function operatorLabel(op: string): string {
  switch (op) {
    case 'equals': return 'é';
    case 'not_equals': return 'não é';
    case 'contains': return 'contém';
    case 'not_contains': return 'não contém';
    case 'exists': return 'está preenchido';
    case 'not_exists': return 'não existe';
    case 'greater_than': return 'é maior que';
    case 'less_than': return 'é menor que';
    default: return op;
  }
}

function ConditionValue({ row, fields, onChange }: {
  row: ConditionRow;
  fields: { path: string; label: string; type: string; options?: { value: string; label: string }[] }[];
  onChange: (value: string) => void;
}) {
  const def = fields.find((f) => f.path === row.field);
  if (def?.type === 'enum' && def.options?.length) {
    return (
      <Select className="max-w-[180px]" value={row.value} onChange={(e) => onChange(e.target.value)}>
        <option value="">valor…</option>
        {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    );
  }
  return (
    <Input className="max-w-[180px]" value={row.value} onChange={(e) => onChange(e.target.value)}
      placeholder={def?.type === 'number' ? 'número' : 'valor'} />
  );
}

function Block({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border border-zinc-200 rounded-md p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      {hint && <p className="text-[11px] text-zinc-400 mb-2">{hint}</p>}
      <div className={cn(!hint && 'mt-2')}>{children}</div>
    </div>
  );
}

function StepList({ label, hint, steps, setSteps, options, event }: {
  label: string; hint?: string;
  steps: Step[]; setSteps: (next: Step[] | ((prev: Step[]) => Step[])) => void;
  options: Options; event: string;
}) {
  const add = (kind: Step['kind']) => {
    const next: Step = kind === 'wait'
      ? { id: nextStepId(), kind: 'wait', label: 'Esperar', type: '', params: {}, waitMinutes: 120, waitUntil: '' }
      : { id: nextStepId(), kind: 'action', label: '', type: 'add_lead_note', params: {}, waitMinutes: 0, waitUntil: '' };
    setSteps((prev) => [...prev, next]);
  };
  const patch = (id: string, next: Partial<Step>) => setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...next } : s)));
  const move = (index: number, dir: -1 | 1) => setSteps((prev) => {
    const copy = [...prev];
    const to = index + dir;
    if (to < 0 || to >= copy.length) return prev;
    [copy[index], copy[to]] = [copy[to], copy[index]];
    return copy;
  });

  return (
    <Block label={label} hint={hint}>
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={s.id} className="border border-zinc-200 rounded-md p-2.5 bg-zinc-50/50">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 w-14">
                {i === 0 ? label.toLowerCase() : 'depois'}
              </span>
              <Select className="max-w-[260px]" value={s.kind === 'wait' ? '__wait' : s.type}
                onChange={(e) => {
                  if (e.target.value === '__wait') patch(s.id, { kind: 'wait', type: '', params: {}, label: 'Esperar' });
                  else patch(s.id, { kind: 'action', type: e.target.value, label: automationActionDef(e.target.value)?.short || '', params: {} });
                }}>
                <option value="__wait">Esperar (tempo)</option>
                {AUTOMATION_ACTION_DEFS.map((a) => <option key={a.type} value={a.type}>{a.short} — {a.label}</option>)}
              </Select>
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => move(i, -1)} className="text-[11px] text-zinc-400 hover:text-zinc-900 px-1" aria-label="Mover para cima">↑</button>
                <button onClick={() => move(i, 1)} className="text-[11px] text-zinc-400 hover:text-zinc-900 px-1" aria-label="Mover para baixo">↓</button>
                <button onClick={() => setSteps((prev) => prev.filter((x) => x.id !== s.id))} className="text-[11px] text-zinc-400 hover:text-red-700 px-1" aria-label="Remover passo">×</button>
              </div>
            </div>

            {s.kind === 'wait' ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Select className="max-w-[200px]" value={String(s.waitMinutes)} onChange={(e) => patch(s.id, { waitMinutes: Number(e.target.value), waitUntil: '' })}>
                  {WAIT_MINUTE_PRESETS.map((p) => <option key={p.minutes} value={String(p.minutes)}>{p.label}</option>)}
                  <option value="0">personalizado…</option>
                </Select>
                {!s.waitMinutes && (
                  <Input className="max-w-[120px]" type="number" min={1} value={String(s.waitMinutes || '')} placeholder="minutos"
                    onChange={(e) => patch(s.id, { waitMinutes: Math.max(1, Number(e.target.value) || 0) })} />
                )}
                <span className="text-[11px] text-zinc-400">ou até</span>
                <Input className="max-w-[200px]" type="datetime-local" value={s.waitUntil}
                  title="Aceita data e hora, ou “amanhã às 09:00”"
                  placeholder="amanhã às 09:00"
                  onChange={(e) => patch(s.id, { waitUntil: e.target.value, waitMinutes: 0 })} />
                <p className="w-full text-[11px] text-zinc-500">
                  {s.waitUntil
                    ? `Retoma em ${s.waitUntil.replace('T', ' ')} — a execução fica guardada no banco, sem requisição aberta.`
                    : `A execução pausa ${humanDuration(s.waitMinutes)} e continua sozinha.`}
                </p>
              </div>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(automationActionDef(s.type)?.fields || []).map((f) => (
                  <label key={f.key} className="block">
                    <span className="block text-[11px] font-semibold text-zinc-600 mb-1">
                      {f.label}{f.required && <span className="text-red-600"> *</span>}
                    </span>
                    {f.type === 'stage' ? (
                      <Select value={String(s.params[f.key] ?? '')} onChange={(e) => patch(s.id, { params: { ...s.params, [f.key]: e.target.value } })}>
                        <option value="">etapa…</option>
                        {options.stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </Select>
                    ) : f.type === 'service' ? (
                      <Select value={String(s.params[f.key] ?? '')} onChange={(e) => patch(s.id, { params: { ...s.params, [f.key]: e.target.value } })}>
                        <option value="">serviço…</option>
                        {options.services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
                      </Select>
                    ) : f.type === 'member' ? (
                      <Select value={String(s.params[f.key] ?? '')} onChange={(e) => patch(s.id, { params: { ...s.params, [f.key]: e.target.value } })}>
                        <option value="">pessoa…</option>
                        {options.members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                      </Select>
                    ) : f.type === 'number' ? (
                      <Input type="number" value={String(s.params[f.key] ?? '')} onChange={(e) => patch(s.id, { params: { ...s.params, [f.key]: e.target.value } })} />
                    ) : f.type === 'boolean' ? (
                      <Select value={s.params[f.key] === true ? '1' : '0'} onChange={(e) => patch(s.id, { params: { ...s.params, [f.key]: e.target.value === '1' } })}>
                        <option value="0">não</option>
                        <option value="1">sim</option>
                      </Select>
                    ) : f.type === 'textarea' ? (
                      <Textarea rows={2} value={String(s.params[f.key] ?? '')} onChange={(e) => patch(s.id, { params: { ...s.params, [f.key]: e.target.value } })} />
                    ) : f.options?.length ? (
                      <Select value={String(s.params[f.key] ?? '')} onChange={(e) => patch(s.id, { params: { ...s.params, [f.key]: e.target.value } })}>
                        <option value="">escolher…</option>
                        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    ) : (
                        <Input value={String(s.params[f.key] ?? '')} onChange={(e) => patch(s.id, { params: { ...s.params, [f.key]: e.target.value } })} />
                    )}
                    {f.hint && <span className="block text-[10px] text-zinc-400 mt-0.5">{f.hint}</span>}
                  </label>
                ))}
                <p className="sm:col-span-2 text-[10px] text-zinc-400">
                  Você pode escrever <code className="bg-zinc-100 px-1 rounded">{'{{lead.name}}'}</code>,{' '}
                  <code className="bg-zinc-100 px-1 rounded">{'{{booking.date}}'}</code> ou{' '}
                  <code className="bg-zinc-100 px-1 rounded">{'{{service.name}}'}</code> — o valor real entra na hora de executar.
                </p>
              </div>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => add('action')} className="text-xs font-semibold text-zinc-700 border border-zinc-300 rounded-md px-2.5 py-1.5 hover:bg-zinc-50">+ Ação</button>
          <button onClick={() => add('wait')} className="text-xs font-semibold text-zinc-700 border border-zinc-300 rounded-md px-2.5 py-1.5 hover:bg-zinc-50">+ Espera</button>
          <span className="text-[11px] text-zinc-400 self-center">gatilho: {automationEventLabel(event)}</span>
        </div>
      </div>
    </Block>
  );
}

// ── histórico por automação ─────────────────────────────────
function HistorySheet({ automation, businessId, onClose }: { automation: AutomationView; businessId: string; onClose: () => void }) {
  const [runs, setRuns] = useState<RunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    apiGet<any>(`/api/automations/${automation.id}?businessId=${businessId}&limit=30`, { scope: 'area', area: 'Automações' })
      .then((res) => { if (!cancelled) { if (res.ok) setRuns(res.data?.runs || []); else setError(res.message || 'Não foi possível carregar o histórico.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [automation.id, businessId, revision]);

  return (
    <Drawer open onClose={onClose} title={`Histórico — ${automation.name}`} subtitle="Cada passo que o motor deu, com o veredito das condições." width="max-w-2xl">
        <div className="p-4 space-y-3">
          {loading && <Skeleton className="h-24" />}
          {error && <AreaLoadError area="Histórico de automações" message={error} onRetry={() => setRevision(n => n + 1)} />}
          {!loading && !error && !runs.length && <p className="text-sm text-zinc-500">Ainda não houve execução. O próximo “{automation.eventLabel}” aparece aqui.</p>}
          {!loading && !error && runs.map((r) => (
            <div key={r.id} className="border border-zinc-200 rounded-md p-3">
              <div className="flex flex-wrap items-center gap-2">
                <RunStatusBadge status={r.status} />
                <span className="text-xs text-zinc-500">início {formatWhen(r.startedAt)}</span>
                {r.resumes > 0 && <span className="text-xs text-zinc-400">· {r.resumes} retomada(s)</span>}
                {r.waitingUntil && <span className="text-xs text-amber-800">retoma {formatWhen(r.waitingUntil)}</span>}
              </div>
              <ol className="mt-2 space-y-1">
                {(r.history || []).map((h, i) => (
                  <li key={i} className="text-[11px] text-zinc-600 flex gap-2">
                    <span className="text-zinc-400 shrink-0">{h.at.slice(11, 16)}</span>
                    <span className="min-w-0">{h.label}{h.detail ? <span className="text-zinc-400"> · {h.detail}</span> : null}</span>
                  </li>
                ))}
              </ol>
              {r.error && <p className="mt-2 text-[11px] text-red-700">{r.error}</p>}
              {(r.status === 'waiting' || r.status === 'queued' || r.status === 'running') && (
                <RunActions businessId={businessId} automationId={automation.id} runId={r.id} onDone={() => setRevision(n => n + 1)} />
              )}
            </div>
          ))}
        </div>
    </Drawer>
  );
}

function RunActions({ businessId, automationId, runId, onDone }: { businessId: string; automationId: string; runId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
        setBusy(true);
        await apiSend(`/api/automations/${automationId}?businessId=${businessId}`, 'POST', { businessId, action: 'drain' });
        setBusy(false); setMsg('Fila empurrada agora.'); onDone();
      }}>Processar agora</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
        setBusy(true);
        const res = await apiSend(`/api/automations/${automationId}?businessId=${businessId}`, 'POST', { businessId, action: 'cancel-run', runId });
        setBusy(false);
        setMsg(res.ok ? 'Execução encerrada.' : res.message);
        onDone();
      }}>Encerrar execução</Button>
      {msg && <span className="text-[11px] text-zinc-500">{msg}</span>}
    </div>
  );
}
