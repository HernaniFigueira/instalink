import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
const f = JSON.parse(fs.readFileSync(process.env.DESIGN_TEST_FIXTURE || '/home/user/.cache/360/fixture.json', 'utf8'));
// Reuse only sessions obtained through the real login UI. Keep them in this worker's memory,
// never in committed files, and respect the server's unchanged 15 logins/minute limit.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();
async function login(page: Page, account = f.owner) {
  const cached = sessions.get(account.email);
  if (cached) {
    await page.context().addCookies(cached.cookies);
    await page.addInitScript(origins => {
      const state = origins.find(o => o.origin === location.origin);
      for (const item of state?.localStorage || []) localStorage.setItem(item.name, item.value);
    }, cached.origins);
    await page.goto('/dashboard'); await expect(page.locator('.workspace-sidebar')).toBeAttached(); return;
  }
  await page.goto('/login'); await page.getByLabel('E-mail', {exact:true}).fill(account.email);
  await page.getByLabel('Senha', {exact:true}).fill(account.password);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.waitForURL(/dashboard/); await expect(page.locator('.workspace-sidebar')).toBeAttached();
  sessions.set(account.email, await page.context().storageState());
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy(); }
test.beforeEach(async ({page}) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  (page as any).journeyErrors = errors;
});
test.afterEach(async ({page}) => { expect((page as any).journeyErrors).toEqual([]); });

for (const width of [1366,390]) test(`landing and team authentication ${width}`, async ({page}, info) => {
  await page.setViewportSize({width,height:900}); await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('Sua clínica organizada');
  await noOverflow(page); await page.screenshot({path:info.outputPath(`landing-${width}.png`),fullPage:true});
  await page.getByRole('link',{name:/Acesso da equipe/}).first().click();
  await expect(page.getByLabel('E-mail',{exact:true})).toBeVisible(); await noOverflow(page);
  await page.screenshot({path:info.outputPath(`login-${width}.png`),fullPage:true});
  await page.goto('/register'); await expect(page.getByRole('heading',{level:1})).toBeVisible();
  await page.goto('/recuperar?kind=user'); await expect(page.getByRole('heading',{level:1})).toBeVisible();
});

test('two-level navigation, logo, unit boundary and mobile unified menu', async ({page},info) => {
  await login(page); await page.goto(`/dashboard?b=${f.b}`);
  await expect(page.getByRole('heading',{name:'Visão geral da clínica'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Menu principal',exact:true}).getByRole('button')).toHaveCount(3);
  expect((await page.locator('.workspace-sidebar').boundingBox())?.width).toBe(232);
  await expect(page.locator('.workspace-logo')).toHaveCSS('object-fit','contain');
  await page.screenshot({path:info.outputPath('dashboard-1366.png'),fullPage:true});
  await page.getByRole('navigation',{name:'Menu principal',exact:true}).getByRole('button',{name:'Gestão',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Gestão',exact:true}).getByRole('link',{name:'Equipe',exact:true})).toBeVisible();
  await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=list&professionalId=${f.p1}&member=private&q=Marina`);
  await page.getByRole('combobox',{name:'Trocar unidade'}).selectOption(f.other);
  await expect(page).toHaveURL(new RegExp(`b=${f.other}.*data=${f.date}.*view=list`));
  expect(new URL(page.url()).searchParams.has('professionalId')).toBeFalsy(); expect(page.url()).not.toContain('private');
  await page.getByRole('combobox',{name:'Trocar unidade'}).selectOption(f.b);
  await expect(page).toHaveURL(new RegExp(`b=${f.b}.*data=${f.date}.*view=list`));
  await expect(page.getByRole('region',{name:'Lista de atendimentos do dia'})).toContainText('Marina');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Abrir navegação'}).click();
  const menu=page.getByRole('dialog',{name:'Navegar na clínica'}); await expect(menu).toBeVisible();
  await page.screenshot({path:info.outputPath('navigation-390.png')});
  await menu.getByRole('link',{name:'Clientes',exact:true}).click();
  await expect(menu).toHaveCount(0); await expect(page).toHaveURL(/clientes/); await noOverflow(page);
});

for (const role of ['SECRETARIA','PROFISSIONAL','ADMIN','VIEWER']) test(`role navigation and protected data ${role}`, async ({page},info) => {
  await login(page,f.roles[role]); await page.goto(`/dashboard?b=${f.b}`);
  if(role==='VIEWER') { await expect(page.getByText(/não.*acesso|permissão/i).first()).toBeVisible(); await expect(page.getByRole('navigation',{name:'Menu principal',exact:true}).getByRole('link')).toHaveCount(0); return; }
  await expect(page.getByRole('heading',{level:1})).toBeVisible();
  if(role!=='ADMIN') {
    await expect(page.getByRole('navigation',{name:'Menu principal',exact:true}).getByRole('link',{name:'Página da clínica'})).toHaveCount(0);
    const status = await page.evaluate(async path => (await fetch(path)).status, `/api/results?businessId=${f.b}`); expect(status).toBe(403);
  }
  if(role==='PROFISSIONAL') {
    await expect(page.getByRole('heading',{name:'Minha agenda e atendimentos'})).toBeVisible();
    await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=list`);
    await expect(page.getByRole('region',{name:'Lista de atendimentos do dia'})).toBeVisible();
    await expect(page.getByRole('region',{name:'Lista de atendimentos do dia'})).not.toContainText('Rafael');
  }
  if(role==='SECRETARIA') await expect(page.getByRole('heading',{name:'Sua operação hoje'})).toBeVisible();
  await page.screenshot({path:info.outputPath(`role-${role}.png`),fullPage:true});
});

test('agenda detail, mobile list and reuse of a registered patient', async ({page},info) => {
  await login(page); await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=list`);
  const list=page.getByRole('region',{name:'Lista de atendimentos do dia'}); await expect(list).toContainText('Marina');
  await list.getByRole('button').filter({hasText:'Marina'}).first().click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.screenshot({path:info.outputPath('booking-detail-1366.png')});
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(list).toContainText('Marina');
  await page.setViewportSize({width:390,height:844}); await noOverflow(page);
  await page.screenshot({path:info.outputPath('agenda-390.png'),fullPage:true});
  await page.getByRole('button',{name:'Novo agendamento',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').locator('input').first().fill('Marina');
  await expect(page.getByRole('dialog').getByText('Marina · paciente sintética',{exact:true})).toBeVisible();
  await page.getByRole('dialog').getByText('Marina · paciente sintética',{exact:true}).click();
  await page.screenshot({path:info.outputPath('booking-form-390.png')});
});

test('editor local preview, failed save retention and actual published persistence', async ({page},info) => {
  await login(page); await page.goto(`/pagina?b=${f.b}`);
  await expect(page.getByText('Ao salvar, suas alterações entram no site público imediatamente.',{exact:false})).toBeVisible();
  const block=page.locator('[data-block-id="text-demo"]'); await block.getByRole('button',{name:/Editar/}).click();
  const title=block.locator('input').first(); const text=`Conteúdo revisado ${Date.now()}`; await title.fill(text);
  await expect(page.getByText('Alterações não salvas',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Prévia das alterações',exact:true}).click();
  await expect(page.frameLocator('iframe[title="Prévia local da página em edição"]').getByRole('heading',{name:text})).toBeVisible();
  expect(await (await page.request.get(`/${f.slug}`)).text()).not.toContain(text);
  await page.screenshot({path:info.outputPath('editor-1366.png'),fullPage:true});
  await page.route('**/api/pages',async route=>{ if(route.request().method()==='PUT') { await route.fulfill({status:503,json:{error:'Falha sintética controlada'}}); await page.unroute('**/api/pages'); } else await route.continue(); });
  await page.getByRole('button',{name:'Salvar alterações'}).click();
  await expect(page.getByRole('alert').filter({hasText:'Falha'})).toContainText('Falha'); await expect(title).toHaveValue(text);
  await page.getByRole('button',{name:'Salvar alterações'}).click();
  await expect(page.getByRole('status')).toContainText('página pública já foi atualizada');
  expect(await (await page.request.get(`/${f.slug}`)).text()).toContain(text);
  await page.reload(); await expect(page.getByText('Conteúdo salvo',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844}); await noOverflow(page); await page.screenshot({path:info.outputPath('editor-390.png'),fullPage:true});
});

test('client profile, nested encounter and real multipage PDF excluding internal note',async ({page},info)=>{
  await login(page); await page.goto(`/clientes?b=${f.b}`);
  await page.getByRole('button',{name:`Abrir perfil de ${f.customer.name}`,exact:true}).click();
  const profile=page.getByRole('dialog',{name:f.customer.name,exact:true}); await expect(profile).toBeVisible();
  await profile.getByRole('tab',{name:/Atendimentos/}).click();
  await profile.getByRole('button').filter({hasText:'Conteúdo da via do paciente'}).click();
  const encounter=page.getByRole('dialog',{name:'Atendimento',exact:true}); await expect(encounter).toBeVisible();
  await expect(page.locator('body > .il-print-area')).toBeAttached();
  await expect(page.locator('body > .il-print-area')).toContainText('MARCADOR-PUBLICO-FINAL');
  // Replace only the OS print dialog; exercise the real print button/CSS and produce a real Chromium PDF.
  await page.evaluate(()=>{ window.print=()=>{}; });
  await encounter.getByRole('button',{name:'Imprimir via do cliente'}).click();
  await expect(page.locator('body')).toHaveClass(/il-printing/);
  await page.emulateMedia({media:'print'});
  const pdf=await page.pdf({path:info.outputPath('encounter.pdf'),format:'A4'});
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc=await getDocument({data:new Uint8Array(pdf),useSystemFonts:true}).promise;
  let text=''; for(let n=1;n<=doc.numPages;n++) { const content=(await(await doc.getPage(n)).getTextContent()).items.map((i:any)=>i.str).join(' '); expect(content.trim().length).toBeGreaterThan(0); text+=content; }
  expect(text).toContain('Registro de atendimento'); expect(text).toContain('MARCADOR-PUBLICO-FINAL'); expect(text).not.toContain('SEGREDO-INTERNO'); expect(doc.numPages).toBeGreaterThanOrEqual(2);
  await page.emulateMedia({media:'screen'}); await page.evaluate(()=>document.body.classList.remove('il-printing'));
  await page.keyboard.press('Escape'); await expect(encounter).toHaveCount(0); await expect(profile).toBeVisible();
  await page.setViewportSize({width:390,height:844}); await page.screenshot({path:info.outputPath('profile-390.png')});
});

test('public clinic, preserved selection across patient login and persisted booking/account',async ({page},info)=>{
  await page.goto(`/${f.slug}`); await expect(page.getByRole('heading',{level:1})).toContainText('Clínica Aurora');
  await expect(page.locator('.il-platform')).toHaveCount(0); await page.screenshot({path:info.outputPath('clinic-1366.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844}); await noOverflow(page); const captions=await page.locator('#profissionais figcaption').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,parent:n.parentElement!.getBoundingClientRect().width,scroll:n.scrollWidth,client:n.clientWidth})));
  expect(captions.length).toBeGreaterThan(0);
  for(const c of captions){ expect(c.width).toBeLessThanOrEqual(c.parent+1); expect(c.scroll).toBeLessThanOrEqual(c.client+1); }
  await page.screenshot({path:info.outputPath('clinic-390.png'),fullPage:true});
  await page.getByRole('button',{name:/Agendar.*Consulta demonstrativa/i}).click();
  const booking=page.getByRole('dialog',{name:/Agendar/}); await expect(booking).toBeVisible();
  await booking.getByRole('button',{name:new RegExp(f.date.slice(8)+'/'+f.date.slice(5,7))}).click();
  const slot=booking.getByRole('button',{name:/^\d\d:\d\d$/}).and(booking.locator('button:enabled')).last();
  const time=(await slot.innerText()).trim(); await slot.click();
  await expect(booking.getByRole('region',{name:'Resumo do agendamento'})).toContainText('Consulta demonstrativa');
  await booking.getByRole('button',{name:'Efetuar login'}).click();
  const auth=page.getByRole('dialog',{name:'Entrar',exact:true}); await expect(auth).toBeVisible();
  await auth.getByRole('textbox',{name:'WhatsApp ou e-mail'}).fill(f.customer.email); await auth.getByLabel('Senha',{exact:true}).fill(f.customer.password);
  await auth.getByRole('button',{name:'Entrar',exact:true}).last().click(); await expect(auth).toHaveCount(0);
  await expect(booking.getByRole('region',{name:'Resumo do agendamento'})).toContainText(time);
  await page.screenshot({path:info.outputPath('booking-review-390.png')});
  const result=page.waitForResponse(r=>r.url().endsWith('/api/bookings') && r.request().method()==='POST');
  await booking.getByRole('button',{name:new RegExp(`^Confirmar · ${time}`)}).click();
  const bookingId=(await (await result).json()).bookingId; expect(bookingId).toBeTruthy();
  await expect(booking.getByText(/Agendamento recebido!|Agendamento confirmado!/)).toBeVisible();
  const saved=await page.evaluate(async path=>(await fetch(path)).json(),`/api/customer/bookings?businessId=${f.b}`); expect(saved.bookings.some((b:any)=>b.id===bookingId && b.date===f.date && b.time===time && b.status!=='cancelled')).toBeTruthy();
  await page.keyboard.press('Escape'); await page.goto(`/${f.slug}?conta=1`);
  const account=page.getByRole('dialog',{name:'Minha conta'}); await expect(account).toBeVisible();
  await expect(account.getByRole('button',{name:'Próximas consultas'})).toBeVisible(); await page.screenshot({path:info.outputPath('patient-account-390.png')});
  const card=account.locator(`[data-booking-id="${bookingId}"]`);
  await card.getByRole('button',{name:'Remarcar',exact:true}).click();
  const reschedule=page.getByRole('dialog',{name:'Remarcar consulta',exact:true});
  const next=reschedule.getByRole('button',{name:/^\d\d:\d\d$/}).and(reschedule.locator('button:enabled')).first();
  const nextTime=(await next.innerText()).trim(); await next.click();
  await reschedule.getByRole('button',{name:new RegExp(`^Remarcar · ${nextTime}`)}).click();
  await expect(reschedule.getByText('Horário remarcado!',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(account).toBeVisible();
  const changed=account.locator(`[data-booking-id="${bookingId}"]`);
  await expect(changed).toContainText(nextTime);
  await expect(changed).toBeVisible(); await changed.getByRole('button',{name:'Cancelar',exact:true}).click();
  await changed.getByRole('button',{name:'Toque para confirmar',exact:true}).click();
  await account.getByRole('button',{name:'Histórico',exact:true}).click(); await expect(account).toContainText('Cancelado');
});

test('editor about/menu drafts survive tabs, browser back is guarded, keyboard reorders',async({page})=>{
  await login(page); await page.goto(`/dashboard?b=${f.b}`);
  await page.getByRole('navigation',{name:'Menu principal',exact:true}).getByRole('link',{name:'Página',exact:true}).click();
  await page.getByRole('button',{name:'Editar Sobre a clínica'}).click();
  const title=`Nossa história · revisão ${Date.now()}`;
  await page.getByLabel('Título sobre a clínica').fill(title);
  await expect(page.getByText('Alterações não salvas',{exact:true})).toBeVisible();
  const warning=page.waitForEvent('dialog'); await page.evaluate(()=>history.back()); await(await warning).dismiss();
  await expect(page).toHaveURL(/pagina/); await expect(page.getByLabel('Título sobre a clínica')).toHaveValue(title);
  await page.getByRole('tab',{name:'Navegação e ações'}).click();
  await expect(page.getByLabel('Título sobre a clínica')).toHaveValue(title);
  await page.getByLabel('Nome no menu: Serviços').fill('Nossos atendimentos');
  await page.getByRole('button',{name:'Prévia das alterações',exact:true}).click();
  await page.getByRole('button',{name:'Ver menu',exact:true}).click();
  const preview=page.frameLocator('iframe[title="Prévia local da página em edição"]');
  await expect(preview.getByText('Nossos atendimentos',{exact:true})).toBeVisible();
  await expect(preview.getByRole('heading',{name:title})).toBeVisible();
  await page.getByRole('tab',{name:'Conteúdo e blocos'}).click();
  const ids=await page.locator('[data-block-id]').evaluateAll(els=>els.map(el=>el.getAttribute('data-block-id')));
  const block=page.locator('[data-block-id="text-demo"]'); const direction=ids.indexOf('text-demo')===0 ? 'baixo' : 'cima'; await block.getByRole('button',{name:new RegExp(`para ${direction}`)}).focus(); await page.keyboard.press('Enter');
  const moved=await page.locator('[data-block-id]').evaluateAll(els=>els.map(el=>el.getAttribute('data-block-id'))); expect(moved.indexOf('text-demo')).toBe(ids.indexOf('text-demo')+(direction==='cima' ? -1 : 1));
  await page.getByRole('button',{name:'Salvar alterações'}).click(); await expect(page.getByText('Conteúdo salvo',{exact:true})).toBeVisible();
  await page.reload(); await page.getByRole('tab',{name:'Navegação e ações'}).click(); await expect(page.getByLabel('Nome no menu: Serviços')).toHaveValue('Nossos atendimentos');
});

test('operational screens on desktop and mobile',async({page},info)=>{
  test.setTimeout(180000); await login(page);
  for(const route of ['clientes','conversas','tarefas','funil','equipe','profissionais','servicos','disponibilidade','organizacao','resultados','configuracoes','automacoes','execucoes','agente']) {
    await page.setViewportSize({width:1366,height:900}); await page.goto(`/${route}?b=${f.b}`);
    await expect(page.getByRole('heading',{level:1}).first()).toBeVisible();
    await expect(page.locator('main .animate-pulse')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/Carregando|Atualizando…/);
    await expect(page.locator('main')).not.toContainText(/Falha ao carregar|Não foi possível carregar/);
    await noOverflow(page); await page.screenshot({path:info.outputPath(`${route}-1366.png`),fullPage:true});
    await page.setViewportSize({width:390,height:844}); await noOverflow(page); await page.screenshot({path:info.outputPath(`${route}-390.png`),fullPage:true});
  }
});

test('agenda URL preserves view/date/filter across history and reload',async({page})=>{
  await login(page); await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=list`);
  await page.getByRole('tab',{name:'Semana',exact:true}).click(); await expect(page).toHaveURL(/view=week/);
  await page.goBack(); await expect(page.getByRole('tab',{name:'Lista',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:/^Filtro/}).click();
  await page.getByRole('dialog',{name:'Filtros da agenda'}).getByRole('button',{name:'Confirmado',exact:true}).click();
  await expect(page).toHaveURL(/status=confirmed/); await page.reload();
  await expect(page.getByRole('tab',{name:'Lista',exact:true})).toHaveAttribute('aria-selected','true');
  expect(new URL(page.url()).searchParams.get('data')).toBe(f.date);
});

test('public availability network error is not reported as a full/closed day',async({page})=>{
  await page.route('**/api/bookings?**',route=>new URL(route.request().url()).searchParams.has('from') ? route.fulfill({status:503,json:{error:'Falha sintética'}}) : route.continue());
  await page.goto(`/${f.slug}`); await page.getByRole('button',{name:/Agendar.*Consulta demonstrativa/i}).click();
  const sheet=page.getByRole('dialog',{name:'Agendar',exact:true}); await expect(sheet.getByRole('alert')).toContainText('Não foi possível consultar');
  await page.unroute('**/api/bookings?**'); await sheet.getByRole('button',{name:'Tentar consultar os dias novamente'}).click();
  await expect(sheet.getByRole('button',{name:new RegExp(f.date.slice(8)+'/'+f.date.slice(5,7))})).toBeEnabled();
  await expect(sheet.getByRole('alert')).toHaveCount(0);
});

test('new patient, keyboard modal containment and persisted team appointment',async({page},info)=>{
  await login(page); await page.goto(`/clientes?b=${f.b}`); await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Novo cliente',exact:true}).click();
  const client=page.getByRole('dialog',{name:'Novo cliente',exact:true}); await expect(client).toBeVisible();
  await expect(client.getByRole('heading',{name:'Novo cliente'})).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(client.getByRole('button',{name:'Salvar cliente'})).toBeFocused();
  await page.keyboard.press('Tab'); await expect(client.getByRole('button',{name:'Fechar',exact:true})).toBeFocused();
  const name=`Lia · demonstração ${Date.now()}`; const phone='219'+String(Date.now()).slice(-8);
  await client.getByLabel('NOME *',{exact:true}).fill(name); await client.getByRole('textbox',{name:'WHATSAPP *',exact:true}).fill(phone);
  await client.getByRole('button',{name:'Salvar cliente'}).click(); await expect(client.getByText('Cliente cadastrado',{exact:false})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(client).toHaveCount(0);
  await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=list`); await page.getByRole('button',{name:'Novo agendamento',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Novo agendamento',exact:true}); await dialog.getByLabel('Buscar cliente').fill(name);
  await dialog.getByRole('button').filter({hasText:name}).click(); await expect(dialog).toContainText('Cadastro vinculado');
  await dialog.getByRole('combobox',{name:'2. Serviço'}).selectOption(f.serviceId); await dialog.getByRole('combobox',{name:'Profissional'}).selectOption(f.p1);
  await dialog.getByLabel(/3. Data/).fill(f.date);
  const slot=dialog.getByRole('button',{name:/^\d\d:\d\d$/}).last(); await slot.click();
  await expect(dialog.getByRole('region',{name:'Revise o agendamento'})).toContainText(name);
  await dialog.getByRole('region',{name:'Revise o agendamento'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('team-booking-review-390.png')});
  await dialog.getByRole('button',{name:'Salvar agendamento'}).click(); await expect(dialog.getByText('Agendamento criado',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('region',{name:'Lista de atendimentos do dia'})).toContainText(name);
});

test('queue contact reuse, attendance start and nested sheet Escape',async({page},info)=>{
  await login(page); await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=list`);
  await page.getByRole('button',{name:/^Fila/}).click();
  const queue=page.locator('[data-queue-panel]'); await expect(queue).toBeVisible();
  await queue.getByRole('button',{name:'Adicionar à fila',exact:true}).click(); await queue.getByRole('textbox',{name:'Nome',exact:true}).fill('Rafael');
  await queue.locator('[data-queue-contact-results]').getByRole('button').filter({hasText:'Rafael'}).click();
  await queue.getByRole('combobox',{name:'Serviço',exact:true}).selectOption(f.serviceId);
  await queue.getByRole('combobox',{name:'Profissional',exact:true}).selectOption(f.p2);
  await queue.getByRole('button',{name:'Adicionar à fila',exact:true}).last().click();
  await queue.getByRole('button',{name:'Chamar',exact:true}).last().click();
  await queue.getByRole('button',{name:'Iniciar atendimento',exact:true}).last().click();
  const encounter=page.getByRole('dialog',{name:'Atendimento',exact:true}); await expect(encounter).toBeVisible();
  await page.screenshot({path:info.outputPath('queue-encounter-1366.png')}); await page.keyboard.press('Escape'); await expect(encounter).toHaveCount(0);
  await expect(queue).toContainText('Em atendimento');
});

test('standalone guest booking keeps identity after 409 and confirms only persisted data',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/agendar?slug=${f.slug}&serviceId=${f.serviceId}&date=${f.date}`);
  const slot=page.getByRole('button',{name:/^\d\d:\d\d$/}).and(page.locator('button:enabled')).last(); await slot.click();
  const name=`Paula · demonstração ${Date.now()}`; await page.getByLabel('Seu nome',{exact:true}).fill(name); await page.getByLabel('WhatsApp',{exact:true}).fill('219'+String(Date.now()).slice(-8));
  await page.route('**/api/bookings',async route=>{if(route.request().method()==='POST') {await route.fulfill({status:409,json:{error:'Horário ocupado. Escolha outro horário.'}}); await page.unroute('**/api/bookings');} else await route.continue();});
  await page.getByRole('button',{name:/^Confirmar ·/}).click(); await expect(page.getByRole('alert').filter({hasText:'Horário ocupado'})).toBeVisible();
  await slot.click(); await expect(page.getByLabel('Seu nome',{exact:true})).toHaveValue(name); await page.screenshot({path:info.outputPath('standalone-review-390.png'),fullPage:true});
  const persisted=page.waitForResponse(r=>r.url().endsWith('/api/bookings')&&r.request().method()==='POST');
  await page.getByRole('button',{name:/^Confirmar ·/}).click(); const response=await persisted; expect(response.ok()).toBeTruthy(); expect((await response.json()).bookingId).toBeTruthy();
  await expect(page.getByRole('button',{name:'Fazer outro agendamento'})).toBeVisible(); await noOverflow(page);
  await page.screenshot({path:info.outputPath('standalone-confirmation-390.png'),fullPage:true});
});

test('operational failures preserve session, distinguish error from empty, and retry',async({page},info)=>{
  await login(page);
  for(const [route,api] of [['resultados','results'],['servicos','catalog/get'],['equipe','team'],['configuracoes','pages']]) {
    const pattern=`**/api/${api}**`; await page.route(pattern,r=>r.fulfill({status:503,json:{error:'Falha sintética de conexão'}}));
    await page.goto(`/${route}?b=${f.b}`);
    const error=page.getByRole('alert').filter({hasText:'Não foi possível carregar'}); await expect(error).toBeVisible(); await expect(page).toHaveURL(new RegExp(route));
    await page.screenshot({path:info.outputPath(`${route}-error.png`)}); await page.unroute(pattern);
    await error.getByRole('button',{name:'Tentar novamente'}).click(); await expect(error).toHaveCount(0); await expect(page.getByRole('heading',{level:1}).first()).toBeVisible();
  }
});

test('320px layouts remain within the viewport',async({page})=>{
  await login(page); await page.setViewportSize({width:320,height:740});
  for(const route of ['dashboard','agenda','pagina','profissionais','servicos','resultados','configuracoes']) {
    await page.goto(`/${route}?b=${f.b}`); await expect(page.getByRole('heading',{level:1}).first()).toBeVisible(); await noOverflow(page);
  }
  for(const route of ['',f.slug,'login','register']) { await page.goto('/'+route); await expect(page.getByRole('heading',{level:1}).first()).toBeVisible(); await noOverflow(page); }
});

test('administrative sheets share keyboard containment and history errors are not empty results',async({page},info)=>{
  await login(page); await page.setViewportSize({width:390,height:844});
  await page.goto(`/funil?b=${f.b}`); await page.getByRole('button',{name:'Configurar etapas'}).click();
  const stages=page.getByRole('dialog',{name:'Etapas do funil'}); await expect(stages).toBeVisible();
  await expect(stages.getByRole('heading',{name:'Etapas do funil'})).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(stages.getByRole('button',{name:'Cancelar'})).toBeFocused();
  await page.keyboard.press('Escape'); await expect(stages).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Configurar etapas'})).toBeFocused();
  await page.goto(`/equipe?b=${f.b}`); const manage=page.getByRole('button',{name:'Gerenciar'}).first(); await manage.click();
  const member=page.getByRole('dialog'); await expect(member).toBeVisible(); await noOverflow(page);
  await page.screenshot({path:info.outputPath('team-permissions-390.png')});
  await page.keyboard.press('Escape'); await expect(member).toHaveCount(0); await expect(manage).toBeFocused();
  await page.goto(`/automacoes?b=${f.b}`); await page.getByRole('button',{name:'Nova automação',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Nova automação'}); await expect(editor).toBeVisible();
  await expect(editor.getByRole('heading',{name:'Nova automação'})).toBeFocused();
  await page.keyboard.press('Escape'); await expect(editor).toHaveCount(0);
  // A disabled synthetic automation provides real history without running any action or external integration.
  const id=await page.evaluate(async(b)=>{
    const list=await(await fetch(`/api/automations?businessId=${b}`)).json();
    const prior=list.automations?.find((a:any)=>a.name==='Revisão de histórico · desativada'); if(prior) return prior.id;
    const r=await fetch('/api/automations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId:b,name:'Revisão de histórico · desativada',active:false,event:'lead.created',steps:[{kind:'action',action:{type:'create_task',params:{title:'Somente demonstração'}}}]})});
    const data=await r.json(); if(!r.ok) throw Error(`Synthetic automation: ${r.status}`); return data.automation.id;
  },f.b);
  expect(id).toBeTruthy(); await page.reload();
  const historyUrl=new RegExp(`/api/automations/${id}\\?`);
  await page.route(historyUrl,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Falha sintética de histórico'})}));
  await page.getByRole('button',{name:'Histórico',exact:true}).first().click();
  const history=page.getByRole('dialog',{name:/Histórico —/}); await expect(history.getByRole('alert')).toBeVisible();
  await expect(history).toHaveCSS('margin-top','0px');
  expect((await history.boundingBox())?.y).toBe(0);
  await expect(history).not.toContainText('Ainda não houve execução');
  await page.screenshot({path:info.outputPath('automation-history-error-390.png')});
  await page.unroute(historyUrl); await history.getByRole('button',{name:'Tentar novamente'}).click();
  await expect(history).toContainText('Ainda não houve execução'); await expect(history.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(history).toHaveCount(0);
});

for(const width of [1440,1280,1024,390]) test(`direction acceptance: navigation, agenda, conversations and organization ${width}`,async({page},info)=>{
  await login(page);await page.setViewportSize({width,height:900});
  await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=day`);
  await expect(page.locator('[data-agenda-main]')).toBeVisible();await noOverflow(page);
  if(width>=1200){
    // GODOUTOR final (FASE D): UMA coluna (~256px) com acordeão — o submenu
    // expande PARA BAIXO e o conteúdo NÃO se move (nada de segunda coluna).
    expect((await page.locator('.workspace-sidebar').boundingBox())!.width).toBe(256);
    const nav=page.getByRole('navigation',{name:'Menu principal',exact:true});
    await nav.getByRole('button',{name:'Gestão',exact:true}).click();
    await expect(nav.getByRole('link',{name:'Resultados',exact:true})).toBeVisible();
    const before=(await page.locator('[data-agenda-main]').boundingBox())!.x;
    await page.screenshot({path:info.outputPath(`menu-${width}.png`)});
    await nav.getByRole('button',{name:'Automação',exact:true}).click();
    await expect(nav.getByRole('button',{name:'Gestão',exact:true})).toHaveAttribute('aria-expanded','false');
    await expect(nav.getByRole('button',{name:'Automação',exact:true})).toHaveAttribute('aria-expanded','true');
    await nav.getByRole('button',{name:'Automação',exact:true}).click();
    await expect(nav.getByRole('button',{name:'Automação',exact:true})).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('.workspace-secondary')).toHaveCount(0);
    expect((await page.locator('[data-agenda-main]').boundingBox())!.x).toBe(before);
    await page.getByRole('button',{name:'Recolher navegação'}).click();
    expect((await page.locator('.workspace-sidebar').boundingBox())!.width).toBe(64);
    await page.getByRole('button',{name:'Expandir navegação'}).click();
  }else{
    await expect(page.locator('.workspace-sidebar')).toBeHidden();
    const open=page.getByRole('button',{name:'Abrir navegação'});await open.click();
    let menu=page.getByRole('dialog');await menu.getByRole('button',{name:'Gestão',exact:true}).click();
    await expect(menu.getByRole('button',{name:/Voltar/})).toBeVisible();
    await page.screenshot({path:info.outputPath(`menu-${width}.png`)});
    await menu.getByRole('button',{name:/Voltar/}).click();await expect(menu.getByRole('button',{name:'Sair da conta'})).toBeVisible();
    await page.keyboard.press('Escape');await expect(open).toBeFocused();
  }
  await noOverflow(page);await page.screenshot({path:info.outputPath(`agenda-${width}.png`)});
  await page.getByRole('button',{name:/Fila de atendimento/}).first().click();
  if(width>=1280){expect((await page.locator('[data-queue-rail]').boundingBox())!.width).toBe(280);await page.screenshot({path:info.outputPath(`queue-${width}.png`)});await page.getByRole('button',{name:'Fechar a fila'}).click();}
  else {await expect(page.getByRole('dialog',{name:'Fila de atendimento'})).toBeVisible();await page.screenshot({path:info.outputPath(`queue-${width}.png`)});await page.keyboard.press('Escape');}
  const trigger=page.getByRole('button',{name:'Abrir painel de Conversas'});
  const url=page.url(),scroll=await page.evaluate(()=>scrollY);await trigger.click();
  const dock=page.getByRole('dialog',{name:'Conversas',exact:true});await expect(dock).toBeVisible();
  await expect(dock.getByRole('heading',{level:2,name:'Conversas',exact:true})).toBeFocused();
  await page.keyboard.press('Shift+Tab');expect(await dock.evaluate(d=>d.contains(document.activeElement))).toBe(true);
  await dock.getByRole('button').filter({hasText:'Marina · conversa sintética'}).click();
  const draft=dock.getByRole('textbox',{name:'Mensagem'});await draft.fill(`Rascunho sintético ${width}`);
  await expect(dock.getByRole('button',{name:'Enviar',exact:true})).toBeDisabled();
  await page.screenshot({path:info.outputPath(`conversations-${width}.png`)});await noOverflow(page);
  await page.keyboard.press('Escape');await expect(dock).not.toBeVisible();await expect(trigger).toBeFocused();
  expect(page.url()).toBe(url);expect(await page.evaluate(()=>scrollY)).toBe(scroll);
  await trigger.click();await expect(draft).toHaveValue(`Rascunho sintético ${width}`);
  if(width<768){await dock.getByRole('button',{name:/Voltar às conversas/}).click();await expect(dock.locator('.inbox-list')).toBeVisible();}
  await page.keyboard.press('Escape');
  await page.goto('/organizacao');await expect(page.getByRole('region',{name:'Resumo consolidado'})).toBeVisible();await noOverflow(page);
  await page.screenshot({path:info.outputPath(`organization-${width}.png`)});
  await page.getByRole('region',{name:'Filiais',exact:true}).getByRole('link',{name:'Abrir filial →',exact:true}).first().click();
  await expect(page).toHaveURL(/\/dashboard\?b=/);
  expect([f.b,f.other]).toContain(new URL(page.url()).searchParams.get('b'));
});

test('direction acceptance: direct grouped route, back-forward and reduced motion',async({page},info)=>{
  await login(page);await page.setViewportSize({width:1440,height:900});
  await page.goto(`/equipe?b=${f.b}`);await expect(page.getByRole('button',{name:'Clínica',exact:true})).toHaveAttribute('aria-expanded','true');
  await page.getByRole('navigation',{name:'Menu principal',exact:true}).getByRole('link',{name:'Agenda',exact:true}).click();
  await expect(page).toHaveURL(/\/agenda\?b=/);await expect(page.locator('.workspace-secondary')).toHaveCount(0);await page.goBack();
  await expect(page.getByRole('button',{name:'Clínica',exact:true})).toHaveAttribute('aria-expanded','true');await page.goForward();
  await expect(page.locator('.workspace-secondary')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Abrir painel de Conversas'}).click();
  const d=page.getByRole('dialog',{name:'Conversas',exact:true});
  expect(parseFloat(await d.evaluate(e=>getComputedStyle(e).animationDuration))).toBeLessThanOrEqual(.001);
  await page.screenshot({path:info.outputPath('conversations-reduced-motion.png')});await page.keyboard.press('Escape');await expect(d).not.toBeVisible();
});

test('direction acceptance: server impact, blocked dependency and real password deletion of empty synthetic targets',async({page},info)=>{
  await login(page);await page.goto('/organizacao');
  await page.getByRole('button',{name:'Excluir filial',exact:true}).first().click();
  let d=page.getByRole('dialog');await expect(d.getByText('Exclusão bloqueada',{exact:true})).toBeVisible();
  await expect(d.getByLabel('Senha atual')).toHaveCount(0);await page.screenshot({path:info.outputPath('deletion-blocked.png')});await page.keyboard.press('Escape');
  const targets=await page.evaluate(async()=>{
    const post=async(path:string,body:unknown)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(`Synthetic create ${r.status}`);return r.json();};
    const o=await post('/api/organizations',{name:'Organização sintética de exclusão'});
    const b=await post('/api/businesses',{name:'Filial sintética vazia',organizationId:o.organization.id,niche:'clinica'});
    return {org:o.organization.id,b:b.businessId};
  });
  await page.goto(`/organizacao?organization=${targets.org}&period=custom&from=2026-09-01&to=2026-09-21`);
  const organizations=page.getByRole('combobox',{name:'Selecionar organização'});
  await expect(organizations).toBeVisible();
  const otherOrg=await organizations.locator('option').evaluateAll((nodes,id)=>nodes.map(n=>(n as HTMLOptionElement).value).find(v=>v!==id)!,targets.org);
  await organizations.selectOption(otherOrg);await expect(page).toHaveURL(new RegExp(`organization=${otherOrg}.*from=2026-09-01&to=2026-09-21`));
  await organizations.selectOption(targets.org);await expect(page).toHaveURL(new RegExp(`organization=${targets.org}`));
  await page.getByRole('button',{name:'Excluir filial',exact:true}).click();d=page.getByRole('dialog');
  await d.getByLabel('Digite o nome exato: Filial sintética vazia').fill('Filial sintética vazia');
  await d.getByLabel('Senha atual').fill('Senha-incorreta-de-teste');await d.getByRole('button',{name:'Excluir filial definitivamente'}).click();
  await expect(d.getByRole('alert')).toContainText('Senha atual incorreta');await expect(d.getByLabel('Senha atual')).toHaveValue('');
  await page.screenshot({path:info.outputPath('deletion-password-rejected.png')});
  await d.getByLabel('Senha atual').fill(f.owner.password);await d.getByRole('button',{name:'Excluir filial definitivamente'}).click();
  await expect(d).toHaveCount(0);await expect(page.getByText('Esta organização ainda não possui filiais.')).toBeVisible();
  await page.getByRole('button',{name:'Verificar exclusão da organização'}).click();d=page.getByRole('dialog');
  await d.getByLabel('Digite o nome exato: Organização sintética de exclusão').fill('Organização sintética de exclusão');
  await d.getByLabel('Senha atual').fill(f.owner.password);await d.getByRole('button',{name:'Excluir organização definitivamente'}).click();
  await expect(d).toHaveCount(0);await expect(page).toHaveURL(/\/organizacao$/);
  expect(await page.evaluate(async(id)=>(await fetch('/api/entity-deletion?'+new URLSearchParams({kind:'organization',id,organizationId:id}))).status,targets.org)).toBe(403);
});

test('direction acceptance: organization failure is not zero and financial payload is withheld',async({page},info)=>{
  await login(page,f.roles.SECRETARIA);await page.goto('/organizacao');
  const data=await page.evaluate(async()=>{const r=await fetch('/api/organizations');return r.json();});
  expect(JSON.stringify(data)).not.toContain('predictedRevenue');expect(data.organizations.flatMap((o:any)=>o.units).map((u:any)=>u.id)).toEqual([f.b]);
  await expect(page.getByRole('button',{name:'Excluir filial'})).toHaveCount(0);
  await page.route('**/api/organizations*',r=>r.fulfill({status:503,json:{error:'Falha sintética controlada'}}));await page.reload();
  await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('region',{name:'Resumo consolidado'})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('organization-error.png')});
});

 test('direction acceptance: failed booking read never paints a free agenda',async({page},info)=>{
  await login(page);await page.route('**/api/bookings?**',r=>r.fulfill({status:503,json:{error:'Falha sintética na leitura'}}));
  await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=day`);await expect(page.getByRole('alert').filter({hasText:'Não foi possível carregar'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Marina.*clique para ver/})).toHaveCount(0);await page.screenshot({path:info.outputPath('agenda-load-error.png')});
 });
