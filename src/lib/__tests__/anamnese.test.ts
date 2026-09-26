import { describe, it, expect } from 'vitest';
import {
  validateAnamneseAnswers, coerceAnswer, normalizeAnswers, formatAnswer,
  sanitizeTemplate, defaultTemplate, latestResponseFor,
} from '../anamnese';
import type { AnamneseField, AnamneseTemplate, AnamneseResponse } from '../types';

const field = (over: Partial<AnamneseField>): AnamneseField => ({
  id: 'f', label: 'F', type: 'text', required: false, ...over,
});

describe('P4 · motor de anamnese', () => {
  it('coerção por tipo (boolean, número, multiselect, data)', () => {
    expect(coerceAnswer(field({ type: 'boolean' }), 'sim')).toBe(true);
    expect(coerceAnswer(field({ type: 'boolean' }), 'não')).toBe(false);
    expect(coerceAnswer(field({ type: 'boolean' }), '')).toBe(null);
    expect(coerceAnswer(field({ type: 'number' }), '12')).toBe(12);
    expect(coerceAnswer(field({ type: 'number' }), 'abc')).toBe(null);
    expect(coerceAnswer(field({ type: 'multiselect' }), 'a')).toEqual(['a']);
    expect(coerceAnswer(field({ type: 'multiselect' }), ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('validação: obrigatório, número, escala na faixa, seleção válida', () => {
    const tpl = { fields: [
      field({ id: 'q', type: 'textarea', required: true }),
      field({ id: 'n', type: 'number' }),
      field({ id: 's', type: 'scale', scaleMin: 0, scaleMax: 5 }),
      field({ id: 'sel', type: 'select', options: ['a', 'b'] }),
    ] };
    expect(validateAnamneseAnswers(tpl, {}).ok).toBe(false);
    expect(validateAnamneseAnswers(tpl, {}).errors.map((e) => e.fieldId)).toContain('q');
    const ok = validateAnamneseAnswers(tpl, { q: 'dor', n: 3, s: 4, sel: 'a' });
    expect(ok.ok).toBe(true);
    expect(validateAnamneseAnswers(tpl, { q: 'x', s: 9 }).errors.map((e) => e.fieldId)).toContain('s');
    expect(validateAnamneseAnswers(tpl, { q: 'x', sel: 'z' }).errors.map((e) => e.fieldId)).toContain('sel');
  });

  it('campo note nunca é obrigatório nem validado', () => {
    const tpl = { fields: [field({ id: 'note', type: 'note', required: true })] };
    expect(validateAnamneseAnswers(tpl, {}).ok).toBe(true);
    expect(normalizeAnswers(tpl, { note: 'xxx' })).toEqual({});
  });

  it('formatAnswer legível (boolean/multiselect/escala)', () => {
    expect(formatAnswer(field({ type: 'boolean' }), true)).toBe('Sim');
    expect(formatAnswer(field({ type: 'multiselect' }), ['a', 'b'])).toBe('a, b');
    expect(formatAnswer(field({ type: 'scale', scaleMax: 10 }), 7)).toBe('7 / 10');
    expect(formatAnswer(field({ type: 'text' }), '')).toBe('—');
  });

  it('sanitizeTemplate limpa e limpa campos/ids', () => {
    const t = sanitizeTemplate({
      name: '  Ficha  ', fields: [
        field({ id: 'a', label: 'A', type: 'select', options: ['x', ''] }),
        { id: '', label: '   ', type: 'text' } as any, // sem rótulo → descartado
        field({ id: 'b', label: 'B'.repeat(200), type: 'texto' as any }), // tipo inválido → text
      ],
    });
    expect(t.name).toBe('Ficha');
    expect(t.fields.length).toBe(2);
    expect(t.fields[0].options).toEqual(['x']);
    expect(t.fields[1].label.length).toBeLessThanOrEqual(160);
    expect(t.fields[1].type).toBe('text');
  });

  it('defaultTemplate prefere ativo; latestResponseFor pega a mais recente do contato', () => {
    const tpls = [
      { id: 't1', active: false } as AnamneseTemplate,
      { id: 't2', active: true } as AnamneseTemplate,
    ];
    expect(defaultTemplate(tpls)?.id).toBe('t2');
    const rs = [
      { id: 'r1', contactId: 'c1', createdAt: '2026-01-01' } as AnamneseResponse,
      { id: 'r2', contactId: 'c1', createdAt: '2026-03-01' } as AnamneseResponse,
      { id: 'r3', contactId: 'c2', createdAt: '2026-09-01' } as AnamneseResponse,
    ];
    expect(latestResponseFor(rs, 'c1')?.id).toBe('r2');
    expect(latestResponseFor(rs, 'zzz')).toBe(null);
  });
});
