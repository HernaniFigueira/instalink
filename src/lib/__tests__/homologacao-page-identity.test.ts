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
  it('MISSÃO UX CLOSURE · GODOUTOR 2.0 — a identidade da CLÍNICA vive na TOPBAR (logo + nome completo)', () => {
    const top = read('src/components/dashboard/WorkspaceTopbar.tsx');
    // Item 2 da missão: logo + nome COMPLETO da clínica no bloco esquerdo da
    // topbar full-width (ex.: `[logo] Andrioni Veterinaria`), nunca truncado no
    // rail. A troca de unidade continua sendo troca REAL de contexto.
    expect(top).toContain('ClinicIdentity');
    expect(top).toContain('ClinicIdentity');
    expect(top).toContain('unit.logo');
    expect(top).toContain('ws-clinic__name');
    expect(top).toContain('ws-clinic__mark');
    expect(top).toMatch(/units\.length\s*>\s*1|units\.length > 1/);
    // A marca do PRODUTO continua existindo (nada de white-label) — mas não
    // como identidade de navegação.
    const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
    expect(nav).not.toContain('InstaLink');
  });

  it('a identidade NÃO é duplicada: a sidebar não repete nome nem logo da clínica', () => {
    const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
    expect(nav).not.toContain('workspace-clinic-head');
    expect(nav).not.toContain('unit.logo');
    expect(nav).not.toContain('clinicType');
    expect(nav).not.toContain('unit.name');
    const css = read('src/app/globals.css');
    expect(css).not.toContain('.workspace-clinic-head__logo');
    expect(css).not.toContain('.workspace-clinic-head__name');
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
    // O rodapé do RAIL não repete identidade; a assinatura do produto continua
    // no rodapé do DRAWER móvel (uma vez, discreta, onde havia cabeçalho).
    const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
    expect(nav).toContain('powered by <strong>GoDoutor</strong>');
  });
});

describe('P1 · sidebar contínua + colapso', () => {
  const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
  const css = read('src/app/globals.css');

  it('NÃO existe botão de expandir/recolher (nem no rodapé, nem flutuante)', () => {
    // MISSÃO UX CLOSURE · item 1: no desktop a coluna é SEMPRE o rail estreito.
    // Sem pin, sem botão de colapso, sem «<<», sem estado persistido de largura.
    expect(nav).not.toContain('workspace-foot__item--collapse');
    expect(nav).not.toMatch(/Expandir navegação|Recolher navegação/);
    expect(nav).not.toContain('«');
    expect(nav).not.toMatch(/is-collapsed/);
    expect(css).not.toContain('.workspace-foot__item--collapse');
    expect(css).not.toMatch(/\.is-collapsed/);
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).not.toMatch(/localStorage\.\w+\(\s*'(godoutor|il)-side/);
  });

  it('o rail não repete cabeçalho de clínica: o topo é a própria lista de destinos', () => {
    // Sem `.workspace-clinic-head` não existe régua de cabeçalho para revisar:
    // a identidade está na topbar e o rail começa direto no menu.
    expect(css).not.toContain('.workspace-clinic-head {');
    expect(nav).not.toContain('workspace-clinic-head');
  });
});

describe('P1 · paleta mais neutra', () => {
  it('PageHeader não usa gradiente roxo→lilás', () => {
    const ui = read('src/components/ui.tsx');
    expect(ui).not.toContain('from-[var(--brand)] to-[var(--lilac)]');
    // CONTRATO do refino final: chip 40×40 NEUTRO sutil + borda 1px + ícone
    // line na cor do TEMA (accent) — mesmo modelo em todas as telas.
    expect(ui).toContain('bg-[var(--surface-2)] text-[var(--accent)]');
  });

  it('Publicar usa verde --success (menos saturado que emerald-600 hardcoded)', () => {
    const page = read('src/app/(dashboard)/pagina/page.tsx');
    expect(page).toContain('pe-btn--green');
    // não usa mais emerald-600 nas ações principais de publicar
    expect(page).not.toContain('bg-emerald-600');
    expect(page).toContain('Publicar página');
  });
});
