// ═══════════════════════════════════════════════════════════════
// P5 — FACHADA DA CAMADA DE IA (por cima do P4)
// ═══════════════════════════════════════════════════════════════
// USUÁRIO → P5 (interpreta) → plano → validação → grafo do P4
//        → aprovação humana → P4 executor → serviços oficiais
export { aiCatalog, tenantContextFor, emptyPlan, planSettings, AI_PROMPT_MAX, AI_TEMPLATE_ID } from './contract';
export type { AiCatalog, AiTenantContext } from './contract';
export { planFromPrompt, AI_PROMPT_EXAMPLES } from './planner';
export { planToGraph, planToDraft, compileAndValidatePlan, extraAiChecks } from './compile';
export { presentPlan, presentProposal } from './present';
export type { AiPresentation, PresentedLine } from './present';
export {
  generateProposal, regenerateProposal, editProposal, approveProposal,
  cancelProposal, publishProposal, approveAndPublish,
  proposalsOf, findProposal, proposalView,
} from './proposals';
export type { ProposalView, GenerateResult, PublishResult } from './proposals';
export { observeBusiness, explainRun } from './observe';
export type { BusinessObservation, ObservedFailure, ObservedSuggestion } from './observe';
export { simulatePlan } from './simulate';
export type { SimulationResult, SimulatedStep } from './simulate';
export { refinePlan } from './refine';
export type { RefineResult } from './refine';
