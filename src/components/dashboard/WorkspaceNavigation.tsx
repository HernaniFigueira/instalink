'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Drawer } from '@/components/ui';
import { NavSearch } from './NavSearch';
import { workspaceAreas, routeAreaColor } from '@/lib/workspace-navigation';
import { buildNavSearchItems } from '@/lib/nav-search';
import type { panelNavigation } from '@/lib/panel';

type Unit = { id: string; name: string; logo?: string; slug: string; role?: string; organizationId?: string };
export function WorkspaceNavigation({ nav, activePath, unit, units, onUnit, collapsed, onCollapse, user, onLogout, overview = false }: {
  nav: ReturnType<typeof panelNavigation>; activePath: string; unit: Unit; units: Unit[];
  onUnit: (id: string) => void; collapsed: boolean; onCollapse: () => void;
  user: { name: string }; onLogout: () => void; overview?: boolean;
}) {
  const areas = workspaceAreas(nav.allowed);
  const groups = areas.filter(a => a.id !== 'operations');
  const activeGroup = groups.find(g => g.items.some(i => i.href === activePath))?.id || null;
  const [opened, setOpened] = useState<string | null>(activeGroup);
  const [mobile, setMobile] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);
  useEffect(() => { setOpened(activeGroup); setMobile(false); setMobileGroup(null); }, [activePath, unit.id, activeGroup]);
  useEffect(() => {
    const media = window.matchMedia?.('(min-width:1200px)');
    const close = () => { if (media?.matches) setMobile(false); };
    media?.addEventListener('change', close); return () => media?.removeEventListener('change', close);
  }, []);
  const selected = groups.find(g => g.id === opened);
  const mobileSelected = groups.find(g => g.id === mobileGroup);
  const href = (item: typeof nav.allowed[number]) => item.href === '/organizacao' ? `/organizacao?organization=${unit.organizationId || ''}` : item.requiresBusiness === false ? item.href : `${item.href}?b=${unit.id}`;
  const canOverview = nav.allowed.some(i => i.href === '/organizacao');
  const identity = <div className="workspace-identity">
    {unit.logo && <img src={unit.logo} alt="" className="workspace-logo" />}
    <label className="block"><span className="sr-only">Contexto da clínica</span>
      <select aria-label="Trocar unidade" value={overview ? '__overview' : unit.id} onChange={e => onUnit(e.target.value)} className="il-field-control w-full mt-2 bg-transparent font-semibold py-2" title={unit.name}>
        {canOverview && <option value="__overview">Visão geral da organização</option>}
        {units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
  </div>;
  const links = (items: typeof nav.allowed, primary = false) => items.map(item => <Link key={item.href} href={href(item)}
    data-nav-item={item.href} aria-label={item.label} aria-current={activePath === item.href ? 'page' : undefined}
    onClick={() => { setMobile(false); if (primary) setOpened(null); }} title={item.description} className="workspace-link">
    <span style={{color: routeAreaColor(item.href)}}><Icon n={item.icon} size={20} /></span><span className="workspace-label">{item.label}</span>
  </Link>);
  const groupButtons = (onSelect: (id: string) => void, current: string | null) => groups.map(group => <button key={group.id} type="button" className="workspace-link w-full text-left" aria-label={group.label} aria-expanded={current === group.id} onClick={e => { e.currentTarget.closest('dialog')?.querySelector<HTMLElement>('h2')?.focus(); onSelect(group.id); }}>
    <span style={{color:group.color}}><Icon n={group.icon} size={20} /></span><span className="workspace-label">{group.label}</span><span aria-hidden="true" className="ml-auto workspace-label">›</span>
  </button>);
  const operations = areas.find(a => a.id === 'operations')?.items || [];
  return <>
    <aside className={`workspace-sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Navegação da clínica">
      {!collapsed && identity}
      <div className="workspace-tools"><NavSearch items={buildNavSearchItems(nav, `?b=${unit.id}`)} collapsed={collapsed} activePath={activePath} />
        <button type="button" aria-label={collapsed ? 'Expandir navegação' : 'Recolher navegação'} onClick={onCollapse} className="workspace-icon-button"><Icon n="menu" size={20} /></button>
      </div>
      <nav aria-label="Menu principal" className="workspace-primary">{links(operations,true)}{groupButtons(id => setOpened(opened === id ? null : id), opened)}</nav>
      <div className="workspace-account">{!collapsed && <><p className="font-semibold truncate">{user.name}</p><a className="text-sm underline" href={`/${unit.slug}`} target="_blank" rel="noreferrer">Página pública ↗</a></>}
        <button type="button" className="workspace-icon-button" aria-label="Sair da conta" onClick={onLogout}><Icon n="logout" size={20} /></button>
      </div>
    </aside>
    {selected && <aside className="workspace-secondary" aria-label={`Submenu ${selected.label}`}>
      <header><h2>{selected.label}</h2><button type="button" className="workspace-icon-button" aria-label="Fechar submenu" onClick={() => setOpened(null)}><Icon n="x" size={20}/></button></header>
      <nav aria-label={selected.label}>{links(selected.items)}</nav>
    </aside>}
    <header className="workspace-mobile"><p className="font-semibold">{nav.allowed.find(i => i.href === activePath)?.label || 'Minha clínica'}</p><button type="button" onClick={() => {setMobile(true);setMobileGroup(activeGroup);}} className="workspace-icon-button" aria-label="Abrir navegação"><Icon n="menu" size={20}/></button></header>
    <Drawer open={mobile} onClose={() => setMobile(false)} title={mobileSelected?.label || 'Navegar na clínica'} width="max-w-[420px]">
      {mobileSelected ? <div className="p-3"><button type="button" className="workspace-link" onClick={e => { e.currentTarget.closest('dialog')?.querySelector<HTMLElement>('h2')?.focus(); setMobileGroup(null); }}>← Voltar</button><nav aria-label={mobileSelected.label}>{links(mobileSelected.items)}</nav></div> : <>{identity}<nav aria-label="Menu móvel" className="p-3">{links(operations,true)}{groupButtons(setMobileGroup,mobileGroup)}</nav></>}
      <div className="workspace-account"><p className="font-semibold truncate">{user.name}</p>{unit.slug&&<a className="text-sm underline" href={`/${unit.slug}`} target="_blank" rel="noreferrer">Página pública ↗</a>}<button type="button" className="workspace-link" onClick={onLogout}><Icon n="logout" size={20}/>Sair da conta</button></div>
    </Drawer>
  </>;
}
