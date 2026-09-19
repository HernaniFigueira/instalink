// ═══════════════════════════════════════════════════════════════
// PERMISSÕES E PAPÉIS — catálogo puro (cliente + servidor)
// ═══════════════════════════════════════════════════════════════
// Sem I/O: pode ser importado por componentes de cliente (para rotular e
// esconder ações) e reexportado pela camada de acesso do servidor.
import type { MemberRole, PermissionId } from './types';
import { VALID_MEMBER_ROLES } from './types';

// ── Catálogo de permissões (fonte única) ─────────────────────
export interface PermissionDef {
  id: PermissionId;
  label: string;
  hint: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { id: 'dashboard', label: 'Início', hint: 'Visão geral do negócio e indicadores do dia' },
  { id: 'agenda', label: 'Agenda', hint: 'Ver e operar a agenda (confirmar, concluir, remarcar)' },
  { id: 'clientes', label: 'Clientes', hint: 'CRM de clientes e histórico 360' },
  { id: 'leads', label: 'Leads', hint: 'Interesses e conversas captadas na página' },
  { id: 'pedidos', label: 'Pedidos', hint: 'Pedidos do catálogo e status' },
  { id: 'catalogo', label: 'Catálogo', hint: 'Produtos, serviços, profissionais e horários' },
  { id: 'pagina', label: 'Página', hint: 'Editor da página, tema e avaliações' },
  { id: 'agente', label: 'Assistente', hint: 'Configurar o agente de atendimento' },
  { id: 'whatsapp', label: 'WhatsApp', hint: 'Conexão e conversas do WhatsApp' },
  { id: 'campanhas', label: 'Campanhas', hint: 'Criar campanhas para quem consentiu' },
  { id: 'equipe', label: 'Equipe', hint: 'Criar logins e definir permissões' },
  { id: 'config', label: 'Configuração', hint: 'Dados do negócio, recursos e regras' },
  { id: 'financeiro', label: 'Financeiro', hint: 'Resultados, receita e conversões' },
  { id: 'admin', label: 'Administração', hint: 'Área administrativa da empresa' },
];

export const PERMISSION_IDS: PermissionId[] = PERMISSIONS.map((p) => p.id);

export interface RoleDef {
  id: MemberRole;
  label: string;
  hint: string;
  permissions: PermissionId[];
}

// Papéis iniciais (enxutos e claros). Permissões individuais podem ser
// ajustadas por cima do padrão do papel.
export const ROLES: RoleDef[] = [
  {
    id: 'OWNER', label: 'Proprietário', hint: 'Acesso total, inclusive equipe e configuração',
    permissions: [...PERMISSION_IDS],
  },
  {
    id: 'ADMIN', label: 'Administrador', hint: 'Acesso total exceto administração da plataforma',
    permissions: PERMISSION_IDS.filter((p) => p !== 'admin'),
  },
  {
    id: 'SECRETARIA', label: 'Secretária', hint: 'Agenda, clientes, leads e WhatsApp',
    permissions: ['dashboard', 'agenda', 'clientes', 'leads', 'pedidos', 'whatsapp', 'agente'],
  },
  {
    id: 'ATENDENTE', label: 'Atendente', hint: 'Agenda, clientes e WhatsApp',
    permissions: ['dashboard', 'agenda', 'clientes', 'whatsapp', 'agente'],
  },
  {
    id: 'VENDEDOR', label: 'Vendedor', hint: 'Clientes, leads e campanhas',
    permissions: ['dashboard', 'clientes', 'leads', 'whatsapp', 'campanhas'],
  },
  {
    id: 'VIEWER', label: 'Visualizador', hint: 'Somente leitura do resumo',
    permissions: [],
  },
  {
    // Quem ATENDE (médico, dentista, barbeiro, veterinário, esteticista…).
    // Mesmo catálogo de permissões — nenhum sistema paralelo. O recorte de
    // "somente a própria agenda" vem do vínculo User→Professional
    // (Professional.userId) e é aplicado no backend (lib/access-core.ts).
    id: 'PROFISSIONAL', label: 'Profissional',
    hint: 'Vê a própria agenda e os clientes da unidade (sem configurações)',
    permissions: ['dashboard', 'agenda', 'clientes'],
  },
];

export function roleDef(role: MemberRole): RoleDef | undefined {
  return ROLES.find((r) => r.id === role);
}

export function isValidRole(role: unknown): role is MemberRole {
  return typeof role === 'string' && VALID_MEMBER_ROLES.includes(role as MemberRole);
}

export function isValidPermission(id: unknown): id is PermissionId {
  return typeof id === 'string' && PERMISSION_IDS.includes(id as PermissionId);
}

/** Permissões efetivas: padrão do papel + overrides individuais. */
export function permissionsFor(
  role: MemberRole,
  overrides: Partial<Record<PermissionId, boolean>> = {},
): Record<PermissionId, boolean> {
  const base = roleDef(role)?.permissions || [];
  const out = {} as Record<PermissionId, boolean>;
  for (const id of PERMISSION_IDS) out[id] = base.includes(id);
  for (const id of PERMISSION_IDS) {
    const v = overrides[id];
    if (typeof v === 'boolean') out[id] = v;
  }
  if (role === 'OWNER') {
    // O proprietário nunca perde acesso por override inconsistente.
    for (const id of PERMISSION_IDS) out[id] = true;
  }
  return out;
}
