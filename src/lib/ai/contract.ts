// ═══════════════════════════════════════════════════════════════
// P5.0 — CONTRATO IA ↔ P4
// ═══════════════════════════════════════════════════════════════
// A IA NÃO tem um formato próprio de workflow. O contrato interno é o
// modelo canônico do P4:
//
//   trigger (evento) · conditions · actions · waits · branches
//   nodes[] · edges[] · node IDs · settings (reentry, dedupe)
//   businessId · campos do catálogo · parâmetros das ações
//   referências a lead / customer / booking (pelo CONTEXTO do evento)
//
// Este módulo só empacota o catálogo já existente (model.ts) + o recorte
// do tenant. Nada de segundo grafo, nada de linguagem executável.
import type {
  AiPlan, AiPlanStep, AutomationCondition, AutomationEventId, AutomationSettings, DB,
} from '../types';
import {
  AUTOMATION_ACTION_DEFS, AUTOMATION_EVENT_DEFS, AUTOMATION_FIELDS,
  automationActionDef, automationEventDef, fieldsForEvent, isAutomationEvent,
  isFieldAllowed, type AutomationActionDef, type AutomationEventDef, type AutomationFieldDef,
} from '../automation/model';
import type { LinearStep } from '../automation/model';
import { capabilityStateFor, hasCapability, limitsFor, type CapabilityLimits } from '../automation/capabilities';
import { getBusinessPipeline, validateAssignedUser } from '../pipeline';
import { isFeatureEnabled } from '../features';

export const AI_PROMPT_MAX = 2000;
export const AI_NAME_MAX = 80;
export const AI_DESCRIPTION_MAX = 300;
export const AI_TEMPLATE_ID = 'ai';

export interface AiCatalog {
  events: AutomationEventDef[];
  fields: AutomationFieldDef[];
  actions: AutomationActionDef[];
}

/** Vocabulário fechado que a IA pode usar — o mesmo do editor e do motor. */
export function aiCatalog(): AiCatalog {
  return {
    events: AUTOMATION_EVENT_DEFS,
    fields: AUTOMATION_FIELDS,
    actions: AUTOMATION_ACTION_DEFS,
  };
}

export interface AiMemberRef {
  userId: string;
  name: string;
  role?: string;
  note?: string;
}

export interface AiTenantContext {
  businessId: string;
  businessName: string;
  stages: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  members: AiMemberRef[];
  professionals: Array<{ id: string; name: string }>;
  limits: CapabilityLimits;
  caps: Record<string, boolean>;
  hasBookings: boolean;
  aiEnabled: boolean;
}

/**
 * Recorte do tenant para a IA. Só dados DESTA unidade — nunca o documento
 * inteiro. Se o negócio não existe, devolve null (o chamador recusa).
 */
export function tenantContextFor(db: DB, businessId: string): AiTenantContext | null {
  const id = String(businessId || '').trim();
  if (!id) return null;
  const business = (db.businesses || []).find((b) => b.id === id);
  if (!business) return null;
  const pipeline = getBusinessPipeline(db, id);
  const members: AiMemberRef[] = (db.members || [])
    .filter((m) => m.businessId === id && m.active !== false)
    .map((m) => ({
      userId: m.userId,
      name: (db.users || []).find((u) => u.id === m.userId)?.name || m.note || 'Membro',
      role: m.role,
      note: m.note,
    }));
  if (business.ownerId && !members.some((m) => m.userId === business.ownerId)) {
    const owner = (db.users || []).find((u) => u.id === business.ownerId);
    if (owner) members.unshift({ userId: owner.id, name: owner.name, role: 'OWNER', note: 'Dono' });
  }
  return {
    businessId: id,
    businessName: business.name,
    stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name })),
    services: (db.services || [])
      .filter((s) => s.businessId === id && s.active !== false)
      .map((s) => ({ id: s.id, name: s.name })),
    members,
    professionals: (db.professionals || [])
      .filter((p) => p.businessId === id && p.active !== false)
      .map((p) => ({ id: p.id, name: p.name })),
    limits: limitsFor(business),
    caps: capabilityStateFor(business),
    hasBookings: isFeatureEnabled(business, 'bookings'),
    aiEnabled: hasCapability(business, 'automation.ai'),
  };
}

export function emptyPlan(prompt = ''): AiPlan {
  return {
    name: '',
    description: '',
    prompt: String(prompt || '').slice(0, AI_PROMPT_MAX),
    event: 'lead.created',
    condition: null,
    steps: [],
    elseSteps: [],
    settings: {},
    confidence: 0,
    assumptions: [],
    unresolved: [],
  };
}

/** LinearStep do P4 ← passo persistido (mesma forma). */
export function asLinearSteps(steps: AiPlanStep[] | undefined): LinearStep[] {
  return (steps || []).map((s) => ({
    kind: s.kind,
    label: s.label,
    action: s.action,
    wait: s.wait,
    condition: s.condition,
  }));
}

export function planSettings(plan: AiPlan): AutomationSettings {
  return plan.settings && typeof plan.settings === 'object' ? plan.settings : {};
}

export function isKnownEvent(id: unknown): id is AutomationEventId {
  return isAutomationEvent(id);
}

export function fieldAllowedForEvent(path: string, event: AutomationEventId): boolean {
  return isFieldAllowed(path, event);
}

export function fieldsOfEvent(event: AutomationEventId): AutomationFieldDef[] {
  return fieldsForEvent(event);
}

export function actionKnown(type: unknown): boolean {
  return !!automationActionDef(type);
}

export function eventEntityOf(event: AutomationEventId): 'lead' | 'customer' | 'booking' | 'encounter' | 'conversation' | 'message' | 'patient' | '' {
  return automationEventDef(event)?.entity || '';
}

/**
 * Classifica uma referência de usuário: pertence a ESTA unidade, não existe,
 * ou pertence a OUTRA unidade (vazamento cross-tenant — sempre erro).
 */
export function classifyUserRef(
  db: DB,
  businessId: string,
  userId: string,
): 'ok' | 'missing' | 'cross-tenant' | 'empty' {
  const id = String(userId || '').trim();
  if (!id) return 'empty';
  const check = validateAssignedUser(db, businessId, id);
  if (check.valid) return 'ok';
  const otherMember = (db.members || []).some((m) => m.userId === id && m.businessId !== businessId);
  const otherOwner = (db.businesses || []).some((b) => b.ownerId === id && b.id !== businessId);
  if (otherMember || otherOwner) return 'cross-tenant';
  return 'missing';
}

export function classifyServiceRef(
  db: DB,
  businessId: string,
  serviceId: string,
): 'ok' | 'missing' | 'cross-tenant' | 'empty' {
  const id = String(serviceId || '').trim();
  if (!id) return 'empty';
  const svc = (db.services || []).find((s) => s.id === id);
  if (!svc) return 'missing';
  if (svc.businessId !== businessId) return 'cross-tenant';
  return 'ok';
}

export function classifyProfessionalRef(
  db: DB,
  businessId: string,
  professionalId: string,
): 'ok' | 'missing' | 'cross-tenant' | 'empty' {
  const id = String(professionalId || '').trim();
  if (!id) return 'empty';
  const pro = (db.professionals || []).find((p) => p.id === id);
  if (!pro) return 'missing';
  if (pro.businessId !== businessId) return 'cross-tenant';
  return 'ok';
}

export function classifyStageRef(
  ctx: AiTenantContext,
  stageId: string,
): 'ok' | 'missing' | 'empty' {
  const id = String(stageId || '').trim();
  if (!id) return 'empty';
  return ctx.stages.some((s) => s.id === id) ? 'ok' : 'missing';
}

export function cleanPrompt(input: unknown): string {
  return String(input ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, AI_PROMPT_MAX);
}

export type { AutomationCondition, LinearStep };
