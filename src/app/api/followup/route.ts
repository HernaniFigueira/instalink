import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import {
  FOLLOW_UP_RECIPES, evaluateFollowUps, followUpChannelState, recipeFor, seedFollowUpRules,
} from '@/lib/follow-up';
import { isValidDateISO } from '@/lib/tz';
import type { FollowUpRule, FollowUpTrigger } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P10 — FOLLOW-UP: FUNDAÇÃO (API)
// ═══════════════════════════════════════════════════════════════
// Regras (receitas) + prévia de candidatos sobre dado REAL. NENHUM envio
// acontece aqui — o canal pode não estar operacional e a resposta diz isso
// (`channel.ready=false` ⇒ UI mostra "Aguardando conexão do WhatsApp").
// GET  ?businessId=              → { catalog, rules, channel, candidates }
// POST { action: 'seed' | 'toggle' | 'update', ... }

const TRIGGERS: FollowUpTrigger[] = [
  'lead_no_booking', 'before_appointment', 'no_show', 'after_completion', 'return_due', 'inactive_patient',
];

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'config');
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const business = guard.ctx.business;
  const rules = db.followUpRules.filter((r) => r.businessId === businessId);
  const today = new Date().toISOString().slice(0, 10);
  const candidates = rules.length ? evaluateFollowUps({
    rules,
    contacts: db.contacts.filter((c) => c.businessId === businessId),
    leads: db.leads.filter((l) => l.businessId === businessId),
    bookings: db.bookings.filter((b) => b.businessId === businessId),
    encounters: db.encounters.filter((e) => e.businessId === businessId),
    today,
    now: new Date().toISOString(),
  }) : [];
  return NextResponse.json({
    catalog: FOLLOW_UP_RECIPES,
    rules,
    channel: followUpChannelState(business),
    candidates,
    seeded: rules.length > 0,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;
    const action = String(body.action || '');
    const now = new Date().toISOString();

    if (action === 'seed') {
      // Idempotente: só cria quando a unidade ainda não tem regras.
      const saved = await updateDB((db) => {
        const mine = db.followUpRules.filter((r) => r.businessId === businessId);
        if (mine.length > 0) return mine;
        const created = seedFollowUpRules(businessId, now);
        db.followUpRules.push(...created);
        return created;
      });
      return NextResponse.json({ ok: true, rules: saved });
    }

    if (action === 'toggle') {
      const id = String(body.id || '');
      const saved = await updateDB((db) => {
        const rule = db.followUpRules.find((r) => r.id === id && r.businessId === businessId);
        if (!rule) return null;
        rule.active = body.active !== false;
        rule.updatedAt = now;
        return rule;
      });
      if (!saved) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });
      return NextResponse.json({ ok: true, rule: saved });
    }

    if (action === 'update') {
      const id = String(body.id || '');
      const saved = await updateDB((db) => {
        const rule = db.followUpRules.find((r) => r.id === id && r.businessId === businessId);
        if (!rule) return null;
        const value = Number(body.delayValue);
        if (Number.isFinite(value) && value >= 0 && value <= 365) rule.delayValue = Math.round(value);
        if (['minutes', 'hours', 'days'].includes(body.delayUnit)) rule.delayUnit = body.delayUnit;
        if (typeof body.name === 'string' && body.name.trim()) rule.name = body.name.trim().slice(0, 80);
        if (typeof body.active === 'boolean') rule.active = body.active;
        rule.updatedAt = now;
        return rule;
      });
      if (!saved) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });
      return NextResponse.json({ ok: true, rule: saved });
    }

    // Criação avulsa de receita fora do catálogo (mesmo modelo de 6 campos).
    if (action === 'create') {
      const trigger = TRIGGERS.includes(body.trigger) ? (body.trigger as FollowUpTrigger) : '';
      if (!trigger) return NextResponse.json({ error: 'Gatilho inválido.' }, { status: 400 });
      const recipe = recipeFor(trigger);
      if (!recipe) return NextResponse.json({ error: 'Gatilho inválido.' }, { status: 400 });
      const saved = await updateDB((db) => {
        const rule: FollowUpRule = {
          id: `fup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          businessId,
          name: String(body.name || recipe.name).slice(0, 80),
          trigger,
          active: false, // nasce DESLIGADA — ligar é decisão explícita
          delayValue: Number.isFinite(Number(body.delayValue)) ? Math.round(Number(body.delayValue)) : recipe.delay.value,
          delayUnit: (['minutes', 'hours', 'days'].includes(body.delayUnit) ? body.delayUnit : recipe.delay.unit) as FollowUpRule['delayUnit'],
          params: {},
          action: recipe.action,
          channel: 'whatsapp',
          audience: recipe.audience,
          createdAt: now, updatedAt: now,
        };
        db.followUpRules.push(rule);
        return rule;
      });
      return NextResponse.json({ ok: true, rule: saved });
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Não foi possível concluir a operação.' }, { status: 500 });
  }
}
