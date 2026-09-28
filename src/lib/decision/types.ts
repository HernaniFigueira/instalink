// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — DecisionEngine (TypeSafe/Jev-ready)
// ═══════════════════════════════════════════════════════════════
// Abstração de decisões estruturadas ("System One") para o Jev/TypeSafe.
//
// FONTE DO CONTRATO (nada inventado): skill oficial `typesafe-ai` instalada
// via `npx skills add typesafe-ai/skills --skill typesafe-ai` + docs live:
//   • https://docs.typesafe.ai/primitives.md — Choice/Noul/Score
//   • https://docs.typesafe.ai/confidence.md — confidence 0–1 derivado da
//     distribuição de probabilidades (Choice/Score; Noul não carrega)
//   • https://docs.typesafe.ai/patterns/confidence-routing.md — routing por
//     confiança (a resposta diz O QUÊ; a confiança diz SE age)
//
// Shape documentado (SDK Python/JS): client.system_one(state, questions) →
// answers[id].{choice|noul|score} + probabilities + confidence.
//
// ESTADO: nenhum chamada externa real acontece nesta fundação (sem
// TYPESAFE_API_KEY). TypeSafeDecisionEngine existe ESTRUTURALMENTE e
// permanece desativado quando a chave falta — o GoDoutor nunca quebra.
//
// CONCEITOS preparados: Choice, Noul, Score, confidence, routing.

export type DecisionQuestionId = string;

/** Escolha única de um conjunto fechado (distribuição compara as opções). */
export interface ChoiceQuestion {
  kind: 'choice';
  /** Instrução com o sentido COMPLETO da pergunta (vai ao modelo). */
  instructions: string;
  /** critério de cada opção fechada: opção → descrição. */
  criteria: Record<string, string>;
}

/** Probabilidade de uma afirmação ser verdadeira (0..1). Sem confidence. */
export interface NoulQuestion {
  kind: 'noul';
  instructions: string;
}

/** Grau ao longo de níveis ORDENADOS descritos (prob por nível). */
export interface ScoreQuestion {
  kind: 'score';
  instructions: string;
  /** Níveis ordenos, do menor ao maior, cada um descrevendo uma situação. */
  criteria: string[];
}

export type DecisionQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export interface ChoiceAnswer {
  kind: 'choice';
  /** Opção vencedora (ou '' em empate exato). */
  choice: string;
  /** Probabilidade de cada opção (0..1; soma 1). */
  probabilities: Record<string, number>;
  /** Concentração da distribuição (0..1) — não é "correza" do workflow. */
  confidence: number;
}

export interface NoulAnswer {
  kind: 'noul';
  /** Probabilidade de "sim" (0..1). */
  noul: number;
}

export interface ScoreAnswer {
  kind: 'score';
  /** Índice do nível escolhido (0..criteria.length-1). */
  score: number;
  probabilities: number[];
  confidence: number;
}

export type DecisionAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface DecisionRequest {
  businessId: string;
  /** Feature do GoDoutor que pede a decisão (para telemetria/routing). */
  feature: string;
  /** Estado NÃO confiável: dados resolvidos pelo servidor (nunca autorização). */
  state: Record<string, unknown>;
  questions: Record<DecisionQuestionId, DecisionQuestion>;
  /** Roteamento por confiança (opcional): limiar para agir sozinho. */
  routing?: { autoActMinConfidence?: number };
}

export interface DecisionResult {
  ok: boolean;
  answers: Record<DecisionQuestionId, DecisionAnswer>;
  /** 'disabled' = sem engine · 'mock' · 'typesafe' · 'blocked' = sem credencial. */
  via: 'disabled' | 'mock' | 'typesafe' | 'blocked';
  model?: string;
  latencyMs: number;
  error?: string;
}

/**
 * Contrato único do motor de decisões. O DOMÍNIO depende só desta interface —
 * nunca do fornecedor (Jev/TypeSafe hoje; qualquer outro amanhã).
 */
export interface DecisionEngine {
  readonly id: string;
  /** Engine está operacional? (false = desativado por configuração/credencial). */
  isAvailable(): boolean;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}
