import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import {
  sanitizeTemplate, validateAnamneseAnswers, normalizeAnswers,
} from '@/lib/anamnese';
import { templateFromPreset, upgradeTemplate } from '@/lib/clinic-presets';
import type { AnamneseResponse, AnamneseTemplate } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P4 — MOTOR DE ANAMNESE (API)
// ═══════════════════════════════════════════════════════════════
// Template → campos → resposta. Um motor único (não uma tabela por clínica).
// Permissão: quem registra atendimento ('atendimento') ou configura ('config').
// Toda linha é escopada por businessId (a guarda já garante o tenant).
// GET ?businessId=&responsesFor=<contactId>
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const responsesFor = req.nextUrl.searchParams.get('responsesFor') || '';
  const guard = await requireBusiness(req, businessId, ['atendimento', 'config']);
  if (!guard.ok) return guard.res;
  const db = await readDB();
  const templates = db.anamneseTemplates.filter((t) => t.businessId === businessId);
  const out: Record<string, unknown> = { templates };
  if (responsesFor) {
    out.responses = db.anamneseResponses
      .filter((r) => r.businessId === businessId && r.contactId === responsesFor)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, ['atendimento', 'config']);
    if (!guard.ok) return guard.res;
    const { ctx } = guard;
    const action = String(body.action || '');

    // ── Criar template a partir do preset do tipo de clínica ──
    if (action === 'template.seed') {
      const created = await updateDB((db) => {
        const biz = db.businesses.find((b) => b.id === businessId);
        const now = new Date().toISOString();
        const tpl = templateFromPreset(biz?.clinicType, () => randomUUID(), now);
        tpl.businessId = businessId;
        db.anamneseTemplates.push(tpl);
        pushAudit(db, {
          action: 'anamnese.template_created', actor: { ...ctx.user, role: ctx.role },
          businessId, supportSessionId: ctx.support?.id, meta: { preset: tpl.preset, seeded: true },
        });
        return tpl;
      });
      return NextResponse.json({ ok: true, template: created });
    }

    // ── Upgrade SEGURO do template antigo a partir do preset (item 7) ──
    // Só ADICIONA campos do preset que faltam; nunca sobrescreve customizados
    // nem remove o que a clínica criou. Sem template custom puro sem preset.
    if (action === 'template.upgrade') {
      const id = String(body.id || '');
      const updated = await updateDB((db) => {
        const biz = db.businesses.find((b) => b.id === businessId);
        const existing = db.anamneseTemplates.find((t) => t.id === id && t.businessId === businessId);
        if (!existing) return null;
        // Template 100% custom (preset 'custom' ou '') não tem preset de origem:
        // upgrade não se aplica — a clínica escolheu os campos.
        if (!existing.preset || existing.preset === 'custom') {
          return { skipped: true as const, template: existing };
        }
        const now = new Date().toISOString();
        // Preset de origem: o DO template (compat com clinicType antigo da unidade)
        const type = existing.preset === 'veterinaria' || existing.preset === 'medica'
          || existing.preset === 'odontologica' || existing.preset === 'estetica'
          || existing.preset === 'geral'
          ? existing.preset
          : (biz?.clinicType as never);
        const { template, addedIds } = upgradeTemplate(existing, type, now);
        if (addedIds.length) {
          Object.assign(existing, template);
          pushAudit(db, {
            action: 'anamnese.template_updated',
            actor: { ...ctx.user, role: ctx.role },
            businessId, supportSessionId: ctx.support?.id,
            meta: { templateId: existing.id, upgraded: true, added: addedIds.length, addedIds },
          });
        }
        return { skipped: false as const, template: existing, addedIds };
      });
      if (!updated) return NextResponse.json({ error: 'Ficha não encontrada.' }, { status: 404 });
      if (updated.skipped) {
        return NextResponse.json({
          ok: true, skipped: true, template: updated.template,
          message: 'Ficha customizada — upgrade de preset não se aplica.',
        });
      }
      return NextResponse.json({
        ok: true, skipped: false, template: updated.template,
        addedIds: updated.addedIds || [],
        message: (updated.addedIds || []).length
          ? `${(updated.addedIds || []).length} campo(s) do preset adicionado(s). Customizados preservados.`
          : 'Ficha já está atualizada com o preset.',
      });
    }

    // ── Criar/atualizar template ──
    if (action === 'template.save') {
      const incoming = body.template || {};
      const clean = sanitizeTemplate(incoming);
      if (!clean.fields.length) {
        return NextResponse.json({ error: 'A ficha precisa de ao menos um campo.' }, { status: 400 });
      }
      const saved = await updateDB((db) => {
        const now = new Date().toISOString();
        const existing = clean.id
          ? db.anamneseTemplates.find((t) => t.id === clean.id && t.businessId === businessId)
          : undefined;
        if (existing) {
          existing.name = clean.name;
          existing.description = clean.description;
          existing.fields = clean.fields;
          existing.preset = clean.preset;
          existing.active = clean.active;
          existing.updatedAt = now;
          pushAudit(db, {
            action: 'anamnese.template_updated', actor: { ...ctx.user, role: ctx.role },
            businessId, supportSessionId: ctx.support?.id, meta: { templateId: existing.id },
          });
          return existing;
        }
        const tpl: AnamneseTemplate = {
          ...clean, id: randomUUID(), businessId, createdAt: now, updatedAt: now,
        };
        db.anamneseTemplates.push(tpl);
        pushAudit(db, {
          action: 'anamnese.template_created', actor: { ...ctx.user, role: ctx.role },
          businessId, supportSessionId: ctx.support?.id, meta: { templateId: tpl.id },
        });
        return tpl;
      });
      return NextResponse.json({ ok: true, template: saved });
    }

    // ── Excluir template (protegido: não some com respostas vinculadas) ──
    if (action === 'template.delete') {
      const id = String(body.id || '');
      const guardDb = await readDB();
      const hasResponses = guardDb.anamneseResponses.some((r) => r.businessId === businessId && r.templateId === id);
      if (hasResponses) {
        return NextResponse.json({ error: 'Esta ficha tem respostas vinculadas e não pode ser excluída. Você pode desativá-la.' }, { status: 409 });
      }
      await updateDB((db) => {
        db.anamneseTemplates = db.anamneseTemplates.filter((t) => !(t.id === id && t.businessId === businessId));
        pushAudit(db, {
          action: 'anamnese.template_deleted', actor: { ...ctx.user, role: ctx.role },
          businessId, supportSessionId: ctx.support?.id, meta: { templateId: id },
        });
      });
      return NextResponse.json({ ok: true });
    }

    // ── Salvar resposta do paciente/atendimento ──
    if (action === 'response.save') {
      const incoming = body.response || {};
      const templateId = String(incoming.templateId || '');
      const db0 = await readDB();
      const template = db0.anamneseTemplates.find((t) => t.id === templateId && t.businessId === businessId);
      if (!template) return NextResponse.json({ error: 'Ficha de anamnese não encontrada.' }, { status: 404 });
      const check = validateAnamneseAnswers(template, incoming.answers || {});
      if (!check.ok) {
        return NextResponse.json({ error: 'Preencha os campos obrigatórios.', fields: check.errors }, { status: 400 });
      }
      const saved = await updateDB((db) => {
        const now = new Date().toISOString();
        const answers = normalizeAnswers(template, incoming.answers || {}) as Record<string, unknown>;
        const id = String(incoming.id || '');
        const existing = id ? db.anamneseResponses.find((r) => r.id === id && r.businessId === businessId) : undefined;
        if (existing) {
          existing.answers = answers;
          existing.updatedAt = now;
          pushAudit(db, {
            action: 'anamnese.response_saved', actor: { ...ctx.user, role: ctx.role },
            businessId, supportSessionId: ctx.support?.id, meta: { responseId: existing.id, templateId },
          });
          return existing;
        }
        const resp: AnamneseResponse = {
          id: randomUUID(), businessId, templateId,
          encounterId: String(incoming.encounterId || ''),
          contactId: String(incoming.contactId || ''),
          petId: String(incoming.petId || ''),
          professionalId: String(incoming.professionalId || ''),
          answers, createdAt: now, updatedAt: now, createdBy: ctx.user.id,
        };
        db.anamneseResponses.push(resp);
        pushAudit(db, {
          action: 'anamnese.response_saved', actor: { ...ctx.user, role: ctx.role },
          businessId, supportSessionId: ctx.support?.id, meta: { responseId: resp.id, templateId },
        });
        return resp;
      });
      return NextResponse.json({ ok: true, response: saved });
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Não foi possível concluir a operação.' }, { status: 500 });
  }
}
