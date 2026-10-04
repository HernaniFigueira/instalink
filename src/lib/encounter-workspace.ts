// ═══════════════════════════════════════════════════════════════
// F1A · ROTAS DO ATENDIMENTO CLÍNICO (workspace)
// ═══════════════════════════════════════════════════════════════
// Duas portas, uma só entidade — e nenhuma PII na query string:
//
//   /atendimento/<encounterId>            → WORKSPACE CANÔNICO (F5/F10):
//                                            abre direto pelo ID, sobrevive a
//                                            F5, volta, link compartilhado e
//                                            "Retomar atendimento";
//   /atendimento/<id>/registro            → REGISTRO COMPLETO (LEGADO): o
//                                            EncounterSheet com finalização,
//                                            reabertura, anamnese, anexos e
//                                            pós-atendimento — fora do
//                                            workspace F1A, intacto;
//   /atendimento?b=&bookingId=&queueId=   → RESOLVER (entrada operacional):
//                                            a Agenda/Fila/Cliente 360 pedem
//                                            "abrir o atendimento deste
//                                            agendamento"; a página resolve
//                                            (start or resume no servidor) e
//                                            assume a rota canônica por ID.
//
// A rota do workspace é FILHA de `/atendimento` (arquétipo `record` do
// catálogo em lib/panel.ts): herda permissão, área e frame sem duplicar rota
// nem criar segundo registro de navegação.
export interface EncounterWorkspaceTarget {
  businessId: string;
  /** Registro JÁ existente: vai direto para a rota canônica. */
  id?: string;
  /** Origem operacional quando ainda não se sabe o id (ou ele não existe). */
  bookingId?: string;
  queueId?: string;
  returnTo?: string;
}

export const ENCOUNTER_WORKSPACE_ROUTE = '/atendimento';

export function isSafeInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\') && !/[\r\n]/.test(href);
}

/** Só o que é interno e seguro entra como `returnTo` (nada de URL absoluta). */
function returnParam(returnTo: string | undefined): string {
  return returnTo && isSafeInternalHref(returnTo) ? `&returnTo=${encodeURIComponent(returnTo)}` : '';
}

/**
 * Rota CANÔNICA do workspace de um atendimento que já existe.
 * É para onde "Retomar atendimento", "Ver atendimento" e o histórico apontam.
 */
export function encounterHref(encounterId: string, businessId: string, returnTo?: string): string {
  const id = encodeURIComponent(String(encounterId || ''));
  const b = encodeURIComponent(String(businessId || ''));
  return `${ENCOUNTER_WORKSPACE_ROUTE}/${id}?b=${b}${returnParam(returnTo)}`;
}

/**
 * Entrada operacional: "abra (ou inicie) o atendimento deste agendamento /
 * desta entrada da fila". Quem resolve é o SERVIDOR (`/api/encounters/start`),
 * nunca a tela — ela só pede.
 */
export function encounterResolveHref(target: Omit<EncounterWorkspaceTarget, 'id'>): string {
  const params = new URLSearchParams();
  params.set('b', String(target.businessId || ''));
  if (target.bookingId) params.set('bookingId', target.bookingId);
  if (target.queueId) params.set('queueId', target.queueId);
  if (target.returnTo && isSafeInternalHref(target.returnTo)) params.set('returnTo', target.returnTo);
  return `${ENCOUNTER_WORKSPACE_ROUTE}?${params.toString()}`;
}

/**
 * Um ponto de entrada só para os chamadores existentes: com `id` vai direto
 * para a rota canônica; sem `id` (ainda) cai no resolvedor por origem.
 * Assim Agenda, Fila e Cliente 360 não precisam saber em qual dos dois
 * mundos o atendimento está.
 */
export function encounterWorkspaceHref(target: EncounterWorkspaceTarget): string {
  if (target.id) return encounterHref(target.id, target.businessId, target.returnTo);
  return encounterResolveHref(target);
}

/**
 * REGISTRO COMPLETO (LEGADO) de um atendimento que já existe.
 *
 * F1A não implementa finalização, reabertura, anexos, anamnese nem
 * pós-atendimento — tudo isso continua existindo no `EncounterSheet`, que
 * mora nesta rota. O workspace canônico fica só com o núcleo; quem abre o
 * HISTÓRICO (Cliente 360 / Pet 360) continua caindo no registro completo,
 * exatamente como caía antes do F1A. Nada foi apagado do sistema.
 */
export function encounterLegacyRecordHref(encounterId: string, businessId: string, returnTo?: string): string {
  const id = encodeURIComponent(String(encounterId || ''));
  const b = encodeURIComponent(String(businessId || ''));
  return `${ENCOUNTER_WORKSPACE_ROUTE}/${id}/registro?b=${b}${returnParam(returnTo)}`;
}

/** Volta do workspace: `returnTo` válido ou a Agenda da unidade. */
export function encounterReturnHref(value: string | null, businessId: string): string {
  return value && isSafeInternalHref(value) ? value : `/agenda?b=${encodeURIComponent(businessId)}`;
}
