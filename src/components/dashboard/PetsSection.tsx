'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, Field, IconButton, Input, Notice, Select, Textarea } from '@/components/ui';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { apiGet, apiSend } from '@/lib/api-client';
import { PET_SPECIES, PET_SPECIES_LABELS, breedSuggestions, petAge, petLabel, validatePet } from '@/lib/pets';
import type { Pet } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P6 — PETS DO TUTOR (só se apresenta em clínica veterinária)
// Um tutor pode ter vários pets; o pet é o PACIENTE da agenda.
// ═══════════════════════════════════════════════════════════════
const EMPTY_PET: Partial<Pet> = {
  name: '', species: 'cachorro', breed: '', sex: '', birthDate: '', weightKg: 0, notes: '', photo: '',
};

export function PetsSection({ businessId, tutorId, tutorName, onChanged, onOpenPet }: {
  businessId: string; tutorId: string; tutorName: string; onChanged?: () => void;
  /** Abre o Pet 360 (ficha do animal) — HOMOLOGAÇÃO P1. */
  onOpenPet?: (pet: Pet) => void;
}) {
  const [vet, setVet] = useState<boolean | null>(null); // null = ainda não perguntou
  const [pets, setPets] = useState<Pet[]>([]);
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
    if (!res.ok) { setVet(false); return; }
    setVet(!!res.data?.vet);
    setPets(res.data?.pets || []);
  }, [businessId, tutorId]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!editing) return;
    const problem = validatePet(editing);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    const res = await apiSend('/api/pets', 'POST', {
      action: editing.id ? 'update' : 'create',
      businessId, tutorId,
      pet: editing,
    }, { scope: 'action', area: 'Clientes' });
    setBusy(false);
    if (!res.ok) { setError(res.message || 'Não foi possível salvar o pet.'); return; }
    setEditing(null);
    setFlash('Pet salvo.');
    void load();
    onChanged?.();
  }

  async function remove(pet: Pet) {
    const label = `${pet.name}?`;
    if (!window.confirm(`Remover o pet ${label}`)) return;
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

  // Não veterinária (ou ainda carregando): NADA desta estrutura aparece.
  if (!vet) return null;

  return (
    <div className="mt-3 rounded-xl border border-[var(--sun-border)] bg-[var(--sun-bg)] p-4 shadow-xs">
      {/* MISSÃO 5 — o PET é o paciente: bloco creme quente protagonista;
          o tutor (card acima) ficou neutro e discreto. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--sun-border)] bg-[var(--sun-bg-strong)] text-[var(--sun-fg)]">
            <Icon n="paw" size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[var(--text)] leading-tight">
              Pets de {tutorName || 'tutor'} <span className="text-[var(--sun-fg)] font-normal">· pacientes</span>
            </p>
            <p className="text-xs text-[var(--sun-fg)] mt-0.5">
              O pet é o paciente da agenda; {tutorName || 'o tutor'} continua sendo o contato.
            </p>
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={() => { setError(''); setEditing({ ...EMPTY_PET }); }}>
          <Icon n="plus" size={14} /> Pet
        </Button>
      </div>

      {error && <Notice tone="error" className="mt-2">{error}</Notice>}
      {flash && <Notice tone="success" className="mt-2">{flash}</Notice>}

      {pets.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] mt-3">Nenhum pet cadastrado ainda.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {pets.map((p) => {
            const age = petAge(p.birthDate);
            return (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-[var(--sun-border)] bg-white/70 px-3 py-2.5">
                <Avatar name={p.name} src={p.photo || undefined} size={40} />
                <div className="min-w-0 flex-1">
                  <button type="button" className="text-[15px] font-semibold text-[var(--text)] truncate hover:underline text-left w-full leading-tight"
                    onClick={() => onOpenPet?.(p)} title={`Abrir ficha de ${p.name}`}>
                    {p.name}{!p.active && <span className="ml-2 text-[11px] font-semibold text-[var(--text-muted)]">(inativo)</span>}
                  </button>
                  <p className="mt-1 flex flex-wrap items-center gap-1">
                    {([PET_SPECIES_LABELS[p.species] || p.species, p.breed, age !== null ? `${age} ano(s)` : '', p.weightKg ? `${p.weightKg} kg` : ''].filter(Boolean))
                      .map((chip) => (
                        <span key={chip} className="inline-flex items-center rounded-pill border border-[var(--sun-border)] bg-[var(--sun-bg-strong)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sun-fg)]">
                          {chip}
                        </span>
                      ))}
                    {[PET_SPECIES_LABELS[p.species] || p.species, p.breed, age !== null ? `${age} ano(s)` : '', p.weightKg ? `${p.weightKg} kg` : ''].filter(Boolean).length === 0 && (
                      <span className="text-xs text-[var(--text-muted)]">Sem detalhes</span>
                    )}
                  </p>
                </div>
                {p.sex && <Badge tone="zinc">{p.sex === 'M' ? 'Macho' : 'Fêmea'}</Badge>}
                <IconButton icon="pencil" label={`Editar ${p.name}`} size="sm" onClick={() => { setError(''); setEditing({ ...p }); }} />
                <IconButton icon="x" label={`Remover ${p.name}`} size="sm" variant="ghost" disabled={busy} onClick={() => { void remove(p); }} />
              </li>
            );
          })}
        </ul>
      )}

      <WorkspaceSheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Editar ${editing.name || 'pet'}` : 'Novo pet'}
        subtitle={tutorName ? `Tutor: ${tutorName}` : undefined}
        icon="paw"
        width="max-w-[520px]"
        footer={(
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={() => { void save(); }} disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Button>
          </div>
        )}
      >
        {editing && (
          <div className="p-1 space-y-5">
            <section className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Identificação</p>
              <Field label="Nome" required htmlFor="pet-name">
                <Input id="pet-name" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Thor" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
              <Field label="Espécie" htmlFor="pet-species">
                <Select id="pet-species" value={editing.species || ''} onChange={(e) => setEditing({ ...editing, species: e.target.value })}>
                  <option value="">—</option>
                  {PET_SPECIES.map((s) => <option key={s} value={s}>{PET_SPECIES_LABELS[s]}</option>)}
                </Select>
              </Field>
              <Field label="Raça" htmlFor="pet-breed" hint="Autocomplete pela espécie — pode digitar outra.">
                <Input id="pet-breed" list="pet-breeds-datalist" value={editing.breed || ''} onChange={(e) => setEditing({ ...editing, breed: e.target.value })} placeholder="Ex.: Pastor alemão" />
                <datalist id="pet-breeds-datalist">
                  {breedSuggestions(editing.species || '').map((b) => <option key={b} value={b} />)}
                </datalist>
              </Field>
              </div>
            </section>
            <section className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Características</p>
              <div className="grid grid-cols-2 gap-3">
              <Field label="Sexo" htmlFor="pet-sex">
                <Select id="pet-sex" value={editing.sex || ''} onChange={(e) => setEditing({ ...editing, sex: e.target.value as any })}>
                  <option value="">Não informado</option>
                  <option value="M">Macho</option>
                  <option value="F">Fêmea</option>
                </Select>
              </Field>
              <Field label="Nascimento" htmlFor="pet-birth">
                <Input id="pet-birth" type="date" value={editing.birthDate || ''} onChange={(e) => setEditing({ ...editing, birthDate: e.target.value })} />
              </Field>
              <Field label="Peso (kg)" htmlFor="pet-weight">
                <Input id="pet-weight" type="number" min="0" max="500" step="0.01" value={editing.weightKg ?? ''} onChange={(e) => setEditing({ ...editing, weightKg: Number(e.target.value) })} />
              </Field>
              <Field label="Foto (URL)" htmlFor="pet-photo" hint="Opcional.">
                <Input id="pet-photo" value={editing.photo || ''} onChange={(e) => setEditing({ ...editing, photo: e.target.value })} placeholder="https://…" />
              </Field>
              </div>
            </section>
            <section className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Observações</p>
              <Field label="Observações" htmlFor="pet-notes" hint="Comportamento, alergias, cuidados.">
                <Textarea id="pet-notes" rows={3} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} className="min-h-[84px] resize-none leading-relaxed" />
              </Field>
            </section>
          </div>
        )}
      </WorkspaceSheet>
    </div>
  );
}
