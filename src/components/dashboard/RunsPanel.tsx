'use client';
// ═══════════════════════════════════════════════════════════════
// EXECUÇÕES — o que o motor fez (extraído de AutomationsView)
// ═══════════════════════════════════════════════════════════════
// A1.2 · Bloco 1: "observar o sistema funcionando" é visita deliberada
// (diagnóstico), não passagem diária. Ganhou porta própria (/execucoes, fora
// do menu) e, por isso, o painel de execuções deixou de morar DENTRO da tela
// de Automações — virou componente reutilizável, com a MESMA leitura de dados
// (`recentRuns` de /api/automations) e o MESMO conteúdo passo a passo.
// Nenhuma regra do motor foi alterada: isto é apenas onde a informação vive.
import { Card, StatusBadge } from '@/components/ui';
import { automationEventLabel } from '@/lib/automation/ui';

export interface RunView {
  id: string;
  automationId: string;
  automationName: string;
  status: string;
  triggerEvent: string;
  waitingUntil: string;
  startedAt: string;
  updatedAt: string;
  error: string;
  steps: number;
  resumes: number;
  context: Record<string, any>;
  history: { at: string; nodeId: string; nodeType: string; outcome: string; label: string; detail?: string }[];
}

const RUN_TONE: Record<string, 'emerald' | 'amber' | 'red' | 'zinc' | 'blue'> = {
  completed: 'emerald', waiting: 'amber', running: 'blue', queued: 'blue', failed: 'red', cancelled: 'zinc',
};
const RUN_LABEL: Record<string, string> = {
  completed: 'concluída', waiting: 'aguardando', running: 'processando', queued: 'na fila', failed: 'com erro', cancelled: 'cancelada',
};

export function RunStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge tone={RUN_TONE[status] || 'zinc'}>
      <span className="text-[10px] uppercase tracking-wide">{RUN_LABEL[status] || status}</span>
    </StatusBadge>
  );
}

export function formatWhen(iso: string): string {
  if (!iso) return '';
  const d = iso.slice(0, 10).split('-').reverse().join('/');
  return `${d} ${iso.slice(11, 16)}`;
}

/** Lista de execuções com o histórico de passos de cada uma. */
export function RunsPanel({ runs }: { runs: RunView[] }) {
  return (
    <Card className="divide-y divide-zinc-100">
      {!runs.length && <p className="p-4 text-sm text-zinc-500">Nenhuma execução ainda. Ela aparece aqui no momento em que um gatilho acontece.</p>}
      {runs.map((r) => (
        <div key={r.id} className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={r.status} />
            <span className="text-sm font-semibold text-zinc-900">{r.automationName}</span>
            <span className="text-xs text-zinc-500">{automationEventLabel(r.triggerEvent)}</span>
            <span className="text-xs text-zinc-400 ml-auto">{formatWhen(r.startedAt)}</span>
          </div>
          {r.error && <p className="mt-1 text-xs text-red-700">{r.error}</p>}
          {r.status === 'waiting' && <p className="mt-1 text-xs text-amber-800">Retoma em {formatWhen(r.waitingUntil)}</p>}
          <ol className="mt-2 space-y-1 border-l border-zinc-200 pl-3">
            {(r.history || []).slice(-6).map((h, i) => (
              <li key={i} className="text-[11px] text-zinc-600">
                <span className="text-zinc-400">{h.at.slice(11, 16)}</span> {h.label}
                {h.detail ? <span className="text-zinc-400"> · {h.detail}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </Card>
  );
}
