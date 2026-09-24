// ═══════════════════════════════════════════════════════════════
// F3-G · Progressão determinística de status (webhooks fora de ordem)
// ═══════════════════════════════════════════════════════════════
// Eventos Meta podem chegar fora de ordem: NUNCA regrdir
// read → delivered só porque um webhook atrasado chegou depois.
//
// progressão: pending → sent → delivered → read
// failed é estado próprio (exige tratamento; não regride para delivered)

import type { MessageStatus } from '../types';

/** Ranking para comparação (failed tratado à parte). */
const RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export type IncomingProviderStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Deve o status `incoming` substituir o atual?
 * - failed → sempre aceita (tratamento próprio).
 * - progressão monotônica: só avança (sent < delivered < read).
 * - atraso (read chegou antes de delivered, depois delivered chega) → NÃO regride.
 */
export function shouldAdvanceStatus(
  current: MessageStatus | string | undefined,
  incoming: IncomingProviderStatus | string,
): boolean {
  if (incoming === 'failed') return true;
  if (!current || current === 'failed') {
    // failed pode voltar a progressing? Mantemos failed fixo até retry manual.
    if (current === 'failed') return false;
    return incoming !== 'failed';
  }
  const cur = RANK[String(current)];
  const next = RANK[String(incoming)];
  if (cur === undefined) return true;
  if (next === undefined) return false;
  return next > cur;
}

/** Aplica progressão; retorna o status final (idempotente). */
export function advanceStatus(
  current: MessageStatus | string | undefined,
  incoming: IncomingProviderStatus | string,
): MessageStatus | string {
  if (shouldAdvanceStatus(current, incoming)) return incoming as MessageStatus;
  return (current || 'pending') as MessageStatus;
}
