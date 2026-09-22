import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { requireBusiness } from '@/lib/access';
import { updateDB } from '@/lib/db';
import { pushAudit } from '@/lib/audit';
import { EXTERNAL_EVENT_DEFS, MAX_INBOUND_BYTES } from '@/lib/integrations/contract';
import { providerDef, providerViewsByKind, OUTBOUND_WEBHOOKS_OWNER } from '@/lib/integrations/catalog';
import {
  createIntegration, deleteIntegration, findIntegration, listBusinessIntegrations,
  rotateIntegrationCredentials, setIntegrationStatus, updateIntegration,
  type CreateIntegrationResult, type UpdateIntegrationInput,
} from '@/lib/integrations/connections';
import { integrationEventsOf, summarizeIntegrationEvents } from '@/lib/integrations/logs';
import type { ExternalEventName, IntegrationProviderId } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// P6 — CANAIS E INTEGRAÇÕES EXTERNAS (administração por unidade)
// ═══════════════════════════════════════════════════════════════
// Permissão `config` (a mesma de Configurações). Toda resposta é SEGURA:
// nenhum token, hash ou segredo completo sai daqui — o valor cru de token e
// segredo aparece UMA única vez, na criação ou na rotação.
//
// O tenant vem SEMPRE do contexto autenticado (`requireBusiness`): o
// `businessId` do corpo é só o endereço da própria unidade — id de outra
// unidade é recusado pelo guard (403), nunca resolvido por query solta.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function businessIdOf(req: NextRequest, body?: Record<string, any>): string {
  return String(body?.businessId || req.nextUrl.searchParams.get('businessId') || '').trim();
}

export async function GET(req: NextRequest) {
  const blocked = blockIfRelational('Integrações');
  if (blocked) return blocked;

  const businessId = businessIdOf(req);
  const guard = await requireBusiness(req, businessId, 'config');
  if (!guard.ok) return guard.res;

  const connections = listBusinessIntegrations(guard.db, businessId);
  const byKind = providerViewsByKind(connections);
  const integrationId = String(req.nextUrl.searchParams.get('integrationId') || '').trim();
  const limit = Number(req.nextUrl.searchParams.get('limit')) || 30;

  return NextResponse.json({
    ok: true,
    businessId,
    // Catálogo (o que existe e o que JÁ funciona) + conexões da unidade.
    channels: byKind.channel,
    sources: byKind.source,
    technical: byKind.technical,
    connections,
    events: integrationEventsOf(guard.db, businessId, { integrationId: integrationId || undefined, limit }),
    summary: summarizeIntegrationEvents(guard.db, businessId),
    eventsCatalog: EXTERNAL_EVENT_DEFS,
    limits: { maxInboundBytes: MAX_INBOUND_BYTES },
    // Webhooks de SAÍDA continuam sendo o canal assinado do P3 (fonte única).
    outboundWebhooks: { owner: OUTBOUND_WEBHOOKS_OWNER, endpoint: '/api/integrations/webhooks' },
  });
}

export async function POST(req: NextRequest) {
  const blocked = blockIfRelational('Integrações');
  if (blocked) return blocked;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const businessId = businessIdOf(req, body);
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;

    const provider = String(body.provider || '').trim() as IntegrationProviderId;
    const def = providerDef(provider);
    if (!def) return NextResponse.json({ ok: false, error: 'Provedor de integração desconhecido.' }, { status: 400 });

    const created = await updateDB<CreateIntegrationResult>((d) => {
      const result = createIntegration(d, businessId, {
        provider,
        name: body.name,
        defaultEvent: typeof body.defaultEvent === 'string' ? body.defaultEvent as ExternalEventName : undefined,
        requireSignature: body.requireSignature === true,
        config: body.config,
        createdByUserId: guard.ctx.user.id,
      });
      if (result.ok && result.integration) {
        pushAudit(d, {
          action: 'integration.created',
          actor: guard.ctx.user,
          businessId,
          meta: { integrationId: result.integration.id, provider, kind: def.kind },
        });
      }
      return result;
    });

    if (!created.ok) {
      return NextResponse.json({ ok: false, error: created.error }, { status: created.status || 400 });
    }

    // TOKEN e SEGREDO aparecem AQUI e nunca mais (nem em GET, nem no log).
    return NextResponse.json({
      ok: true,
      integration: created.integration,
      token: created.token,
      signingSecret: created.signingSecret,
      endpointPath: created.endpointPath,
      warning: 'Guarde o token agora: ele não será mostrado novamente.',
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Erro ao criar a integração.' }, { status: err?.status || 400 });
  }
}

interface PatchOutcome {
  ok: boolean;
  status?: number;
  error?: string;
  integration?: unknown;
  token?: string;
  signingSecret?: string;
  warning?: string;
}

export async function PATCH(req: NextRequest) {
  const blocked = blockIfRelational('Integrações');
  if (blocked) return blocked;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const businessId = businessIdOf(req, body);
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;

    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ ok: false, error: 'Integração não informada.' }, { status: 400 });
    const action = String(body.action || '').trim();

    const outcome = await updateDB<PatchOutcome>((d) => {
      if (action === 'rotate') {
        const rotated = rotateIntegrationCredentials(d, businessId, id);
        if (!rotated.ok) return { ok: false, status: rotated.status || 400, error: rotated.error };
        pushAudit(d, {
          action: 'integration.token_rotated', actor: guard.ctx.user, businessId, meta: { integrationId: id },
        });
        return {
          ok: true,
          integration: rotated.integration,
          token: rotated.token,
          signingSecret: rotated.signingSecret,
          warning: 'Novo token gerado: o anterior deixou de funcionar.',
        };
      }

      if (action === 'pause' || action === 'activate') {
        const updated = setIntegrationStatus(d, businessId, id, action === 'pause' ? 'paused' : 'active');
        if (!updated.ok) return { ok: false, status: updated.status || 400, error: updated.error };
        pushAudit(d, {
          action: 'integration.updated', actor: guard.ctx.user, businessId,
          meta: { integrationId: id, status: updated.integration?.status },
        });
        return { ok: true, integration: updated.integration };
      }

      if (!findIntegration(d, businessId, id)) {
        return { ok: false, status: 404, error: 'Integração não encontrada.' };
      }
      const patch: UpdateIntegrationInput = {};
      if (typeof body.name === 'string') patch.name = body.name;
      if (typeof body.defaultEvent === 'string') patch.defaultEvent = body.defaultEvent as ExternalEventName | '';
      if (typeof body.requireSignature === 'boolean') patch.requireSignature = body.requireSignature;
      if (body.config !== undefined) patch.config = body.config;
      const updated = updateIntegration(d, businessId, id, patch);
      if (!updated.ok) return { ok: false, status: updated.status || 400, error: updated.error };
      pushAudit(d, { action: 'integration.updated', actor: guard.ctx.user, businessId, meta: { integrationId: id } });
      return { ok: true, integration: updated.integration };
    });

    if (!outcome.ok) {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status || 400 });
    }
    return NextResponse.json(outcome);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Erro ao atualizar a integração.' }, { status: err?.status || 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const blocked = blockIfRelational('Integrações');
  if (blocked) return blocked;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const businessId = businessIdOf(req, body);
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;

    const id = String(body.id || '').trim();
    if (!id) return NextResponse.json({ ok: false, error: 'Integração não informada.' }, { status: 400 });

    const removed = await updateDB((d) => {
      const integration = findIntegration(d, businessId, id);
      const result = deleteIntegration(d, businessId, id);
      if (result.ok && integration) {
        pushAudit(d, {
          action: 'integration.deleted',
          actor: guard.ctx.user,
          businessId,
          meta: { integrationId: id, provider: integration.provider, eventsRemoved: result.removedEvents },
        });
      }
      return result;
    });

    if (!removed.ok) return NextResponse.json({ ok: false, error: removed.error }, { status: 404 });
    return NextResponse.json({ ok: true, removedEvents: removed.removedEvents });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Erro ao remover a integração.' }, { status: err?.status || 400 });
  }
}
