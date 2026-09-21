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
describe('Direction correction — navigation behavior',()=>{
  it('exposes operational routes directly and only three group controls',()=>{
    setup();const main=screen.getByRole('navigation',{name:'Menu principal'});
    for(const name of ['Agenda','Profissionais','Disponibilidade','Clientes','Conversas']) expect(within(main).getByRole('link',{name})).toBeTruthy();
    expect(within(main).getAllByRole('button').map(b=>b.getAttribute('aria-label'))).toEqual(['Automação','Gestão','Ajustes']);
    expect(screen.queryByLabelText('Fechar submenu')).toBeNull();
  });
  it('toggles, replaces and closes the second column without collapsing primary navigation',async()=>{
    const u=userEvent.setup();const {onCollapse}=setup();
    await u.click(screen.getByRole('button',{name:'Gestão'}));expect(screen.getByRole('navigation',{name:'Gestão'})).toBeTruthy();
    await u.click(screen.getByRole('button',{name:'Ajustes'}));expect(screen.queryByRole('navigation',{name:'Gestão'})).toBeNull();
    await u.click(screen.getByRole('button',{name:'Ajustes'}));expect(screen.queryByRole('navigation',{name:'Ajustes'})).toBeNull();
    await u.click(screen.getByRole('button',{name:'Gestão'}));await u.click(screen.getByRole('button',{name:'Fechar submenu'}));
    expect(screen.queryByRole('navigation',{name:'Gestão'})).toBeNull();expect(onCollapse).not.toHaveBeenCalled();
  });
  it('opens deep linked groups and follows route changes/history',()=>{
    const {rerender,props}=setup({activePath:'/configuracoes'});expect(screen.getByRole('navigation',{name:'Ajustes'})).toBeTruthy();
    rerender(<WorkspaceNavigation {...props} activePath="/agenda"/>);expect(screen.queryByRole('navigation',{name:'Ajustes'})).toBeNull();
  });
  it('has original logo above a single identity selector',()=>{
    setup();const side=screen.getByRole('complementary',{name:'Navegação da clínica'});
    expect(side.querySelectorAll('img')).toHaveLength(1);expect(side.querySelector('img')?.getAttribute('src')).toBe(unit.logo);
    expect(within(side).getByRole('combobox',{name:'Trocar unidade'})).toBeTruthy();
  });
  it('only collapses on explicit button',async()=>{
    const u=userEvent.setup();const {onCollapse}=setup();await u.click(screen.getByRole('button',{name:'Recolher navegação'}));expect(onCollapse).toHaveBeenCalledOnce();
  });
  it('uses one mobile dialog with a back step instead of two columns',async()=>{
    const u=userEvent.setup();setup();await u.click(screen.getByRole('button',{name:'Abrir navegação'}));
    const dialog=screen.getByRole('dialog');await u.click(within(dialog).getByRole('button',{name:'Gestão'}));
    expect(within(dialog).getByRole('link',{name:'Equipe'})).toBeTruthy();expect(within(dialog).queryByRole('link',{name:'Agenda'})).toBeNull();
    await u.click(within(dialog).getByRole('button',{name:/Voltar/}));expect(within(dialog).getByRole('link',{name:'Agenda'})).toBeTruthy();
    await u.keyboard('{Escape}');expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('never introduces unauthorized routes or groups',()=>{
    setup({nav:panelNavigation({permissions:{agenda:true},modes:['bookings'],features:{}})});
    expect(screen.queryByRole('button',{name:'Gestão'})).toBeNull();expect(screen.queryByRole('link',{name:'Clientes'})).toBeNull();
  });
});
