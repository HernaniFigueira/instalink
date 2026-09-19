// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 6 — QUALIDADE DOS CAMPOS (telefone BR · e-mail · CPF · CEP)
// ═══════════════════════════════════════════════════════════════
// A regra existe em DOIS lugares por desenho: a tela avisa enquanto se digita
// (máscara progressiva + mensagem específica) e o SERVIDOR recusa o cadastro
// torto. Aqui as duas pontas são testadas — inclusive a prova de que a régua
// é uma só: `lib/field-quality.ts`.
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as contactsPOST, PATCH as contactsPATCH } from '@/app/api/contacts/route';
import { resolveContactIdentity } from '../contact-identity';
import type { Business, DB } from '../types';
import {
  cepError, contactFieldErrors, digitsOf, emailError, hasFieldErrors, isValidCep, isValidEmail,
  isValidPhoneBR, maskCep, maskCpf, maskPhoneBR, normalizeEmail, normalizePhoneBR, phoneError,
} from '../field-quality';
import { isValidCustomerEmail } from '../customer-account';
import { formatCep, formatCpf, formatPhoneBR } from '../contact-profile';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BUSINESS_ID = 'biz-b6';
const OWNER_ID = 'owner-b6';

function business(id: string): Business {
  return {
    id, ownerId: OWNER_ID, organizationId: `org-${id}`, name: `Negócio ${id}`, slug: id,
    description: '', logo: '', cover: '', niche: 'saude', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 30, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW,
  } as Business;
}

async function seed() {
  const db: DB = emptyDB();
  db.users.push({ id: OWNER_ID, name: 'Dono B6', email: 'b6@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.businesses.push(business(BUSINESS_ID));
  await writeDB(db);
}

function jsonReq(path: string, body: unknown, token?: string, method = 'POST'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method, headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
  });
}
const json = (res: Response) => res.json() as Promise<any>;

let token = '';
beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  token = await createSession(OWNER_ID);
});

describe('A3.4 · Bloco 6 — máscaras e régua dos campos', () => {
  it('máscara de telefone é progressiva: não espera o número terminar para formatar', () => {
    expect(maskPhoneBR('')).toBe('');
    expect(maskPhoneBR('1')).toBe('(1');
    expect(maskPhoneBR('11')).toBe('(11)');
    expect(maskPhoneBR('119')).toBe('(11) 9');
    expect(maskPhoneBR('1191234')).toBe('(11) 91234');
    expect(maskPhoneBR('1191234567')).toBe('(11) 9123-4567');
    expect(maskPhoneBR('11912345678')).toBe('(11) 91234-5678');
    // Fixo também é cliente: 10 dígitos com máscara de 8.
    expect(maskPhoneBR('1132345678')).toBe('(11) 3234-5678');
    // Máscara e formatação antiga concordam no resultado final.
    expect(maskPhoneBR('11912345678')).toBe(formatPhoneBR('11912345678'));
  });

  it('máscara de CEP e de CPF seguem o padrão brasileiro', () => {
    expect(maskCep('013')).toBe('013');
    expect(maskCep('01310100')).toBe('01310-100');
    expect(maskCep('013101001234')).toBe('01310-100'); // teto de 8 dígitos
    expect(maskCpf('12345678909')).toBe('123.456.789-09');
    expect(maskCpf('1234')).toBe('123.4');
    expect(maskCpf('12345678909')).toBe(formatCpf('12345678909'));
  });

  it('telefone: aceita celular e fixo, recusa o que não existe, e a mensagem diz o quê', () => {
    expect(normalizePhoneBR('+55 (11) 91234-5678')).toBe('11912345678'); // código do país sai
    expect(isValidPhoneBR('11912345678')).toBe(true);
    expect(isValidPhoneBR('1132345678')).toBe(true);
    expect(isValidPhoneBR('5511912345678')).toBe(true);
    expect(isValidPhoneBR('09912345678')).toBe(false);      // DDD 09 não existe
    expect(isValidPhoneBR('119123456')).toBe(false);        // curto
    expect(isValidPhoneBR('119123456789')).toBe(false);     // longo
    expect(isValidPhoneBR('11812345678')).toBe(false);      // celular não começa com 8
    expect(phoneError('')).toBe('');
    expect(phoneError('', { required: true })).toMatch(/DDD/);
    expect(phoneError('119123')).toMatch(/Faltam dígitos/);
    expect(phoneError('119123456789')).toMatch(/a mais/);
    expect(digitsOf('(11) 91234-5678', 20)).toBe('11912345678');
  });

  it('e-mail: mensagem específica e MESMA régua do cadastro de conta', () => {
    expect(emailError('')).toBe('');
    expect(emailError('', { required: true })).toMatch(/Informe o e-mail/);
    expect(emailError('ana')).toMatch(/@/);
    expect(emailError('a@b@c.com')).toMatch(/mais de um @/);
    expect(emailError('ana@exemplo')).toMatch(/incompleto/);
    expect(emailError('ana.exemplo@clinica.com.br')).toBe('');
    expect(normalizeEmail('  ANA@Clinica.COM ')).toBe('ana@clinica.com');
    // A ponta antiga (`isValidCustomerEmail`) passa a usar a régua nova.
    expect(isValidCustomerEmail('ana@clinica.com')).toBe(true);
    expect(isValidCustomerEmail('ana@clinica')).toBe(false);
    expect(isValidEmail('ana@clinica.com')).toBe(true);
  });

  it('CEP: só reclama quando está informado e incompleto', () => {
    expect(cepError('')).toBe('');
    expect(cepError('01310-100')).toBe('');
    expect(isValidCep('01310100')).toBe(true);
    expect(cepError('0131')).toMatch(/8 dígitos/);
    expect(cepError('00000000')).toMatch(/inválido/);
  });

  it('o conjunto do contato devolve os erros na ordem em que a tela mostra', () => {
    const errs = contactFieldErrors({ name: '', phone: '119', email: 'x', cpf: '123', cep: '1' }, { requireName: true, requirePhone: true });
    expect(Object.keys(errs)).toEqual(['name', 'phone', 'email', 'cpf', 'cep']);
    expect(hasFieldErrors(errs)).toBe(true);
    const ok = contactFieldErrors({ name: 'Ana', phone: '(11) 91234-5678', email: 'ana@clinica.com', cpf: '', cep: '01310-100' }, { requirePhone: true });
    expect(hasFieldErrors(ok)).toBe(false);
  });
});

describe('A3.4 · Bloco 6 — a régua vale no servidor', () => {
  async function post(extra: Record<string, unknown> = {}) {
    return contactsPOST(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, name: 'Ana Campos', source: 'manual', ...extra,
    }, token));
  }

  it('telefone curto, DDD inexistente e celular torto são recusados com 400 e mensagem útil', async () => {
    for (const [phone, re] of [
      ['119123', /Faltam dígitos/],
      ['09912345678', /inválido/],
      ['119123456789', /a mais/],
    ] as const) {
      const res = await post({ phone });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(re);
    }
    const db = await readDB();
    expect(db.contacts).toHaveLength(0);
  });

  it('aceita o celular com máscara e guarda dígitos (sem +55 duplicado)', async () => {
    const res = await post({ phone: '+55 (11) 91234-5678', email: 'ana@clinica.com.br' });
    expect(res.status).toBe(200);
    const db = await readDB();
    expect(db.contacts[0].phone).toBe('5511912345678'); // como veio do WhatsApp: dígitos, sem símbolos
    expect(db.contacts[0].email).toBe('ana@clinica.com.br');
  });

  it('e-mail incompleto e CEP pela metade barram o cadastro ANTES de escrever', async () => {
    const semDominio = await post({ phone: '11912345678', email: 'ana@clinica' });
    expect(semDominio.status).toBe(400);
    expect((await json(semDominio)).error).toMatch(/incompleto/);
    const cepCurto = await post({ phone: '11912345678', profile: { address: { cep: '0131' } } });
    expect(cepCurto.status).toBe(400);
    expect((await json(cepCurto)).error).toMatch(/8 dígitos/);
    const db = await readDB();
    expect(db.contacts).toHaveLength(0);
  });

  it('o PATCH de identidade usa exatamente a mesma régua', async () => {
    const created = await post({ phone: '11912345678' });
    const id = (await json(created)).contact.id;
    const bad = await contactsPATCH(jsonReq('/api/contacts', { businessId: BUSINESS_ID, id, phone: '119123' }, token, 'PATCH'));
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toMatch(/Faltam dígitos/);
    const good = await contactsPATCH(jsonReq('/api/contacts', { businessId: BUSINESS_ID, id, phone: '(11) 3234-5678' }, token, 'PATCH'));
    expect(good.status).toBe(200);
    const db = await readDB();
    expect(db.contacts[0].phone).toBe('1132345678');
  });

  it('a régua de identidade é pura e testável (sem rota)', async () => {
    const db = await readDB();
    const contact = { id: 'c1', name: 'Ana', phone: '11912345678', email: '' };
    expect(resolveContactIdentity(db, BUSINESS_ID, contact, { phone: '11999998888' }).ok).toBe(true);
    const bad = resolveContactIdentity(db, BUSINESS_ID, contact, { phone: '119' });
    expect(bad).toEqual({ ok: false, status: 400, error: expect.stringMatching(/Faltam dígitos/) });
  });
});
