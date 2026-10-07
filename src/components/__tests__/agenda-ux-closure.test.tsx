// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// AGENDA + DESIGN SYSTEM — CONTRATOS DA MISSÃO UX CLOSURE
// ═══════════════════════════════════════════════════════════════
// O que este arquivo protege (itens 3, 4, 5, 6 da missão):
//   3A · o resumo do evento é CONTEXTUAL (HoverCard) com "Ver detalhes" e
//        "Reagendar" quando a REGRA autoriza, e NÃO existe tooltip nativo na
//        grade;
//   3B · "Ver detalhes" abre o MODAL LATERAL canônico (DetailSideModal ~460px),
//        não um sheet de 620px nem um 95% da viewport;
//   3C · criar/editar agendamento é MODAL CENTRAL (mesmo overlay system);
//   4  · bloqueio operacional NÃO domina: hachura na grade + indicador
//        compacto, com o clique preservado;
//   5  · a toolbar da Agenda tem UMA métrica (nível MD do DS) e uma régua só;
//   6  · a hierarquia de overlays é a fonte única (Escape fecha só o topo).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { isTopOverlay, overlayDepth, popOverlay, pushOverlay } from '@/lib/overlay-stack';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const agenda = read('src/app/(dashboard)/agenda/page.tsx');
const css = read('src/app/globals.css');
const dsCss = read('src/styles/godoutor-design-system.css');

afterEach(cleanup);

describe('3A · resumo contextual do evento (HoverCard)', () => {
  it('o cartão do evento NÃO usa tooltip nativo e o resumo é o HoverCard', () => {
    // O `title` do botão do evento era o que aparecia em vez do resumo.
    const card = agenda.slice(agenda.indexOf('const card = ('), agenda.indexOf('const card = (') + 1200);
    expect(card).not.toMatch(/\btitle=\{b\.label\}/);
    expect(agenda).toContain('<HoverCard');
    expect(agenda).toMatch(/side="right-start"/);
    // Ancoragem física: offset do sistema (8–12px) — nunca no canto da página.
    expect(agenda).toMatch(/className="ag-hover"/);
    expect(dsCss).toMatch(/--gd-space-2: 8px/);
  });

  it('o resumo traz horário, paciente, serviço, profissional e status', () => {
    const content = agenda.slice(agenda.indexOf('<div className="ag-hover__card">'), agenda.indexOf('</div>\n            }\n          >'));
    expect(content).toContain('{b.timeRange}');
    expect(content).toContain('{b.name}');
    expect(content).toContain('{b.service}');
    expect(content).toContain('{b.pro}');
    expect(content).toContain('{b.statusLabel}');
  });

  it('tem ação explícita "Ver detalhes" e secundária "Reagendar" só quando autorizado', () => {
    expect(agenda).toContain('>Ver detalhes<');
    // `b.editable` vem de rescheduleDecision(status).kind === 'move' — a REGRA
    // decide, o resumo só oferece o atalho.
    expect(agenda).toMatch(/b\.editable && \(/);
    expect(agenda).toContain('>Reagendar<');
    expect(agenda).toContain('editable: rescheduleDecision(b.status).kind === \'move\'');
    // A ação secundária reusa o fluxo existente (nunca um caminho paralelo).
    expect(agenda).toContain('const onBlockReschedule = useCallback');
    expect(agenda).toMatch(/rescheduleDecision\(booking\.status\)\.kind !== 'move'/);
  });

  it('nenhum elemento da GRADE carrega `title` nativo (bloqueio, marcas, handle)', () => {
    const grid = agenda.slice(agenda.indexOf('const GridColumn = memo('), agenda.indexOf('export default function AgendaPage'));
    expect(grid).not.toMatch(/title=\{b\.statusLabel\}/);
    expect(grid).not.toMatch(/title="Precisa de fechamento"/);
    expect(grid).not.toMatch(/title="Cliente já fez check-in"/);
    expect(grid).not.toMatch(/title="Arraste para alterar duração"/);
    // O feedback de duração virou etiqueta no próprio cartão (só no arraste).
    expect(grid).toContain('data-resize-hint');
    expect(css).toContain('.ag-event__resize-hint');
  });
});

describe('3A · posicionamento do resumo (flip e clamp) — regressão medida', () => {
  it('mede o elemento POSICIONADO, não um filho interno com padding', () => {
    const ui = read('src/components/ui.tsx');
    // O wrapper do portal é quem recebe `left/top`; medir o conteúdo interno
    // (com padding do card) dava 252px em vez de 278px e o flip/clampe era
    // calculado com retângulo errado — o resumo encostava 16px SOBRE o evento.
    // `MutableRefObject` (e não `RefObject`): o portal ESCREVE em
    // `current`; com o tipo imutável o `next build` falhava.
    expect(ui).toMatch(/positionRef\?: React\.MutableRefObject<HTMLDivElement \| null>/);
    expect(ui).toContain('if (positionRef) positionRef.current = el;');
    expect(ui).toMatch(/useAnchoredLayer\(open, anchorRef, side, offset, posRef\)/);
  });

  it('flip horizontal: preferência declarada, depois o outro lado, depois abaixo', () => {
    const ui = read('src/components/ui.tsx');
    const block = ui.slice(ui.indexOf("if (side === 'right-start' || side === 'left-start')"));
    const face = block.slice(0, block.indexOf('bottom-start'));
    // Cabe no lado preferido → vai para ele.
    expect(face).toMatch(/if \(preferLeft \? fitsLeft : fitsRight\) left = preferLeft \? toLeft : toRight;/);
    // Não cabe → FLIPA para o outro lado (mesma distância).
    expect(face).toMatch(/else if \(preferLeft \? fitsRight : fitsLeft\) left = preferLeft \? toRight : toLeft;/);
    // Não cabe em nenhum → empilha fora do evento (nunca em cima dele).
    expect(face).toContain('else {');
    expect(face).toContain('top = (h && below + h > window.innerHeight - margin && above > margin) ? above : below;');
  });

  it('re-mede quando a camada muda de tamanho (conteúdo assentando)', () => {
    const ui = read('src/components/ui.tsx');
    expect(ui).toContain('new ResizeObserver(place)');
    expect(ui).toContain('ro.observe(layer);');
    // Gancho de homologação: a medição fica legível no DOM (`data-place`).
    expect(ui).toContain('posNode.dataset.place');
  });
});

describe('3B · "Ver detalhes" é o MODAL LATERAL canônico', () => {
  it('BookingDetailSheet usa DetailSideModal (nunca o sheet de 620px)', () => {
    const detail = read('src/components/dashboard/BookingDetailSheet.tsx');
    // DS 1.1: o primitive de detalhe chama-se `DetailSideModal` (preso à
    // direita, altura cheia). `DetailPanel` segue existindo só como alias.
    expect(detail).toContain('<DetailSideModal');
    expect(detail).not.toContain('WorkspaceSheet');
    expect(detail).not.toContain('max-w-[620px]');
    // Largura na janela pedida pela missão (420–480px), por token do DS.
    expect(dsCss).toMatch(/--gd-detail-w: 460px/);
    // A largura é SEMPRE do token — com fallback do MESMO valor, para o painel
    // nunca cair para largura de conteúdo quando o `var()` não resolve
    // (defeito medido na auditoria: 448–456px variando com o texto).
    // DS 1.1: o painel é PRESO à direita e ocupa a altura cheia; a largura
    // continua sendo o token (o `100vw` só age em tela menor que o token).
    expect(dsCss).toMatch(/width: min\(var\(--gd-detail-w, 460px\), 100vw\)/);
    const painel = dsCss.slice(dsCss.indexOf('.gd-detail__panel {'));
    const corpo = painel.slice(0, painel.indexOf('}'));
    expect(corpo).toContain('top: 0; right: 0; bottom: 0;');
    expect(corpo).toContain('border-radius: 0');
    expect(corpo).toContain('box-shadow: none');
    // Nada de margem de viewport: o DS 1.0 usava `--gd-detail-gap` nos 4 lados.
    expect(corpo).not.toContain('--gd-detail-gap');
    // O painel não recebe mais um `var()` autorreferente por prop default: sem
    // largura explícita, nenhum style inline — quem manda é o token.
    const ui = read('src/components/ui.tsx');
    expect(ui).not.toContain("width = 'var(--gd-detail-w)'");
    expect(ui).toMatch(/style=\{width \? \(\{ '--gd-detail-w': width \}/);
  });

  it('o detalhe abre com o fluxo de reagendamento quando veio do resumo', () => {
    expect(read('src/components/dashboard/BookingDetailSheet.tsx')).toContain('startRescheduling');
    expect(agenda).toContain('startRescheduling={detailReschedule}');
  });
});

describe('3C · criar/editar agendamento é MODAL CENTRAL', () => {
  it('o formulário de criação usa o mesmo overlay system com geometria central', () => {
    const sheet = read('src/components/dashboard/NewBookingSheet.tsx');
    expect(sheet).toMatch(/variant="dialog"/);
    expect(sheet).toMatch(/dialogWidth=\{quick && !advanced \? '560px' : '672px'\}/);
    // Faixa central = token do DS (uma fonte), com fallback no componente.
    expect(dsCss).toContain('--gd-booking-modal-w: 672px');
    expect(css).toMatch(/dialog\.il-drawer--dialog \{[\s\S]*?transform: translate\(-50%, -50%\)/);
    expect(css).toMatch(/dialog\.il-drawer--dialog \{[\s\S]*?width: min\(var\(--il-dialog-w, 672px\)/);
  });

  it('o formulário de bloqueio (curto) segue a mesma geometria; o par 50/50 é preservado', () => {
    expect(agenda).toMatch(/<Drawer open variant="dialog" dialogWidth="560px"/);
    // Cadastro aninhado continua no MESMO overlay (nunca sheet dentro de sheet).
    expect(css).toContain(".il-drawer__strip[data-expanded='true'] .il-drawer__panels {");
    expect(css).toMatch(/dialog\.il-drawer--dialog\[data-expanded='true'\] \{[\s\S]*?width: min\(1280px/);
  });

  it('mobile: o modal central usa a largura útil (não vira coluna perdida)', () => {
    expect(css).toMatch(/@media \(max-width: 767px\) \{\n  \/\* Celular: o modal central usa a largura\/altura úteis/);
    expect(css).toMatch(/dialog\.il-drawer--dialog \{[\s\S]*?width: calc\(100vw - 2 \* var\(--gd-space-3\)\)/);
  });
});

describe('4 · bloqueio operacional não domina a grade', () => {
  it('a grade desenha hachura + etiqueta compacta no lugar da caixa laranja', () => {
    const grid = agenda.slice(agenda.indexOf('const GridColumn = memo('), agenda.indexOf('export default function AgendaPage'));
    expect(grid).toContain('ag-block__hatch');
    expect(grid).toContain('ag-block__tag');
    expect(grid).toContain('ag-block__label');
    expect(grid).not.toContain('bg-[var(--warning-bg)] text-[var(--warning-fg)] rounded-md px-2 py-1 text-left text-xs font-bold');
    expect(css).toMatch(/\.ag-block__hatch \{[\s\S]*?repeating-linear-gradient/);
    // Semântica preservada: superfície própria + tracejado + família de atenção.
    expect(css).toMatch(/\.ag-block \{[\s\S]*?border: 1px dashed var\(--warning-border\)/);
    // O clique continua abrindo o MESMO formulário do bloqueio.
    expect(grid).toContain('onClick={() => onOperationalBlock(block)}');
    expect(grid).toMatch(/aria-label=\{`Bloqueio operacional: \$\{timeLabel\}/);
  });

  it('a lista de bloqueios virou INDICADOR compacto (sem faixa âmbar com título)', () => {
    expect(agenda).toContain('className="ag-blocks-bar"');
    expect(agenda).not.toContain('border border-dashed border-amber-500 rounded-md bg-amber-50 p-2');
    expect(agenda).toContain('blockCountLabel');
    expect(css).toMatch(/\.ag-blocks-bar \{/);
    expect(css).toMatch(/\.ag-blocks-bar__chip \{/);
  });

  it('a coluna de HOJE não depende só de cor (etiqueta textual)', () => {
    expect(agenda).toContain('ag-col-today');
    expect(css).toMatch(/\.ag-col-today \{/);
  });
});

describe('5 · toolbar da Agenda com UMA métrica', () => {
  it('todos os controles da linha de ações usam o nível MD (sem size="sm")', () => {
    const line2 = agenda.slice(agenda.indexOf('LINHA 2 — DATA / MODO / AÇÃO PRINCIPAL'), agenda.indexOf('{isDragging && view !== \'month\''));
    expect(line2).not.toMatch(/size="sm"/);
    expect(line2).toContain('<Button variant="secondary"');   // Hoje
    expect(line2).toContain('<IconButton icon="chevL"');       // setas (quadradas MD)
    expect(line2).toContain('<DatePicker');
    expect(line2).toContain('<Segmented');
    expect(line2).toContain('Novo agendamento');
  });

  it('as linhas de toolbar usam o contêiner canônico do DS', () => {
    expect(agenda).toContain('className="gd-toolbar gap-x-4 px-3 py-2.5"');
    expect(agenda).toContain('className="gd-toolbar justify-end"');
    expect(dsCss).toMatch(/\.gd-toolbar \{ display: flex; flex-wrap: wrap; align-items: center; gap: var\(--gd-toolbar-gap\); \}/);
    // Nenhum override de altura por página na Agenda.
    expect(agenda).not.toMatch(/h-\[37px\]|px-\[13px\]/);
  });
});

describe('6 · botão destrutivo NÃO fica vermelho cheio em repouso', () => {
  it('a fila de ações do detalhe usa a variante soft; o solid fica na confirmação', () => {
    const detail = read('src/components/dashboard/BookingDetailSheet.tsx');
    // Ação imediata na fila de status = repouso → soft.
    expect(detail).toMatch(/variant="destructive-soft" onClick=\{\(\) => act\('cancelled'\)\}/);
    // Passo de confirmação (série) → solid, que é o único lugar legítimo.
    expect(detail).toContain('variant="destructive" disabled={!!acting} onClick={() => act(\'cancelled\', { action: \'cancel-series-future\' })}');
  });

  it('a variante soft é canônica no DS (não é cor solta de página)', () => {
    const ui = read('src/components/ui.tsx');
    expect(ui).toContain("'destructive-soft':");
    expect(ui).toContain("'bg-[var(--danger-bg)] text-[var(--danger-fg)] border border-[var(--danger-border)]");
    // O DS declara a regra no catálogo (repouso soft · confirmação solid).
    const catalog = read('src/app/dev/design-system/catalog.tsx');
    expect(catalog).toContain('destructive-soft');
    // Gatilhos que abrem confirmação e ações não destrutivas não usam vermelho cheio.
    expect(read('src/app/(dashboard)/servicos/page.tsx')).not.toContain('variant="destructive"');
    expect(read('src/app/(dashboard)/recursos/page.tsx')).not.toContain('variant="destructive"');
  });
});

describe('6 · hierarquia de overlays (fonte única)', () => {
  it('a pilha responde em ordem: só o TOPO fecha', () => {
    const bottom = { id: 'novo-agendamento' };
    const top = { id: 'cadastro-paciente' };
    pushOverlay(bottom);
    expect(isTopOverlay(bottom)).toBe(true);
    pushOverlay(top);
    expect(isTopOverlay(top)).toBe(true);
    expect(isTopOverlay(bottom)).toBe(false);   // Escape não derruba os dois
    popOverlay(top);
    expect(isTopOverlay(bottom)).toBe(true);
    popOverlay(bottom);
    expect(overlayDepth()).toBe(0);
    popOverlay(bottom);                          // idempotente
  });

  it('Dialog, DetailSideModal e WorkspaceSheet compartilham a MESMA pilha', () => {
    const ui = read('src/components/ui.tsx');
    const sheet = read('src/components/dashboard/WorkspaceSheet.tsx');
    for (const src of [ui, sheet]) {
      expect(src).toContain('@/lib/overlay-stack');
      expect(src).toContain('pushOverlay');
      expect(src).toContain('popOverlay');
    }
    expect(ui).toContain('isTopOverlay(entry)');
    expect(sheet).toContain('isTopOverlay(e.currentTarget)');
    // Nenhuma contagem de camadas paralela sobrou no componente.
    expect(ui).not.toContain('DIALOG_STACK');
  });

  it('o modal central do DS é o mesmo para bloqueio e agendamento', () => {
    const ui = read('src/components/ui.tsx');
    expect(ui).toMatch(/variant = 'side', dialogWidth = '672px'/);
    expect(ui).toContain("variant === 'dialog' && 'il-drawer--dialog'");
  });
});

describe('6 · métricas canônicas (a régua é do controle, não da página)', () => {
  it('o campo canônico tem a régua MD FORA do escopo .il-platform', () => {
    const css = read('src/app/globals.css');
    const base = css.indexOf('.il-field-control { min-height: var(--control-h); }');
    const platform = css.indexOf('.il-platform .il-field-control { min-height: var(--control-h); }');
    // A regra sem escopo precisa existir ANTES da de plataforma: sem ela, as
    // páginas fora do platform herdavam o `py-2` do FIELD_CLS e mediam 38px.
    expect(base).toBeGreaterThan(-1);
    expect(platform).toBeGreaterThan(base);
  });

  it('no toque, TODA a família sobe para 44 — inclusive campo e seletor de modo', () => {
    const css = read('src/app/globals.css');
    const touch = css.slice(css.indexOf('@media (pointer: coarse), (max-width: 767px)'));
    const bloco = touch.slice(0, touch.indexOf('prefers-reduced-motion'));
    expect(bloco).toContain('.il-platform .il-field-control { min-height: var(--control-h-touch); }');
    expect(bloco).toContain('.il-segmented { min-height: var(--control-h-touch); }');
    expect(bloco).toContain('.il-segmented__item { height: calc(var(--control-h-touch) - 8px); }');
  });

  it('nenhum nível de ação fora da escala: lg tem régua explícita (44)', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('.il-platform .il-control--lg { min-height: var(--control-h-touch); }');
    // O chip de opção default media 36 (nível inexistente) → nível denso do DS.
    expect(css).toContain('display:inline-flex; min-height:var(--control-h-sm); align-items:center; justify-content:center; gap:6px;');
  });

  it('o rail NÃO tem chevron: o grupo não é accordion (DS 1.1)', () => {
    const css = read('src/app/globals.css');
    const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
    // Defeito histórico: a seta de 15px vazava 14px do rail e era cortada; virou
    // sinalizador de 9px e, no DS 1.1, foi REMOVIDA — a seta prometia accordion.
    expect(css).toContain('.workspace-link__chevron { display: none; }');
    expect(nav).not.toContain('workspace-link__chevron');
    // O grupo continua declarando o estado para tecnologia assistiva.
    expect(nav).toContain('aria-expanded={open}');
    expect(nav).toContain('aria-haspopup="true"');
  });

  it('as páginas auditadas não recriam a métrica do controle por conta própria', () => {
    const paginas = [
      'src/app/(dashboard)/agenda/page.tsx',
      'src/app/(dashboard)/clientes/page.tsx',
      'src/app/(dashboard)/configuracoes/page.tsx',
      'src/app/(dashboard)/pagina/page.tsx',
      'src/app/(dashboard)/campanhas/page.tsx',
      'src/app/(dashboard)/agente/page.tsx',
    ];
    for (const pagina of paginas) {
      const src = read(pagina);
      expect(src).not.toMatch(/className="[^"]*rounded-md border[^"]*px-[0-9.]+ py-[0-9.]+ text-sm/);
      expect(src).not.toMatch(/const (input|num) = 'w-full rounded-md border/);
    }
  });
});
