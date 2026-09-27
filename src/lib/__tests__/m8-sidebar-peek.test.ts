// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSidebarPeek, PEEK_CLOSE_MS, PEEK_ANIM_MS, PEEK_ANIM_EASE } from '../sidebar-peek';

// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · sidebar recolhida · hover-peek de GRUPOS (§7)
//   1. rota direta no hover  = só tooltip (sem peek);
//   2. grupo expansível      = peek TEMPORÁRIO com os itens;
//   3. abertura 150–200ms (animação ease-out);
//   4. fechamento 250–300ms após mouseleave;
//   5. NUNCA altera o collapsed persistido (botão = única preferência);
//   6. expandida = acordeão; hover não abre peek;
//   7. trânsito grupo ↔ peek mantém aberto (sem flicker).
// ═══════════════════════════════════════════════════════════════

describe('§7 · useSidebarPeek', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('1. recolhida: peek só para GRUPOS — rota direta não usa este mecanismo', () => {
    // (rotas diretas usam data-tip, sem chamar o hook; aqui travamos que o
    // hook abre apenas quando é chamado para um grupo)
    const { result } = renderHook(() => useSidebarPeek(true));
    expect(result.current.peekId).toBeNull();
    act(() => result.current.onGroupEnter('clinica', 120));
    expect(result.current.peekId).toBe('clinica');
    expect(result.current.peekTop).toBe(120);
  });

  it('2. abertura imediata com animação curta (150–200ms, ease-out)', () => {
    // o contrato de ANIMAÇÃO vive no CSS (ws-peek-in 200ms ease-out) — aqui
    // travamos as constantes que o contrato referencia.
    expect(PEEK_ANIM_MS).toBeGreaterThanOrEqual(180);
    expect(PEEK_ANIM_MS).toBeLessThanOrEqual(220);
    expect(PEEK_ANIM_EASE).toBe('ease-out');
    const { result } = renderHook(() => useSidebarPeek(true));
    act(() => result.current.onGroupEnter('gestao', 40));
    // abre sem delay (o tempo é da animação, não do estado)
    expect(result.current.peekId).toBe('gestao');
  });

  it('3. fecha 250–300ms DEPOIS do mouseleave (tempo de trânsito)', () => {
    const { result } = renderHook(() => useSidebarPeek(true));
    act(() => result.current.onGroupEnter('clinica', 0));
    act(() => result.current.onGroupLeave());
    // ainda aberto antes da janela
    act(() => { vi.advanceTimersByTime(240); });
    expect(result.current.peekId).toBe('clinica');
    // fechado dentro da janela 250–300ms
    act(() => { vi.advanceTimersByTime(PEEK_CLOSE_MS - 240 + 10); });
    expect(result.current.peekId).toBeNull();
    expect(PEEK_CLOSE_MS).toBeGreaterThanOrEqual(250);
    expect(PEEK_CLOSE_MS).toBeLessThanOrEqual(300);
  });

  it('4. trânsito grupo ↔ peek NÃO fecha (hover contínuo)', () => {
    const { result } = renderHook(() => useSidebarPeek(true));
    act(() => result.current.onGroupEnter('clinica', 0));
    act(() => result.current.onGroupLeave());        // saiu do botão…
    act(() => result.current.onPeekEnter());          // …entrou no peek
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.peekId).toBe('clinica');    // segue aberto
    act(() => result.current.onPeekLeave());          // saiu do peek
    act(() => { vi.advanceTimersByTime(PEEK_CLOSE_MS + 10); });
    expect(result.current.peekId).toBeNull();
  });

  it('5. NUNCA altera o collapsed persistido', () => {
    // o hook RECEBE collapsed e não devolve forma de mudá-lo — a preferência
    // persistente é só o botão Recolher/Expandir (onCollapse do componente).
    const { result } = renderHook(() => useSidebarPeek(true));
    act(() => result.current.onGroupEnter('config', 0));
    const keys = Object.keys(result.current);
    expect(keys).not.toContain('setCollapsed');
    expect(keys).toEqual(
      expect.arrayContaining(['peekId', 'peekTop', 'onGroupEnter', 'onGroupLeave', 'onPeekEnter', 'onPeekLeave', 'closePeek']),
    );
  });

  it('6. EXPANDIDA: hover de grupo não abre peek (acordeão normal)', () => {
    const { result } = renderHook(() => useSidebarPeek(false));
    act(() => result.current.onGroupEnter('clinica', 10));
    expect(result.current.peekId).toBeNull();
  });

  it('7. fechar na hora: closePeek (clique em item/Escape) sem esperar o tempo', () => {
    const { result } = renderHook(() => useSidebarPeek(true));
    act(() => result.current.onGroupEnter('automacao', 0));
    act(() => result.current.closePeek());
    expect(result.current.peekId).toBeNull();
    // nada "renasce" depois (timer cancelado)
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.peekId).toBeNull();
  });

  it('bônus: recolher/expandir com peek aberto fecha tudo (sem estado órfão)', () => {
    const { result, rerender } = renderHook(({ c }: { c: boolean }) => useSidebarPeek(c), {
      initialProps: { c: true },
    });
    act(() => result.current.onGroupEnter('clinica', 0));
    expect(result.current.peekId).toBe('clinica');
    rerender({ c: false }); // usuário expandiu a sidebar
    expect(result.current.peekId).toBeNull();
  });
});
