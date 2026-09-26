// ═══════════════════════════════════════════════════════════════
// FASE C — BUSCA GLOBAL AGRUPADA (pessoas · pets · agendamentos · conversas)
// ═══════════════════════════════════════════════════════════════
// Requisito da missão: a busca encontra Bernardo (pessoa), o PET dele e as
// ROTAS do painel — agrupada, com destino que abre de verdade. Aqui se prova:
//   1. a parte PURA (lib/entity-search.ts): nome, telefone com dígitos,
//      agrupamento com limite por grupo;
//   2. a ROTA REAL (/api/search): Bernardo aparece com href da ficha 360,
//      o pet Greg leva ao tutor, agendamento leva ao dia, conversa leva à
//      conversa — e GRUPOS respeitam permissão (professional vê só a própria
//      agenda; sem whatsapp não existem conversas na resposta).
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as searchGET } from '@/app/api/search/route';
import { buildNavSearchItems } from '../nav-search';
import { panelNavigation } from '../panel';
import { searchNav } from '../nav-search';
import {
  entityMatches, groupEntityHits, foldText, digitsOnly,
} from '../entity-search';
import type { Business, DB, BusinessMember } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BUSINESS_ID = 'biz-search';
const OWNER_ID = 'owner-search';

function business(): Business {
  return {
    id: BUSINESS_ID, ownerId: OWNER_ID, organizationId: 'org-search',
    name: 'Clínica da Busca', slug: 'busca', description: '', logo: '', cover: '',
    niche: 'saude', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: true, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 30, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW,
  } as Business;
}

/** Bernardo (tutor) + Greg (pet): o par do audit 360 — Responsável ≠ Paciente. */
async function seed() {
  const db: DB = emptyDB();
  db.users.push({ id: OWNER_ID, name: 'Dono Busca', email: 'owner@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.businesses.push(business());
  db.contacts.push({
    id: 'ct-bernardo', businessId: BUSINESS_ID, customerId: '',
    name: 'Bernardo Almeida', phone: '21988966462', email: 'bernardo@example.com',
    createdAt: NOW, updatedAt: NOW, source: 'manual', lastInteraction: NOW, marketingOptIn: false,
  } as any);
  db.pets.push({
    id: 'pet-greg', businessId: BUSINESS_ID, tutorId: 'ct-bernardo', name: 'Greg',
    photo: '', species: 'cachorro', breed: 'labrador', sex: 'M', birthDate: '2020-01-10',
    weightKg: 0, notes: '', active: true, createdAt: NOW, updatedAt: NOW,
  } as any);
  db.services.push({
    id: 'srv-consulta', businessId: BUSINESS_ID, name: 'Consulta', description: '',
    price: 15000, durationMin: 30, active: true, order: 0, createdAt: NOW, updatedAt: NOW,
  } as any);
  db.professionals.push({
    id: 'pro-dra', businessId: BUSINESS_ID, name: 'Dra. Marta', role: '', active: true,
    services: ['srv-consulta'], createdAt: NOW, updatedAt: NOW,
  } as any);
  db.bookings.push({
    id: 'bk-1', businessId: BUSINESS_ID, serviceId: 'srv-consulta', professionalId: 'pro-dra',
    customerId: '', customerName: 'Bernardo Almeida', customerPhone: '21988966462',
    date: '2026-09-22', time: '10:00', status: 'confirmed', createdAt: NOW, updatedAt: NOW,
  } as any);
  db.conversations.push({
    id: 'cv-bernardo', businessId: BUSINESS_ID, channel: 'whatsapp', contactId: 'ct-bernardo',
    customerId: '', name: 'Bernardo Almeida', phone: '21988966462', status: 'open',
    unread: 1, lastMessageAt: NOW, createdAt: NOW, updatedAt: NOW,
  } as any);
  await writeDB(db);
}

function req(path: string, token: string) {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { authorization: `Bearer ${token}` } });
}

const body = (res: Response) => res.json() as Promise<any>;

let token = '';
beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  token = await createSession(OWNER_ID);
});

describe('entity-search — parte pura', () => {
  it('dobra texto e casa telefone por dígitos (pontuação e DDD parcial não importam)', () => {
    expect(foldText('Configuração')).toBe('configuracao');
    expect(digitsOnly('(21) 98896-6462')).toBe('21988966462');
    expect(entityMatches('219889', { phone: '21988966462' })).toBe(true);
    expect(entityMatches('bernardo', { name: 'Bernardo Almeida' })).toBe(true);
    expect(entityMatches('bern almeida', { name: 'Bernardo Almeida' })).toBe(true);
    expect(entityMatches('gmail', { email: 'bernardo@example.com' })).toBe(false);
    expect(entityMatches('ze', { name: 'Bernardo' })).toBe(false);
  });

  it('agrupa por entidade com limite por grupo e descarta grupos vazios', () => {
    const hits = [
      { id: '1', group: 'conversas' as const, title: 'a', subtitle: '', icon: 'chat', href: '/x' },
      { id: '2', group: 'pessoas' as const, title: 'b', subtitle: '', icon: 'users', href: '/y' },
      { id: '3', group: 'pessoas' as const, title: 'c', subtitle: '', icon: 'users', href: '/z' },
    ];
    const grouped = groupEntityHits(hits, 1);
    expect(grouped.map((g) => g.group)).toEqual(['pessoas', 'conversas']);
    expect(grouped[0].items).toHaveLength(1);
  });
});

describe('GET /api/search — grupos reais com Bernardo, Greg e a agenda', () => {
  it('acha a pessoa por nome, o pet por nome e o agendamento — com destino que abre', async () => {
    const res = await searchGET(req(`/api/search?businessId=${BUSINESS_ID}&q=bernardo`, token));
    expect(res.status).toBe(200);
    const data = await body(res);
    const pessoas = data.groups.filter((h: any) => h.group === 'pessoas');
    expect(pessoas).toHaveLength(1);
    expect(pessoas[0].title).toBe('Bernardo Almeida');
    expect(pessoas[0].href).toContain('/clientes/');
    expect(pessoas[0].href).toContain(`b=${BUSINESS_ID}`);

    const pet = await body(await searchGET(req(`/api/search?businessId=${BUSINESS_ID}&q=greg`, token)));
    const pets = pet.groups.filter((h: any) => h.group === 'pets');
    expect(pets).toHaveLength(1);
    expect(pets[0].title).toBe('Greg');
    // O destino do pet é a ficha do TUTOR (Responsável ≠ Paciente).
    expect(pets[0].subtitle).toContain('tutor: Bernardo Almeida');
    expect(pets[0].href).toContain('/clientes/');

    const ag = await body(await searchGET(req(`/api/search?businessId=${BUSINESS_ID}&q=consulta`, token)));
    const ags = ag.groups.filter((h: any) => h.group === 'agendamentos');
    expect(ags).toHaveLength(1);
    expect(ags[0].href).toContain('/agenda?');
    expect(ags[0].href).toContain('data=2026-09-22');
  });

  it('acha a conversa por nome e devolve o deep-link ?c=', async () => {
    const data = await body(await searchGET(req(`/api/search?businessId=${BUSINESS_ID}&q=bernardo`, token)));
    const convs = data.groups.filter((h: any) => h.group === 'conversas');
    expect(convs).toHaveLength(1);
    expect(convs[0].href).toContain(`/conversas?b=${BUSINESS_ID}&c=cv-bernardo`);
  });

  it('telefone com dígitos parciais acha a pessoa (não exige formatação)', async () => {
    const data = await body(await searchGET(req(`/api/search?businessId=${BUSINESS_ID}&q=9889664`, token)));
    expect(data.groups.some((h: any) => h.group === 'pessoas' && h.title === 'Bernardo Almeida')).toBe(true);
  });

  it('consulta curta não busca nada (mínimo de 2 caracteres)', async () => {
    const data = await body(await searchGET(req(`/api/search?businessId=${BUSINESS_ID}&q=b`, token)));
    expect(data.groups).toEqual([]);
  });

  it('sem a permissão do grupo, o grupo NÃO EXISTE na resposta (professional: só a própria agenda)', async () => {
    // Profissional sem whatsapp e com vínculo: pessoas continuam (360 é da
    // unidade), conversas somem, agendamentos ficam no recorte do vínculo.
    const db = JSON.parse(fs.readFileSync(TEMP_DB_FILE, 'utf8'));
    db.users.push({ id: 'pro-user', name: 'Dra. Marta', email: 'marta@example.com', passwordHash: 'x', createdAt: NOW, role: 'user' });
    db.members.push({
      id: 'm1', businessId: BUSINESS_ID, userId: 'pro-user', role: 'PROFISSIONAL',
      permissions: {}, active: true, note: '', invitedBy: OWNER_ID, createdAt: NOW, updatedAt: NOW,
    } as BusinessMember);
    db.professionals[0].userId = 'pro-user';
    await writeDB(db as DB);
    const proToken = await createSession('pro-user');
    const data = await body(await searchGET(req(`/api/search?businessId=${BUSINESS_ID}&q=bernardo`, proToken)));
    expect(data.groups.some((h: any) => h.group === 'pessoas')).toBe(true);
    expect(data.groups.some((h: any) => h.group === 'conversas')).toBe(false);
    // O agendamento é da Dra. Marta (vínculo): continua visível para ela.
    expect(data.groups.some((h: any) => h.group === 'agendamentos')).toBe(true);
  });
});

describe('busca de ROTAS continua vindo do nav por permissão', () => {
  it('a busca global encontra a rota de Pendências para quem tem permissão', () => {
    const nav = panelNavigation({
      permissions: { dashboard: true, agenda: true, clientes: true, whatsapp: true } as any,
      modes: ['services', 'bookings'], features: {},
    });
    const items = buildNavSearchItems(nav, `?b=${BUSINESS_ID}`);
    const found = searchNav(items, 'pendencias', '/dashboard');
    expect(found.some((i) => i.path === '/tarefas')).toBe(true);
    // Sem permissão de config, a busca de "configurações" não entrega a rota.
    const forbidden = searchNav(items, 'configuracoes', '/dashboard');
    expect(forbidden.some((i) => i.path === '/configuracoes')).toBe(false);
  });
});
