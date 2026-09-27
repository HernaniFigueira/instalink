/**
 * MISSÃO 4 — refinamento premium (contrato visual, sem pixel).
 *
 * Trava o que foi decretado:
 *  1. AÇÃO = carvão quente (botões carvão+branco, conteúdo escuro sofisticado)
 *     com a IDENTIDADE índigo preservada (--brand-600/700 do logo, --il-nav*
 *     da sidebar intocados);
 *  2. ABAS SEM sublinhado em todo o sistema (padrão pill/segmentado, ativo por
 *     superfície — a antiga "direction correction" com border-bottom foi
 *     removida);
 *  3. Topo do Cliente 360 (.il-idcard) em sólido quente creme — sem degradê,
 *     sem arco/efeitos;
 *  4. Card único de métricas do Dashboard com amarelo/creme SÓLIDO (sem
 *     degradê, sem banner);
 *  5. Pet sheet: ícone de PET (não de pessoa), subtítulo com o tutor, blocos
 *     com respiro, rodapé limpo e consentimento "Aceita receber promoções?";
 *  6. Anotações administrativas com visual de bloquinho (persistência intacta
 *     — sem autosave novo: cada observação continua sendo gravada por ação
 *     explícita).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const css = read('src/app/globals.css');
const ui = read('src/components/ui.tsx');
const drawer = read('src/components/dashboard/ClientProfileDrawer.tsx');
const pets = read('src/components/dashboard/PetsSection.tsx');
const pet360 = read('src/components/dashboard/Pet360Sheet.tsx');
const newClient = read('src/components/dashboard/NewClientSheet.tsx');
const clientes = read('src/app/(dashboard)/clientes/page.tsx');

function ruleOf(sel: string): string {
  const at = css.indexOf(sel);
  expect(at, `regra ${sel} existe em globals.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  return css.slice(at, css.indexOf('}', open));
}

describe('missão 4 · 1 — ação carvão com identidade preservada', () => {
  it('a AÇÃO do workspace é espresso/graphite deep (root + plataforma)', () => {
    // MISSÃO 5: tom mais forte que o carvão da missão 4 — botões com presença
    // e leitura firme, sem parecer mortos.
    expect(css).toMatch(/--brand:\s*#1c1917/); // missão 7: preto premium no estado normal
    expect(css).toMatch(/--brand-strong:\s*#0c0a09/);
    expect(css).toMatch(/--brand-fg:\s*#262220/);
    // escala INK de tipografia (near-black quente, AA checado em
    // design-360-tokens)
    expect(css).toMatch(/--text-primary:\s*#1c1815/);
    expect(css).toMatch(/--text-muted:\s*#524c46/);
    expect(css).toMatch(/--text-faint:\s*#6f6862/);
  });

  it('identidade índigo e sidebar lilás continuam intactas', () => {
    expect(css).toMatch(/--brand-600:\s*#4f46e5/);
    expect(css).toMatch(/--brand-700:\s*#4338ca/);
    expect(css).toMatch(/--il-nav:\s*#3f37c9/);
    expect(css).toMatch(/--cta-bg:\s*#5b3fd4/); // CTA violeta aprovado (missão 3)
  });

  it('botões seguem token-driven: primary carvão+branco, secondary contornado', () => {
    expect(ui).toMatch(/primary:\s*\n?\s*'bg-\[var\(--brand\)\]/);
    expect(ui).toMatch(/primary:[^}]*text-white/);
    expect(ui).toMatch(/secondary:\s*\n?\s*'bg-white text-\[var\(--text\)\] border/);
    expect(ui).toMatch(/danger:\s*\n?\s*'bg-\[var\(--danger\)\]/); // destrutivo = vermelho mantido
  });
});

describe('missão 4 · 2 — abas SEM sublinhado em todo o sistema', () => {
  it('nenhuma regra de aba desenha border-bottom de sublinhado', () => {
    expect(css).not.toMatch(/\.il-tab[^{]*\{[^}]*border-bottom:\s*3px/);
    expect(css).not.toContain('border-bottom-color');
  });

  it('o padrão pill (ativo por superfície) é o único', () => {
    const bar = ruleOf('.il-tabbar {');
    expect(bar).toContain('border-radius: var(--radius-pill)');
    const tab = ruleOf('.il-tab {');
    expect(tab).toContain('border-radius: var(--radius-pill)');
    const active = ruleOf(".il-tab[aria-selected='true'] {");
    expect(active).toContain('background: var(--surface)');
  });
});

describe('missão 5 · 3 — tutor NEUTRO, pet protagonista (hierarquia vet)', () => {
  it('.il-idcard (tutor) é neutro discreto, sem degradê e sem arco', () => {
    const card = ruleOf('.il-idcard {');
    expect(card).toContain('background: var(--brand-softer)');
    expect(card).not.toContain('gradient');
    expect(css).not.toContain('.il-idcard::after');
  });

  it('a ficha do tutor é discreta (borda neutra, sem efeitos)', () => {
    expect(drawer).toMatch(/il-idcard rounded-2xl border border-\[var\(--border\)\] shadow-sm/);
    expect(drawer).not.toMatch(/il-idcard[^"]*shadow-md/);
  });

  it('o bloco do PET usa o creme quente (o paciente da veterinária)', () => {
    expect(pets).toMatch(/rounded-xl border border-\[var\(--sun-border\)\] bg-\[var\(--sun-bg\)\]/);
    expect(pet360).toMatch(/rounded-xl border border-\[var\(--sun-border\)\] bg-\[var\(--sun-bg\)\]/);
    expect(newClient).toMatch(/data-testid="vet-pet-section" className="rounded-xl border border-\[var\(--sun-border\)\] bg-\[var\(--sun-bg\)\]/);
  });
});

describe('missão 4 · 4 — métricas do Dashboard em amarelo/creme SÓLIDO', () => {
  it('card único com fundo sun sólido (sem degradê)', () => {
    const card = ruleOf('.dsh-metrics {');
    expect(card).toContain('background: var(--sun-bg)');
    expect(card).not.toContain('gradient');
  });
});

describe('missão 4 · 5 — pet sheet premium (visual; lógica intacta)', () => {
  it('ícone de PET no modo veterinário (não de pessoa)', () => {
    expect(newClient).toContain("icon={vetMode ? 'paw' : 'users'}");
    expect(pets).toContain('icon="paw"');
    expect(pet360).toContain('icon="paw"'); // Pet 360 com o ícone pet oficial
  });

  it('subtítulo identifica o paciente (tutor); rodapé limpo Cancelar/Salvar pet', () => {
    expect(newClient).toContain('Tutor: ${');
    // missão 7: o sheet do pet fala a língua do paciente
    expect(pets).toContain('Paciente de ${tutorName}');
    expect(pets).toMatch(/footer=\{\(\s*\n\s*<div className="flex w-full items-center justify-end gap-2\.5">/);
    expect(pets).toContain('Salvar pet');
  });

  it('checkbox premium e consentimento "Aceita receber promoções?"', () => {
    expect(css).toContain('.il-check {');
    expect(newClient).toContain('Aceita receber promoções?');
    expect(newClient).toContain('className="il-check');
    expect(newClient).not.toContain('accent-zinc-900');
  });

  it('campos e strings de contrato do form preservados (lógica intacta)', () => {
    expect(newClient).toContain('Adicionar pet');
    expect(newClient).toContain('Salvar tutor e pet');
    expect(newClient).toContain("action: 'create'");
  });
});

describe('missão 4 · 6 — Pet 360 com dados claros + anotações em bloquinho', () => {
  it('Pet 360: nome forte e chips de espécie/raça/idade/peso', () => {
    expect(pet360).toMatch(/text-lg font-semibold text-\[var\(--text\)\] leading-tight/);
    expect(pet360).toContain('rounded-pill border border-[var(--sun-border)] bg-[var(--sun-bg-strong)]');
  });

  it('anotações administrativas com visual de bloquinho (sun sólido)', () => {
    expect(drawer).toContain('Salvar anotação');
    expect(drawer).toMatch(/rounded-xl border border-\[var\(--sun-border\)\] bg-\[var\(--sun-bg\)\]/);
    // persistência INTACTA: gravação continua sendo ação explícita (addNote)
    expect(drawer).toContain('async function addNote()');
  });
});

describe('missão 4 · 7 — tela Clientes coerente com o novo padrão', () => {
  it('ações do header refinadas sem perder função', () => {
    expect(clientes).toContain('> Importar');
    expect(clientes).toContain('Exportar');
    expect(clientes).toContain('Exportar tudo (JSON)');
    expect(clientes).toContain('> Novo cliente');
    expect(clientes).toContain("buttonCls('secondary', 'sm')");
    // filtros seguem nas abas pill do design system
    expect(clientes).toContain('<Tabs items={tabItems}');
  });
});

describe('missão 5 · 7 — padrão ÚNICO de títulos (chip + título + subtítulo)', () => {
  const dash = read('src/app/(dashboard)/dashboard/page.tsx');
  const agenda = read('src/app/(dashboard)/agenda/page.tsx');
  const conv = read('src/components/dashboard/ConversationsView.tsx');
  const tasks = read('src/components/dashboard/TasksView.tsx');
  const fin = read('src/app/(dashboard)/financeiro/page.tsx');

  it('o padrão vive no PageHeader (chip de ícone + título + subtítulo)', () => {
    expect(ui).toContain('il-page-header__icon');
    expect(ui).toMatch(/<h1 className="text-xl font-semibold/);
  });

  it('Visão geral usa o chip do padrão (nunca ícone solto)', () => {
    expect(dash).toContain('il-page-header__icon');
    expect(dash).toContain('<Icon n="home" size={19} />');
    expect(dash).toMatch(/<header className="mb-5 flex flex-wrap/); // topo limpo preservado
  });

  it('Agenda: ícone no chip do padrão', () => {
    expect(agenda).toMatch(/data-agenda-title-icon="calendar" className="il-page-header__icon/);
    expect(agenda).toContain('>Agenda</h1>');
  });

  it('Conversas: chip do padrão (não mais chip carvão solto)', () => {
    expect(conv).toContain('il-page-header__icon');
    expect(conv).not.toContain('bg-[var(--brand)] text-white flex items-center justify-center shadow-md');
    expect(conv).toContain('>Conversas</h1>');
  });

  it('Clientes/Financeiro/Pendências com ícone no PageHeader', () => {
    expect(read('src/app/(dashboard)/clientes/page.tsx')).toMatch(/<PageHeader\s*\n\s*icon="users"/);
    expect(fin).toMatch(/<PageHeader\s*\n\s*icon="wallet"/);
    expect(tasks).toContain('icon="tasks"');
  });

  it('Pendências: título unificado com a navegação', () => {
    expect(tasks).toContain('title="Pendências"');
    expect(tasks).not.toContain('title="Tarefas"');
  });
});

describe('missão 5 · 8 — pet sheet maduro + Pendências legível', () => {
  it('sheet com cabeçalho resolvido (título ink firme, ícone em chip)', () => {
    expect(css).toMatch(/\.ws-sheet__titles h2 \{[^}]*font-size: 16\.5px/);
    expect(css).toMatch(/\.ws-sheet__icon \{[^}]*width: 38px/);
    expect(css).toMatch(/\.ws-sheet__footer \{[^}]*display: flex/);
  });

  it('form do pet agrupado (Identificação · Características · Observações)', () => {
    expect(pets).toContain('>Identificação<');
    expect(pets).toContain('>Características<');
    expect(pets).toContain('>Observações<');
  });

  it('Pendências com estado da fila em chips e seções claras', () => {
    const tasksPanel = read('src/components/dashboard/TaskPanel.tsx');
    expect(tasksPanel).toContain('data-testid="task-summary-chips"');
    expect(tasksPanel).toContain('Em aberto · {open.length}');
    expect(tasksPanel).toContain('Encerradas · {done.length}');
    // sem cinzas soltos (tudo em tokens ink)
    expect(tasksPanel).not.toContain('text-zinc-400');
    expect(tasksPanel).not.toContain('text-zinc-500');
    expect(tasksPanel).not.toContain('text-zinc-900');
  });
});
