// ═══════════════════════════════════════════════════════════════
// P5 — API DAS PROPOSTAS DE IA (nunca executa automação)
// ═══════════════════════════════════════════════════════════════
// Guarda: `requireBusiness(..., 'config')` — a mesma do editor de
// automações. `businessId` vem do contexto autenticado, nunca troca de
// tenant pelo corpo.
//
//   GET    lista propostas desta unidade + observação (falhas/sugestões)
//   POST   gerar | regenerar | aprovar | publicar | cancelar
//   PATCH  editar o plano (volta para rascunho)
//
// Publicar grava uma Automation do P4 (active só se o humano pediu).
import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { hasCapability } from '@/lib/automation/capabilities';
import {
  AI_PROMPT_EXAMPLES, approveAndPublish, approveProposal, cancelProposal,
  editProposal, findProposal, generateProposal, observeBusiness, proposalView,
  proposalsOf, publishProposal, regenerateProposal, tenantContextFor,
} from '@/lib/ai';

function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function businessIdOf(req: NextRequest, body?: Record<string, any>): string {
  return String(req.nextUrl.searchParams.get('businessId') || body?.businessId || '').trim();
}

export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('Automações · IA');
  if (blocked) return blocked;

  const businessId = businessIdOf(req);
  const guard = await requireBusiness(req, businessId, 'config');
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const business = db.businesses.find((b) => b.id === businessId);
  const ctx = tenantContextFor(db, businessId);
  const list = proposalsOf(db, businessId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 40)
    .map((p) => proposalView(db, p));
  return NextResponse.json({
    ok: true,
    enabled: hasCapability(business, 'automation.ai'),
    examples: AI_PROMPT_EXAMPLES,
    catalog: ctx ? {
      stages: ctx.stages,
      services: ctx.services,
      members: ctx.members.map((m) => ({ userId: m.userId, name: m.name })),
    } : { stages: [], services: [], members: [] },
    proposals: list,
    observation: observeBusiness(db, businessId),
  });
}

export async function POST(req: NextRequest) {
  const blocked = blockIfRelational('Automações · IA');
  if (blocked) return blocked;

  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = businessIdOf(req, body);
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;
    const action = String(body.action || 'generate').trim();
    const userId = guard.ctx.user.id;

    if (action === 'generate' || action === '') {
      const created = await updateDB((d) => {
        const res = generateProposal(d, { businessId, prompt: body.prompt, userId });
        if (res.ok && res.proposal) {
          pushAudit(d, {
            action: 'ai.proposal_created',
            actor: guard.ctx.user,
            businessId,
            meta: { proposalId: res.proposal.id, event: res.proposal.plan.event },
          });
        }
        return res;
      });
      if (!created.ok || !created.proposal) {
        return NextResponse.json({ ok: false, errors: created.errors }, { status: 422 });
      }
      const fresh = await readDB();
      return NextResponse.json({
        ok: true,
        proposal: proposalView(fresh, created.proposal),
        errors: created.errors,
        warnings: created.warnings,
      }, { status: 201 });
    }

    const id = String(body.id || '').trim();
    if (!id) return fail('Proposta não informada.', 400);

    if (action === 'regenerate') {
      const res = await updateDB((d) => {
        const out = regenerateProposal(d, { businessId, id, prompt: body.prompt });
        if (out.ok && out.proposal) {
          pushAudit(d, { action: 'ai.proposal_regenerated', actor: guard.ctx.user, businessId, meta: { proposalId: id } });
        }
        return out;
      });
      if (!res.ok || !res.proposal) return NextResponse.json({ ok: false, errors: res.errors }, { status: res.errors[0]?.includes('não encontrada') ? 404 : 422 });
      const fresh = await readDB();
      return NextResponse.json({ ok: true, proposal: proposalView(fresh, res.proposal), errors: res.errors, warnings: res.warnings });
    }

    if (action === 'approve') {
      const res = await updateDB((d) => {
        const out = approveProposal(d, { businessId, id });
        if (out.ok && out.proposal) {
          pushAudit(d, { action: 'ai.proposal_approved', actor: guard.ctx.user, businessId, meta: { proposalId: id } });
        }
        return out;
      });
      if (!res.ok || !res.proposal) return NextResponse.json({ ok: false, errors: res.errors }, { status: 422 });
      const fresh = await readDB();
      return NextResponse.json({ ok: true, proposal: proposalView(fresh, res.proposal), warnings: res.warnings });
    }

    if (action === 'cancel') {
      const res = await updateDB((d) => {
        const out = cancelProposal(d, { businessId, id });
        if (out.ok && out.proposal) {
          pushAudit(d, { action: 'ai.proposal_cancelled', actor: guard.ctx.user, businessId, meta: { proposalId: id } });
        }
        return out;
      });
      if (!res.ok) return NextResponse.json({ ok: false, errors: res.errors }, { status: 422 });
      const fresh = await readDB();
      return NextResponse.json({ ok: true, proposal: proposalView(fresh, res.proposal!) });
    }

    if (action === 'publish' || action === 'approve-publish') {
      const activate = body.activate === true;
      const res = await updateDB((d) => {
        const out = action === 'approve-publish'
          ? approveAndPublish(d, { businessId, id, userId, activate })
          : publishProposal(d, { businessId, id, userId, activate });
        if (out.ok && out.proposal) {
          pushAudit(d, {
            action: 'ai.proposal_published',
            actor: guard.ctx.user,
            businessId,
            meta: { proposalId: id, automationId: out.automation?.id, activate },
          });
          if (out.automation) {
            pushAudit(d, {
              action: 'automation.created',
              actor: guard.ctx.user,
              businessId,
              meta: { automationId: out.automation.id, name: out.automation.name, source: 'ai' },
            });
          }
        }
        return out;
      });
      if (!res.ok) return NextResponse.json({ ok: false, errors: res.errors, warnings: res.warnings }, { status: 422 });
      const fresh = await readDB();
      return NextResponse.json({
        ok: true,
        proposal: proposalView(fresh, res.proposal!),
        automationId: res.automation?.id,
        warnings: res.warnings,
      });
    }

    return fail('Ação desconhecida.', 400);
  } catch (e: any) {
    const status = e?.status || 500;
    return fail(status === 500 ? 'Não foi possível processar a proposta.' : e.message, status);
  }
}

export async function PATCH(req: NextRequest) {
  const blocked = blockIfRelational('Automações · IA');
  if (blocked) return blocked;

  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = businessIdOf(req, body);
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;
    const id = String(body.id || '').trim();
    if (!id) return fail('Proposta não informada.', 400);
    const existing = findProposal(guard.db, businessId, id);
    if (!existing) return fail('Proposta não encontrada.', 404);

    const res = await updateDB((d) => {
      const out = editProposal(d, {
        businessId,
        id,
        plan: body.plan,
        name: body.name,
        description: body.description,
      });
      if (out.ok && out.proposal) {
        pushAudit(d, { action: 'ai.proposal_updated', actor: guard.ctx.user, businessId, meta: { proposalId: id } });
      }
      return out;
    });
    if (!res.ok || !res.proposal) {
      return NextResponse.json({ ok: false, errors: res.errors }, { status: 422 });
    }
    const fresh = await readDB();
    return NextResponse.json({
      ok: true,
      proposal: proposalView(fresh, res.proposal),
      errors: res.errors,
      warnings: res.warnings,
    });
  } catch (e: any) {
    const status = e?.status || 500;
    return fail(status === 500 ? 'Não foi possível editar a proposta.' : e.message, status);
  }
}
