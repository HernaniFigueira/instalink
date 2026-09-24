// ═══════════════════════════════════════════════════════════════
// F3-D — GUARDS: tenant, permissão, injeção e escopo clínico
// ═══════════════════════════════════════════════════════════════
import type { PermissionId } from '../types';
import type { ToolCallContext, ToolDef, ToolErrorCode } from './types';

/**
 * A mensagem do paciente é DADO NÃO CONFIÁVEL.
 * Detecta tentativas clássicas de prompt injection que tentam trocar tenant,
 * conceder permissão ou forçar acesso a outro prontuário/paciente.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore (all |previous |above )?instructions?)\b/i,
  /\b(disregard|override)\b.{0,40}\b(rules?|instructions?|permissions?)\b/i,
  /\b(system prompt|developer mode|jailbreak)\b/i,
  /\b(access|show|open|read)\b.{0,30}\b(another|other|all|every)\b.{0,20}\b(patient|prontuario|prontuário|chart|record|ficha)\b/i,
  /\b(troque|altere|mude)\b.{0,30}\b(businessid|business_id|empresa|unidade|tenant)\b/i,
  /\b(grant|concede|libere)\b.{0,20}\b(permission|permissão|admin|owner)\b/i,
  /\bsql\b|\bselect \* from\b|\bdrop table\b|\binsert into\b/i,
  /\beval\s*\(|\bnew Function\s*\(/,
  /\byou are (now )?(admin|root|superuser)\b/i,
  /\bmeu businessid (é|e|eh)\b/i,
];

export function looksLikeInjection(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false;
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

/** Identificadores de entidade: só tokens simples (uuid/slug/id curto). */
export function isSafeEntityId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (!id || id.length > 64) return false;
  return /^[A-Za-z0-9_-]+$/.test(id);
}

export interface GuardVerdict {
  ok: boolean;
  code?: ToolErrorCode;
  error?: string;
}

/**
 * Revalidação NO SERVIDOR antes de qualquer tool.
 * businessId do input é SEMPRE descartado — só conta o da sessão.
 */
export function authorizeToolCall<I>(
  tool: ToolDef<I, unknown>,
  ctx: ToolCallContext,
  input: Record<string, unknown>,
): GuardVerdict {
  if (!ctx.businessId) {
    return { ok: false, code: 'tenant_mismatch', error: 'Sessão sem unidade autenticada.' };
  }
  // Untrusted: nunca aceitar businessId/tenant/role vindos do input ou do chat.
  if (input.businessId !== undefined && String(input.businessId) !== ctx.businessId) {
    return {
      ok: false,
      code: 'tenant_mismatch',
      error: 'Unidade do pedido não corresponde à sessão — negado.',
    };
  }
  if (input.tenantId !== undefined || input.organizationId !== undefined) {
    return { ok: false, code: 'tenant_mismatch', error: 'Escopo de outro tenant não é aceito.' };
  }
  // Prompt injection no patientMessage: bloqueia a chamada se a tool for de
  // escrita/destrutiva ou tocar identidade alheia; em leitura, marca e o
  // handler só opera com ids já validados do contexto.
  if (looksLikeInjection(ctx.patientMessage)) {
    if (tool.sideEffect !== 'read') {
      return {
        ok: false,
        code: 'forbidden',
        error: 'Mensagem do paciente contém tentativa de contornar regras — ação negada.',
      };
    }
    // Em leitura, ids ainda passam pela validação de tenant do handler.
  }
  if (ctx.readOnly && tool.sideEffect !== 'read') {
    return { ok: false, code: 'read_only', error: 'Sessão somente leitura.' };
  }
  if (tool.requiresPermission) {
    const perm = tool.requiresPermission as PermissionId;
    if (ctx.permissions[perm] !== true) {
      return {
        ok: false,
        code: 'forbidden',
        error: `Permissão "${perm}" necessária para ${tool.name}.`,
      };
    }
  }
  if (tool.requiresConfirm && tool.sideEffect !== 'read' && ctx.confirmed !== true) {
    return {
      ok: false,
      code: 'needs_confirm',
      error: 'Ação importante: confirme com o paciente/equipe antes de executar.',
    };
  }
  return { ok: true };
}

/**
 * Ferramentas clínicas sensíveis (prontuário/anamnese) NÃO existem no
 * registry para o agente administrativo. Este helper cobre o teste de
 * "acesso clínico indevido" quando alguém tenta forçar o nome.
 */
export const CLINICAL_DENIED_TOOLS = new Set([
  'getMedicalRecord',
  'getAnamnese',
  'getPatientChart',
  'listClinicalNotes',
  'readEncounterClinical',
  'getProntuario',
]);

export function denyClinicalTool(name: string): GuardVerdict | null {
  if (!CLINICAL_DENIED_TOOLS.has(name)) return null;
  return {
    ok: false,
    code: 'denied_clinical',
    error: 'Acesso clínico (prontuário/anamnese) não é permitido ao agente administrativo.',
  };
}
