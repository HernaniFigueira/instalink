'use client';
// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 4 — FILA DE HOJE (balcão)
// ═══════════════════════════════════════════════════════════════
// O que o balcão precisa ver de relance: quem chegou, em que ordem, há quanto
// tempo espera, quem já foi chamado e quem está em atendimento. Cada linha tem
// UMA ação principal (a próxima da máquina de estados da fila) e as ações
// secundárias ficam no menu de contexto da própria linha — sem botão que não
// faz nada e sem enfeite.
//
// A fila NÃO cria agendamento: quando a pessoa chega sem horário, ela entra
// aqui. Quem quiser marcar um horário usa a agenda (é outro caminho).
//
// A3.4 (teste humano) — o que mudou aqui:
//   • IDENTIDADE: quem chega é buscado no CRM (nome OU WhatsApp, com debounce)
//     antes de criar qualquer coisa. Escolher um cadastro existente manda o
//     `contactId` para o servidor — nada de cadastro paralelo para a mesma
//     pessoa. Sem correspondência, o caminho continua sendo "+ Novo cliente /
//     visitante" (cadastro mínimo, sem exigir ficha completa).
//   • SERVIÇO × PROFISSIONAL: a lista de profissionais mostra SÓ quem atende o
//     serviço escolhido (quem atende é regra do servidor — aqui só não se
//     oferece o impossível). "Quem estiver livre" é sempre "quem estiver livre
//     DENTRO do serviço".
//   • ATENDIDOS HOJE: quem já foi atendido continua consultável (histórico do
//     dia, recolhido) — o profissional precisa reencontrar o que registrou.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { PhoneBRInput } from '@/components/dashboard/PhoneBRInput';
import { Avatar, Badge, Button, EmptyState, Field, IconButton, Input, Notice } from '@/components/ui';
import { apiSend } from '@/lib/api-client';
import { QUEUE_LONG_WAIT_MIN, QUEUE_STATUS, queuePosition, queueTransitionAllowed, waitLabel, waitMinutes } from '@/lib/queue';
import { nowHM } from '@/lib/tz';
import { cn } from '@/lib/utils';
import type { QueueEntry, QueueStatus } from '@/lib/types';

/**
 * Linha da fila como o servidor devolve: a entidade + os nomes resolvidos.
 * O tipo é a PRÓPRIA entidade (não uma cópia) para que as regras puras de
 * `lib/queue.ts` continuem valendo na tela — nada de dois formatos.
 */
export type QueueRow = QueueEntry & {
  serviceName: string;
  professionalName: string;
  statusLabel: string;
};

/** Cadastro do CRM como a busca devolve (só o que esta tela usa). */
type ContactHit = { id: string; name: string; phone: string; registered?: boolean };

const NEXT_ACTION: Record<string, { to: QueueStatus; label: string; variant: 'primary' | 'success' | 'secondary' }> = {
  waiting: { to: 'called', label: 'Chamar', variant: 'primary' },
  called: { to: 'in_service', label: 'Iniciar atendimento', variant: 'success' },
  in_service: { to: 'done', label: 'Concluir', variant: 'success' },
};

export function QueuePanel({ businessId, date, rows, done = [], loading, canWrite, canEncounter, canSearchContacts = true, timezone, onChanged, professionals, services, onOpenBooking, onEncounter, onOpenClient, onFitIn, onClose }: {
  businessId: string;
  /** Dia do negócio em exibição (a fila mostrada é sempre a de HOJE + a viva). */
  date: string;
  rows: QueueRow[];
  /**
   * A3.4 (teste humano) — ATENDIDOS HOJE. Chega separado da fila viva: é
   * histórico do dia, não fila. Sem registros, a seção nem aparece.
   */
  done?: QueueRow[];
  loading: boolean;
  canWrite: boolean;
  /**
   * A3.4 fix (revisão B5) — permissão PRÓPRIA do registro de atendimento.
   * Sem ela o balcão continua operando a fila (chamar, iniciar, concluir),
   * mas não abre o conteúdo profissional do atendimento.
   */
  canEncounter: boolean;
  /** Sem permissão de Clientes, a busca no CRM não é oferecida (o servidor barra). */
  canSearchContacts?: boolean;
  /** Fuso do negócio — usado para mostrar o HORÁRIO dos atendidos de hoje. */
  timezone?: string;
  onChanged: () => void;
  professionals: Array<{ id: string; name: string }>;
  /** Serviços ATIVOS com a régua de profissionais de cada um (pode ser vazia). */
  services: Array<{ id: string; name: string; professionalIds?: string[] }>;
  /** Abre o agendamento de origem (quando a entrada veio de um horário marcado). */
  onOpenBooking?: (bookingId: string) => void;
  /** "Iniciar atendimento" com permissão: a fila avança E o registro abre. */
  onEncounter?: (row: QueueRow) => void;
  /** Abrir a ficha do cliente (a que existe no CRM desta unidade). */
  onOpenClient?: (row: QueueRow) => void;
  /** "Encaixar na agenda": abre o agendamento PRÉ-PREENCHIDO (não cria nada). */
  onFitIn?: (row: QueueRow) => void;
  /**
   * A3.4 final UX — fechar a rail (o painel vive ao LADO da agenda; quem
   * decide se ele aparece é a tela, não ele). Sem a prop, nenhum [X] é
   * renderizado: o mesmo painel continua servindo outro host.
   */
  onClose?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState({ name: '', phone: '', serviceId: '', professionalId: '', note: '' });
  // ── Identidade (A3.4 teste humano) ──
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<ContactHit | null>(null);
  const [visitor, setVisitor] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);

  // O tempo de espera muda sozinho: 30s é o suficiente para o balcão e não
  // transforma a tela num relógio.
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const now = useMemo(() => new Date(), [tick]);
  const waiting = rows.filter((r) => r.status === 'waiting').length;
  const longest = rows
    .filter((r) => r.status === 'waiting' || r.status === 'called')
    .reduce((max, r) => Math.max(max, waitMinutes(r, now)), 0);

  // ── Serviço × profissional elegível ──
  // A regra do serviço (`professionalIds`) é a MESMA que o servidor cobra ao
  // iniciar o atendimento: aqui ela só evita oferecer o que seria recusado.
  const service = services.find((s) => s.id === form.serviceId);
  const requiredProIds = service?.professionalIds || [];
  const eligiblePros = requiredProIds.length
    ? professionals.filter((p) => requiredProIds.includes(p.id))
    : professionals;

  // Serviço sem exigência: "quem estiver livre" continua qualquer ativo.
  function chooseService(id: string) {
    const chosen = services.find((s) => s.id === id);
    const req = chosen?.professionalIds || [];
    const next = req.length ? professionals.filter((p) => req.includes(p.id)) : professionals;
    setForm((f) => ({
      ...f,
      serviceId: id,
      // Um único elegível já vem escolhido; com dois ou mais, o balcão decide.
      professionalId: req.length === 1 && next[0]
        ? next[0].id
        : (f.professionalId && next.some((p) => p.id === f.professionalId) ? f.professionalId : ''),
    }));
  }

  // ── Busca no CRM (nome OU WhatsApp), com o mesmo debounce da agenda ──
  const term = (form.name || '').trim().length >= 2 ? form.name.trim() : (form.phone || '');
  useEffect(() => {
    if (!adding || picked || !canSearchContacts) { setHits([]); setSearching(false); return; }
    const q = term.trim();
    if (q.length < 2) { setHits([]); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/contacts?businessId=${encodeURIComponent(businessId)}&q=${encodeURIComponent(q)}&limit=8`)
        .then((r) => (r.ok ? r.json() : { contacts: [] }))
        .then((d) => { if (alive) setHits((d.contacts || []).slice(0, 8)); })
        .catch(() => { if (alive) setHits([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [adding, picked, canSearchContacts, businessId, term]);

  function pickContact(c: ContactHit) {
    setPicked(c);
    setVisitor(false);
    setHits([]);
    setForm((f) => ({ ...f, name: c.name || f.name, phone: (c.phone || f.phone || '') }));
  }

  function clearContact() {
    setPicked(null);
    setHits([]);
    setVisitor(false);
    setForm((f) => ({ ...f, name: '', phone: '' }));
  }

  function resetForm() {
    setForm({ name: '', phone: '', serviceId: '', professionalId: '', note: '' });
    setPicked(null);
    setVisitor(false);
    setHits([]);
  }

  const move = useCallback(async (row: QueueRow, to: QueueStatus) => {
    setBusy(row.id); setError('');
    const res = await apiSend('/api/queue', 'PATCH', { businessId, id: row.id, status: to }, { scope: 'action', area: 'Fila' });
    setBusy(''); 
    if (!res.ok) { setError(res.message || 'Não foi possível atualizar a fila.'); return; }
    onChanged();
    // Handoff: sair da fila para "em atendimento" é o momento em que o registro
    // deve abrir — sem isso a pessoa teria que reencontrar o cliente pela agenda.
    if (to === 'in_service' && canEncounter && onEncounter) onEncounter(row);
  }, [businessId, canEncounter, onChanged, onEncounter]);

  const remove = useCallback(async (row: QueueRow) => {
    setBusy(row.id); setError('');
    const res = await apiSend('/api/queue', 'DELETE', { businessId, id: row.id }, { scope: 'action', area: 'Fila' });
    setBusy('');
    if (!res.ok) { setError(res.message || 'Não foi possível remover da fila.'); return; }
    onChanged();
  }, [businessId, onChanged]);

  async function add() {
    setBusy('new'); setError('');
    const res = await apiSend('/api/queue', 'POST', {
      businessId,
      // O cadastro escolhido é a identidade: o servidor revalida que ele é
      // DESTA unidade e não cria um segundo contato para a mesma pessoa.
      contactId: picked?.id || '',
      customerName: form.name,
      customerPhone: form.phone,
      serviceId: form.serviceId,
      professionalId: form.professionalId,
      note: form.note,
    }, { scope: 'action', area: 'Fila' });
    setBusy('');
    if (!res.ok) { setError(res.message || 'Não foi possível adicionar à fila.'); return; }
    resetForm();
    setAdding(false);
    onChanged();
  }

  const doneRows = done.filter((r) => r.status === 'done');
  const leftCount = done.length - doneRows.length;
  /** Horário (no fuso do negócio) do momento em que o atendimento fechou. */
  const timeOf = (row: QueueRow) => nowHM(new Date(row.endedAt || row.startedAt || row.createdAt), timezone || undefined);

  return (
    <div data-queue-panel="true" className="flex min-h-0 flex-col">
      {/* Header sticky: a lista rola DENTRO da rail e o título/badges continuam
          à vista. O [X] fecha a rail (a fila do dia segue no botão da agenda). */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]">
        <Icon n="clock" size={15} className="text-[var(--text-muted)]" />
        <span className="text-sm font-semibold text-[var(--text)]">Fila de hoje</span>
        {waiting > 0 && <Badge tone="amber">{waiting} aguardando</Badge>}
        {rows.some((r) => r.status === 'in_service') && (
          <Badge tone="green">{rows.filter((r) => r.status === 'in_service').length} em atendimento</Badge>
        )}
        {longest >= QUEUE_LONG_WAIT_MIN && <Badge tone="red">maior espera: {waitLabel(longest)}</Badge>}
        <div className="ml-auto flex items-center gap-1.5">
          {canWrite && (
            <Button size="sm" variant="secondary" onClick={() => { setAdding((v) => !v); setError(''); }}>
              <Icon n="plus" size={14} /> {adding ? 'Fechar' : 'Adicionar à fila'}
            </Button>
          )}
          {onClose && (
            <IconButton icon="x" label="Fechar a fila" tip="Fechar a fila (a agenda volta a ocupar a largura toda)"
              size="sm" variant="ghost" onClick={onClose} />
          )}
        </div>
      </div>

      {error && <Notice tone="error" className="m-3">{error}</Notice>}

      {adding && (
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Quem chegou sem horário marcado. A entrada vive na FILA — ela não ocupa a agenda e pode virar atendimento depois.
          </p>

          {/* 1. Identidade: o CRM primeiro, cadastro novo só quando não houver. */}
          {picked ? (
            <div data-queue-picked={picked.id} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] px-3.5 py-3">
              <Avatar name={picked.name || '?'} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--text)] truncate">{picked.name || 'Sem nome'}</span>
                <span className="block text-xs text-[var(--success-fg)] truncate">{picked.phone || 'sem telefone'}</span>
              </span>
              <Badge tone="green" icon="check">Cliente já cadastrado</Badge>
              <Button size="xs" variant="ghost" onClick={clearContact}>Trocar</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Nome">
                  <Input value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setVisitor(false); }} placeholder="Ex: Marlene" autoFocus />
                </Field>
                <Field label="WhatsApp" hint="Opcional se já tiver o nome">
                  <PhoneBRInput value={form.phone} onChange={(digits) => { setForm({ ...form, phone: digits }); setVisitor(false); }} />
                </Field>
              </div>
              {canSearchContacts && searching && <p className="text-xs text-[var(--text-faint)]">Buscando no CRM…</p>}
              {!searching && hits.length > 0 && (
                <ul data-queue-contact-results="true"
                  className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] overflow-hidden">
                  {hits.map((c) => (
                    <li key={c.id}>
                      <button type="button" data-queue-contact={c.id} onClick={() => pickContact(c)}
                        className="w-full text-left px-3 py-2 hover:bg-[var(--surface-hover)] flex items-center gap-2.5">
                        <Avatar name={c.name || '?'} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-[var(--text)] truncate">{c.name || 'Sem nome'}</span>
                          <span className="block text-xs text-[var(--text-muted)] truncate">{c.phone || 'sem telefone'}</span>
                        </span>
                        <Icon n="chevR" size={14} className="text-[var(--text-faint)] shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {canSearchContacts && !searching && term.trim().length >= 2 && hits.length === 0 && (
                <Button type="button" variant="soft" size="sm" onClick={() => setVisitor(true)} className="w-full justify-start">
                  + Novo cliente / visitante “{term.trim()}”
                </Button>
              )}
              {visitor && (
                <p className="text-xs text-[var(--text-muted)]">
                  Novo cliente/visitante: o cadastro mínimo nasce ao adicionar — a ficha completa pode ser preenchida depois, no
                  balcão ou pelo próprio cliente.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Serviço">
              <select value={form.serviceId} onChange={(e) => chooseService(e.target.value)}
                className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]">
                <option value="">A definir</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Profissional" hint={requiredProIds.length > 0 && eligiblePros.length > 1
              ? 'Só quem atende este serviço'
              : undefined}>
              <select value={form.professionalId} onChange={(e) => setForm({ ...form, professionalId: e.target.value })}
                className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]">
                <option value="">Quem estiver livre</option>
                {eligiblePros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          {requiredProIds.length > 0 && eligiblePros.length === 0 && (
            <Notice tone="warning">
              Este serviço ainda não tem profissional vinculado. Vincule em Catálogo → Serviços antes de encaixar alguém na fila.
            </Notice>
          )}
          <Field label="Observação" hint="Opcional">
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={200} placeholder="Ex: veio só para retoque" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={add} disabled={busy === 'new'}>{busy === 'new' ? 'Adicionando…' : 'Adicionar à fila'}</Button>
            <Button size="sm" variant="secondary" onClick={() => { setAdding(false); setError(''); resetForm(); }}>Cancelar</Button>
          </div>
        </div>
      )}

      {loading && rows.length === 0 && (
        <p className="px-4 py-6 text-sm text-[var(--text-muted)]">Carregando a fila…</p>
      )}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon="clock"
          title="Ninguém na fila"
          hint={canWrite
            ? 'Quando alguém chegar sem horário marcado, use “Adicionar à fila” — a agenda não é o lugar certo para isso.'
            : 'A fila do balcão aparece aqui em ordem de chegada.'}
        />
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((row) => {
            const def = QUEUE_STATUS[row.status];
            const action = NEXT_ACTION[row.status];
            const pos = queuePosition(rows, businessId, row.date, row.id);
            const waited = waitMinutes(row, now);
            const long = (row.status === 'waiting' || row.status === 'called') && waited >= QUEUE_LONG_WAIT_MIN;
            return (
              <li key={row.id} className="px-4 py-3 flex flex-wrap items-start gap-x-3 gap-y-2" data-queue-row={row.id}>
                <span className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                  row.status === 'in_service' ? 'bg-[var(--success-bg)] text-[var(--success-fg)]' : 'bg-[var(--surface-3)] text-[var(--text-muted)]',
                )}>
                  {row.status === 'in_service' ? <Icon n="check" size={14} strokeWidth={3} /> : (pos || '—')}
                </span>
                <div className="min-w-0 flex-1 basis-[calc(100%-3rem)]">
                  <p className="text-sm font-semibold text-[var(--text)] flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate max-w-full">{row.customerName || 'Sem nome'}</span>
                    <Badge tone={def.tone}>{def.label}</Badge>
                    {long && <Badge tone="red">esperando {waitLabel(waited)}</Badge>}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] break-words">
                    {[row.serviceName || 'Serviço a definir', row.professionalName || 'quem estiver livre'].join(' · ')}
                    {' · '}
                    {row.status === 'in_service' || row.status === 'done'
                      ? `esperou ${waitLabel(waited)}`
                      : `na fila há ${waitLabel(waited)}`}
                    {row.bookingId ? ' · veio de horário marcado' : ''}
                  </p>
                </div>
                {canWrite && action && (
                  // Mobile (320–430px): as ações descem para a própria linha, em
                  // vez de espremer nome/serviço atrás dos botões.
                  <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <Button size="sm" variant={action.variant} disabled={busy === row.id} onClick={() => move(row, action.to)}
                      title={action.to === 'in_service' && canEncounter ? 'Abre o registro do atendimento já vinculado' : undefined}>
                      {busy === row.id ? 'Salvando…' : action.label}
                    </Button>
                    {/* Ações secundárias: só as transições que a máquina permite. */}
                    {row.status === 'waiting' && queueTransitionAllowed('waiting', 'left') && (
                      <Button size="sm" variant="ghost" disabled={busy === row.id} onClick={() => move(row, 'left')}>Desistiu</Button>
                    )}
                    {row.status === 'called' && (
                      <Button size="sm" variant="ghost" disabled={busy === row.id} onClick={() => move(row, 'waiting')}>Voltar para a fila</Button>
                    )}
                    {row.contactId && onOpenClient && (
                      <Button size="sm" variant="ghost" onClick={() => onOpenClient(row)}>Abrir cliente</Button>
                    )}
                    {onFitIn && (
                      <Button size="sm" variant="ghost" onClick={() => onFitIn(row)}>Encaixar na agenda</Button>
                    )}
                    {/* A3.4 fix (2ª revisão): depois que o registro fecha, falta
                        uma porta óbvia para voltar nele. Quem está em atendimento
                        e tem a permissão reabre o registro AQUI — sem tocar no
                        status da fila. Sem a permissão, a linha segue só
                        operacional (nada de conteúdo profissional). */}
                    {row.status === 'in_service' && canEncounter && onEncounter && (
                      <Button size="sm" variant="secondary" onClick={() => onEncounter(row)}>Abrir atendimento</Button>
                    )}
                    {row.bookingId && onOpenBooking && (
                      <Button size="sm" variant="secondary" onClick={() => onOpenBooking(row.bookingId)}>Ver horário</Button>
                    )}
                    <IconButton icon="x" label={`Remover ${row.customerName || 'entrada'} da fila`} size="sm" variant="ghost"
                      disabled={busy === row.id} onClick={() => remove(row)} tip="Remover da fila (não apaga o histórico do contato)" />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── ATENDIDOS HOJE (A3.4 teste humano) ──
          Histórico do dia, SEPARADO da fila viva e recolhido: quem registrou um
          atendimento precisa reencontrá-lo depois. "Ver atendimento" abre o
          MESMO registro (leitura quando já está finalizado) — o profissional
          vê só os dele, porque a leitura no servidor já é escopada. */}
      {doneRows.length > 0 && (
        <section data-queue-done-section="true" className="border-t border-[var(--border)] mt-1">
          <button type="button" onClick={() => setDoneOpen((v) => !v)} aria-expanded={doneOpen}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--surface-hover)]">
            <Icon n="check" size={14} className="text-[var(--success-fg)]" />
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Atendidos hoje</span>
            <Badge tone="zinc">{doneRows.length}</Badge>
            <Icon n={doneOpen ? 'chevD' : 'chevR'} size={14} className="ml-auto text-[var(--text-faint)]" />
          </button>
          {doneOpen && (
            <ul className="divide-y divide-[var(--border)]">
              {doneRows.map((row) => (
                <li key={row.id} data-queue-done={row.id} className="px-4 py-3 flex flex-wrap items-start gap-x-3 gap-y-2">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-[var(--success-bg)] text-[var(--success-fg)]">
                    <Icon n="check" size={13} strokeWidth={3} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text)] truncate">{row.customerName || 'Sem nome'}</p>
                    <p className="text-xs text-[var(--text-muted)] break-words">
                      {[row.serviceName || 'Serviço a definir', row.professionalName || 'quem atendeu', timeOf(row)].join(' · ')}
                    </p>
                  </div>
                  <Badge tone={QUEUE_STATUS[row.status].tone}>{row.statusLabel || QUEUE_STATUS[row.status].label}</Badge>
                  {canEncounter && onEncounter && (
                    <Button size="sm" variant="secondary" onClick={() => onEncounter(row)}>Ver atendimento</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {leftCount > 0 && (
            <p className="px-4 pb-3 pt-1 text-xs text-[var(--text-faint)]">
              {leftCount === 1 ? '1 pessoa desistiu hoje' : `${leftCount} pessoas desistiram hoje`} — sem atendimento registrado.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
