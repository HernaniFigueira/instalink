// ═══════════════════════════════════════════════════════════════
// EQUIPE · ACESSO — helpers PUROS da experiência "Papel → acesso padrão"
// ═══════════════════════════════════════════════════════════════
// Regras de produto (PR #46 · Equipe UX closure):
//   • O fluxo padrão é PAPEL → acesso padrão automático (preset). A edição
//     individual de permissões fica atrás de "Personalizar acesso".
//   • `ajuste` só existe quando há diferença REAL em relação ao preset do
//     papel. Override idêntico ao preset é normalizado (descartado).
//   • Trocar de papel aplica o preset limpo do novo papel — overrides antigos
//     não contaminam o papel novo.
//   • Com GODOUTOR_LEGACY_PAGES OFF, permissões de Página/Pedidos não aparecem
//     no editor clínico (PermissionIds e APIs continuam existindo).
// Nada aqui mexe em autorização server-side: o servidor segue validando
// `permissionsFor(role, overrides)` (person.save / validatePrivilegeEscalation).
import type { MemberRole, PermissionId } from './types';
import { PERMISSIONS, permissionsFor, roleDef } from './permissions';

/** Papéis clínicos principais do fluxo padrão (Proprietário é tratado à parte). */
export const PRIMARY_ROLE_IDS: MemberRole[] = ['ADMIN', 'SECRETARIA', 'PROFISSIONAL'];
/** Papéis legados: suportados para dados existentes, fora do fluxo clínico padrão. */
export const LEGACY_ROLE_IDS: MemberRole[] = ['ATENDENTE', 'VENDEDOR', 'VIEWER'];

export function isPrimaryRole(role: string): boolean {
  return PRIMARY_ROLE_IDS.includes(role as MemberRole);
}
export function isLegacyRole(role: string): boolean {
  return LEGACY_ROLE_IDS.includes(role as MemberRole);
}

export interface RoleLike { id: MemberRole; label: string; hint: string }

/**
 * Divide os papéis para o seletor: principais sempre visíveis; legados só em
 * "Outros papéis / avançado" (aberto apenas quando a pessoa já usa um deles).
 */
export function splitRolesForEditor<T extends RoleLike>(roles: T[], currentRole?: string): {
  primary: T[]; other: T[]; openOther: boolean;
} {
  const primary = PRIMARY_ROLE_IDS.filter(id => id !== 'SECRETARIA' || currentRole !== 'ATENDENTE').map((id) => roles.find((r) => r.id === id)).filter(Boolean) as T[];
  const other = LEGACY_ROLE_IDS.filter(id => id !== 'ATENDENTE' || currentRole === 'ATENDENTE').map((id) => roles.find((r) => r.id === id)).filter(Boolean) as T[];
  return { primary, other, openOther: !!currentRole && isLegacyRole(currentRole) };
}

/** Permissões que só fazem sentido no produto legado (Página/Pedidos). */
export const LEGACY_ONLY_PERMISSIONS: PermissionId[] = ['pagina', 'pedidos'];
/** Capacidades avançadas: só aparecem dentro de "Personalizar acesso". */
export const ADVANCED_PERMISSIONS: PermissionId[] = ['campanhas', 'equipe', 'config', 'financeiro', 'agente', 'admin'];

export interface PermLike { id: PermissionId; label: string; hint: string }

/** Permissões exibidas no editor "Personalizar acesso" (núcleo + avançadas). */
export function editorPermissions<T extends PermLike>(
  perms: T[],
  opts: { legacyPages: boolean },
): { core: T[]; advanced: T[] } {
  const visible = perms.filter((p) => opts.legacyPages || !LEGACY_ONLY_PERMISSIONS.includes(p.id));
  return {
    core: visible.filter((p) => !ADVANCED_PERMISSIONS.includes(p.id)),
    advanced: visible.filter((p) => ADVANCED_PERMISSIONS.includes(p.id)),
  };
}

type Overrides = Partial<Record<PermissionId, boolean>>;

/**
 * Overrides MÍNIMOS: só o que difere de `permissionsFor(role)`. Chaves
 * inválidas e valores não-booleanos são descartados. Para OWNER (acesso total
 * sempre) não há override.
 */
export function minimalOverrides(role: MemberRole, overrides: unknown): Overrides {
  if (role === 'OWNER' || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {};
  const base = permissionsFor(role);
  const out: Overrides = {};
  for (const p of PERMISSIONS) {
    const v = (overrides as Record<string, unknown>)[p.id];
    if (typeof v === 'boolean' && v !== base[p.id]) out[p.id] = v;
  }
  return out;
}

/** Há personalização REAL (diferença do preset)? */
export function hasRealAdjustments(role: MemberRole, overrides: unknown): boolean {
  return Object.keys(minimalOverrides(role, overrides)).length > 0;
}

/**
 * Overrides a exibir ao ABRIR um Member (inclui legado). Se o registro tem
 * `permissionOverrides` usa-os; senão deriva das permissões efetivas.
 * Em ambos os casos normaliza contra o preset do papel.
 */
export function overridesForOpenMember(member: {
  role: MemberRole;
  permissions?: Record<string, boolean>;
  permissionOverrides?: Record<string, boolean>;
}): Overrides {
  const source = member.permissionOverrides ?? member.permissions ?? {};
  return minimalOverrides(member.role, source);
}

/** Trocar de papel = preset limpo do novo papel (nenhum override herdado). */
export function applyRolePreset(nextRole: MemberRole): { role: MemberRole; overrides: Overrides } {
  return { role: nextRole, overrides: {} };
}

/** Rótulos das capacidades do preset de um papel (para o resumo "Acesso padrão"). */
export function presetSummary(role: MemberRole, opts: { legacyPages: boolean }): string[] {
  if (!roleDef(role)) return [];
  const eff = permissionsFor(role);
  return PERMISSIONS
    .filter((p) => eff[p.id] && (opts.legacyPages || !LEGACY_ONLY_PERMISSIONS.includes(p.id)))
    .map((p) => p.label);
}

/**
 * Mensagem de erro em linguagem de produto. Nunca expõe IDs nem nomes de
 * entidades internas (Member/User/Professional); o detalhe técnico fica em log.
 */
export function humanizePersonError(raw: unknown, status?: number): string {
  const msg = String(raw ?? '').trim();
  const lower = msg.toLowerCase();
  if (!msg) return 'Não foi possível salvar esta pessoa. Tente novamente.';
  if (/membro não encontrado|member not found/.test(lower)) {
    return 'Não encontramos o acesso desta pessoa. Recarregue a Equipe e tente novamente.';
  }
  if (/profissional não encontrado|professional not found/.test(lower)) {
    return 'Não encontramos o perfil de atendimento desta pessoa. Recarregue a Equipe e tente novamente.';
  }
  if (/usu[aá]rio n[aã]o encontrado|user not found/.test(lower)) {
    return 'Não encontramos o login desta pessoa. Recarregue a Equipe e tente novamente.';
  }
  if (status === 403 && !/permiss|propriet|administrador|master/.test(lower)) {
    return 'Você não tem permissão para fazer esta alteração.';
  }
  // remove UUIDs/ids crus que possam vazar em mensagens técnicas
  const cleaned = msg
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/\b(userId|memberId|professionalId|businessId)\b/.test(cleaned)) {
    return 'Não foi possível salvar esta pessoa. Recarregue a Equipe e tente novamente.';
  }
  return cleaned;
}
