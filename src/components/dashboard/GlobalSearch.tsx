'use client';
// ═══════════════════════════════════════════════════════════════
// BUSCA GLOBAL — navegação + ENTIDADES (GODOUTOR final · FASE C)
// ═══════════════════════════════════════════════════════════════
// A busca da topbar agora acha de verdade, AGRUPADA:
//
//   Rotas        — nav.allowed (mesma fonte do menu: nada de destino
//                  proibido, computado no cliente, sem rede);
//   Pessoas      — nome, telefone ou e-mail → ficha 360;
//   Pacientes    — pets (clínicas veterinárias) → ficha do tutor;
//   Agendamentos — cliente/serviço → o dia na agenda;
//   Conversas    — nome/telefone/@ → a conversa aberta.
//
// As entidades vêm de /api/search (debounce + mínimo de caracteres), que
// decide NO SERVIDOR quais grupos existem por permissão. Aqui só entra o
// que o servidor mandou — a busca não revela o que a API não liberou.
//
// Teclado: Ctrl/⌘+K abre · ↑↓ navegam · Enter abre · ESC fecha. Um único
// focus ring (o do campo) — o painel de resultados nunca rouba o foco.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { mayLeaveEditor } from './useUnsavedChanges';
import { Icon } from '@/components/icons';
import { apiGet } from '@/lib/api-client';
import { searchNav, type NavSearchItem } from '@/lib/nav-search';
import {
  ENTITY_GROUP_LABELS, ENTITY_SEARCH_DEBOUNCE_MS, ENTITY_SEARCH_MIN_CHARS,
  groupEntityHits, type EntityHit,
} from '@/lib/entity-search';

export type { NavSearchItem } from '@/lib/nav-search';

type Section =
  | { kind: 'nav'; label: string; items: NavSearchItem[] }
  | { kind: 'entity'; label: string; items: EntityHit[] };

/** Item achatado para o cursor do teclado (rotas e entidades na mesma fila). */
type FlatItem = { kind: 'nav'; item: NavSearchItem } | { kind: 'entity'; item: EntityHit };

export function GlobalSearch({ items, activePath, businessId = '', compact = false }: {
  items: NavSearchItem[]; activePath: string; businessId?: string; compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [entities, setEntities] = useState<EntityHit[]>([]);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const navResults = useMemo(() => searchNav(items, query, activePath), [items, query, activePath]);

  // ── Entidades: debounce + mínimo de caracteres (nada de busca por 1 letra) ──
  useEffect(() => {
    const q = query.trim();
    if (!businessId || q.length < ENTITY_SEARCH_MIN_CHARS) { setEntities([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      apiGet<{ groups?: EntityHit[] }>(
        `/api/search?businessId=${encodeURIComponent(businessId)}&q=${encodeURIComponent(q)}`,
        { scope: 'area', area: 'Busca' },
      ).then((res) => {
        if (cancelled) return;
        setEntities(res.ok && Array.isArray(res.data?.groups) ? res.data!.groups! : []);
        setSearching(false);
      }).catch(() => { if (!cancelled) setSearching(false); });
    }, ENTITY_SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, businessId]);

  // Seções agrupadas: Rotas primeiro (ação mais barata), depois entidades.
  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    if (navResults.length > 0) out.push({ kind: 'nav', label: 'Rotas', items: navResults });
    for (const g of groupEntityHits(entities)) {
      out.push({ kind: 'entity', label: ENTITY_GROUP_LABELS[g.group], items: g.items });
    }
    return out;
  }, [navResults, entities]);

  const flat = useMemo<FlatItem[]>(
    () => sections.flatMap((s) => s.items.map((item) => (s.kind === 'nav'
      ? { kind: 'nav' as const, item: item as NavSearchItem }
      : { kind: 'entity' as const, item: item as EntityHit }))),
    [sections],
  );
  const total = flat.length;

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

  function goNav(item: NavSearchItem) {
    if (!mayLeaveEditor()) return;
    setOpen(false); setQuery(''); inputRef.current?.blur();
    router.push(item.href);
  }
  function goEntity(item: EntityHit) {
    if (!mayLeaveEditor()) return;
    setOpen(false); setQuery(''); inputRef.current?.blur();
    router.push(item.href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (query) { setQuery(''); return; }
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, total - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = flat[cursor];
      if (!target) return;
      if (target.kind === 'entity') goEntity(target.item); else goNav(target.item);
    }
  }

  let index = -1; // cursor global sobre as seções achatadas

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
          placeholder={compact ? 'Buscar…' : 'Buscar pacientes, agendamentos, conversas…'}
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
          {total === 0 ? (
            <p className="global-search__empty">
              {searching
                ? 'Buscando…'
                : query
                  ? (query.trim().length < ENTITY_SEARCH_MIN_CHARS
                      ? `Digite pelo menos ${ENTITY_SEARCH_MIN_CHARS} caracteres para buscar pessoas e atendimentos.`
                      : <>Nada encontrado com “{query}”.</>)
                  : 'Nenhum destino disponível.'}
            </p>
          ) : sections.map((section) => (
            <div key={section.label} className="global-search__group" role="group" aria-label={section.label}>
              <p className="global-search__group-label">{section.label}</p>
              {section.items.map((item) => {
                index += 1;
                const i = index;
                const isEntity = section.kind === 'entity';
                const icon = isEntity ? (item as EntityHit).icon : (item as NavSearchItem).icon;
                const title = isEntity ? (item as EntityHit).title : (item as NavSearchItem).label;
                const desc = isEntity ? (item as EntityHit).subtitle : (item as NavSearchItem).description;
                const key = isEntity ? `entity:${(item as EntityHit).id}` : `nav:${(item as NavSearchItem).path}`;
                const isCursor = i === cursor;
                return (
                  <button
                    key={`${section.label}:${key}`}
                    type="button"
                    role="option"
                    aria-selected={isCursor}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => (isEntity ? goEntity(item as EntityHit) : goNav(item as NavSearchItem))}
                    className={`global-search__option${isCursor ? ' is-cursor' : ''}`}
                    style={{ '--area-color': 'var(--brand)' } as React.CSSProperties}
                  >
                    <span className="global-search__option-icon">
                      <Icon n={icon} size={15} />
                    </span>
                    <span className="global-search__option-body">
                      <span className="global-search__option-title">{title}</span>
                      <span className="global-search__option-desc">{desc}</span>
                    </span>
                    <span className="global-search__option-section">{section.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
