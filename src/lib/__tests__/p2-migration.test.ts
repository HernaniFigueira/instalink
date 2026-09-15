import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════════
// MIGRAÇÃO P2 — ADITIVA E NÃO DESTRUTIVA
// ═══════════════════════════════════════════════════════════════
// Regras que este teste protege:
//   • documento legado continua legível e NADA é apagado;
//   • campos novos entram com default seguro (appearance, notes, userId);
//   • registro de observação já existente é preservado literalmente;
//   • FALHA DE LEITURA NUNCA vira "banco vazio" (fail-closed) e nunca
//     sobrescreve o arquivo do usuário.
// Roda contra um arquivo temporário — não toca data/ do repositório.
const withFileBackend = process.env.DATABASE_URL ? describe.skip : describe;

const LEGACY_DOC = {
  businesses: [
    {
      id: 'b1', ownerId: 'u1', name: 'Clínica', slug: 'clinica', modes: ['services', 'bookings'],
      // sem `appearance` (campo P2) — negócio legado
    },
  ],
  professionals: [
    { id: 'ana', businessId: 'b1', name: 'Ana', role: 'Dentista', photo: '', active: true },
  ],
  contacts: [
    {
      id: 'c1', businessId: 'b1', customerId: '', name: 'Marlene', phone: '11955554444', email: '',
      // observação legada (texto único) — precisa continuar idêntica
      note: 'Prefere manhã. Alergia a dipirona.',
      createdAt: '2026-01-02T10:00:00.000Z', updatedAt: '2026-01-02T10:00:00.000Z', source: 'agendamento',
      lastInteraction: '2026-01-02T10:00:00.000Z', marketingOptIn: false,
    },
    {
      id: 'c2', businessId: 'b1', customerId: '', name: 'Rafael', phone: '11966666666', email: '',
      note: '', notes: [
        { id: 'n1', at: '2026-02-01T10:00:00.000Z', by: 'u9', byName: 'Ana', text: 'Já é cliente há 2 anos.', bookingId: 'bk9' },
      ],
      createdAt: '2026-01-05T10:00:00.000Z', updatedAt: '2026-02-01T10:00:00.000Z', source: 'manual',
      lastInteraction: '2026-02-01T10:00:00.000Z', marketingOptIn: false,
    },
  ],
  members: [
    { id: 'm1', businessId: 'b1', userId: 'u2', role: 'SECRETARIA', permissions: { agenda: true }, active: true },
  ],
};

withFileBackend('db — migração P2 (identidade, vínculo e observações)', () => {
  let tmp = '';
  let originalCwd = '';
  let readDB: (() => Promise<any>) | undefined;
  let file = '';

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'instalink-p2-'));
    process.chdir(tmp);
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    file = path.join(tmp, 'data', 'instalink.db.json');
    fs.writeFileSync(file, JSON.stringify(LEGACY_DOC));
    ({ readDB } = await import('../db'));
  });

  afterAll(() => {
    process.chdir(originalCwd);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('documento legado abre normalmente e ganha os campos novos com default seguro', async () => {
    const db = await readDB!();
    // Identidade visual: campo novo, default = sem cor customizada.
    expect(db.businesses[0].appearance).toEqual({ navColor: '' });
    // Vínculo login↔profissional: default '' (profissional sem login).
    expect(db.professionals[0].userId).toBe('');
    // Observações: array criado apenas quando ausente.
    expect(db.contacts[0].notes).toEqual([]);
    expect(db.contacts[1].notes).toHaveLength(1);
  });

  it('NENHUM dado existente é apagado ou trocado por vazio', async () => {
    const db = await readDB!();
    const marlene = db.contacts.find((c: any) => c.id === 'c1');
    expect(marlene.note).toBe('Prefere manhã. Alergia a dipirona.');
    expect(marlene.phone).toBe('11955554444');
    const rafael = db.contacts.find((c: any) => c.id === 'c2');
    expect(rafael.notes[0]).toEqual({
      id: 'n1', at: '2026-02-01T10:00:00.000Z', by: 'u9', byName: 'Ana',
      text: 'Já é cliente há 2 anos.', bookingId: 'bk9',
    });
    expect(db.businesses[0].name).toBe('Clínica');
    expect(db.professionals[0].role).toBe('Dentista');
    expect(db.members[0]).toMatchObject({ id: 'm1', userId: 'u2', role: 'SECRETARIA', active: true });
  });

  it('é idempotente: ler de novo não altera nada nem duplica observação', async () => {
    const first = await readDB!();
    const second = await readDB!();
    expect(second.contacts.map((c: any) => [c.id, c.notes.length, c.note]))
      .toEqual(first.contacts.map((c: any) => [c.id, c.notes.length, c.note]));
    expect(second.businesses.map((b: any) => b.appearance))
      .toEqual(first.businesses.map((b: any) => b.appearance));
  });

  it('cor inválida gravada por engano vira “sem cor” — nunca quebra a tela', async () => {
    const db = await readDB!();
    db.businesses[0].appearance = { navColor: 'azul-bonito' };
    fs.writeFileSync(file, JSON.stringify(db));
    const again = await readDB!();
    expect(again.businesses[0].appearance).toEqual({ navColor: '' });
  });

  it('FALHA DE LEITURA não vira banco vazio e não sobrescreve o arquivo', async () => {
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, '{ isso não é json');
    await expect(readDB!()).rejects.toBeTruthy();
    // o arquivo do usuário continua lá, exatamente como estava
    expect(fs.readFileSync(file, 'utf8')).toBe('{ isso não é json');
    expect(before.includes('Clínica')).toBe(true);
  });
});
