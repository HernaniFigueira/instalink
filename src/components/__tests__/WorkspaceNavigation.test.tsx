// @vitest-environment jsdom
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceNavigation } from '../dashboard/WorkspaceNavigation';
import { panelNavigation } from '@/lib/panel';
const {push}=vi.hoisted(()=>({push:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push})}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
beforeAll(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
const unit={id:'one',name:'Clínica sintética',logo:'/demo/clinic.svg',slug:'demo-one'};
const nav=panelNavigation({permissions:{dashboard:true,agenda:true,clientes:true,leads:true,catalogo:true,pagina:true,equipe:true,financeiro:true,config:true,agente:true,campanhas:true,whatsapp:true,pedidos:true},modes:['services','bookings'],features:{}});
function setup(overrides:any={}) {
  const callbacks={onUnit:vi.fn(),onCollapse:vi.fn(),onLogout:vi.fn()};
  const props={nav,activePath:'/agenda',unit,units:[unit],collapsed:false,user:{name:'Equipe demonstrativa'},...callbacks,...overrides};
  const view=render(<WorkspaceNavigation {...props}/>);return {...view,...callbacks,props};
}
describe('D360 workspace — behavior replaces retired sidebar CSS assertions',()=>{
  it('projects seven authorized areas with a contextual current-page link',()=>{
    setup();expect(within(screen.getByRole('navigation',{name:'Áreas'})).getAllByRole('link')).toHaveLength(7);
    const context=screen.getByRole('navigation',{name:'Atendimento'});
    expect(within(context).getByRole('link',{name:'Agenda'}).getAttribute('aria-current')).toBe('page');
    expect(within(context).queryByRole('link',{name:'Resultados'})).toBeNull();
  });
  it('renders original logo once above identity and search, without a repeated clinic heading',()=>{
    const {container}=setup();const sidebar=screen.getByRole('complementary');const image=sidebar.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(unit.logo);expect(sidebar.querySelectorAll('img')).toHaveLength(1);
    const name=within(sidebar).getByText(unit.name);const search=within(sidebar).getByRole('button',{name:'Buscar no menu'});
    expect(image.compareDocumentPosition(name)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.compareDocumentPosition(search)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('canvas')).toBeNull();
  });
  it('keeps public clinic access separate from identity',()=>{
    setup();const sidebar=screen.getByRole('complementary');const link=within(sidebar).getByRole('link',{name:'Página pública ↗'});
    expect(link.getAttribute('href')).toBe('/demo-one');expect(link.getAttribute('target')).toBe('_blank');
    expect(link.compareDocumentPosition(within(sidebar).getByText(unit.name))&Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
  it('collapses using a labelled control and keeps all authorized areas reachable',async()=>{
    const user=userEvent.setup();const {rerender,props,onCollapse}=setup();await user.click(screen.getByRole('button',{name:'Recolher navegação'}));expect(onCollapse).toHaveBeenCalledOnce();
    rerender(<WorkspaceNavigation {...props} collapsed/>);expect(screen.getByRole('button',{name:'Expandir navegação'})).toBeTruthy();
    expect(within(screen.getByRole('navigation',{name:'Áreas'})).getAllByRole('link')).toHaveLength(7);
    expect(screen.queryByRole('navigation',{name:'Atendimento'})).toBeNull();
  });
  it('unit selector emits only the selected ID, not a patient or booking context',async()=>{
    const user=userEvent.setup();const {onUnit}=setup({units:[unit,{...unit,id:'two',name:'Outra unidade'}]});
    await user.selectOptions(screen.getByRole('combobox',{name:'Trocar unidade'}),'two');expect(onUnit).toHaveBeenCalledExactlyOnceWith('two');
    expect(screen.queryByText(unit.name,{selector:'p.font-semibold'})).toBeNull();
  });
  it('mobile has one complete menu including contextual execution and settings routes',async()=>{
    const user=userEvent.setup();setup();await user.click(screen.getByRole('button',{name:'Abrir navegação'}));
    const menu=screen.getByRole('dialog',{name:'Navegar na clínica'});
    expect(within(menu).getAllByRole('link').map(a=>a.getAttribute('data-nav-item')).sort()).toEqual(nav.allowed.map(i=>i.href).sort());
    expect(within(menu).getByRole('link',{name:'Execuções'}).getAttribute('href')).toContain('b=one');
    await user.click(within(menu).getByRole('button',{name:'Fechar'}));expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not invent areas or expose unauthorized search results',async()=>{
    const user=userEvent.setup();setup({nav:panelNavigation({permissions:{agenda:true},modes:['services','bookings'],features:{}})});
    expect(screen.queryByRole('link',{name:'Página da clínica'})).toBeNull();expect(screen.queryByRole('link',{name:'Gestão'})).toBeNull();
    await user.click(screen.getByRole('button',{name:'Buscar no menu'}));await user.type(screen.getByLabelText('Texto da busca'),'Resultados');
    expect(screen.queryByRole('option')).toBeNull();expect(screen.getByText(/Nenhum destino/)).toBeTruthy();
  });
  it('search keyboard opens an authorized route in the same unit',async()=>{
    const user=userEvent.setup();setup();await user.click(screen.getByRole('button',{name:'Buscar no menu'}));
    await user.type(screen.getByLabelText('Texto da busca'),'Agenda{Enter}');expect(push).toHaveBeenCalledWith('/agenda?b=one');
  });
  it('selection follows the new route rather than keeping the previous secondary area',()=>{
    const {props,rerender}=setup();rerender(<WorkspaceNavigation {...props} activePath="/servicos"/>);
    const context=screen.getByRole('navigation',{name:'Gestão'});expect(within(context).getByRole('link',{name:'Serviços'}).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('navigation',{name:'Atendimento'})).toBeNull();
  });
  it('empty permissions produce no destinations, not privileged fallback links',()=>{
    setup({nav:panelNavigation({permissions:{},modes:['services','bookings'],features:{}})});
    expect(within(screen.getByRole('navigation',{name:'Áreas'})).queryAllByRole('link')).toHaveLength(0);
  });
});
