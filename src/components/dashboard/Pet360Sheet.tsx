'use client';
// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · P1 — PET 360 (ficha do animal)
// ═══════════════════════════════════════════════════════════════
// Ao clicar no pet (Greg) na agenda/detalhe: resumo do paciente,
// atendimentos, agenda, anamnese e arquivos DO PET. Financeiro NÃO
// é duplicado — só o link "Responsável financeiro: tutor".
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, ListSkeleton, Notice, Tabs } from '@/components/ui';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import { EncounterList, type EncounterRow } from '@/components/dashboard/EncounterSheet';
import { apiGet } from '@/lib/api-client';
import { PET_SPECIES_LABELS, petAge, petLabel } from '@/lib/pets';
import { formatDateBR } from '@/lib/tz';
import type { AnamneseResponse, AnamneseTemplate, Booking, Pet } from '@/lib/types';

type PetTab = 'resumo' | 'encounters' | 'agenda' | 'anamnese' | 'files' | 'notes';

export function Pet360Sheet({ open, onClose, businessId, pet, tutorName, tutorPhone, onOpenEncounter }: {
  open: boolean;
  onClose: () => void;
  businessId: string;
  pet: Pet | null;
  tutorName: string;
  tutorPhone?: string;
  /** Abre o atendimento completo (mesmo caminho do Paciente 360). */
  onOpenEncounter?: (row: EncounterRow) => void;
}) {
  const [tab, setTab] = useState<PetTab>('resumo');
  const [encounters, setEncounters] = useState<EncounterRow[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [responses, setResponses] = useState<AnamneseResponse[]>([]);
  const [templates, setTemplates] = useState<AnamneseTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !pet?.id) return;
    let on = true;
    setLoaded(false); setError(''); setEncounters([]); setBookings([]); setResponses([]);
    setTab('resumo');
    (async () => {
      const [enc, bk, an] = await Promise.all([
        apiGet<{ encounters?: EncounterRow[] }>(
          `/api/encounters?businessId=${encodeURIComponent(businessId)}&contactId=${encodeURIComponent(pet.tutorId)}`,
          { scope: 'area', area: 'Atendimento' },
        ).catch(() => ({ ok: false as const, message: '' })),
        apiGet<{ bookings?: Booking[] }>(
          `/api/bookings?businessId=${encodeURIComponent(businessId)}&mode=manage&from=2000-01-01&to=2100-01-01&limit=500`,
          { scope: 'area', area: 'Agenda' },
        ).catch(() => ({ ok: false as const, message: '' })),
        apiGet<{ templates?: AnamneseTemplate[]; responses?: AnamneseResponse[] }>(
          `/api/anamnese?businessId=${encodeURIComponent(businessId)}&responsesFor=${encodeURIComponent(pet.tutorId)}`,
          { scope: 'area', area: 'Atendimento' },
        ).catch(() => ({ ok: false as const, message: '' })),
      ]);
      if (!on) return;
      if (!enc.ok && !bk.ok && !an.ok) setError('Não foi possível carregar a ficha do pet.');
      // Só dados DESTSE pet (petId); tutor sem petId no registro fica de fora
      // dos atendimentos clínicos específicos — mas bookings com petId filtram.
      setEncounters((enc.ok ? (enc.data?.encounters || []) : []).filter((e) => e.petId === pet.id));
      setBookings((bk.ok ? (bk.data?.bookings || []) : []).filter((b) => b.petId === pet.id));
      setTemplates(an.ok ? (an.data?.templates || []) : []);
      setResponses((an.ok ? (an.data?.responses || []) : []).filter((r) => !r.petId || r.petId === pet.id));
      setLoaded(true);
    })();
    return () => { on = false; };
  }, [open, pet?.id, pet?.tutorId, businessId]);

  const age = pet ? petAge(pet.birthDate) : null;
  const files = useMemo(
    () => encounters.flatMap((e) => (e.files || []).map((f) => ({ ...f, encounterDate: e.date, encounterId: e.id }))),
    [encounters],
  );
  const lastResponse = responses[0] || null;
  const templateName = (id: string) => templates.find((t) => t.id === id)?.name || 'Ficha';

  if (!open || !pet) return null;

  const tabs = [
    { id: 'resumo' as const, label: 'Resumo', icon: 'userCircle' },
    { id: 'encounters' as const, label: 'Atendimentos', icon: 'fileText', count: encounters.length },
    { id: 'agenda' as const, label: 'Agenda', icon: 'calendar', count: bookings.filter((b) => b.status === 'pending' || b.status === 'confirmed').length },
    { id: 'anamnese' as const, label: 'Anamnese', icon: 'fileText', count: responses.length },
    { id: 'files' as const, label: 'Arquivos', icon: 'upload', count: files.length },
    { id: 'notes' as const, label: 'Observações', icon: 'fileText' },
  ];

  return (
    <WorkspaceSheet
      open={open}
      onClose={onClose}
      title={pet.name}
      subtitle={`Pet 360 — ${petLabel(pet)}`}
      icon="handHeart"
      width="max-w-[640px]"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
      }
    >
      <div className="p-4 space-y-4" data-pet360="true">
        {/* Cabeçalho do paciente */}
        <div className="flex items-center gap-3.5">
          <Avatar name={pet.name} src={pet.photo || undefined} size={56} />
          <div className="min-w-0">
            <p className="text-base font-extrabold text-[var(--text)]">{pet.name}</p>
            <p className="text-xs text-[var(--text-muted)]">
              {petLabel(pet)}{age !== null ? ` · ${age} ano(s)` : ''}{pet.weightKg ? ` · ${pet.weightKg} kg` : ''}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Tutor: <strong className="text-[var(--text)]">{tutorName || '—'}</strong>
              {tutorPhone ? ` · ${tutorPhone}` : ''}
            </p>
          </div>
          {pet.sex && <Badge tone="zinc">{pet.sex === 'M' ? 'Macho' : 'Fêmea'}</Badge>}
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <Tabs items={tabs} value={tab} onChange={setTab} ariaLabel="Seções da ficha do pet" size="sm" />

        {!loaded ? <ListSkeleton rows={4} /> : (
          <div className="ws-panel">
            {tab === 'resumo' && (
              <div className="p-4 space-y-3">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Espécie</dt><dd>{PET_SPECIES_LABELS[pet.species] || pet.species || '—'}</dd></div>
                  <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Raça</dt><dd>{pet.breed || '—'}</dd></div>
                  <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Nascimento</dt><dd>{pet.birthDate ? formatDateBR(pet.birthDate) : '—'}</dd></div>
                  <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Peso</dt><dd>{pet.weightKg ? `${pet.weightKg} kg` : '—'}</dd></div>
                  <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Sexo</dt><dd>{pet.sex === 'M' ? 'Macho' : pet.sex === 'F' ? 'Fêmea' : '—'}</dd></div>
                  <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Idade</dt><dd>{age !== null ? `${age} ano(s)` : '—'}</dd></div>
                </dl>
                {pet.notes && (
                  <div>
                    <p className="text-xs font-semibold text-[var(--text-muted)]">Observações permanentes</p>
                    <p className="text-sm text-[var(--text)] mt-1 whitespace-pre-wrap">{pet.notes}</p>
                  </div>
                )}
                {/* Financeiro é do TUTOR — sem duplicar no pet. */}
                <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
                  <p className="text-xs text-[var(--text-muted)]">
                    Responsável financeiro:{' '}
                    <Link className="font-semibold text-[var(--brand-fg)] hover:underline"
                      href={`/clientes?b=${businessId}&q=${encodeURIComponent(tutorPhone || tutorName)}`}>
                      {tutorName || 'tutor'}
                    </Link>
                    <span className="block mt-0.5 text-[11px]">Abra o tutor para ver cobranças e cadastro.</span>
                  </p>
                </div>
              </div>
            )}

            {tab === 'encounters' && (
              <div className="p-4">
                <p className="text-xs font-semibold text-[var(--text-muted)] mb-2">Histórico clínico de {pet.name}</p>
                {encounters.length === 0
                  ? <p className="text-sm text-[var(--text-muted)]">Nenhum atendimento registrado para este pet.</p>
                  : onOpenEncounter
                    ? <EncounterList rows={encounters} onOpen={onOpenEncounter} empty="" />
                    : <ul className="space-y-2">{encounters.map((e) => (
                      <li key={e.id} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                        <span className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">{formatDateBR(e.date)}{e.time ? ` · ${e.time}` : ''}</span>
                        <span className="block text-sm text-[var(--text)]">{e.evolution || e.complaint || e.serviceName}</span>
                      </li>
                    ))}</ul>}
              </div>
            )}

            {tab === 'agenda' && (
              <div className="p-4">
                <p className="text-xs font-semibold text-[var(--text-muted)] mb-2">Consultas de {pet.name}</p>
                {bookings.length === 0
                  ? <p className="text-sm text-[var(--text-muted)]">Nenhum agendamento com este pet.</p>
                  : (
                    <ul className="divide-y divide-[var(--border-soft)]">
                      {[...bookings].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)).slice(0, 30).map((b) => (
                        <li key={b.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0">
                            <span className="block font-semibold tabular-nums">{formatDateBR(b.date)} · {b.time}</span>
                            <span className="block text-xs text-[var(--text-muted)] truncate">{b.customerName}{b.status === 'completed' ? ' · concluído' : b.status === 'cancelled' ? ' · cancelado' : ''}</span>
                          </span>
                          <Link className="text-xs font-semibold text-[var(--brand-fg)] hover:underline shrink-0"
                            href={`/agenda?b=${businessId}&data=${b.date}`}>Abrir</Link>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            )}

            {tab === 'anamnese' && (
              <div className="p-4 space-y-3">
                <p className="text-xs font-semibold text-[var(--text-muted)]">Fichas respondidas de {pet.name}</p>
                {lastResponse && (
                  <p className="text-xs text-[var(--text-muted)]">
                    Última ficha: {formatDateBR((lastResponse.createdAt || '').slice(0, 10))} · {templateName(lastResponse.templateId)}
                  </p>
                )}
                {responses.length === 0
                  ? <p className="text-sm text-[var(--text-muted)]">Nenhuma anamnese respondida para este pet.</p>
                  : (
                    <ul className="space-y-2">
                      {responses.map((r) => (
                        <li key={r.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                          <p className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
                            {formatDateBR((r.createdAt || '').slice(0, 10))} · {templateName(r.templateId)}
                          </p>
                          <dl className="mt-1 space-y-0.5">
                            {Object.entries(r.answers || {}).slice(0, 6).map(([k, v]) => (
                              <div key={k} className="text-xs"><span className="text-[var(--text-muted)]">{k}: </span>{String(v ?? '—')}</div>
                            ))}
                          </dl>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            )}

            {tab === 'files' && (
              <div className="p-4">
                <p className="text-xs font-semibold text-[var(--text-muted)] mb-2">Exames, laudos e imagens de {pet.name}</p>
                {files.length === 0
                  ? <p className="text-sm text-[var(--text-muted)]">Nenhum arquivo vinculado a este pet.</p>
                  : (
                    <ul className="space-y-1.5">
                      {files.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 text-sm">
                          <Icon n="fileText" size={14} className="text-[var(--text-muted)]" />
                          <a href={f.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-[var(--brand-fg)] hover:underline">{f.name}</a>
                          <span className="text-xs text-[var(--text-muted)] tabular-nums">{formatDateBR(f.encounterDate)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            )}

            {tab === 'notes' && (
              <div className="p-4 space-y-2">
                <p className="text-xs font-semibold text-[var(--text-muted)]">Observações do cadastro do pet</p>
                <p className="text-sm text-[var(--text)] whitespace-pre-wrap">{pet.notes || 'Sem observações.'}</p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Histórico administrativo completo (incluindo financeiro do tutor) vive na ficha do{' '}
                  <Link className="underline font-semibold" href={`/clientes?b=${businessId}&q=${encodeURIComponent(tutorPhone || tutorName)}`}>tutor</Link>.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </WorkspaceSheet>
  );
}
