// ═══════════════════════════════════════════════════════════════
// F3-G · Política Meta de janela de atendimento (CSW 24h) + marketing
// ═══════════════════════════════════════════════════════════════
// Fonte: documentação oficial Meta (customer service window 24h).
// DENTRO da janela (última msg do paciente < 24h): freeform ok.
// FORA da janela: só template aprovado. Se não houver template:
//   → template_required (não tenta texto livre).
// NÃO espalhar `if (24h)` pelos componentes — usar estas funções.

export const CSW_MS = 24 * 60 * 60 * 1000;

export interface WindowDecision {
  insideWindow: boolean;
  requiresTemplate: boolean;
  /** Motivo amigável quando requiresTemplate. */
  reason?: string;
}

/**
 * Decisão central de janela a partir do último inbound do participante.
 * `lastInboundAt` ISO | '' | undefined.
 */
export function canSendFreeform(lastInboundAt: string | undefined, now = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  if (!Number.isFinite(t)) return false;
  return now - t < CSW_MS;
}

export function requiresTemplate(lastInboundAt: string | undefined, now = Date.now()): boolean {
  return !canSendFreeform(lastInboundAt, now);
}

export function evaluateWindow(lastInboundAt: string | undefined, now = Date.now()): WindowDecision {
  const inside = canSendFreeform(lastInboundAt, now);
  if (inside) return { insideWindow: true, requiresTemplate: false };
  return {
    insideWindow: false,
    requiresTemplate: true,
    reason: 'Fora da janela de 24h de atendimento — use um template aprovado.',
  };
}

/**
 * Consentimento de marketing (aceitaPromoções / marketingOptIn).
 * Só bloqueia MENSAGEM DE MARKETING — operacional/transactional não usa isto.
 */
export function canSendMarketing(acceptsPromotions: boolean | undefined): boolean {
  return acceptsPromotions === true;
}

export function marketingBlockedReason(acceptsPromotions: boolean | undefined): string | null {
  if (canSendMarketing(acceptsPromotions)) return null;
  return 'Contato não aceita mensagens promocionais.';
}
