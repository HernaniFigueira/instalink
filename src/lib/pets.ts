// ═══════════════════════════════════════════════════════════════
// FASE 2 · P6 — VETERINÁRIA: TUTOR (contato) ≠ PET (paciente)
// ═══════════════════════════════════════════════════════════════
// O tutor é um BusinessCustomer normal (pessoa de contato). O Pet é entidade
// própria com vários por tutor. Essa estrutura só se APRESENTA quando o
// negócio é veterinário (clinicType) — os dados, porém, são aditivos e não
// afetam nenhum outro tipo de clínica (petId continua '').
// Módulo PURO (sem I/O): validação, rótulos e derivações.
import type { Pet } from './types';

export const PET_SPECIES = ['cachorro', 'gato', 'ave', 'roedor', 'reptil', 'outro'] as const;
export type PetSpecies = typeof PET_SPECIES[number] | string;

export const PET_SPECIES_LABELS: Record<string, string> = {
  cachorro: 'Cachorro', gato: 'Gato', ave: 'Ave', roedor: 'Roedor', reptil: 'Réptil', outro: 'Outro',
};

/** Idade derivada da data de nascimento (null = não informado). */
export function petAge(birthDate: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const born = Date.parse(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(born)) return null;
  const now = Date.now();
  if (born > now) return null;
  const years = Math.floor((now - born) / (365.25 * 86400000));
  return years >= 0 ? years : null;
}

/** Rótulo legível: "Thor · Cachorro (Pastor alemão)". */
export function petLabel(p: Partial<Pick<Pet, 'name' | 'species' | 'breed'>>): string {
  const name = String(p.name || '').trim() || 'Pet';
  const sp = PET_SPECIES_LABELS[p.species || ''] || (p.species || '');
  const breed = String(p.breed || '').trim();
  const tail = [sp, breed].filter(Boolean).join(' (').length && breed && sp ? `${sp} (${breed})` : (sp || breed);
  return tail ? `${name} · ${tail}` : name;
}

export interface PetInput {
  name?: unknown; species?: unknown; breed?: unknown; sex?: unknown;
  birthDate?: unknown; weightKg?: unknown; notes?: unknown; photo?: unknown; active?: unknown;
}

/** Validação com mensagem amigável ('' = ok). */
export function validatePet(input: PetInput): string {
  if (!String(input.name || '').trim()) return 'Informe o nome do pet.';
  if (String(input.name || '').trim().length > 80) return 'O nome do pet é muito longo.';
  if (input.birthDate && String(input.birthDate) && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.birthDate))) {
    return 'Data de nascimento inválida.';
  }
  const w = input.weightKg === undefined || input.weightKg === '' ? 0 : Number(input.weightKg);
  if (!Number.isFinite(w) || w < 0 || w > 500) return 'Peso inválido (0 a 500 kg).';
  return '';
}

/** Higieniza para gravação (campos limitados, defaults seguros). */
export function sanitizePet(over: { id?: string; businessId: string; tutorId: string }, input: PetInput): Omit<Pet, 'createdAt' | 'updatedAt'> {
  const sexRaw = String(input.sex || '');
  const w = input.weightKg === undefined || input.weightKg === '' ? 0 : Number(input.weightKg);
  return {
    id: String(over.id || ''),
    businessId: over.businessId,
    tutorId: over.tutorId,
    name: String(input.name || '').trim().slice(0, 80),
    photo: String(input.photo || '').slice(0, 600),
    species: String(input.species || '').trim().toLowerCase().slice(0, 40),
    breed: String(input.breed || '').trim().slice(0, 80),
    sex: sexRaw === 'M' || sexRaw === 'F' ? sexRaw : '',
    birthDate: input.birthDate ? String(input.birthDate).slice(0, 10) : '',
    weightKg: Number.isFinite(w) ? Math.round(w * 100) / 100 : 0,
    notes: String(input.notes || '').slice(0, 1000),
    active: input.active !== false,
  };
}

/** Pets de um tutor, mais recentes primeiro (criação decrescente). */
export function petsOfTutor(pets: Pet[], tutorId: string): Pet[] {
  if (!tutorId) return [];
  return pets.filter((p) => p.tutorId === tutorId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Rótulo de exibição na AGENDA: PET primeiro, tutor como contexto. */
export function agendaLabelFor(booking: { customerName: string; petId?: string }, pets: Pet[]): { primary: string; secondary: string } {
  const pet = booking.petId ? pets.find((p) => p.id === booking.petId) : null;
  if (pet) return { primary: pet.name, secondary: booking.customerName };
  return { primary: booking.customerName, secondary: '' };
}
