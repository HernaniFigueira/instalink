// ═══════════════════════════════════════════════════════════════
// SUPERFÍCIES OPERACIONAIS LEGADAS — o corte do produto ativo
// ═══════════════════════════════════════════════════════════════
// CORREÇÃO FINAL da convergência: com GODOUTOR_LEGACY_PAGES desligada, as
// telas OPERACIONAIS do fluxo comercial (vitrine de Produtos, Pedidos) não
// abrem tela operacional. Nada é apagado: os dados continuam no banco, as
// APIs seguem resolúveis e o ramo ON (flag ligada) preserva a compatibilidade
// completa. Este módulo é PURO para ser testado sem React.
import { isLegacyPagesEnabled } from './product';

export interface BlockedLegacySurface {
  title: string;
  hint: string;
  /** destino seguro (redirect/CTA) — pálido ao produto clínico. */
  href: string;
  hrefLabel: string;
}

const SURFACES: Record<string, Omit<BlockedLegacySurface, 'title'> & { title: string }> = {
  '/produtos': {
    title: 'Recurso legado indisponível',
    hint: 'A vitrine de Produtos pertence ao antigo fluxo de páginas (GODOUTOR_LEGACY_PAGES). Nada foi apagado: os dados permanecem guardados e a experiência volta quando o modo legado é reativado. No dia a dia da clínica, use Serviços e a Agenda.',
    href: '/servicos',
    hrefLabel: 'Ir para Serviços',
  },
  '/pedidos': {
    title: 'Recurso legado indisponível',
    hint: 'O fluxo de Pedidos é do antigo produto universal (GODOUTOR_LEGACY_PAGES) e não faz parte do Clinical OS. Os pedidos registrados permanecem no banco; nenhum dado foi perdido. A operação da clínica acontece na Agenda.',
    href: '/agenda',
    hrefLabel: 'Ir para a Agenda',
  },
  '/pagina': {
    title: 'Recurso legado indisponível',
    hint: 'A Página pública (site builder) saiu da navegação operacional do Clinical OS. Seu link público continua no ar, e /pagina volta a abrir para edição com GODOUTOR_LEGACY_PAGES=1.',
    href: '/dashboard',
    hrefLabel: 'Voltar ao painel',
  },
};

/** Rotas operacionais legadas — ocultas da navegação/busca com a flag OFF. */
export const LEGACY_OPERATIONAL_ROUTES = ['/produtos', '/pedidos'] as const;

/** A rota está bloqueada (estado legado) nesta configuração de produto? */
export function blockedLegacySurface(
  pathname: string,
  legacyPagesEnabled: boolean = isLegacyPagesEnabled(),
): BlockedLegacySurface | null {
  if (legacyPagesEnabled) return null;
  const def = SURFACES[pathname];
  return def ? { ...def } : null;
}

/** Rótulos que saem da navegação/busca operacional com a flag OFF. */
export function isHiddenLegacyNavRoute(href: string, legacyPagesEnabled: boolean): boolean {
  if (legacyPagesEnabled) return false;
  return href === '/pagina' || (LEGACY_OPERATIONAL_ROUTES as readonly string[]).includes(href);
}
