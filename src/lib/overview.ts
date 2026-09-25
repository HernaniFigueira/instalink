// ═══════════════════════════════════════════════════════════════
// OVERVIEW — UM payload, UMA requisição (GoDoutor 2.0 · §i)
// ═══════════════════════════════════════════════════════════════
// `GET /api/overview` é o endpoint mais pesado do painel: ele agrega agenda,
// financeiro, funil e checklist da unidade. Ele alimenta QUATRO consumidores
// que montam juntos no primeiro render:
//
//   • a tela Visão geral (KPIs do dia + período);
//   • o mini-card de configuração da sidebar;
//   • o sino de notificações;
//   • a central de ajuda (sob demanda).
//
// Medido no harness de rede contra o build de produção: cada navegação fazia
// DUAS chamadas idênticas a `/api/overview?businessId=…&period=7` em paralelo
// (navegação/relógio + tela), ou seja, o mesmo trabalho de banco era feito duas
// vezes por clique de menu.
//
// Aqui a regra é a única que não pode envelhecer dado: COALESCÊNCIA EM VOO.
// Duas chamadas simultâneas com a mesma chave dividem UMA requisição e recebem
// a MESMA resposta. Nada é guardado depois que a resposta chega — logo nenhum
// painel mostra número velho por causa deste módulo.
//
// Sobre o rótulo de área: o `ctx` (mensagem de 403) vem de quem chamou PRIMEIRO.
// Os consumidores pedem a mesma área lógica ("Visão geral"), então na prática
// não há diferença visível; e o 403 continua preservando a sessão.
import { apiGet, type ApiResult } from './api-client';
import type { DeniedContext } from './http';

/** Recorte mínimo que TODOS os consumidores do payload usam. */
export interface OverviewPayload {
  today?: unknown;
  yesterday?: unknown;
  attention?: Array<{ id: string; count: number; label: string; href: string | null }>;
  whatsapp?: unknown;
  pendingSetup?: number;
  checklist?: Array<{ done: boolean; label: string; href: string }>;
  pct?: number;
  [key: string]: unknown;
}

const inflight = new Map<string, Promise<ApiResult<OverviewPayload>>>();

export function overviewUrl(businessId: string, period = 7): string {
  return `/api/overview?businessId=${encodeURIComponent(businessId)}&period=${period}`;
}

/** Requisição compartilhada do overview (sem cache: só divisão de chamadas iguais). */
export function loadOverview(
  businessId: string,
  period = 7,
  ctx: DeniedContext = { scope: 'area', area: 'Visão geral' },
): Promise<ApiResult<OverviewPayload>> {
  if (!businessId) return Promise.resolve({ ok: false, status: 0, data: null, message: '', denied: null, flow: 'stay', networkError: true });
  const key = `${businessId}|${period}`;
  const running = inflight.get(key);
  if (running) return running;
  const request = apiGet<OverviewPayload>(overviewUrl(businessId, period), ctx)
    .finally(() => { inflight.delete(key); });
  inflight.set(key, request);
  return request;
}

/** Só para teste/observabilidade: quantas chaves estão em voo agora. */
export function overviewInflightCount(): number {
  return inflight.size;
}
