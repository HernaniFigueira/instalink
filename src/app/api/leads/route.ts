import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { isFeatureEnabled } from '@/lib/features';
import { customerFromRequest } from '@/lib/customer-auth';
import { onlyDigits } from '@/lib/utils';
import { LEAD_FLOW, canTransition } from '@/lib/status';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import type { DB, LeadStatus } from '@/lib/types';
import { ingestLead, getBusinessPipeline, moveLeadStage, assignLead, addLeadNote } from '@/lib/pipeline';
import { dispatchWebhook } from '@/lib/webhooks';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

// POST público: captura lead.
// - Usa o mesmo núcleo operacional (ingestLead) da integração externa e futura IA;
// - Deduplicação automática e preservação estrita de origem.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`lead:${ipFrom(req)}`, 30, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde um instante.' }, { status: 429 });
  try {
    const body = await req.json();
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === body.businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

    // Orçamento desativado não vira lead (a captação inteira é o módulo).
    if (!isFeatureEnabled(business, 'quote')) {
      return NextResponse.json({ error: 'Este negócio não está recebendo orçamentos no momento.' }, { status: 403 });
    }

    const customer = await customerFromRequest(req);
    const guest = String(body.origin || '') === 'orcamento' || String(body.action || '') === 'orcamento' || String(body.origin || '') === 'formulario';
    if (!customer && !guest) {
      return NextResponse.json({ error: 'Entre para continuar.', code: 'login_required' }, { status: 401 });
    }

    const name = (body.name || customer?.name || '').trim().slice(0, 80);
    const phone = (body.phone || customer?.phone || '').trim().slice(0, 25);
    const email = (body.email || customer?.email || '').trim().toLowerCase().slice(0, 120);
    if (!name && !phone) return NextResponse.json({ error: 'Informe ao menos nome ou WhatsApp.' }, { status: 400 });

    let result: ReturnType<typeof ingestLead>;

    await updateDB((d: DB) => {
      result = ingestLead(d, {
        businessId: business.id,
        customerId: customer?.id || '',
        name,
        phone,
        email,
        instagram: body.instagram,
        interest: body.interest,
        message: body.message,
        source: body.origin || 'formulario',
        sourceUrl: body.sourceUrl,
        serviceId: body.serviceId,
        professionalId: body.professionalId,
        metadata: body.metadata,
        actor: {
          id: customer?.id || '',
          name: customer?.name || 'Cliente',
          type: customer ? 'customer' : 'system',
        },
      });
    });

    // Disparo de Webhook
    try {
      await updateDB(async (d: DB) => {
        await dispatchWebhook(d, result!.isNew ? 'lead.created' : 'lead.updated', business.id, {
          lead: result!.lead,
          isNew: result!.isNew,
        });
      });
    } catch { /* noop */ }

    return NextResponse.json({ ok: true, guest: !customer, lead: result!.lead });
  } catch (e: any) {
    const status = e?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível enviar. Tente novamente.' : e.message }, { status });
  }
}

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'leads');
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));
  const stage = req.nextUrl.searchParams.get('stage') || '';

  let all = db.leads.filter((l) => l.businessId === businessId);
  if (stage) {
    all = all.filter((l) => (l.stageId || l.status) === stage);
  }
  all.reverse();

  const pipeline = getBusinessPipeline(db, businessId);
  const members = db.members
    .filter((m) => m.businessId === businessId && m.active !== false)
    .map((m) => {
      const user = db.users.find((u) => u.id === m.userId);
      return {
        userId: m.userId,
        name: user?.name || m.note || 'Membro',
        role: m.role,
      };
    });

  // Também inclui o owner
  const biz = db.businesses.find((b) => b.id === businessId);
  if (biz) {
    const owner = db.users.find((u) => u.id === biz.ownerId);
    if (owner && !members.some((m) => m.userId === owner.id)) {
      members.unshift({ userId: owner.id, name: owner.name, role: 'OWNER' });
    }
  }

  return NextResponse.json({
    leads: all.slice((page - 1) * limit, page * limit),
    total: all.length,
    page,
    limit,
    pipeline,
    members,
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { businessId, id, status, stageId, assignedUserId, noteText, priority, interest } = body;
    const guard = await requireBusiness(req, businessId, 'leads');
    if (!guard.ok) return guard.res;
    const db = guard.db;
    const current = db.leads.find((x) => x.id === id && x.businessId === businessId);
    if (!current) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });

    const actor = {
      id: guard.ctx.user.id,
      name: guard.ctx.user.name || 'Equipe',
      role: guard.ctx.role,
    };

    let updatedLead: any = null;
    let stageChanged = false;

    await updateDB((d) => {
      const l = d.leads.find((x) => x.id === id && x.businessId === businessId);
      if (!l) throw err('Cliente não encontrado.', 404);

      // 1. Mudança de estágio por stageId (novo motor P3)
      if (stageId && stageId !== l.stageId) {
        moveLeadStage(d, {
          businessId,
          leadId: l.id,
          toStageId: stageId,
          note: body.note,
          actor,
        });
        stageChanged = true;
      }
      // 2. Mudança de status legado (compatibilidade estrita)
      else if (status && status !== l.status) {
        const to = status as LeadStatus;
        if (!LEAD_FLOW[l.status] || !canTransition(LEAD_FLOW, l.status, to)) {
          throw err(`Não é possível mudar de "${l.status}" para "${status}".`, 422);
        }
        const fromStage = l.stageId || l.status;
        l.status = to;
        l.stageId = to;
        l.lastInteraction = new Date().toISOString();
        if (!Array.isArray(l.stageHistory)) l.stageHistory = [];
        l.stageHistory.push({
          id: randomUUID(),
          fromStage,
          toStage: to,
          movedBy: actor.id,
          movedByName: actor.name,
          at: new Date().toISOString(),
          note: body.note,
        });
        stageChanged = true;
      }

      // 3. Atribuição de responsável
      if (assignedUserId !== undefined && assignedUserId !== l.assignedUserId) {
        assignLead(d, {
          businessId,
          leadId: l.id,
          assignedUserId,
          actor,
        });
      }

      // 4. Observação adicional
      if (noteText) {
        addLeadNote(d, {
          businessId,
          leadId: l.id,
          text: noteText,
          actor,
        });
      }

      if (priority) l.priority = priority;
      if (interest) l.interest = String(interest).slice(0, 500);

      l.lastInteraction = new Date().toISOString();
      updatedLead = l;
    });

    // Webhooks
    try {
      await updateDB(async (d: DB) => {
        if (stageChanged) {
          await dispatchWebhook(d, 'lead.stage_changed', businessId, { lead: updatedLead });
        }
        await dispatchWebhook(d, 'lead.updated', businessId, { lead: updatedLead });
      });
    } catch { /* noop */ }

    return NextResponse.json({ ok: true, lead: updatedLead });
  } catch (e: any) {
    const status = e?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar.' : e.message }, { status });
  }
}
