// ═══════════════════════════════════════════════════════════════
// AUTENTICAÇÃO DAS TAREFAS AGENDADAS (SCHEDULER EXTERNO)
// ═══════════════════════════════════════════════════════════════
// Padrão `CRON_SECRET` (o mesmo usado por agendadores hospedados, incluindo o
// cron nativo da Vercel, sem inventar segredo novo):
//
//   1. a variável CRON_SECRET é definida no ambiente do projeto;
//   2. o agendador (cron da VPS, agendador externo, Vercel Cron ou operação
//      manual) faz GET no endpoint com
//        Authorization: Bearer <CRON_SECRET>
//   3. a rota compara o valor recebido em TEMPO CONSTANTE e só executa a
//      fila quando confere.
//
// O app não assume QUAL agendador é: só exige a credencial correta. FALHA
// FECHADA: sem CRON_SECRET no ambiente o consumidor fica DESLIGADO (503).
// Nunca existe um endpoint de fila aberto — nem "só para testar". O segredo
// nunca é devolvido, logado ou citado em mensagens de erro.

import { timingSafeEqual } from 'node:crypto';

export const CRON_SECRET_ENV = 'CRON_SECRET';

/** Interface mínima de headers (compatível com Headers, NextRequest etc.). */
export interface HeadersLike {
  get(name: string): string | null | undefined;
}

/** Segredo de cron configurado no ambiente ('' quando não configurado). */
export function cronSecret(env: NodeJS.ProcessEnv = process.env): string {
  return String(env[CRON_SECRET_ENV] || '').trim();
}

/** Extrai o token de `Authorization: Bearer <token>` ('' quando ausente). */
export function extractCronBearer(headers: HeadersLike): string {
  const raw = headers?.get('authorization');
  const match = String(raw || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

/** Comparação em tempo constante (não revela o segredo por diferença de tempo). */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Autoriza (ou não) uma execução do consumidor de cron.
 *  - 503: CRON_SECRET ausente → consumidor desativado (fail-closed);
 *  - 401: credencial ausente ou divergente (mesma mensagem nos dois casos).
 */
export function verifyCronAuth(headers: HeadersLike, secret = cronSecret()): CronAuthResult {
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: `Consumidor automático desativado: configure ${CRON_SECRET_ENV} no ambiente.`,
    };
  }
  const provided = extractCronBearer(headers);
  if (!provided || !constantTimeEquals(provided, secret)) {
    return { ok: false, status: 401, error: 'Credencial de cron inválida.' };
  }
  return { ok: true };
}
