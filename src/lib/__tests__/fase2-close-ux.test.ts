import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · FASE 2 fechamento — página pública, editor, prévia,
// cabeçalhos de 1º nível.
// ═══════════════════════════════════════════════════════════════
const read = (p: string) => readFileSync(p, 'utf8');

describe('página pública · capa full-bleed', () => {
  it('perfil fora do container (ZERO margem no hero)', () => {
    const page = read('src/app/[slug]/page.tsx');
    expect(page).toContain('data-public-hero');
    // perfil renderizado FORA de clinic-content max-w
    const heroAt = page.indexOf('data-public-hero');
    const contentAt = page.indexOf('clinic-content');
    expect(heroAt).toBeGreaterThan(-1);
    expect(heroAt).toBeLessThan(contentAt);
    expect(page).toContain("block.type === 'profile'");
  });

  it('CSS: capa 100% + object-fit cover; cantos superiores grandes; avatar ~50/50', () => {
    const css = read('src/app/globals.css');
    expect(css).toMatch(/\.pub-hero__cover \{[^}]*width: 100%/);
    expect(css).toMatch(/\.pub-hero__cover img \{[^}]*object-fit: cover/);
    expect(css).toMatch(/\.pub-hero__sheet--overlap \{[^}]*border-radius: 36px 36px 0 0/);
    const clinic = read('src/components/public/ClinicContent.tsx');
    // avatar cruza a borda ~metade (108px/2 = 54; 132/2 = 66)
    expect(clinic).toContain('-mt-[54px]');
    expect(clinic).toContain('-mt-[66px]');
  });
});

describe('editor · única scrollbar = página', () => {
  it('.pe-preview sem max-height/overflow (sticky só)', () => {
    const css = read('src/app/globals.css');
    const m = css.match(/\.pe-preview \{[^}]*\}/);
    expect(m).toBeTruthy();
    expect(m![0]).toContain('position: sticky');
    expect(m![0]).not.toContain('max-height');
    expect(m![0]).not.toContain('overflow');
  });
});

describe('prévia · sem textos antigos', () => {
  it('sem "Prévia das alterações" / "Conteúdo real em edição"', () => {
    const cp = read('src/components/dashboard/ClinicPreview.tsx');
    expect(cp).not.toContain('Prévia das alterações');
    expect(cp).not.toContain('Conteúdo real em edição');
    expect(cp).toContain('Celular');
    expect(cp).toContain('Desktop');
    expect(cp).toContain('data-preview-device');
    const page = read('src/app/(dashboard)/pagina/page.tsx');
    expect(page).not.toContain('Conteúdo real em edição, sem salvar');
  });
});

describe('cabeçalhos de 1º nível', () => {
  it('Agenda: só o título — sem "?" ao lado', () => {
    const ag = read('src/app/(dashboard)/agenda/page.tsx');
    expect(ag).toContain('>Agenda</h1>');
    // botão de ajuda inline removido (legenda permanece)
    expect(ag).not.toMatch(/aria-label="Ajuda da agenda"/);
  });

  it('breadcrumb Início só em páginas profundas (grupo); 1º nível sem crumbs', () => {
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).toContain('crumb.group');
    // nav condicional
    // breadcrumb aparece apenas quando há grupo (página profunda)
    expect(shell).toContain('{crumb.group && homeHref && (');
  });
});
