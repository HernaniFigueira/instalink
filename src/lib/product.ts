// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — LIMITES DE PRODUTO (Página legada)
// ═══════════════════════════════════════════════════════════════
// O GoDoutor NÃO é mais link-na-bio/site builder: o produto principal é o
// sistema operacional da clínica. A Página/site builder sai da navegação
// operacional padrão e do onboarding principal, ATRÁS DE FLAG:
//
//   GODOUTOR_LEGACY_PAGES=1  → reativa a Página (legado preservado)
//   ausente/desligado        → fora da navegação operacional (padrão)
//
// DESATIVAÇÃO SEGURA (contrato):
//   • NENHUM código/dado é apagado — rotas, APIs, widgets e deep links
//     públicos continuam funcionando (agendamento público intacto);
//   • integrações externas seguem por widget/API/webhook/deep link;
//   • quem tem o deep link /pagina continua chegando (não é 404);
//   • reativar a flag restaura a navegação sem migração.
//
// Este módulo é PURO (client + server) — fonte única de verdade do corte.
export interface ProductLimitsEnv {
  GODOUTOR_LEGACY_PAGES?: string | undefined;
}

/** A Página legada aparece na navegação operacional? */
export function isLegacyPagesEnabled(env: ProductLimitsEnv | Record<string, string | undefined> = { GODOUTOR_LEGACY_PAGES: process.env.GODOUTOR_LEGACY_PAGES }): boolean {
  const v = String(env.GODOUTOR_LEGACY_PAGES || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

/** Public-page account action exists only while the legacy surface is enabled. */
export function canShowPublicPageLink(legacyPagesEnabled: boolean, slug?: string | null): boolean {
  return legacyPagesEnabled && Boolean(slug?.trim());
}

/** Áreas da navegação filtradas pelo limite de produto. */
export function filterNavAreas<T extends { id: string }>(areas: T[], env: ProductLimitsEnv | Record<string, string | undefined> = process.env): T[] {
  if (isLegacyPagesEnabled(env)) return areas;
  return areas.filter((a) => a.id !== 'presenca');
}
