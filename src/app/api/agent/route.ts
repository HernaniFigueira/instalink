import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import {
  OBJECTIVE_OPTIONS, TONE_OPTIONS, buildKnowledge, defaultAgent, renderGreeting,
  sanitizeAgentInput,
} from '@/lib/agent';
import { agentFor } from '@/lib/agent';
import { isFeatureEnabled, canBook as canBookModule, whatsappVisible } from '@/lib/features';
import { visibleFaqItems } from '@/lib/faq';
import { integrationStatus } from '@/lib/whatsapp';

// Agente de atendimento da empresa (por business).
// GET  ?businessId= → configuração + prévia + conhecimento disponível
// PUT  { businessId, ...campos } → salva a configuração
export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('Agente de IA');
  if (blocked) return blocked;

  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'agente');
  if (!guard.ok) return guard.res;
  const { business } = guard.ctx;
  const db = guard.db;
  const agent = agentFor(db, business);
  const faqBlock = db.pages.find((p) => p.businessId === businessId)?.blocks.find((b) => b.type === 'faq');
  const knowledge = buildKnowledge(db, business, { faq: visibleFaqItems(faqBlock?.settings?.items) });
  const services = db.services.filter((s) => s.businessId === businessId && s.active !== false);
  return NextResponse.json({
    agent,
    defaults: defaultAgent(businessId, business.name),
    options: { tones: TONE_OPTIONS, objectives: OBJECTIVE_OPTIONS },
    preview: {
      greeting: renderGreeting(agent, business.name),
      knowledge,
      moduleEnabled: isFeatureEnabled(business, 'agent'),
      canBook: canBookModule(business, services),
      whatsapp: whatsappVisible(business),
      whatsappStatus: integrationStatus(business).status,
    },
  });
}

export async function PUT(req: NextRequest) {
  const blocked = blockIfRelational('Agente de IA');
  if (blocked) return blocked;

  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'agente');
    if (!guard.ok) return guard.res;
    const ctx = guard.ctx;
    const saved = await updateDB((db) => {
      const business = db.businesses.find((b) => b.id === businessId)!;
      const current = agentFor(db, business);
      const next = sanitizeAgentInput(businessId, body, current);
      const idx = db.agents.findIndex((a) => a.businessId === businessId);
      if (idx >= 0) db.agents[idx] = next; else db.agents.push(next);
      pushAudit(db, {
        action: 'agent.updated',
        actor: { ...ctx.user, role: ctx.role },
        businessId,
        supportSessionId: ctx.support?.id,
        meta: { enabled: next.enabled, name: next.name },
      });
      return next;
    });
    return NextResponse.json({ ok: true, agent: saved });
  } catch {
    return NextResponse.json({ error: 'Não foi possível salvar o agente.' }, { status: 500 });
  }
}
