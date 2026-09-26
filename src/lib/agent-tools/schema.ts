// F3-D — validação de schema de entrada (determinística)
import type { SchemaField } from './types';

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  value: Record<string, unknown>;
}

export function validateInput(
  schema: SchemaField[],
  raw: unknown,
): ValidateResult {
  const errors: string[] = [];
  const input = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const value: Record<string, unknown> = {};

  for (const field of schema) {
    const v = input[field.name];
    const missing = v === undefined || v === null || v === '';

    if (missing) {
      if (field.required) errors.push('campo obrigatorio: ' + field.name);
      continue;
    }

    switch (field.type) {
      case 'string': {
        if (typeof v !== 'string') {
          errors.push(field.name + ' deve ser texto');
          break;
        }
        const max = field.max || 500;
        let s = v.slice(0, max);
        s = s.replace(/[\u0000-\u001f<>]/g, ' ').trim();
        if (field.enum && !field.enum.includes(s)) {
          errors.push(field.name + ' invalido');
          break;
        }
        value[field.name] = s;
        break;
      }
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) {
          errors.push(field.name + ' deve ser numero');
          break;
        }
        if (field.max !== undefined && n > field.max) {
          errors.push(field.name + ' acima do limite');
          break;
        }
        value[field.name] = n;
        break;
      }
      case 'boolean': {
        if (typeof v !== 'boolean') {
          errors.push(field.name + ' deve ser booleano');
          break;
        }
        value[field.name] = v;
        break;
      }
      case 'object': {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) {
          errors.push(field.name + ' deve ser objeto');
          break;
        }
        value[field.name] = v;
        break;
      }
      default:
        break;
    }
  }

  return { ok: errors.length === 0, errors, value };
}
