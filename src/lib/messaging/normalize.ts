// ═══════════════════════════════════════════════════════════════
// F3-G · Normalização inbound Meta → NormalizedInboundMessage
// ═══════════════════════════════════════════════════════════════
// Texto, quick reply/button reply, interactive reply no primeiro escopo.
// Mídia: metadata suficiente + unsupported_media (sem pipeline de mídia).

import type { NormalizedInboundMessage } from './types';

const MEDIA_TYPES = new Set([
  'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'reaction',
]);

/**
 * Converte um objeto `messages[]` do webhook Meta em nosso modelo.
 * Retorna null se não houver id/from suficiente.
 */
export function normalizeInboundMessage(
  raw: any,
  contactName?: string,
): NormalizedInboundMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const providerMessageId = String(raw.id || '');
  const from = String(raw.from || raw.phone || '');
  if (!providerMessageId && !from) return null;
  const timestamp = String(raw.timestamp || '');
  const type = String(raw.type || 'text');

  if (type === 'text') {
    return {
      provider: 'whatsapp',
      providerMessageId,
      from,
      timestamp,
      type: 'text',
      text: String(raw.text?.body ?? raw.body ?? '').slice(0, 4000),
      ...(contactName ? { contactName } : {}),
    };
  }

  // Interactive: button_reply | list_reply — id é a fonte de verdade (não só o título)
  if (type === 'interactive') {
    const br = raw.interactive?.button_reply;
    const lr = raw.interactive?.list_reply;
    const reply = br || lr;
    const title = String(reply?.title || '');
    const id = String(reply?.id || '');
    if (!id && !title) {
      return {
        provider: 'whatsapp',
        providerMessageId,
        from,
        timestamp,
        type: 'unsupported',
        ...(contactName ? { contactName } : {}),
      };
    }
    return {
      provider: 'whatsapp',
      providerMessageId,
      from,
      timestamp,
      type: 'interactive',
      // Texto visual do botão vira body para a Inbox; intenção usa id quando existir.
      text: title || id,
      interactiveReply: {
        id,
        title,
        kind: br ? 'button_reply' : 'list_reply',
      },
      ...(contactName ? { contactName } : {}),
    };
  }

  if (MEDIA_TYPES.has(type)) {
    return {
      provider: 'whatsapp',
      providerMessageId,
      from,
      timestamp,
      type: 'unsupported_media',
      text: `[${type}]`,
      media: {
        kind: type,
        mimeType: String(raw[type]?.mime_type || ''),
        mediaId: String(raw[type]?.id || ''),
      },
      ...(contactName ? { contactName } : {}),
    };
  }

  return {
    provider: 'whatsapp',
    providerMessageId,
    from,
    timestamp,
    type: type === 'unsupported' ? 'unsupported' : type,
    text: type === 'button' ? String(raw.button?.text || raw.button?.payload || '') : '',
    ...(type === 'button' ? { interactiveReply: { id: String(raw.button?.payload || ''), title: String(raw.button?.text || ''), kind: 'button_reply' } } : {}),
    ...(contactName ? { contactName } : {}),
  };
}

/** Intenção normalizada a partir de interactive reply (confirmar/remarcar/cancelar…). */
export function interactiveIntent(reply: { id?: string; title?: string } | undefined): string | null {
  if (!reply) return null;
  const key = `${reply.id || ''} ${reply.title || ''}`.toLowerCase();
  if (/confirm/.test(key)) return 'confirmar';
  if (/remarc|reagend|alterar/.test(key)) return 'remarcar';
  if (/cancel/.test(key)) return 'cancelar';
  return null;
}
