'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Avatar, Button, IconButton, Notice } from '@/components/ui';
import { PetEditSheet, EMPTY_PET } from '@/components/dashboard/PetEditSheet';
import { PetAllergyChips } from '@/components/dashboard/PetAllergies';
import { apiGet, apiSend } from '@/lib/api-client';
import { PET_SPECIES_LABELS, petAge, petAgeLabel } from '@/lib/pets';
import type { Pet } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P6 / ETAPA 2 — PETS DO TUTOR (só se apresenta em clínica veterinária)
// Um tutor pode ter vários pets; o pet é o PACIENTE da agenda.
// O card abre a página completa do pet (/pets/[id]); o lápis edita o cadastro.
// ═══════════════════════════════════════════════════════════════

export function PetsSection({ businessId, tutorId, tutorName, onChanged }: {
  businessId: string; tutorId: string; tutorName: string; onChanged?: () => void;
}) {
  const [vet, setVet] = useState<boolean | null>(null); // null = ainda não perguntou
  const [pets, setPets] = useState<Pet[]>([]);
  // P1 · falha de leitura é exibida como erro (com nova tentativa), nunca some em silêncio.
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Partial<Pet> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');

  const load = useCallback(async () => {
    if (!tutorId) { setVet(false); return; }
    const res = await apiGet<{ vet: boolean; pets: Pet[] }>(
      `/api/pets?businessId=${encodeURIComponent(businessId)}&tutorId=${encodeURIComponent(tutorId)}`,
      { scope: 'area', area: 'Clientes' },
    );
    if (!res.ok) { setLoadError(true); return; }
    setLoadError(false);
    setVet(!!res.data?.vet);
    setPets(res.data?.pets || []);
  }, [businessId, tutorId]);

  useEffect(() => { void load(); }, [load]);

  async function remove(pet: Pet) {
    if (!window.confirm(`Remover o pet ${pet.name}?`)) return;
    setBusy(true); setError('');
    const res = await apiSend('/api/pets', 'POST', { action: 'delete', businessId, id: pet.id }, { scope: 'action', area: 'Clientes' });
    setBusy(false);
    if (!res.ok) { setError(res.message || 'Não foi possível remover.'); return; }
    setFlash(res.data && (res.data as any).deactivated
      ? 'Pet com histórico — foi desativado para preservar os registros.'
      : 'Pet removido.');
    void load();
    onChanged?.();
  }

  if (loadError) {
    return (
      <div role="alert" className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm font-semibold text-[var(--text)]">Não foi possível carregar os pets deste tutor.</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">A leitura falhou; isto não significa que o tutor não tem pet.</p>
        <button type="button" className="mt-2 text-xs font-semibold text-[var(--brand)] underline" onClick={() => void load()}>Tentar novamente</button>
      </div>
    );
  }

  // Não veterinária (ou ainda carregando): NADA desta estrutura aparece.
  if (!vet) return null;

  return (
    <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      {/* MISSÃO 5 — o PET é o paciente: bloco protagonista; o tutor (card acima) ficou neutro. */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--surface-3)] text-[var(--accent)]">
          <Icon n="paw" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[15.5px] font-semibold text-[var(--text)] leading-tight">
            Pets de {tutorName || 'tutor'} <span className="text-[var(--text-muted)] font-normal">· pacientes</span>
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            O pet é o paciente da agenda; {tutorName || 'o tutor'} continua sendo o contato.
          </p>
        </div>
      </div>

      {error && <Notice tone="error" className="mt-2">{error}</Notice>}
      {flash && <Notice tone="success" className="mt-2">{flash}</Notice>}

      {pets.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] mt-3">Nenhum pet cadastrado ainda.</p>
      ) : (
        <ul className="client360-pets-list mt-3 space-y-2">
          {pets.map((p) => {
            const age = petAge(p.birthDate);
            const chips = [PET_SPECIES_LABELS[p.species] || p.species, p.breed, p.sex === 'M' ? 'Macho' : p.sex === 'F' ? 'Fêmea' : '', age !== null ? `${age} ano(s)` : '', p.weightKg ? `${p.weightKg} kg` : ''].filter(Boolean);
            return (
              <li key={p.id} className="client360-pet-card flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-3 transition-colors hover:border-[var(--border-strong,var(--border))]">
                <Link href={`/pets/${encodeURIComponent(p.id)}?b=${encodeURIComponent(businessId)}`}
                  aria-label={`Abrir ficha completa de ${p.name}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                  data-pet-card-link={p.id}>
                  <Avatar name={p.name} src={p.photo || undefined} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-2 text-[16px] font-semibold leading-tight text-[var(--text-strong)]">
                      <span className="truncate">{p.name}</span>
                      {!p.active && <span className="shrink-0 text-[11px] font-semibold text-[var(--text-muted)]">(inativo)</span>}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {chips.map((chip) => (
                        <span key={chip} className="inline-flex items-center rounded-pill border border-[var(--border)] bg-[var(--surface-3)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                          {chip}
                        </span>
                      ))}
                      {chips.length === 0 && <span className="text-xs text-[var(--text-muted)]">{petAgeLabel(p.birthDate) || 'Sem detalhes'}</span>}
                    </p>
                    <PetAllergyChips pet={p} max={2} className="mt-1.5" />
                  </div>
                  <Icon n="chevronRight" size={16} className="shrink-0 text-[var(--text-soft)]" />
                </Link>
                <span className="client360-pet-card__actions flex shrink-0 items-center gap-1">
                  <IconButton icon="pencil" label={`Editar cadastro de ${p.name}`} size="sm" disabled={busy} onClick={() => setEditing(p)} />
                  <IconButton icon="x" label={`Remover ${p.name}`} size="sm" variant="ghost" disabled={busy} onClick={() => { void remove(p); }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* A ação de cadastro mora embaixo do bloco, à esquerda (hierarquia pet × tutor). */}
      <div className="mt-3.5">
        <Button size="sm" variant="secondary" onClick={() => { setError(''); setEditing({ ...EMPTY_PET }); }}>
          <Icon n="plus" size={16} /> Cadastrar pet
        </Button>
      </div>

      <PetEditSheet
        businessId={businessId}
        tutorId={tutorId}
        tutorName={tutorName}
        pet={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setFlash('Pet salvo.'); void load(); onChanged?.(); }}
      />
    </div>
  );
}
