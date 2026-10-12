'use client';
import { useState } from 'react';
import { Badge, Button, Field, IconButton, Input, Notice, SelectMenu, type BadgeTone } from '@/components/ui';
import { apiSend } from '@/lib/api-client';
import {
  PET_ALLERGY_SEVERITIES, PET_ALLERGY_SEVERITY_LABELS, activePetAllergies, validatePetAllergy,
} from '@/lib/pets';
import { formatDateBR } from '@/lib/tz';
import type { Pet, PetAllergy, PetAllergySeverity } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// ETAPA 2 · ALERGIAS ESTRUTURADAS DO PACIENTE
// ═══════════════════════════════════════════════════════════════
// Vínculo exclusivo ao `petId`: cada lista pertence a UM pet. Gravação só pela
// API de alergias (/api/pets, ações allergy-*), que exige permissão de
// atendimento e vínculo do profissional. `canWrite` apenas esconde os controles;
// a imposição é do servidor.

const SEVERITY_TONE: Record<string, BadgeTone> = { grave: 'red', moderada: 'amber', leve: 'zinc', '': 'zinc' };

/** Chips compactos das alergias que valem hoje (cards do Tutor 360, Pet 360, agenda). */
export function PetAllergyChips({ pet, max = 3, className = '' }: { pet: Pick<Pet, 'allergies'>; max?: number; className?: string }) {
  const active = activePetAllergies(pet);
  if (active.length === 0) return null;
  const shown = active.slice(0, max);
  const rest = active.length - shown.length;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`} data-pet-allergies={active.length}>
      {shown.map((a) => (
        <Badge key={a.id} tone={SEVERITY_TONE[a.severity] || 'zinc'} icon="alert" title={a.reaction ? `${a.substance}: ${a.reaction}` : a.substance}>
          Alergia · {a.substance}
        </Badge>
      ))}
      {rest > 0 && <span className="text-[11px] font-semibold text-[var(--text-muted)]">+{rest}</span>}
    </span>
  );
}

type Draft = { substance: string; reaction: string; severity: PetAllergySeverity };
const EMPTY_DRAFT: Draft = { substance: '', reaction: '', severity: '' };

export function PetAllergyManager({ businessId, pet, canWrite, onChanged }: {
  businessId: string;
  pet: Pet;
  /** Permissão de atendimento (espelho do servidor; a API decide de novo). */
  canWrite: boolean;
  onChanged: (pet: Pet) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string>('');
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const all: PetAllergy[] = pet.allergies || [];
  const active = activePetAllergies(pet);
  const inactive = all.filter((a) => !a.active).sort((a, b) => (a.inactivatedAt < b.inactivatedAt ? 1 : -1));

  async function send(body: Record<string, unknown>, okMessage: string) {
    setBusy(true); setError(''); setFlash('');
    const res = await apiSend<{ pet?: Pet }>('/api/pets', 'POST', { businessId, petId: pet.id, ...body }, { scope: 'action', area: 'Atendimento' });
    setBusy(false);
    if (!res.ok) {
      // 403 = autorização: título canônico + motivo do servidor (sem perder o porquê).
      // 404 e demais = mensagem do servidor/canônica.
      const reason = res.denied ? [res.denied.title, res.denied.hint].filter(Boolean).join(' — ') : res.message;
      setError(reason || 'Não foi possível salvar a alergia.');
      return false;
    }
    const saved = (res.data as any)?.pet as Pet | undefined;
    if (saved) onChanged(saved);
    setFlash(okMessage);
    return true;
  }

  async function saveDraft() {
    if (!draft) return;
    const problem = validatePetAllergy(draft);
    if (problem) { setError(problem); return; }
    const ok = editingId
      ? await send({ action: 'allergy-update', allergyId: editingId, allergy: draft }, 'Alergia atualizada.')
      : await send({ action: 'allergy-add', allergy: draft }, 'Alergia registrada.');
    if (ok) { setDraft(null); setEditingId(''); }
  }

  async function inactivate(a: PetAllergy) {
    if (!window.confirm(`Inativar a alergia "${a.substance}"? Ela sai da lista atual, mas continua no histórico do paciente.`)) return;
    await send({ action: 'allergy-deactivate', allergyId: a.id }, 'Alergia inativada. O registro foi mantido no histórico.');
  }

  const formOpen = draft !== null;

  return (
    <div className="space-y-4" data-pet-allergy-manager>
      {error && <Notice tone="error">{error}</Notice>}
      {flash && <Notice tone="success">{flash}</Notice>}

      {!canWrite && (
        <Notice tone="info">Você pode consultar as alergias. O registro é feito pela equipe de atendimento.</Notice>
      )}

      {active.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]" data-testid="pet-allergies-empty">Nenhuma alergia registrada para {pet.name}.</p>
      ) : (
        <ul className="divide-y divide-[var(--border-soft)] rounded-md border border-[var(--border)]" data-testid="pet-allergies-active">
          {active.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 px-3 py-2.5" data-allergy-id={a.id}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text)]">
                  <span className="break-words">{a.substance}</span>
                  <Badge tone={SEVERITY_TONE[a.severity] || 'zinc'}>{PET_ALLERGY_SEVERITY_LABELS[a.severity] || 'Não informada'}</Badge>
                </p>
                {a.reaction && <p className="mt-0.5 text-xs text-[var(--text-muted)] break-words">Reação: {a.reaction}</p>}
                <p className="mt-0.5 text-[11px] text-[var(--text-soft)] tabular-nums">Registrada em {formatDateBR((a.recordedAt || '').slice(0, 10))}</p>
              </div>
              {canWrite && (
                <span className="flex shrink-0 items-center gap-1">
                  <IconButton icon="pencil" label={`Editar alergia ${a.substance}`} size="sm" disabled={busy || formOpen}
                    onClick={() => { setEditingId(a.id); setDraft({ substance: a.substance, reaction: a.reaction, severity: a.severity }); setError(''); setFlash(''); }} />
                  <IconButton icon="x" label={`Inativar alergia ${a.substance}`} size="sm" variant="ghost" disabled={busy || formOpen}
                    onClick={() => { void inactivate(a); }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && !formOpen && (
        <div>
          <Button size="sm" variant="secondary" disabled={busy}
            onClick={() => { setDraft({ ...EMPTY_DRAFT }); setEditingId(''); setError(''); setFlash(''); }}>
            Registrar alergia
          </Button>
        </div>
      )}

      {canWrite && formOpen && draft && (
        <section className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-subtle)] p-3.5" aria-label={editingId ? 'Editar alergia' : 'Nova alergia'}>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--text-soft)]">{editingId ? 'Editar alergia' : 'Nova alergia'}</p>
          <Field label="Substância ou alimento" required htmlFor="allergy-substance" hint="Ex.: dipirona, frango, picada de pulga.">
            <Input id="allergy-substance" maxLength={80} value={draft.substance} onChange={(e) => setDraft({ ...draft, substance: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Gravidade" htmlFor="allergy-severity">
              <SelectMenu id="allergy-severity" value={draft.severity} onChange={(v) => setDraft({ ...draft, severity: v as PetAllergySeverity })}
                options={[{ value: '', label: PET_ALLERGY_SEVERITY_LABELS[''] }, ...PET_ALLERGY_SEVERITIES.map((s) => ({ value: s, label: PET_ALLERGY_SEVERITY_LABELS[s] }))]} />
            </Field>
            <Field label="Reação observada" htmlFor="allergy-reaction">
              <Input id="allergy-reaction" maxLength={200} value={draft.reaction} onChange={(e) => setDraft({ ...draft, reaction: e.target.value })} placeholder="Ex.: vômito, coceira" />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setDraft(null); setEditingId(''); setError(''); }}>Cancelar</Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => { void saveDraft(); }}>{busy ? 'Salvando…' : 'Salvar alergia'}</Button>
          </div>
        </section>
      )}

      {inactive.length > 0 && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setShowInactive((v) => !v)} aria-expanded={showInactive}>
            {showInactive ? 'Ocultar' : 'Ver'} alergias inativadas ({inactive.length})
          </Button>
          {showInactive && (
            <ul className="mt-2 space-y-1.5" data-testid="pet-allergies-inactive">
              {inactive.map((a) => (
                <li key={a.id} className="text-xs text-[var(--text-muted)]">
                  <span className="line-through">{a.substance}</span>
                  {' '}· inativada em {formatDateBR((a.inactivatedAt || '').slice(0, 10))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
