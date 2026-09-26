// ═══════════════════════════════════════════════════════════════
// F3 — AIProvider + AutomationComposer (arquitetura do Composer REAL)
// ═══════════════════════════════════════════════════════════════
// Fluxo: NL → AIProvider → AutomationProposal → schema validation
//        → policy/permission → preview → testar → aprovar/ativar
// A IA NUNCA grava/ativa diretamente.
//
// FALLBACK determinístico (refinePlan/planFromPrompt) permanece:
//   • instruções inequivocamente simples → refinePlan sem LLM;
//   • não compreendeu → não altera o plano → encaminha ao AIProvider.
//
// Credencial: se não houver provider autorizado nesta sessão,
// registre BLOCKED_AI_PROVIDER_CREDENTIAL e siga com mocks/tests.
import type { AiPlan } from '../types';

export interface AIProviderConfig {
  /** Identificador estável (ex.: 'openai' | 'anthropic' | 'internal-mock'). */
  id: string;
  model?: string;
  /** Nunca no cliente; só servidor. */
  apiKeyEnv?: string;
}

export interface AIProviderCompleteInput {
  businessId: string;
  /** Pedido livre do usuário (pt-BR). */
  prompt: string;
  /** Plano atual quando for edição conversacional via IA. */
  currentPlan?: AiPlan | null;
  /** Contexto de tenant já resolvido (catálogo fechado P4). */
  catalog: {
    stages: Array<{ id: string; name: string }>;
    services: Array<{ id: string; name: string }>;
    members: Array<{ userId: string; name: string }>;
  };
}

export interface AIProviderCompleteResult {
  ok: boolean;
  plan?: AiPlan;
  error?: string;
  /** 'provider' = IA real · 'fallback' = determinístico · 'blocked' = sem credencial */
  via?: 'provider' | 'fallback' | 'blocked';
}

/**
 * Interface do provedor de LLM. Implementações reais não carregam chave
 * aqui — só lêem `apiKeyEnv` no servidor. Sem chave → BLOCKED_AI_PROVIDER_CREDENTIAL.
 */
export interface AIProvider {
  readonly config: AIProviderConfig;
  complete(input: AIProviderCompleteInput): Promise<AIProviderCompleteResult>;
}

export const BLOCKED_AI_PROVIDER_CREDENTIAL = 'BLOCKED_AI_PROVIDER_CREDENTIAL' as const;

/**
 * Provider ausente/bloqueado (estado desta sessão sem credencial autorizada).
 * NÃO inventa chave nem modelo.
 */
export function blockedAIProvider(reason = 'nenhuma credencial de provider autorizada nesta sessão'): AIProvider {
  return {
    config: { id: 'blocked', apiKeyEnv: '' },
    async complete() {
      return {
        ok: false,
        via: 'blocked',
        error: `${BLOCKED_AI_PROVIDER_CREDENTIAL}: ${reason}`,
      };
    },
  };
}

/**
 * Dupla checagem do Composer:
 * 1) refinePlan se a instrução for simples e inequívoca;
 * 2) senão AIProvider (se blocked → devolve erro honesto, NÃO finge IA).
 */
export async function composeWithFallback(opts: {
  provider: AIProvider;
  refine: () => { ok: boolean; plan?: AiPlan; changes?: string[] };
  complete: AIProviderCompleteInput;
}): Promise<AIProviderCompleteResult & { changes?: string[] }> {
  const local = opts.refine();
  if (local.ok && local.plan) {
    return { ok: true, via: 'fallback', plan: local.plan, changes: local.changes || [] };
  }
  const out = await opts.provider.complete(opts.complete);
  if (!out.ok) {
    // Instrução simples não entendeu E provider bloqueado → não altera plano.
    return out;
  }
  return out;
}
