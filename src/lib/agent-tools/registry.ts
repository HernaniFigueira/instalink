// ═══════════════════════════════════════════════════════════════
// F3-D — TOOL REGISTRY (única porta de chamada do Conversation Agent)
// ═══════════════════════════════════════════════════════════════
// AI → ToolRegistry → permission/tenant guard → domain service → GoDoutor
//
// • Tool desconhecada (inclusive clínica) → NEGADA.
// • businessId SEMPRE da sessão; input nunca troca tenant.
// • Audit: agent.tool_called | agent.tool_denied | agent.tool_failed
//   (meta curto — SEM chain-of-thought).
import { randomUUID } from 'node:crypto';
import { pushAudit } from '../audit';
import type { ToolCallContext, ToolDef, ToolResult } from './types';
import { validateInput } from './schema';
import { authorizeToolCall, denyClinicalTool, looksLikeInjection } from './guard';
import { clinicTools } from './tools/clinic';
import { agendaTools } from './tools/agenda';
import { peopleTools } from './tools/people';
import { vetTools } from './tools/vet';
import { crmTools } from './tools/crm';

// Catálogo fechado — a IA só pode invocar nomes registrados aqui.
const ALL_TOOLS: ToolDef<any, any>[] = [
  ...clinicTools,
  ...agendaTools,
  ...peopleTools,
  ...vetTools,
  ...crmTools,
];

const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function listTools(): Array<Pick<
  ToolDef, 'name' | 'description' | 'domain' | 'sideEffect' | 'requiresPermission' | 'requiresConfirm' | 'inputSchema'
>> {
  return ALL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    domain: t.domain,
    sideEffect: t.sideEffect,
    requiresPermission: t.requiresPermission,
    requiresConfirm: t.requiresConfirm,
    inputSchema: t.inputSchema,
  }));
}

export function getTool(name: string): ToolDef<any, any> | undefined {
  return BY_NAME.get(String(name || ''));
}

/** Idempotência simples em memória do doc (idempotencyKeys) por chamada. */
function idempotentReplay(
  ctx: ToolCallContext,
  toolName: string,
): ToolResult | null {
  if (!ctx.idempotencyKey) return null;
  const db: any = ctx.db;
  if (!Array.isArray(db.idempotencyKeys)) db.idempotencyKeys = [];
  const endpoint = `agent-tool:${toolName}`;
  const hit = db.idempotencyKeys.find(
    (r: any) => r.businessId === ctx.businessId && r.key === ctx.idempotencyKey && r.endpoint === endpoint,
  );
  if (!hit) return null;
  const body = hit.responseBody || {};
  return {
    ok: true,
    tool: toolName,
    data: body.data,
    summary: body.summary || 'replay idempotente',
  };
}

function saveIdempotent(ctx: ToolCallContext, toolName: string, result: ToolResult): void {
  if (!ctx.idempotencyKey || !result.ok) return;
  const db: any = ctx.db;
  if (!Array.isArray(db.idempotencyKeys)) db.idempotencyKeys = [];
  const endpoint = `agent-tool:${toolName}`;
  const exists = db.idempotencyKeys.some(
    (r: any) => r.businessId === ctx.businessId && r.key === ctx.idempotencyKey && r.endpoint === endpoint,
  );
  if (exists) return;
  db.idempotencyKeys.push({
    id: randomUUID(),
    businessId: ctx.businessId,
    key: ctx.idempotencyKey.slice(0, 128),
    endpoint,
    statusCode: 200,
    responseBody: { data: result.data, summary: result.summary },
    createdAt: ctx.now || new Date().toISOString(),
  });
}

function audit(
  ctx: ToolCallContext,
  action: 'agent.tool_called' | 'agent.tool_denied' | 'agent.tool_failed',
  meta: Record<string, unknown>,
): void {
  pushAudit(ctx.db, {
    action,
    actor: { id: ctx.actor.userId, email: ctx.actor.email, role: ctx.actor.role || undefined },
    businessId: ctx.businessId,
    meta,
  }, ctx.now);
}

/**
 * Executa uma tool com guards completos. Nunca grava chain-of-thought.
 */
export function callTool(
  toolName: string,
  rawInput: unknown,
  ctx: ToolCallContext,
): ToolResult {
  const started = ctx.now || new Date().toISOString();
  const callId = randomUUID();

  // Ferramenta clínica proibida (não registrada) — negação explícita.
  const clinicalDeny = denyClinicalTool(toolName);
  if (clinicalDeny) {
    audit(ctx, 'agent.tool_denied', {
      callId, tool: toolName, code: clinicalDeny.code, reason: 'clinical_scope',
    });
    return { ok: false, tool: toolName, code: clinicalDeny.code, error: clinicalDeny.error };
  }

  const tool = getTool(toolName);
  if (!tool) {
    audit(ctx, 'agent.tool_denied', {
      callId, tool: String(toolName || ''), code: 'unknown_tool', reason: 'not_in_registry',
    });
    return {
      ok: false,
      tool: String(toolName || ''),
      code: 'unknown_tool',
      error: 'Ferramenta não existe no registro autorizado.',
    };
  }

  // Input: descarta businessId/tenant do payload (guard também valida).
  const inputForGuard = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>;

  const auth = authorizeToolCall(tool as ToolDef<never, unknown>, ctx, inputForGuard);
  if (!auth.ok) {
    audit(ctx, 'agent.tool_denied', {
      callId,
      tool: tool.name,
      code: auth.code,
      domain: tool.domain,
      sideEffect: tool.sideEffect,
      reason: auth.error,
      injection: looksLikeInjection(ctx.patientMessage),
    });
    return {
      ok: false,
      tool: tool.name,
      code: auth.code,
      error: auth.error,
      needsConfirm: auth.code === 'needs_confirm' || undefined,
    };
  }

  const validated = validateInput(tool.inputSchema, rawInput);
  if (!validated.ok) {
    audit(ctx, 'agent.tool_denied', {
      callId, tool: tool.name, code: 'invalid_input', errors: validated.errors.slice(0, 5),
    });
    return {
      ok: false,
      tool: tool.name,
      code: 'invalid_input',
      error: validated.errors.join('; '),
    };
  }

  // Anti-duplicidade em tools de escrita/destrutiva.
  if (tool.sideEffect !== 'read') {
    const replay = idempotentReplay(ctx, tool.name);
    if (replay) {
      audit(ctx, 'agent.tool_called', {
        callId, tool: tool.name, domain: tool.domain, sideEffect: tool.sideEffect,
        idempotentReplay: true, ok: true,
      });
      return replay;
    }
  }

  try {
    const data = tool.handler(validated.value as never, ctx);
    const summary = typeof data === 'object' && data !== null
      ? `ok · keys=${Object.keys(data as object).slice(0, 6).join(',')}`
      : 'ok';
    const result: ToolResult = { ok: true, tool: tool.name, data, summary };

    if (tool.sideEffect !== 'read') saveIdempotent(ctx, tool.name, result);

    audit(ctx, 'agent.tool_called', {
      callId,
      tool: tool.name,
      domain: tool.domain,
      sideEffect: tool.sideEffect,
      ok: true,
      // meta curto, sem prompt do paciente e sem reasoning
      inputKeys: Object.keys(validated.value).slice(0, 8),
      idempotencyKey: ctx.idempotencyKey ? true : false,
    });
    return result;
  } catch (e: any) {
    const msg = String(e?.message || 'erro na ferramenta');
    audit(ctx, 'agent.tool_failed', {
      callId,
      tool: tool.name,
      domain: tool.domain,
      code: e?.status === 404 ? 'not_found' : e?.status === 409 ? 'conflict' : 'error',
      status: e?.status || 500,
      // mensagem de erro curta — sem stacktrace para o usuário
      error: msg.slice(0, 200),
    });
    return {
      ok: false,
      tool: tool.name,
      code: e?.status === 404 ? 'not_found' : e?.status === 409 ? 'conflict' : 'error',
      error: msg.slice(0, 300),
    };
  }
}
