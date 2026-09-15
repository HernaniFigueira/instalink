export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function money(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);
}

// ── Moeda: implementação ÚNICA de parse/format ──
// Todos os módulos (painel, público, API) devem usar estas funções.
// Aceita "45,00" · "45.00" · "1.234,56" · "R$ 45,00" · 45 (número = reais).
// Quando há ambiguidade de separador, o ÚLTIMO separador é o decimal.
export const MAX_MONEY_CENTS = 100000000; // R$ 1.000.000,00

export function parseMoneyToCents(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0;
    return clampCents(Math.round(input * 100));
  }
  let s = String(input || '').replace(/[R$\s]/g, '');
  if (!s) return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // último separador vence como decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = s.replace('.', '').replace(',', '.');
  }
  // só ponto (ou nenhum): ponto já é decimal
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return clampCents(Math.round(n * 100));
}

export function clampCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.max(0, Math.min(MAX_MONEY_CENTS, Math.round(cents)));
}

// Exibição em inputs (ex: 4500 -> "45,00").
export function centsToBR(cents: number): string {
  return ((cents || 0) / 100).toFixed(2).replace('.', ',');
}

export function slugify(input: string): string {
  return (input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 30);
}

export const RESERVED_SLUGS = new Set([
  'api', 'app', 'login', 'register', 'dashboard', 'onboarding', 'pagina',
  'produtos', 'servicos', 'agenda', 'pedidos', 'clientes', 'resultados',
  'configuracoes', 'instalink', 'admin', 'master', 'ajuda', 'suporte', 'termos',
  'privacidade', 'blog', 'www', 'mail', 'static', 'assets',
]);

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]{3,30}$/.test(slug) && !RESERVED_SLUGS.has(slug);
}

// id seguro para uso no cliente (sem node:crypto)
export function uid(): string {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// ── Paginação local (histórico 360 etc.) ───────────────────────
// Página 1-based; sempre dentro do intervalo [1, pages]. Vazio (0 itens)
// rende 1 página vazia para o controle não "explodir" em telas sem dados.
export function paginate<T>(items: T[], page: number, perPage: number): {
  slice: T[]; page: number; pages: number; total: number;
} {
  const per = Math.max(1, Math.floor(perPage) || 1);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(pages, Math.max(1, Math.floor(page) || 1));
  return { slice: items.slice((p - 1) * per, (p - 1) * per + per), page: p, pages, total };
}

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAYS_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function onlyDigits(s: string): string {
  return (s || '').replace(/\D/g, '');
}

export function waLink(phone: string, message: string): string {
  const digits = onlyDigits(phone);
  if (!digits) return '#';
  const num = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

export function timeToMin(t: string): number {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
