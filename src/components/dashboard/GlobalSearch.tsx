'use client';
// ═══════════════════════════════════════════════════════════════
// BUSCA GLOBAL — GoDoutor UI Revolution · Etapa A
// ═══════════════════════════════════════════════════════════════
// A busca SAIU da sidebar e virou o centro da topbar (padrão de aplicação,
// referência conceitual Bitrix24). O que NÃO mudou é a regra:
//
//   • a fonte é `nav.allowed` — o MESMO cálculo de permissão que monta o menu.
//     Não existe lista paralela de telas: a busca não revela nem leva a destino
//     que o usuário não alcança;
//   • é busca de NAVEGAÇÃO (label + descrição), não de clientes/dados;
//   • o `?b=businessId` já vem resolvido no href.
//
// A lógica pura continua em lib/nav-search.ts (testada lá).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mayLeaveEditor } from './useUnsavedChanges';
import { Icon } from '@/components/icons';
import { searchNav, type NavSearchItem } from '@/lib/nav-search';

export type { NavSearchItem } from '@/lib/nav-search';

export function GlobalSearch({ items, activePath, compact = false }: {
  items: NavSearchItem[]; activePath: string; compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => searchNav(items, query, activePath), [items, query, activePath]);

  useEffect(() => { setCursor(0); }, [query, open]);

  // Ctrl/Cmd + K foca a busca global (atalho de aplicação).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Clique fora fecha o painel de resultados (o campo continua visível).
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
    inputRef.current?.blur();
    router.push(target.href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (query) { setQuery(''); return; }
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); go(); }
  }

  return (
    <div ref={boxRef} className="global-search">
      <div className="global-search__field">
        <Icon n="search" size={16} className="global-search__icon" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKey}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={compact ? 'Buscar…' : 'Buscar no sistema…'}
          aria-label="Busca global"
          className="global-search__input"
        />
        {query ? (
          <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            aria-label="Limpar busca" className="global-search__clear">
            <Icon n="x" size={13} />
          </button>
        ) : (
          <kbd className="global-search__kbd" aria-hidden="true">Ctrl K</kbd>
        )}
      </div>

      {open && (
        <div id="global-search-results" role="listbox" aria-label="Resultados da busca"
          className="global-search__panel">
          {results.length === 0 ? (
            <p className="global-search__empty">
              {query ? <>Nenhum destino com “{query}”.</> : 'Nenhum destino disponível.'}
            </p>
          ) : results.map((item, i) => (
            <button
              key={item.path}
              type="button"
              role="option"
              aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(item)}
              className={`global-search__option${i === cursor ? ' is-cursor' : ''}`}
              style={{ '--area-color': 'var(--brand)' } as React.CSSProperties}
            >
              <span className="global-search__option-icon">
                <Icon n={item.icon} size={15} />
              </span>
              <span className="global-search__option-body">
                <span className="global-search__option-title">
                  {item.label}
                  {item.path === activePath && <em className="global-search__here">atual</em>}
                </span>
                <span className="global-search__option-desc">{item.description}</span>
              </span>
              <span className="global-search__option-section">{item.section}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
