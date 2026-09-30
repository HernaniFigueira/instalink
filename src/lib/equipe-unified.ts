// Projeção unificada de pessoas — fonte única para Equipe
// Mantém BusinessMember (acesso) e Professional (atende) como tabelas distintas,
// mas exibe UMA lista sem duplicar.
// Owner + Professional com mesmo userId = UMA linha (proprietário que também atende).

import type { Availability, Professional } from './types';
import { followsBusinessHours } from './schedule';

interface Owner {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export type UnifiedEntry =
  | { kind: 'owner'; name: string; email: string; role: string; isOwner: true; professional: Professional | null }
  | { kind: 'member'; member: any; professional: Professional | null }
  | { kind: 'professional'; professional: Professional };

export function buildUnified(
  owner: Owner | null,
  members: any[],
  pros: Professional[],
): UnifiedEntry[] {
  const unified: UnifiedEntry[] = [];
  const professionalById = new Map(pros.map((p) => [p.id, p]));
  const linkedProfessionalIds = new Set<string>();

  let ownerPro: Professional | null = null;
  if (owner?.userId) {
    ownerPro = pros.find((p) => p.userId === owner.userId) || null;
    if (ownerPro) linkedProfessionalIds.add(ownerPro.id);
  }
  if (owner) {
    unified.push({ kind: 'owner', name: owner.name, email: owner.email, role: owner.role, isOwner: true, professional: ownerPro });
  }
  for (const m of members) {
    let pro: Professional | null = null;
    if (m.professionalId) pro = (professionalById.get(m.professionalId) as Professional) || null;
    else if (m.userId) pro = pros.find((p) => p.userId === m.userId) || null;
    if (pro) linkedProfessionalIds.add(pro.id);
    unified.push({ kind: 'member', member: m, professional: pro });
  }
  for (const p of pros) {
    if (linkedProfessionalIds.has(p.id)) continue;
    if (!p.userId) {
      const alreadyLinked = members.some((m) => m.professionalId === p.id);
      if (alreadyLinked) continue;
      unified.push({ kind: 'professional', professional: p });
    }
    if (p.userId && !members.some((m) => m.userId === p.userId || m.professionalId === p.id) && p.userId !== owner?.userId) {
      unified.push({ kind: 'professional', professional: p });
    }
  }
  return unified;
}

// Helpers para UI (reuso)
export function atende(pro: Professional | null): boolean {
  return !!pro && pro.active !== false;
}
export function agendaLabel(pro: Professional | null, rules: Availability[]): string {
  if (!pro || !atende(pro)) return '—';
  return followsBusinessHours(pro, rules) ? 'Segue a clínica' : 'Horário próprio';
}
