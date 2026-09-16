// ═══════════════════════════════════════════════════════════════
// P4.3 — CONDIÇÕES (avaliação pura, sem linguagem própria)
// ═══════════════════════════════════════════════════════════════
// O ponto central de segurança deste módulo: NADA aqui eval/compila código.
// Uma condição é um dado `{ field, operator, value }` ou um grupo
// `{ logic: and|or|not, conditions: [...] }`. O motor interpreta operadores
// FIXOS — por isso a mesma estrutura pode ser gerada por uma IA futura (P5),
// validada no servidor e exibida em texto simples para o lojista.
//
// Regras de comparação (determinísticas, testadas):
//   • números  → comparação numérica ("10" == 10);
//   • datas    → ISO `YYYY-MM-DD`/`YYYY-MM-DDTHH:mm` compara como texto (a
//                ordem lexicográfica é a cronológica);
//   • texto    → `trim` + case-insensitive (o lojista escreve "instagram" e o
//                dado vem "Instagram");
//   • vazio    → '', null, undefined e [] NÃO existem (≠ '0', que existe);
//   • arrays     → `contains` verifica pertinência; `equals` compara o texto.
import type {
  AutomationCondition, AutomationFieldCondition, ConditionOperator,
} from '../types';
import { isConditionGroup } from '../types';

/** Máximo de nós de condição avaliados (proteção contra definição gigante). */
export const MAX_CONDITION_NODES = 200;
/** Profundidade máxima de aninhamento AND/OR/NOT. */
export const MAX_CONDITION_DEPTH = 6;
/** Caminhos proibidos (prototype pollution / escapes do contexto). */
const BLOCKED_SEGMENT = new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__lookupGetter__']);

export interface ResolvedField {
  found: boolean;
  value: unknown;
}

/**
 * Resolve `lead.origin` / `event.isNew` / `booking.date` sobre o contexto da
 * execução. Objetos planos apenas; nada de getters, protótipos ou funções.
 */
export function resolveFieldPath(ctx: unknown, path: string): ResolvedField {
  const segments = String(path || '').trim().split('.').filter(Boolean);
  if (segments.length === 0 || segments.length > 6) return { found: false, value: undefined };
  let current: any = ctx;
  for (const seg of segments) {
    if (BLOCKED_SEGMENT.has(seg)) return { found: false, value: undefined };
    if (current === null || current === undefined) return { found: false, value: undefined };
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return { found: false, value: undefined };
      current = current[idx];
      continue;
    }
    if (typeof current !== 'object') return { found: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(current, seg)) return { found: false, value: undefined };
    current = (current as Record<string, unknown>)[seg];
  }
  return { found: true, value: current };
}

/** Existe? (`''`, `null`, `undefined` e `[]` contam como ausente). */
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  // "1.234,56" (BR) e "1,234.56" (US) — o último separador vence.
  let normalized = raw.replace(/\s+/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(normalized)) normalized = normalized.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(normalized)) normalized = normalized.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const ISO_DATEISH = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function isDateish(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  return ISO_DATEISH.test(raw);
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Objeto: usado só para comparação textual — nunca despeja JSON no histórico.
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return String(value);
}

function same(a: unknown, b: unknown): boolean {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na === nb;
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return truthy(a) === truthy(b);
  }
  return asText(a).trim().toLowerCase() === asText(b).trim().toLowerCase();
}

/** `includes` entre texto (case-insensitive) ou pertinência em array. */
function containsText(haystack: unknown, needle: unknown): boolean {
  if (Array.isArray(haystack)) {
    const want = asText(needle).trim().toLowerCase();
    return haystack.some((x) => same(x, needle) || asText(x).trim().toLowerCase() === want);
  }
  const hay = asText(haystack).toLowerCase();
  const need = asText(needle).trim().toLowerCase();
  if (!need) return false;
  return hay.includes(need);
}

/** Comparação ordenada: números quando ambos são, senão texto/date ISO. */
function compare(a: unknown, b: unknown): number | null {
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na < nb ? -1 : na > nb ? 1 : 0;
  if (isDateish(a) && isDateish(b)) {
    const x = asText(a).replace(' ', 'T');
    const y = asText(b).replace(' ', 'T');
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return null;
}

export function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (!s) return false;
    return !['false', '0', 'nao', 'não', 'no', 'null', 'undefined'].includes(s);
  }
  return hasValue(value);
}

export interface ConditionResult {
  passed: boolean;
  /** Frase legível para o histórico (diagnóstico) — nunca um objeto cru. */
  explain: string;
  /** Caminhos de campo avaliados (usado na validação de definição). */
  fields: string[];
}

const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  equals: 'é',
  not_equals: 'não é',
  contains: 'contém',
  not_contains: 'não contém',
  exists: 'existe',
  not_exists: 'não existe',
  greater_than: 'é maior que',
  less_than: 'é menor que',
};

export function conditionOperatorLabel(op: ConditionOperator): string {
  return OPERATOR_LABEL[op] || op;
}

/** Um operador é compatível com um tipo de campo? (usado na validação). */
export function operatorNeedsValue(op: ConditionOperator): boolean {
  return op !== 'exists' && op !== 'not_exists';
}

function evaluateField(
  ctx: unknown,
  cond: AutomationFieldCondition,
): ConditionResult {
  const field = String(cond.field || '').trim();
  const { found, value } = resolveFieldPath(ctx, field);
  const op = cond.operator;
  const label = field || '(campo)';
  const short = hasValue(value) ? asText(value).slice(0, 60) : 'vazio';
  const want = asText(cond.value).slice(0, 60);

  let passed = false;
  switch (op) {
    case 'exists': passed = found && hasValue(value); break;
    case 'not_exists': passed = !(found && hasValue(value)); break;
    case 'equals': passed = found && hasValue(value) && same(value, cond.value); break;
    case 'not_equals': passed = !(found && hasValue(value) && same(value, cond.value)); break;
    case 'contains': passed = found && containsText(value, cond.value); break;
    case 'not_contains': passed = !(found && containsText(value, cond.value)); break;
    case 'greater_than':
    case 'less_than': {
      const cmp = compare(value, cond.value);
      if (cmp === null) passed = false;
      else passed = op === 'greater_than' ? cmp > 0 : cmp < 0;
      break;
    }
    default: passed = false;
  }

  const explain = operatorNeedsValue(op)
    ? `${label} ${OPERATOR_LABEL[op] || op} "${want}" → ${short}`
    : `${label} ${OPERATOR_LABEL[op] || op} → ${short}`;
  return { passed, explain, fields: field ? [field] : [] };
}

export interface EvaluateOptions {
  /** "Agora" injetável (testes) — hoje só `today.*`/`now` dependem dele. */
  now?: Date;
}

/**
 * Avalia uma condição (ou grupo lógico) sobre o contexto da execução.
 * Nunca lança por dado inesperado: condição inválida ⇒ `passed: false` com a
 * explicação no histórico (falha segura, execução continua o fluxo 'não').
 */
export function evaluateCondition(
  ctx: unknown,
  condition: AutomationCondition | undefined | null,
  options: EvaluateOptions = {},
): ConditionResult {
  void options;
  const counter = { nodes: 0 };
  return walk(ctx, condition, 0, counter);
}

function walk(
  ctx: unknown,
  condition: AutomationCondition | undefined | null,
  depth: number,
  counter: { nodes: number },
): ConditionResult {
  counter.nodes += 1;
  if (counter.nodes > MAX_CONDITION_NODES || depth > MAX_CONDITION_DEPTH) {
    return { passed: false, explain: 'condição grande demais (limite de segurança)', fields: [] };
  }
  if (!condition) return { passed: true, explain: 'sem condição', fields: [] };

  if (isConditionGroup(condition)) {
    const parts = condition.conditions || [];
    if (parts.length === 0) return { passed: true, explain: 'grupo vazio', fields: [] };
    const results = parts.map((p) => walk(ctx, p, depth + 1, counter));
    const fields = results.flatMap((r) => r.fields);
    const logic = String(condition.logic || 'and').toLowerCase();
    if (logic === 'or') {
      const passed = results.some((r) => r.passed);
      return { passed, explain: results.map((r) => r.explain).join(' OR '), fields };
    }
    if (logic === 'not') {
      // NOT é unário por contrato: usa o primeiro item.
      const passed = !results[0].passed;
      return { passed, explain: `NOT (${results[0].explain})`, fields };
    }
    const passed = results.every((r) => r.passed);
    return { passed, explain: results.map((r) => r.explain).join(' AND '), fields };
  }

  return evaluateField(ctx, condition as AutomationFieldCondition);
}

// ── Template simples `{{caminho}}` (NADA de expressão) ───────
const TOKEN = /\{\{\s*([a-zA-Z0-9_.[\]-]+)\s*\}\}/g;

/** Tem tokens de contexto? (usado na validação para o editor avisar). */
export function hasTemplateTokens(input: unknown): boolean {
  return typeof input === 'string' && input.includes('{{') && input.includes('}}');
}

/**
 * Substitui `{{lead.name}}` pelos valores do contexto. Desconhecido ⇒ texto
 * vazio (a automação nunca escreve "{{...}}" para o cliente). Puro.
 */
export function renderTemplate(input: unknown, ctx: unknown): string {
  const raw = asText(input);
  if (!raw.includes('{{')) return raw;
  return raw.replace(TOKEN, (_m, path: string) => {
    const resolved = resolveFieldPath(ctx, String(path).replace(/\[(\d+)\]/g, '.$1'));
    const value = resolved.value;
    if (!hasValue(value)) return '';
    return asText(value);
  }).replace(/\s+\n/g, '\n').trim();
}

/** Mesma coisa, mas mantém o texto quando o contexto não resolve (diagnóstico). */
export function renderTemplateLenient(input: unknown, ctx: unknown): string {
  const raw = asText(input);
  if (!raw.includes('{{')) return raw;
  return raw.replace(TOKEN, (m, path: string) => {
    const resolved = resolveFieldPath(ctx, String(path).replace(/\[(\d+)\]/g, '.$1'));
    return hasValue(resolved.value) ? asText(resolved.value) : m;
  });
}

/** Render profundo (strings dentro de objetos/arrays) — usado pelas ações. */
export function renderParams<T>(params: T, ctx: unknown): T {
  if (typeof params === 'string') return renderTemplate(params, ctx) as unknown as T;
  if (Array.isArray(params)) return params.map((p) => renderParams(p, ctx)) as unknown as T;
  if (params && typeof params === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) out[k] = renderParams(v, ctx);
    return out as unknown as T;
  }
  return params;
}

/** Caminhos de campo usados por uma condição (validação/UX do editor). */
export function conditionFields(condition: AutomationCondition | undefined | null): string[] {
  if (!condition) return [];
  if (isConditionGroup(condition)) {
    return (condition.conditions || []).flatMap((c) => conditionFields(c));
  }
  const field = (condition as AutomationFieldCondition).field;
  return field ? [field] : [];
}

/** Representação em texto simples ("Origem é instagram") para a interface. */
export function describeCondition(
  condition: AutomationCondition | undefined | null,
  fieldLabel: (path: string) => string,
  depth = 0,
): string {
  if (!condition) return '';
  if (isConditionGroup(condition)) {
    const parts = (condition.conditions || [])
      .map((c) => describeCondition(c, fieldLabel, depth + 1))
      .filter(Boolean);
    if (parts.length === 0) return '';
    const logic = String(condition.logic || 'and').toLowerCase();
    if (logic === 'not') return `não (${parts[0]})`;
    return parts.join(logic === 'or' ? ' ou ' : ' e ');
  }
  const c = condition as AutomationFieldCondition;
  const label = fieldLabel(c.field);
  if (!operatorNeedsValue(c.operator)) return `${label} ${OPERATOR_LABEL[c.operator] || c.operator}`;
  return `${label} ${OPERATOR_LABEL[c.operator] || c.operator} "${asText(c.value)}"`;
}
