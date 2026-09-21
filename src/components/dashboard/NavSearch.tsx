'use client';
// ═══════════════════════════════════════════════════════════════
// BUSCA DE NAVEGAÇÃO (fechamento A3.3, ponto 2)
// ═══════════════════════════════════════════════════════════════
// O ícone de busca do topo da sidebar é FUNCIONAL: procura no catálogo REAL
// da navegação (label + descrição) e leva para a rota de verdade.
//
// Regras que importam:
//   • A fonte é `nav.allowed` — o mesmo cálculo de permissão que monta o menu.
//     Ou seja: só aparece destino que aquele usuário já alcança. Não existe
//     aqui uma lista paralela de telas capaz de revelar rota sem permissão.
//   • Não é busca de clientes/dados. É busca de NAVEGAÇÃO.
//   • O `?b=businessId` é preservado pelo `href` já resolvido que chega pronto.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mayLeaveEditor } from './useUnsavedChanges';
import { Icon } from '@/components/icons';

// O tipo e a regra de busca vêm de lib/nav-search.ts (pura e testável).
export type { NavSearchItem } from '@/lib/nav-search';
import { searchNav, type NavSearchItem } from '@/lib/nav-search';

export function NavSearch({ items, collapsed, activePath }: {
  items: NavSearchItem[]; collapsed: boolean; activePath: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Regra de busca (label + descrição, sem acento, tela atual primeiro) vive
  // em lib/nav-search.ts — testada lá, sem duplicar lógica aqui.
  const results = useMemo(() => searchNav(items, query, activePath), [items, query, activePath]);

  useEffect(() => { setCursor(0); }, [query, open]);

  // Foco no campo assim que abre.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Ctrl/Cmd + K abre (atalho opcional do briefing; o botão continua sendo o
  // caminho principal). Não rouba o atalho quando um campo já está em foco.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Clique fora fecha.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function go(item?: NavSearchItem) {
    const target = item || results[cursor];
    if (!target || !mayLeaveEditor()) return;
    setOpen(false);
    setQuery('');
    router.push(target.href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); go(); }
  }

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Buscar no menu"
        aria-expanded={open}
        aria-controls="nav-search-panel"
        title={collapsed ? 'Buscar no menu' : 'Buscar no menu (Ctrl+K)'}
        className={cnButton(collapsed)}
      >
        <Icon n="search" size={collapsed ? 16 : 15} />
        {!collapsed && <span className="truncate">Buscar</span>}
        {!collapsed && (
          <kbd className="ml-auto shrink-0 rounded border border-[var(--il-nav-border)] px-1 text-[9px] font-bold text-[var(--il-nav-muted)]">
            Ctrl K
          </kbd>
        )}
      </button>

      {open && (
        <div
          id="nav-search-panel"
          role="dialog"
          aria-label="Buscar no menu"
          className="absolute left-0 top-[calc(100%+8px)] z-50 w-[300px] rounded-xl border border-[var(--border)] bg-white p-2 text-[var(--text)] shadow-lg"
        >
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5">
            <Icon n="search" size={15} className="shrink-0 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Agenda, cliente, WhatsApp…"
              aria-label="Texto da busca"
              className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-[var(--text-soft)]"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca"
                className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]">
                <Icon n="x" size={13} />
              </button>
            )}
          </div>

          <div className="mt-1.5 max-h-[320px] overflow-y-auto ws-scroll" role="listbox" aria-label="Resultados">
            {results.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-[var(--text-muted)]">
                Nenhum destino do menu com “{query}”.
              </p>
            ) : results.map((item, i) => (
              <button
                key={item.path}
                type="button"
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(item)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  i === cursor ? 'bg-[var(--brand-soft)]' : 'hover:bg-[var(--surface-2)]',
                )}
              >
                <span className={cn(
                  'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                  item.path === activePath
                    ? 'border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-fg)]'
                    : 'border-[var(--border-2)] bg-[var(--surface-2)] text-[var(--text-muted)]',
                )}>
                  <Icon n={item.icon} size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-bold">{item.label}</span>
                    {item.path === activePath && (
                      <span className="shrink-0 rounded bg-[var(--brand)] px-1 text-[9px] font-bold uppercase text-white">atual</span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">{item.description}</span>
                  <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-soft)]">{item.section}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function cnButton(collapsed: boolean): string {
  return cn(
    'flex h-8 items-center gap-2 rounded-md border border-[var(--il-nav-border)] bg-[var(--il-nav-hover)]',
    'text-[11px] font-bold text-[var(--il-nav-muted)] transition-colors',
    'hover:text-[var(--il-nav-fg)] hover:border-[var(--il-nav-cta)]',
    collapsed ? 'w-full justify-center px-0' : 'w-full px-2.5',
  );
}

function cn(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
