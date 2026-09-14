import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Migração defensiva do vínculo de horário (lib/db.normalize) ──
// Documentos antigos NÃO têm `followBusinessHours`. A leitura deriva o valor do
// que já estava gravado: quem tinha horário próprio continua personalizado, quem
// não tinha passa a herdar. Nenhum registro de disponibilidade é apagado.
//
// O teste roda contra um banco temporário (arquivo JSON em diretório próprio) —
// nunca toca o data/ do repositório.
const withFileBackend = process.env.DATABASE_URL ? describe.skip : describe;

const LEGACY_DOC = {
  businesses: [{ id: 'b1', ownerId: 'u1', name: 'Clínica', slug: 'clinica', modes: ['services', 'bookings'] }],
  professionals: [
    // legado: tem horário próprio gravado → deve derivar personalizado
    { id: 'ana', businessId: 'b1', name: 'Ana', role: '', photo: '', active: true },
    // legado: sem horário próprio → deve derivar herança
    { id: 'bruno', businessId: 'b1', name: 'Bruno', role: '', photo: '', active: true },
    // explícito: não pode ser sobrescrito pela derivação
    { id: 'carla', businessId: 'b1', name: 'Carla', role: '', photo: '', active: true, followBusinessHours: false },
    { id: 'dani', businessId: 'b1', name: 'Dani', role: '', photo: '', active: true, followBusinessHours: true },
  ],
  availability: [
    { id: 'g1', businessId: 'b1', professionalId: '', serviceId: '', weekday: 1, start: '09:00', end: '18:00', slotMin: 0 },
    { id: 'a1', businessId: 'b1', professionalId: 'ana', serviceId: '', weekday: 6, start: '08:00', end: '12:00', slotMin: 0 },
    { id: 'd1', businessId: 'b1', professionalId: 'dani', serviceId: '', weekday: 2, start: '08:00', end: '12:00', slotMin: 0 },
  ],
};

withFileBackend('db — migração do followBusinessHours (dados legados)', () => {
  let tmp = '';
  let originalCwd = '';
  let readDB: () => Promise<any>;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'instalink-db-'));
    fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'data', 'instalink.db.json'), JSON.stringify(LEGACY_DOC));
    // db.ts resolve o caminho do arquivo no import → cwd precisa estar apontado
    // para o diretório temporário ANTES de carregar o módulo.
    process.chdir(tmp);
    readDB = (await import('../db')).readDB as unknown as () => Promise<any>;
  });

  afterAll(() => {
    process.chdir(originalCwd);
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('quem já tinha horário próprio continua personalizado', async () => {
    const db = await readDB();
    const ana = db.professionals.find((p: any) => p.id === 'ana');
    expect(ana.followBusinessHours).toBe(false);
  });

  it('quem não tinha horário próprio passa a herdar', async () => {
    const db = await readDB();
    const bruno = db.professionals.find((p: any) => p.id === 'bruno');
    expect(bruno.followBusinessHours).toBe(true);
  });

  it('valor explícito nunca é sobrescrito pela derivação', async () => {
    const db = await readDB();
    expect(db.professionals.find((p: any) => p.id === 'carla').followBusinessHours).toBe(false);
    // Dani declarou que segue a empresa mesmo tendo regras próprias antigas:
    // o campo explícito vence (e as regras continuam gravadas, sem perda).
    expect(db.professionals.find((p: any) => p.id === 'dani').followBusinessHours).toBe(true);
  });

  it('nenhuma regra de disponibilidade é apagada na migração', async () => {
    const db = await readDB();
    expect(db.availability.map((a: any) => a.id).sort()).toEqual(['a1', 'd1', 'g1']);
    expect(db.availability.find((a: any) => a.id === 'a1')).toMatchObject({ professionalId: 'ana', start: '08:00' });
  });

  it('a migração é idempotente (ler de novo não muda nada)', async () => {
    const first = await readDB();
    const second = await readDB();
    expect(second.professionals.map((p: any) => [p.id, p.followBusinessHours]))
      .toEqual(first.professionals.map((p: any) => [p.id, p.followBusinessHours]));
    expect(second.availability).toHaveLength(first.availability.length);
  });

  it('os dados do documento antigo continuam intactos', async () => {
    const db = await readDB();
    expect(db.businesses[0].name).toBe('Clínica');
    expect(db.professionals).toHaveLength(4);
    // estruturas novas entram vazias (documento antigo não quebra)
    expect(Array.isArray(db.members)).toBe(true);
    expect(Array.isArray(db.bookings)).toBe(true);
  });
});
