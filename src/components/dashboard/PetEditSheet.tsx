'use client';
import { useEffect, useState } from 'react';
import { Button, Field, Input, Notice, SelectMenu, Textarea } from '@/components/ui';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { useOverlayDismissGuard } from '@/components/dashboard/OverlayDismissGuard';
import { apiSend } from '@/lib/api-client';
import { PET_SPECIES, PET_SPECIES_LABELS, breedSuggestions, validatePet } from '@/lib/pets';
import type { Pet } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// ETAPA 2 · FORMULÁRIO DE CADASTRO DO PET (fonte única)
// ═══════════════════════════════════════════════════════════════
// Usado pelo Tutor 360 (lápis do card) e pela página do Pet 360 (Editar).
// Grava só os campos de CADASTRO: alergias têm API própria e nunca são
// sobrescritas por esta edição (ver /api/pets, `update`).

const PET_FORM_KEYS: Array<keyof Pet> = ['id', 'name', 'species', 'breed', 'sex', 'birthDate', 'weightKg', 'notes', 'photo'];
const petFormKey = (pet: Partial<Pet>) => JSON.stringify(PET_FORM_KEYS.map((key) => pet[key] ?? ''));

export const EMPTY_PET: Partial<Pet> = {
  name: '', species: 'cachorro', breed: '', sex: '', birthDate: '', weightKg: 0, notes: '', photo: '',
};

export function PetEditSheet({ businessId, tutorId, tutorName, pet, onClose, onSaved }: {
  businessId: string;
  tutorId: string;
  tutorName: string;
  /** `null` = fechado. Um objeto = abrir para editar (ou novo, com `EMPTY_PET`). */
  pet: Partial<Pet> | null;
  onClose: () => void;
  onSaved: (saved: Pet) => void;
}) {
  const [editing, setEditing] = useState<Partial<Pet> | null>(null);
  const [baseline, setBaseline] = useState<Partial<Pet> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dismiss = useOverlayDismissGuard();

  // Abrir: copia o registro para o rascunho e guarda a linha de base (para o guard).
  useEffect(() => {
    if (!pet) return;
    const initial = { ...pet };
    setError('');
    setEditing(initial);
    setBaseline(initial);
  }, [pet]);

  const dirty = !!editing && !!baseline && petFormKey(editing) !== petFormKey(baseline);
  const dismissState = {
    dirty, saving: busy, context: 'edit' as const,
    title: editing?.id ? 'Descartar alterações do pet?' : 'Descartar cadastro do pet?',
    description: editing?.id ? 'As alterações feitas no cadastro serão perdidas.' : 'Os dados preenchidos serão perdidos.',
  };
  const requestClose = () => dismiss.requestClose('close-button', dismissState, onClose);

  async function save() {
    if (!editing) return;
    const problem = validatePet(editing);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    const res = await apiSend<{ pet?: Pet }>('/api/pets', 'POST', {
      action: editing.id ? 'update' : 'create',
      businessId, tutorId,
      pet: editing,
    }, { scope: 'action', area: 'Clientes' });
    setBusy(false);
    if (!res.ok) { setError(res.message || 'Não foi possível salvar o pet.'); return; }
    const saved = (res.data as any)?.pet as Pet | undefined;
    onSaved(saved as Pet);
    onClose();
  }

  return (
    <WorkspaceSheet
      open={!!pet}
      onClose={onClose}
      dismissGuard={dismissState}
      title={editing?.id ? `Editar ${editing.name || 'pet'}` : 'Novo pet'}
      subtitle={tutorName ? `Paciente de ${tutorName}` : 'Novo paciente (pet)'}
      icon="paw"
      width="max-w-[520px]"
      footer={(
        <div className="flex w-full items-center justify-end gap-2.5">
          <Button variant="secondary" onClick={requestClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={() => { void save(); }} disabled={busy} className="min-w-[108px]">{busy ? 'Salvando…' : 'Salvar pet'}</Button>
        </div>
      )}
    >
      {dismiss.dialog}
      {error && <Notice tone="error" className="mb-3">{error}</Notice>}
      {editing && (
        <div className="p-1 space-y-4">
          <section className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-subtle)] p-3.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-soft)]">Identificação</p>
            <Field label="Nome" required htmlFor="pet-name">
              <Input id="pet-name" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Thor" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Espécie" htmlFor="pet-species">
                <SelectMenu id="pet-species" value={editing.species || ''} onChange={(v) => setEditing({ ...editing, species: v })}
                  options={[{ value: '', label: '—' }, ...PET_SPECIES.map((s) => ({ value: s, label: PET_SPECIES_LABELS[s] }))]} />
              </Field>
              <Field label="Raça" htmlFor="pet-breed" hint="Autocomplete pela espécie — pode digitar outra.">
                <Input id="pet-breed" list="pet-breeds-datalist" value={editing.breed || ''} onChange={(e) => setEditing({ ...editing, breed: e.target.value })} placeholder="Ex.: Pastor alemão" />
                <datalist id="pet-breeds-datalist">
                  {breedSuggestions(editing.species || '').map((b) => <option key={b} value={b} />)}
                </datalist>
              </Field>
            </div>
          </section>
          <section className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-subtle)] p-3.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-soft)]">Características</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sexo" htmlFor="pet-sex">
                <SelectMenu id="pet-sex" value={editing.sex || ''} onChange={(v) => setEditing({ ...editing, sex: v as any })}
                  options={[{ value: '', label: 'Não informado' }, { value: 'M', label: 'Macho' }, { value: 'F', label: 'Fêmea' }]} />
              </Field>
              <Field label="Nascimento" htmlFor="pet-birth">
                <Input id="pet-birth" type="date" value={editing.birthDate || ''} onChange={(e) => setEditing({ ...editing, birthDate: e.target.value })} />
              </Field>
              <Field label="Peso de cadastro (kg)" htmlFor="pet-weight" hint="Referência. O peso medido em cada atendimento fica no histórico.">
                <Input id="pet-weight" type="number" min="0" max="500" step="0.01" value={editing.weightKg ?? ''} onChange={(e) => setEditing({ ...editing, weightKg: Number(e.target.value) })} />
              </Field>
              <Field label="Foto (URL)" htmlFor="pet-photo" hint="Opcional.">
                <Input id="pet-photo" value={editing.photo || ''} onChange={(e) => setEditing({ ...editing, photo: e.target.value })} placeholder="https://…" />
              </Field>
            </div>
          </section>
          <section className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-subtle)] p-3.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-soft)]">Observações</p>
            <Field label="Observações" htmlFor="pet-notes" hint="Comportamento e cuidados. Alergias: cadastre na aba Alergias do pet.">
              <Textarea id="pet-notes" rows={4} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                placeholder="Ex.: calmo com crianças; medo de aspirador."
                className="min-h-[104px] resize-none leading-relaxed rounded-[var(--radius-sm)]" />
            </Field>
          </section>
        </div>
      )}
    </WorkspaceSheet>
  );
}
