// Run against next start + scripts/seed-clinical-ux-qa.mjs only.
// Optional QA_CHROMIUM_MODULE provides a serverless Chromium package when CDN is unavailable.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
if (process.env.DATABASE_URL || !['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw Error('Local disposable QA only');
const options = {headless:true};
if (process.env.QA_CHROMIUM_MODULE) { const {default:c} = await import(process.env.QA_CHROMIUM_MODULE); Object.assign(options,{executablePath:await c.executablePath(),args:c.args.filter(arg => arg !== '--single-process')}); }
const browser = await chromium.launch(options);
const b = 'andrioni-vet-qa', date = process.env.QA_DATE || '2026-10-06';
const result={checks:[],console:[],network:[]};
const ok = label => {result.checks.push(label); console.log('PASS',label);};
await fs.mkdir('.cache/clinical-ux',{recursive:true});
async function login(email, viewport={width:1440,height:1000}) {
  const context=await browser.newContext({viewport}); const page=await context.newPage();
  page.on('pageerror',e=>result.console.push(e.message));
  page.on('console',m=>{if(m.type()==='error')result.console.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)result.network.push({status:r.status(),url:r.url()});});
  await page.goto(base+'/login'); await page.locator('input[type=email]').fill(email); await page.locator('input[type=password]').fill('GodoutorQA2026!');
  await page.getByRole('button',{name:'Entrar',exact:true}).click(); await page.waitForURL(/dashboard|agenda/);
  ok('Login real '+email); return page;
}
async function agenda(page,day=date){await page.goto(`${base}/agenda?b=${b}&data=${day}&view=day`);await page.locator('[data-agenda-column]').first().waitFor();}
async function range(page,pro='pro-orlando') {
  const box=await page.locator(`[data-agenda-column-professional="${pro}"]`).boundingBox();
  await page.mouse.move(box.x+80,box.y+128);await page.mouse.down();await page.mouse.move(box.x+80,box.y+640,{steps:20});await page.mouse.up();
}
async function close(page){await page.getByRole('button',{name:'Fechar',exact:true}).first().click();}
try {
 const p=await login('owner.qa@godoutor.local'); await agenda(p);
 let box=await p.locator('[data-agenda-column-professional="pro-orlando"]').boundingBox();
 await p.mouse.click(box.x+80,box.y+128);
 await p.getByRole('heading',{name:'Novo agendamento',exact:true}).waitFor();
 assert.equal(await p.getByLabel('Profissional',{exact:true}).inputValue(),'pro-orlando');
 assert.match(await p.getByTestId('booking-range-summary').innerText(),/09:00/);ok('Clique abre direto com Orlando e 09:00');await close(p);
 await range(p);await p.getByRole('heading',{name:'Novo agendamento',exact:true}).waitFor();
 assert.match(await p.getByTestId('booking-range-summary').innerText(),/09:00 · Fim: 13:00 · Duração: 240 min/);
 assert.equal(await p.getByTestId('agenda-selected-range').count(),1);
 assert.equal(await p.getByLabel('Duração deste atendimento em minutos').isVisible(),false);
 await p.screenshot({path:'.cache/clinical-ux/range-final.png'});ok('Range 240 + seleção persistente + duração recolhida');
 await close(p); assert.equal(await p.getByTestId('agenda-selected-range').count(),0);ok('Fechar limpa seleção');
 // Save the selected four-hour appointment through the real clinical UI.
 await range(p);await p.getByRole('searchbox',{name:'Buscar cliente'}).fill('Ana');
 await p.getByRole('button',{name:/Ana Tutora QA/}).click();
 await p.getByLabel('2. Serviço',{exact:false}).selectOption('svc-consulta');
 await p.getByLabel('Pet (paciente)',{exact:false}).selectOption('qa-pet');
 await p.getByRole('button',{name:'09:00',exact:true}).waitFor();
 await p.getByRole('button',{name:'Salvar agendamento',exact:true}).click();
 await p.locator('[data-booking-created="true"]').waitFor();
 assert.equal(await p.getByTestId('agenda-selected-range').count(),0);
 const bookings=await p.evaluate(async url => { const r=await fetch(url); if(!r.ok)throw Error(`QA API ${r.status}`); return r.json(); }, `/api/bookings?mode=manage&businessId=${b}&from=${date}&to=${date}`);
 const stored=bookings.bookings.find(x=>x.date===date&&x.time==='09:00'&&x.professionalId==='pro-orlando');
 assert.equal(stored.durationMin,240);assert.equal(Date.parse(stored.endAt)-Date.parse(stored.startAt),240*60000);ok('Booking salvo: start/end UTC e staffDuration 240');
 await close(p); await p.getByRole('button',{name:'Bloquear horário',exact:true}).click();await range(p,'pro-michele');
 await p.getByRole('heading',{name:'Bloquear horário',exact:true}).waitFor();
 assert.equal(await p.getByLabel('Início',{exact:true}).inputValue(),'09:00');assert.equal(await p.getByLabel('Fim',{exact:true}).inputValue(),'13:00');
 await p.getByLabel('Motivo (opcional)',{exact:true}).fill('Clinical UX QA');
 await p.getByRole('button',{name:'Criar bloqueio',exact:true}).click();
 await p.getByRole('heading',{name:'Bloquear horário',exact:true}).waitFor({state:'hidden'});
 assert.equal(await p.getByTestId('agenda-selected-range').count(),0);ok('Bloqueio range 09–13 salvo sem timezone vazio');
 await p.reload();await p.getByRole('heading',{name:'Bloqueios operacionais · não são atendimentos'}).waitFor();ok('Bloqueio persiste após F5');
 await p.goto(`${base}/servicos?b=${b}`);await p.getByRole('button',{name:'Novo serviço',exact:true}).click();
 await p.getByRole('combobox',{name:'Serviço / procedimento'}).focus();
 assert.ok(await p.getByRole('option').count()>0);await p.getByRole('combobox',{name:'Serviço / procedimento'}).fill('Vacinação');await p.getByRole('option').first().click();
 assert.ok(Number(await p.getByLabel('Duração padrão em minutos').inputValue())>0);
 assert.equal(await p.getByLabel('Preparação antes (min)').isVisible(),false);assert.equal(await p.getByLabel('Observação interna').isVisible(),false);
 await p.getByText('Agenda e recursos · avançado',{exact:true}).click();assert.equal(await p.getByLabel('Preparação antes (min)').isVisible(),true);ok('Biblioteca, grupo/duração sugeridos, avançado fechado e buffers disponíveis');
 await p.goto(`${base}/clientes?b=${b}`);await p.getByText('Ana Tutora QA',{exact:true}).first().click();await p.waitForURL(/clientes\//);await p.getByRole('button',{name:'Novo agendamento',exact:true}).waitFor();
 const body=await p.locator('body').innerText();for(const text of ['Acesso ativo','Sem acesso','Criar acesso','Conta do cliente','promoções','Aceitou','Não aceitou'])assert.ok(!body.includes(text),text);
 assert.equal(await p.getByRole('link',{name:'WhatsApp',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(240, 253, 244)');
 await p.evaluate(()=>window.scrollTo(0,600));
 assert.equal(await p.locator('.gd-context-header').evaluate(el=>getComputedStyle(el).position),'sticky');
 const toolbar=await p.locator('.gd-context-header').boundingBox();assert.ok(toolbar.y>=55&&toolbar.y<150,JSON.stringify(toolbar));
 await p.screenshot({path:'.cache/clinical-ux/client-final.png'});ok('Cliente sem acesso/marketing, WhatsApp verde, header sticky abaixo da topbar');
 await p.goto(`${base}/perfil?b=${b}`);await p.getByRole('button',{name:'Salvar alterações',exact:true}).waitFor();assert.equal(await p.getByTestId('shell-appearance').count(),0);
 const saveResponse=p.waitForResponse(r=>r.request().method()!=='GET'&&r.url().includes('/api/'));
 await p.getByRole('button',{name:'Salvar alterações',exact:true}).click();
 // The profile endpoint can use POST in older builds; UI success is canonical for this smoke.
 assert.equal((await saveResponse).status(),200);ok('Meu perfil sem aparência; salvar integrado ao formulário');
 await p.goto(`${base}/configuracoes?b=${b}&tab=aparencia`);await p.getByTestId('nav-accent-teal').click();await p.reload();assert.equal(await p.getByTestId('nav-accent-teal').getAttribute('aria-pressed'),'true');await p.getByTestId('nav-accent-azul-profundo').click();ok('Aparência nas configurações persiste em F5');
 await agenda(p,'2026-10-05');const fit=p.locator('button.ag-event').filter({hasText:'ENCAIXE'});await fit.scrollIntoViewIfNeeded();assert.ok((await fit.getAttribute('class')).includes('bg-[var(--success-bg)]'));assert.equal(await fit.locator('span').filter({hasText:/^ENCAIXE$/}).last().evaluate(el=>getComputedStyle(el).color),'rgb(154, 52, 18)');await p.screenshot({path:'.cache/clinical-ux/fit-in-final.png'});ok('Encaixe laranja sem substituir status verde');
 await p.context().close();
 for(const role of ['recepcao','orlando']) {
  const page=await login(`${role}.qa@godoutor.local`,{width:1024,height:900});await agenda(page);
  const cols=await page.locator('[data-agenda-column]').count();assert.equal(cols,role==='orlando'?1:3);ok(`${role}: escopo ${cols} colunas`);
  await page.goto(`${base}/clientes?b=${b}`);await page.getByText('Ana Tutora QA',{exact:true}).first().waitFor();ok(`${role}: cliente vinculado acessível`);await page.context().close();
 }
 assert.equal(result.console.length,0,JSON.stringify(result.console));assert.equal(result.network.length,0,JSON.stringify(result.network));ok('Console 0; network >=400 0; 5xx 0');
} finally { await fs.writeFile('.cache/clinical-ux/browser-report.json',JSON.stringify(result,null,2));await browser.close(); }
