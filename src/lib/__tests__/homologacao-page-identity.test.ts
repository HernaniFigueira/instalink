import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · Commit 3 — editor da página, identidade e shell
// ═══════════════════════════════════════════════════════════════

describe('P1 · Página — Modelo/Seções/Aparência/Prévia', () => {
  const page = read('src/app/(dashboard)/pagina/page.tsx');

  it('Modelo = presets; estrutura de blocos vive em Seções da página', () => {
    expect(page).toContain("'secoes'");
    expect(page).toContain('Seções da página');
    // seção modelo referencia secoes e não embute a lista de blocos
    const modeloIdx = page.indexOf("active === 'modelo'");
    const secoesIdx = page.indexOf("active === 'secoes'");
    expect(modeloIdx).toBeGreaterThan(-1);
    expect(secoesIdx).toBeGreaterThan(modeloIdx);
    expect(page).toContain('Abrir Seções da página');
    // lista de blocos com Editar está em secoes
    const secoesSlice = page.slice(secoesIdx, modeloIdx > secoesIdx ? modeloIdx : secoesIdx + 12000);
    expect(secoesSlice).toContain('data-block-id');
    expect(secoesSlice).toContain('Adicionar bloco');
    expect(secoesSlice).toContain('>Editar<');
  });

  it('Aparência inicia ABERTO (details open)', () => {
    // ThemeEditor: details sempre aberto (Aparência sem acordeão escondido)
    expect(page).toMatch(/<details className="bg-white[^"]*" open>/);
    expect(page).not.toContain('open={!match}');
  });

  it('uma única prévia — sem texto verboso', () => {
    expect(page).not.toMatch(/PRÉVIA AO VIVO/);
    expect(page).not.toMatch(/Prévia ao vivo/i);
    expect(page).not.toMatch(/Prévia no celular/);
    expect(page).toMatch(/title="Prévia"|aria-label="Prévia"/);
    // não há segundo preview "ao vivo" em ThemeEditor
    const themeEditor = page.slice(page.indexOf('function ThemeEditor'));
    expect(themeEditor).not.toMatch(/PRÉVIA AO VIVO/);
  });

  it('Localização edita a MESMA fonte institucional (Business.address)', () => {
    expect(page).toContain('LocationAddressEditor');
    expect(page).toContain('/api/businesses/');
    expect(page).toContain('address: draft.address');
    expect(page).toContain('mapsUrl: draft.mapsUrl');
    expect(page).toContain('data-testid="location-address-editor"');
  });

  it('Perfil da página edita a capa (hero) da página pública', () => {
    expect(page).toContain('Capa da página');
    expect(page).toContain('CAPA / HERO');
    expect(page).toContain("business.cover");
  });
});

describe('P1 · Identidade e marca estável', () => {
  it('GODOUTOR 2.0 — cabeçalho da sidebar = CLÍNICA; GoDoutor discreto no rodapé', () => {
    const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
    // §C (clinic-first / co-branded): o nome e o logo da clínica dominam a
    // interface do tenant. A marca do PRODUTO continua presente — nunca vira
    // white-label — mas discreta, no rodapé da navegação.
    expect(nav).toContain('workspace-clinic-head');
    expect(nav).toContain('unit.logo');
    expect(nav).toContain('powered by <strong>GoDoutor</strong>');
    // E nenhum resquício do nome antigo da plataforma.
    expect(nav).not.toMatch(/Insta<span>Link<\/span>/);
    expect(nav).not.toContain('InstaLink');
  });

  it('a identidade da clínica NÃO é duplicada na topbar (uma vez só, na sidebar)', () => {
    const top = read('src/components/dashboard/WorkspaceTopbar.tsx');
    // Regra 2.0: a topbar carrega busca, ações e a conta — a unidade vive na
    // sidebar (e a troca de unidade no menu da conta).
    expect(top).not.toContain('unit.logo');
    const menu = read('src/components/dashboard/AccountMenu.tsx');
    expect(menu).toContain('Clínica atual');
    expect(menu).toMatch(/units\.map/);
  });

  it('Configurações → Identidade = nome+logo SEM capa', () => {
    const cfg = read('src/app/(dashboard)/configuracoes/page.tsx');
    expect(cfg).toContain('LOGO DA CLÍNICA');
    expect(cfg).not.toMatch(/ImageUpload label="CAPA \/ BANNER"/);
    expect(cfg).toContain('Página → Perfil');
  });

  it('não há white label total (marca do produto permanece)', () => {
    const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
    expect(nav).toContain('GoDoutor');
  });
});

describe('P1 · sidebar contínua + colapso', () => {
  const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
  const css = read('src/app/globals.css');

  it('botão colapsar = item de rodapé icônico, sem texto «<<»', () => {
    // 2.0: o controle de recolher vive no RODAPÉ da navegação, como os demais
    // itens utilitários (Ajuda) — quadrado, rotulado e acessível por teclado.
    expect(nav).toContain('workspace-foot__item--collapse');
    // (missão sidebar final: o rodapé recebe `mini` — no drawer móvel o modo
    // é sempre o expandido — mas o rótulo dinâmico continua o mesmo contrato)
    expect(nav).toMatch(/aria-label=\{(collapsed|mini) \? 'Expandir navegação' : 'Recolher navegação'\}/);
    expect(nav).not.toContain('«');
    expect(css).toContain('.workspace-foot__item--collapse');
  });

  it('o cabeçalho da clínica é superfície contínua (sem régua horizontal)', () => {
    // A régua do cabeçalho saiu: uma linha a mais entre a marca e o menu
    // criava um degrau visual sem função. O que separa é o espaçamento.
    const head = css.slice(css.indexOf('.workspace-clinic-head {'));
    expect(head.slice(0, 400)).not.toMatch(/border-bottom:\s*1px/);
  });
});

describe('P1 · paleta mais neutra', () => {
  it('PageHeader não usa gradiente roxo→lilás', () => {
    const ui = read('src/components/ui.tsx');
    expect(ui).not.toContain('from-[var(--brand)] to-[var(--lilac)]');
    expect(ui).toContain('bg-[var(--surface-3)] text-[var(--brand-fg)]');
  });

  it('Publicar usa verde --success (menos saturado que emerald-600 hardcoded)', () => {
    const page = read('src/app/(dashboard)/pagina/page.tsx');
    expect(page).toContain('pe-btn--green');
    // não usa mais emerald-600 nas ações principais de publicar
    expect(page).not.toContain('bg-emerald-600');
    expect(page).toContain('Publicar página');
  });
});
