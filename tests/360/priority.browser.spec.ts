import { test,expect,type Page,type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
const f=JSON.parse(fs.readFileSync(process.env.DESIGN_TEST_FIXTURE!,'utf8'));
let session:Awaited<ReturnType<BrowserContext['storageState']>>|undefined;
async function login(page:Page){
 if(session){await page.context().addCookies(session.cookies);await page.goto(`/dashboard?b=${f.b}`);}
 else {await page.goto('/login');await page.getByLabel('E-mail',{exact:true}).fill(f.owner.email);await page.getByLabel('Senha',{exact:true}).fill(f.owner.password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page).toHaveURL(/dashboard/);session=await page.context().storageState();}
 await expect(page.locator('.workspace-topbar')).toBeVisible();
}
async function noPageOverflow(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
async function noVerticalDocumentScroll(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+2)).toBe(true);}
test.beforeEach(async({page})=>{const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));(page as any).errors=errors;});
test.afterEach(async({page})=>{expect((page as any).errors).toEqual([]);});

test('priority login: real session survives reload; 401, 429, HTML 502, JSON 503, network and me outage are distinct',async({page},info)=>{
 await login(page);await page.reload();await expect(page.locator('.workspace-topbar')).toBeVisible();
 expect(await page.evaluate(async()=>(await fetch('/api/auth/me')).status)).toBe(200);
 await page.goto('/login?session=expired');await expect(page.getByText('Sua sessão expirou.',{exact:false})).toBeVisible();
 await page.getByLabel('E-mail',{exact:true}).fill(f.owner.email);await page.getByLabel('Senha',{exact:true}).fill('incorrect-synthetic');
 await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.locator('form [role=alert]')).toContainText('E-mail ou senha incorretos');
 for(const status of [429,502,503]){
   await page.route('**/api/auth/login',r=>r.fulfill({status,contentType:status===502?'text/html':'application/json',body:status===502?'<h1>Upstream unavailable</h1>':JSON.stringify({error:'Controlled synthetic failure'})}));
   await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.locator('form [role=alert]')).toContainText(status===429?'tentativas':'indisponível');
   await page.screenshot({path:info.outputPath(`login-${status}.png`)});await page.unroute('**/api/auth/login');
 }
 await page.route('**/api/auth/login',r=>r.abort('failed'));await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.locator('form [role=alert]')).toContainText('conexão');await page.unroute('**/api/auth/login');
 await page.getByLabel('Senha',{exact:true}).fill(f.owner.password);
 await page.route('**/api/auth/me',r=>r.fulfill({status:503,json:{code:'AUTH_UNAVAILABLE'}}));
 await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.locator('form [role=alert]')).toContainText('indisponível');
 await page.unroute('**/api/auth/me');expect(await page.evaluate(async()=>(await fetch('/api/auth/me')).status)).toBe(200);
});

for(const [width,height] of [[1440,900],[1366,768],[390,844]])test(`priority header and compact agenda ${width}x${height}`,async({page},info)=>{
 await login(page);await page.setViewportSize({width,height});
 await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=day`);
 const grid=page.locator('[data-agenda-grid]');await expect(grid).toBeVisible();await expect(page.getByRole('combobox',{name:'Densidade da agenda'})).toHaveValue('compact');
 await expect(grid).toHaveAttribute('data-start-minute','480');await expect(grid).toHaveAttribute('data-end-minute','1080');
 const header=page.locator('.workspace-topbar');expect((await header.boundingBox())!.height).toBe(60);
 await expect(page.getByRole('button',{name:'Buscar no menu',exact:true})).toHaveCount(1);await expect(page.getByText(f.owner.name,{exact:true})).toHaveCount(1);
 await expect(page.locator('.workspace-sidebar').getByRole('button',{name:'Buscar no menu'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/Tela cheia/})).toHaveCount(0);await expect(page.getByText('Abra um atendimento para ver detalhes e ações. Na grade, arraste para remarcar.',{exact:true})).toHaveCount(0);
 await noPageOverflow(page);await noVerticalDocumentScroll(page);
 if(width===390)expect(await page.locator(".agenda-date-narrow").evaluate(e=>e.getBoundingClientRect().width<=e.parentElement!.clientWidth+1)).toBe(true);
 if(width===1440)expect(await grid.evaluate(e=>e.scrollHeight<=e.clientHeight+2)).toBe(true);
 expect(Number(await grid.getAttribute('data-hour-scale'))).toBeGreaterThanOrEqual(40);
 await expect(page.locator('[aria-label="Pessoas na fila"]')).not.toHaveText('…');
 await page.screenshot({path:info.outputPath(`compact-${width}.png`)});
 const short=page.locator('[data-agenda-event="priority-short-a"]');await short.focus();await expect(page.locator('.agenda-footer output')).toContainText('Ana');
 const scale=Number(await grid.getAttribute('data-hour-scale'));expect((await short.boundingBox())!.height).toBeCloseTo(scale/4,0);
 await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'Detalhe do agendamento'})).toBeVisible();await page.keyboard.press('Escape');await expect(short).toBeFocused();
 await page.getByRole('combobox',{name:'Densidade da agenda'}).selectOption('comfortable');await expect(grid).toHaveAttribute('data-hour-scale','72');await page.reload();await expect(page.getByRole('combobox',{name:'Densidade da agenda'})).toHaveValue('comfortable');
 await noVerticalDocumentScroll(page);await page.screenshot({path:info.outputPath(`comfortable-${width}.png`)});
 await page.getByRole('combobox',{name:'Densidade da agenda'}).selectOption('compact');
 const queue=page.getByRole('button',{name:'Fila de atendimento',exact:true});await queue.click();
 if(width>=1280){await expect(page.locator('[data-queue-rail]')).toBeVisible();expect((await page.locator('[data-queue-rail]').boundingBox())!.width).toBe(280);await page.reload();await expect(page.locator('[data-queue-rail]')).toBeVisible();}
 else await expect(page.getByRole('dialog',{name:'Fila de atendimento'})).toBeVisible();
 await page.screenshot({path:info.outputPath(`queue-${width}.png`)});await noPageOverflow(page);
 await page.getByRole('button',{name:'Fechar a fila',exact:true}).click();await expect(queue).toHaveAttribute('aria-expanded','false');
 await page.getByRole('button',{name:'Buscar no menu',exact:true}).click();await expect(page.getByRole('textbox',{name:'Texto da busca'})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Buscar no menu',exact:true})).toBeFocused();
 await page.getByLabel('Menu da conta',{exact:true}).click();await expect(page.getByRole('button',{name:'Sair da conta'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByLabel('Menu da conta',{exact:true})).toBeFocused();
 if(width>=1200){await page.getByRole('button',{name:'Recolher menu'}).click();expect((await page.locator('.workspace-sidebar').boundingBox())!.width).toBe(64);await page.getByRole('button',{name:'Expandir menu'}).click();}
 else {await page.getByRole('button',{name:'Abrir navegação'}).click();await expect(page.getByRole('dialog',{name:'Navegar na clínica'}).getByRole('link',{name:'Pacientes',exact:true})).toBeVisible();await page.keyboard.press('Escape');}
 await page.getByRole('button',{name:/^Filtros/}).click();await expect(page.getByRole('dialog',{name:'Filtros da agenda'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:/^Filtros/})).toBeFocused();
});

test('priority out-of-hours, concurrent events, one scroller, direct queue, filters and unit boundary',async({page},info)=>{
 await login(page);await page.setViewportSize({width:1366,height:768});await page.goto(`/agenda?b=${f.b}&data=${f.outsideDate}&view=day`);
 const grid=page.locator('[data-agenda-grid]');await expect(grid).toHaveAttribute('data-start-minute','300');await expect(grid).toHaveAttribute('data-end-minute','1320');
 await expect(page.locator('[data-agenda-event="priority-early"]')).toBeAttached();await expect(page.locator('[data-agenda-event="priority-late"]')).toBeAttached();
 await noVerticalDocumentScroll(page);expect(await grid.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
 await page.locator('[data-agenda-event="priority-late"]').focus();await expect(page.locator('.agenda-footer output')).toContainText('Tarde');
 await page.screenshot({path:info.outputPath('out-of-hours-1366.png')});
 await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=day`);await expect(grid).toBeVisible();
 const a=page.locator('[data-agenda-event="priority-short-a"]'),b=page.locator('[data-agenda-event="priority-short-b"]'),c=page.locator('[data-agenda-event="priority-short-c"]');
 const aa=(await a.boundingBox())!,bb=(await b.boundingBox())!,cc=(await c.boundingBox())!;expect(aa.x+aa.width).toBeLessThanOrEqual(bb.x);expect(aa.y+aa.height).toBeLessThanOrEqual(cc.y+1);
 await page.getByRole('navigation',{name:'Menu principal',exact:true}).getByRole('link',{name:'Fila de atendimento'}).click();await expect(page.locator('[data-queue-rail]')).toBeVisible();await page.getByRole('button',{name:'Fechar a fila'}).click();await page.reload();await expect(page.locator('[data-queue-rail]')).toHaveCount(0);
 await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=day&professionalId=${f.p1}`);await page.getByRole('combobox',{name:'Trocar unidade'}).selectOption(f.other);await expect(page).toHaveURL(new RegExp(`b=${f.other}.*data=${f.date}.*view=day`));expect(new URL(page.url()).searchParams.has('professionalId')).toBe(false);
});
