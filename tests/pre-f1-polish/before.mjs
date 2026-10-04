import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const {default:c}=await import(process.env.QA_CHROMIUM_MODULE);
if(process.env.DATABASE_URL)throw Error('Local QA only');
const dir='/home/user/polish-before';await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({executablePath:await c.executablePath(),args:c.args.filter(a=>a!=='--single-process')});
const p=await browser.newPage({viewport:{width:1440,height:1100}});await p.goto('http://127.0.0.1:3000/login');await p.locator('[type=email]').fill('owner.qa@godoutor.local');await p.locator('[type=password]').fill('GodoutorQA2026!');await p.getByRole('button',{name:'Entrar',exact:true}).click();await p.waitForURL(/agenda|dashboard/);
const go=async route=>{await p.goto('http://127.0.0.1:3000/'+route+(route.includes('?')?'&':'?')+'b=andrioni-vet-qa');await p.waitForTimeout(800)};
for(const route of ['dashboard','configuracoes?tab=agenda','configuracoes?tab=aparencia','disponibilidade','estrutura']){await go(route);await p.screenshot({path:dir+'/'+route.replace(/\W/g,'-')+'.png'});}
await go('agenda?data=2026-11-16&view=day');const box=await p.locator('[data-agenda-column-professional="pro-michele"]').boundingBox();await p.mouse.move(box.x+50,box.y+165*128/60);await p.mouse.down();await p.mouse.move(box.x+50,box.y+360*128/60,{steps:25});await p.mouse.up();await p.getByLabel('2. Serviço',{exact:false}).selectOption('svc-consulta');await p.waitForTimeout(900);await p.screenshot({path:dir+'/range-with-slots.png'});
await go('agenda?data=2026-11-16&view=day');await p.getByRole('button',{name:'Bloquear horário',exact:true}).click();await p.waitForTimeout(300);await p.screenshot({path:dir+'/block.png'});await browser.close();
