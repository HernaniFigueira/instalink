// ═══════════════════════════════════════════════════════════════
// FASE 2 · P4 — MOTOR ÚNICO DE ANAMNESE (funções puras, sem I/O)
// ═══════════════════════════════════════════════════════════════
// Um motor de formulários clínicos: template → campos → resposta. NÃO é uma
// tabela hardcoded por clínica. Os textos são ADMINISTRATIVOS e editáveis —
// nunca diagnóstico médico. Nenhuma rota/tela importa storage daqui.
import type { AnamneseField, AnamneseResponse, AnamneseTemplate } from './types';

/** Valor de uma resposta, por tipo de campo. */
export type AnamneseValue = string | number | boolean | string[] | null | undefined;

export interface AnamneseAnswerError { fieldId: string; message: string }

function isBlank(v: AnamneseValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Normaliza o valor bruto de um campo para o tipo declarado (nunca lança). */
export function coerceAnswer(field: AnamneseField, raw: unknown): AnamneseValue {
  switch (field.type) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 'sim' || raw === '1') return true;
      if (raw === 'false' || raw === 'nao' || raw === 'não' || raw === '0') return false;
      return null;
    case 'number':
    case 'scale': {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'multiselect':
      if (Array.isArray(raw)) return raw.map(String);
      if (typeof raw === 'string' && raw.trim()) return [raw];
      return [];
    case 'select':
    case 'text':
    case 'textarea':
    case 'date':
      return raw === null || raw === undefined ? '' : String(raw);
    case 'note':
      return raw === null || raw === undefined ? '' : String(raw);
    default:
      return raw === null || raw === undefined ? '' : String(raw);
  }
}

/**
 * Valida as respostas contra o template. Retorna erros por campo (requerido,
 * número, escala dentro da faixa, seleção entre as opções). Puro e previsível.
 */
export function validateAnamneseAnswers(
  template: Pick<AnamneseTemplate, 'fields'>,
  answers: Record<string, unknown>,
): { ok: boolean; errors: AnamneseAnswerError[] } {
  const errors: AnamneseAnswerError[] = [];
  for (const f of template.fields) {
    if (f.type === 'note') continue; // nota é apenas informativa
    const raw = answers?.[f.id];
    const value = coerceAnswer(f, raw);
    if (isBlank(value)) {
      if (f.required) errors.push({ fieldId: f.id, message: 'Campo obrigatório.' });
      continue;
    }
    if (f.type === 'number' || f.type === 'scale') {
      if (typeof value !== 'number') { errors.push({ fieldId: f.id, message: 'Informe um número.' }); continue; }
      if (f.type === 'scale') {
        const min = typeof f.scaleMin === 'number' ? f.scaleMin : 0;
        const max = typeof f.scaleMax === 'number' ? f.scaleMax : 10;
        if (value < min || value > max) { errors.push({ fieldId: f.id, message: `Valor entre ${min} e ${max}.` }); continue; }
      }
    }
    if (f.type === 'select' && f.options?.length && typeof value === 'string' && !f.options.includes(value)) {
      errors.push({ fieldId: f.id, message: 'Selecione uma opção válida.' });
    }
    if (f.type === 'multiselect' && Array.isArray(value) && f.options?.length) {
      const bad = value.filter((v) => !f.options!.includes(v));
      if (bad.length) errors.push({ fieldId: f.id, message: 'Há opções inválidas.' });
    }
    if (f.type === 'date' && typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errors.push({ fieldId: f.id, message: 'Data inválida.' });
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Normaliza e limpa as respostas gravadas (só campos do template, tipo certo). */
export function normalizeAnswers(
  template: Pick<AnamneseTemplate, 'fields'>,
  answers: Record<string, unknown>,
): Record<string, AnamneseValue> {
  const out: Record<string, AnamneseValue> = {};
  for (const f of template.fields) {
    if (f.type === 'note') continue;
    out[f.id] = coerceAnswer(f, answers?.[f.id]);
  }
  return out;
}

/** Rótulo legível de um valor, para timeline/impressão. */
export function formatAnswer(field: AnamneseField, value: AnamneseValue): string {
  if (isBlank(value)) return '—';
  switch (field.type) {
    case 'boolean': return value ? 'Sim' : 'Não';
    case 'multiselect': return Array.isArray(value) ? value.join(', ') : String(value);
    case 'scale': return `${value} / ${field.scaleMax ?? 10}`;
    default: return String(value);
  }
}

/** Sanitiza um template para gravação (campos limitados, ids estáveis). */
export function sanitizeTemplate(input: Partial<AnamneseTemplate>): AnamneseTemplate {
  const fields: AnamneseField[] = (Array.isArray(input.fields) ? input.fields : [])
    .filter((f) => f && typeof f.label === 'string' && f.label.trim())
    .slice(0, 60)
    .map((f) => {
      const type: AnamneseField['type'] = (
        ['text', 'textarea', 'boolean', 'select', 'multiselect', 'number', 'date', 'scale', 'note'].includes(f.type)
      ) ? f.type : 'text';
      return {
        id: String(f.id || '').slice(0, 64) || `f_${Math.random().toString(36).slice(2, 9)}`,
        label: String(f.label).slice(0, 160),
        type,
        required: !!f.required,
        ...(typeof f.help === 'string' && f.help.trim() ? { help: f.help.slice(0, 240) } : {}),
        ...((type === 'select' || type === 'multiselect') && Array.isArray(f.options)
          ? { options: f.options.map((o) => String(o).slice(0, 120)).filter(Boolean).slice(0, 40) } : {}),
        ...(type === 'scale' ? {
          scaleMin: Number.isFinite(f.scaleMin) ? Number(f.scaleMin) : 0,
          scaleMax: Number.isFinite(f.scaleMax) ? Number(f.scaleMax) : 10,
          ...(f.scaleMinLabel ? { scaleMinLabel: String(f.scaleMinLabel).slice(0, 40) } : {}),
          ...(f.scaleMaxLabel ? { scaleMaxLabel: String(f.scaleMaxLabel).slice(0, 40) } : {}),
        } : {}),
      };
    });
  return {
    id: String(input.id || ''),
    businessId: String(input.businessId || ''),
    name: String(input.name || 'Ficha de anamnese').trim().slice(0, 80) || 'Ficha de anamnese',
    description: String(input.description || '').slice(0, 240),
    preset: (input.preset && ['medica', 'odontologica', 'veterinaria', 'estetica', 'geral', 'custom'].includes(input.preset))
      ? input.preset : 'custom',
    fields,
    active: input.active !== false,
    createdAt: String(input.createdAt || ''),
    updatedAt: String(input.updatedAt || ''),
  };
}

/** Template ativo padrão da unidade (o primeiro ativo; senão o primeiro). */
export function defaultTemplate(templates: AnamneseTemplate[]): AnamneseTemplate | null {
  return templates.find((t) => t.active) || templates[0] || null;
}

/** Resposta mais recente de um paciente (contato) na unidade. */
export function latestResponseFor(responses: AnamneseResponse[], contactId: string): AnamneseResponse | null {
  let best: AnamneseResponse | null = null;
  for (const r of responses) {
    if (r.contactId !== contactId) continue;
    if (!best || r.createdAt > best.createdAt) best = r;
  }
  return best;
}
