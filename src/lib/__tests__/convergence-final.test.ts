// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// CORREÇÃO FINAL DA CONVERGÊNCIA — produto ativo 100% clínico
// ═══════════════════════════════════════════════════════════════
// Blocos 1–6 da correção pedida na PR #51, travados por teste:
//   A · onboarding OFF sem pergunta comercial nem `modes`; catálogo de
//       Recursos sem produtos/orders/quote ativáveis; /produtos e /pedidos
//       não abrem tela operacional no OFF (estado legado, nada apagado);
//   B · flag ON preserva o ramo de compatibilidade (payload, catálogo, telas);
//   C · branding package.json/.env.example sem InstaLink na prosa ativa;
//   D · identificadores ativos godoutor + dual-read de localStorage com
//       migração e NENHUM evento `il:*` novo em produção (só os declarados
//       de compat: cookies il_session/il_cust_session/il_support, headers
//       X-Instalink-*, embed data-instalink-*, tabela instalink_doc).
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  businessCreationPayload, clinicTypeOptions, modesForServiceModel,
  showsServiceModelQuestion, startWithItems,
} from '../onboarding';
import { offeredFeatures, isCommerceFeature, isFeatureEnabled, isLegacyFeature } from '../features';
import { blockedLegacySurface, isHiddenLegacyNavRoute, LEGACY_OPERATIONAL_ROUTES } from '../legacy-surfaces';
import { setupChecklist, type DashboardModules } from '../dashboard';
import {
  TOKEN_STORAGE_KEY, TOKEN_STORAGE_KEY_LEGACY, CUSTOMER_STORAGE_KEY, CUSTOMER_STORAGE_KEY_LEGACY,
  saveToken, getToken, clearToken, saveCustomerToken, getCustomerToken, clearCustomerToken,
  SESSION_EXPIRED_EVENT, FORBIDDEN_EVENT,
} from '../client-auth';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const MODULES_ALL_OFF: DashboardModules = {
  bookings: false, services: false, products: false, orders: false, quote: false, whatsapp: false, agent: false, reviews: false,
};
const CLINICAL: DashboardModules = { ...MODULES_ALL_OFF, bookings: true, services: true };
const BUSINESS = { description: 'x', logo: '', cover: '', whatsapp: '11', phone: '', address: '', published: false };
const COUNTS = { services: 0, availability: 0, professionals: 0, products: 0 };

describe('A1 · onboarding OFF: pergunta comercial fora da tela, payload sem modes', () => {
  it('OFF: businessCreationPayload NÃO envia `modes` (base = decisão server-side)', () => {
    const body = businessCreationPayload({
      legacyPagesEnabled: false, name: 'Clínica Vida', whatsapp: '1199', slug: 'clinica-vida',
      clinicType: 'medica', model: null,
    });
    expect(body).not.toHaveProperty('modes');
    expect(body.name).toBe('Clínica Vida');
    expect(body.clinicType).toBe('medica');
  });

  it('a base canônica services + bookings vem do servidor (NEW_BUSINESS_DEFAULTS)', () => {
    const templates = read('src/lib/templates.ts');
    expect(templates).toMatch(/NEW_BUSINESS_DEFAULTS[\s\S]{0,220}modes:\s*\['services',\s*'bookings'\]/);
    const route = read('src/app/api/businesses/route.ts');
    // corpo sem modes → default canônico; corpo com modes → apenas compat.
    expect(route).toMatch(/NEW_BUSINESS_DEFAULTS\.modes/);
  });

  it('OFF: tipos de clínica sem porta "não é clínica" e com rótulo clínico para geral', () => {
    const opts = clinicTypeOptions(false);
    const joined = JSON.stringify(opts);
    expect(joined).not.toMatch(/salão|salao|estúdio|estudio|pizzaria|hamburgueria|restaurante|vitrine/i);
    expect(joined).not.toContain('Outro tipo de negócio');
    const geral = opts.find((o) => o.id === 'geral')!;
    expect(geral.label).toBe('Clínica geral / outro tipo de clínica');
    expect(geral.hint).toBe('Para clínicas e consultórios cuja especialidade ainda não possui preset específico.');
  });

  it('OFF: "Você começa com" é a lista fixa do padrão clínico, sem produtos/página', () => {
    const items = startWithItems(false, null);
    expect(items.map((i) => i.text)).toEqual([
      'Agenda de atendimentos ativa',
      'Catálogo de serviços com agendamento',
      'Painel pronto para uso',
    ]);
    expect(JSON.stringify(items)).not.toMatch(/vitrine|produtos|página pública/i);
    expect(showsServiceModelQuestion(false)).toBe(false);
  });

  it('a página renderiza o fieldset comercial SOMENTE sob o gate da flag', () => {
    const src = read('src/app/onboarding/page.tsx');
    expect(src).toMatch(/\{showsServiceModelQuestion\(legacyPagesEnabled\) && \(/);
    // nenhum modo de venda fora do gate; o submit usa o payload canônico.
    expect(src).toMatch(/body: JSON\.stringify\(businessCreationPayload\(\{/);
    expect(src).not.toMatch(/modes: modesForServiceModel\(model\)/);
    // placeholder de nome clínico no OFF; exemplos antigos só no ramo ON.
    expect(src).toContain("'Ex: Clínica Vida, Odonto Vitta, VetCare'");
    expect(src).toContain("legacyPagesEnabled ? 'Ex: Studio Bela Vida, Clínica Odonto Sorriso, Estúdio Pilates Fluxo'");
  });
});

describe('A2 · Recursos/catálogo: nenhum módulo comercial ativável no OFF', () => {
  it('OFF: products/orders/quote fora da lista oferecida; clínicos presentes', () => {
    const ids = offeredFeatures(false).map((f) => f.id);
    expect(ids).not.toContain('products');
    expect(ids).not.toContain('orders');
    expect(ids).not.toContain('quote');
    expect(ids).toContain('bookings');
    expect(ids).toContain('services');
  });

  it('orders/quote já são legado puro; products é o único comercial em FEATURES', () => {
    expect(isLegacyFeature('orders')).toBe(true);
    expect(isLegacyFeature('quote')).toBe(true);
    expect(isCommerceFeature('products')).toBe(true);
    expect(isCommerceFeature('services')).toBe(false);
    expect(offeredFeatures(true).some((f) => f.id === 'products')).toBe(true);
    // catálogo completo nunca contém os legados (nem ON): só o OFF tira o commerce.
    expect(offeredFeatures(true).some((f) => f.id === 'orders')).toBe(false);
  });

  it('resolução não muda: dados legados com products continuam ENABLED (compat)', () => {
    expect(isFeatureEnabled({ modes: ['products'], features: {} } as any, 'products')).toBe(true);
  });

  it('API: estado vem filtrado pela flag e ativar comercial no OFF responde 410', () => {
    const src = read('src/app/api/businesses/[id]/features/route.ts');
    expect(src).toMatch(/offeredFeatureState\(guard\.ctx\.business, isLegacyPagesEnabled\(\)\)/);
    expect(src).toMatch(/isCommerceFeature\(feature\) && enabled/);
    expect(src).toMatch(/status: 410/);
    // a linha de vitrine só existe no ramo ON da tela
    expect(read('src/app/(dashboard)/recursos/page.tsx')).toMatch(/legacyPagesEnabled && !row\.enabled && row\.id === 'products'/);
  });

  it('checklist clínico OFF não menciona a Página; ON preserva o caminho antigo', () => {
    const off = setupChecklist({ business: { ...BUSINESS }, modules: CLINICAL, counts: COUNTS, legacyPages: false });
    expect(off.map((i) => i.id)).not.toContain('personalize');
    expect(off.map((i) => i.id)).not.toContain('publish');
    expect(off.map((i) => i.href).join()).not.toContain('/pagina');
    const on = setupChecklist({ business: { ...BUSINESS }, modules: CLINICAL, counts: COUNTS, legacyPages: true });
    expect(on.map((i) => i.id)).toContain('publish');
    // unidade legada COM products (dados preservados) mantém o item no ON…
    const legacyUnit = setupChecklist({ business: { ...BUSINESS }, modules: { ...CLINICAL, products: true }, counts: COUNTS, legacyPages: true });
    expect(legacyUnit.map((i) => i.id)).toContain('products');
    // …e o item comercial só nasce de módulo JÁ ativo — nunca de unidade nova.
    expect(off.map((i) => i.id)).not.toContain('products');
  });
});

describe('A3 · rotas comerciais: OFF não abre tela operacional (estado legado)', () => {
  it('/produtos e /pedidos retornam estado bloqueado com destino clínico', () => {
    const p = blockedLegacySurface('/produtos', false)!;
    expect(p.title).toBe('Recurso legado indisponível');
    expect(p.href).toBe('/servicos');
    const o = blockedLegacySurface('/pedidos', false)!;
    expect(o.href).toBe('/agenda');
    expect(o.hint).not.toMatch(/apagad|deletad/i);
    expect(o.hint).toMatch(/preservam|permanecem/i);
  });

  it('/agenda e /dashboard nunca são bloqueados', () => {
    expect(blockedLegacySurface('/agenda', false)).toBeNull();
    expect(blockedLegacySurface('/dashboard', false)).toBeNull();
  });

  it('as duas páginas usam o gate e o shell esconde nav+busca no OFF', () => {
    expect(read('src/app/(dashboard)/produtos/page.tsx')).toMatch(/blockedLegacySurface\('\/produtos', legacyPagesEnabled\)/);
    expect(read('src/app/(dashboard)/pedidos/page.tsx')).toMatch(/blockedLegacySurface\('\/pedidos', legacyPagesEnabled\)/);
    expect(read('src/components/DashboardShell.tsx')).toMatch(/!isHiddenLegacyNavRoute\(route\.href, legacyPagesEnabled\)/);
    expect(LEGACY_OPERATIONAL_ROUTES).toEqual(['/produtos', '/pedidos']);
  });

  it('/pagina continua fora da nav OFF e volta com a flag (não foi 404-izada)', () => {
    expect(isHiddenLegacyNavRoute('/pagina', false)).toBe(true);
    expect(isHiddenLegacyNavRoute('/pagina', true)).toBe(false);
    expect(blockedLegacySurface('/pagina', true)).toBeNull();
    expect(blockedLegacySurface('/pagina', false)!.href).toBe('/dashboard');
  });
});

describe('B · flag ON: compatibilidade intacta onde necessária', () => {
  it('ON: pergunta comercial existe, payload escolhe a base, vitrine no catálogo', () => {
    expect(showsServiceModelQuestion(true)).toBe(true);
    const body = businessCreationPayload({
      legacyPagesEnabled: true, name: 'Pizzaria', whatsapp: '', slug: 'p', clinicType: 'geral', model: 'ambos',
    });
    expect(body.modes).toEqual(modesForServiceModel('ambos'));
    expect((body.modes as string[])).toContain('products');
    const geral = clinicTypeOptions(true).find((o) => o.id === 'geral')!;
    expect(geral.label).toBe('Outro tipo de negócio');
  });

  it('ON: telas legadas abrem e catálogo oferece Produtos', () => {
    expect(blockedLegacySurface('/produtos', true)).toBeNull();
    expect(blockedLegacySurface('/pedidos', true)).toBeNull();
    expect(isHiddenLegacyNavRoute('/produtos', true)).toBe(false);
    expect(offeredFeatures(true).map((f) => f.id)).toContain('products');
  });

  it('ON: startWith reflete o modelo escolhido (inclusive vitrine)', () => {
    const items = startWithItems(true, 'produtos').map((i) => i.text);
    expect(items.join(' | ')).toContain('Vitrine de produtos com CTA no WhatsApp');
  });
});

describe('C · branding: pacote e .env.example falam GoDoutor', () => {
  it('package.json traz a descrição canônica do produto', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.name).toBe('godoutor');
    expect(pkg.description).toBe('GoDoutor Clinical OS — sistema operacional multi-tenant para clínicas.');
  });

  it('package-lock permanece coerente com o nome canônico', () => {
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.name).toBe('godoutor');
    expect(lock.packages['']).toHaveProperty('name', 'godoutor');
  });

  it('.env.example não nomeia o produto como InstaLink na prosa ativa', () => {
    const lines = read('.env.example').split('\n');
    for (const line of lines) {
      if (!/instalink/i.test(line)) continue;
      // toda menção restante é LEGADA DECLARADA (arquivo/caminho antigo, alias, header de protocolo).
      expect(line, line).toMatch(/legado|alias|data\/instalink\.db\.json|INSTALINK_DB_FILE|X-Instalink/i);
    }
    expect(lines.join('\n')).toContain('GoDoutor');
  });
});

describe('D · identificadores: namespace godoutor com migração dual-read', () => {
  beforeEach(() => {
    localStorage.clear();
    clearToken();
    clearCustomerToken();
  });

  it('chaves canônicas novas; legado só como nome de fallback declarado', () => {
    expect(TOKEN_STORAGE_KEY).toBe('godoutor_token');
    expect(TOKEN_STORAGE_KEY_LEGACY).toBe('il_token');
    expect(CUSTOMER_STORAGE_KEY).toBe('godoutor_customer');
    expect(CUSTOMER_STORAGE_KEY_LEGACY).toBe('il_cust');
  });

  it('getToken promove o valor legado (il_token) para o canônico e limpa o antigo', () => {
    localStorage.setItem(TOKEN_STORAGE_KEY_LEGACY, 'TOKEN-LEGADO');
    expect(getToken()).toBe('TOKEN-LEGADO');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('TOKEN-LEGADO');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY_LEGACY)).toBeNull();
  });

  it('canônico vence quando os dois existem (leitura não regride para o legado)', () => {
    clearToken(); // zera memória antes de semear as duas chaves
    localStorage.setItem(TOKEN_STORAGE_KEY, 'NOVO');
    localStorage.setItem(TOKEN_STORAGE_KEY_LEGACY, 'VELHO');
    expect(getToken()).toBe('NOVO');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('NOVO');
  });

  it('saveToken grava no canônico e remove o legado; clearToken limpa os dois', () => {
    localStorage.setItem(TOKEN_STORAGE_KEY_LEGACY, 'VELHO');
    saveToken('NOVO');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('NOVO');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY_LEGACY)).toBeNull();
    clearToken();
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('token do consumidor segue o mesmo contrato (il_cust → godoutor_customer)', () => {
    localStorage.setItem(CUSTOMER_STORAGE_KEY_LEGACY, 'CUST-LEGADO');
    expect(getCustomerToken()).toBe('CUST-LEGADO');
    expect(localStorage.getItem(CUSTOMER_STORAGE_KEY)).toBe('CUST-LEGADO');
    saveCustomerToken('CUST-NOVO');
    expect(localStorage.getItem(CUSTOMER_STORAGE_KEY)).toBe('CUST-NOVO');
    expect(localStorage.getItem(CUSTOMER_STORAGE_KEY_LEGACY)).toBeNull();
  });

  it('nenhum literal de evento "il:*" sobrevive no código; eventos são godoutor:*', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { walk(f); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        const src = fs.readFileSync(f, 'utf8');
        const hits = src.match(/["'`](il:[a-z-]+)["'`]/g);
        if (hits) offenders.push(`${path.relative(root, f)}: ${hits.join(' ')}`);
      }
    };
    walk(path.join(root, 'src'));
    expect(offenders).toEqual([]);
    expect(SESSION_EXPIRED_EVENT).toBe('godoutor:session-expired');
    expect(FORBIDDEN_EVENT).toBe('godoutor:forbidden');
    const ac = read('src/lib/api-client.ts');
    expect(ac).toContain("new Event('godoutor:overview-refresh')");
    const wn = read('src/components/dashboard/WorkspaceNavigation.tsx');
    expect(wn).toContain("addEventListener('godoutor:overview-refresh'");
    expect(wn).toContain("addEventListener('godoutor:business-refresh'");
  });

  it('produtores/consumidores do shell e das páginas usam o nome novo', () => {
    for (const f of ['src/app/(dashboard)/recursos/page.tsx', 'src/app/(dashboard)/organizacao/page.tsx', 'src/components/DashboardShell.tsx', 'src/components/dashboard/NotificationsBell.tsx']) {
      expect(read(f), f).toContain('godoutor:business-refresh');
    }
  });

  it('localStorage persistente só fala `il-` com par de migração declarado', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { walk(f); continue; }
        if (!/\.tsx?$/.test(e.name) || f.includes('__tests__')) continue;
        const src = fs.readFileSync(f, 'utf8');
        const usesLegacyKey = /localStorage\.\w+Item\(\s*[`'"]il-/.test(src);
        if (usesLegacyKey && !src.includes('godoutor')) offenders.push(path.relative(root, f));
      }
    };
    walk(path.join(root, 'src'));
    expect(offenders).toEqual([]);
    // preferência da sidebar e carrinho: chave canônica declarada no mesmo arquivo
    expect(read('src/components/DashboardShell.tsx')).toContain("'godoutor-side-v2'");
    expect(read('src/components/public/widgets.tsx')).toContain('`godoutor-cart-');
  });

  it('compat congelada permanece declarada (cookies/protocolo não renomeados à toa)', () => {
    const auth = read('src/lib/auth.ts');
    expect(auth).toContain("export const LEGACY_COOKIE_NAME = 'il_session'");
    expect(auth).toContain('godoutor_session');
    expect(read('src/lib/customer-auth.ts')).toContain("export const CUSTOMER_COOKIE = 'il_cust_session'");
    expect(read('src/lib/access.ts')).toContain("export const SUPPORT_COOKIE = 'il_support'");
    // rascunho do onboarding também migrou com dual-read
    const ob = read('src/app/onboarding/page.tsx');
    expect(ob).toContain("'godoutor-biz-draft'");
    expect(ob).toContain("'il-biz-draft'");
  });
});
