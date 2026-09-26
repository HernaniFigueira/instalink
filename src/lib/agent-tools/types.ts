// ═══════════════════════════════════════════════════════════════
// F3-D — TOOL REGISTRY: contrato das tools do Conversation Agent
// ═══════════════════════════════════════════════════════════════
// Cadeia obrigatória:
//   AI → ToolRegistry → permission/tenant guard → domain service → GoDoutor
// Nenhuma tool acessa SQL/documento cru. Toda chamada revalida autorização
// no servidor e gera audit event. A mensagem do paciente é DADO NÃO
// CONFIÁVEL — nunca define businessId, permissão nem tool escolhida.
import type { DB, MemberRole, PermissionId } from '../types';

export type ToolDomain = 'clinic' | 'agenda' | 'people' | 'vet' | 'crm';
export type ToolSideEffect = 'read' | 'write' | 'destructive';

/** Campo simples de schema (sem lib externa — validação determinística). */
export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required?: boolean;
  max?: number;
  /** Enum de valores aceitos (strings). */
  enum?: string[];
  description?: string;
}

export interface ToolCallActor {
  userId: string;
  email: string;
  name?: string;
  role: MemberRole | 'MASTER' | '';
}

/**
 * Contexto de chamada — businessId e permissions vêm SEMPRE da sessão
 * autenticada. `patientMessage` (se houver) é untrusted e só pode ser usado
 * como dado textual dentro da tool, nunca como autorização.
 */
export interface ToolCallContext {
  db: DB;
  businessId: string;
  actor: ToolCallActor;
  permissions: Record<PermissionId, boolean>;
  /** Suporte em modo visualização / viewer — bloqueia escrita. */
  readOnly?: boolean;
  /** Mensagem do paciente (untrusted). Nunca concede permissões. */
  patientMessage?: string;
  /** Chave de idempotência p/ tools de escrita (anti-duplicidade). */
  idempotencyKey?: string;
  /** Confirmação humana para ação importante/destrutiva. */
  confirmed?: boolean;
  now?: string;
}

export type ToolErrorCode =
  | 'unknown_tool'
  | 'invalid_input'
  | 'forbidden'
  | 'tenant_mismatch'
  | 'not_found'
  | 'needs_confirm'
  | 'conflict'
  | 'denied_clinical'
  | 'read_only'
  | 'error';

export interface ToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  data?: T;
  error?: string;
  code?: ToolErrorCode;
  /** Ação importante aguardando confirmação do humano/paciente. */
  needsConfirm?: boolean;
  /** Resumo curto p/ audit (sem chain-of-thought). */
  summary?: string;
}

export interface ToolDef<I = Record<string, unknown>, O = unknown> {
  name: string;
  description: string;
  domain: ToolDomain;
  sideEffect: ToolSideEffect;
  /** Permissão da sessão exigida (null = leitura básica de tenant). */
  requiresPermission: PermissionId | null;
  /**
   * Ação importante: exige `confirmed:true` antes de executar
   * (criar/remarcar/cancelar booking quando a conversa pedir).
   */
  requiresConfirm: boolean;
  inputSchema: SchemaField[];
  outputSchema: SchemaField[] | 'any';
  /**
   * Handler PURO de domínio — recebe ctx.businessId JÁ validado.
   * Nunca aceita businessId vindo do input.
   */
  handler: (input: I, ctx: ToolCallContext) => O;
}
