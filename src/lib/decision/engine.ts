// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — DecisionEngine: implementações
// ═══════════════════════════════════════════════════════════════
// DisabledDecisionEngine  → padrão SEM TYPESAFE_API_KEY (nunca quebra nada);
// MockDecisionEngine      → determinístico p/ testes/fixtures (sem rede);
// TypeSafeDecisionEngine  → estrutural; só fala com a API quando há chave
//                           válida no SERVIDOR (nunca no frontend).
//
// Cadeia de segurança preservada: quem consome decisões continua passando
// pelo ToolRegistry (tenant guard → permission → confirm → domain service →
// audit). Este módulo decide SEM agir — nunca escreve no domínio sozinho.
import type {
  ChoiceAnswer, DecisionAnswer, DecisionEngine, DecisionQuestion, DecisionRequest,
  DecisionResult, NoulAnswer, ScoreAnswer,
} from './types';

const nowMs = () => Date.now();

/** Resposta vazia e explícita — sem engine, sem achismo. */
export class DisabledDecisionEngine implements DecisionEngine {
  readonly id = 'disabled';
  isAvailable() { return false; }
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    return {
      ok: false,
      answers: {},
      via: 'disabled',
      latencyMs: 0,
      error: 'DecisionEngine desativado (sem TYPESAFE_API_KEY). Nenhuma decisão automática foi tomada.',
      ...(request.routing ? {} : {}),
    };
  }
}

/**
 * Mock determinístico: útil em testes/fixtures — responde sempre o primeiro
 * critério com confiança fixa. NUNCA usado em produção (factory garante).
 */
export class MockDecisionEngine implements DecisionEngine {
  readonly id = 'mock';
  isAvailable() { return true; }
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const started = nowMs();
    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, q] of Object.entries(request.questions)) {
      answers[id] = mockAnswer(q);
    }
    return { ok: true, answers, via: 'mock', model: 'mock-deterministic', latencyMs: nowMs() - started };
  }
}

function mockAnswer(q: DecisionQuestion): DecisionAnswer {
  if (q.kind === 'choice') {
    const options = Object.keys(q.criteria);
    const first = options[0] ?? '';
    const probabilities: Record<string, number> = {};
    for (const o of options) probabilities[o] = o === first ? 0.9 : 0.1 / Math.max(1, options.length - 1);
    return { kind: 'choice', choice: first, probabilities, confidence: 0.9 } satisfies ChoiceAnswer;
  }
  if (q.kind === 'noul') return { kind: 'noul', noul: 0.95 } satisfies NoulAnswer;
  const levels = q.criteria.length;
  const probabilities = q.criteria.map((_, i) => (i === levels - 1 ? 0.9 : 0.1 / Math.max(1, levels - 1)));
  return { kind: 'score', score: levels - 1, probabilities, confidence: 0.9 } satisfies ScoreAnswer;
}

/**
 * TypeSafe/Jev — implementação ESTRUTURAL.
 *
 * Contrato de chamada (docs): `system_one(state, questions)` com as
 * primitivas Choice/Noul/Score; as respostas trazem choice/noul/score +
 * probabilities + confidence. A comunicação real fica isolada em
 * `callSystemOne` — uma única função que NÃO executa sem `TYPESAFE_API_KEY`
 * no servidor. Sem chave → resultado `blocked` (o fluxo do GoDoutor segue
 * funcionando sem decisão automática).
 */
export class TypeSafeDecisionEngine implements DecisionEngine {
  readonly id = 'typesafe';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts?: { apiKey?: string; baseUrl?: string }) {
    this.apiKey = opts?.apiKey || '';
    this.baseUrl = opts?.baseUrl || 'https://api.typesafe.ai';
  }

  isAvailable() { return Boolean(this.apiKey); }

  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const started = nowMs();
    if (!this.isAvailable()) {
      return {
        ok: false, answers: {}, via: 'blocked', latencyMs: 0,
        error: 'TYPESAFE_API_KEY ausente — decisão automática bloqueada (fail-closed).',
      };
    }
    try {
      const answers = await callSystemOne(this.apiKey, this.baseUrl, request);
      return { ok: true, answers, via: 'typesafe', model: 'jev-system-one', latencyMs: nowMs() - started };
    } catch (err) {
      return {
        ok: false, answers: {}, via: 'blocked', latencyMs: nowMs() - started,
        error: err instanceof Error ? err.message : 'Falha ao consultar o TypeSafe.',
      };
    }
  }
}

/**
 * Ponto ÚNICO de saída de rede (TypeSafe HTTP API). Mantida isolada para a
 * integração real ser plugada/testada num commit próprio (F8) sem tocar o
 * domínio.
 *
 * ⚠️ PROVISÓRIO: endpoint/header abaixo são estimativa de integração até
 * validação contra as docs live com a chave real (podem mudar sem breaking
 * change — o contrato estável é a porta DecisionEngine, não este HTTP).
 */
async function callSystemOne(
  apiKey: string,
  baseUrl: string,
  request: DecisionRequest,
): Promise<Record<string, DecisionAnswer>> {
  const res = await fetch(`${baseUrl}/v1/system_one`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
      'x-typesafe-business': request.businessId, // telemetria de tenant (sem dados clínicos)
    },
    body: JSON.stringify({
      state: request.state,
      questions: request.questions,
      feature: request.feature,
    }),
  });
  if (!res.ok) throw new Error(`TypeSafe HTTP ${res.status}`);
  const data = (await res.json()) as { answers?: Record<string, DecisionAnswer> };
  return data.answers || {};
}

/**
 * Factory do engine: SEM chave → Disabled (padrão seguro); `mock` explícito
 * (env GODOUTOR_DECISION_ENGINE=mock) → Mock p/ testes; com chave → TypeSafe.
 */
export function getDecisionEngine(env: Record<string, string | undefined> = process.env): DecisionEngine {
  if (env.GODOUTOR_DECISION_ENGINE === 'mock') return new MockDecisionEngine();
  const apiKey = env.TYPESAFE_API_KEY || '';
  if (!apiKey) return new DisabledDecisionEngine();
  return new TypeSafeDecisionEngine({ apiKey });
}
