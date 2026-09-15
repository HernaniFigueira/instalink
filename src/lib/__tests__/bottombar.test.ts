import { describe, expect, it } from 'vitest';
import { bottomBarItems } from '../bottombar';

// Estrutura conceitual do menu inferior público (auditoria §15):
// Conta · WhatsApp · Menu · Agendar — Agendar é a única ação principal.

describe('bottomBarItems — estrutura do menu público', () => {
  it('quatro itens na ordem conceitual quando tudo está ativo', () => {
    const items = bottomBarItems({ canBook: true, whatsapp: true, customerName: 'Maria Silva' });
    expect(items.map((i) => i.id)).toEqual(['conta', 'whatsapp', 'menu', 'agendar']);
    expect(items.map((i) => i.label)).toEqual(['Maria', 'WhatsApp', 'Menu', 'Agendar']);
  });

  it('Agendar é o ÚNICO item preenchido (ação principal)', () => {
    const items = bottomBarItems({ canBook: true, whatsapp: true });
    expect(items.filter((i) => i.primary).map((i) => i.id)).toEqual(['agendar']);
  });

  it('visitante anônimo vê "Entrar" no item de conta', () => {
    const items = bottomBarItems({ canBook: false, whatsapp: false });
    expect(items.map((i) => i.id)).toEqual(['conta', 'menu']);
    expect(items[0]).toMatchObject({ label: 'Entrar', icon: 'user' });
  });

  it('sem agenda não existe Agendar; sem número não existe WhatsApp', () => {
    expect(bottomBarItems({ canBook: false, whatsapp: true }).map((i) => i.id))
      .toEqual(['conta', 'whatsapp', 'menu']);
    expect(bottomBarItems({ canBook: true, whatsapp: false }).map((i) => i.id))
      .toEqual(['conta', 'menu', 'agendar']);
  });
});
