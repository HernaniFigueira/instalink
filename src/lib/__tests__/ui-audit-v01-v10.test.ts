import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDateBR, formatDateTimeBR } from '../tz';
import { NAV_ACCENTS, contrastRatio } from '../nav-accent';
import { isLegacyPagesEnabled } from '../product';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const dashboard = read('src/app/(dashboard)/dashboard/page.tsx');
const taskPanel = read('src/components/dashboard/TaskPanel.tsx');
const client360 = read('src/components/dashboard/ClientProfileDrawer.tsx');
const agent = read('src/app/(dashboard)/agente/page.tsx');
const agenda = read('src/app/(dashboard)/agenda/page.tsx');
const encounter = read('src/components/dashboard/EncounterSheet.tsx');
const css = read('src/app/globals.css');

describe('Auditoria visual V01–V10 · correções reproduzidas', () => {
  it('V01 escolhe as quatro colunas pela largura do container e mantém a grade 2×2 como base', () => {
    expect(css).toMatch(/\.dashboard-intelligence\s*\{\s*container:\s*intelligence\s*\/\s*inline-size/);
    expect(css).toMatch(/\.dashboard-intelligence__grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/@container intelligence \(min-width:\s*560px\)[\s\S]*?repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    expect(dashboard).toContain('dashboard-intelligence__grid');
    expect(dashboard).toContain('leading-snug text-[var(--text-muted)]');
  });

  it('V02 põe o nome antes dos detalhes e não trunca cliente nem status', () => {
    expect(dashboard).toContain('flex flex-col items-stretch gap-1.5');
    expect(dashboard).toContain('font-semibold leading-snug text-[var(--text)] break-words">{b.customerName}');
    expect(dashboard).toContain('{humanDay(b.date)} {b.time}');
    expect(dashboard).toContain('>{b.service}</span>');
    expect(dashboard).toContain('<StatusBadge tone={b.status');
  });

  it('V03 reserva largura de identidade no mobile e deixa contato/data legíveis', () => {
    expect(client360).toContain('client360-idcard__identity');
    expect(client360).toContain('client360-idcard__data');
    expect(css).toContain('grid-template-columns: 64px minmax(0, 1fr)');
    expect(css).toContain('.client360-idcard__data { grid-template-columns: minmax(0, 1fr); }');
    expect(css).toContain('overflow-wrap: anywhere;');
  });

  it('V04 mantém corpo da pendência em largura própria e ações acessíveis em linha separada no mobile', () => {
    expect(taskPanel).toContain('flex flex-col items-start gap-3 sm:flex-row');
    expect(taskPanel).toContain('w-full min-w-0 flex-1 sm:w-auto');
    expect(taskPanel).toContain('w-full flex-wrap items-center gap-1.5 sm:w-auto');
    expect(taskPanel.match(/min-h-11 items-center/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('V05 deixa Salvar no fluxo normal ao final da configuração do agente', () => {
    expect(agent).toContain('<div className="pt-2">');
    expect(agent).not.toContain('sticky bottom-4');
    expect(agent).toContain('Salvar agente');
  });

  it('V06 usa foreground temático nos chevrons fechados, com contraste para Branco, Azul, Sálvia e Ônix', () => {
    expect(css).toMatch(/\.workspace-link__chevron\s*\{[^}]*color:\s*var\(--il-nav-fg\)/);
    for (const id of ['branco', 'azul-profundo', 'verde-salvia', 'onix']) {
      const theme = NAV_ACCENTS.find((entry) => entry.id === id)!;
      expect(contrastRatio(theme.vars['--il-nav-fg'], theme.vars['--il-nav']), id).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toContain(".workspace-link--group[aria-expanded='true'] .workspace-link__chevron { color: inherit; }");
  });

  it('V07 aplica padding 16px ao body do sheet financeiro sem mexer no domínio', () => {
    expect(read('src/app/(dashboard)/financeiro/page.tsx')).toContain('<div className="p-4 space-y-3">');
    expect(read('src/components/dashboard/WorkspaceSheet.tsx')).toContain('ws-sheet__body ws-scroll');
  });

  it('V08 mantém hora/nome/status em Dia compacto e reduz só metadados secundários', () => {
    expect(agenda).toContain('ag-event--day');
    expect(agenda).toContain('ag-event__time');
    expect(agenda).toContain('ag-event__name');
    expect(css).toMatch(/\.ag-event--day \.ag-event__secondary\s*\{\s*display:\s*none/);
    expect(agenda).toContain("['day','week','month','list']");
  });

  it('V09 não duplica “Salvo agora” na página, compacta ações secundárias e destaca Finalizar', () => {
    // F1A — three layouts now (page | section | sheet): the "Salvo agora"
    // label stays exclusive to the side panel, because page AND section footers
    // already carry the persistence indicator. Same invariant, wider scope.
    expect(encounter).toContain("layout === 'sheet' && isDraft && autoState === 'saved'");
    expect(encounter).toContain('flex flex-wrap items-center gap-2');
    expect(encounter).toContain('Finalizar atendimento');
    expect(css).toContain('env(safe-area-inset-bottom)');
  });

  it('V10 compartilha formato pt-BR completo sem alterar datas persistidas', () => {
    expect(formatDateBR('2026-09-28')).toBe('28/09/2026');
    expect(formatDateTimeBR('2026-09-28', '09:05')).toBe('28/09/2026 09:05');
    expect(formatDateTimeBR('2026-09-28T12:05:00.000Z')).toMatch(/^28\/09\/2026 \d{2}:\d{2}$/);
    expect(read('src/components/dashboard/TaskPanel.tsx')).toContain('formatDateTimeBR(dueAt)');
    expect(read('src/components/dashboard/AnamneseFiller.tsx')).toContain('formatDateBR(lastResponse.createdAt.slice(0, 10))');
    expect(read('src/components/dashboard/ConversationsView.tsx')).toContain('formatDateTimeBR(conversation.lastMessageAt)');
    expect(encounter).toContain('formatDateTimeBR(row.finalizedAt)');
  });
});

describe('Página legada · superfícies autenticadas sob flag OFF/ON', () => {
  it('OFF remove presença e analytics de Página do dashboard/resultados e limpa copy residual', () => {
    expect(isLegacyPagesEnabled({})).toBe(false);
    expect(dashboard).toContain(') : legacyPagesEnabled ? (');
    expect(dashboard).toContain('legacyPagesEnabled && trend.length >= 2');
    expect(read('src/app/(dashboard)/resultados/page.tsx')).toContain('if (!legacyPagesEnabled)');
    expect(read('src/app/(dashboard)/resultados/page.tsx')).toContain('{legacyPagesEnabled && pageTotals && (');
    expect(agent).toContain('legacyPagesEnabled ?');
    expect(agent).toContain('{legacyPagesEnabled && <button');
    expect(read('src/components/dashboard/NewBookingSheet.tsx')).toContain("isLegacyPagesEnabled() ? 'o cliente pode já ter conta na sua página.' : 'o cliente pode já ter uma conta.'");
    expect(read('src/app/(dashboard)/configuracoes/page.tsx')).toContain('{legacyPagesEnabled && <section');
  });

  it('ON preserva entrada pública, editor e conteúdo legado suportado', () => {
    expect(isLegacyPagesEnabled({ GODOUTOR_LEGACY_PAGES: '1' })).toBe(true);
    expect(isLegacyPagesEnabled({ GODOUTOR_LEGACY_PAGES: 'true' })).toBe(true);
    expect(dashboard).toContain('Presença online');
    expect(read('src/app/(dashboard)/resultados/page.tsx')).toContain('Funil de agendamentos');
    expect(agent).toContain('Módulo ativo na página');
    expect(read('src/app/(dashboard)/configuracoes/page.tsx')).toContain('Editar página pública');
    expect(read('src/app/(dashboard)/configuracoes/page.tsx')).toContain('href={`/pagina?b=${businessId}`}');
    expect(fs.existsSync(path.join(root, 'src/app/[slug]/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/app/(dashboard)/pagina/page.tsx'))).toBe(true);
  });
});
