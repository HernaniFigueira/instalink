// ═══════════════════════════════════════════════════════════════
// SAUDAÇÃO — como chamar a pessoa na primeira dobra (puro, testável)
// ═══════════════════════════════════════════════════════════════
// A Visão geral cumprimenta pelo PRIMEIRO NOME. Em clínica, o cadastro do
// profissional costuma vir com tratamento — "Dr. Orlando", "Dra. Ana",
// "Prof. Marcos". Usar o primeiro token cru produzia "Meu dia, Dr.", que
// soa como sistema quebrado (foi visto na verificação em navegador).
//
// A regra aqui é só de APRESENTAÇÃO: quando o primeiro token é um tratamento
// conhecido, ele não é o nome — e o token seguinte é. Sem tratamento, o
// comportamento continua exatamente o de antes (primeiro token).
const TITLES = new Set([
  'dr', 'dr.', 'dra', 'dra.', 'sr', 'sr.', 'sra', 'sra.', 'srta', 'srta.',
  'prof', 'prof.', 'profa', 'profa.', 'doutor', 'doutora',
]);

/** Primeiro nome apresentável de um nome completo ('' → 'você'). */
export function firstName(name: string | undefined | null): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'você';
  if (TITLES.has(parts[0].toLowerCase().replace(/,$/, ''))) {
    // "Dr. Orlando" → "Orlando". Se só veio o tratamento, ele é a melhor
    // informação disponível (nunca devolve vazio).
    return parts[1] || parts[0];
  }
  return parts[0];
}
