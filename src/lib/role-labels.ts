// ═══════════════════════════════════════════════════════════════
// RÓTULO DE PAPEL — fonte única (Etapa A)
// ═══════════════════════════════════════════════════════════════
// O papel do usuário aparece na topbar (menu da conta) e em telas de acesso.
// Antes o mapa vivia solto dentro do DashboardShell; centralizar aqui evita
// dois vocabulários para o mesmo papel.
//
// APRESENTAÇÃO ONLY: quem decide o papel é o servidor (lib/access.ts). Nada
// aqui concede ou nega acesso — apenas nomeia.

export const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  SECRETARIA: 'Secretária',
  ATENDENTE: 'Atendente',
  VENDEDOR: 'Vendedor',
  VIEWER: 'Visualizador',
  MASTER: 'Suporte da plataforma',
  PROFISSIONAL: 'Profissional',
};

/** Rótulo legível do papel; devolve o código quando ele não tem tradução. */
export function roleLabel(role?: string | null): string {
  if (!role) return '';
  return ROLE_LABEL[role] || role;
}
