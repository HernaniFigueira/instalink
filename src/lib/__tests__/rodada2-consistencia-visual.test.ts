// ═══════════════════════════════════════════════════════════════
// RODADA 2 · CONSISTÊNCIA VISUAL — CONTRATOS DE CSS E DE SUPERFÍCIE
// ═══════════════════════════════════════════════════════════════
// Cada caso aqui trava um DEFEITO REAL de homologação (não um gosto):
//   • botões secundário/ícone com contorno pesado em repouso (P1.6/P1.9);
//   • toolbar da Agenda com um controle outlined no meio de ações de texto;
//   • "Ações rápidas" com card dentro do card (P1.8);
//   • duas geometrias laterais (gaveta flutuante × side modal preso) (P0.3);
//   • identidade da topbar fora do eixo dos ícones do rail (P1.10).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buttonCls } from '@/components/ui';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const css = read('src/app/globals.css');
const ds = read('src/styles/godoutor-design-system.css');
const ruleBody = (sel: string) => {
  const at = css.indexOf(sel);
  expect(at, `${sel} existe em globals.css`).toBeGreaterThan(-1);
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};

describe('P1 · botões e ícones sem contorno ocioso', () => {
  it('secundário: repouso sem borda visível, hover/active com preenchimento do sistema', () => {
    const cls = buttonCls('secondary');
    expect(cls).toContain('border-transparent');
    expect(cls).not.toContain('border-[var(--brand)]');
    expect(cls).toContain('hover:bg-[var(--brand-soft)]');
    expect(cls).toContain('active:bg-[var(--brand-soft)]');
    // Foco e acessibilidade preservados (anel canônico do DS no buttonCls).
    expect(cls).toContain('focus-visible:shadow-focus');
    // A caixa não muda entre variantes (borda transparente mantém a métrica).
    expect(cls).toContain('il-control');
  });

  it('o diálogo de confirmação segue a mesma régua (nada de borda só ali)', () => {
    expect(css).toContain('.overlay-confirm .il-control--secondary { border: 1px solid transparent; background: transparent; color: var(--brand-fg); }');
  });
});

describe('P1 · toolbar da Agenda — uma família de controles', () => {
  it('o gatilho de data entra na régua dos botões (repouso sem contorno, hover suave)', () => {
    const body = ruleBody('.ag-page .gd-toolbar .il-field-control {');
    expect(body).toContain('background: transparent');
    expect(body).toContain('border-color: transparent');
    const hover = ruleBody('.ag-page .gd-toolbar .il-field-control:hover');
    expect(hover).toContain('background: var(--surface-hover)');
    // Foco visível continua: o anel do DS (shadow) + borda de acento.
    expect(ruleBody('.ag-page .gd-toolbar .il-field-control:focus-visible')).toContain('border-color: var(--accent)');
  });

  it('o seletor Dia/Semana/Lista é um poço neutro com polegar suave (sem contorno duplo)', () => {
    const group = ruleBody('.il-segmented {');
    expect(group).toContain('background: var(--surface-3)');
    expect(group).toContain('border: 1px solid transparent');
    expect(group).not.toContain('border: 1px solid var(--border)');
    // Métrica única continua valendo (mesma altura do Button do nível).
    expect(group).toContain('min-height: var(--control-h)');
    const thumb = ruleBody('.il-segmented__thumb {');
    expect(thumb).toContain('border: 1px solid transparent');
    expect(ruleBody('.il-segmented__item:hover')).toContain('background: color-mix');
  });
});

describe('P1 · ações rápidas do Dashboard sem card-dentro-de-card', () => {
  it('a ação é um alvo centrado, não um cartão', () => {
    const quick = ruleBody('.dsh-quick {');
    expect(quick).toContain('flex-direction: column');
    expect(quick).toContain('align-items: center');
    expect(quick).toContain('text-align: center');
    expect(quick).toContain('border: 0');
    expect(quick).toContain('background: transparent');
    const icon = ruleBody('.dsh-quick__icon {');
    expect(icon).toContain('border: 0');
    expect(icon).toContain('border-radius: var(--radius-pill)');
    expect(icon).toContain('background: var(--brand-soft); color: var(--brand-fg)');
    // O alvo não encolhe: a ação continua com altura de toque.
    expect(quick).toMatch(/padding: 10px 6px/);
  });
});

describe('P0.3 · uma só geometria lateral (side modal preso à direita)', () => {
  it('o painel do detalhe é preso à borda, altura cheia, sem raio e sem sombra', () => {
    const panel = ds.slice(ds.indexOf('.gd-detail__panel {'), ds.indexOf('.gd-detail[open] .gd-detail__panel'));
    expect(panel).toContain('top: 0; right: 0; bottom: 0');
    expect(panel).toContain('border-radius: 0');
    expect(panel).toContain('box-shadow: none');
    expect(panel).toContain('border-left: 1px solid var(--gd-border)');
    // Entra de fora da borda (não é um card que aparece).
    expect(ds).toContain('@keyframes gd-detail-in { from { transform: translateX(100%); } to { transform: none; } }');
  });

  it('as PRÉVIAS/FICHAS laterais usam o MESMO side modal (nenhuma gaveta flutuante sobra nelas)', () => {
    for (const file of [
      'src/components/dashboard/BookingDetailSheet.tsx',
      'src/components/dashboard/ClientProfileDrawer.tsx',
      'src/components/dashboard/Pet360Sheet.tsx',
      'src/components/dashboard/ConversationsView.tsx',
      'src/app/(dashboard)/pagina/page.tsx',
    ]) {
      const src = read(file);
      expect(src, file).toContain('DetailSideModal');
      expect(src, file).not.toContain('<WorkspaceSheet');
    }
  });

  it('o side modal aceita assunto (ícone) e saída para a superfície completa no cabeçalho', () => {
    const ui = read('src/components/ui.tsx');
    expect(ui).toContain('gd-detail__icon');
    expect(ui).toContain('gd-detail__fullpage');
    expect(ds).toContain('.gd-detail__fullpage:hover { background: var(--gd-bg-hover); }');
  });
});

describe('P0.5/P1.10 · rail, largura e identidade no mesmo eixo', () => {
  it('a navegação aberta usa um token de largura e mantém o rail como padrão', () => {
    expect(ds).toMatch(/--gd-rail-w: 60px/);
    expect(ds).toMatch(/--gd-nav-w: 236px/);
    expect(css).toContain('.il-platform .workspace-sidebar.is-expanded { width: var(--gd-nav-w); }');
    // O padrão continua sendo o rail: o rótulo só aparece quando aberto.
    expect(css).toMatch(/\.workspace-sidebar \.workspace-label\s*\{\s*display:\s*none/);
    expect(css).toContain('.workspace-sidebar.is-expanded .workspace-label { display: inline; }');
  });

  it('o gagete do rodapé tem alvo de controle do DS (não um ícone solto)', () => {
    const body = ruleBody('.workspace-foot__item {');
    expect(body).toContain('min-height: var(--gd-control-h)');
  });

  it('a identidade da topbar nasce no eixo dos ícones do rail e a logo é LIVRE (sem tile)', () => {
    expect(ds).toMatch(/--gd-topbar-gutter-x: 18px/);
    expect(css).toMatch(/padding: 0 16px 0 var\(--gd-topbar-gutter-x\)/);
    const logo = ruleBody('.ws-clinic__logo {');
    expect(logo).toContain('border: 0');
    expect(logo).toContain('border-radius: 0');
    expect(logo).toContain('background: none');
    expect(logo).toContain('width: auto');
    expect(logo).toContain('object-fit: contain');
    // Proporção ajustada (a barra tem 60px; a logo não ocupa a barra inteira).
    const topbarH = Number(ds.match(/--gd-topbar-h:\s*(\d+)px/)?.[1]);
    const logoH = Number(ds.match(/--gd-topbar-logo:\s*(\d+)px/)?.[1]);
    expect(logoH).toBeGreaterThan(0);
    expect(logoH).toBeLessThan(topbarH);
    expect(Number(ds.match(/--gd-topbar-logo-max:\s*(\d+)px/)?.[1])).toBeGreaterThan(logoH);
  });

  it('o ícone do item ativo tem poço preenchido e o glifo é centrado', () => {
    const icon = ruleBody('.workspace-link__icon {');
    expect(icon).toContain('align-items: center');
    expect(icon).toContain('justify-content: center');
    const active = ruleBody('.workspace-link[aria-current="page"] .workspace-link__icon {');
    expect(active).toMatch(/background: color-mix\(in srgb, var\(--il-nav-active-fg\) 13%/);
  });
});

describe('P0.2 · hover da Agenda é RESUMO colado no evento (não painel)', () => {
  it('o cartão é compacto e as ações não são duas caixas esticadas', () => {
    const card = ruleBody('.ag-hover__card {');
    expect(card).toContain('width: 244px');
    expect(card).toContain('padding: 10px 12px');
    expect(card).toContain('gap: 5px');
    const actions = ruleBody('.ag-hover__actions {');
    expect(actions).toContain('border-top: 1px solid var(--gd-border-soft)');
    // O CTA "Ver detalhes" ocupa a linha; o resto fica do tamanho do rótulo.
    expect(css).toContain('.ag-hover__actions > :first-child { flex: 1; }');
    expect(css).toContain('.ag-hover__actions > :not(:first-child) { flex: 0 0 auto; }');
    expect(css).not.toContain('.ag-hover__actions > * { flex: 1; }');
  });

  it('o resumo NÃO abre superfície lateral: quem abre o detalhe é o clique/CTA', () => {
    const agenda = read('src/app/(dashboard)/agenda/page.tsx');
    // O conteúdo do hover é o cartão de resumo + o CTA que EXISTE para abrir o lado.
    const hover = agenda.slice(agenda.indexOf('className="ag-hover"'), agenda.indexOf('className="ag-hover"') + 1800);
    expect(hover).toContain('ag-hover__card');
    expect(hover).toContain('Ver detalhes');
    expect(hover).not.toContain('DetailSideModal');
    expect(hover).not.toContain('gd-detail');
    // O detalhe (modal preso à direita) continua existindo na página, por clique.
    expect(agenda).toContain('BookingDetailSheet');
  });
});

describe('P1.7 · menu lateral sem seta em item/grupo', () => {
  it('nenhum chevron na navegação: o único indicador do shell é o gatilho de unidade', () => {
    const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
    expect(nav).not.toContain('workspace-link__chevron');
    expect(nav).not.toMatch(/<Icon n="chev[DR]"/);
    // A marcação não desenha seta nenhuma; o CSS mantém a trava defensiva
    // (se alguém reintroduzir o elemento, ele continua invisível).
    expect(css).toContain('.workspace-link__chevron { display: none; }');
    // O gatilho de unidade na topbar é menu (aria-haspopup), não navegação: a
    // seta ali é afordância do menu, não "item com filho".
    const topbar = read('src/components/dashboard/WorkspaceTopbar.tsx');
    expect(topbar).toContain('ws-clinic__chev');
    const gatilho = topbar.slice(topbar.indexOf('ws-clinic--action') - 260, topbar.indexOf('ws-clinic--action') + 200);
    expect(gatilho).toContain('aria-haspopup="menu"');
  });
});

describe('AUDITORIA · rodada 2 — o detalhe não vira card flutuante no compacto', () => {
  it('abaixo de 479px o painel continua preso à borda, altura cheia e 100% da largura', () => {
    const at = ds.indexOf('@media (max-width: 479px) {');
    expect(at).toBeGreaterThan(-1);
    const bloco = ds.slice(at, ds.indexOf('}', ds.indexOf('.gd-detail__body', at)) + 1);
    expect(bloco).toContain('.gd-detail__panel');
    expect(bloco).toContain('top: 0; right: 0; bottom: 0; width: 100vw;');
    // O inset de 8px que transformava o detalhe em card solto não volta.
    expect(bloco).not.toContain('top: var(--gd-space-2)');
    expect(bloco).not.toContain('calc(100vw - 2 * var(--gd-space-2))');
  });

  it('o contêiner do detalhe mede o viewport DINÂMICO (100dvh)', () => {
    const regra = ds.slice(ds.indexOf('.gd-detail {'), ds.indexOf('.gd-detail:not([open])'));
    expect(regra).toContain('height: 100vh; height: 100dvh;');
  });
});

describe('AUDITORIA · rodada 2 — menu de contexto e confirmações', () => {
  it('o menu contextual é um primitive do DS (uma marcação, teclado e devolução de foco)', () => {
    const ui = read('src/components/ui.tsx');
    expect(ui).toContain('export function ContextMenu(');
    // O menu é UM só: a lista de itens é compartilhada com o DropdownMenu.
    expect(ui).toContain('function MenuItemList(');
    // Roving focus, Escape e devolução de foco no desmonte.
    expect(ui).toContain('setActive(enabled[0] ?? 0)');
    expect(ui).toContain('returnFocus.focus?.({ preventScroll: true })');
    expect(ui).toContain("e.key === 'Home'");
    expect(ui).toContain("e.key === 'End'");
  });

  it('a Agenda deriva os itens da MÁQUINA DE ESTADOS e não inventa transição', () => {
    const agenda = read('src/app/(dashboard)/agenda/page.tsx');
    expect(agenda).toContain('const alvos = BOOKING_FLOW[b.status] || []');
    expect(agenda).toContain("if (to === 'cancelled') continue;");
    expect(agenda).toContain('onContextMenu={(e) => {');
    expect(agenda).toContain("e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')");
    expect(agenda).toContain("void changeStatus(b.id, 'cancelled')");
    // Confirmação destrutiva pelo diálogo canônico (mesmo overlay do sistema).
    expect(agenda).toContain('<ConfirmDialog');
  });

  it('confirmação de EDIÇÃO é modal central (não gaveta lateral)', () => {
    const agenda = read('src/app/(dashboard)/agenda/page.tsx');
    expect(agenda).toContain('{resizeAsk && <Drawer open variant="dialog" dialogWidth="460px"');
    expect(agenda).toContain('<Drawer open variant="dialog" dialogWidth="520px"');
    // O formulário completo de bloqueio já era central e continua sendo.
    expect(agenda).toContain('{blockForm && <Drawer open variant="dialog" dialogWidth="560px"');
  });
});

describe('AUDITORIA · rodada 2 — rótulos de navegação e resumo do cliente', () => {
  it('a navegação lê em 14px/20px (painel do rail, coluna aberta e drawer)', () => {
    const at = css.indexOf('\n.workspace-link {');
    expect(at, 'a regra raiz de .workspace-link existe').toBeGreaterThan(-1);
    const link = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    expect(link).toContain('font-size: 14px');
    expect(link).toContain('line-height: 20px');
    const peek = ruleBody('.ws-peek__item {');
    expect(peek).toContain('font-size: 14px');
    expect(peek).toContain('line-height: 20px');
    const tAt = css.indexOf('\n.workspace-nav-drawer__title {');
    expect(tAt, 'a regra raiz do título de grupo existe').toBeGreaterThan(-1);
    const titulo = css.slice(css.indexOf('{', tAt) + 1, css.indexOf('}', tAt));
    expect(titulo).toContain('font-size: 14px');
    expect(titulo).toContain('line-height: 20px');
    expect(titulo).not.toContain('--gd-font-size-metadata');
  });

  it('a prévia do cliente separa resumo (esquerda) de conteúdo (direita)', () => {
    const drawer = read('src/components/dashboard/ClientProfileDrawer.tsx');
    expect(drawer).toContain('sm:grid-cols-[minmax(0,168px)_minmax(0,1fr)]');
  });
});
