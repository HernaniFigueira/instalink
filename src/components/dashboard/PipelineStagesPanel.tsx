'use client';
// ═══════════════════════════════════════════════════════════════
// ETAPAS DO FUNIL — administração da máquina de estados (A1.2 · Bloco 2)
// ═══════════════════════════════════════════════════════════════
// O backend configurável de PipelineStage (lib/pipeline.ts) já existia, mas
// não tinha UI conectada. Este painel administra EXATAMENTE aquela máquina —
// não cria uma segunda configuração paralela de etapas:
//
//   • lê a esteira REAL do negócio (a mesma devolvida por /api/leads e
//     /api/pipeline — mesma ordem, mesmos ids, mesmos nomes);
//   • renomeia, reordena, marca/desmarca etapa final, cria etapa nova e
//     remove etapa;
//   • salva por PATCH /api/pipeline, cuja guarda no servidor é 'config'.
//     Quem não tem a permissão nem chega aqui (o botão que abre este painel
//     só aparece com `canEditPipeline`, derivado da permissão real), e se
//     chegar por outro caminho o servidor responde 403 amigável.
//
// Regras preservadas do motor (updateBusinessPipeline):
//   • id sanitizado (a-z, 0-9, _ e -, máx. 32) — etapa nova recebe id estável
//     derivado do nome + sufixo único;
//   • as etapas 'new' e 'converted' são garantidas pelo servidor (não podem
//     ser removidas daqui);
//   • nada aqui altera lead: leads de uma etapa removida são normalizados na
//     leitura (F3) — o histórico permanece íntegro.
import { useMemo, useState } from 'react';
import type { BusinessPipeline, PipelineStage } from '@/lib/types';
// Módulo PURO (sem node:crypto) — seguro para componente de cliente.
import { stagesInOrder } from '@/lib/pipeline-stages';
import { apiSend } from '@/lib/api-client';
import { Icon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Badge, Button, Drawer } from '@/components/ui';

interface StageDraft {
  id: string;
  name: string;
  color?: string;
  isTerminal?: boolean;
  isSystem?: boolean;
  mappedStatus?: PipelineStage['mappedStatus'];
  isNew?: boolean;
}

/** Id estável para etapa nova: nome sanitizado + sufixo único (mesmas regras
 *  de updateBusinessPipeline — minúsculas, a-z 0-9 _ -, máximo 32). */
function draftStageId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'etapa';
  const suffix = Math.random().toString(36).slice(2, 6);
  let id = `${base}_${suffix}`.slice(0, 32);
  while (taken.has(id)) id = `${base}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
  return id;
}

export function PipelineStagesPanel({ businessId, pipeline, onClose, onSaved }: {
  businessId: string;
  pipeline: BusinessPipeline;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Fotografia inicial: a MESMA ordem usada pelo kanban e pelo backend.
  const [stages, setStages] = useState<StageDraft[]>(() =>
    stagesInOrder(pipeline).map((s) => ({
      id: s.id, name: s.name, color: s.color, isTerminal: !!s.isTerminal,
      isSystem: !!s.isSystem, mappedStatus: s.mappedStatus,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const takenIds = useMemo(() => new Set(stages.map((s) => s.id)), [stages]);
  // A3: etapas estruturais new/scheduled/converted não podem ser removidas; scheduled é de sistema
  const canRemove = (s: StageDraft) => s.id !== 'new' && s.id !== 'scheduled' && s.id !== 'converted';
  const isSystemStage = (s: StageDraft) => s.isSystem || ['new','scheduled','converted'].includes(s.id);

  function patch(index: number, partial: Partial<StageDraft>) {
    setStages((list) => list.map((s, i) => (i === index ? { ...s, ...partial } : s)));
  }

  function move(index: number, dir: -1 | 1) {
    setStages((list) => {
      const to = index + dir;
      if (to < 0 || to >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function addStage() {
    setStages((list) => {
      const name = 'Nova etapa';
      return [...list, { id: draftStageId(name, new Set(list.map((s) => s.id))), name, color: 'zinc', isTerminal: false, isNew: true }];
    });
  }

  function remove(index: number) {
    setStages((list) => list.filter((_, i) => i !== index));
  }

  async function save() {
    setSaving(true);
    setError('');
    // `order` segue a posição na lista — a ordem visível É a ordem salva.
    // Campos que a UI não expõe (mappedStatus/color originais) seguem como
    // vieram: nenhum comportamento do pipeline é reinventado aqui.
    const payload = stages
      .filter((s) => s.name.trim())
      .map((s, order) => ({
        id: s.id,
        name: s.name.trim(),
        order,
        color: s.color,
        isTerminal: s.isTerminal,
        mappedStatus: s.mappedStatus,
      }));
    const res = await apiSend('/api/pipeline', 'PATCH', { businessId, stages: payload }, { scope: 'action', area: 'Funil' });
    setSaving(false);
    if (!res.ok) {
      setError(res.message || 'Não foi possível salvar as etapas.');
      return;
    }
    onSaved();
  }

  return (
    <Drawer open onClose={onClose} title="Etapas das oportunidades" width="max-w-lg">
      <div className="p-5 space-y-4">
        <p className="text-sm text-[var(--text-muted)]">Renomeie, reordene, marque etapas finais ou crie novas. As mudanças valem para todas as oportunidades.</p>
        <ol className="space-y-2">
          {stages.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2">
              <span className="text-[11px] font-semibold text-zinc-400 w-5 text-center shrink-0">{i + 1}</span>
              <input
                value={s.name}
                onChange={(e) => patch(i, { name: e.target.value })}
                maxLength={60}
                aria-label={`Nome da etapa ${i + 1}`}
                className="flex-1 min-w-0 text-xs font-semibold rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-zinc-900"
              />
              {isSystemStage(s) && <Badge tone="zinc" className="uppercase tracking-wider" title="Etapa de sistema — essencial para agenda/CRM/automação">sistema</Badge>}
              <label className={`inline-flex items-center gap-1 text-[11px] shrink-0 ${['new','scheduled','converted'].includes(s.id) ? 'text-zinc-400 cursor-not-allowed' : 'text-zinc-600 cursor-pointer'}`} title={['new','scheduled','converted'].includes(s.id) ? 'Semântica estrutural preservada pelo servidor (new/scheduled não terminais, converted terminal)' : 'Etapa final: encerra a oportunidade (ex.: concluído, perdido).'}>
                <input type="checkbox" checked={s.isTerminal} disabled={['new','scheduled','converted'].includes(s.id)} onChange={(e) => patch(i, { isTerminal: e.target.checked })} className="w-3.5 h-3.5 accent-zinc-900 disabled:opacity-50" />
                final
              </label>
              <div className="flex items-center shrink-0">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Mover para cima"
                  className="p-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-30"><Icon n="chevU" size={13} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === stages.length - 1} aria-label="Mover para baixo"
                  className="p-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-30"><Icon n="chevD" size={13} /></button>
                <button type="button" onClick={() => remove(i)} disabled={!canRemove(s)} aria-label={`Remover etapa ${s.name}`}
                  title={canRemove(s) ? 'Remover etapa' : 'Etapas de sistema (new/scheduled/converted) não podem ser removidas'}
                  className={cn('p-1', canRemove(s) ? 'text-red-400 hover:text-red-600' : 'text-zinc-300 cursor-not-allowed')}>
                  <Icon n="x" size={13} />
                </button>
              </div>
            </li>
          ))}
        </ol>

        <button type="button" onClick={addStage}
          className="w-full text-xs font-semibold border border-dashed border-zinc-300 rounded-lg py-2 text-zinc-600 hover:border-zinc-400 hover:text-zinc-900">
          + Nova etapa
        </button>

        <p className="text-[11px] text-zinc-400">
          Etapas de sistema (“new”, “scheduled”, “converted”) são essenciais e não podem ser removidas — garantem a integração Agenda ↔ CRM ↔ Automação. Renomear/cor é permitido. Leads de uma etapa removida são reacomodados na primeira etapa — nada é apagado.
        </p>

        {error && <p className="text-xs font-medium text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1 border-t">
          <Button type="button" variant="primary" className="flex-1" onClick={save} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar etapas'}
          </Button>
          <button type="button" onClick={onClose}
            className="px-4 py-2.5 bg-zinc-100 text-zinc-700 text-xs font-semibold rounded-lg">
            Cancelar
          </button>
        </div>
      </div>
    </Drawer>
  );
}
