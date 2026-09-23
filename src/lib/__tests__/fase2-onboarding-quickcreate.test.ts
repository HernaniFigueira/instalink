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

describe('FASE 2 · P9 — Quick Create global', () => {
  it('menu + Novo tem as 6 criações e é filtrado pelo papel (canCreate do catálogo)', () => {
    const topbar = read('src/components/dashboard/WorkspaceTopbar.tsx');
    for (const label of ['Novo agendamento', 'Novo paciente', 'Novo profissional', 'Novo serviço', 'Nova tarefa', 'Recebimento']) {
      expect(topbar, label).toContain(label);
    }
    expect(topbar).toMatch(/\.filter\(\(i\) => canCreate\.includes\(i\.href\)\)/);
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).toContain("'/profissionais', '/financeiro'");
  });

  it('?novo=1 abre o formulário em sheet nas páginas que suportam (agenda/paciente/recebimento)', () => {
    const agenda = read('src/app/(dashboard)/agenda/page.tsx');
    expect(agenda).toContain("params.get('novo') !== '1'");
    expect(agenda).toContain('setCreating({ date:');
    const clientes = read('src/app/(dashboard)/clientes/page.tsx');
    expect(clientes).toContain("params.get('novo') !== '1'");
    expect(clientes).toContain('setNewClientOpen(true)');
    const fin = read('src/app/(dashboard)/financeiro/page.tsx');
    expect(fin).toContain("params.get('novo') !== '1'");
    expect(fin).toContain('setEditing(blankEntry())');
    // perfil/profissional/serviço/tarefa continuam com navegação simples (sem sheet pronto)
    const topbar = read('src/components/dashboard/WorkspaceTopbar.tsx');
    expect(topbar).toMatch(/open: ''/);
  });
});
