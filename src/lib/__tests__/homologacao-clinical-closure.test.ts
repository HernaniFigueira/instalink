import './helpers/temp-db';
import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, writeDB, readDB } from '../db';
import { createSession } from '../auth';
import { POST as catalogPOST } from '@/app/api/catalog/route';
import fs from 'node:fs';

const BUSINESS_ID = 'b-homolog';
const OWNER_ID = 'owner-homolog';

function req(body: any, token: string) {
  return new NextRequest('http://localhost/api/catalog', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe('Homologação PR #46 — Clinical UX Closure', () => {
  let token = '';
  beforeEach(async () => {
    const db = emptyDB();
    db.users.push({ id: OWNER_ID, name: 'Dono', email: 'owner@homolog.test', passwordHash: 'x', createdAt: new Date().toISOString(), role: 'owner' } as any);
    db.businesses.push({
      id: BUSINESS_ID,
      ownerId: OWNER_ID,
      organizationId: `org-${BUSINESS_ID}`,
      name: 'Clínica Homolog',
      slug: BUSINESS_ID,
      description: '',
      logo: '',
      cover: '',
      niche: 'veterinaria',
      modes: ['services'],
      phone: '',
      whatsapp: '11999990000',
      email: '',
      instagram: '',
      tiktok: '',
      address: '',
      mapsUrl: '',
      hours: {},
      paymentMethods: [],
      pixKey: '',
      deliveryFee: 0,
      minOrder: 0,
      googleUrl: '',
      googlePlaceId: '',
      googleApiKey: '',
      booking: { teamMode: 'solo', leadMin: 30, cancelUntilMin: 60, horizonDays: 60, bufferMin: 10 },
      nav: [],
      navCustom: false,
      about: { title: '', text: '', image: '', enabled: false },
      published: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);
    // seed categories and services
    db.categories.push({ id: 'cat1', businessId: BUSINESS_ID, kind: 'service', name: 'Consulta', order: 0, active: true } as any);
    db.categories.push({ id: 'cat-orphan', businessId: BUSINESS_ID, kind: 'service', name: 'Orfã', order: 1, active: true } as any);
    db.services.push({
      id: 'svc1',
      businessId: BUSINESS_ID,
      categoryId: 'cat1',
      name: 'Consulta',
      description: 'desc',
      image: '',
      price: 10000,
      showPrice: true,
      durationMin: 30,
      professionalIds: [],
      active: true,
      featured: false,
      bookable: true,
      questions: ['Tem alergia?', 'Vacinas em dia?'],
    } as any);
    await writeDB(db);
    token = await createSession(OWNER_ID);
  });

  it('A) editar serviço sem questions no payload preserva existing.questions', async () => {
    const before = (await readDB()).services.find((s) => s.id === 'svc1');
    expect(before?.questions).toEqual(['Tem alergia?', 'Vacinas em dia?']);

    // Edit service: change name and price, omit questions
    const res = await catalogPOST(req({ businessId: BUSINESS_ID, action: 'service.save', id: 'svc1', name: 'Consulta atualizada', description: 'nova desc', price: 12000, durationMin: 45, categoryId: 'cat1', active: true, bookable: true }, token));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    const after = (await readDB()).services.find((s) => s.id === 'svc1');
    expect(after?.name).toBe('Consulta atualizada');
    // questions must be preserved because payload omitted
    expect(after?.questions).toEqual(['Tem alergia?', 'Vacinas em dia?']);

    // Now explicit empty questions should clear
    const res2 = await catalogPOST(req({ businessId: BUSINESS_ID, action: 'service.save', id: 'svc1', name: 'Consulta atualizada', description: 'nova desc', price: 12000, durationMin: 45, categoryId: 'cat1', active: true, bookable: true, questions: [] }, token));
    expect(res2.status).toBe(200);
    const after2 = (await readDB()).services.find((s) => s.id === 'svc1');
    expect(after2?.questions).toEqual([]);
  });

  it('B) categoria com serviços vinculados não é removida silenciosamente', async () => {
    // cat1 has svc1 linked
    const res = await catalogPOST(req({ businessId: BUSINESS_ID, action: 'category.delete', id: 'cat1' }, token));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/serviço/);

    // Verify category still exists and service still linked
    const db = await readDB();
    expect(db.categories.some((c) => c.id === 'cat1')).toBe(true);
    expect(db.services.some((s) => s.categoryId === 'cat1')).toBe(true);

    // Orphan category should be deletable
    const res2 = await catalogPOST(req({ businessId: BUSINESS_ID, action: 'category.delete', id: 'cat-orphan' }, token));
    expect(res2.status).toBe(200);
    const db2 = await readDB();
    expect(db2.categories.some((c) => c.id === 'cat-orphan')).toBe(false);
  });

  it('C) categoria criada/renomeada permanece kind=service', async () => {
    // Create new service category
    const res = await catalogPOST(req({ businessId: BUSINESS_ID, action: 'category.save', name: 'Vacinas', kind: 'service' }, token));
    expect(res.status).toBe(200);
    const db = await readDB();
    const created = db.categories.find((c) => c.name === 'Vacinas');
    expect(created).toBeDefined();
    expect(created?.kind).toBe('service');

    // Rename it
    const res2 = await catalogPOST(req({ businessId: BUSINESS_ID, action: 'category.save', id: created!.id, name: 'Vacinas e Vermifugação', kind: 'service' }, token));
    expect(res2.status).toBe(200);
    const db2 = await readDB();
    const renamed = db2.categories.find((c) => c.id === created!.id);
    expect(renamed?.name).toBe('Vacinas e Vermifugação');
    expect(renamed?.kind).toBe('service');
    // Ensure product kind not mistakenly set
    expect(renamed?.kind).not.toBe('product');

    // Static check: ServiceForm must not send questions
    const catalogPanels = fs.readFileSync('src/components/dashboard/catalog-panels.tsx', 'utf-8');
    expect(catalogPanels).not.toMatch(/PERGUNTAS NO AGENDAMENTO/);
    // The onSave payload in ServiceForm should not contain questions
    expect(catalogPanels).toMatch(/questions removidas da UI/);
  });
});
