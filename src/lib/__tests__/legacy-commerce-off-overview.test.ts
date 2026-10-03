// @vitest-environment node
// ═══════════════════════════════════════════════════════════════
// BLOQUEIO FINAL DA PR #51 — comércio legado NÃO contamina o Overview
// ═══════════════════════════════════════════════════════════════
// Uma unidade LEGADA pode ter modes = [services, bookings, products, orders]
// (+ quote em features). Com GODOUTOR_LEGACY_PAGES OFF, esses dados DEVEM
// continuar no storage (nada é apagado, `isFeatureEnabled` global não muda),
// mas a projeção OPERACIONAL da Dashboard/Overview mascara products/orders/
// quote: sem receita de pedido, sem painel, sem totais, sem atividade, sem
// checklist. FLAG ON preserva o comportamento legado visível.
import './helpers/temp-db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { emptyDB, writeDB } from '../db';
import { createSession, hashPassword } from '../auth';
import { biz } from './helpers/automation-fixtures';
import { dashboardContext, dashboardModules, setupChecklist } from '../dashboard';
import { operationalEnabledFeatureIds } from '../features';
import { GET } from '@/app/api/overview/route';

// Quote é resolvido por `modes` (contrato de storage antigo) — por isso a
// fixture o liga pelo mesmo vetor de compat, não por `features`.
const LEGACY = {
  modes: ['services', 'bookings', 'products', 'orders', 'quote'],
} as const;

const B_ID = 'legada-1';

function legacyBusiness() {
  return biz(B_ID, {
    name: 'Clínica Legada (era universal)',
    ownerId: OWNER,
    organizationId: 'org-1',
    modes: [...LEGACY.modes],
    published: true,
    setupSkipped: [],
  });
}

let OWNER = '';
let token = '';
const password = 'synthetic-legacy-pass!';
const todayISO = new Date().toISOString().slice(0, 10);

async function seedLegacyData() {
  OWNER = randomUUID();
  const db = emptyDB();
  db.users.push({
    id: OWNER, name: 'Dona legada', email: `${OWNER}@legacy.test`,
    passwordHash: hashPassword(password), role: 'owner', createdAt: todayISO, lastLoginAt: '',
  } as never);
  db.organizations.push({ id: 'org-1', ownerId: OWNER, name: 'Org legada', metadata: {}, createdAt: todayISO, updatedAt: todayISO } as never);
  db.businesses.push(legacyBusiness());
  db.services.push({ id: 'svc-1', businessId: B_ID, name: 'Consulta', durationMin: 30, price: 15000, active: true } as never);
  db.products.push({ id: 'prod-1', businessId: B_ID, name: 'Shampoo do salão antigo', price: 4900, active: true } as never);
  db.orders.push({
    id: 'ord-1', businessId: B_ID, code: 'A100', customerName: 'Cliente Antigo',
    phone: '11988887777', type: 'pickup', payment: 'pix', status: 'new', total: 4900,
    items: [{ productId: 'prod-1', name: 'Shampoo do salão antigo', qty: 1, unitPrice: 4900 }],
    createdAt: new Date().toISOString(),
  } as never);
  await writeDB(db);
  token = await createSession(OWNER);
}

function overviewReq() {
  return new NextRequest(`http://localhost/api/overview?businessId=${B_ID}&period=30`, {
    headers: { Authorization: `Bearer ${token}`, Origin: 'http://localhost', Host: 'localhost' },
  });
}

describe('fixture legada — projeção operacional do Clinical OS (puro)', () => {
  it('dashboardModules(business, false): products/orders/quote SAEM da projeção', () => {
    const m = dashboardModules(legacyBusiness(), false);
    expect(m).toMatchObject({ bookings: true, services: true, products: false, orders: false, quote: false });
  });

  it('dashboardModules(business, true): compatibilidade preservada', () => {
    const m = dashboardModules(legacyBusiness(), true);
    expect(m).toMatchObject({ products: true, orders: true, quote: true });
  });

  it('dashboardContext(false): sem receita de pedido, sem vocabulário de pedidos', () => {
    const off = dashboardContext(legacyBusiness(), false);
    expect(off.revenue).not.toContain('orders');
    expect(off.revenue).toContain('bookings');
    expect(off.labels.showsOrders).toBe(false);
    expect(off.labels.showsProducts).toBe(false);
    expect(off.labels.activityUnit).toBe('atendimentos');
    expect(off.kpis).not.toContain('orders');
    expect(off.panels).not.toContain('orders');
    const on = dashboardContext(legacyBusiness(), true);
    expect(on.revenue).toContain('orders');
    expect(on.labels.showsOrders).toBe(true);
  });

  it('setupChecklist: legacyPages=false NUNCA adiciona Products, mesmo com módulo true (defensivo)', () => {
    const items = setupChecklist({
      business: { description: '', logo: '', cover: '', whatsapp: '11', phone: '', address: '', published: true, setupSkipped: [] },
      modules: { ...dashboardModules(legacyBusiness(), true) },
      counts: { services: 1, availability: 0, professionals: 0, products: 2 },
      legacyPages: false,
    });
    expect(items.map((i) => i.id)).not.toContain('products');
    expect(items.map((i) => i.label).join(' ')).not.toMatch(/vitrine|produtos|pedidos/i);
    expect(items.map((i) => i.href).join(' ')).not.toMatch(/\/produtos|\/pedidos/);
    // com a flag ON o item volta (dado legado visível no ramo de compat)
    const on = setupChecklist({
      business: { description: '', logo: '', cover: '', whatsapp: '11', phone: '', address: '', published: true, setupSkipped: [] },
      modules: { ...dashboardModules(legacyBusiness(), true) },
      counts: { services: 1, availability: 0, professionals: 0, products: 2 },
      legacyPages: true,
    });
    expect(on.map((i) => i.id)).toContain('products');
  });

  it('operationalEnabledFeatureIds: OFF remove products/orders/quote; ON preserva', () => {
    expect(operationalEnabledFeatureIds(legacyBusiness(), false)).toEqual(
      expect.arrayContaining(['bookings', 'services']),
    );
    const off = operationalEnabledFeatureIds(legacyBusiness(), false);
    expect(off).not.toContain('products');
    expect(off).not.toContain('orders');
    expect(off).not.toContain('quote');
    const on = operationalEnabledFeatureIds(legacyBusiness(), true);
    expect(on).toContain('products');
    expect(on).toContain('orders');
    expect(on).toContain('quote');
  });
});

describe('GET /api/overview — unidade legada com dados de commerce', () => {
  const savedFlag = process.env.GODOUTOR_LEGACY_PAGES;
  beforeEach(async () => { await seedLegacyData(); });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.GODOUTOR_LEGACY_PAGES;
    else process.env.GODOUTOR_LEGACY_PAGES = savedFlag;
  });

  it('FLAG OFF: nada comercial entra no payload operacional', async () => {
    delete process.env.GODOUTOR_LEGACY_PAGES;
    const res = await GET(overviewReq());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.context.modules.products).toBe(false);
    expect(data.context.modules.orders).toBe(false);
    expect(data.context.modules.quote).toBe(false);
    expect(data.context.modules.bookings).toBe(true);
    expect(data.context.modules.services).toBe(true);

    expect(data.recent.orders).toEqual([]);
    expect(data.ordersPanel).toBeNull();
    expect(data.productsPanel).toBeNull();
    expect(data.totals.orders).toBe(0);
    expect(data.totals.newOrders).toBe(0);
    expect(data.revenueDetail.orders).toBeNull();
    expect(data.revenueDetail.sources).not.toContain('orders');
    expect(data.revenueDetail.sources).toContain('bookings');
    expect(data.hasOrdersModule).toBe(false);
    expect(data.hasProductsModule).toBe(false);
    // compat antigo: sem fontes comerciais na projeção, `revenue` some (não cai
    // em fallback de pedido)
    expect(data.revenue.kind).toBe('bookings');

    // payload `modules` = projeção operacional, não o storage
    expect(data.modules).not.toContain('products');
    expect(data.modules).not.toContain('orders');
    expect(data.modules).not.toContain('quote');
    expect(data.modules).toContain('bookings');

    // checklist sem Produtos/Pedidos/Vitrine (e sem href proibido)
    const labels = (data.checklist || []).map((i: { label: string }) => i.label).join(' ');
    const hrefs = (data.checklist || []).map((i: { href: string }) => i.href).join(' ');
    expect(labels).not.toMatch(/Produtos|Pedidos|Vitrine/i);
    expect(hrefs).not.toMatch(/\/produtos|\/pedidos/);

    // DADOS INTACTOS: a projeção não tocou no storage (nada foi apagado)
    const { readDB } = await import('../db');
    const db = await readDB();
    expect(db.businesses.find((b) => b.id === B_ID)!.modes).toEqual(
      expect.arrayContaining(['products', 'orders']),
    );
    expect(db.orders).toHaveLength(1);
    expect(db.products).toHaveLength(1);
  });

  it('FLAG ON: mesma fixture continua visível/funcional (compat)', async () => {
    process.env.GODOUTOR_LEGACY_PAGES = '1';
    const res = await GET(overviewReq());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.context.modules.products).toBe(true);
    expect(data.context.modules.orders).toBe(true);
    expect(data.hasOrdersModule).toBe(true);
    expect(data.hasProductsModule).toBe(true);
    expect(data.ordersPanel).toMatchObject({ total: 1, new: 1, open: 1 });
    expect(data.productsPanel).toMatchObject({ total: 1, active: 1 });
    expect(data.totals.orders).toBe(1);
    expect(data.totals.newOrders).toBe(1);
    expect(data.recent.orders).toHaveLength(1);
    expect(data.revenueDetail.orders).not.toBeNull();
    expect(data.revenueDetail.sources).toContain('orders');
    const labels = (data.checklist || []).map((i: { label: string }) => i.label).join(' ');
    expect(labels).toMatch(/vitrine/i); // 'Monte sua vitrine de produtos' (done) segue no ramo ON
  });
});
