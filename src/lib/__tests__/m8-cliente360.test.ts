// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildClientListReturnQuery, clientListReturnHref,
} from '../client-return';
import {
  FIELD_HIGHLIGHT_CLASS, focusField, focusFieldSoon, prefersReducedMotion,
} from '../focus-highlight';

// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · Cliente 360 (§16–18)
//   1. retorno à lista preserva busca/filtro/página (fallback ?b=);
//   2. "Registrar nota"/"Editar dados" = scroll suave + foco + highlight
//      sutil de 1–2s (sem modal novo);
//   3. prefers-reduced-motion troca o scroll suave por instantâneo.
// ═══════════════════════════════════════════════════════════════

describe('§16 · retorno à lista de clientes', () => {
  it('busca, filtro e página viajam na URL e voltam inteiros', () => {
    const query = buildClientListReturnQuery({ b: 'biz-1', q: 'bernardo', filter: 'pets', page: 3, tab: 'notes' });
    const href = clientListReturnHref(query, 'biz-1');
    expect(href).toBe('/clientes?b=biz-1&q=bernardo&filter=pets&page=3&tab=notes');
  });

  it('estado padrão não polui a URL (filter=all e page=1 ficam de fora)', () => {
    const href = clientListReturnHref(buildClientListReturnQuery({ b: 'biz-1', q: '  ana  ', filter: 'all', page: 1 }), 'biz-1');
    expect(href).toBe('/clientes?b=biz-1&q=ana');
  });

  it('fallback SEMPRE preserva a unidade: sem estado → /clientes?b=…', () => {
    expect(clientListReturnHref('', 'biz-1')).toBe('/clientes?b=biz-1');
    expect(clientListReturnHref('b=biz-1', 'fallback-ignored')).toBe('/clientes?b=biz-1');
  });

  it('deep-link com estado parcial volta exatamente com o que tem', () => {
    expect(clientListReturnHref('b=biz-1&page=2', 'fallback-ignored')).toBe('/clientes?b=biz-1&page=2');
    expect(clientListReturnHref('b=biz-1&q=sofia&filter=pets', 'fallback-ignored')).toBe('/clientes?b=biz-1&q=sofia&filter=pets');
  });
});

// ── §17–18 · foco guiado ──
describe('§17–18 · focusField — scroll, foco e highlight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function mountField(id = 'client-note-draft') {
    const el = document.createElement('textarea');
    el.id = id;
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    return el;
  }

  it('rola suave, foca e aplica o highlight por ~1–2s', () => {
    const el = mountField();
    focusField(el);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(document.activeElement).toBe(el);
    expect(el.classList.contains(FIELD_HIGHLIGHT_CLASS)).toBe(true);
    vi.advanceTimersByTime(1800 + 10);
    expect(el.classList.contains(FIELD_HIGHLIGHT_CLASS)).toBe(false);
  });

  it('aceita id (para ações que trocam de aba antes do foco)', () => {
    const el = mountField('client-edit-name');
    focusField('client-edit-name');
    expect(document.activeElement).toBe(el);
    expect(el.classList.contains(FIELD_HIGHLIGHT_CLASS)).toBe(true);
  });

  it('focusFieldSoon espera o campo surgir (render atrasado) e então foca', () => {
    focusFieldSoon('client-note-draft', 12, 40);
    // campo ainda não existe → nada acontece
    expect(document.activeElement).not.toBe(document.body.querySelector('#client-note-draft'));
    // render acontece…
    const el = mountField();
    vi.advanceTimersByTime(200);
    expect(document.activeElement).toBe(el);
    expect(el.classList.contains(FIELD_HIGHLIGHT_CLASS)).toBe(true);
  });

  it('focusFieldSoon desiste em silêncio quando o alvo nunca existe', () => {
    expect(() => {
      focusFieldSoon('nao-existe', 3, 10);
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
  });

  it('alvo inexistente no focusField é no-op silencioso', () => {
    expect(() => focusField('tambem-nao-existe')).not.toThrow();
    expect(() => focusField(null)).not.toThrow();
  });

  it('prefers-reduced-motion existe e responde booleano (usado pelo helper)', () => {
    expect(typeof prefersReducedMotion()).toBe('boolean');
  });
});
