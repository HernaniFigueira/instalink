// ═══════════════════════════════════════════════════════════════
// P5.4 — APROVAÇÃO HUMANA (ciclo de vida da proposta)
// ═══════════════════════════════════════════════════════════════
// A IA NUNCA publica sozinha. Estados:
//   draft → (editar / gerar de novo) → draft
//   draft → approve → approved
//   approved → (editar) → draft   (reedição exige nova aprovação)
//   approved → publish → published  (cria Automation do P4, active só se pedido)
//   * → cancel → cancelled
//
// Publicar chama o MESMO `validateAutomationDraft` da API de automações e
// grava em `db.automations`. O executor do P4 é quem roda depois.
import { randomUUID } from 'node:crypto';
import type { AiPlan, AiProposal, Automation, DB } from '../types';
import { automationsOf } from '../automation/model';
import { limitsFor } from '../automation/capabilities';
import { AI_PROMPT_MAX, cleanPrompt, tenantContextFor } from './contract';
import { compileAndValidatePlan, planToDraft } from './compile';
import { planFromPrompt } from './planner';
import { presentProposal, type AiPresentation } from './present';

export const MAX_LIVE_PROPOSALS_PER_BUSINESS = 40;

function nowISO(now?: string): string {
  return now || new Date().toISOString();
}

export function proposalsOf(db: DB, businessId: string): AiProposal[] {
  if (!Array.isArray(db.aiProposals)) return [];
  return db.aiProposals.filter((p) => p && p.businessId === businessId);
}

export function findProposal(db: DB, businessId: string, id: string): AiProposal | undefined {
  return proposalsOf(db, businessId).find((p) => p.id === id);
}

export interface ProposalView {
  id: string;
  businessId: string;
  status: AiProposal['status'];
  prompt: string;
  plan: AiPlan;
  nodes: AiProposal['nodes'];
  edges: AiProposal['edges'];
  validation: AiProposal['validation'];
  automationId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  presentation: AiPresentation;
}

export function proposalView(db: DB, proposal: AiProposal): ProposalView {
  const ctx = tenantContextFor(db, proposal.businessId);
  return {
    id: proposal.id,
    businessId: proposal.businessId,
    status: proposal.status,
    prompt: proposal.prompt,
    plan: proposal.plan,
    nodes: proposal.nodes || [],
    edges: proposal.edges || [],
    validation: proposal.validation,
    automationId: proposal.automationId || '',
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    publishedAt: proposal.publishedAt || '',
    presentation: presentProposal(proposal, ctx),
  };
}

function applyCompile(proposal: AiProposal, db: DB): void {
  const compiled = compileAndValidatePlan(db, proposal.businessId, proposal.plan);
  proposal.nodes = compiled.nodes;
  proposal.edges = compiled.edges;
  proposal.validation = { ok: compiled.ok, errors: compiled.errors, warnings: compiled.warnings };
}

export interface GenerateResult {
  ok: boolean;
  proposal?: AiProposal;
  errors: string[];
  warnings: string[];
}

/** Cria um rascunho a partir da linguagem natural. Nunca publica. */
export function generateProposal(
  db: DB,
  input: { businessId: string; prompt: string; userId?: string; now?: string },
): GenerateResult {
  const businessId = String(input.businessId || '').trim();
  const ctx = tenantContextFor(db, businessId);
  if (!ctx) return { ok: false, errors: ['Negócio não encontrado.'], warnings: [] };
  if (!ctx.aiEnabled) return { ok: false, errors: ['a geração por IA não está liberada para esta empresa'], warnings: [] };
  const prompt = cleanPrompt(input.prompt);
  if (!prompt) return { ok: false, errors: ['descreva o que você quer automatizar'], warnings: [] };

  const live = proposalsOf(db, businessId).filter((p) => p.status === 'draft' || p.status === 'approved');
  if (live.length >= MAX_LIVE_PROPOSALS_PER_BUSINESS) {
    return { ok: false, errors: [`limite de ${MAX_LIVE_PROPOSALS_PER_BUSINESS} propostas em aberto por empresa`], warnings: [] };
  }

  const plan = planFromPrompt(prompt, ctx);
  const now = nowISO(input.now);
  const proposal: AiProposal = {
    id: randomUUID(),
    businessId,
    status: 'draft',
    prompt: prompt.slice(0, AI_PROMPT_MAX),
    plan,
    nodes: [],
    edges: [],
    validation: { ok: false, errors: [], warnings: [] },
    createdByUserId: String(input.userId || ''),
    createdAt: now,
    updatedAt: now,
  };
  applyCompile(proposal, db);
  if (!Array.isArray(db.aiProposals)) db.aiProposals = [];
  db.aiProposals.push(proposal);
  return {
    ok: true,
    proposal,
    errors: proposal.validation.errors,
    warnings: proposal.validation.warnings,
  };
}

export function regenerateProposal(
  db: DB,
  input: { businessId: string; id: string; prompt?: string; now?: string },
): GenerateResult {
  const existing = findProposal(db, input.businessId, input.id);
  if (!existing) return { ok: false, errors: ['Proposta não encontrada.'], warnings: [] };
  if (existing.status === 'published' || existing.status === 'cancelled') {
    return { ok: false, errors: ['não é possível gerar de novo uma proposta encerrada'], warnings: [] };
  }
  const ctx = tenantContextFor(db, input.businessId);
  if (!ctx) return { ok: false, errors: ['Negócio não encontrado.'], warnings: [] };
  const prompt = cleanPrompt(input.prompt || existing.prompt);
  existing.prompt = prompt;
  existing.plan = planFromPrompt(prompt, ctx);
  existing.status = 'draft';
  existing.updatedAt = nowISO(input.now);
  existing.automationId = undefined;
  applyCompile(existing, db);
  return { ok: true, proposal: existing, errors: existing.validation.errors, warnings: existing.validation.warnings };
}

export function editProposal(
  db: DB,
  input: { businessId: string; id: string; plan?: Partial<AiPlan>; name?: string; description?: string; now?: string },
): GenerateResult {
  const existing = findProposal(db, input.businessId, input.id);
  if (!existing) return { ok: false, errors: ['Proposta não encontrada.'], warnings: [] };
  if (existing.status === 'published' || existing.status === 'cancelled') {
    return { ok: false, errors: ['proposta encerrada não pode ser editada'], warnings: [] };
  }
  if (input.plan) {
    existing.plan = {
      ...existing.plan,
      ...input.plan,
      steps: input.plan.steps || existing.plan.steps,
      elseSteps: input.plan.elseSteps !== undefined ? input.plan.elseSteps : existing.plan.elseSteps,
      assumptions: existing.plan.assumptions,
      unresolved: existing.plan.unresolved,
      prompt: existing.plan.prompt,
    };
  }
  if (typeof input.name === 'string' && input.name.trim()) existing.plan.name = input.name.trim().slice(0, 80);
  if (typeof input.description === 'string') existing.plan.description = input.description.trim().slice(0, 300);
  existing.status = 'draft'; // reedição exige nova aprovação
  existing.updatedAt = nowISO(input.now);
  applyCompile(existing, db);
  return { ok: true, proposal: existing, errors: existing.validation.errors, warnings: existing.validation.warnings };
}

export function approveProposal(
  db: DB,
  input: { businessId: string; id: string; now?: string },
): GenerateResult {
  const existing = findProposal(db, input.businessId, input.id);
  if (!existing) return { ok: false, errors: ['Proposta não encontrada.'], warnings: [] };
  if (existing.status === 'cancelled') return { ok: false, errors: ['proposta cancelada'], warnings: [] };
  if (existing.status === 'published') return { ok: false, errors: ['proposta já publicada'], warnings: [] };
  applyCompile(existing, db);
  if (!existing.validation.ok) {
    return { ok: false, proposal: existing, errors: ['não dá para aprovar: ' + (existing.validation.errors[0] || 'proposta inválida')], warnings: existing.validation.warnings };
  }
  existing.status = 'approved';
  existing.updatedAt = nowISO(input.now);
  return { ok: true, proposal: existing, errors: [], warnings: existing.validation.warnings };
}

export function cancelProposal(
  db: DB,
  input: { businessId: string; id: string; now?: string },
): GenerateResult {
  const existing = findProposal(db, input.businessId, input.id);
  if (!existing) return { ok: false, errors: ['Proposta não encontrada.'], warnings: [] };
  if (existing.status === 'published') {
    return { ok: false, errors: ['proposta já publicada — desative a automação em Automações se quiser pará-la'], warnings: [] };
  }
  existing.status = 'cancelled';
  existing.updatedAt = nowISO(input.now);
  return { ok: true, proposal: existing, errors: [], warnings: [] };
}

export interface PublishResult extends GenerateResult {
  automation?: Automation;
}

/**
 * Publica a proposta como Automation do P4. Exige aprovação prévia.
 * `activate` liga a automação; o padrão é NASCER DESLIGADA (revisão final
 * no interruptor que o lojista já conhece). A IA nunca decide `active`.
 */
export function publishProposal(
  db: DB,
  input: { businessId: string; id: string; userId?: string; activate?: boolean; now?: string },
): PublishResult {
  const existing = findProposal(db, input.businessId, input.id);
  if (!existing) return { ok: false, errors: ['Proposta não encontrada.'], warnings: [] };
  if (existing.status === 'cancelled') return { ok: false, errors: ['proposta cancelada'], warnings: [] };
  if (existing.status === 'published') {
    return { ok: false, errors: ['proposta já publicada'], warnings: [], proposal: existing };
  }
  if (existing.status !== 'approved') {
    return { ok: false, errors: ['aprove a proposta antes de publicar'], warnings: [], proposal: existing };
  }

  applyCompile(existing, db);
  if (!existing.validation.ok || !existing.nodes.length) {
    return { ok: false, errors: existing.validation.errors.length ? existing.validation.errors : ['proposta inválida'], warnings: existing.validation.warnings, proposal: existing };
  }

  const business = db.businesses.find((b) => b.id === input.businessId);
  const limits = limitsFor(business);
  if (automationsOf(db, input.businessId).length >= limits.maxAutomations) {
    return { ok: false, errors: [`limite de ${limits.maxAutomations} automações por empresa atingido`], warnings: [], proposal: existing };
  }

  const now = nowISO(input.now);
  const draft = planToDraft(existing.plan);
  const compiled = compileAndValidatePlan(db, input.businessId, existing.plan);
  if (!compiled.ok || !compiled.automation) {
    existing.validation = { ok: false, errors: compiled.errors, warnings: compiled.warnings };
    existing.status = 'draft';
    return { ok: false, errors: compiled.errors, warnings: compiled.warnings, proposal: existing };
  }

  const automation: Automation = {
    ...compiled.automation,
    id: randomUUID(),
    businessId: input.businessId,
    active: input.activate === true, // só liga se o humano pediu
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdByUserId: String(input.userId || existing.createdByUserId || ''),
    templateId: 'ai',
  };
  // Garante que o grafo publicado é o compilado (não o rascunho cru).
  automation.nodes = compiled.nodes;
  automation.edges = compiled.edges;
  automation.trigger = compiled.automation.trigger;
  void draft;

  if (!Array.isArray(db.automations)) db.automations = [];
  db.automations.push(automation);
  existing.status = 'published';
  existing.automationId = automation.id;
  existing.publishedAt = now;
  existing.updatedAt = now;
  return { ok: true, proposal: existing, automation, errors: [], warnings: compiled.warnings };
}

/** Atalho explícito do botão "Aprovar e publicar" (ainda é ação humana). */
export function approveAndPublish(
  db: DB,
  input: { businessId: string; id: string; userId?: string; activate?: boolean; now?: string },
): PublishResult {
  const approved = approveProposal(db, input);
  if (!approved.ok) return approved;
  return publishProposal(db, input);
}
