// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — GenerativeAIProvider (LLM generativa)
// ═══════════════════════════════════════════════════════════════
// O Jev (DecisionEngine) NÃO substitui LLM generativa. Este contrato cobre
// o outro lado: respostas naturais, resumos, relatórios, documentos e
// transformação de dados estruturados em linguagem.
//
// REGRAS:
//   • o DOMÍNIO depende SÓ da interface — nunca de OpenAI/OpenRouter/Gemini;
//   • nenhum fornecedor é escolhido nesta fundação; a chave NÃO é exigida;
//   • sem provider configurado → Disabled (o GoDoutor continua 100%);
//   • toda chamada gera telemetria de custo (lib/ai/usage) SEM prompts
//     clínicos completos;
//   • ações clínicas finais continuam de responsabilidade humana — geração
//     de texto NUNCA assina prontuário/prescrição.
import type { AiUsageRecord } from './usage';
import { recordAiUsage } from './usage';
import type { DB } from '../types';

export type GenerativeTask =
  | 'reply_suggestion'   // sugestão de resposta natural
  | 'summary'            // resumo de contexto
  | 'report'             // relatório em linguagem
  | 'document_text'      // texto de documento
  | 'data_to_language';  // estruturado → linguagem

export interface GenerativeRequest {
  businessId: string;
  /** Feature GoDoutor dona da chamada (telemetria/custo por clínica). */
  feature: string;
  task: GenerativeTask;
  /** Prompt já montado pelo DOMÍNIO (nunca o usuário direto). */
  prompt: string;
  system?: string;
  maxTokens?: number;
  /** Identificação estável do agente/feature (telemetria). */
  agentId?: string;
}

export interface GenerativeResult {
  ok: boolean;
  text: string;
  via: 'disabled' | 'mock' | 'provider';
  provider: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
}

/**
 * Interface única de LLM generativa. Implementações futuras: OpenAI,
 * OpenRouter, Gemini, Anthropic, outro — todas plugam AQUI, sem vazar
 * fornecedor para o domínio.
 */
export interface GenerativeAIProvider {
  readonly id: string;
  isAvailable(): boolean;
  generate(request: GenerativeRequest): Promise<GenerativeResult>;
}

/** Padrão: sem fornecedor/chave → nada de geração, nada quebrado. */
export class DisabledGenerativeProvider implements GenerativeAIProvider {
  readonly id = 'disabled';
  isAvailable() { return false; }
  async generate(request: GenerativeRequest): Promise<GenerativeResult> {
    return {
      ok: false, text: '', via: 'disabled', provider: 'disabled',
      inputTokens: 0, outputTokens: 0, latencyMs: 0,
      error: 'GenerativeAIProvider desativado (sem fornecedor configurado).',
    };
  }
}

/**
 * Mock determinístico p/ testes e fixtures — devolve texto canônico e
 * registra telemetria. NUNCA usado em produção (factory garante).
 */
export class MockGenerativeProvider implements GenerativeAIProvider {
  readonly id = 'mock';
  isAvailable() { return true; }
  async generate(request: GenerativeRequest): Promise<GenerativeResult> {
    const started = Date.now();
    const text = `[mock:${request.task}] ${request.prompt.slice(0, 120)}`;
    const result: GenerativeResult = {
      ok: true, text, via: 'mock', provider: 'mock', model: 'mock-generative-v1',
      inputTokens: Math.ceil(request.prompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
      latencyMs: Date.now() - started,
    };
    return result;
  }
}

/**
 * Registra a telemetria de uma chamada (custo por clínica). Chamado pelos
 * providers e pelo orquestrador; NUNCA guarda prompt clínico — só números.
 */
export function trackGenerativeUsage(db: DB, request: GenerativeRequest, result: GenerativeResult, extra?: Partial<AiUsageRecord>): AiUsageRecord {
  return recordAiUsage(db, {
    businessId: request.businessId,
    agentId: request.agentId || request.feature,
    feature: request.feature,
    provider: result.provider,
    model: result.model || 'unknown',
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
    ...extra,
  });
}

/**
 * Factory: sem env de fornecedor → Disabled. `GODOUTOR_GENAI=mock` → Mock
 * (testes). Futuro: `openai`/`openrouter`/`gemini` com chave no servidor.
 */
export function getGenerativeProvider(env: Record<string, string | undefined> = process.env): GenerativeAIProvider {
  if (env.GODOUTOR_GENAI === 'mock') return new MockGenerativeProvider();
  // Nenhum fornecedor real escolhido nesta fundação (sem chave = sem chamada).
  return new DisabledGenerativeProvider();
}
