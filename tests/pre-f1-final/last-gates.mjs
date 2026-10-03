// Real mouse/keyboard/persistence QA. ONLY the disposable local production server.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
if(process.env.DATABASE_URL) throw Error('Remote DB forbidden');
const base='http://127.0.0.1:3000',b='andrioni-vet-qa',dir=process.env.QA_EVIDENCE_DIR||'.cache/pre-f1-final/last-gates';
await fs.mkdir(dir,{recursive:true});
const {default:c}=await import(process.env.QA_CHROMIUM_MODULE);
const browser=await chromium.launch({executablePath:await c.executablePath(),args:c.args.filter(x=>x!=='--single-process'),ignoreDefaultArgs:['--hide-scrollbars'],headless:true});
const report={head:execSync('git rev-parse HEAD').toString().trim(),checks:[],failures:[],console:[],network:[],screens:[],buttons:[],rawButtons:[],copy:[]};
const ok=s=>{report.checks.push(s);console.log('PASS',s);};
async function test(n,fn){if(process.env.QA_ONLY&&!n.includes(process.env.QA_ONLY))return;try{await fn();ok(n);}catch(e){report.failures.push({name:n,error:String(e),stack:e.stack});console.error('FAIL',n,String(e));await shot(p,'failure-'+n.replace(/\W/g,'-')).catch(()=>{});}}
async function shot(p,n){await p.screenshot({path:`${dir}/${n}.png`});report.screens.push(n+'.png');}
async function login(role){const ctx=await browser.newContext({viewport:{width:1440,height:1100},locale:'pt-BR'}),p=await ctx.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>report.console.push(String(e)));p.on('console',e=>{if(e.type()==='error')report.console.push(e.text());});p.on('response',r=>{if(r.status()>=400)report.network.push({status:r.status(),url:r.url()});});await p.goto(base+'/login');await p.locator('[type=email]').fill(role+'.qa@godoutor.local');await p.locator('[type=password]').fill('GodoutorQA2026!');await p.getByRole('button',{name:'Entrar',exact:true}).click();await p.waitForURL(/agenda|dashboard/);ok('Login '+role);return p;}
async function go(p,path){await p.goto(`${base}/${path}${path.includes('?')?'&':'?'}b=${b}`);}
async function agenda(p,view='day',date='2026-11-16'){await go(p,`agenda?data=${date}&view=${view}`);await p.locator('[data-agenda-column]').first().waitFor();}
async function drag(p,pro,start,end){const col=p.locator(`[data-agenda-column-professional="${pro}"]`);const box=await col.boundingBox();await p.mouse.move(box.x+50,box.y+(start-480)*128/60);await p.mouse.down();await p.mouse.move(box.x+50,box.y+(end-480)*128/60,{steps:25});await p.mouse.up();}
async function api(p,path){return p.evaluate(async u=>{const r=await fetch(u);if(!r.ok)throw Error(String(r.status));return r.json();},path);}
async function editMichelle(p){await go(p,'equipe');await p.locator('div.px-4.py-3').filter({has:p.getByText('Michelle',{exact:true})}).getByRole('button',{name:'GERENCIAR',exact:true}).click();await p.getByRole('heading',{name:'Gerenciar pessoa',exact:true}).waitFor();}
async function editService(p,name){await go(p,'servicos');await p.getByText(name,{exact:true}).locator('xpath=ancestor::div[.//button[normalize-space()="Editar"]][1]').getByRole('button',{name:'Editar',exact:true}).click();await p.getByRole('heading',{name:'Editar serviço',exact:true}).waitFor();}
const p=await login('owner');
try{
 await test('range all columns 1440 1280 1024 mobile',async()=>{
  for(const width of [1440,1280,1024]){
   await p.setViewportSize({width,height:1100});
   for(const pro of ['pro-orlando','pro-michele','pro-hernani']){
    await agenda(p);await drag(p,pro,555,765);await p.getByRole('heading',{name:'Novo agendamento',exact:true}).waitFor();
    const range=p.getByTestId('agenda-selected-range');await range.waitFor();await p.waitForTimeout(250);
    const r=await range.boundingBox(),sheet=await p.locator('.gd-booking-range-drawer .il-drawer__strip').boundingBox();
    assert.ok(r.width>100&&r.x>=0&&r.x+r.width<sheet.x,JSON.stringify({width,pro,r,sheet}));assert.match(await range.innerText(),/09:15–12:45/);
    assert.equal(await p.locator('.ag-mode-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await shot(p,`range-${width}-${pro}`);
   }
  }
  await p.setViewportSize({width:390,height:844});await p.getByTestId('booking-range-summary').waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot(p,'range-mobile-form');
 });
 await test('empty professional warning save reload no linkage',async()=>{
  await p.setViewportSize({width:1440,height:1100});await go(p,'equipe');await p.getByRole('button',{name:'Adicionar pessoa',exact:true}).click();await p.locator('#pessoa-nome').fill('Profissional Sem Serviço QA');await p.getByRole('checkbox',{name:/Realiza atendimentos/}).check();await p.getByText(/Este profissional será criado sem procedimentos habilitados/).waitFor();await shot(p,'empty-pro-warning');await p.getByRole('button',{name:'Adicionar pessoa',exact:true}).last().click();await p.getByRole('heading',{name:'Adicionar pessoa',exact:true}).waitFor({state:'hidden'});await p.reload();const row=p.locator('div.px-4.py-3').filter({has:p.getByText('Profissional Sem Serviço QA',{exact:true})});await row.getByRole('button',{name:'GERENCIAR',exact:true}).click();assert.equal(await p.locator('label').filter({hasText:'Consulta clínica'}).locator('input[type=checkbox]').isChecked(),false);await shot(p,'empty-pro-reopened');const cat=await api(p,`/api/catalog/get?businessId=${b}`);const pro=cat.professionals.find(x=>x.name==='Profissional Sem Serviço QA');assert.ok(pro);assert.ok(!('serviceIds' in pro));assert.ok(cat.services.every(s=>s.professionalMode==='selected'&&!s.professionalIds.includes(pro.id)));await agenda(p);await drag(p,pro.id,660,690);await p.getByLabel('2. Serviço',{exact:false}).selectOption('svc-consulta');await p.getByText(/Profissional Sem Serviço QA não realiza este serviço/).waitFor();await shot(p,'empty-pro-no-appointment');
 });
 await test('team to service add remove reload canonical',async()=>{
  // Dermatology already links only Michelle from the previously passed flow.
  // Vacinação: explicitly remove then add to exercise both changes, never a parallel field.
  await editMichelle(p);const c=p.getByLabel('Vacinação',{exact:false});await c.uncheck();await p.getByRole('button',{name:'Salvar alterações',exact:true}).click();await p.getByRole('heading',{name:'Gerenciar pessoa',exact:true}).waitFor({state:'hidden'});await p.reload();await editService(p,'Vacinação');assert.match(await p.getByRole('button',{name:'Michelle',exact:true}).getAttribute('class'),/border-zinc-200/);await shot(p,'link-removed-service');
  await editMichelle(p);await p.getByLabel('Vacinação',{exact:false}).check();await p.getByRole('button',{name:'Salvar alterações',exact:true}).click();await p.getByRole('heading',{name:'Gerenciar pessoa',exact:true}).waitFor({state:'hidden'});await p.reload();await editService(p,'Vacinação');assert.match(await p.getByRole('button',{name:'Michelle',exact:true}).getAttribute('class'),/bg-emerald-50/);await shot(p,'link-added-service');
  await editMichelle(p);assert.equal(await p.getByLabel('Vacinação',{exact:false}).isChecked(),true);await p.getByLabel('Vacinação',{exact:false}).uncheck();await p.getByRole('button',{name:'Salvar alterações',exact:true}).click();await p.getByRole('heading',{name:'Gerenciar pessoa',exact:true}).waitFor({state:'hidden'});await p.reload();await editService(p,'Vacinação');assert.match(await p.getByRole('button',{name:'Michelle',exact:true}).getAttribute('class'),/border-zinc-200/);await shot(p,'link-removed-after-f5');const cat=await api(p,`/api/catalog/get?businessId=${b}`);assert.equal(cat.services.find(s=>s.id==='svc-vacina').professionalIds.includes('pro-michele'),false);assert.ok(cat.professionals.every(x=>!('serviceIds' in x)));
 });
 await test('dirty real sidebar navigation and browser back',async()=>{
  async function draft(){await p.getByRole('button',{name:'Adicionar pessoa',exact:true}).click();await p.locator('#pessoa-nome').fill('Ana Navegação QA');await p.locator('#pessoa-email').fill('ana.navegacao.qa@godoutor.local');await p.locator('#pessoa-telefone').fill('88888888888');await p.getByRole('checkbox',{name:/Tem acesso/}).check();assert.equal(await p.getByRole('button',{name:/^Recepção/}).getAttribute('aria-pressed'),'true');}
  await go(p,'clientes');if(await p.locator('.workspace-sidebar').getByRole('button',{name:'Clínica',exact:true}).getAttribute('aria-expanded')!=='true')await p.locator('.workspace-sidebar').getByRole('button',{name:'Clínica',exact:true}).click();await p.locator('.workspace-sidebar a[href*="/equipe"]').click();await p.waitForURL(/\/equipe/);await draft();await p.locator('.workspace-sidebar a[href*="/clientes"]').click();await p.getByRole('heading',{name:'Descartar alterações?',exact:true}).waitFor();await shot(p,'draft-navigation-guard');await p.getByRole('button',{name:'Continuar editando',exact:true}).click();assert.match(p.url(),/\/equipe/);assert.equal(await p.locator('#pessoa-nome').inputValue(),'Ana Navegação QA');assert.equal(await p.locator('#pessoa-email').inputValue(),'ana.navegacao.qa@godoutor.local');assert.equal((await p.locator('#pessoa-telefone').inputValue()).replace(/\D/g,''),'88888888888');await shot(p,'draft-navigation-continue');await p.locator('.workspace-sidebar a[href*="/clientes"]').click();await p.getByRole('button',{name:'Descartar',exact:true}).click();await p.waitForURL(/\/clientes/);
  await p.locator('.workspace-sidebar a[href*="/equipe"]').click();await p.waitForURL(/\/equipe/);await draft();await p.goBack({timeout:1500}).catch(()=>{});await p.getByRole('heading',{name:'Descartar alterações?',exact:true}).waitFor();await p.getByRole('button',{name:'Continuar editando',exact:true}).click();assert.match(p.url(),/\/equipe/);assert.equal(await p.locator('#pessoa-nome').inputValue(),'Ana Navegação QA');await p.goBack({timeout:1500}).catch(()=>{});await p.getByRole('button',{name:'Descartar',exact:true}).click();await p.waitForURL(/\/clientes/);await shot(p,'draft-back-discarded');
 });
 await test('clinic and resource blocks day week exact labels',async()=>{
  await go(p,'configuracoes?tab=agenda');await p.getByLabel('Nome do recurso').fill('Sala Cirúrgica QA');await p.getByRole('button',{name:'Adicionar recurso',exact:true}).click();await p.getByText('Sala Cirúrgica QA · Sala',{exact:true}).waitFor();await p.reload();await p.getByText('Sala Cirúrgica QA · Sala',{exact:true}).waitFor();
  for(const [scope,reason,start,end] of [['business','Reunião da equipe','14:00','15:30'],['resource','Manutenção','10:00','12:00']]){
   await agenda(p,'day','2026-11-23');await p.getByRole('button',{name:'Bloquear horário',exact:true}).click();await drag(p,'pro-hernani',600,660);await p.getByLabel(/^Escopo/).selectOption(scope);await p.getByLabel('Início',{exact:true}).fill(start);await p.getByLabel('Fim',{exact:true}).fill(end);if(scope==='resource')await p.getByLabel(/^Recurso/).selectOption({label:'Sala Cirúrgica QA'});await p.getByLabel('Motivo (opcional)',{exact:true}).fill(reason);await p.getByRole('button',{name:'Criar bloqueio',exact:true}).click();await p.getByRole('heading',{name:'Bloquear horário',exact:true}).waitFor({state:'hidden'});await p.reload();
   for(const view of ['day','week']){await agenda(p,view,'2026-11-23');const block=p.locator('[data-schedule-block]').filter({hasText:reason}).first();await block.waitFor();const text=await block.innerText();for(const s of [start+'–'+end,'BLOQUEIO',reason,scope==='business'?'Clínica':'Sala Cirúrgica QA'])assert.ok(text.includes(s),text);await block.scrollIntoViewIfNeeded();await shot(p,`block-${scope}-${view}`);}
  }
 });
 await test('buttons normal hover seven pages both themes and copy sweep',async()=>{
  for(const theme of ['azul-profundo','verde-equilibrado']){
   await go(p,'configuracoes?tab=aparencia');await p.getByTestId('nav-accent-'+theme).click();await p.waitForFunction(t=>localStorage.getItem('godoutor.nav-accent')===t,theme);await p.reload();await p.waitForFunction(t=>document.querySelector(`[data-testid="nav-accent-${t}"]`)?.getAttribute('aria-pressed')==='true',theme);
   for(const route of ['agenda?data=2026-11-16','clientes','clientes/qa-tutor','servicos','equipe','configuracoes?tab=agenda','perfil']){
    // Contact360 route uses the canonical people360 key from the actual row.
    if(route==='clientes/qa-tutor'){await go(p,'clientes');await p.getByText('Ana Tutora QA',{exact:true}).first().click();await p.getByRole('link',{name:'WhatsApp',exact:true}).waitFor();}else await go(p,route);
    await p.waitForTimeout(450);const body=await p.locator('body').innerText();const bad=body.match(/página pública|captadas na página|interesses da página|link na bio|\bloja\b|\bprodutos?\b|\bpedidos?\b|promoções|sua página|cadastros na página/ig)||[];report.copy.push({route,theme,bad});assert.deepEqual(bad,[]);
    report.rawButtons.push({route,theme,items:await p.locator('.workspace-main-col button:not(.il-control),.workspace-main-col a:not(.il-control)').evaluateAll(els=>els.filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>({label:e.innerText||e.getAttribute('aria-label'),role:e.getAttribute('role'),class:e.className})))});
    const controls=p.locator('button.il-control,a.il-control');let audited=0,hoverShot=false;
    for(let i=0;i<await controls.count();i++){
     const el=controls.nth(i);if(!await el.isVisible()||!await el.isEnabled())continue;const cls=await el.getAttribute('class');const secondary=cls.includes('border-[var(--brand)]'),wa=cls.includes('bg-emerald-50')&&cls.includes('text-emerald-800'),primary=cls.includes('bg-[var(--accent)]');if(!secondary&&!wa&&!primary)continue;
     await p.mouse.move(0,0);await p.waitForTimeout(180);const normal=await el.evaluate(e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,border:s.borderTopColor,width:s.borderTopWidth,color:s.color};});await el.hover();await p.waitForTimeout(180);const hover=await el.evaluate(e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,border:s.borderTopColor,width:s.borderTopWidth,color:s.color};});assert.notEqual(normal.bg,'rgba(0, 0, 0, 0)');assert.notEqual(normal.width,'0px');if(secondary||wa){assert.equal(hover.border,normal.border);assert.equal(hover.width,normal.width);assert.equal(hover.bg,'rgba(0, 0, 0, 0)');}else assert.notEqual(hover.bg,'rgba(0, 0, 0, 0)');if(wa)assert.equal(normal.bg,'rgb(240, 253, 244)');if(!hoverShot&&secondary){await shot(p,`hover-${route.replace(/\W/g,'-')}-${theme}`);hoverShot=true;}report.buttons.push({route,theme,label:await el.innerText(),normal,hover});audited++;
    }
    assert.ok(audited>0,route);await p.mouse.move(0,0);await shot(p,`buttons-${route.replace(/\W/g,'-')}-${theme}`);
   }
  }
 });
 await test('full active copy sweep including campaigns sources help and empty clients',async()=>{
  const paths=['dashboard','estrutura','disponibilidade','agente','tarefas','funil','campanhas','automacoes','followup','canais','canais?tab=fontes','resultados','financeiro','recursos','execucoes','configuracoes?tab=aparencia'];
  for(const route of paths){await go(p,route);await p.waitForTimeout(600);const body=(await p.locator('body').innerText()).replace(/padrão do produto/gi,'padrão do sistema');const bad=body.match(/página pública|captadas na página|interesses da página|link na bio|\bloja\b|\bprodutos\b|\bpedidos\b|promoç[õã]|sua página|cadastros na página/ig)||[];report.copy.push({route,bad});assert.deepEqual(bad,[],route);}
  await go(p,'clientes');await p.getByPlaceholder('Buscar por nome, WhatsApp, e-mail ou CPF…',{exact:true}).fill('NomeInexistenteQA');await p.getByText('Ninguém encontrado',{exact:true}).waitFor();assert.ok(!(await p.locator('body').innerText()).includes('cadastros na página'));await shot(p,'copy-empty-clients');
 });
 await test('three roles no console or unexpected HTTP errors',async()=>{for(const role of ['recepcao','orlando']){const r=await login(role);await agenda(r);if(role==='orlando')assert.equal(await r.locator('[data-agenda-column]').count(),1);await shot(r,'role-'+role);await r.context().close();}assert.deepEqual(report.console,[]);assert.deepEqual(report.network,[]);});
}finally{await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({checks:report.checks,failures:report.failures,console:report.console,network:report.network},null,2));}
if(report.failures.length||report.console.length||report.network.length)process.exitCode=1;
