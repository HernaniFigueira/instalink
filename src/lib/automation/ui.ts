// ═══════════════════════════════════════════════════════════════
// CATÁLOGO COMPARTILHADO (cliente ⇄ servidor) — só o que é PURO
// ═══════════════════════════════════════════════════════════════
// A tela de automações precisa dos mesmos rótulos/limites que o servidor usa
// para validar — sem importar o motor (que toca o banco). Este arquivo é a
// fachada segura: reexporta apenas módulos puros (model/conditions/capabilities).
export {
  AUTOMATION_ACTION_DEFS, AUTOMATION_EVENT_DEFS, NODE_TYPE_DEFS, WAIT_MINUTE_PRESETS,
  automationActionDef, automationEventDef, automationEventLabel, automationFieldDef,
  automationFieldLabel, fieldsForEvent, humanDuration, isFieldAllowed,
  type AutomationActionDef, type AutomationActionFieldDef, type AutomationEventDef,
  type AutomationFieldDef, type LinearAutomation, type LinearStep,
} from './model';
export { CONDITION_OPERATORS } from '../types';
export type { ConditionOperator } from '../types';
export { describeCondition } from './conditions';
export { CAPABILITIES, capabilityDef, type CapabilityId } from './capabilities';
export type { CapabilityLimits } from './capabilities';
