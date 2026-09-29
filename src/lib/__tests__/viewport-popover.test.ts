import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { positionViewportPopover } from '../viewport-popover';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const rect = (left: number, top: number, width: number, height: number) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

describe('ViewportPopover · alinhamento compartilhado', () => {
  it('mantém o alinhamento à direita no desktop quando há espaço', () => {
    const position = positionViewportPopover({
      anchor: rect(1350, 18, 40, 36),
      panel: { width: 330, height: 280 },
      viewportWidth: 1440,
      viewportHeight: 900,
    });
    expect(position.left).toBe(1060);
    expect(position.top).toBe(62);
    expect(position.side).toBe('bottom');
    expect(position.width).toBeUndefined();
  });

  it('clampa a largura à viewport disponível e mantém margem lateral mínima', () => {
    const position = positionViewportPopover({
      anchor: rect(350, 18, 40, 36),
      panel: { width: 390, height: 220 },
      viewportWidth: 390,
      viewportHeight: 844,
    });
    expect(position.width).toBe(370);
    expect(position.left).toBe(10);
    expect(position.left + position.width!).toBe(380);
    expect(position.maxWidth).toBe(370);
  });

  it('inverte para cima quando não há espaço abaixo e mantém distância do topo', () => {
    const position = positionViewportPopover({
      anchor: rect(800, 760, 40, 36),
      panel: { width: 320, height: 300 },
      viewportWidth: 1024,
      viewportHeight: 800,
    });
    expect(position.side).toBe('top');
    expect(position.top).toBe(452);
    expect(position.top).toBeGreaterThanOrEqual(10);
    expect(position.top + 300).toBeLessThanOrEqual(790);
  });

  it('usa o lado vertical mais amplo sem sobrepor o gatilho e limita a altura disponível', () => {
    const position = positionViewportPopover({
      anchor: rect(8, 300, 36, 36),
      panel: { width: 300, height: 900 },
      viewportWidth: 320,
      viewportHeight: 600,
      align: 'start',
    });
    expect(position.width).toBeUndefined();
    expect(position.left).toBe(10);
    expect(position.side).toBe('top');
    expect(position.maxHeight).toBe(282);
    expect(position.top).toBe(10);
    expect(position.top + position.maxHeight).toBe(292);
  });

  it('busca acompanha a largura do campo sem sair das bordas', () => {
    const position = positionViewportPopover({
      anchor: rect(790, 30, 520, 40),
      panel: { width: 520, height: 200 },
      viewportWidth: 1024,
      viewportHeight: 768,
      align: 'start',
      matchAnchorWidth: true,
    });
    expect(position.width).toBe(520);
    expect(position.left).toBe(494);
  });

  it('usa a primitiva compartilhada nos popovers da topbar e mantém gutter estável no rail', () => {
    for (const file of [
      'src/components/dashboard/QuickCreateMenu.tsx',
      'src/components/dashboard/NotificationsBell.tsx',
      'src/components/dashboard/AccountMenu.tsx',
      'src/components/dashboard/GlobalSearch.tsx',
    ]) expect(read(file)).toContain('<ViewportPopover');
    const css = read('src/app/globals.css');
    expect(css).toContain('scrollbar-gutter: stable;');
    expect(css).toContain('overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable;');
  });

  it('usa larguras compartilhadas nos painéis aninhados e substitui o base em tablet', () => {
    const booking = read('src/components/dashboard/NewBookingSheet.tsx');
    const sheet = read('src/components/dashboard/WorkspaceSheet.tsx');
    const ui = read('src/components/ui.tsx');
    const css = read('src/app/globals.css');
    expect(booking).toContain('WORKSPACE_SHEET_SIZES.standard');
    expect(booking).toContain('WORKSPACE_SHEET_SIZES.nestedForm');
    expect(sheet).toContain('WORKSPACE_SHEET_SIZES.nestedForm');
    expect(ui).toContain('WORKSPACE_NESTED_PANEL');
    expect(css).toContain('@media (max-width: 1359px)');
    expect(css).toContain('.il-drawer__strip[data-expanded=\'true\'] .il-drawer__panel--recessed { display: none; }');
  });

  it('preserva o acesso genérico à conta do cliente e remove só a nomenclatura de Página', () => {
    const form = read('src/components/dashboard/NewClientSheet.tsx');
    const contactsApi = read('src/app/api/contacts/route.ts');
    expect(form).toContain('Criar acesso do cliente');
    expect(form).toContain('acessar consultas e pedidos');
    expect(form).not.toContain('Criar acesso à página');
    expect(form).toContain('createAccount: createAccess');
    expect(contactsApi).toContain('body.createAccount === true');
    expect(read('src/app/api/customer/bookings/route.ts')).toContain('customer');
    expect(read('src/app/api/customer/orders/route.ts')).toContain('customer');
  });

  it('converge somente o título da seção de Configurações para linguagem clínica', () => {
    const settings = read('src/app/(dashboard)/configuracoes/page.tsx');
    expect(settings).toContain('Dados da clínica');
    expect(settings).toContain('WhatsApp *');
    expect(settings).toContain('Telefone');
    expect(settings).toContain('Instagram');
    expect(settings).toContain('Link do mapa');
    expect(settings).toContain('Agenda');
    expect(settings).toContain('Aparência');
  });
});
