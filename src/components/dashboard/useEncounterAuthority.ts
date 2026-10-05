'use client';
// ═══════════════════════════════════════════════════════════════
// F1B1 · AUTORIDADE ÚNICA DE PERSISTÊNCIA DO WORKSPACE
// ═══════════════════════════════════════════════════════════════
// Uma versão por Encounter, uma autoridade por workspace.
//
// O problema que isto resolve (e que NÃO pode voltar):
//   Atendimento abre version 5 → Anamnese salva (vira 6) → Avaliação ainda
//   manda 5 → o próprio sistema cria um 409 interno. Cada seção ter o seu
//   autosave "ingênuo" com a sua cópia da versão é exatamente isso.
//
// O contrato:
//   • o WORKSPACE é o dono da linha atual (`rowRef`) e da versão;
//   • qualquer seção pergunta a versão na hora de salvar (`version()`);
//   • quem salva publica a linha confirmada (`publish`) — e a versão nova
//     passa a valer para TODAS as seções imediatamente;
//   • status de persistência e conflito são um só (nenhuma seção inventa o
//     seu próprio indicador);
//   • seção registra `flush`/`dirty` para que trocar de seção ou sair tente
//     gravar ANTES de navegar — e não navegue quando falhar.
import { useCallback, useMemo, useRef, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import type { ClinicType, Encounter } from '@/lib/types';
import type { EncounterClinicalAccess } from '@/lib/encounter-clinical';
import type { EncounterWorkspaceView } from '@/lib/encounters';

/**
 * Linha do Encounter como as seções do workspace a consomem: a entidade +
 * revisão otimista + o CONTEXTO de leitura resolvido no servidor (paciente,
 * serviço, profissional) e a capacidade de escrita clínica deste ator.
 * Tudo `import type` — nenhum ciclo em runtime.
 */
export type EncounterAuthorityRow = Encounter & { version: number } & {
  access?: EncounterClinicalAccess | null;
  /** Vertical da unidade (resolvida no servidor): decide as SEÇÕES reais. */
  clinicType?: ClinicType;
  context?: EncounterWorkspaceView['context'];
  petName?: string;
  serviceName?: string;
  professionalName?: string;
};

export type EncounterSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface EncounterSectionApi {
  id: string;
  /** grava o que estiver pendente; `true` só com persistência confirmada */
  flush: () => Promise<boolean>;
  /** existe mudança não persistida nesta seção? */
  dirty: () => boolean;
}

export interface EncounterAuthority {
  /** Versão ATUAL do Encounter (sempre a mais recente conhecida). */
  version: () => number;
  /** Adota como verdade a linha que o SERVIDOR confirmou. */
  publish: (row: EncounterAuthorityRow) => void;
  /**
   * Indicador único de persistência do workspace. `owner` identifica QUEM
   * publicou o erro (a seção): assim uma seção só apaga o erro que é dela —
   * o erro de outra seção (ou do conflito) nunca é apagado por engano.
   */
  status: (state: EncounterSaveState, error?: string, owner?: string) => void;
  /** Limpa o estado de erro SE ele pertencer a `owner` (draft voltou a valer). */
  clearStatus: (owner: string) => void;
  /** 409 real: o workspace mostra o conflito (nunca sobrescreve sozinho). */
  conflict: (message: string) => void;
  /** Seção se registra para o flush compartilhado (troca de seção/saída). */
  registerSection: (api: EncounterSectionApi) => void;
  /** Seção registrada por id (troca de seção pergunta AQUI, nunca adivinha). */
  registeredSection: (id: string) => EncounterSectionApi | undefined;
  /** A seção saiu da tela (não participa mais do flush). */
  unregisterSection: (id: string) => void;
  /** A seção informa se tem mudança pendente (dirty REATIVO para o guard). */
  sectionDirty: (id: string, dirty: boolean) => void;
}

export interface EncounterAuthorityState {
  authority: EncounterAuthority;
  row: EncounterAuthorityRow;
  saveState: EncounterSaveState;
  saveError: string;
  conflictMessage: string;
  /** IDs das seções com mudança pendente (reativo: alimenta o guard). */
  dirtySections: string[];
  publish: (row: EncounterAuthorityRow) => void;
  clearConflict: () => void;
  /** Seções com mudança pendente, na ordem em que foram registradas. */
  pendingSections: () => EncounterSectionApi[];
  /** Existe QUALQUER seção com mudança pendente (dirty do workspace). */
  anyDirty: () => boolean;
}

/**
 * Estado da autoridade, vive no `EncounterWorkspace`. Recebe a primeira linha
 * lida (do servidor) e mantém `rowRef` como a referência SÍNCRONA da versão —
 * a mesma regra de ouro do domínio: quem salva lê o ref, nunca o render.
 */
export function useEncounterAuthority(
  initialRow: EncounterAuthorityRow,
  /** Notificação de PUBLICAÇÃO (não é efeito de render): o workspace usa para
   *  manter o cabeçalho em sincronia sem criar laço de render. */
  onPublish?: (row: EncounterAuthorityRow) => void,
): EncounterAuthorityState {
  const rowRef = useRef<EncounterAuthorityRow>(initialRow);
  const onPublishRef = useRef(onPublish);
  onPublishRef.current = onPublish;
  const [row, setRow] = useState<EncounterAuthorityRow>(initialRow);
  const [saveState, setSaveState] = useState<EncounterSaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [conflictMessage, setConflictMessage] = useState('');
  const [dirtySections, setDirtySections] = useState<string[]>([]);
  const sectionsRef = useRef<Map<string, EncounterSectionApi>>(new Map());
  /** Dono do erro visível ('' = o workspace/conflito publicou). */
  const errorOwnerRef = useRef('');

  const publish = useCallback((next: EncounterAuthorityRow) => {
    rowRef.current = next;
    setRow(next);
    onPublishRef.current?.(next);
  }, []);

  const authority = useMemo<EncounterAuthority>(() => ({
    version: () => rowRef.current.version,
    publish,
    status: (state, error = '', owner = '') => {
      errorOwnerRef.current = state === 'error' ? owner : '';
      setSaveState(state);
      setSaveError(state === 'error' ? error : '');
    },
    clearStatus: (owner) => {
      if (errorOwnerRef.current !== owner) return;   // o erro não é desta seção
      errorOwnerRef.current = '';
      setSaveState('saved');
      setSaveError('');
    },
    conflict: (message) => { setConflictMessage(message); setSaveState('error'); setSaveError(message); },
    registerSection: (api) => { sectionsRef.current.set(api.id, api); },
    registeredSection: (id) => sectionsRef.current.get(id),
    // Sair do REGISTRO não é o mesmo que ficar limpo: o flag de "pendente"
    // pertence à seção e é zerado por ela ao desmontar (`sectionDirty(id,
    // false)`). Zerar aqui apagaria o sinal de quem acabou de digitar.
    unregisterSection: (id) => { sectionsRef.current.delete(id); },
    sectionDirty: (id, dirty) => {
      setDirtySections((prev) => {
        const has = prev.includes(id);
        if (dirty === has) return prev;
        return dirty ? [...prev, id] : prev.filter((x) => x !== id);
      });
    },
  }), [publish]);

  const pendingSections = useCallback(() => {
    return [...sectionsRef.current.values()].filter((section) => section.dirty());
  }, []);

  const anyDirty = useCallback(() => [...sectionsRef.current.values()].some((section) => section.dirty()), []);

  const clearConflict = useCallback(() => setConflictMessage(''), []);

  return {
    authority, row, saveState, saveError, conflictMessage, dirtySections,
    publish, clearConflict, pendingSections, anyDirty,
  };
}

/**
 * Recarrega a versão ATUAL do servidor (escolha explícita de quem edita).
 * Devolve a linha nova ou `null` quando a leitura falha — a tela decide.
 */
export async function fetchEncounterRow(businessId: string, encounterId: string): Promise<EncounterAuthorityRow | null> {
  const res = await apiGet<{ encounter?: EncounterAuthorityRow }>(
    `/api/encounters?businessId=${encodeURIComponent(businessId)}&id=${encodeURIComponent(encounterId)}`,
    { scope: 'area', area: 'Atendimento' },
  );
  return res.ok && res.data?.encounter ? res.data.encounter : null;
}
