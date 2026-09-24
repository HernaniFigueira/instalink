// ═══════════════════════════════════════════════════════════════
// F3-G · MessagingService — camada ÚNICA de envio
// ═══════════════════════════════════════════════════════════════
// Inbox humano, Agent e Automações usam ESTA camada.
// Nunca: React → Graph; Agent → token Meta; Automation → fetch(graph…).
//
// 1. intenção GoDoutor
// 2. seleciona provider (simulator explícito | whatsapp_cloud)
// 3. verifica conexão
// 4. valida política (janela 24h, marketing, quiet-hours já antes do envio)
// 5. chama provider
// 6. normaliza resultado
// 7. atualiza ConversationMessage
// 8. message.sent só semanticamente correto (aceito ≠ entregue)

import { randomUUID } from 'node:crypto';
import type { DB, Message } from '../types';
import { emitAutomationEvent } from '../automation/events';
import { evaluateWindow, canSendMarketing, marketingBlockedReason } from './policy';
import type { MessagingProvider, MessagingProviderId, MessagingResult, SendTextParams } from './types';
import { simulatorProvider } from './simulator';
import { whatsappCloudProvider } from './whatsapp-cloud';

export type SendIntent = 'human' | 'ai' | 'automation' | 'system';

export interface SendConversationMessageInput {
  businessId: string;
  conversationId: string;
  /** Destinatário (telefone). Default: phone da conversa. */
  to?: string;
  body: string;
  by: SendIntent;
  byName?: string;
  /** forcar_simulator: só em modo homologação explícito. */
  useSimulator?: boolean;
  /** marketing=true exige consentimento. */
  marketing?: boolean;
  /** Template quando política exigir (ou force). */
  template?: { name: string; language?: string; components?: unknown[] };
  at?: string;
}

export interface SendConversationMessageOutcome extends MessagingResult {
  messageId?: string;
  /** Política barrou antes do provider. */
  policyCode?: 'template_required' | 'template_not_configured' | 'marketing_consent' | 'awaiting_channel';
}

function pickProvider(useSimulator?: boolean): MessagingProvider {
  if (useSimulator) return simulatorProvider;
  return whatsappCloudProvider;
}

function isSimulator(p: MessagingProvider): boolean {
  return p.id === 'simulator';
}

/**
 * Envia mensagem de conversa pelo caminho único.
 * Atualiza Message (ConversationMessage legado) e emite eventos.
 */
export async function sendConversationMessage(
  db: DB,
  input: SendConversationMessageInput,
): Promise<SendConversationMessageOutcome> {
  const conv = db.conversations.find(
    (c) => c.id === input.conversationId && c.businessId === input.businessId,
  );
  if (!conv) {
    return {
      ok: false,
      provider: 'unknown',
      providerMessageId: '',
      status: 'failed',
      errorMessage: 'Conversa não encontrada.',
      policyCode: 'awaiting_channel',
    };
  }

  const to = String(input.to || conv.phone || '').replace(/\D/g, '');
  const body = String(input.body || '').slice(0, 4000);
  const now = input.at || new Date().toISOString();
  const provider = pickProvider(input.useSimulator);

  // ── Política de marketing ──
  if (input.marketing) {
    const contact = db.contacts.find((c) => c.id === conv.contactId && c.businessId === input.businessId);
    const consent = contact?.marketingOptIn === true;
    if (!canSendMarketing(consent)) {
      return {
        ok: false,
        provider: provider.id,
        providerMessageId: '',
        status: 'blocked',
        errorMessage: marketingBlockedReason(consent) || 'Sem consentimento de marketing.',
        policyCode: 'marketing_consent',
      };
    }
  }

  // ── Política de janela (24h) — só para freeform real (não simulador) ──
  const isSim = isSimulator(provider);
  if (!isSim) {
    const decision = evaluateWindow(conv.lastInboundAt);
    if (decision.requiresTemplate && !input.template?.name) {
      return {
        ok: false,
        provider: provider.id,
        providerMessageId: '',
        status: 'template_required',
        errorMessage: decision.reason || 'Template required.',
        policyCode: 'template_required',
      };
    }
  }

  // Grava Message pending ANTES (para correlação) quando for real/sim
  const msgId = randomUUID();
  const meta: Record<string, any> = {
    provider: provider.id,
    by: input.by,
    ...(isSim ? { simulator: true } : {}),
  };
  const draft: Message = {
    id: msgId,
    businessId: input.businessId,
    conversationId: conv.id,
    direction: 'out',
    body,
    status: 'pending',
    externalId: '',
    by: input.by === 'human' ? (input.byName || 'human') : input.by === 'ai' || input.by === 'automation' ? 'automation' : 'system',
    byName: input.byName || (input.by === 'ai' ? '✨ IA' : input.by === 'human' ? 'Equipe' : 'Automação'),
    channel: conv.channel === 'instagram' ? 'instagram' : 'whatsapp',
    at: now,
    meta,
  };
  // by para humano real deve ser userId — chamador pode sobrescrever via byName/id
  if (input.by === 'human' && input.byName) draft.by = input.byName;

  db.messages.push(draft);

  let result: MessagingResult;
  if (input.template?.name) {
    result = await provider.sendTemplate({
      businessId: input.businessId,
      to,
      templateName: input.template.name,
      language: input.template.language,
      components: input.template.components,
    });
  } else {
    const params: SendTextParams = { businessId: input.businessId, to, body };
    result = await provider.sendText(params);
  }

  const stored = db.messages.find((m) => m.id === msgId)!;
  if (result.ok) {
    stored.externalId = result.providerMessageId;
    stored.status = 'pending'; // aceito; delivered/read via webhook (nunca assumir delivered no 200)
    stored.meta = { ...(stored.meta || {}), provider: result.provider, acceptedAt: now };
    conv.lastMessageAt = now;
    conv.lastMessagePreview = body.slice(0, 120);

    emitAutomationEvent(db, {
      event: 'message.sent',
      businessId: input.businessId,
      at: now,
      data: {
        conversationId: conv.id,
        channel: conv.channel,
        phone: conv.phone,
        provider: result.provider,
        by: input.by,
        providerMessageId: result.providerMessageId,
        // aceito — não confundir com delivered
        delivery: 'accepted',
      },
    });
  } else {
    stored.status = result.status === 'awaiting_channel' || result.status === 'template_required' || result.status === 'blocked'
      ? 'failed' : 'failed';
    stored.error = result.errorMessage || 'Falha de envio.';
    stored.meta = {
      ...(stored.meta || {}),
      provider: result.provider,
      errorCode: result.errorCode,
      policyCode: result.policyCode,
    };
  }

  let policyCode: SendConversationMessageOutcome['policyCode'];
  if (result.ok) policyCode = undefined;
  else if (result.status === 'awaiting_channel') policyCode = 'awaiting_channel';
  else if (result.status === 'template_required') policyCode = 'template_required';
  else if (result.status === 'template_not_configured') policyCode = 'template_not_configured';
  else if (result.status === 'blocked') policyCode = 'marketing_consent';
  else policyCode = undefined;
  const { policyCode: _drop, ...rest } = result as MessagingResult & { policyCode?: string };
  return {
    ...rest,
    messageId: msgId,
    ...(policyCode ? { policyCode } : {}),
  };
}

/** Health view para UI (sem segredo). */
export function messagingHealth(db: DB, businessId: string): {
  state: 'connected' | 'configuring' | 'error' | 'simulator';
  label: string;
  detail: string;
} {
  const business = db.businesses.find((b) => b.id === businessId);
  const integration = business?.whatsappIntegration;
  const hasCreds = !!(integration?.phoneNumberId && (integration.encryptedAccessToken
    || (process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)));
  if (!hasCreds) {
    if (process.env.MESSAGING_FORCE_SIMULATOR === '1') {
      return { state: 'simulator', label: 'SIMULADOR', detail: 'Modo simulação ativo — nenhuma saída real.' };
    }
    return { state: 'error', label: '🔴 Erro de conexão', detail: 'WhatsApp não configurado (BLOCKED_META_CREDENTIAL).' };
  }
  if (integration?.status === 'connected') {
    return {
      state: 'connected',
      label: '🟢 Conectado',
      detail: integration.displayPhone || `Número ••••${(integration.phoneNumberId || '').slice(-4)}`,
    };
  }
  return { state: 'configuring', label: '🟡 Configuração incompleta', detail: 'Complete os dados da conta oficial.' };
}
