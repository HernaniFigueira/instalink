// ═══════════════════════════════════════════════════════════════
// P4.10 — API DAS AUTOMAÇÕES (CRUD + ativação + duplicar + galeria)
// ═══════════════════════════════════════════════════════════════
// Guarda: `requireBusiness(req, businessId, 'config')` — a mesma camada de
// autorização do resto do painel (dono/admin da UNIDADE; modo suporte em
// visualização é bloqueado para escrita). `businessId` NUNCA vem do corpo: a
// unidade é a do contexto autenticado, e toda escrita usa exatamente ela.
//
// O que a API aceita:
//   GET    → lista + projeção linear + estatísticas + galeria + capacidades;
//   POST   → criar (rascunho linear OU grafo, ou `templateId`), duplicar,
//            ativar/desativar;
//   PATCH  → editar a definição (validada por completo antes de gravar);
//   DELETE → excluir (as execuções ficam como histórico, com o nome congelado).
//
// Toda criação/edição passa por `validateAutomationDraft`: a automação só é
// gravada se o gatilho existir, as condições usarem campos conhecidos, as ações
// existirem no catálogo e o grafo não tiver ciclo sem espera nem nó órfão.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { checkIdempotency, extractIdempotencyKey, saveIdempotency } from '@/lib/idempotency';
import { getBusinessPipeline } from '@/lib/pipeline';
import type { Automation, DB } from '@/lib/types';
import { automationsOf, validateAutomationDraft } from '@/lib/automation/model';
import { automationView } from '@/lib/automation/serialize';
import { cancelRunsOfAutomation, sanitizeAutomationRunForDisplay } from '@/lib/automation/executor';
import { capabilityStateFor, limitsFor } from '@/lib/automation/capabilities';
import { applyTemplate, templateOffers } from '@/lib/automation/templates';
import { taskAssigneeOptions } from '@/lib/automation/tasks';

function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function businessIdOf(req: NextRequest, body?: Record<string, any>): string {
  return String(req.nextUrl.searchParams.get('businessId') || body?.businessId || '').trim();
}

/** Só os campos que o motor conhece (o resto do corpo é descartado). */
function pickDraft(body: Record<string, any>): Record<string, any> {
  const allowed = ['name', 'description', 'active', 'event', 'condition', 'steps', 'elseSteps', 'nodes', 'edges', 'settings', 'templateId'];
  const out: Record<string, any> = {};
  for (const key of allowed) if (body[key] !== undefined) out[key] = body[key];
  return out;
}

function validateForBusiness(db: DB, businessId: string, draft: Record<string, any>) {
  const business = db.businesses.find((b) => b.id === businessId);
  const pipeline = getBusinessPipeline(db, businessId);
  return validateAutomationDraft(draft, {
    limits: limitsFor(business),
    stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name })),
    serviceIds: db.services.filter((s) => s.businessId === businessId && s.active !== false).map((s) => s.id),
    businessCaps: capabilityStateFor(business),
  });
}

export async function GET(req: NextRequest) {
  const businessId = businessIdOf(req);
  const guard = await requireBusiness(req, businessId, 'config');
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const business = db.businesses.find((b) => b.id === businessId)!;

  const automations = automationsOf(db, businessId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((a) => automationView(db, a));

  // Mesma projeção do detalhe: a posse interna do motor
  // (claimToken/claimExpiresAt) nunca vai para o navegador.
  const recentRuns = (db.automationRuns || [])
    .filter((r) => r.businessId === businessId)
    .slice(-40)
    .reverse()
    .map(sanitizeAutomationRunForDisplay);

  // Opções do editor (mesma fonte das telas de esteira/agenda — nada de lista
  // paralela de etapas/serviços/equipe).
  const pipeline = getBusinessPipeline(db, businessId);
  // Mesma projeção da tela de Tarefas (lib/automation/tasks) — uma fonte só.
  const members = taskAssigneeOptions(db, businessId);

  return NextResponse.json({
    ok: true,
    options: {
      stages: pipeline.stages.map((s) => ({ id: s.id, name: s.name })),
      services: db.services
        .filter((x) => x.businessId === businessId && x.active !== false)
        .map((x) => ({ id: x.id, name: x.name })),
      members,
    },
    automations,
    recentRuns,
    templates: templateOffers(db, businessId),
    capabilities: capabilityStateFor(business),
    limits: limitsFor(business),
    counts: {
      automations: automations.length,
      openTasks: (db.tasks || []).filter((t) => t.businessId === businessId && t.status === 'open').length,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = businessIdOf(req, body);
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;
    const db = guard.db;
    const action = String(body.action || '').trim();

    // ativar/desativar (a ação mais usada do dia a dia — um clique, sem abrir editor)
    if (action === 'toggle') {
      const id = String(body.id || '');
      let toggled: Automation | null = null;
      let cancelledRuns = 0;
      await updateDB((d) => {
        const existing = d.automations.find((a) => a.id === id && a.businessId === businessId);
        if (!existing) throw Object.assign(new Error('Automação não encontrada.'), { status: 404 });
        const nextActive = typeof body.active === 'boolean' ? body.active : !existing.active;
        existing.active = nextActive;
        existing.updatedAt = new Date().toISOString();
        // Desativar nunca apaga execuções; só encerra as vivas (não faz mais
        // sentido continuar um fluxo de uma automação desligada).
        if (!nextActive) {
          cancelledRuns = cancelRunsOfAutomation(d, businessId, existing.id, 'automação desativada', existing.updatedAt);
        }
        toggled = existing;
        pushAudit(d, {
          action: 'automation.toggled',
          actor: guard.ctx.user,
          businessId,
          meta: { automationId: existing.id, active: nextActive, cancelledRuns },
        });
      });
      const fresh = await readDB();
      return NextResponse.json({
        ok: true,
        automation: automationView(fresh, toggled!),
        cancelledRuns,
      });
    }

    // duplicar (mesma validação; nome com "cópia")
    if (action === 'duplicate') {
      const id = String(body.id || '');
      const source = db.automations.find((a) => a.id === id && a.businessId === businessId);
      if (!source) return fail('Automação não encontrada.', 404);
      const limits = limitsFor(db.businesses.find((b) => b.id === businessId));
      if (automationsOf(db, businessId).length >= limits.maxAutomations) {
        return fail(`limite de ${limits.maxAutomations} automações por empresa atingido`, 422);
      }
      const now = new Date().toISOString();
      const created = await updateDB((d) => {
        const fresh = d.automations.find((a) => a.id === id && a.businessId === businessId);
        if (!fresh) throw Object.assign(new Error('Automação não encontrada.'), { status: 404 });
        const clone: Automation = {
          ...structuredCloneSafe(fresh),
          id: randomUUID(),
          businessId,
          name: `${fresh.name} (cópia)`.slice(0, 80),
          active: false, // cópia nasce DESLIGADA: nada dispara sem revisão
          version: (fresh.version || 1) + 1,
          createdAt: now,
          updatedAt: now,
          createdByUserId: guard.ctx.user.id,
        };
        d.automations.push(clone);
        pushAudit(d, {
          action: 'automation.duplicated',
          actor: guard.ctx.user,
          businessId,
          meta: { from: fresh.id, to: clone.id },
        });
        return clone;
      });
      const fresh = await readDB();
      return NextResponse.json({ ok: true, automation: automationView(fresh, created!) }, { status: 201 });
    }

    // criar a partir de um template da galeria
    const templateId = String(body.templateId || '').trim();
    if (templateId) {
      const limits = limitsFor(db.businesses.find((b) => b.id === businessId));
      if (automationsOf(db, businessId).length >= limits.maxAutomations) {
        return fail(`limite de ${limits.maxAutomations} automações por empresa atingido`, 422);
      }
      const applied = applyTemplate(db, businessId, templateId, {
        userId: guard.ctx.user.id,
        name: body.name ? String(body.name) : undefined,
        active: body.active !== false,
      });
      if (!applied.ok) {
        return NextResponse.json({ ok: false, errors: applied.errors }, { status: 422 });
      }
      const now = new Date().toISOString();
      const created = await updateDB((d) => {
        const automation: Automation = {
          ...applied.automation,
          id: randomUUID(),
          businessId,
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdByUserId: guard.ctx.user.id,
        };
        d.automations.push(automation);
        pushAudit(d, {
          action: 'automation.created',
          actor: guard.ctx.user,
          businessId,
          meta: { automationId: automation.id, templateId, name: automation.name },
        });
        return automation;
      });
      const fresh = await readDB();
      return NextResponse.json({
        ok: true,
        automation: automationView(fresh, created!),
        warnings: applied.warnings,
      }, { status: 201 });
    }

    // criar do zero (editor linear ou grafo)
    // Reenvio acidental (duplo clique/timeout de rede) não cria gêmeos: mesma
    // chave de idempotência ⇒ MESMA resposta gravada — o mecanismo é o do P3.
    const idemKey = extractIdempotencyKey(req.headers);
    if (idemKey) {
      const cached = checkIdempotency(db, businessId, idemKey, '/api/automations');
      if (cached) {
        return NextResponse.json(cached.responseBody, { status: cached.statusCode, headers: { 'X-Idempotent-Replay': 'true' } });
      }
    }
    const limits = limitsFor(db.businesses.find((b) => b.id === businessId));
    if (automationsOf(db, businessId).length >= limits.maxAutomations) {
      return fail(`limite de ${limits.maxAutomations} automações por empresa atingido`, 422);
    }
    const validation = validateForBusiness(db, businessId, {
      ...pickDraft(body),
      createdByUserId: guard.ctx.user.id,
    });
    if (!validation.ok) {
      return NextResponse.json({ ok: false, errors: validation.errors, warnings: validation.warnings }, { status: 422 });
    }
    const now = new Date().toISOString();
    const created = await updateDB((d) => {
      const automation: Automation = {
        ...validation.automation,
        id: randomUUID(),
        businessId,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      d.automations.push(automation);
      const view = automationView(d, automation);
      pushAudit(d, {
        action: 'automation.created',
        actor: guard.ctx.user,
        businessId,
        meta: { automationId: automation.id, name: automation.name, event: automation.trigger.event },
      });
      // A resposta gravada é a MESMA devolvida no reenvio (nada de resposta 2/3).
      if (idemKey) saveIdempotency(d, businessId, idemKey, '/api/automations', 201, { ok: true, automation: view });
      return view;
    });
    return NextResponse.json({
      ok: true,
      automation: created,
      warnings: validation.warnings,
    }, { status: 201 });
  } catch (e: any) {
    const status = e?.status || 500;
    return fail(status === 500 ? 'Não foi possível salvar a automação.' : e.message, status);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = businessIdOf(req, body);
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;
    const id = String(body.id || '');
    const db = guard.db;
    const existing = db.automations.find((a) => a.id === id && a.businessId === businessId);
    if (!existing) return fail('Automação não encontrada.', 404);

    // O rascunho enviado substitui a definição; campos ausentes vêm do atual
    // (editar a UI linear nunca "esquece" o resto).
    const draft = {
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      active: body.active ?? existing.active,
      event: body.event ?? existing.trigger?.event,
      ...(body.condition !== undefined ? { condition: body.condition } : existing.trigger?.condition ? { condition: existing.trigger.condition } : {}),
      ...(body.steps !== undefined || body.elseSteps !== undefined || body.nodes !== undefined
        ? { steps: body.steps ?? [], elseSteps: body.elseSteps ?? [] }
        // Sem passos no corpo: mantém o grafo atual (edição só de metadados).
        : { nodes: existing.nodes, edges: existing.edges }),
      settings: { ...(existing.settings || {}), ...(body.settings || {}) },
      templateId: existing.templateId,
    };
    const validation = validateForBusiness(db, businessId, draft);
    if (!validation.ok) {
      return NextResponse.json({ ok: false, errors: validation.errors, warnings: validation.warnings }, { status: 422 });
    }

    const now = new Date().toISOString();
    const updated = await updateDB((d) => {
      const target = d.automations.find((a) => a.id === id && a.businessId === businessId);
      if (!target) throw Object.assign(new Error('Automação não encontrada.'), { status: 404 });
      const wasActive = target.active;
      Object.assign(target, validation.automation, {
        id: target.id,
        businessId: target.businessId,
        version: (target.version || 1) + 1,
        createdAt: target.createdAt,
        updatedAt: now,
      });
      // Editar o gatilho invalida execuções antigas em espera: elas pertencem à
      // definição anterior, e mantê-las vivas criaria estado "órfão".
      let cancelled = 0;
      if (target.trigger?.event !== existing.trigger?.event || JSON.stringify(target.nodes) !== JSON.stringify(existing.nodes)) {
        cancelled = cancelRunsOfAutomation(d, businessId, target.id, 'automação reeditada', now);
      }
      if (wasActive && !target.active) {
        cancelled += cancelRunsOfAutomation(d, businessId, target.id, 'automação desativada', now);
      }
      pushAudit(d, {
        action: 'automation.updated',
        actor: guard.ctx.user,
        businessId,
        meta: { automationId: target.id, version: target.version, cancelledRuns: cancelled },
      });
      return target;
    });
    const fresh = await readDB();
    // Os avisos da validação saem também na EDIÇÃO (criar já devolvia): um
    // `settings.dedupeField` ignorado, por exemplo, precisa ser dito — senão o
    // cliente (e o agente do P5) acha que gravou o que não gravou.
    return NextResponse.json({
      ok: true,
      automation: automationView(fresh, updated!),
      warnings: validation.warnings,
    });
  } catch (e: any) {
    const status = e?.status || 500;
    return fail(status === 500 ? 'Não foi possível atualizar a automação.' : e.message, status);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = businessIdOf(req, body);
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;
    const id = String(body.id || req.nextUrl.searchParams.get('id') || '');
    if (!id) return fail('Automação não informada.', 400);
    const existing = guard.db.automations.find((a) => a.id === id && a.businessId === businessId);
    if (!existing) return fail('Automação não encontrada.', 404);

    const now = new Date().toISOString();
    const removed = await updateDB((d) => {
      const idx = d.automations.findIndex((a) => a.id === id && a.businessId === businessId);
      if (idx === -1) throw Object.assign(new Error('Automação não encontrada.'), { status: 404 });
      d.automations.splice(idx, 1);
      // As execuções ficam: são histórico de diagnóstico (nome congelado na
      // própria execução). Apenas param de andar.
      const cancelled = cancelRunsOfAutomation(d, businessId, id, 'automação excluída', now);
      pushAudit(d, {
        action: 'automation.deleted',
        actor: guard.ctx.user,
        businessId,
        meta: { automationId: id, name: existing.name, cancelledRuns: cancelled },
      });
      return true;
    });
    return NextResponse.json({ ok: removed });
  } catch (e: any) {
    const status = e?.status || 500;
    return fail(status === 500 ? 'Não foi possível excluir a automação.' : e.message, status);
  }
}

/** Clona sem `structuredClone` (ambiente pode ser antigo) e sem funções. */
function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
