'use client';
// ═══════════════════════════════════════════════════════════════
// CARTEIRINHA + PERFIL 360 DO CLIENTE (A3.3)
// ═══════════════════════════════════════════════════════════════
// Ao abrir uma pessoa, o painel mostra DUAS coisas separadas com clareza:
//
//   1. QUEM É A PESSOA  → carteirinha (avatar, nome, idade, contatos, CPF,
//      status de acesso, etiquetas) + dados cadastrais editáveis;
//   2. O QUE ACONTECEU  → histórico 360 (agendamentos, conversas, leads,
//      tarefas, linha do tempo) — o mesmo conteúdo rico de antes.
//
// Regras preservadas:
//   • observações continuam APPEND-ONLY (nada é apagado);
//   • consentimento de marketing nunca é presumido;
//   • criar acesso continua opcional e a senha temporária aparece UMA vez;
//   • etapa de lead só muda via PipelineStage real (nunca LeadStatus legado).
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { cn, waLink } from '@/lib/utils';
import { humanDateTime } from '@/lib/tz';
import { BOOKING_STATUS, LEAD_STATUS, type StatusDef } from '@/lib/status';
import { leadOriginLabel } from '@/lib/leads';
import type { BusinessPipeline, ContactProfile } from '@/lib/types';
import {
  BRAZILIAN_STATES, PROFILE_TAGS_MAX, ageFromBirthDate, clientTags, formatCep, formatCpf,
  formatPhoneBR, isValidCpf, normalizeBirthDate, profileOf,
} from '@/lib/contact-profile';
import { Avatar, Badge, Button, Drawer, IconButton, Input, Notice, Select, StatusBadge, SubCard, Switch, Tabs, Textarea, type TabItem } from '@/components/ui';
import { Icon } from '@/components/icons';
import { apiSend } from '@/lib/api-client';

// Observações do cliente (P2): histórico append-only com autor e data.
// `legacy: true` marca o registro antigo (campo único), preservado como está.
export interface VisibleNote { id: string; at: string; by: string; byName: string; text: string; bookingId?: string; legacy?: boolean }

/** Pessoa como o Cliente 360 devolve (fonte: /api/people360). */
export interface Person360 {
  key: string; contactId: string; note: string;
  notes?: VisibleNote[];
  customerId: string; name: string; phone: string; email: string;
  registered: boolean;
  accountStatus: 'none' | 'active';
  accountEmail?: string;
  accountPhone?: string;
  mustChangePassword?: boolean;
  customerSince: string; source: string; marketingOptIn: boolean;
  orders: number; spent: number; lastOrderAt: string;
  /** A3.3 — dados cadastrais (carteirinha). */
  profile?: ContactProfile;
  age?: number | null;
  tags?: Array<{ id: string; label: string; tone: string; hint: string }>;
  bookings: Array<{
    id: string; customerName: string; date: string; time: string; status: string; service: string;
    seriesId?: string; seriesIndex?: number; seriesCount?: number;
    professional?: string; rescheduleCount?: number; previousId?: string;
  }>;
  leads: Array<{ id: string; origin: string; status: string; stageId: string; stageName: string; interest: string; action: string; createdAt: string; stageHistory?: any[]; priority?: string; assignedUserId?: string; lastInteraction?: string }>;
  conversations?: Array<{ id: string; channel: string; status: string; at: string; preview: string; unread: number }>;
  tasks?: Array<{ id: string; title: string; status: string; dueAt: string; dueLabel: string; assignedUserId: string; assigneeName: string; leadId: string; bookingId: string }>;
  lastSeen: string;
}

// Data curta do evento ("14 SET · 10:00") — leitura rápida no histórico.
function eventDay(iso: string): string {
  const [, m, d] = (iso || '').slice(0, 10).split('-');
  if (!d) return '';
  const MES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  return `${Number(d)} ${MES[Number(m) - 1] || m}`;
}

const bookDef = (s: string): StatusDef => (BOOKING_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc', consumer: s, desc: '' };
const leadDef = (s: string): StatusDef => (LEAD_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc', consumer: s, desc: '' };

type HistoryTab = 'timeline' | 'bookings' | 'conversations' | 'leads' | 'tasks' | 'notes';

export function ClientProfileDrawer({ person, businessId, pipeline, canFunil, onClose, onChanged, onNewBooking }: {
  person: Person360;
  businessId: string;
  pipeline: BusinessPipeline | null;
  canFunil: boolean;
  onClose: () => void;
  onChanged: () => void;
  onNewBooking: (p: Person360) => void;
}) {
  const [tab, setTab] = useState<HistoryTab>('timeline');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ContactProfile>(() => profileOf(person.profile));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'error' | 'warning'; text: string; password?: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [legacyDraft, setLegacyDraft] = useState(person.note || '');
  const [editingLegacy, setEditingLegacy] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [tagDraft, setTagDraft] = useState('');

  const profile = profileOf(person.profile);
  const age = person.age ?? ageFromBirthDate(profile.birthDate);
  const tags = useMemo(() => (person.tags && person.tags.length
    ? person.tags
    : clientTags({
      name: person.name, accountStatus: person.accountStatus, marketingOptIn: person.marketingOptIn,
      bookingsCount: person.bookings.length, leadsCount: person.leads.length, profile,
    })), [person, profile]);

  const firstName = (person.name || '').split(' ')[0] || 'cliente';

  async function patch(payload: Record<string, unknown>, okText: string) {
    setSaving(true);
    setNotice(null);
    const res = await apiSend<any>('/api/contacts', 'PATCH', { businessId, id: person.contactId, ...payload }, { scope: 'action', area: 'Clientes' });
    setSaving(false);
    if (!res.ok) { setNotice({ tone: 'error', text: res.message || 'Não foi possível salvar.' }); return false; }
    setNotice({ tone: 'success', text: okText });
    onChanged();
    return true;
  }

  async function saveProfile() {
    if (!person.contactId) { setNotice({ tone: 'error', text: 'Este contato ainda não tem cadastro no CRM.' }); return; }
    if (draft.cpf && !isValidCpf(draft.cpf)) { setNotice({ tone: 'error', text: 'CPF inválido — confira os dígitos.' }); return; }
    if (draft.guardian.cpf && !isValidCpf(draft.guardian.cpf)) { setNotice({ tone: 'error', text: 'CPF do responsável inválido.' }); return; }
    const ok = await patch({ profile: draft }, 'Dados cadastrais salvos.');
    if (ok) setEditing(false);
  }

  async function setConsent(value: boolean) {
    if (!person.contactId) { setNotice({ tone: 'error', text: 'Este contato ainda não tem cadastro no CRM.' }); return; }
    await patch({ marketingOptIn: value }, value ? 'Consentimento registrado: pode receber promoções.' : 'Consentimento removido: não entra em campanhas.');
  }

  async function addNote() {
    const text = noteDraft.trim();
    if (!text || !person.contactId) return;
    const ok = await patch({ addNote: { text } }, 'Observação acrescentada ao histórico.');
    if (ok) setNoteDraft('');
  }

  async function saveLegacyNote() {
    const ok = await patch({ note: legacyDraft }, 'Registro anterior atualizado.');
    if (ok) setEditingLegacy(false);
  }

  async function createAccess() {
    if (!person.contactId || (!person.phone && !person.email)) {
      setNotice({ tone: 'error', text: 'Adicione um WhatsApp ou e-mail válido antes de criar o acesso.' });
      return;
    }
    setAccessSaving(true);
    setNotice(null);
    const res = await apiSend<any>('/api/contacts', 'POST', {
      businessId, name: person.name, phone: person.phone, email: person.email, createAccount: true, source: 'manual',
    }, { scope: 'action', area: 'Clientes' });
    setAccessSaving(false);
    if (!res.ok) { setNotice({ tone: 'error', text: res.message || 'Não foi possível criar o acesso.' }); return; }
    setNotice({
      tone: 'success',
      password: res.data?.temporaryPassword,
      text: res.data?.temporaryPassword
        ? 'Acesso criado. Mostre ou copie a senha agora — ela não aparece de novo.'
        : 'Acesso ativo e identidade vinculada. Esta conta já tinha uma credencial.',
    });
    onChanged();
  }

  async function setLead(id: string, stageId: string) {
    if (!pipeline) { setNotice({ tone: 'error', text: 'Aguarde carregar as etapas do funil.' }); return; }
    if (!pipeline.stages.some((s) => s.id === stageId)) { setNotice({ tone: 'error', text: 'Etapa inválida para este funil.' }); return; }
    setSaving(true);
    const res = await apiSend('/api/leads', 'PATCH', { businessId, id, stageId }, { scope: 'action', area: 'Clientes' });
    setSaving(false);
    if (!res.ok) { setNotice({ tone: 'error', text: res.message || 'Não foi possível atualizar.' }); return; }
    setNotice({ tone: 'success', text: 'Oportunidade movida de etapa.' });
    onChanged();
  }

  function nextStageForLead(lead: { stageId?: string; status: string }): string {
    if (!pipeline) return '';
    const curId = lead.stageId || '';
    if (!curId) return '';
    const ordered = [...pipeline.stages].sort((a, b) => a.order - b.order);
    const idx = ordered.findIndex((s) => s.id === curId);
    if (idx >= 0 && idx + 1 < ordered.length) return ordered[idx + 1].id;
    return '';
  }
  function nextStageLabel(lead: { stageId?: string; status: string }): string {
    const nid = nextStageForLead(lead);
    if (!nid || !pipeline) return '';
    const s = pipeline.stages.find((x) => x.id === nid);
    return s ? `Avançar → ${s.name}` : 'Avançar';
  }
  function stageDef(lead: { stageId?: string; status: string }): StatusDef {
    if (lead.stageId && pipeline) {
      const st = pipeline.stages.find((x) => x.id === lead.stageId);
      if (st) return { panel: st.name, tone: (st.color as any) || 'zinc', consumer: st.name, desc: '' } as unknown as StatusDef;
    }
    return leadDef(lead.status);
  }
  function lostStageId(): string | null {
    if (!pipeline) return null;
    const found = pipeline.stages.find((s) => s.id === 'lost');
    if (found) return 'lost';
    const mapped = pipeline.stages.find((s) => s.mappedStatus === 'lost');
    return mapped ? mapped.id : null;
  }

  // ── Linha do tempo unificada (histórico 360) ──
  const timeline = useMemo(() => {
    type Ev = { kind: string; id: string; sortKey: string; icon: string; when: string; title: string; subtitle?: string; badge?: string; tone: StatusDef['tone']; body?: React.ReactNode };
    const out: Ev[] = [];
    for (const b of person.bookings) {
      const d = bookDef(b.status);
      out.push({
        kind: 'booking', id: b.id, sortKey: `${b.date}T${b.time || '00:00'}`, icon: 'calendar',
        when: `${eventDay(b.date)}${b.time ? ` · ${b.time}` : ''}`,
        title: b.service,
        subtitle: [b.seriesId ? `Série · ${b.seriesIndex} de ${b.seriesCount}` : '', b.professional, (b.rescheduleCount || 0) > 0 ? `reagendado ${b.rescheduleCount}×` : ''].filter(Boolean).join(' · ') || 'Atendimento',
        badge: d.panel, tone: d.tone,
        body: <Link href={`/agenda?b=${businessId}&data=${b.date}`} className="text-xs font-semibold text-[var(--brand-fg)] hover:underline inline-flex items-center gap-1">Ver na agenda <Icon n="chevR" size={10} /></Link>,
      });
    }
    for (const c of person.conversations || []) {
      const phoneQ = person.phone ? encodeURIComponent(person.phone) : '';
      out.push({
        kind: 'conversation', id: c.id, sortKey: c.at || '', icon: 'whatsapp',
        when: `${eventDay((c.at || '').slice(0, 10))}${(c.at || '').length >= 16 ? ` · ${c.at.slice(11, 16)}` : ''}`,
        title: c.channel === 'whatsapp' ? 'Conversa pelo WhatsApp' : 'Conversa com o assistente',
        subtitle: c.preview ? `“${c.preview.slice(0, 140)}”` : (c.status === 'open' ? 'Em aberto' : 'Encerrada'),
        badge: (c.unread || 0) > 0 ? `${c.unread} não lida${c.unread! > 1 ? 's' : ''}` : undefined,
        tone: 'blue',
        body: person.phone ? (
          <div className="flex flex-wrap gap-1.5">
            <Link href={`/conversas?b=${businessId}&q=${phoneQ}`} className="il-chip">Abrir conversa</Link>
            <a href={waLink(person.phone, `Olá, ${firstName}!`)} target="_blank" rel="noreferrer" className="il-chip">WhatsApp</a>
          </div>
        ) : undefined,
      });
    }
    for (const l of person.leads) {
      const d = stageDef(l as any);
      const nextId = nextStageForLead(l as any);
      const lostId = lostStageId();
      const canLose = !!lostId && !!canFunil && !!pipeline && l.status !== 'lost' && l.status !== 'converted' && l.stageId !== 'converted' && l.stageId !== 'lost';
      out.push({
        kind: 'lead', id: l.id, sortKey: l.createdAt, icon: 'spark',
        when: eventDay(l.createdAt.slice(0, 10)),
        title: `Lead via ${leadOriginLabel(l.origin)}${l.stageName ? ` · ${l.stageName}` : ''}`,
        subtitle: [l.interest, l.action].filter(Boolean).join(' · ') || undefined,
        badge: d.panel, tone: d.tone as any,
        body: (
          <div className="flex flex-wrap gap-1.5">
            {nextId && canFunil && l.stageId !== 'scheduled' && (
              <Button size="xs" variant="soft" onClick={() => setLead(l.id, nextId)} disabled={saving}>{nextStageLabel(l as any)}</Button>
            )}
            {nextId === 'scheduled' && canFunil && (
              <Button size="xs" variant="soft" onClick={() => onNewBooking(person)}>Agendar atendimento</Button>
            )}
            {canLose && <Button size="xs" variant="quiet" onClick={() => setLead(l.id, lostId!)} disabled={saving}>Marcar perdido</Button>}
            {canFunil && <Link href={`/funil?b=${businessId}#${l.id}`} className="il-chip">Ver no funil</Link>}
          </div>
        ),
      });
    }
    for (const t of person.tasks || []) {
      out.push({
        kind: 'task', id: t.id, sortKey: t.dueAt || t.title, icon: 'tasks',
        when: t.dueAt ? eventDay(t.dueAt.slice(0, 10)) : '',
        title: `Tarefa: ${t.title}`,
        subtitle: [t.assigneeName ? `Resp.: ${t.assigneeName}` : '', t.dueLabel || ''].filter(Boolean).join(' · ') || undefined,
        badge: t.status === 'done' ? 'concluída' : t.status === 'cancelled' ? 'cancelada' : 'aberta',
        tone: t.status === 'done' ? 'emerald' : t.status === 'cancelled' ? 'zinc' : 'amber',
        body: (
          <div className="flex flex-wrap gap-1.5">
            {t.leadId && canFunil && <Link href={`/funil?b=${businessId}#${t.leadId}`} className="il-chip">Ver no funil</Link>}
            {t.bookingId && <Link href={`/agenda?b=${businessId}`} className="il-chip">Ver agenda</Link>}
          </div>
        ),
      });
    }
    return out.sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  }, [person, pipeline, canFunil, businessId, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabItems: TabItem<HistoryTab>[] = [
    { id: 'timeline', label: 'Linha do tempo', icon: 'history', count: timeline.length },
    { id: 'bookings', label: 'Agendamentos', icon: 'calendar', count: person.bookings.length },
    { id: 'conversations', label: 'Conversas', icon: 'chat', count: (person.conversations || []).length },
    { id: 'leads', label: 'Leads', icon: 'spark', count: person.leads.length },
    { id: 'tasks', label: 'Tarefas', icon: 'tasks', count: (person.tasks || []).length },
    { id: 'notes', label: 'Observações', icon: 'receipt', count: (person.notes || []).length },
  ];

  const notes = person.notes || [];

  return (
    <Drawer
      open
      onClose={onClose}
      title={person.name || 'Cliente'}
      subtitle={person.contactId ? 'Perfil e histórico 360' : 'Pessoa ainda sem cadastro no CRM'}
      width="max-w-[820px]"
      footer={
        <>
          {person.phone && (
            <A2 href={waLink(person.phone, `Olá, ${firstName}!`)} label="WhatsApp" icon="whatsapp" />
          )}
          <Button variant="secondary" size="sm" onClick={() => setEditing((v) => !v)}>
            <Icon n={editing ? 'x' : 'pencil'} size={14} /> {editing ? 'Fechar edição' : 'Editar dados'}
          </Button>
          <Button variant="primary" size="sm" onClick={() => onNewBooking(person)}>
            <Icon n="calendarPlus" size={14} /> Novo agendamento
          </Button>
        </>
      }
    >
      {/* ═══ QUEM É A PESSOA — carteirinha ═══ */}
      <div className="p-4">
        <div className="il-idcard rounded-xl border border-[var(--border)] shadow-md p-4">
          <div className="relative flex flex-wrap items-start gap-4">
            <Avatar name={person.name} size={72} />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-[var(--text)] leading-tight break-words">{person.name || 'Sem nome'}</h2>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">
                {age !== null ? `${age} anos` : 'Idade não informada'}
                {profile.birthDate ? ` · nasceu em ${profile.birthDate.split('-').reverse().join('/')}` : ''}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                {tags.map((t) => (
                  <span key={t.id} title={t.hint}>
                    <Badge tone={(t.tone as any) || 'zinc'}>{t.label}</Badge>
                  </span>
                ))}
                {tags.length === 0 && <Badge tone="zinc">Sem etiquetas</Badge>}
              </div>
            </div>
            {/* Status de acesso — estado claro, nunca só cor. */}
            <div className="shrink-0 text-right">
              <Badge tone={person.accountStatus === 'active' ? 'green' : 'zinc'} icon={person.accountStatus === 'active' ? 'lock' : 'user'}>
                {person.accountStatus === 'active' ? 'Acesso ativo' : 'Sem acesso'}
              </Badge>
            </div>
          </div>

          {/* Grade de dados — sempre legível, mesmo com campos vazios. */}
          <dl className="relative grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 mt-4 pt-4 border-t border-[var(--border)]">
            <Data label="Telefone / WhatsApp" value={person.phone ? formatPhoneBR(person.phone) : '—'}
              action={person.phone ? <CopyChip value={person.phone} /> : undefined} />
            <Data label="E-mail" value={person.email || '—'} />
            <Data label="CPF" value={profile.cpf ? formatCpf(profile.cpf) : '—'} />
            <Data label="Data de nascimento" value={profile.birthDate ? profile.birthDate.split('-').reverse().join('/') : '—'} />
            <Data label="Idade" value={age !== null ? `${age} anos` : '—'} />
            <Data label="Cliente desde" value={person.customerSince ? person.customerSince.slice(0, 10).split('-').reverse().join('/') : '—'} />
            <Data label="Identificação interna" value={person.contactId ? person.contactId.slice(0, 8) : '—'} mono />
            <Data label="Origem" value={person.source || '—'} />
            <Data label="Atendimentos" value={String(person.bookings.length)} />
          </dl>
        </div>

        {/* Acesso do cliente */}
        <SubCard className="mt-3 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text)] inline-flex items-center gap-1.5">
                <Icon n="lock" size={14} className="text-[var(--text-muted)]" /> Conta do cliente
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {person.accountStatus === 'active'
                  ? `Acesso ativo${person.accountEmail ? ` · ${person.accountEmail}` : ''}${person.mustChangePassword ? ' · senha temporária ainda em uso' : ''}`
                  : 'Opcional: com acesso, a pessoa vê os próprios agendamentos e faz remarcação sozinha.'}
              </p>
            </div>
            {person.accountStatus === 'none' && (
              <Button size="sm" variant="soft" onClick={createAccess} disabled={accessSaving || !person.contactId}>
                <Icon n="userCircle" size={14} /> {accessSaving ? 'Criando acesso…' : 'Criar acesso'}
              </Button>
            )}
          </div>
        </SubCard>

        {/* Consentimento de marketing — o que significa, sem jargão. */}
        <SubCard className="mt-3 p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text)]">Autoriza receber promoções</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {person.marketingOptIn
                ? 'Pode entrar em campanhas de marketing.'
                : 'Sem esta autorização a pessoa NÃO entra em campanha.'}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className={cn('text-xs font-bold', person.marketingOptIn ? 'text-[var(--success-fg)]' : 'text-[var(--text-muted)]')}>
              {person.marketingOptIn ? 'Aceitou' : 'Não aceitou'}
            </span>
            <Switch checked={person.marketingOptIn} onChange={setConsent} label="Autoriza receber promoções" disabled={!person.contactId} />
          </div>
        </SubCard>

        {notice && (
          <div className="mt-3">
            <Notice tone={notice.tone}>{notice.text}
              {notice.password && (
                <span className="mt-2 flex items-center gap-2">
                  <code className="select-all rounded bg-white border border-[var(--success-border)] px-2 py-1 font-bold tracking-wider text-[var(--text)]">{notice.password}</code>
                  <Button size="xs" variant="secondary" onClick={() => navigator.clipboard?.writeText(notice.password || '')}>Copiar senha</Button>
                </span>
              )}
            </Notice>
          </div>
        )}

        {/* ═══ EDIÇÃO DOS DADOS CADASTRAIS ═══ */}
        {editing && (
          <div className="mt-3 ws-panel p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text)]">Dados cadastrais</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Só o que você preencher é salvo. Nenhum campo é obrigatório.</p>
              </div>
              <IconButton icon="x" label="Cancelar edição" size="sm" variant="ghost" onClick={() => { setDraft(profileOf(person.profile)); setEditing(false); }} />
            </div>

            <fieldset className="space-y-3">
              <legend className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)] mb-2">Dados básicos</legend>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Data de nascimento</span>
                  <Input type="date" value={draft.birthDate} max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDraft((d) => ({ ...d, birthDate: normalizeBirthDate(e.target.value) }))} />
                  <span className="block text-xs text-[var(--text-muted)] mt-1">
                    {draft.birthDate ? `Idade calculada: ${ageFromBirthDate(draft.birthDate) ?? '—'} anos` : 'A idade é calculada automaticamente.'}
                  </span>
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">CPF</span>
                  <Input inputMode="numeric" value={draft.cpf ? formatCpf(draft.cpf) : ''} placeholder="000.000.000-00"
                    onChange={(e) => setDraft((d) => ({ ...d, cpf: e.target.value.replace(/\D/g, '').slice(0, 11) }))} />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Telefone / WhatsApp</span>
                  <Input inputMode="tel" defaultValue={person.phone} disabled
                    className="bg-[var(--surface-3)]" />
                  <span className="block text-xs text-[var(--text-muted)] mt-1">O telefone é a identidade do contato — edite pela busca/criação.</span>
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">E-mail</span>
                  <Input type="email" defaultValue={person.email} disabled className="bg-[var(--surface-3)]" />
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-3 mt-4">
              <legend className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)] mb-2">Endereço</legend>
              <div className="grid sm:grid-cols-6 gap-3">
                <label className="block sm:col-span-2">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">CEP</span>
                  <Input inputMode="numeric" value={draft.address.cep ? formatCep(draft.address.cep) : ''} placeholder="00000-000"
                    onChange={(e) => setDraft((d) => ({ ...d, address: { ...d.address, cep: e.target.value.replace(/\D/g, '').slice(0, 8) } }))} />
                </label>
                <label className="block sm:col-span-4">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Rua</span>
                  <Input value={draft.address.street}
                    onChange={(e) => setDraft((d) => ({ ...d, address: { ...d.address, street: e.target.value } }))} />
                </label>
                <label className="block sm:col-span-1">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Número</span>
                  <Input value={draft.address.number}
                    onChange={(e) => setDraft((d) => ({ ...d, address: { ...d.address, number: e.target.value } }))} />
                </label>
                <label className="block sm:col-span-2">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Complemento</span>
                  <Input value={draft.address.complement}
                    onChange={(e) => setDraft((d) => ({ ...d, address: { ...d.address, complement: e.target.value } }))} />
                </label>
                <label className="block sm:col-span-3">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Bairro</span>
                  <Input value={draft.address.district}
                    onChange={(e) => setDraft((d) => ({ ...d, address: { ...d.address, district: e.target.value } }))} />
                </label>
                <label className="block sm:col-span-4">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Cidade</span>
                  <Input value={draft.address.city}
                    onChange={(e) => setDraft((d) => ({ ...d, address: { ...d.address, city: e.target.value } }))} />
                </label>
                <label className="block sm:col-span-2">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Estado</span>
                  <Select value={draft.address.state}
                    onChange={(e) => setDraft((d) => ({ ...d, address: { ...d.address, state: e.target.value } }))}>
                    <option value="">—</option>
                    {BRAZILIAN_STATES.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                  </Select>
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-3 mt-4 rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)]/60 p-3">
              <legend className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--warning-fg)] mb-1 px-1">Menor de idade / responsável</legend>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <Switch checked={draft.guardian.isMinor} label="É menor de idade"
                  onChange={(v) => setDraft((d) => ({ ...d, guardian: { ...d.guardian, isMinor: v } }))} />
                <span className="text-sm text-[var(--text)]">Esta pessoa é menor de idade</span>
              </label>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Responsável</span>
                  <Input value={draft.guardian.name}
                    onChange={(e) => setDraft((d) => ({ ...d, guardian: { ...d.guardian, name: e.target.value } }))} />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Telefone do responsável</span>
                  <Input inputMode="tel" value={draft.guardian.phone ? formatPhoneBR(draft.guardian.phone) : ''}
                    onChange={(e) => setDraft((d) => ({ ...d, guardian: { ...d.guardian, phone: e.target.value.replace(/\D/g, '').slice(0, 13) } }))} />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">CPF do responsável</span>
                  <Input inputMode="numeric" value={draft.guardian.cpf ? formatCpf(draft.guardian.cpf) : ''}
                    onChange={(e) => setDraft((d) => ({ ...d, guardian: { ...d.guardian, cpf: e.target.value.replace(/\D/g, '').slice(0, 11) } }))} />
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-3 mt-4">
              <legend className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)] mb-2">Etiquetas</legend>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {draft.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-pill bg-[var(--surface-3)] border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--text)]">
                    {t}
                    <button type="button" aria-label={`Remover etiqueta ${t}`}
                      onClick={() => setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== t) }))}
                      className="text-[var(--text-faint)] hover:text-[var(--danger)]">
                      <Icon n="x" size={11} strokeWidth={2.6} />
                    </button>
                  </span>
                ))}
                {draft.tags.length === 0 && <span className="text-xs text-[var(--text-muted)]">Nenhuma etiqueta ainda.</span>}
              </div>
              <div className="flex gap-2">
                <Input value={tagDraft} placeholder="Ex.: convênio, indicação, VIP"
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const v = tagDraft.trim().slice(0, 24);
                    if (!v || draft.tags.includes(v) || draft.tags.length >= PROFILE_TAGS_MAX) { setTagDraft(''); return; }
                    setDraft((d) => ({ ...d, tags: [...d.tags, v] }));
                    setTagDraft('');
                  }} />
                <Button variant="secondary" size="sm" onClick={() => {
                  const v = tagDraft.trim().slice(0, 24);
                  if (!v || draft.tags.includes(v) || draft.tags.length >= PROFILE_TAGS_MAX) { setTagDraft(''); return; }
                  setDraft((d) => ({ ...d, tags: [...d.tags, v] }));
                  setTagDraft('');
                }}>Adicionar</Button>
              </div>
            </fieldset>

            <label className="block mt-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)] mb-2 block">Observação administrativa</span>
              <Textarea value={draft.adminNote} rows={3} placeholder="Preferências, restrições, convênio, alergias…"
                onChange={(e) => setDraft((d) => ({ ...d, adminNote: e.target.value }))} />
            </label>

            <div className="flex flex-wrap items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--border-soft)]">
              <Button variant="ghost" size="sm" onClick={() => { setDraft(profileOf(person.profile)); setEditing(false); }}>Cancelar</Button>
              <Button variant="primary" size="sm" onClick={saveProfile} disabled={saving}>
                <Icon n="check" size={14} /> {saving ? 'Salvando…' : 'Salvar dados'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ O QUE ACONTECEU — histórico ═══ */}
      <div className="px-4 pb-6">
        <div className="il-divider my-4">O que aconteceu com {firstName}</div>
        <Tabs items={tabItems} value={tab} onChange={setTab} ariaLabel="Seções do histórico do cliente" />

        <div className="mt-4 ws-panel">
          {tab === 'timeline' && (
            timeline.length === 0
              ? <Empty hint="Sem eventos ainda — agendamentos, conversas, leads e tarefas aparecem aqui." />
              : (
                <ol className="divide-y divide-[var(--border-soft)]">
                  {timeline.map((ev) => (
                    <li key={`${ev.kind}-${ev.id}`} className="px-4 py-3 flex gap-3">
                      <span className="w-8 h-8 shrink-0 rounded-md bg-[var(--brand-soft)] text-[var(--brand-fg)] flex items-center justify-center">
                        <Icon n={ev.icon} size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--text)]">{ev.title}</p>
                          {ev.badge && <StatusBadge tone={ev.tone as any}>{ev.badge}</StatusBadge>}
                        </div>
                        {ev.subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5 break-words">{ev.subtitle}</p>}
                        {ev.body && <div className="mt-2">{ev.body}</div>}
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold text-[var(--text-faint)] tabular-nums">{ev.when}</span>
                    </li>
                  ))}
                </ol>
              )
          )}

          {tab === 'bookings' && (
            person.bookings.length === 0
              ? <Empty hint="Nenhum agendamento registrado para esta pessoa." />
              : (
                <ul className="divide-y divide-[var(--border-soft)]">
                  {person.bookings.map((b) => {
                    const d = bookDef(b.status);
                    return (
                      <li key={b.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                        <span className="w-8 h-8 shrink-0 rounded-md bg-[var(--surface-3)] text-[var(--text-muted)] flex items-center justify-center">
                          <Icon n="calendar" size={15} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[var(--text)]">{b.service}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {b.date.split('-').reverse().join('/')}{b.time ? ` às ${b.time}` : ''}
                            {b.professional ? ` · ${b.professional}` : ''}
                            {b.seriesId ? ` · série ${b.seriesIndex}/${b.seriesCount}` : ''}
                            {(b.rescheduleCount || 0) > 0 ? ` · reagendado ${b.rescheduleCount}×` : ''}
                          </p>
                        </div>
                        <StatusBadge tone={d.tone}>{d.panel}</StatusBadge>
                        <Link href={`/agenda?b=${businessId}&data=${b.date}`} className="il-chip">Ver na agenda</Link>
                      </li>
                    );
                  })}
                </ul>
              )
          )}

          {tab === 'conversations' && (
            (person.conversations || []).length === 0
              ? <Empty hint="Nenhuma conversa registrada (WhatsApp ou assistente)." />
              : (
                <ul className="divide-y divide-[var(--border-soft)]">
                  {(person.conversations || []).map((c) => (
                    <li key={c.id} className="px-4 py-3 flex gap-3">
                      <span className="w-8 h-8 shrink-0 rounded-md bg-[var(--success-bg)] text-[var(--success-fg)] flex items-center justify-center">
                        <Icon n={c.channel === 'whatsapp' ? 'whatsapp' : 'spark'} size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--text)]">{c.channel === 'whatsapp' ? 'WhatsApp' : 'Assistente'}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 break-words">{c.preview || (c.status === 'open' ? 'Em aberto' : 'Encerrada')}</p>
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold text-[var(--text-faint)] tabular-nums">{(c.at || '').slice(0, 10).split('-').reverse().join('/')}</span>
                    </li>
                  ))}
                </ul>
              )
          )}

          {tab === 'leads' && (
            person.leads.length === 0
              ? <Empty hint="Nenhuma oportunidade no funil para esta pessoa." action={canFunil ? <Link href={`/funil?b=${businessId}`} className="il-chip">Abrir funil</Link> : undefined} />
              : (
                <ul className="divide-y divide-[var(--border-soft)]">
                  {person.leads.map((l) => {
                    const d = stageDef(l as any);
                    const nextId = nextStageForLead(l as any);
                    return (
                      <li key={l.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--text)]">Lead via {leadOriginLabel(l.origin)}</p>
                          <StatusBadge tone={d.tone as any}>{d.panel}</StatusBadge>
                          {l.priority === 'urgent' && <Badge tone="red">Urgente</Badge>}
                          {l.priority === 'high' && <Badge tone="amber">Alta prioridade</Badge>}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{[l.interest, l.action].filter(Boolean).join(' · ') || 'Sem detalhe'}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {nextId && canFunil && l.stageId !== 'scheduled' && (
                            <Button size="xs" variant="soft" onClick={() => setLead(l.id, nextId)} disabled={saving}>{nextStageLabel(l as any)}</Button>
                          )}
                          {nextId === 'scheduled' && canFunil && (
                            <Button size="xs" variant="soft" onClick={() => onNewBooking(person)}>Agendar atendimento</Button>
                          )}
                          {canFunil && <Link href={`/funil?b=${businessId}#${l.id}`} className="il-chip">Ver no funil</Link>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
          )}

          {tab === 'tasks' && (
            (person.tasks || []).length === 0
              ? <Empty hint="Nenhuma tarefa vinculada a esta pessoa." />
              : (
                <ul className="divide-y divide-[var(--border-soft)]">
                  {(person.tasks || []).map((t) => (
                    <li key={t.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                      <span className="w-8 h-8 shrink-0 rounded-md bg-[var(--warning-bg)] text-[var(--warning-fg)] flex items-center justify-center">
                        <Icon n="tasks" size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--text)]">{t.title}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{[t.assigneeName ? `Resp.: ${t.assigneeName}` : '', t.dueLabel].filter(Boolean).join(' · ')}</p>
                      </div>
                      <Badge tone={t.status === 'done' ? 'green' : t.status === 'cancelled' ? 'zinc' : 'amber'}>
                        {t.status === 'done' ? 'Concluída' : t.status === 'cancelled' ? 'Cancelada' : 'Aberta'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )
          )}

          {tab === 'notes' && (
            <div className="p-4 space-y-3">
              {notes.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] bg-[var(--surface-3)] border border-[var(--border)] rounded-md px-3 py-2.5">
                  Nenhuma observação ainda. O que você escrever aqui fica no histórico do cliente e ajuda quem atender depois.
                </p>
              ) : (
                <ul className="space-y-2">
                  {notes.map((n) => (
                    <li key={n.id} className="bg-[var(--surface-2)] border border-[var(--border-soft)] rounded-md px-3 py-2.5">
                      <p className="text-sm text-[var(--text)] whitespace-pre-wrap break-words">{n.text}</p>
                      <p className="text-[11px] text-[var(--text-faint)] mt-1">
                        {n.legacy
                          ? 'Registro anterior (sem autor/data)'
                          : <>{n.byName || 'Equipe'}{n.at ? ` · ${humanDateTime(n.at.slice(0, 10), n.at.slice(11, 16))}` : ''}{n.bookingId ? ' · sobre um agendamento' : ''}</>}
                      </p>
                      {n.legacy && (
                        editingLegacy ? (
                          <div className="flex gap-2 mt-2">
                            <Input value={legacyDraft} onChange={(e) => setLegacyDraft(e.target.value)} />
                            <Button size="sm" variant="primary" onClick={saveLegacyNote} disabled={saving}>Salvar</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingLegacy(false)}>Cancelar</Button>
                          </div>
                        ) : (
                          <button onClick={() => { setLegacyDraft(person.note || ''); setEditingLegacy(true); }}
                            className="text-[11px] font-semibold text-[var(--brand-fg)] hover:underline mt-1">Editar registro anterior</button>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
                  placeholder="Nova observação (ex.: prefere manhã, alergia a X…)" />
                <Button variant="primary" size="sm" onClick={addNote} disabled={!noteDraft.trim() || saving}>
                  <Icon n="plus" size={14} /> Adicionar
                </Button>
              </div>
              <p className="text-[11px] text-[var(--text-faint)]">As observações anteriores nunca são apagadas — o histórico é preservado.</p>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/** Linha de dado da carteirinha (rótulo + valor, com ação opcional). */
function Data({ label, value, action, mono }: { label: string; value: string; action?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)]">{label}</dt>
      <dd className={cn('text-sm font-semibold text-[var(--text)] truncate mt-0.5 flex items-center gap-1.5', mono && 'font-mono text-xs')}>
        <span className="truncate">{value}</span>
        {action}
      </dd>
    </div>
  );
}

function CopyChip({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" title="Copiar" aria-label="Copiar telefone"
      onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="text-[var(--text-faint)] hover:text-[var(--brand-fg)]">
      <Icon n={done ? 'check' : 'copy'} size={12} />
    </button>
  );
}

function A2({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md px-2.5 py-1.5 bg-[var(--success-bg)] text-[var(--success-fg)] border border-[var(--success-border)] hover:bg-[#d7f2e6]">
      <Icon n={icon} size={14} /> {label}
    </a>
  );
}

function Empty({ hint, action }: { hint: string; action?: React.ReactNode }) {
  return (
    <div className="il-empty">
      <div className="il-empty__icon"><Icon n="history" size={22} /></div>
      <p className="text-sm text-[var(--text-muted)] max-w-sm">{hint}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
