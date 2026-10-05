// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSidebarPeek, PEEK_CLOSE_MS, PEEK_ANIM_MS, PEEK_ANIM_EASE } from '../sidebar-peek';

// ═══════════════════════════════════════════════════════════════
// DS 1.0 §15–§18 · PAINEL LATERAL DE GRUPO (ex-“hover-peek do rail”)
//   1. grupo (rota direta não usa este mecanismo) abre o painel;
//   2. abertura com animação 140–180ms ease-out (janela do §15);
//   3. fechamento 250–300ms após mouseleave (trânsito do mouse);
//   4. trânsito grupo ↔ painel mantém aberto (sem flicker);
//   5. NUNCA altera o estado persistido da navegação (o pin é o único
//      controle persistente);
//   6. vale no rail E na navegação expandida (o acordeão foi extinto);
//   7. fecha na hora no clique em item e no Escape.
// ═══════════════════════════════════════════════════════════════

describe('§15 · useSidebarPeek (painel de grupo)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('1. o painel só é aberto por GRUPO — rota direta usa tooltip, não este hook', () => {
    const { result } = renderHook(() => useSidebarPeek());
    expect(result.current.peekId).toBeNull();
    act(() => result.current.onGroupEnter('clinica'));
    expect(result.current.peekId).toBe('clinica');
  });

  it('2. abertura imediata com animação curta (140–180ms, ease-out)', () => {
    // o contrato de ANIMAÇÃO vive no CSS (ws-peek-in) — aqui travamos as
    // constantes que o contrato referencia (§15: nada acima de 180ms).
    expect(PEEK_ANIM_MS).toBeGreaterThanOrEqual(140);
    expect(PEEK_ANIM_MS).toBeLessThanOrEqual(180);
    expect(PEEK_ANIM_EASE).toBe('ease-out');
    const { result } = renderHook(() => useSidebarPeek());
    act(() => result.current.onGroupEnter('gestao'));
    // abre sem delay (o tempo é da animação, não do estado)
    expect(result.current.peekId).toBe('gestao');
  });

  it('3. fecha 250–300ms DEPOIS do mouseleave (tempo de trânsito)', () => {
    const { result } = renderHook(() => useSidebarPeek());
    act(() => result.current.onGroupEnter('clinica'));
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

  it('4. trânsito grupo ↔ painel NÃO fecha (hover contínuo)', () => {
    const { result } = renderHook(() => useSidebarPeek());
    act(() => result.current.onGroupEnter('clinica'));
    act(() => result.current.onGroupLeave());        // saiu do botão…
    act(() => result.current.onPeekEnter());          // …entrou no painel
    act(() => { vi.advanceTimersByTime(600); });
    expect(result.current.peekId).toBe('clinica');    // segue aberto
    act(() => result.current.onPeekLeave());          // saiu do painel
    act(() => { vi.advanceTimersByTime(PEEK_CLOSE_MS + 10); });
    expect(result.current.peekId).toBeNull();
  });

  it('5. NUNCA altera o estado persistido da navegação (só o pin persiste)', () => {
    const { result } = renderHook(() => useSidebarPeek());
    act(() => result.current.onGroupEnter('config'));
    const keys = Object.keys(result.current);
    expect(keys).not.toContain('setCollapsed');
    expect(keys).toEqual(
      expect.arrayContaining(['peekId', 'onGroupEnter', 'onGroupLeave', 'onPeekEnter', 'onPeekLeave', 'closePeek', 'togglePeek']),
    );
  });

  it('6. o painel vale nos DOIS modos: rail e navegação expandida (§18 — sem acordeão)', () => {
    // O hook não recebe mais `collapsed`: o acordeão que empurrava os filhos
    // foi removido, então o painel é o ÚNICO comportamento de grupo.
    expect(useSidebarPeek.length).toBe(0);
    const src = require('node:fs').readFileSync('src/components/dashboard/WorkspaceNavigation.tsx', 'utf8');
    expect(src).not.toContain('workspace-submenu');
    expect(src).toContain('peekCtl.peekId');
  });

  it('7. fechar na hora: closePeek (clique em item) sem esperar o tempo', () => {
    const { result } = renderHook(() => useSidebarPeek());
    act(() => result.current.onGroupEnter('automacao'));
    act(() => result.current.closePeek());
    expect(result.current.peekId).toBeNull();
    // nada "renasce" depois (timer cancelado)
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.peekId).toBeNull();
  });

  it('8. Escape fecha o painel (teclado) — e não vaza listener entre montagens', () => {
    const { result, unmount } = renderHook(() => useSidebarPeek());
    act(() => result.current.onGroupEnter('clinica'));
    expect(result.current.peekId).toBe('clinica');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(result.current.peekId).toBeNull();
    unmount();
  });

  it('9. clique trava (sobrevive ao mouseleave); segundo clique fecha', () => {
    const { result } = renderHook(() => useSidebarPeek());
    act(() => result.current.togglePeek('clinica'));
    expect(result.current.peekId).toBe('clinica');
    act(() => result.current.onGroupLeave());
    act(() => { vi.advanceTimersByTime(PEEK_CLOSE_MS + 20); });
    expect(result.current.peekId).toBe('clinica'); // travado pelo clique
    act(() => result.current.togglePeek('clinica'));
    expect(result.current.peekId).toBeNull();
  });

  it('10. hover nunca destrava um painel travado pelo clique', () => {
    const { result } = renderHook(() => useSidebarPeek());
    act(() => result.current.togglePeek('gestao'));
    act(() => result.current.onGroupEnter('gestao'));
    act(() => result.current.onGroupLeave());
    act(() => { vi.advanceTimersByTime(PEEK_CLOSE_MS + 20); });
    expect(result.current.peekId).toBe('gestao');
  });
});
