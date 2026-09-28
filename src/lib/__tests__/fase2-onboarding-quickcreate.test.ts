import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setupChecklist, setupProgress } from '../dashboard';
import type { DashboardModules } from '../dashboard';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const business = (over: Record<string, unknown> = {}) => ({
  description: '', logo: '', cover: '', whatsapp: '', phone: '', address: '',
  published: false, ...over,
}) as any;
const modules = { services: true, bookings: true, products: false } as unknown as DashboardModules;
const counts = { services: 0, availability: 0, professionals: 0, products: 0 };

describe('FASE 2 · P8 — checklist operacional', () => {
  it('ciclo na ordem: dados → serviço → profissional → horários → personalizar → publicar → WhatsApp (opcional)', () => {
    const items = setupChecklist({ business: business(), modules, counts, pageCustomized: false, whatsappConnected: false });
    expect(items.map((i) => i.id)).toEqual(['profile', 'services', 'team', 'hours', 'personalize', 'publish', 'whatsapp']);
    expect(items.find((i) => i.id === 'whatsapp')?.optional).toBe(true);
    // progresso REAL: nada pré-marcado
    expect(setupProgress(items)).toBeLessThan(100);
    expect(items.every((i) => i.done === false)).toBe(true);
  });

  it('item pulado conta como resolvido (só optional pode ser pulado — persistido em setupSkipped)', () => {
    const items = setupChecklist({
      business: business({ setupSkipped: ['whatsapp', 'profile'] }), // 'profile' não é optional: NÃO conta
      modules, counts, pageCustomized: true, whatsappConnected: false,
    });
    expect(items.find((i) => i.id === 'whatsapp')?.done).toBe(true);
    expect(items.find((i) => i.id === 'profile')?.done).toBe(false); // obrigatório ignorado permanece pendente
    expect(items.find((i) => i.id === 'personalize')?.done).toBe(true);
  });

  it('sem módulos irrelevantes (produtos desligado não cobra vitrine)', () => {
    const items = setupChecklist({ business: business(), modules, counts, pageCustomized: false, whatsappConnected: false });
    expect(items.map((i) => i.id)).not.toContain('products');
  });
});

describe('FASE 2 · P9 — quick create premium (missão 6: o “+” volta)', () => {
  it('o “+” voltou como ação global premium — as ações vivem no QuickCreateMenu', () => {
    const topbar = read('src/components/dashboard/WorkspaceTopbar.tsx');
    const quick = read('src/components/dashboard/QuickCreateMenu.tsx');
    expect(topbar).toContain('<QuickCreateMenu');
    // O contrato canCreate é finalmente usado: filtra as ações do menu.
    expect(topbar).toContain('canCreate');
    for (const label of ['Novo agendamento', 'Nova pendência', 'Novo recebimento']) {
      expect(quick, label).toContain(label);
    }
    // Busca · sino · ajuda · conta permanecem no topo.
    expect(topbar).toContain('<GlobalSearch');
    expect(topbar).toContain('<NotificationsBell');
    expect(topbar).toContain('<AccountMenu');
  });

  it('?novo=1 continua abrindo o formulário em sheet nas páginas que suportam', () => {
    // O deep link é independente do menu removido: segue funcionando.
    const agenda = read('src/app/(dashboard)/agenda/page.tsx');
    expect(agenda).toContain("params.get('novo') !== '1'");
    expect(agenda).toContain('setCreating({ date:');
    const clientes = read('src/app/(dashboard)/clientes/page.tsx');
    expect(clientes).toContain("params.get('novo') !== '1'");
    expect(clientes).toContain('setNewClientOpen(true)');
    const fin = read('src/app/(dashboard)/financeiro/page.tsx');
    expect(fin).toContain("params.get('novo') !== '1'");
    expect(fin).toContain('setEditing(blankEntry())');
  });
});
