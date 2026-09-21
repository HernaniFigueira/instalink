'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Drawer } from '@/components/ui';
import { NavSearch } from './NavSearch';
import { workspaceAreas } from '@/lib/workspace-navigation';
import { buildNavSearchItems } from '@/lib/nav-search';
import type { panelNavigation } from '@/lib/panel';

type Unit = { id: string; name: string; logo?: string; slug: string; role?: string };
export function WorkspaceNavigation({ nav, activePath, unit, units, onUnit, collapsed, onCollapse, user, onLogout }: {
  nav: ReturnType<typeof panelNavigation>; activePath: string; unit: Unit; units: Unit[];
  onUnit: (id: string) => void; collapsed: boolean; onCollapse: () => void;
  user: { name: string }; onLogout: () => void;
}) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(false), [activePath, unit.id]);
  const areas = workspaceAreas(nav.allowed);
  const selected = areas.find(area => area.items.some(item => item.href === activePath)) || areas[0];
  const href = (item: { href: string; requiresBusiness?: boolean }) => item.requiresBusiness === false ? item.href : `${item.href}?b=${unit.id}`;
  const identity = <div className="workspace-identity">
    {unit.logo && <img src={unit.logo} alt="" className="workspace-logo" />}
    {units.length > 1 ? <label className="block"><span className="text-xs text-[var(--text-muted)]">Unidade em atendimento</span>
      <select aria-label="Trocar unidade" value={unit.id} onChange={e => onUnit(e.target.value)} className="il-field-control w-full mt-1 bg-transparent font-semibold rounded-md py-2">
        {units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label> : <p className="font-semibold text-sm mt-2 break-words">{unit.name}</p>}
  </div>;
  const contextLinks = (items: typeof nav.allowed) => items.map(item => <Link key={item.href} href={href(item)}
    data-nav-item={item.href} aria-current={activePath === item.href ? 'page' : undefined}
    onClick={() => setMobile(false)} title={item.description} className="workspace-link">
    <Icon n={item.icon} size={17} /><span>{item.label}</span>
  </Link>);
  return <>
    <aside className={`workspace-sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Navegação da clínica">
      {!collapsed && identity}
      <div className="workspace-tools">
        <NavSearch items={buildNavSearchItems(nav, `?b=${unit.id}`)} collapsed={collapsed} activePath={activePath} />
        <button type="button" aria-label={collapsed ? 'Expandir navegação' : 'Recolher navegação'} onClick={onCollapse} className="workspace-icon-button"><Icon n="menu" size={18} /></button>
      </div>
      <div className="workspace-levels">
        <nav aria-label="Áreas" className="workspace-primary">
          {areas.map(area => <Link key={area.id} href={href(area.id === selected?.id ? area.items.find(i => i.href === activePath) || area.items[0] : area.items[0])}
            aria-label={area.label} title={area.label} aria-current={area.id === selected?.id ? 'true' : undefined} className="workspace-area">
            <Icon n={area.icon} size={20} /><span>{area.short}</span>
          </Link>)}
        </nav>
        {!collapsed && selected && <nav aria-label={selected.label} className="workspace-context">
          <p className="workspace-context-title">{selected.label}</p>
          {contextLinks(selected.items)}
          {selected.id === 'care' && selected.items.some(i => i.href === '/agenda') && <p className="text-xs text-[var(--text-muted)] px-3 mt-4 leading-relaxed">A fila e os atendimentos estão na Agenda.</p>}
        </nav>}
      </div>
      <div className="workspace-account">
        {!collapsed && <><p className="text-xs font-semibold truncate">{user.name}</p><a className="text-xs underline text-[var(--text-muted)]" href={`/${unit.slug}`} target="_blank" rel="noreferrer">Página pública ↗</a></>}
        <button type="button" className="workspace-icon-button" aria-label="Sair da conta" onClick={onLogout}><Icon n="logout" size={17} /></button>
      </div>
    </aside>
    <header className="workspace-mobile">
      <div className="min-w-0"><p className="text-xs text-[var(--text-muted)] truncate">{unit.name}</p><p className="font-semibold text-sm">{nav.allowed.find(i => i.href === activePath)?.label || 'Minha clínica'}</p></div>
      <button type="button" onClick={() => setMobile(true)} className="workspace-icon-button" aria-label="Abrir navegação"><Icon n="menu" size={22} /></button>
    </header>
    <Drawer open={mobile} onClose={() => setMobile(false)} title="Navegar na clínica" width="max-w-[420px]">
      {identity}
      <nav aria-label="Todas as áreas" className="p-4 space-y-5">{areas.map(area => <section key={area.id}><h3 className="text-xs font-semibold text-[var(--text-muted)] mb-2">{area.label}</h3>{contextLinks(area.items)}</section>)}</nav>
      <div className="p-4 border-t border-[var(--border)]"><p className="text-sm mb-3">{user.name}</p><button type="button" className="workspace-link" onClick={onLogout}>Sair da conta</button></div>
    </Drawer>
  </>;
}
