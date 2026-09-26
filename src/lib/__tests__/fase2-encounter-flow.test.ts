import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FOLLOW_UP_MODES, FOLLOW_UP_MODE_LABELS, isFollowUpMode, validateFollowUp,
  followUpDueDate, cleanEncounterFiles, encounterContentPayload, encounterDraftKey,
} from '../encounters';
import { normalizeDB } from '../db';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('FASE 2 · P3 — retorno estruturado (motor puro)', () => {
  it('modos e rótulos cobrem a UX: sem retorno · data · intervalo (+ texto livre)', () => {
    expect(FOLLOW_UP_MODES).toEqual(['none', 'date', 'interval', 'custom']);
    for (const m of FOLLOW_UP_MODES) expect(FOLLOW_UP_MODE_LABELS[m]).toBeTruthy();
    expect(isFollowUpMode('date')).toBe(true);
    expect(isFollowUpMode('x')).toBe(false);
  });

  it('validateFollowUp: data obrigatória no modo date; intervalo 1–730', () => {
    expect(validateFollowUp({ followUpMode: 'none' })).toBe('');
    expect(validateFollowUp({ followUpMode: 'custom' })).toBe('');
    expect(validateFollowUp({ followUpMode: 'date', followUpDate: '' })).toContain('data');
    expect(validateFollowUp({ followUpMode: 'date', followUpDate: '2026-10-01' })).toBe('');
    expect(validateFollowUp({ followUpMode: 'interval', followUpDays: 0 })).toContain('intervalo');
    expect(validateFollowUp({ followUpMode: 'interval', followUpDays: 30 })).toBe('');
    expect(validateFollowUp({ followUpMode: 'interval', followUpDays: 9999 })).toContain('intervalo');
    expect(validateFollowUp({ followUpMode: 'inventado' })).toContain('inválida');
    expect(validateFollowUp({})).toBe(''); // nada informado = não valida
  });

  it('followUpDueDate: date direto; interval soma dias à data do atendimento', () => {
    expect(followUpDueDate({ date: '2026-09-10', followUpMode: 'date', followUpDate: '2026-10-15' })).toBe('2026-10-15');
    expect(followUpDueDate({ date: '2026-09-10', followUpMode: 'interval', followUpDays: 30 })).toBe('2026-10-10');
    expect(followUpDueDate({ date: '2026-09-10', followUpMode: 'none' })).toBe('');
    expect(followUpDueDate({ date: '2026-09-10', followUpMode: 'interval', followUpDays: 0 })).toBe('');
    expect(followUpDueDate({ date: '', followUpMode: 'interval', followUpDays: 7 })).toBe('');
  });

  it('payload e assinatura do autosave incluem o retorno estruturado', () => {
    const base = { complaint: '', evolution: '', guidance: '', followUp: '', internalNote: '', tags: '' };
    const comData = { ...base, followUpMode: 'date' as const, followUpDate: '2026-11-01' };
    const p = encounterContentPayload('b1', 'e1', comData, 3);
    expect(p.followUpMode).toBe('date');
    expect(p.followUpDate).toBe('2026-11-01');
    expect(encounterDraftKey(comData)).not.toBe(encounterDraftKey(base));
    // legado sem modo continua válido (payload não manda o campo)
    const legado = encounterContentPayload('b1', 'e1', base, 1);
    expect('followUpMode' in legado).toBe(false);
    const intervalo = { ...base, followUpMode: 'interval' as const, followUpDays: 45 };
    expect(encounterContentPayload('b1', 'e1', intervalo, 2).followUpDays).toBe(45);
  });
});

describe('FASE 2 · P3 — arquivos (referências apenas)', () => {
  it('cleanEncounterFiles manté só http(s), ids únicos e teto de 12', () => {
    const files = cleanEncounterFiles([
      { id: 'a', name: 'exame.pdf', url: 'https://blob/x.pdf', size: 1024, createdAt: 't', by: 'u' },
      { id: 'a', name: 'dup.pdf', url: 'https://blob/y.pdf' }, // duplicado
      { id: 'b', name: 'js', url: 'javascript:alert(1)' },      // protocolo rejeitado
      'lixo',
      ...Array.from({ length: 20 }, (_, i) => ({ id: `n${i}`, name: `f${i}`, url: `https://b/${i}`, size: 1, createdAt: '', by: '' })),
    ]);
    expect(files[0].id).toBe('a');
    expect(files.every((f) => f.url.startsWith('https://'))).toBe(true);
    expect(files.length).toBeLessThanOrEqual(12);
    expect(new Set(files.map((f) => f.id)).size).toBe(files.length);
    expect(cleanEncounterFiles(undefined)).toEqual([]);
  });
});

describe('FASE 2 · P3 — defaults defensivos do documento', () => {
  it('encounter legado ganha followUpMode/files sem perder texto de retorno', () => {
    const db = normalizeDB({
      encounters: [
        { id: 'e1', businessId: 'b', version: 1, followUp: 'retorno em 30 dias' },
        { id: 'e2', businessId: 'b', version: 1, followUp: '' },
        { id: 'e3', businessId: 'b', followUpMode: 'date', followUpDate: '2026-12-01', followUpDays: 0, files: [] },
      ],
    } as any);
    expect(db.encounters[0].followUpMode).toBe('custom'); // texto ⇒ texto livre
    expect(db.encounters[0].followUp).toBe('retorno em 30 dias'); // nunca reescrito
    expect(db.encounters[1].followUpMode).toBe('none');
    expect(db.encounters[2].followUpMode).toBe('date'); // explícito preservado
    for (const e of db.encounters) expect(Array.isArray(e.files)).toBe(true);
  });
});

describe('FASE 2 · P3 — cadeia finalizar ⇒ concluir agendamento (regressão estática)', () => {
  const api = read('src/app/api/encounters/route.ts');
  it('finalizar usa o serviço OFICIAL de status (pending→confirmed→completed)', () => {
    expect(api).toMatch(/action === 'finalize'/);
    expect(api).toContain("applyBookingStatusTx");
    // pending não pula para completed: a máquina de estados é confirmada antes.
    expect(api).toMatch(/to: 'confirmed'/);
    expect(api).toMatch(/to: 'completed'/);
    // cancelado/falta jamais são convertidos (registro clínico fica, status não mente).
    expect(api).toMatch(/bk\.status === 'confirmed'/);
  });
  it('remarcar/cancelar nunca apaga registro clínico (DELETE é porta própria, auditada)', () => {
    expect(api).toContain("'encounter.removed'");
    // nada no PATCH de conteúdo toca bookings: o vínculo é só leitura.
    const patch = api.slice(api.indexOf('export async function PATCH'), api.indexOf('export async function DELETE'));
    expect(patch).not.toMatch(/bookings\s*=\s*/);
  });
  it('upload aceita o perfil de atendimento e PDF (anexos do atendimento)', () => {
    const up = read('src/app/api/upload/route.ts');
    expect(up).toContain("'atendimento'");
    expect(up).toContain('application/pdf');
  });
});
