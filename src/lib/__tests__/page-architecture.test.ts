import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { AUTHENTICATED_AUXILIARY_ROUTES, PANEL_ROUTES, FULL_WIDTH_PATHS, pageTypeForPath } from '../panel';
import { roleLabel } from '../role-labels';
import { canShowPublicPageLink } from '../product';

const read = (file: string) => readFileSync(file, 'utf8');
const validPageTypes = ['workspace', 'context', 'record', 'detail', 'form', 'hub'];

describe('Page Architecture contract', () => {
  it('every authenticated DashboardShell route has a valid archetype and a page file', () => {
    for (const route of PANEL_ROUTES) {
      expect(validPageTypes, `${route.href} has no valid pageType`).toContain(route.pageType);
      expect(existsSync(`src/app/(dashboard)${route.href}/page.tsx`), route.href).toBe(true);
    }
    expect(pageTypeForPath('/clientes/abc123')).toBe('context');
    expect(pageTypeForPath('/clientes')).toBe('workspace');
    for (const route of AUTHENTICATED_AUXILIARY_ROUTES) {
      expect(validPageTypes, `${route.href} has no valid pageType`).toContain(route.pageType);
      expect(existsSync(`src/app${route.href}/page.tsx`), route.href).toBe(true);
      if (route.shell === 'redirect') expect(route.redirectTo).toBeTruthy();
    }
  });

  it('workspace routes stay full width; forms center; Cliente 360/Atendimento use the context shell at operational width', () => {
    const css = read('src/app/globals.css');
    const shell = read('src/components/DashboardShell.tsx');
    expect(FULL_WIDTH_PATHS).toContain('/agenda');
    expect(FULL_WIDTH_PATHS).toContain('/conversas');
    expect(FULL_WIDTH_PATHS).toContain('/funil');
    expect(css).toContain('.il-page-frame--workspace { max-width:none; }');
    expect(css).toContain('.il-page-frame--form { max-width:var(--page-width-form); }');
    expect(css).toContain('--page-width-form:60rem');
    expect(css).toContain('margin-inline:auto');
    expect(shell).toContain('type={pageType}');
    expect(shell).not.toMatch(/activeRoute\?\.width/);
    expect(pageTypeForPath('/atendimento')).toBe('context');
    expect(pageTypeForPath('/atendimento/e1/registro')).toBe('context');
    expect(css).toContain('.gd-page-frame--context { max-width:none; }');
    expect(css).toContain('.il-page-frame--record,');
  });
});

describe('AccountMenu legacy gate', () => {
  it('propagates the flag end-to-end and only shows the public-page link when enabled', () => {
    const shell = read('src/components/DashboardShell.tsx');
    const topbar = read('src/components/dashboard/WorkspaceTopbar.tsx');
    const menu = read('src/components/dashboard/AccountMenu.tsx');
    expect(shell).toContain('legacyPagesEnabled={legacyPagesEnabled}');
    expect(topbar).toContain('legacyPagesEnabled={legacyPagesEnabled}');
    expect(menu).toContain('canShowPublicPageLink(legacyPagesEnabled, unit.slug)');
    expect(canShowPublicPageLink(false, 'clinica')).toBe(false);
    expect(canShowPublicPageLink(true, 'clinica')).toBe(true);
    expect(canShowPublicPageLink(true, '')).toBe(false);
    expect(menu).toContain('Ver página pública');
  });

  it('keeps all account and unit actions and keeps name and official role accessible', () => {
    const menu = read('src/components/dashboard/AccountMenu.tsx');
    for (const label of ['Meu perfil', 'Visão da organização', 'Nova unidade', 'Configurações', 'Ajuda e suporte', 'Alterar senha', 'Sair']) {
      expect(menu).toContain(label);
    }
    expect(menu).toContain('ws-account__identity-name');
    expect(menu).toContain('ws-account__identity-role');
    expect(menu).toContain('aria-label={`Menu da conta — ${user.name}`}');
    expect(menu).not.toContain('Criar nova organização');
    expect(menu).not.toContain('ws-account__identity-email');
  });
});

describe('Perfil, role e cargo profissional', () => {
  it('has one editable photo control, official access-role badge, separate sections and password route', () => {
    const profile = read('src/app/(dashboard)/perfil/page.tsx');
    expect((profile.match(/<ImageUpload\b/g) || []).length).toBe(1);
    expect(profile).not.toContain('<Avatar');
    // Papel de acesso é projetado da unidade ativa, nunca do perfil global.
    expect(profile).toContain('accessRoleLabel(unitRole)');
    expect(profile).toContain('<Badge tone="blue"');
    for (const title of ['Dados pessoais', 'Identidade profissional', 'Segurança']) expect(profile).toContain(title);
    expect(profile).toContain('Cargo / função');
    expect(profile).toContain('Conselho profissional');
    expect(profile).toContain('Formação e especialidades');
    expect(profile).toContain('/alterar-senha');
    expect(profile).toContain('Também realiza atendimentos');
    expect(profile).toContain('Vincule seu perfil à equipe clínica');
    expect(profile).not.toContain('seu acesso é o User; quem atende na agenda é o Professional');
    expect(profile).not.toContain('ShellAppearance');
  });

  it('official role labels are normalized and never inferred from professional title', () => {
    expect(roleLabel('owner')).toBe('Proprietário');
    expect(roleLabel('ADMIN')).toBe('Administrador');
    expect(roleLabel('secretaria')).toBe('Recepção');
    expect(roleLabel('PROFISSIONAL')).toBe('Profissional');
    const profile = read('src/app/(dashboard)/perfil/page.tsx');
    expect(profile).toContain('form.title');
    // Papel de acesso é projetado da unidade ativa, nunca do perfil global.
    expect(profile).toContain('accessRoleLabel(unitRole)');
    expect(profile).not.toMatch(/me\?\.role\s*===.*\?.*Proprietário/);
  });
});

describe('legacy copy without data or route removal', () => {
  it('removes storefront language from Products when legacy pages are off, and documents no stock scope', () => {
    const products = read('src/app/(dashboard)/produtos/page.tsx');
    const panel = read('src/lib/panel.ts');
    expect(products).toContain('const legacyPagesEnabled = isLegacyPagesEnabled()');
    expect(products).toMatch(/title=\{legacyPagesEnabled \? "Vitrine de produtos" : "Produtos"\}/);
    expect(products).toContain('não movimenta estoque, registra vendas ou controla dispensação');
    expect(products).toContain('não representam controle de estoque, venda ou Farmácia');
    expect(panel).toContain("href: '/produtos'");
    expect(panel).not.toContain('A vitrine de produtos exibida na sua página pública');
  });

  it('keeps clinical settings fields and only exposes page-builder copy behind the legacy flag', () => {
    const settings = read('src/app/(dashboard)/configuracoes/page.tsx');
    for (const field of ['LOGO DA CLÍNICA', 'WhatsApp', 'Telefone', 'Instagram', 'Facebook', 'YouTube', 'LinkedIn', 'Meu site', 'Endereço', 'Link do mapa', 'Agenda']) {
      expect(settings).toContain(field);
    }
    expect(settings).toMatch(/\['aparencia', 'Aparência'\]/);
    expect(settings).not.toMatch(/CONFIG_TAB_ICON.*aparencia/);
    const perfil = read('src/app/(dashboard)/perfil/page.tsx');
    expect(settings).toContain('Aparência');
    expect(perfil).not.toContain('ShellAppearance');
    expect(settings).toContain('{legacyPagesEnabled && <section');
    expect(settings).toContain('Informações da clínica e regras de agendamento.');
  });
});
