'use client';
// P5.4 / P5.5 — criar automação em linguagem natural, revisar, aprovar.
// Não é um chat: vive dentro de Automações e só publica depois do humano.
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '@/lib/api-client';
import { Badge, Button, Card, EmptyState, Field, Input, Notice, Textarea } from '@/components/ui';
import { Icon } from '@/components/icons';
import { cn } from '@/lib/utils';

interface Presentation {
  name: string;
  description: string;
  when: string;
  ifLines: string[];
  thenLines: Array<{ kind: string; kicker: string; text: string; detail?: string }>;
  elseLines: Array<{ kind: string; kicker: string; text: string; detail?: string }>;
  deadline?: string;
  assumptions: string[];
  unresolved: string[];
  errors: string[];
  warnings: string[];
  confidence: number;
  canApprove: boolean;
  canPublish: boolean;
  status: string;
}

interface Proposal {
  id: string;
  status: string;
  prompt: string;
  plan: { name: string; description: string; event: string; confidence: number };
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  automationId: string;
  presentation: Presentation;
  updatedAt: string;
}

interface Observation {
  stats: { automations: number; active: number; runs: number; failed: number; waiting: number; openTasks: number };
  failures: Array<{ runId: string; automationName: string; error: string; explanation: string; suggestion: string }>;
  suggestions: Array<{ title: string; prompt: string; reason: string }>;
}

interface Example { label: string; prompt: string }

const STATUS_LABEL: Record<string, string> = {
  draft: 'rascunho', approved: 'aprovada', published: 'publicada', cancelled: 'cancelada',
};
const STATUS_TONE: Record<string, 'zinc' | 'amber' | 'green' | 'blue' | 'red'> = {
  draft: 'amber', approved: 'blue', published: 'green', cancelled: 'zinc',
};

export function AiAutomations({
  businessId, onPublished,
}: {
  businessId: string;
  onPublished: (message: string) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [examples, setExamples] = useState<Example[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [observation, setObservation] = useState<Observation | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [current, setCurrent] = useState<Proposal | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [activate, setActivate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sim, setSim] = useState<any>(null);
  const [instruction, setInstruction] = useState('');
  const [changes, setChanges] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/ai/automations?businessId=${businessId}`, { scope: 'area', area: 'Automações' });
    setLoading(false);
    if (!res.ok) { setError(res.message); return; }
    setError('');
    setEnabled(res.data?.enabled !== false);
    setExamples(res.data?.examples || []);
    setProposals(res.data?.proposals || []);
    setObservation(res.data?.observation || null);
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  function show(p: Proposal | null) {
    setCurrent(p);
    setName(p?.plan?.name || p?.presentation?.name || '');
    setActivate(false);
  }

  async function generate(text = prompt) {
    if (!text.trim()) { setError('Descreva o que você quer automatizar.'); return; }
    setBusy(true); setError(''); setNotice('');
    const res = await apiSend<any>('/api/ai/automations', 'POST', { businessId, action: 'generate', prompt: text });
    setBusy(false);
    if (!res.ok) { setError(res.message || (res.data?.errors || []).join(' ')); return; }
    const p = res.data?.proposal as Proposal;
    setPrompt(text);
    show(p);
    setNotice('Proposta gerada. Revise antes de publicar — a IA não liga nada sozinha.');
    await load();
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!current) return;
    setBusy(true); setError('');
    const res = await apiSend<any>('/api/ai/automations', 'POST', { businessId, id: current.id, action, ...extra });
    setBusy(false);
    if (!res.ok) { setError((res.data?.errors || [res.message]).filter(Boolean).join(' · ')); return; }
    const p = res.data?.proposal as Proposal;
    show(p);
    if (action === 'publish' || action === 'approve-publish') {
      onPublished(activate
        ? 'Automação publicada e ligada. Os próximos eventos já disparam o motor do P4.'
        : 'Automação publicada desligada — revise na lista e ligue quando quiser.');
      return;
    }
    if (action === 'cancel') setNotice('Proposta cancelada.');
    if (action === 'approve') setNotice('Proposta aprovada. Publique para ela virar uma automação.');
    await load();
  }

  async function saveEdits() {
    if (!current) return;
    setBusy(true); setError('');
    const res = await apiSend<any>('/api/ai/automations', 'PATCH', { businessId, id: current.id, name });
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    show(res.data?.proposal);
    setNotice('Rascunho atualizado. Aprove de novo se já tinha aprovado.');
    await load();
  }

  async function runSimulation() {
    if (!current) return;
    setBusy(true); setError(''); setSim(null);
    const res = await apiSend<any>('/api/ai/automations', 'POST', { businessId, id: current.id, action: 'simulate' });
    setBusy(false);
    if (!res.ok) { setError(res.message || (res.data?.errors || []).join(' ')); return; }
    setSim(res.data?.simulation || null);
    setNotice('Simulação concluída — nada foi enviado nem criado.');
  }

  async function refine() {
    if (!current || !instruction.trim()) return;
    setBusy(true); setError(''); setChanges([]);
    const res = await apiSend<any>('/api/ai/automations', 'POST', {
      businessId, id: current.id, action: 'refine', instruction: instruction.trim(),
    });
    setBusy(false);
    if (!res.ok) { setError((res.data?.errors || [res.message]).filter(Boolean).join(' · ')); return; }
    show(res.data?.proposal);
    setChanges(res.data?.changes || []);
    setInstruction('');
    setSim(null);
    setNotice('Ajuste aplicado ao rascunho. Aprove de novo se precisar.');
    await load();
  }

  const pres = current?.presentation;

  if (loading) return <Card className="p-6 text-sm text-zinc-500">Carregando o assistente de automações…</Card>;
  if (!enabled) {
    return <Notice tone="info">A geração por IA está desligada para esta empresa. Nada será interpretado nem publicado.</Notice>;
  }

  return (
    <div className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}

      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Icon n="spark" size={18} className="text-zinc-500 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Descreva o que você quer automatizar</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              A IA monta o Quando / Se / Então. Você revisa, edita e só então publica — o motor de automações é quem executa.
            </p>
          </div>
        </div>
        <Textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={2000}
          placeholder="Ex.: Quando um cliente entrar pelo Instagram e demonstrar interesse em limpeza dental, coloque o lead como interessado, atribua para a recepção e crie uma tarefa para ligar amanhã."
        />
        <div className="flex flex-wrap gap-1.5">
          {examples.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => { setPrompt(ex.prompt); }}
              className="text-[11px] font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-full px-2.5 py-1"
            >
              {ex.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => generate()} disabled={busy || !prompt.trim()}>
            {busy ? 'Gerando…' : 'Gerar proposta'}
          </Button>
          {current && current.status !== 'published' && current.status !== 'cancelled' && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act('regenerate', { prompt })}>
              Gerar novamente
            </Button>
          )}
        </div>
      </Card>

      {pres && current && (
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-900">O que a IA entendeu</h3>
            <Badge tone={STATUS_TONE[current.status] || 'zinc'}>{STATUS_LABEL[current.status] || current.status}</Badge>
            {current.validation.ok
              ? <Badge tone="green">válida</Badge>
              : <Badge tone="red">precisa de ajuste</Badge>}
          </div>

          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>

          <div className="border border-zinc-200 rounded-md divide-y divide-zinc-100 text-sm">
            <Row kicker="QUANDO" text={pres.when} />
            {pres.ifLines.map((line, i) => (
              <Row key={`if-${i}`} kicker={i === 0 ? 'SE' : ''} text={line} />
            ))}
            {pres.thenLines.map((line, i) => (
              <Row key={`then-${i}`} kicker={line.kicker} text={line.text} detail={line.detail} />
            ))}
            {pres.elseLines.map((line, i) => (
              <Row key={`else-${i}`} kicker={line.kicker} text={line.text} />
            ))}
            {pres.deadline && <Row kicker="PRAZO" text={pres.deadline} />}
          </div>

          {pres.assumptions.length > 0 && (
            <p className="text-[11px] text-zinc-500">Assumi: {pres.assumptions.join(' · ')}</p>
          )}
          {(pres.errors.length > 0 || current.validation.errors.length > 0) && (
            <div className="border border-red-200 bg-red-50 rounded-md p-3">
              <p className="text-xs font-semibold text-red-900">Ainda não dá para publicar:</p>
              <ul className="mt-1 text-xs text-red-800 list-disc pl-4">
                {(pres.errors.length ? pres.errors : current.validation.errors).slice(0, 6).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {pres.warnings.length > 0 && (
            <p className="text-[11px] text-amber-800">Atenção: {pres.warnings.slice(0, 3).join(' · ')}</p>
          )}

          <label className="text-xs text-zinc-600 inline-flex items-center gap-2">
            <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
            Ligar ao publicar (sem isso, nasce desligada para você revisar na lista)
          </label>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={saveEdits}>Salvar rascunho</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={runSimulation}>
              {busy && !sim ? 'Testando…' : 'Testar (simulação)'}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy || current.status !== 'draft' || !current.validation.ok} onClick={() => act('approve')}>
              Aprovar
            </Button>
            <Button size="sm" disabled={busy || (current.status !== 'approved' && current.status !== 'draft') || !current.validation.ok} onClick={() => act(current.status === 'approved' ? 'publish' : 'approve-publish', { activate })}>
              Publicar
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || current.status === 'published'} onClick={() => act('cancel')}>
              Cancelar
            </Button>
          </div>
          {changes.length > 0 && (
            <p className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
              Ajustes: {changes.join(' · ')}
            </p>
          )}

          <div className="border-t border-zinc-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-zinc-700">Editar com uma frase</p>
            <div className="flex flex-wrap gap-2">
              <Input
                className="flex-1 min-w-[220px]"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder='Ex.: "espere 3 horas" ou "mude a etapa para qualificado"'
                maxLength={400}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void refine(); } }}
              />
              <Button size="sm" variant="secondary" disabled={busy || !instruction.trim()} onClick={() => refine()}>
                Aplicar ajuste
              </Button>
            </div>
            <p className="text-[11px] text-zinc-400">Ajuste pontual no rascunho atual (sem LLM). Para trocar o gatilho, use “Gerar novamente”.</p>
          </div>

          {sim && (
            <div className="border border-blue-200 bg-blue-50 rounded-md p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-blue-900">Simulação (sem envio real)</p>
                <span className="text-[10px] font-semibold uppercase text-blue-700 bg-blue-100 rounded px-1.5 py-0.5">dry-run</span>
              </div>
              <p className="text-[11px] text-blue-900">{sim.summary}</p>
              <ol className="text-xs text-blue-950 space-y-1 list-decimal pl-4">
                {(sim.steps || []).map((s: any) => (
                  <li key={s.index}>
                    {s.would}
                    {s.blockedReason && <span className="text-red-700"> — {s.blockedReason}</span>}
                    {s.detail && <span className="text-blue-800/70"> ({s.detail})</span>}
                  </li>
                ))}
              </ol>
              {(sim.notes || []).map((n: string, i: number) => (
                <p key={i} className="text-[11px] text-blue-900/80">{n}</p>
              ))}
              <p className="text-[11px] font-semibold text-blue-900">Nenhuma mensagem saiu. realSend = false.</p>
            </div>
          )}

          <p className="text-[11px] text-zinc-400">
            Publicar cria a automação no motor do P4. A IA não executa etapa, tarefa nem agendamento — só o motor, depois do seu ok.
          </p>
        </Card>
      )}

      {observation && observation.suggestions.length > 0 && !current && (
        <Card className="p-4 space-y-2">
          <h3 className="text-sm font-semibold text-zinc-900">Sugestões com base na operação</h3>
          {observation.suggestions.map((s) => (
            <button key={s.title} type="button" onClick={() => { setPrompt(s.prompt); }}
              className="w-full text-left border border-zinc-200 rounded-md p-3 hover:bg-zinc-50">
              <p className="text-sm font-semibold text-zinc-800">{s.title}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{s.reason}</p>
            </button>
          ))}
        </Card>
      )}

      {observation && observation.failures.length > 0 && (
        <Card className="p-4 space-y-2">
          <h3 className="text-sm font-semibold text-zinc-900">Execuções com erro</h3>
          {observation.failures.slice(0, 5).map((f) => (
            <div key={f.runId} className="text-xs text-zinc-600 border-t border-zinc-100 pt-2">
              <p className="font-semibold text-zinc-800">{f.automationName}</p>
              <p>{f.explanation}</p>
              <p className="text-zinc-500">{f.suggestion}</p>
            </div>
          ))}
        </Card>
      )}

      {proposals.filter((p) => p.status === 'draft' || p.status === 'approved').length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Propostas em aberto</h3>
          {proposals.filter((p) => p.status === 'draft' || p.status === 'approved').map((p) => (
            <button key={p.id} type="button" onClick={() => show(p)}
              className={cn('w-full text-left border rounded-md p-3 hover:bg-zinc-50', current?.id === p.id ? 'border-zinc-900' : 'border-zinc-200')}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-900 truncate">{p.plan.name || p.presentation.name}</span>
                <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{p.prompt}</p>
            </button>
          ))}
        </div>
      )}

      {!current && proposals.length === 0 && (
        <EmptyState
          title="Nenhuma proposta ainda"
          hint="Escreva o que você quer em uma frase. A IA devolve o Quando / Se / Então para você revisar."
        />
      )}
    </div>
  );
}

function Row({ kicker, text, detail }: { kicker: string; text: string; detail?: string }) {
  return (
    <div className="px-3 py-2 flex gap-3">
      <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 pt-0.5">{kicker}</span>
      <div className="min-w-0">
        <p className="text-sm text-zinc-900">{text}</p>
        {detail && <p className="text-[11px] text-zinc-500 mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}
