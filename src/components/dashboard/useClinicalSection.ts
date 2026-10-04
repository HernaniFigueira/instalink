'use client';
// ═══════════════════════════════════════════════════════════════
// F1B1 · SEÇÃO CLÍNICA COM AUTOSAVE SOBRE A AUTORIDADE ÚNICA
// ═══════════════════════════════════════════════════════════════
// Cada seção clínica do workspace (Anamnese, Avaliação) tem o MESMO contrato:
//
//   • rascunho local (o texto de quem digita nunca é sobrescrito pela resposta
//     de um save anterior — `applySaveResult` decide o que adotar);
//   • autosave silencioso depois que o dedo para, um request por vez;
//   • versão lida da AUTORIDADE no instante do save (nunca de um render);
//   • 409 real → o workspace mostra o conflito; a seção não insiste;
//   • `flush()` só devolve `true` com persistência CONFIRMADA;
//   • a seção se registra para o flush compartilhado (troca de seção/saída).
//
// Nada aqui é um segundo motor de save: é a MESMA rota `PATCH /api/encounters`
// com a MESMA trava otimista do domínio.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { ENCOUNTER_AUTOSAVE_MS, applySaveResult } from '@/lib/encounters';
import type { EncounterAuthority, EncounterAuthorityRow } from './useEncounterAuthority';

export interface ClinicalSectionOptions<F> {
  /** Identificador da seção na autoridade (`anamnese` | `avaliacao`). */
  id: string;
  businessId: string;
  authority: EncounterAuthority;
  row: EncounterAuthorityRow;
  /** Rascunho a partir da linha do servidor. */
  formOf: (row: EncounterAuthorityRow) => F;
  /** Assinatura do rascunho (mudança REAL, não tecla). */
  keyOf: (form: F) => string;
  /** Payload parcial (`{ clinical: { ... } }`) — só a fatia desta seção. */
  patchOf: (form: F) => Record<string, unknown>;
  /** Muda quando "Recarregar versão atual" foi escolhido: adota o servidor. */
  adoptToken: number;
  /** Existe conflito na tela: o autosave para (insistir só repetiria o 409). */
  blocked: boolean;
  /** A seção é editável para este ator (capacidade resolvida no servidor). */
  editable: boolean;
  /**
   * Validação local do rascunho ATUAL (ex.: "8,5x" num campo numérico).
   * Enquanto devolver mensagem, a seção NÃO grava: o servidor recusaria e o
   * valor inválido ficaria pendente para sempre. O texto continua na tela.
   */
  validate?: (form: F) => string;
}

export interface ClinicalSectionState<F> {
  form: F;
  update: (next: F) => void;
  dirty: boolean;
  flush: () => Promise<boolean>;
}

export function useClinicalSection<F>(options: ClinicalSectionOptions<F>): ClinicalSectionState<F> {
  const { id, businessId, authority, row, formOf, keyOf, patchOf, adoptToken, blocked, editable } = options;
  const validate = options.validate;
  const [form, setForm] = useState<F>(() => formOf(row));
  const latest = useRef<F>(form);
  const lastSaved = useRef<string>(keyOf(formOf(row)));
  const inflight = useRef<Promise<boolean> | null>(null);
  const encounterId = row.id;

  const publishToLatest = useCallback((next: F) => {
    latest.current = next;
    setForm(next);
  }, []);

  // ADOÇÃO DO SERVIDOR:
  //   • outro Encounter (navegou/retomou outro atendimento) → adota;
  //   • "Recarregar versão atual" (adoptToken) → adota por escolha explícita.
  // Mudança de VERSÃO causada por outra seção NÃO apaga este rascunho.
  const adoptRef = useRef({ id: encounterId, token: adoptToken });
  useEffect(() => {
    if (adoptRef.current.id === encounterId && adoptRef.current.token === adoptToken) return;
    adoptRef.current = { id: encounterId, token: adoptToken };
    const next = formOf(row);
    latest.current = next;
    setForm(next);
    lastSaved.current = keyOf(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encounterId, adoptToken]);

  const update = useCallback((next: F) => { publishToLatest(next); }, [publishToLatest]);

  const dirtyOf = useCallback((value: F) => keyOf(value) !== lastSaved.current, [keyOf]);
  const validationError = validate ? validate(form) : '';

  const save = useCallback(async (): Promise<boolean> => {
    if (!editable) return false;
    if (validationError) {
      // Nada de gravar valor inválido: o erro fica visível e o texto continua.
      authority.status('error', validationError);
      return false;
    }
    const sentForm = latest.current;
    const sentKey = keyOf(sentForm);
    if (sentKey === lastSaved.current) return true;
    if (inflight.current) return inflight.current;

    authority.status('saving');
    const run = (async () => {
      const res = await apiSend<{ encounter: EncounterAuthorityRow }>(
        '/api/encounters', 'PATCH',
        {
          businessId, id: encounterId,
          // A VERSÃO vem da autoridade: a seção nunca guarda a sua própria.
          expectedVersion: authority.version(),
          ...patchOf(sentForm),
        },
        { scope: 'action', area: 'Atendimento' },
      );
      if (!res.ok) {
        if (res.status === 409) {
          authority.conflict(res.message || 'Este atendimento foi alterado em outra tela. Suas alterações ainda não foram salvas.');
          return false;
        }
        authority.status('error', res.message || 'Não foi possível salvar agora.');
        return false;
      }
      const serverRow = res.data!.encounter;
      const result = applySaveResult({
        sentKey, currentKey: keyOf(latest.current), serverVersion: serverRow.version,
      });
      lastSaved.current = result.lastSavedKey;
      // Publica a linha confirmada: TODAS as seções passam a ver a versão nova.
      authority.publish(serverRow);
      if (result.adoptServerForm) publishToLatest(formOf(serverRow));
      authority.status('saved');
      return true;
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
    }
  }, [authority, businessId, editable, encounterId, formOf, keyOf, patchOf, publishToLatest, validationError]);

  // Autosave: mudança real + rascunho + sem conflito, um request por vez.
  useEffect(() => {
    if (!editable || blocked || validationError) return;
    if (keyOf(form) === lastSaved.current) return;
    const timer = setTimeout(() => { void save(); }, ENCOUNTER_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [blocked, editable, form, keyOf, save, validationError]);

  const flush = useCallback(async (): Promise<boolean> => {
    // Pendência com erro de validação NÃO navega: o valor precisa ser corrigido.
    if (validationError && dirtyOf(latest.current)) {
      authority.status('error', validationError);
      return false;
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!dirtyOf(latest.current)) return true;
      const ok = await save();
      if (!ok) return false;
      if (!dirtyOf(latest.current)) return true;
    }
    return !dirtyOf(latest.current);
  }, [authority, dirtyOf, save, validationError]);

  const api = useMemo(() => ({
    id,
    flush,
    dirty: () => dirtyOf(latest.current),
  }), [dirtyOf, flush, id]);

  useEffect(() => {
    authority.registerSection(api);
    return () => authority.unregisterSection(api.id);
  }, [api, authority]);

  // Desmontar não pode deixar a seção "pendente" no workspace: o flush da
  // saída não deve perseguir um componente que já saiu da tela. Este efeito
  // depende SÓ da autoridade/identidade (não roda de novo por re-render, para
  // não apagar o sinal de "dirty" que a seção acabou de publicar).
  useEffect(() => () => authority.sectionDirty(id, false), [authority, id]);

  // O workspace precisa de um `dirty` REATIVO (guard de navegação e navegação
  // entre seções são efeitos de React; ler o ref não re-renderiza).
  const isDirty = dirtyOf(form);
  useEffect(() => { authority.sectionDirty(id, isDirty); }, [authority, id, isDirty]);

  return { form, update, dirty: dirtyOf(form), flush };
}
