'use client';
// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · P1 — PET 360 (ficha do animal)
// ═══════════════════════════════════════════════════════════════
// Ao clicar no pet (Greg) na agenda/detalhe: resumo do paciente,
// atendimentos, agenda, anamnese e arquivos DO PET. Financeiro NÃO
// é duplicado — só o link "Responsável financeiro: tutor".
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { Avatar, Button, DetailSideModal, ListSkeleton, Notice, OverflowTabs, useOverlayPresence, useFrozenWhileClosed } from '@/components/ui';
import { EncounterList, type EncounterRow } from '@/components/dashboard/EncounterSheet';
import { PetAllergyChips } from '@/components/dashboard/PetAllergies';
import { apiGet } from '@/lib/api-client';
import { PET_SPECIES_LABELS, petAge } from '@/lib/pets';
import { formatDateBR } from '@/lib/tz';
import { followUpDueDate } from '@/lib/encounters';
import { encounterHref } from '@/lib/encounter-workspace';
import type { AnamneseResponse, AnamneseTemplate, Booking, Pet } from '@/lib/types';

type PetTab = 'resumo' | 'encounters' | 'agenda' | 'anamnese' | 'files' | 'notes';

export function responseHistoryRows(response: AnamneseResponse, templates: AnamneseTemplate[]) {
  const template = templates.find((candidate) => candidate.id === response.templateId);
  if (template) return template.fields.filter((field) => field.type !== 'note').map((field) => ({
    id: field.id, label: field.label, type: field.type, value: response.answers?.[field.id],
  }));
  return Object.entries(response.answers || {}).map(([id, value]) => ({ id, label: id, type: '', value }));
}

type Pet360SheetProps = { open?: boolean; onExited?: () => void } & Omit<Parameters<typeof Pet360SheetSurface>[0], 'open' | 'onExited' | 'onOpenEncounter'>;
/**
 * Pet 360 — contrato público de PRESENÇA: `open` controlado pelo pai. A ficha
 * sai animada antes de desmontar (ver useOverlayPresence). `onExited` roda depois da saída
 * (ex.: abrir o atendimento só depois que o Pet 360 saiu da tela).
 */
export function Pet360Sheet({ open = true, onExited, ...rest }: Pet360SheetProps) {
  const router = useRouter();
  // CONTRATO ÚNICO do histórico, igual em TODAS as origens (Cliente 360, Agenda → detalhe, …):
  // clicar num atendimento fecha a Pet 360, espera a saída completa e só então abre o registro.
  // Quem chama não decide nada disso — antes, o detalhe da Agenda não passava o callback e o
  // histórico ficava sem ação. O destino fica em ref para o `onExited` ler sempre o valor atual.
  const pendingRef = useRef<{ id: string; returnTo: string } | null>(null);
  const { mounted, session, handleExited } = useOverlayPresence(open, () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) router.push(encounterHref(pending.id, rest.businessId, pending.returnTo));
    onExited?.();
  });
  const frozen = useFrozenWhileClosed(open, rest);
  if (!mounted) return null;
  const openFromHistory = (row: EncounterRow) => {
    pendingRef.current = { id: row.id, returnTo: `${window.location.pathname}${window.location.search}` };
    rest.onClose();
  };
  return <Pet360SheetSurface key={session} {...frozen} open={open} onExited={handleExited} onOpenEncounter={openFromHistory} />;
}

function Pet360SheetSurface({ open, onClose, businessId, pet: petProp, tutorName, tutorPhone, onOpenEncounter, onExited }: {
  open: boolean;
  onExited?: () => void;
  onClose: () => void;
  businessId: string;
  /**
   * Ponto de partida (id + tutor + nome). A FICHA sempre usa o cadastro
   * canônico do pet, carregado por id via /api/pets: quem chama (ex.: o
   * detalhe do agendamento) não duplica espécie, raça, sexo e nascimento.
   */
  pet: Pet | null;
  tutorName: string;
  tutorPhone?: string;
  /** Abre o atendimento completo (contrato único: ver Pet360Sheet). */
  onOpenEncounter: (row: EncounterRow) => void;
}) {
  const [tab, setTab] = useState<PetTab>('resumo');
  const [encounters, setEncounters] = useState<EncounterRow[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [responses, setResponses] = useState<AnamneseResponse[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [templates, setTemplates] = useState<AnamneseTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [canonicalPet, setCanonicalPet] = useState<Pet | null>(null);
  // Cadastro canônico do pet (fonte única): o que vale é o registro do pet,
  // nunca o stub do chamador.
  const pet = canonicalPet && petProp && canonicalPet.id === petProp.id ? canonicalPet : petProp;

  const router = useRouter();
  useEffect(() => {
    if (!open || !petProp?.id) return;
    let on = true;
    setCanonicalPet(null);
    const tutorQuery = petProp.tutorId ? `&tutorId=${encodeURIComponent(petProp.tutorId)}` : '';
    apiGet<{ pets?: Pet[] }>(
      `/api/pets?businessId=${encodeURIComponent(businessId)}${tutorQuery}`,
      { scope: 'area', area: 'Atendimento' },
    ).then((r) => {
      if (!on || !r.ok) return;
      const found = (r.data?.pets || []).find((candidate) => candidate.id === petProp.id);
      if (found) setCanonicalPet(found);
    }).catch(() => { /* mantém o ponto de partida; a ficha mostra o que existe */ });
    return () => { on = false; };
  }, [open, petProp?.id, petProp?.tutorId, businessId]);

  useEffect(() => {
    if (!open || !pet?.id) return;
    let on = true;
    setLoaded(false); setError(''); setEncounters([]); setBookings([]); setResponses([]);
    setTab('resumo');
    (async () => {
      const [enc, bk, an] = await Promise.all([
        // ETAPA 2: o histórico é do PACIENTE — filtrado no servidor por petId
        // (nunca pelo tutor, que pode ter outros pets).
        apiGet<{ encounters?: EncounterRow[] }>(
          `/api/encounters?businessId=${encodeURIComponent(businessId)}&petId=${encodeURIComponent(pet.id)}`,
          { scope: 'area', area: 'Atendimento' },
        ).catch(() => ({ ok: false as const, message: '' })),
        // CLINICAL ACCESS: a aba Agenda do Pet 360 mostra os agendamentos DO
        // PACIENTE na unidade (contexto clínico), nunca a agenda de outro
        // profissional. A leitura é `mode=patient`, escopada pelo pet.
        apiGet<{ bookings?: Booking[] }>(
          `/api/bookings?businessId=${encodeURIComponent(businessId)}&mode=patient&petId=${encodeURIComponent(pet.id)}`,
          { scope: 'area', area: 'Atendimento' },
        ).catch(() => ({ ok: false as const, message: '' })),
        apiGet<{ templates?: AnamneseTemplate[]; responses?: AnamneseResponse[] }>(
          `/api/anamnese?businessId=${encodeURIComponent(businessId)}&responsesFor=${encodeURIComponent(pet.tutorId)}&petId=${encodeURIComponent(pet.id)}`,
          { scope: 'area', area: 'Atendimento' },
        ).catch(() => ({ ok: false as const, message: '' })),
      ]);
      if (!on) return;
      if (!enc.ok && !bk.ok && !an.ok) setError('Não foi possível carregar a ficha do pet.');
      // Só dados DESTSE pet: o servidor já filtra por petId; o cliente confere de novo.
      setEncounters((enc.ok ? (enc.data?.encounters || []) : []).filter((e) => e.petId === pet.id));
      setBookings(bk.ok ? (bk.data?.bookings || []) : []);
      setTemplates(an.ok ? (an.data?.templates || []) : []);
      setResponses((an.ok ? (an.data?.responses || []) : []).filter((r) => r.petId === pet.id));
      setLoaded(true);
    })();
    return () => { on = false; };
  }, [open, pet?.id, pet?.tutorId, businessId]);

  const age = pet ? petAge(pet.birthDate) : null;
  // F3-H · Pet 360: retorno previsto DO PET (não do tutor como "paciente")
  const upcomingReturn = useMemo(() => {
    const rows = encounters
      .filter((e) => e.status === 'finalized' && (e.followUpMode === 'date' || e.followUpMode === 'interval'))
      .map((e) => ({ e, due: followUpDueDate(e) }))
      .filter((r) => r.due)
      .sort((a, b) => (a.due < b.due ? 1 : -1));
    return rows[0] || null;
  }, [encounters]);
  const files = useMemo(
    () => encounters.flatMap((e) => (e.files || []).map((f) => ({ ...f, encounterDate: e.date, encounterId: e.id }))),
    [encounters],
  );
  const lastResponse = responses[0] || null;
  const templateName = (id: string) => templates.find((t) => t.id === id)?.name || 'Ficha';

  // Presença: NÃO desmontar com `open=false`. A saída animada pertence ao
  // DetailSideModal (que avisa `onExited` ao terminar); se esta superfície
  // retornasse null aqui, a ficha sumia sem animação, `onExited` nunca rodava
  // e o atendimento escolhido na aba Atendimentos nunca abria.
  if (!pet) return null;

  // Identidade (uma só): o título já é o nome do pet; o subtítulo traz só
  // espécie e raça ("Roedor (Ratazana)"). Nome não se repete no corpo.
  const speciesLabel = PET_SPECIES_LABELS[pet.species] || pet.species || '';
  const breedLabel = (pet.breed || '').trim();
  const speciesBreed = speciesLabel && breedLabel ? `${speciesLabel} (${breedLabel})` : (speciesLabel || breedLabel);
  const sexLabel = pet.sex === 'M' ? 'Macho' : pet.sex === 'F' ? 'Fêmea' : '';

  const tabs = [
    { id: 'resumo' as const, label: 'Resumo', icon: 'userCircle' },
    { id: 'encounters' as const, label: 'Atendimentos', icon: 'fileText', count: encounters.length },
    { id: 'agenda' as const, label: 'Agenda', icon: 'calendar', count: bookings.filter((b) => b.status === 'pending' || b.status === 'confirmed').length },
    { id: 'anamnese' as const, label: 'Anamnese', icon: 'fileText', count: responses.length },
    { id: 'files' as const, label: 'Arquivos', icon: 'upload', count: files.length },
    { id: 'notes' as const, label: 'Observações', icon: 'fileText' },
  ];

  // P0 · RODADA 2 — Pet 360 é DETALHE: entra no side modal canônico (preso à
  // direita, altura cheia) em vez da gaveta flutuante. O conteúdo já recua
  // sozinho (`p-4`), então o corpo do painel não soma recuo.
  return (
    <DetailSideModal
      open={open}
      onExited={onExited}
      onClose={onClose}
      title={pet.name}
      subtitle={speciesBreed ? `Pet 360 · ${speciesBreed}` : 'Pet 360'}
      icon="paw"
      width="640px"
      flush
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={() => router.push(`/pets/${encodeURIComponent(pet.id)}?b=${encodeURIComponent(businessId)}`)}
            data-pet360-full-page>
            Abrir ficha completa
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
        </div>
      }
    >
      <div className="p-4 space-y-4" data-pet360="true">
        {/* Bloco de identidade: o nome é o título do painel (não se repete aqui).
            Chips com idade, peso e sexo; o tutor como contexto discreto. */}
        <div className="flex items-center gap-3.5 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3.5">
          <Avatar name={pet.name} src={pet.photo || undefined} size={64} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1">
              {[
                age !== null ? `${age} ano(s)` : '',
                pet.weightKg ? `${pet.weightKg} kg` : '',
                sexLabel,
              ].filter(Boolean).map((chip) => (
                <span key={chip} className="inline-flex items-center rounded-pill border border-[var(--border)] bg-[var(--surface-3)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
                  {chip}
                </span>
              ))}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1.5">
              Tutor: <strong className="text-[var(--text)]">{tutorName || '—'}</strong>
              {tutorPhone ? ` · ${tutorPhone}` : ''}
            </p>
            {upcomingReturn && (
              <p className="text-xs text-[var(--text)] mt-1" data-pet360-return="true">
                Retorno previsto: {formatDateBR(upcomingReturn.due)}
              </p>
            )}
            <PetAllergyChips pet={pet} max={3} className="mt-2" />
          </div>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {/* Canônico: as que cabem ficam visíveis; o excedente vai para 'Mais N' (sem rolagem escondida). */}
        <OverflowTabs items={tabs} value={tab} onChange={setTab} ariaLabel="Seções da ficha do pet" className="pet360-tabs" variant="line" />

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
                  : <EncounterList rows={encounters} onOpen={onOpenEncounter} empty="" />}
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
                            href={`/agenda?b=${businessId}&view=day&data=${b.date}&booking=${encodeURIComponent(b.id)}`}>Abrir</Link>
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
                  <p className="text-xs text-[var(--text-muted)] tabular-nums">
                    Última ficha: {formatDateBR((lastResponse.createdAt || '').slice(0, 10))} · {templateName(lastResponse.templateId)}
                    {' '}·{' '}
                    <Button type="button" variant="secondary" size="sm" className="ml-1"
                      onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen} aria-controls="pet360-anamnese-history">
                      <Icon n={historyOpen ? 'chevU' : 'history'} size={13} />
                      {historyOpen ? 'Ocultar histórico' : 'Ver histórico'}
                    </Button>
                  </p>
                )}
                {responses.length === 0
                  ? <p className="text-sm text-[var(--text-muted)]">Nenhuma anamnese respondida para este pet.</p>
                  : (
                    <ul id="pet360-anamnese-history" className="space-y-2">
                      {(historyOpen ? responses : responses.slice(0, 1)).map((r) => (
                        <li key={r.id} className="rounded-md border border-[var(--border)] px-3 py-2" data-testid={historyOpen ? 'pet360-history-item' : undefined}>
                          <p className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">
                            {formatDateBR((r.createdAt || '').slice(0, 10))} · {templateName(r.templateId)}
                          </p>
                          <dl className="mt-1 space-y-0.5">
                            {responseHistoryRows(r, templates).slice(0, historyOpen ? 40 : 6).map(({ id, label, type, value }) => (
                              <div key={id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 text-xs">
                                <dt className="text-[var(--text-muted)]">{label}</dt>
                                <dd className="text-[var(--text)] break-words">{type === 'boolean' ? (value === null || value === undefined ? 'Não informado' : value ? 'Sim' : 'Não') : Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd>
                              </div>
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
                <p className="text-xs font-semibold text-[var(--text-muted)] mb-1">Exames, laudos e imagens de {pet.name}</p>
                <p className="text-[11px] text-[var(--text-muted)] mb-2">Exames, laudos, receitas, imagens ou documentos em PDF.</p>
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
    </DetailSideModal>
  );
}
