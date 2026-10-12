'use client';
// ═══════════════════════════════════════════════════════════════
// ETAPA 2 · PET 360 — PÁGINA COMPLETA DO PACIENTE
// ═══════════════════════════════════════════════════════════════
// A ficha clínica do animal (identidade, alergias, atendimentos, agenda,
// anamnese, documentos, peso e alergias). Mesmos dados e mesmas APIs do painel
// rápido da agenda — sem prontuário paralelo. O tutor continua responsável
// administrativo e financeiro: a página só o referencia.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, IconButton, ListSkeleton, Notice, OverflowTabs, PageBackAction, Skeleton } from '@/components/ui';
import { EncounterList, type EncounterRow } from '@/components/dashboard/EncounterSheet';
import { PetEditSheet } from '@/components/dashboard/PetEditSheet';
import { PetAllergyChips, PetAllergyManager } from '@/components/dashboard/PetAllergies';
import { responseHistoryRows } from '@/components/dashboard/Pet360Sheet';
import { AreaLoadError } from '@/components/dashboard/AccessNotice';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { apiGet } from '@/lib/api-client';
import { PET_SPECIES_LABELS, activePetAllergies, petAge, petAgeLabel, petWeightHistory } from '@/lib/pets';
import { formatDateBR, todayISO } from '@/lib/tz';
import { followUpDueDate } from '@/lib/encounters';
import { encounterHref } from '@/lib/encounter-workspace';
import type { AnamneseResponse, AnamneseTemplate, Booking, Pet } from '@/lib/types';

type Tab = 'resumo' | 'atendimentos' | 'agenda' | 'anamnese' | 'arquivos' | 'peso' | 'alergias';
type TutorInfo = { contactId: string; name: string } | null;

export default function PetPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { businessId, resolving, noBusiness } = useBusinessId();
  const petId = decodeURIComponent(params?.id || '');
  const { permissions, ready: permsReady } = usePanelPermissions();
  const canClinical = permsReady && permissions.atendimento === true;
  const canCadastro = permsReady && (permissions.clientes === true || permissions.atendimento === true);

  const [pet, setPet] = useState<Pet | null>(null);
  const [vet, setVet] = useState(true);
  const [tutor, setTutor] = useState<TutorInfo>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loadFailed, setLoadFailed] = useState('');
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<Tab>('resumo');
  const [editing, setEditing] = useState<Partial<Pet> | null>(null);
  const [flash, setFlash] = useState('');

  // Seções clínicas: cada uma com o próprio escopo. Negada → aviso na aba, não erro da página.
  const [encounters, setEncounters] = useState<EncounterRow[]>([]);
  const [encountersDenied, setEncountersDenied] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [templates, setTemplates] = useState<AnamneseTemplate[]>([]);
  const [responses, setResponses] = useState<AnamneseResponse[]>([]);
  const [anamneseDenied, setAnamneseDenied] = useState(false);
  const [sectionsLoaded, setSectionsLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!businessId || !petId) return;
    setLoaded(false); setMissing(false); setLoadFailed('');
    const res = await apiGet<{ vet?: boolean; pet?: Pet; tutor?: { id: string; name: string } }>(
      `/api/pets?businessId=${encodeURIComponent(businessId)}&petId=${encodeURIComponent(petId)}`,
      { scope: 'area', area: 'Clientes' },
    );
    if (!res.ok) {
      if (res.status === 404) setMissing(true);
      else setLoadFailed(res.message || 'Não foi possível carregar o pet.');
      setLoaded(true);
      return;
    }
    const found = res.data?.pet || null;
    if (!found) { setMissing(true); setLoaded(true); return; }
    setVet(res.data?.vet !== false);
    setPet(found);
    // Tutor: só o nome de referência vem da API de pets (mesmo escopo). Cadastro e financeiro ficam no contato.
    setTutor({ contactId: found.tutorId, name: res.data?.tutor?.name || '' });
    setLoaded(true);
  }, [businessId, petId]);

  useEffect(() => { void load(); }, [load, retry]);

  // Atendimentos, agenda e anamnese: SÓ pelo petId (nunca pelo tutor — um tutor com
  // dois pets não mistura o histórico de um no do outro).
  useEffect(() => {
    if (!businessId || !pet?.id) return;
    let on = true;
    setSectionsLoaded(false);
    (async () => {
      const [enc, bk, an] = await Promise.all([
        apiGet<{ encounters?: EncounterRow[] }>(
          `/api/encounters?businessId=${encodeURIComponent(businessId)}&petId=${encodeURIComponent(pet.id)}`,
          { scope: 'area', area: 'Atendimento' },
        ),
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
      setEncountersDenied(!enc.ok);
      setEncounters(enc.ok ? ((enc.data?.encounters || []) as EncounterRow[]).filter((e) => e.petId === pet.id) : []);
      setBookings(bk.ok ? (bk.data?.bookings || []) : []);
      setAnamneseDenied(!an.ok);
      setTemplates(an.ok ? (an.data?.templates || []) : []);
      setResponses(an.ok ? (an.data?.responses || []).filter((r) => r.petId === pet.id) : []);
      setSectionsLoaded(true);
    })();
    return () => { on = false; };
  }, [businessId, pet?.id, pet?.tutorId]);

  const age = pet ? petAge(pet.birthDate) : null;
  const active = pet ? activePetAllergies(pet) : [];
  const weights = useMemo(() => (pet ? petWeightHistory(encounters, pet.id) : []), [encounters, pet]);
  const lastWeight = weights[weights.length - 1] || null;
  const upcomingReturn = useMemo(() => encounters
    .filter((e) => e.status === 'finalized' && (e.followUpMode === 'date' || e.followUpMode === 'interval'))
    .map((e) => ({ e, due: followUpDueDate(e) }))
    .filter((r) => r.due)
    .sort((a, b) => (a.due < b.due ? 1 : -1))[0] || null, [encounters]);
  const files = useMemo(() => encounters.flatMap((e) => (e.files || []).map((f) => ({ ...f, encounterDate: e.date, encounterId: e.id }))), [encounters]);
  const today = todayISO(new Date());
  const nextBookings = useMemo(() => bookings
    .filter((b) => (b.status === 'pending' || b.status === 'confirmed') && b.date >= today)
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1))
    .slice(0, 3), [bookings, today]);
  const templateName = (id: string) => templates.find((t) => t.id === id)?.name || 'Ficha';

  if (resolving || (!loaded && !loadFailed)) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <div className="ws-panel p-4 space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-40 w-full" /></div>
      </div>
    );
  }
  if (noBusiness) {
    return <div className="ws-panel p-6"><p className="text-[13px] text-[var(--text-muted)]">Sua conta ainda não tem uma unidade ativa.</p></div>;
  }

  const tutorHref = `/clientes/contact:${encodeURIComponent(pet?.tutorId || '')}?b=${encodeURIComponent(businessId)}`;
  const backLink = <PageBackAction href={tutorHref} label={tutor?.name ? `Voltar para ${tutor.name}` : 'Voltar para o tutor'} />;

  if (loadFailed || missing || !pet) {
    return (
      <div className="space-y-3">
        <PageBackAction href={search.get('b') ? `/agenda?b=${encodeURIComponent(businessId)}` : '/agenda'} label="Voltar" />
        {missing
          ? <Notice tone="info">Este pet não está nesta unidade ou não está disponível para o seu acesso.</Notice>
          : <AreaLoadError area="Clientes" message={loadFailed} onRetry={() => setRetry((n) => n + 1)} />}
      </div>
    );
  }

  const speciesLabel = PET_SPECIES_LABELS[pet.species] || pet.species || '';
  const sexLabel = pet.sex === 'M' ? 'Macho' : pet.sex === 'F' ? 'Fêmea' : '';
  const ageLabel = petAgeLabel(pet.birthDate);
  const identityChips = [speciesLabel, pet.breed, sexLabel, ageLabel].filter(Boolean);

  const tabs = [
    { id: 'resumo' as const, label: 'Resumo', icon: 'userCircle' },
    { id: 'atendimentos' as const, label: 'Atendimentos', icon: 'fileText', count: encounters.length },
    { id: 'agenda' as const, label: 'Agenda', icon: 'calendar', count: nextBookings.length + bookings.filter((b) => b.status === 'completed').length },
    { id: 'anamnese' as const, label: 'Anamnese', icon: 'fileText', count: responses.length },
    { id: 'arquivos' as const, label: 'Documentos', icon: 'upload', count: files.length },
    { id: 'peso' as const, label: 'Peso', icon: 'chart', count: weights.length },
    { id: 'alergias' as const, label: 'Alergias', icon: 'alert', count: active.length },
  ];

  const openEncounter = (row: EncounterRow) => {
    router.push(encounterHref(row.id, businessId, `${window.location.pathname}${window.location.search}`));
  };

  return (
    <div className="space-y-4" data-pet-page={pet.id}>
      {backLink}

      {flash && <Notice tone="success">{flash}</Notice>}
      {!vet && <Notice tone="info">Este negócio não é clínica veterinária: a ficha de pacientes fica disponível, mas o fluxo clínico não é o padrão.</Notice>}

      {/* IDENTIDADE CLÍNICA — cabeçalho do paciente */}
      <section className="ws-panel p-4 md:p-5" aria-labelledby="pet-identidade">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <Avatar name={pet.name} src={pet.photo || undefined} size={72} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--text-soft)]">Paciente</p>
              <h1 id="pet-identidade" className="mt-0.5 break-words text-[24px] font-semibold leading-tight text-[var(--text-strong)]">
                {pet.name}
                {!pet.active && <span className="ml-2 align-middle text-[12px] font-semibold text-[var(--text-muted)]">(inativo)</span>}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {identityChips.length === 0
                  ? <span className="text-sm text-[var(--text-muted)]">Sem detalhes cadastrados</span>
                  : identityChips.map((chip) => (
                    <span key={chip} className="inline-flex items-center rounded-pill border border-[var(--border)] bg-[var(--surface-3)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--text-muted)]">{chip}</span>
                  ))}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Peso medido</dt>
                  <dd className="tabular-nums" data-last-weight>{lastWeight ? `${lastWeight.weightKg} kg` : '—'}{lastWeight && <span className="ml-1 text-[11px] text-[var(--text-muted)]">em {formatDateBR(lastWeight.date)}</span>}</dd></div>
                <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Peso de cadastro</dt>
                  <dd className="tabular-nums">{pet.weightKg ? `${pet.weightKg} kg` : '—'}</dd></div>
                <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Nascimento</dt>
                  <dd className="tabular-nums">{pet.birthDate ? formatDateBR(pet.birthDate) : '—'}</dd></div>
              </dl>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canCadastro && (
              <Button variant="secondary" size="sm" onClick={() => setEditing(pet)} title={`Editar cadastro de ${pet.name}`}>
                <Icon n="pencil" size={14} /> Editar
              </Button>
            )}
          </div>
        </div>

        {/* RESPONSÁVEL — o tutor é o contato administrativo e financeiro */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm" data-pet-tutor>
          <p className="min-w-0 break-words">
            <span className="text-xs font-semibold text-[var(--text-muted)]">Tutor responsável</span>{' '}
            <span className="font-semibold text-[var(--text)]">{tutor?.name || 'Tutor'}</span>
          </p>
          <Link className="text-xs font-semibold text-[var(--brand-fg)] hover:underline" href={tutorHref}>
            Cadastro e financeiro do tutor
          </Link>
        </div>

        {/* ALERGIAS ATIVAS — visíveis em todas as abas */}
        {active.length > 0 && (
          <div className="mt-3 rounded-md border border-[var(--danger-border)] bg-[var(--danger-soft,var(--surface-2))] px-3 py-2.5" role="note" data-pet-alert="alergias">
            <p className="text-xs font-semibold text-[var(--text-strong)]">Alergias ativas ({active.length})</p>
            <div className="mt-1.5"><PetAllergyChips pet={pet} max={10} /></div>
          </div>
        )}
      </section>

      {/* wrap: as 7 seções ficam sempre visíveis (padrão do Cliente 360) — nada escondido em "Mais". */}
      <OverflowTabs items={tabs} value={tab} onChange={setTab} ariaLabel="Seções da ficha do paciente" variant="line" wrap />

      <div className="ws-panel" role="region" aria-label={`Conteúdo: ${tabs.find((t) => t.id === tab)?.label}`}>
        {!sectionsLoaded && tab !== 'alergias' ? <div className="p-4"><ListSkeleton rows={4} /></div> : null}

        {tab === 'resumo' && sectionsLoaded && (
          <div className="p-4 md:p-5 space-y-5">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Espécie</dt><dd>{speciesLabel || '—'}</dd></div>
              <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Raça</dt><dd>{pet.breed || '—'}</dd></div>
              <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Sexo</dt><dd>{sexLabel || '—'}</dd></div>
              <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Idade</dt><dd>{age !== null ? `${age} ano(s)` : (ageLabel || '—')}</dd></div>
              <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Próximo retorno</dt>
                <dd data-pet360-return={upcomingReturn ? 'true' : undefined}>{upcomingReturn ? formatDateBR(upcomingReturn.due) : '—'}</dd></div>
              <div><dt className="text-xs font-semibold text-[var(--text-muted)]">Último atendimento</dt>
                <dd>{encounters[0] ? formatDateBR(encounters[0].date) : '—'}</dd></div>
            </dl>

            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)]">Próximas consultas</p>
              {nextBookings.length === 0
                ? <p className="mt-1 text-sm text-[var(--text-muted)]">Nenhuma consulta agendada.</p>
                : (
                  <ul className="mt-1.5 divide-y divide-[var(--border-soft)]">
                    {nextBookings.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <span className="tabular-nums font-semibold">{formatDateBR(b.date)} · {b.time}</span>
                        <Link className="text-xs font-semibold text-[var(--brand-fg)] hover:underline"
                          href={`/agenda?b=${encodeURIComponent(businessId)}&view=day&data=${b.date}&booking=${encodeURIComponent(b.id)}`}>Abrir na agenda</Link>
                      </li>
                    ))}
                  </ul>
                )}
            </div>

            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)]">Observações permanentes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text)]">{pet.notes || 'Sem observações.'}</p>
            </div>
          </div>
        )}

        {tab === 'atendimentos' && sectionsLoaded && (
          <div className="p-4 md:p-5">
            <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Histórico clínico de {pet.name}</p>
            {encountersDenied
              ? <Notice tone="info">Seu acesso não inclui o atendimento clínico. O histórico é visto pela equipe de atendimento.</Notice>
              : encounters.length === 0
                ? <p className="text-sm text-[var(--text-muted)]">Nenhum atendimento registrado para este pet.</p>
                : <EncounterList rows={encounters} onOpen={openEncounter} empty="" />}
          </div>
        )}

        {tab === 'agenda' && sectionsLoaded && (
          <div className="p-4 md:p-5">
            <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">Consultas de {pet.name}</p>
            {bookings.length === 0
              ? <p className="text-sm text-[var(--text-muted)]">Nenhum agendamento com este pet.</p>
              : (
                <ul className="divide-y divide-[var(--border-soft)]">
                  {[...bookings].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)).slice(0, 50).map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block font-semibold tabular-nums">{formatDateBR(b.date)} · {b.time}</span>
                        <span className="block truncate text-xs text-[var(--text-muted)]">{b.customerName}{b.status === 'completed' ? ' · concluído' : b.status === 'cancelled' ? ' · cancelado' : ''}</span>
                      </span>
                      <Link className="shrink-0 text-xs font-semibold text-[var(--brand-fg)] hover:underline"
                        href={`/agenda?b=${encodeURIComponent(businessId)}&view=day&data=${b.date}&booking=${encodeURIComponent(b.id)}`}>Abrir</Link>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}

        {tab === 'anamnese' && sectionsLoaded && (
          <div className="p-4 md:p-5 space-y-3">
            <p className="text-xs font-semibold text-[var(--text-muted)]">Fichas respondidas de {pet.name}</p>
            {anamneseDenied
              ? <Notice tone="info">Seu acesso não inclui as fichas de anamnese.</Notice>
              : responses.length === 0
                ? <p className="text-sm text-[var(--text-muted)]">Nenhuma anamnese respondida para este pet.</p>
                : (
                  <ul className="space-y-2">
                    {responses.map((r) => (
                      <li key={r.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                        <p className="text-xs font-semibold text-[var(--text-muted)] tabular-nums">{formatDateBR((r.createdAt || '').slice(0, 10))} · {templateName(r.templateId)}</p>
                        <dl className="mt-1 space-y-0.5">
                          {responseHistoryRows(r, templates).slice(0, 40).map(({ id, label, type, value }) => (
                            <div key={id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 text-xs">
                              <dt className="text-[var(--text-muted)]">{label}</dt>
                              <dd className="break-words text-[var(--text)]">{type === 'boolean' ? (value === null || value === undefined ? 'Não informado' : value ? 'Sim' : 'Não') : Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
          </div>
        )}

        {tab === 'arquivos' && sectionsLoaded && (
          <div className="p-4 md:p-5">
            <p className="mb-1 text-xs font-semibold text-[var(--text-muted)]">Exames, laudos e imagens de {pet.name}</p>
            <p className="mb-2 text-[11px] text-[var(--text-muted)]">Anexados nos atendimentos deste paciente.</p>
            {encountersDenied
              ? <Notice tone="info">Seu acesso não inclui os documentos clínicos.</Notice>
              : files.length === 0
                ? <p className="text-sm text-[var(--text-muted)]">Nenhum arquivo vinculado a este pet.</p>
                : (
                  <ul className="space-y-1.5">
                    {files.map((f) => (
                      <li key={f.id} className="flex items-center gap-2 text-sm">
                        <Icon n="fileText" size={14} className="text-[var(--text-muted)]" />
                        <a href={f.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-[var(--brand-fg)] hover:underline">{f.name}</a>
                        <span className="text-xs tabular-nums text-[var(--text-muted)]">{formatDateBR(f.encounterDate)}</span>
                      </li>
                    ))}
                  </ul>
                )}
          </div>
        )}

        {tab === 'peso' && sectionsLoaded && (
          <div className="p-4 md:p-5 space-y-4">
            <p className="text-xs font-semibold text-[var(--text-muted)]">Peso medido nos atendimentos de {pet.name}</p>
            {weights.length === 0
              ? <p className="text-sm text-[var(--text-muted)]">Nenhum peso medido em atendimento ainda. O peso de cadastro ({pet.weightKg ? `${pet.weightKg} kg` : 'não informado'}) é referência e não entra aqui.</p>
              : (
                <>
                  <WeightSparkline points={weights.map((w) => w.weightKg)} label={`Evolução de peso de ${pet.name}`} />
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-[var(--text-muted)]">
                        <th className="py-1.5 font-semibold">Data</th><th className="py-1.5 font-semibold">Peso</th><th className="py-1.5 font-semibold">Variação</th><th className="py-1.5 font-semibold">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...weights].reverse().map((w, i, arr) => {
                        const prev = arr[i + 1];
                        const delta = prev ? Math.round((w.weightKg - prev.weightKg) * 100) / 100 : null;
                        return (
                          <tr key={w.encounterId} className="border-t border-[var(--border-soft)]">
                            <td className="py-2 tabular-nums">{formatDateBR(w.date)}</td>
                            <td className="py-2 tabular-nums font-semibold">{w.weightKg} kg</td>
                            <td className="py-2 tabular-nums text-[var(--text-muted)]">{delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta} kg`}</td>
                            <td className="py-2">
                              <button type="button" className="text-xs font-semibold text-[var(--brand-fg)] hover:underline" onClick={() => router.push(encounterHref(w.encounterId, businessId, `${window.location.pathname}${window.location.search}`))}>
                                {w.finalized ? 'Atendimento finalizado' : 'Em atendimento'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
          </div>
        )}

        {tab === 'alergias' && (
          <div className="p-4 md:p-5">
            <PetAllergyManager
              businessId={businessId}
              pet={pet}
              canWrite={canClinical}
              onChanged={(saved) => { setPet((prev) => ({ ...(prev || saved), ...saved })); setFlash('Alergias atualizadas.'); }}
            />
          </div>
        )}
      </div>

      <PetEditSheet
        businessId={businessId}
        tutorId={pet.tutorId}
        tutorName={tutor?.name || ''}
        pet={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setFlash('Cadastro do pet atualizado.'); void load(); }}
      />
    </div>
  );
}

/** Linha simples do peso medido (SVG, sem biblioteca de gráfico). */
function WeightSparkline({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null;
  const w = 320, h = 64, pad = 6;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => {
    const x = pad + (i * (w - pad * 2)) / (points.length - 1);
    const y = h - pad - ((p - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="h-16 w-full max-w-[420px] text-[var(--brand-fg)]">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={xy.join(' ')} />
      {xy.map((p, i) => { const [x, y] = p.split(','); return <circle key={i} cx={x} cy={y} r="2.5" fill="currentColor" />; })}
    </svg>
  );
}
