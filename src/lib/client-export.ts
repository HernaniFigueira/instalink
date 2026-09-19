// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 7 — SELEÇÃO PARA EXPORTAR (pura)
// ═══════════════════════════════════════════════════════════════
// Fica separado do módulo de importação porque responde outra pergunta: quais
// contatos DESTA unidade entram no arquivo. O servidor já filtrou por
// `businessId`; aqui só se aplica busca/consentimento e o teto de linhas.
import { normalizeEmail, normalizePhoneBR } from './field-quality';
import { digitsOf } from './field-quality';
import type { BusinessCustomer } from './types';

/** Teto de linhas por exportação (evita despejo acidental de base gigante). */
export const EXPORT_LIMIT = 5000;

export function filterContactsForExport(
  contacts: BusinessCustomer[],
  opts: { q?: string; marketingOnly?: boolean; max?: number } = {},
): BusinessCustomer[] {
  const max = Math.max(1, opts.max ?? EXPORT_LIMIT);
  const term = String(opts.q || '').trim().toLowerCase();
  const terms = digitsOf(term, 20);

  const filtered = contacts.filter((c) => {
    if (opts.marketingOnly && c.marketingOptIn !== true) return false;
    if (!term) return true;
    const haystack = [
      (c.name || '').toLowerCase(),
      normalizeEmail(c.email),
      c.profile?.cpf || '',
    ];
    if (haystack.some((h) => h && h.includes(term))) return true;
    // Telefone casa por dígitos (a busca digita "(21) 9…" e o banco guarda 21…).
    const phone = normalizePhoneBR(c.phone);
    return terms.length >= 3 && phone.includes(terms);
  });

  // Ordem estável (nome, depois id) para o arquivo não sair diferente a cada
  // download — quem confere duas exportações precisa poder comparar.
  return filtered
    .slice()
    .sort((a, b) => {
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      if (an !== bn) return an < bn ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    })
    .slice(0, max);
}
