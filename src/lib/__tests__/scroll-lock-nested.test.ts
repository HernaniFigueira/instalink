// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeBodyScrollLocks, lockBodyScroll, unlockBodyScroll } from '@/lib/scroll-lock';

// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · scroll lock com sheets/Drawers empilhados
// Fechar em qualquer ordem NÃO pode deixar body overflow=hidden preso.
// ═══════════════════════════════════════════════════════════════

beforeEach(() => {
  // reseta estado residual entre testes
  while (activeBodyScrollLocks() > 0) unlockBodyScroll(Symbol.for('orphan'));
  document.body.style.overflow = '';
});

afterEach(() => {
  document.body.style.overflow = '';
});

describe('lockBodyScroll · referência-contada', () => {
  it('primeiro lock esconde; segundo não sobrescreve o saved; último restaura', () => {
    document.body.style.overflow = 'auto';
    const a = {};
    const b = {};
    lockBodyScroll(a);
    expect(document.body.style.overflow).toBe('hidden');
    expect(activeBodyScrollLocks()).toBe(1);

    lockBodyScroll(b); // sheet filho — não deve capturar "hidden" como original
    expect(activeBodyScrollLocks()).toBe(2);

    unlockBodyScroll(a); // pai fecha primeiro
    expect(document.body.style.overflow).toBe('hidden'); // ainda travado
    expect(activeBodyScrollLocks()).toBe(1);

    unlockBodyScroll(b); // filho por último
    expect(document.body.style.overflow).toBe('auto'); // original restaurado
    expect(activeBodyScrollLocks()).toBe(0);
  });

  it('filho fecha primeiro, pai depois — também restaura', () => {
    document.body.style.overflow = '';
    const a = {};
    const b = {};
    const c = {};
    lockBodyScroll(a);
    lockBodyScroll(b);
    lockBodyScroll(c);
    unlockBodyScroll(c);
    unlockBodyScroll(a);
    expect(document.body.style.overflow).toBe('hidden');
    unlockBodyScroll(b);
    expect(document.body.style.overflow).toBe('');
    expect(activeBodyScrollLocks()).toBe(0);
  });

  it('unlock duplicado do mesmo token não destrava cedo', () => {
    document.body.style.overflow = 'scroll';
    const a = {};
    lockBodyScroll(a);
    unlockBodyScroll(a);
    unlockBodyScroll(a); // idempotente
    expect(document.body.style.overflow).toBe('scroll');
    expect(activeBodyScrollLocks()).toBe(0);
  });

  it('lock com o mesmo token é idempotente (não infla o contador)', () => {
    const a = {};
    lockBodyScroll(a);
    lockBodyScroll(a);
    expect(activeBodyScrollLocks()).toBe(1);
    unlockBodyScroll(a);
    expect(activeBodyScrollLocks()).toBe(0);
    expect(document.body.style.overflow).toBe('');
  });
});
