// ═══════════════════════════════════════════════════════════════
// BUSCA DE NAVEGAÇÃO — lógica pura (fechamento A3.3, ponto 2)
// ═══════════════════════════════════════════════════════════════
// O botão de busca da sidebar precisa ser funcional, não decorativo. A regra
// mora AQUI (pura, testável) e o componente só apresenta:
//
//   • a fonte é o nav já calculado por permissão (`PanelNavigation.allowed`) —
//     portanto a busca não revela nem alcança destino proibido;
//   • busca por LABEL e por DESCRIPTION;
//   • sem acento e sem caixa: "configuração" acha "Configurações";
//   • o `?b=businessId` é preservado na rota de destino.
//
// Não é busca de clientes nem de dados: é busca de NAVEGAÇÃO.
import type { PanelNavigation, PanelRouteDef } from './panel';

export type NavSearchItem = {
  /** Rota canônica (sem query) — chave e comparação com a tela atual. */
  path: string;
  /** Href resolvido, com `?b=` quando a rota exige unidade. */
  href: string;
  label: string;
  description: string;
  icon: string;
  /** Rótulo da seção, para agrupar ("Operação", "Pessoas"…). */
  section: string;
};

/** Minúsculas e sem acento, para a busca não depender de digitação perfeita. */
export function fold(value: string): string {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Mesma regra do menu: só rota que exige unidade carrega o `?b=`. */
export function navSearchHref(item: Pick<PanelRouteDef, 'href' | 'requiresBusiness'>, unitQuery: string): string {
  return item.requiresBusiness === false ? item.href : `${item.href}${unitQuery}`;
}

/**
 * Monta a lista buscável a partir do nav JÁ filtrado por permissão.
 * `nav.allowed` é "todos os destinos acessíveis (menu ou não)" — é a mesma
 * fonte do menu, então não existe lista paralela capaz de vazar rota.
 */
export function buildNavSearchItems(nav: PanelNavigation, unitQuery: string): NavSearchItem[] {
  const sectionLabel = new Map<string, string>();
  for (const sec of nav.sections) {
    for (const item of sec.items) sectionLabel.set(item.href, sec.label);
  }
  return nav.allowed.map((item) => ({
    path: item.href,
    href: navSearchHref(item, unitQuery),
    label: item.label,
    description: item.description,
    icon: item.icon,
    section: sectionLabel.get(item.href) || 'Painel',
  }));
}

/** Palavras comparáveis de um texto (sem pontuação, já dobrado). */
function words(value: string): string[] {
  return fold(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/**
 * Uma palavra casa com a busca quando:
 *   • uma contém a outra ("cliente" ⊂ "clientes"), OU
 *   • compartilham um radical longo o bastante.
 *
 * O segundo caso existe por causa do português: "configuração" NÃO é substring
 * de "Configurações" (o radical muda de -ção para -ções), e "automação" idem.
 * Sem isso, o exemplo mais óbvio de busca do briefing não funcionava.
 * Limiar: 5 letras e pelo menos 75% da palavra mais curta em comum.
 */
function wordMatches(word: string, q: string): boolean {
  if (!word || !q) return false;
  // Busca curtíssima ("ag"): só prefixo — senão 2 letras casam com tudo.
  if (q.length <= 2) return word.startsWith(q);
  // Artigos e conjunções do texto ("e", "a", "o", "se") não são chave de busca:
  // com `includes` eles casavam com qualquer palavra e a busca devolvia o menu
  // inteiro. Palavra de texto precisa ter 3+ letras para ser comparável.
  if (word.length < 3) return false;
  if (word.includes(q) || q.includes(word)) return true;
  const shared = commonPrefix(word, q);
  return shared >= 5 && shared / Math.min(word.length, q.length) >= 0.75;
}

/** Todas as palavras da busca precisam casar (busca "E": agenda + profissional). */
function matches(text: string, queryWords: string[]): boolean {
  const target = words(text);
  return queryWords.every((qw) => target.some((tw) => wordMatches(tw, qw)));
}

/**
 * Nota de relevância — quanto menor, melhor:
 *   0 rótulo exato · 1 rótulo começa com a busca · 2 rótulo contém · 3 descrição.
 * É o que faz "cliente" abrir em Clientes e não em Conversas (que só cita
 * clientes na descrição).
 */
function rank(item: NavSearchItem, queryWords: string[]): number {
  const label = fold(item.label);
  const q = queryWords.join(' ');
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  if (matches(item.label, queryWords)) return 2;
  return 3;
}

/**
 * Filtra por label/descrição, ordena por relevância e põe a tela atual primeiro
 * — é o destino que a pessoa procura quando quer voltar para onde já está.
 * Query vazia devolve tudo (o popover funciona como índice do menu).
 */
export function searchNav(items: NavSearchItem[], query: string, activePath = ''): NavSearchItem[] {
  const queryWords = words(query || '');
  const list = queryWords.length > 0
    ? items.filter((i) => matches(i.label, queryWords) || matches(i.description, queryWords))
    : items;
  return [...list].sort((a, b) => {
    const activeDiff = Number(b.path === activePath) - Number(a.path === activePath);
    if (activeDiff !== 0) return activeDiff;
    const rankDiff = rank(a, queryWords) - rank(b, queryWords);
    if (rankDiff !== 0) return rankDiff;
    return a.label.localeCompare(b.label, 'pt-BR');
  });
}
