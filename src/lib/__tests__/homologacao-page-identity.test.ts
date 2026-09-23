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
  it('sidebar = GoDoutor (nunca logo da clínica nem InstaLink)', () => {
    const nav = read('src/components/dashboard/WorkspaceNavigation.tsx');
    expect(nav).toContain('Go<span>Doutor</span>');
    expect(nav).not.toMatch(/Insta<span>Link<\/span>/);
    // sem logo da clínica na identidade da sidebar
    const identity = nav.slice(nav.indexOf('const identity'), nav.indexOf('const identity') + 800);
    expect(identity).not.toContain('unit.logo');
  });

  it('topbar seletor de unidade mostra logo pequena da clínica', () => {
    const top = read('src/components/dashboard/WorkspaceTopbar.tsx');
    expect(top).toContain('ws-unitpill__logo');
    expect(top).toContain('unit.logo');
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

  it('botão colapsar = icon button quadrado arredondado, sem texto «<<»', () => {
    expect(nav).toContain('workspace-collapse-btn');
    expect(nav).not.toContain('«');
    expect(css).toContain('.workspace-collapse-btn {');
    expect(css).toMatch(/\.workspace-collapse-btn\s*\{[^}]*border-radius:\s*8px/);
  });

  it('sem linha horizontal sob o logo (superfície contínua)', () => {
    expect(css).toMatch(/\.workspace-identity\s*\{[^}]*border-bottom:\s*0/);
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
