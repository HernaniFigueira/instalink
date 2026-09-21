'use client';
import { useEffect, useState, useRef } from 'react';
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
  const account = useRef<HTMLDetailsElement>(null);
  const [opened, setOpened] = useState<string | null>(activeGroup);
  const [mobile, setMobile] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);
  useEffect(() => { setOpened(activeGroup); setMobile(false); setMobileGroup(null); if(account.current)account.current.open=false; }, [activePath, unit.id, activeGroup]);
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
  const label = (item: typeof nav.allowed[number]) => item.href === '/clientes' ? 'Pacientes' : item.href === '/organizacao' ? 'Visão geral' : item.label;
  const links = (items: typeof nav.allowed, primary = false) => items.map(item => <span key={item.href} className="contents"><Link href={href(item)}
    data-nav-item={item.href} aria-label={label(item)} aria-current={activePath === item.href ? 'page' : undefined}
    onClick={() => { setMobile(false); if (primary) setOpened(null); }} title={item.description} className="workspace-link">
    <span style={{color: routeAreaColor(item.href)}}><Icon n={item.icon} size={20} /></span><span className="workspace-label">{label(item)}</span>
  </Link>{primary && item.href==='/agenda' && <Link className="workspace-link" aria-label="Fila de atendimento" href={`/agenda?b=${unit.id}&fila=1`} onClick={()=>{setMobile(false);setOpened(null);window.dispatchEvent(new CustomEvent('il:queue-open',{detail:unit.id}));}}><span style={{color:routeAreaColor('/agenda')}}><Icon n="clock" size={20}/></span><span className="workspace-label">Fila de atendimento</span></Link>}</span>);
  const groupButtons = (onSelect: (id: string) => void, current: string | null) => groups.map(group => <button key={group.id} type="button" className="workspace-link w-full text-left" aria-label={group.label} aria-expanded={current === group.id} onClick={e => { e.currentTarget.closest('dialog')?.querySelector<HTMLElement>('h2')?.focus(); onSelect(group.id); }}>
    <span style={{color:group.color}}><Icon n={group.icon} size={20} /></span><span className="workspace-label">{group.label}</span><span aria-hidden="true" className="ml-auto workspace-label">›</span>
  </button>);
  const operations = areas.find(a => a.id === 'operations')?.items || [];
  return <>
    <aside className={`workspace-sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Navegação da clínica">
      {!collapsed && identity}
      {collapsed&&<button type="button" className="workspace-icon-button" aria-label="Selecionar organização ou filial" title="Selecionar organização ou filial" onClick={onCollapse}><Icon n="home" size={20}/></button>}
      <nav aria-label="Menu principal" className="workspace-primary">{links(operations,true)}{groupButtons(id => setOpened(opened === id ? null : id), opened)}</nav>
    </aside>
    {selected && <aside className="workspace-secondary" aria-label={`Submenu ${selected.label}`}>
      <header><h2>{selected.label}</h2><button type="button" className="workspace-icon-button" aria-label="Fechar submenu" onClick={() => setOpened(null)}><Icon n="x" size={20}/></button></header>
      <nav aria-label={selected.label}>{links(selected.items)}</nav>
    </aside>}
    <header className="workspace-topbar">
      <div className="topbar-location">
        <button type="button" className="workspace-icon-button topbar-collapse" aria-label={collapsed?'Expandir menu':'Recolher menu'} title={collapsed?'Expandir menu':'Recolher menu'} onClick={onCollapse}><Icon n={collapsed?'panelOpen':'panelClose'} size={20}/></button>
        <button type="button" className="workspace-icon-button topbar-mobile" aria-label="Abrir navegação" onClick={()=>{setMobile(true);setMobileGroup(activeGroup);}}><Icon n="menu" size={20}/></button>
        <nav aria-label="Caminho" className="topbar-breadcrumb"><span>Clínica</span><span aria-hidden="true">/</span><span aria-current="page">{nav.allowed.find(i=>i.href===activePath)?.label||'Visão geral'}</span></nav>
      </div>
      <div className="topbar-search"><NavSearch items={buildNavSearchItems(nav,`?b=${unit.id}`)} collapsed={false} activePath={activePath}/></div>
      <details ref={account} className="topbar-account" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))e.currentTarget.open=false;}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}>
        <summary aria-label="Menu da conta"><Icon n="user" size={20}/><span className="topbar-user"><strong>{user.name}</strong><span>{({OWNER:'Proprietário',ADMIN:'Administrador',SECRETARIA:'Secretária',PROFISSIONAL:'Profissional',VIEWER:'Visualizador',ATENDENTE:'Atendente',VENDEDOR:'Vendedor',MASTER:'Suporte'} as Record<string,string>)[unit.role||'']||'Equipe'}</span></span><Icon n="chevD" size={16}/></summary>
        <nav aria-label="Conta" className="topbar-account-menu">{unit.slug&&<a className="workspace-link" href={`/${unit.slug}`} target="_blank" rel="noreferrer">Página pública ↗</a>}<button className="workspace-link w-full" onClick={onLogout}><Icon n="logout" size={20}/>Sair da conta</button></nav>
      </details>
    </header>
    <Drawer open={mobile} onClose={() => setMobile(false)} title={mobileSelected?.label || 'Navegar na clínica'} width="max-w-[420px]">
      {mobileSelected ? <div className="p-3"><button type="button" className="workspace-link" onClick={e => { e.currentTarget.closest('dialog')?.querySelector<HTMLElement>('h2')?.focus(); setMobileGroup(null); }}>← Voltar</button><nav aria-label={mobileSelected.label}>{links(mobileSelected.items)}</nav></div> : <>{identity}<nav aria-label="Menu móvel" className="p-3">{links(operations,true)}{groupButtons(setMobileGroup,mobileGroup)}</nav></>}
    </Drawer>
  </>;
}
