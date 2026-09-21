import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite, runRelationalRead, relationalLeadsDoc, leadWriteSpec, rowToLead } from '@/lib/relational/slice';
import { requireBusiness } from '@/lib/access';
import { isFeatureEnabled } from '@/lib/features';
import { customerFromRequest } from '@/lib/customer-auth';
import { onlyDigits } from '@/lib/utils';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import type { DB } from '@/lib/types';
import {
  ingestLead, getBusinessPipeline, moveLeadStage, assignLead, addLeadNote, updateLeadFields,
  isLegacyLeadStatus, stageForLegacyStatus, normalizeLeadStageId, mapStageToStatus, resolveStageId,
  STAGE_ALIASES, LEGACY_LEAD_STATUSES, stagesInOrder,
} from '@/lib/pipeline';
import { getPool } from '@/lib/relational/pool';
import { enqueueWebhookTx, deliverWebhookIds } from '@/lib/webhooks';

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
    // MODO RELACIONAL: o negócio vem do SQL — o documento legado NÃO é tocado.
    let business: any;
    if (relationalActive()) {
      const { getPool } = await import('@/lib/relational/pool');
      const { rowToBusiness } = await import('@/lib/relational/slice');
      const bRow = await getPool().query('SELECT * FROM app.businesses WHERE id = $1', [String(body.businessId || '')]);
      if (!bRow.rows[0]) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
      business = rowToBusiness(bRow.rows[0]);
    } else {
      const db = await readDB();
      business = db.businesses.find((b) => b.id === body.businessId);
    }
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

    const webhookDeliveryIds: string[] = [];
    const ingest = (d: DB) => {
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

      // Outbox e alteração de negócio no mesmo commit; nenhum HTTP aqui.
      webhookDeliveryIds.push(...enqueueWebhookTx(d, result!.isNew ? 'lead.created' : 'lead.updated', business.id, {
        lead: result!.lead,
        isNew: result!.isNew,
      }).map((delivery) => delivery.id));
    };
    // MODO RELACIONAL: ingestLead canônico sobre a fatia da unidade no SQL.
    // Entrega HTTP do webhook fica para o ciclo do motor de documento
    // (outbox permanece pending — portada em rodada própria).
    if (relationalActive()) {
      // Carrega SÓ as identidades candidatas (dedupe exato) + pipeline/config
      // de webhook da unidade — nunca o histórico da esteira.
      await runRelationalWrite(business.id, ingest, {
        load: leadWriteSpec({
          phones: [onlyDigits(phone)],
          emails: [email],
          customerId: customer?.id || '',
          name,
        }),
      });
    } else {
      await updateDB(ingest);
      // Disparo de Webhook
      try {
        await deliverWebhookIds(webhookDeliveryIds);
      } catch { /* noop */ }
    }

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

  if (relationalActive()) {
    // PAGINAÇÃO NO SQL (fim do corte fixo de 500): o total vem de COUNT(*)
    // com o MESMO filtro da página e a janela vem de LIMIT/OFFSET — todas as
    // páginas alcançáveis. O filtro de etapa compara pelo stage_id bruto que
    // NORMALIZA para a etapa pedida (mesma fn de resolução do produto), com
    // fallback explícito: todo valor desconhecido cai na 1ª etapa.
    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));
    const stage = req.nextUrl.searchParams.get('stage') || '';

    const base = await runRelationalRead(businessId, {
      pipelines: {}, members: {},
      users: (partial: any) => {
        const ids = new Set<string>((partial.members || []).map((m: any) => m.userId).filter(Boolean));
        const ownerId = partial.businesses?.[0]?.ownerId;
        if (ownerId) ids.add(ownerId);
        if (ids.size === 0) return null;
        return { global: true, where: 'id = ANY($2)', args: [[...ids]] };
      },
    });
    const pipeline = getBusinessPipeline(base, businessId);

    const conds = ['business_id = $1'];
    const args: unknown[] = [businessId];
    if (stage) {
      const target = resolveStageId(pipeline, stage).stageId;
      // Universo de valores brutos conhecidos (ids canônicos, mappedStatus,
      // aliases pt/br e status legados) → quais normalizam para a etapa alvo.
      const universe = new Set<string>();
      for (const st of stagesInOrder(pipeline)) {
        universe.add(st.id);
        if (st.mappedStatus) universe.add(st.mappedStatus);
      }
      for (const alias of Object.keys(STAGE_ALIASES)) universe.add(alias);
      for (const legacy of LEGACY_LEAD_STATUSES) universe.add(legacy);
      const toTarget = [...universe].filter((r) => resolveStageId(pipeline, r).stageId === target);
      const firstId = stagesInOrder(pipeline)[0]?.id || 'new';
      args.push(toTarget);
      if (target === firstId) {
        // 1ª etapa: unknown/fora do universo TAMBÉM caem nela (fallback).
        args.push([...universe]);
        conds.push(`(stage_id = ANY($${args.length - 1}) OR NOT (stage_id = ANY($${args.length})))`);
      } else {
        conds.push(`stage_id = ANY($${args.length})`);
      }
    }
    const pool = getPool();
    const countRes = await pool.query(
      `SELECT count(*)::int AS n FROM app.leads WHERE ${conds.join(' AND ')}`,
      args,
    );
    const total = countRes.rows[0]?.n || 0;
    const pageRes = await pool.query(
      `SELECT * FROM app.leads WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      args,
    );
    const leads = pageRes.rows.map(rowToLead);
    const members = (base.members || [])
      .filter((m: any) => m.businessId === businessId && m.active !== false)
      .map((m: any) => {
        const user = (base.users || []).find((u: any) => u.id === m.userId);
        return { userId: m.userId, name: user?.name || m.note || 'Membro', role: m.role };
      });
    const biz = (base.businesses || [])[0];
    if (biz) {
      const owner = (base.users || []).find((u: any) => u.id === biz.ownerId);
      if (owner && !members.some((m: any) => m.userId === owner.id)) {
        members.unshift({ userId: owner.id, name: owner.name, role: 'OWNER' });
      }
    }
    return NextResponse.json({
      leads,
      total,
      page,
      limit,
      pipeline,
      members,
      canEditPipeline: guard.ctx.permissions.config === true,
      business: biz ? { id: biz.id, name: biz.name } : null,
    });
  }

  // MODO LEGADO (rollback): comportamento histórico intacto.
  const db = guard.db;
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 50));
  const stage = req.nextUrl.searchParams.get('stage') || '';

  const pipeline = getBusinessPipeline(db, businessId);

  // A1.2 · Bloco 2 (F3): o filtro compara pela etapa NORMALIZADA do lead —
  // entrada legada/inválida não deixa lead órfão nem vaza para outra etapa.
  let all = db.leads.filter((l) => l.businessId === businessId);
  if (stage) {
    const target = resolveStageId(pipeline, stage).stageId;
    all = all.filter((l) => normalizeLeadStageId(pipeline, l) === target);
  }
  all.reverse();

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
    // A1.2 · Bloco 2: administrar as etapas do funil é ação de configuração.
    // A UI mostra o editor somente com este flag; o servidor continua sendo a
    // autoridade (PATCH /api/pipeline exige 'config').
    canEditPipeline: guard.ctx.permissions.config === true,
    // A1.2 · Bloco 3: o NOME do negócio vem daqui (mesma unidade do contexto,
    // já validada pelo guard) — a UI nunca mais usa o `businessId` como se
    // fosse nome/identificador de contato em mensagens.
    business: biz ? { id: biz.id, name: biz.name } : null,
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

    const webhookDeliveryIds: string[] = [];
    const mutate = (d: DB) => {
      const l = d.leads.find((x) => x.id === id && x.businessId === businessId);
      if (!l) throw err('Cliente não encontrado.', 404);

      // 1. Mudança de estágio por stageId (máquina oficial — PipelineStage)
      // A3: `scheduled` é estrutural de agenda — nunca via PATCH manual sem booking.
      if (stageId) {
        if (stageId === 'scheduled') {
          throw err('Mover para Agendado requer agendamento real. Use o fluxo de agendamento.', 422);
        }
        if (stageId !== l.stageId) {
          // também bloqueia se o destino normalizado for scheduled (alias)
          const pipelineTmp = getBusinessPipeline(d, businessId);
          const resolved = stageForLegacyStatus(pipelineTmp, stageId) || stageId;
          // resolveStageId pode ser mais preciso, mas guard simples:
          if (resolved === 'scheduled') {
            throw err('Mover para Agendado requer agendamento real. Use o fluxo de agendamento.', 422);
          }
          moveLeadStage(d, {
            businessId,
            leadId: l.id,
            toStageId: stageId,
            note: body.note,
            actor,
          });
          stageChanged = true;
        } else {
          // no-op mas repara projeção silenciosamente (moveLeadStage já faz, chamamos para reparar)
          try { moveLeadStage(d, { businessId, leadId: l.id, toStageId: stageId, actor }); } catch {}
        }
      }
      // 2. Entrada legada em LeadStatus (compatibilidade — A1.2 · Bloco 2 · F1):
      //    NUNCA escreve estado diretamente. O status é convertido
      //    EXPLICITAMENTE para uma etapa válida da esteira do negócio e o
      //    movimento passa pelo mecanismo oficial (moveLeadStage). Antes, esta
      //    branch gravava `stageId = "contacted"` — id que não é etapa de
      //    pipeline nenhum. Se a projeção de status já corresponde ao pedido,
      //    é no-op (mesma semântica do `status !== l.status` antigo).
      else if (status) {
        if (!isLegacyLeadStatus(status)) {
          throw err(`Status "${status}" não é válido.`, 422);
        }
        const pipelineNow = getBusinessPipeline(d, businessId);
        const currentStageId = normalizeLeadStageId(pipelineNow, l);
        // Reparo silencioso de registro legado/quebrado (ex.: stageId cru
        // "contacted" gravado pelo código antigo): sem movimento real, sem
        // entrada de histórico — só o alinhamento do campo.
        if (l.stageId !== currentStageId) {
          l.stageId = currentStageId;
        }
        if (mapStageToStatus(pipelineNow, currentStageId) !== status) {
          const targetStageId = stageForLegacyStatus(pipelineNow, status);
          if (!targetStageId) {
            throw err(`Nenhuma etapa desta esteira corresponde ao status "${status}".`, 422);
          }
          // F2 — instrumentação leve do uso legado relevante (sem sistema de
          // observabilidade novo): quem ainda escreve pelo caminho antigo.
          console.warn('[funil] escrita legada LeadStatus convertida para etapa', {
            businessId, leadId: l.id, status, targetStageId,
          });
          moveLeadStage(d, {
            businessId,
            leadId: l.id,
            toStageId: targetStageId,
            note: body.note,
            actor,
          });
          stageChanged = true;
        }
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

      // Campos livres do lead têm UM atualizador oficial (o mesmo que a
      // automação chama) — a rota não escreve esses campos por conta própria.
      if (priority || interest) {
        updateLeadFields(d, {
          businessId,
          leadId: l.id,
          patch: {
            ...(priority ? { priority } : {}),
            ...(interest ? { interest } : {}),
          },
          actor: { id: actor.id, name: actor.name, role: actor.role, type: 'user' },
        });
      }

      updatedLead = l;

      // Outbox e alteração de negócio no mesmo commit; nenhum HTTP aqui.
      if (stageChanged) {
        webhookDeliveryIds.push(...enqueueWebhookTx(d, 'lead.stage_changed', businessId, { lead: updatedLead }).map((delivery) => delivery.id));
      }
      webhookDeliveryIds.push(...enqueueWebhookTx(d, 'lead.updated', businessId, { lead: updatedLead }).map((delivery) => delivery.id));
    };
    // MODO RELACIONAL: moveLeadStage/assignLead/addLeadNote canônicos na fatia.
    if (relationalActive()) {
      await runRelationalWrite(String(businessId || ''), mutate, {
        load: leadWriteSpec({
          leadId: String(body.id || ''),
          assignedUserId: body.assignedUserId !== undefined ? String(body.assignedUserId || '') : undefined,
        }),
      });
    } else {
      await updateDB(mutate);
      // Webhooks
      try {
        await deliverWebhookIds(webhookDeliveryIds);
      } catch { /* noop */ }
    }

    return NextResponse.json({ ok: true, lead: updatedLead });
  } catch (e: any) {
    const status = e?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar.' : e.message }, { status });
  }
}
