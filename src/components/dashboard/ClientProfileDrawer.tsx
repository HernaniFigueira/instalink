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
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { centsToBR, cn, waLink } from '@/lib/utils';
import { humanDateTime, formatDateBR, todayISO } from '@/lib/tz';
import { BOOKING_STATUS, LEAD_STATUS, type StatusDef } from '@/lib/status';
import { leadOriginLabel } from '@/lib/leads';
import type { BusinessPipeline, ContactProfile, FinanceEntry , Pet } from '@/lib/types';
import { FINANCE_STATUS_LABEL } from '@/lib/finance';
import { followUpDueDate } from '@/lib/encounters';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';
import {
  BRAZILIAN_STATES, PROFILE_TAGS_MAX, ageFromBirthDate, clientTags, countAttended, formatCep, formatCpf,
  formatPhoneBR, isValidCpf, normalizeBirthDate, profileOf,
} from '@/lib/contact-profile';
import { Avatar, Badge, Button, IconButton, Input, Kpi, Notice, Select, StatusBadge, SubCard, Switch, Tabs, Textarea, type TabItem } from '@/components/ui';
import { Icon } from '@/components/icons';
import { apiGet, apiSend } from '@/lib/api-client';
import { cepError, contactFieldErrors, emailError, hasFieldErrors, maskCep, maskCpf, phoneError } from '@/lib/field-quality';
import { PhoneBRInput } from '@/components/dashboard/PhoneBRInput';
import { canReopenEncounter } from '@/lib/encounters';
import { EncounterList, EncounterSheet, type EncounterRow } from '@/components/dashboard/EncounterSheet';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { PetsSection } from '@/components/dashboard/PetsSection';
import { Pet360Sheet } from '@/components/dashboard/Pet360Sheet';

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
  /** Foto da conta global, quando existe vínculo ('' = usar iniciais). */
  avatar?: string;
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
    // FASE 2 · P2 — "Iniciar atendimento" precisa dos vínculos reais.
    serviceId?: string; professionalId?: string;
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

// FASE 2 · P2 — Paciente 360: Visão geral · Agenda · Atendimento · Conversas ·
// Arquivos · Financeiro · Histórico (+ leads/tarefas/notas que já existiam).
type HistoryTab =
  | 'overview' | 'bookings' | 'encounters' | 'conversations'
  | 'files' | 'finance' | 'timeline' | 'leads' | 'tasks' | 'notes';

export function ClientProfileDrawer({ person, businessId, pipeline, canFunil, onClose, onChanged, onNewBooking }: {
  person: Person360;
  businessId: string;
  pipeline: BusinessPipeline | null;
  canFunil: boolean;
  onClose: () => void;
  onChanged: () => void;
  onNewBooking: (p: Person360) => void;
}) {
  const [tab, setTab] = useState<HistoryTab>('overview');
  // FASE 2 · P2/P7 — financeiro do paciente (carga única, escopo do contato).
  const [financeEntries, setFinanceEntries] = useState<FinanceEntry[]>([]);
  const [financeLoaded, setFinanceLoaded] = useState(false);
  const [financeError, setFinanceError] = useState('');
  // FASE 2 · P2 — "Iniciar atendimento" do próximo agendamento futuro.
  const [startEncounter, setStartEncounter] = useState<{ bookingId: string; seed: Record<string, string> } | null>(null);
  // A3.4 · Bloco 5 — registros de atendimento da pessoa. A permissão é PRÓPRIA
  // (`atendimento`): sem ela, a aba nem aparece e a rota não é chamada.
  const { permissions, role } = usePanelPermissions();
  const canEncounter = permissions.atendimento === true;
  // FASE 2 · P2 — aba Financeiro só existe com a permissão correspondente.
  const canFinance = permissions.financeiro === true;
  const [encounters, setEncounters] = useState<EncounterRow[]>([]);
  // HOMOLOGAÇÃO · P1 — Pet 360 (ficha do animal).
  const [pet360, setPet360] = useState<Pet | null>(null);
  const [encounterOpen, setEncounterOpen] = useState<EncounterRow | null>(null);
  const [encountersError, setEncountersError] = useState('');
  const [encountersLoaded, setEncountersLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ContactProfile>(() => profileOf(person.profile));
  // Identidade (nome/telefone/e-mail) é editável de verdade (ponto 3). Fica em
  // estado próprio porque NÃO faz parte de `profile`: são campos do contato.
  const [identityDraft, setIdentityDraft] = useState({
    name: person.name || '', phone: person.phone || '', email: person.email || '',
  });
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
      bookingsCount: person.bookings.length,
      // Ponto 9 — só atendimento concluído autoriza "Cliente atendido".
      attendedCount: countAttended(person.bookings),
      leadsCount: person.leads.length, profile,
    })), [person, profile]);

  // O cadastro mudou em relação ao que veio do servidor? Serve para não mandar
  // PATCH à toa e para dizer com clareza "nada para salvar".
  const draftChanged = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(profileOf(person.profile)),
    [draft, person.profile],
  );

  // Endereço em UMA linha legível (ponto 10): rua, número, complemento —
  // bairro, cidade/UF. Só as partes preenchidas entram, sem vírgula sobrando.
  const addressLine = useMemo(() => {
    const a = profile.address;
    const first = [a.street, a.number ? (a.street ? `${a.street}, ${a.number}` : a.number) : '', a.complement]
      .filter(Boolean).join(' · ');
    const second = [a.district, [a.city, a.state].filter(Boolean).join('/')].filter(Boolean).join(' — ');
    const cep = a.cep ? formatCep(a.cep) : '';
    return [first, second, cep].filter(Boolean).join(' · ');
  }, [profile.address]);

  // A seção "Cadastro" só aparece quando há algo cadastrado de verdade.
  const hasCadastre = !!(addressLine || profile.guardian.name || profile.guardian.phone
    || profile.adminNote || profile.tags.length > 0);

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
    // Ponto 3 — identidade editável. Só envia o que mudou, e a validação de
    // verdade (normalização + conflito com outro contato) é do servidor: o
    // React aqui só evita ida inútil.
    // Qualidade dos campos (A3.4 · Bloco 6): o telefone vai com máscara na
    // tela, mas quem grava é dígito; e um erro bobo de digitação é avisado
    // AQUI, com a mensagem específica, em vez de virar cadastro torto.
    const errs = contactFieldErrors(
      { name: identityDraft.name, phone: identityDraft.phone, email: identityDraft.email, cpf: draft.cpf, cep: draft.address.cep },
      { requireName: true },
    );
    if (hasFieldErrors(errs)) {
      setNotice({ tone: 'error', text: Object.values(errs).find(Boolean) || 'Confira os campos destacados.' });
      return;
    }
    const identity: Record<string, string> = {};
    const name = identityDraft.name.trim();
    if (name && name !== (person.name || '')) identity.name = name;
    const phone = identityDraft.phone.replace(/\D/g, '');
    if (phone !== (person.phone || '')) identity.phone = phone;
    const email = identityDraft.email.trim().toLowerCase();
    if (email !== (person.email || '')) identity.email = email;
    if (Object.keys(identity).length === 0 && !draftChanged) {
      setNotice({ tone: 'info', text: 'Nada para salvar — nenhum campo foi alterado.' });
      return;
    }
    const ok = await patch({ ...identity, profile: draft }, 'Dados cadastrais salvos.');
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
    // FASE 2 · P2 — pagamentos entram no Histórico (dados reais do financeiro).
    for (const f of financeEntries) {
      if (f.status === 'cancelado') continue;
      out.push({
        kind: 'finance', id: f.id, sortKey: (f.paidAt || f.dueDate || f.createdAt || '').slice(0, 16),
        icon: f.kind === 'receita' ? 'wallet' : 'receipt',
        when: f.paidAt ? eventDay(f.paidAt) : (f.dueDate ? eventDay(f.dueDate) : ''),
        title: `${f.kind === 'receita' ? 'Recebimento' : 'Despesa'} · ${centsToBR(f.amount)}`,
        subtitle: f.description,
        badge: FINANCE_STATUS_LABEL[f.status],
        tone: f.status === 'pago' ? 'emerald' : 'amber', // cancelados já saíram acima
      });
    }
    return out.sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
  }, [person, pipeline, canFunil, businessId, saving, financeEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  // FASE 2 · P2 — ordem da jornada do paciente: visão → agenda → atendimento →
  // conversa → arquivos → financeiro → histórico (+ as abas operacionais já existentes).
  const tabItems: TabItem<HistoryTab>[] = [
    { id: 'overview', label: 'Visão geral', icon: 'grid' },
    { id: 'bookings', label: 'Agenda', icon: 'calendar', count: person.bookings.length },
    { id: 'encounters', label: 'Atendimento', icon: 'fileText', count: encountersLoaded && !encountersError ? encounters.length : undefined },
    { id: 'conversations', label: 'Conversas', icon: 'chat', count: (person.conversations || []).length },
    { id: 'files', label: 'Arquivos', icon: 'upload', count: encounters.reduce((n, e) => n + ((e.files || []).length), 0) },
    ...(canFinance ? [{ id: 'finance' as const, label: 'Financeiro', icon: 'wallet', count: financeEntries.length }] : []),
    { id: 'timeline', label: 'Histórico', icon: 'history', count: timeline.length },
    { id: 'leads', label: 'Leads', icon: 'spark', count: person.leads.length },
    { id: 'tasks', label: 'Tarefas', icon: 'tasks', count: (person.tasks || []).length },
    { id: 'notes', label: 'Observações administrativas', icon: 'receipt', count: (person.notes || []).length },
  ];

  const notes = person.notes || [];

  useEffect(() => {
    if (!canEncounter || encountersLoaded) return;
    const q = person.contactId
      ? `contactId=${encodeURIComponent(person.contactId)}`
      : person.customerId ? `customerId=${encodeURIComponent(person.customerId)}` : '';
    if (!q) { setEncountersLoaded(true); return; }
    let cancelled = false;
    setEncountersError('');
    apiGet<{ encounters?: EncounterRow[] }>(`/api/encounters?businessId=${businessId}&${q}`, { scope: 'area', area: 'Atendimento' })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setEncounters(res.data?.encounters || []);
        else setEncountersError(res.message || 'Não foi possível carregar os atendimentos.');
        setEncountersLoaded(true);
      });
    return () => { cancelled = true; };
  }, [canEncounter, encountersLoaded, person.contactId, person.customerId, businessId]);

  // FASE 2 · P2/P7 — cobranças do paciente (uma carga; sem permissão = sem chamada).
  useEffect(() => {
    if (!canFinance || financeLoaded || !person.contactId) { if (!canFinance) setFinanceLoaded(true); return; }
    let cancelled = false;
    setFinanceError('');
    apiGet<{ entries?: FinanceEntry[] }>(
      `/api/finance?businessId=${encodeURIComponent(businessId)}&contactId=${encodeURIComponent(person.contactId)}`,
      { scope: 'area', area: 'Financeiro' },
    ).then((res) => {
      if (cancelled) return;
      if (res.ok) setFinanceEntries(res.data?.entries || []);
      else setFinanceError(res.message || 'Não foi possível carregar o financeiro.');
      setFinanceLoaded(true);
    });
    return () => { cancelled = true; };
  }, [canFinance, financeLoaded, person.contactId, businessId]);

  // ── FASE 2 · P2 — Visão geral: só dados reais, derivados do que já está aqui ──
  const today = todayISO();
  const nextBooking = useMemo(
    () => [...person.bookings]
      .filter((b) => b.date >= today && b.status !== 'cancelled' && b.status !== 'completed' && b.status !== 'no_show')
      .sort((a, b) => (a.date + (a.time || '') < b.date + (b.time || '') ? 1 : -1))[0] || null,
    [person.bookings, today],
  );
  const lastEncounter = encounters[0] || null; // a API devolve mais recente primeiro
  const lastNote = notes[0] || null;
  const pendingReturn = [...encounters]
    .filter((e) => e.status === 'finalized' && (e.followUpMode === 'date' || e.followUpMode === 'interval'))
    .map((e) => ({ e, due: followUpDueDate(e) }))
    .filter((x) => x.due)
    .sort((a, b) => (a.due < b.due ? 1 : -1))[0] || null;
  const financeReceived = financeEntries.filter((f) => f.kind === 'receita' && f.status === 'pago').reduce((a, f) => a + f.amount, 0);
  const financePending = financeEntries.filter((f) => f.kind === 'receita' && f.status !== 'pago' && f.status !== 'cancelado').reduce((a, f) => a + f.amount, 0);
  // Arquivos reais: anexos dos atendimentos desta pessoa (Storage + referência).
  const files = useMemo(() => encounters.flatMap((e) => (e.files || []).map((f) => ({ ...f, encounterDate: e.date, encounterId: e.id }))), [encounters]);

  return (
    <>
      {encounterOpen && (
        <EncounterSheet
          businessId={businessId}
          existing={encounterOpen}
          canReopen={canReopenEncounter(role)}
          onScheduleReturn={() => { setEncounterOpen(null); onNewBooking(person); }}
          onClose={() => setEncounterOpen(null)}
          onSaved={() => { /* silencioso: não recarrega nem fecha */ }}
          onChanged={() => { setEncountersLoaded(false); onChanged(); }}
        />
      )}
      {/* FASE 2 · P2 — "Iniciar atendimento" do próximo agendamento (quando aplicável). */}
      {startEncounter && (
        <EncounterSheet
          businessId={businessId}
          bookingId={startEncounter.bookingId}
          seed={startEncounter.seed as any}
          canReopen={canReopenEncounter(role)}
          onScheduleReturn={() => { setStartEncounter(null); onNewBooking(person); }}
          onClose={() => setStartEncounter(null)}
          onSaved={() => { /* silencioso: não recarrega nem fecha */ }}
          onChanged={() => { setEncountersLoaded(false); onChanged(); }}
        />
      )}
    <WorkspaceSheet
      open
      onClose={onClose}
      title={person.name || 'Cliente'}
      subtitle={person.contactId ? 'Paciente 360 — perfil, agenda, atendimento e financeiro' : 'Pessoa ainda sem cadastro no CRM'}
      icon="users"
      width="max-w-[860px]"
      footer={
        <>
          {person.phone && (
            <A2 href={waLink(person.phone, `Olá, ${firstName}!`)} label="WhatsApp" icon="whatsapp" />
          )}
          {/* FASE 2 · P2 — ações rápidas: nota e iniciar atendimento (quando aplicável). */}
          <Button variant="quiet" size="sm" onClick={() => setTab('notes')}>
            <Icon n="pencil" size={14} /> Registrar nota
          </Button>
          {canEncounter && nextBooking && (
            <Button variant="secondary" size="sm" onClick={() => setStartEncounter({
              bookingId: nextBooking.id,
              seed: {
                customerName: person.name || '',
                serviceId: nextBooking.serviceId || '', professionalId: nextBooking.professionalId || '',
                date: nextBooking.date, time: nextBooking.time || '',
                contactId: person.contactId || '', customerId: person.customerId || '',
              },
            })}>
              <Icon n="fileText" size={14} /> Iniciar atendimento
            </Button>
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
            {/* Ponto 8 — foto real da conta global quando existe; sem ela, iniciais. */}
            <Avatar name={person.name} src={person.avatar || undefined} size={72} />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-[var(--text)] leading-tight break-words">{person.name || 'Sem nome'}</h2>
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

        {/* FASE 2 · P6 — pets do tutor (aparece SOMENTE em clínica veterinária). */}
        {person.contactId && (
          <PetsSection businessId={businessId} tutorId={person.contactId} tutorName={person.name} onChanged={onChanged} onOpenPet={setPet360} />
        )}

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

        {/* ═══ CADASTRO (visão de leitura) ═══
            Ponto 10: endereço, responsável e observação não podem existir só
            dentro da edição. Aqui aparece o que já está preenchido — e só o
            que está preenchido, para a ficha não virar formulário vazio.
            Não é prontuário: é dado administrativo. */}
        {hasCadastre && (
          <SubCard className="mt-3 p-3.5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-sm font-semibold text-[var(--text)] inline-flex items-center gap-1.5">
                <Icon n="idcard" size={14} className="text-[var(--text-muted)]" /> Cadastro
              </p>
              <Button size="xs" variant="quiet" onClick={() => setEditing(true)}>
                <Icon n="pencil" size={12} /> Editar
              </Button>
            </div>
            <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2.5">
              {addressLine && (
                <div className="sm:col-span-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">Endereço</dt>
                  <dd className="text-xs text-[var(--text)] mt-0.5">{addressLine}</dd>
                </div>
              )}
              {profile.guardian.name && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">Responsável</dt>
                  <dd className="text-xs text-[var(--text)] mt-0.5">
                    {profile.guardian.name}
                    {profile.guardian.relationship ? ` · ${profile.guardian.relationship}` : ''}
                  </dd>
                </div>
              )}
              {profile.guardian.phone && (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">Contato do responsável</dt>
                  <dd className="text-xs text-[var(--text)] mt-0.5">{formatPhoneBR(profile.guardian.phone)}</dd>
                </div>
              )}
              {profile.adminNote && (
                <div className="sm:col-span-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">Observação administrativa</dt>
                  <dd className="text-xs text-[var(--text-muted)] mt-0.5 whitespace-pre-line">{profile.adminNote}</dd>
                </div>
              )}
              {profile.tags.length > 0 && (
                <div className="sm:col-span-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)] mb-1">Etiquetas do cadastro</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {profile.tags.map((t) => (
                      <span key={t} className="rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">{t}</span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </SubCard>
        )}

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
            <span className={cn('text-xs font-semibold', person.marketingOptIn ? 'text-[var(--success-fg)]' : 'text-[var(--text-muted)]')}>
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
                  <code className="select-all rounded bg-white border border-[var(--success-border)] px-2 py-1 font-semibold tracking-wider text-[var(--text)]">{notice.password}</code>
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
                <h3 className="text-sm font-semibold text-[var(--text)]">Dados cadastrais</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Só o que você preencher é salvo. Nenhum campo é obrigatório.</p>
              </div>
              <IconButton icon="x" label="Cancelar edição" size="sm" variant="ghost" onClick={() => { setDraft(profileOf(person.profile)); setEditing(false); }} />
            </div>

            <fieldset className="space-y-3">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)] mb-2">Dados básicos</legend>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block sm:col-span-2">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Nome completo</span>
                  <Input value={identityDraft.name} placeholder="Nome do cliente"
                    onChange={(e) => setIdentityDraft((d) => ({ ...d, name: e.target.value }))} />
                </label>
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
                  <Input inputMode="numeric" value={maskCpf(draft.cpf)} placeholder="000.000.000-00"
                    onChange={(e) => setDraft((d) => ({ ...d, cpf: e.target.value.replace(/\D/g, '').slice(0, 11) }))} />
                  {draft.cpf.length === 11 && !isValidCpf(draft.cpf) && (
                    <span className="block text-xs text-[var(--danger-fg)] mt-1">CPF inválido — confira os dígitos.</span>
                  )}
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">Telefone / WhatsApp</span>
                  <PhoneBRInput value={identityDraft.phone}
                    onChange={(digits) => setIdentityDraft((d) => ({ ...d, phone: digits }))} />
                  {phoneError(identityDraft.phone) && (
                    <span className="block text-xs text-[var(--danger-fg)] mt-1">{phoneError(identityDraft.phone)}</span>
                  )}
                  <span className="block text-xs text-[var(--text-muted)] mt-1">
                    Se já pertencer a outro cliente desta unidade, a troca é recusada — ninguém é fundido por engano.
                  </span>
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">E-mail</span>
                  <Input type="email" value={identityDraft.email} placeholder="nome@exemplo.com"
                    onChange={(e) => setIdentityDraft((d) => ({ ...d, email: e.target.value }))} />
                  {emailError(identityDraft.email) && (
                    <span className="block text-xs text-[var(--danger-fg)] mt-1">{emailError(identityDraft.email)}</span>
                  )}
                </label>
              </div>
            </fieldset>

            {/* A conta de login é OUTRA coisa: trocar o cadastro daqui não muda
                a identidade global da conta, e isso fica dito, não subentendido. */}
            {person.accountStatus === 'active' && (
              <Notice tone="info" className="mt-3">
                <strong>Conta de acesso separada.</strong> Este cliente entra na área do cliente com
                {person.accountEmail ? ` ${person.accountEmail}` : 'o e-mail da conta'}
                {person.accountPhone ? ` / ${formatPhoneBR(person.accountPhone)}` : ''}.
                Alterar o cadastro desta ficha não muda o login — para trocar a identidade da conta,
                faça isso em Equipe/Acesso.
              </Notice>
            )}

            <fieldset className="space-y-3 mt-4">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)] mb-2">Endereço</legend>
              <div className="grid sm:grid-cols-6 gap-3">
                <label className="block sm:col-span-2">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">CEP</span>
                  <Input inputMode="numeric" value={maskCep(draft.address.cep)} placeholder="00000-000"
                    onChange={(e) => setDraft((d) => ({ ...d, address: { ...d.address, cep: e.target.value.replace(/\D/g, '').slice(0, 8) } }))} />
                  {cepError(draft.address.cep) && (
                    <span className="block text-xs text-[var(--danger-fg)] mt-1">{cepError(draft.address.cep)}</span>
                  )}
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
              <legend className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--warning-fg)] mb-1 px-1">Menor de idade / responsável</legend>
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
                  <PhoneBRInput value={draft.guardian.phone}
                    onChange={(digits) => setDraft((d) => ({ ...d, guardian: { ...d.guardian, phone: digits } }))} />
                </label>
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">CPF do responsável</span>
                  <Input inputMode="numeric" value={maskCpf(draft.guardian.cpf)}
                    onChange={(e) => setDraft((d) => ({ ...d, guardian: { ...d.guardian, cpf: e.target.value.replace(/\D/g, '').slice(0, 11) } }))} />
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-3 mt-4">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)] mb-2">Etiquetas</legend>
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
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)] mb-2 block">Observação administrativa</span>
              <Textarea value={draft.adminNote} rows={3} placeholder="Prefere horário da manhã, confirmar por telefone, convênio..."
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

      {pet360 && (
        <Pet360Sheet
          open={!!pet360}
          onClose={() => setPet360(null)}
          businessId={businessId}
          pet={pet360}
          tutorName={person.name}
          tutorPhone={person.phone}
          onOpenEncounter={(row) => { setPet360(null); setEncounterOpen(row); }}
        />
      )}
      {/* ═══ O QUE ACONTECEU — histórico ═══ */}
      <div className="px-4 pb-6">
        <div className="il-divider my-4">O que aconteceu com {firstName}</div>
        <Tabs items={tabItems} value={tab} onChange={setTab} ariaLabel="Seções do histórico do cliente" />

        <div className="mt-4 ws-panel">
          {/* ── FASE 2 · P2 — VISÃO GERAL (próximo passo em primeiro) ── */}
          {tab === 'overview' && (
            <div className="p-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-[11.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Próximo agendamento</p>
                  {nextBooking ? (
                    <>
                      <p className="text-[15px] font-semibold text-[var(--text)] mt-1">{formatDateBR(nextBooking.date)}{nextBooking.time ? ` · ${nextBooking.time}` : ''}</p>
                      <p className="text-[12px] text-[var(--text-muted)]">{nextBooking.service}{nextBooking.professional ? ` · ${nextBooking.professional}` : ''}</p>
                      <Link href={`/agenda?b=${businessId}&data=${nextBooking.date}`} className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline">Ver na agenda</Link>
                    </>
                  ) : <p className="text-[13px] text-[var(--text-muted)] mt-1">Nenhum futuro marcado.</p>}
                </div>
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-[11.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Último atendimento</p>
                  {lastEncounter ? (
                    <>
                      <p className="text-[15px] font-semibold text-[var(--text)] mt-1">{formatDateBR(lastEncounter.date)}{lastEncounter.time ? ` · ${lastEncounter.time}` : ''}</p>
                      <p className="text-[12px] text-[var(--text-muted)] line-clamp-2">{lastEncounter.evolution || lastEncounter.complaint || 'Sem descrição'}</p>
                      <button type="button" className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline" onClick={() => setEncounterOpen(lastEncounter)}>Abrir registro</button>
                    </>
                  ) : <p className="text-[13px] text-[var(--text-muted)] mt-1">Sem registro de atendimento.</p>}
                </div>
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-[11.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Retorno previsto</p>
                  {pendingReturn ? (
                    <>
                      <p className="text-[15px] font-semibold text-[var(--text)] mt-1">{formatDateBR(pendingReturn.due)}</p>
                      <p className="text-[12px] text-[var(--text-muted)]">{pendingReturn.e.followUp || (pendingReturn.e.followUpMode === 'interval' ? `Intervalo de ${pendingReturn.e.followUpDays} dias` : 'Retorno programado')}</p>
                    </>
                  ) : <p className="text-[13px] text-[var(--text-muted)] mt-1">Sem retorno estruturado registrado.</p>}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-[11.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Observação importante</p>
                  {lastNote ? (
                    <p className="text-[13px] text-[var(--text)] mt-1 line-clamp-3">{lastNote.text}</p>
                  ) : profile.adminNote ? (
                    <p className="text-[13px] text-[var(--text)] mt-1 line-clamp-3">{profile.adminNote}</p>
                  ) : <p className="text-[13px] text-[var(--text-muted)] mt-1">Nenhuma observação registrada.</p>}
                  <button type="button" className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline mt-1" onClick={() => setTab('notes')}>Ver observações</button>
                </div>
                {canFinance ? (
                  <div className="rounded-lg border border-[var(--border)] p-3">
                    <p className="text-[11.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Financeiro do paciente</p>
                    {!financeLoaded ? <p className="text-[13px] text-[var(--text-muted)] mt-1">Carregando…</p> : (
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <Kpi label="Recebido" value={centsToBR(financeReceived)} tone="success" />
                        <Kpi label="Em aberto" value={centsToBR(financePending)} tone={financePending > 0 ? 'warning' : 'default'} />
                      </div>
                    )}
                    <button type="button" className="text-[12px] font-semibold text-[var(--brand-fg)] hover:underline mt-1" onClick={() => setTab('finance')}>Abrir financeiro</button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-[var(--border)] p-3">
                    <p className="text-[11.5px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Status</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {tags.map((t) => <Badge key={t.id} tone={(t.tone as any) || 'zinc'}>{t.label}</Badge>)}
                      {tags.length === 0 && <Badge tone="zinc">Sem etiquetas</Badge>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── FASE 2 · P2 — ARQUIVOS (anexos reais dos atendimentos) ── */}
          {tab === 'files' && (
            !canEncounter ? <div className="p-4"><Empty hint="Seu perfil não tem a permissão de Atendimento para ver os arquivos do cuidado." /></div>
              : !encountersLoaded ? <p role="status" className="p-4 text-sm">Carregando arquivos…</p>
              : files.length === 0 ? <div className="p-4"><Empty hint="Nenhum arquivo anexado — anexos são adicionados dentro do registro do atendimento." /></div>
              : (
                <ul className="divide-y divide-[var(--border-soft)]">
                  {files.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="grid place-items-center h-8 w-8 rounded-lg bg-[var(--brand-soft)] text-[var(--brand-fg)] shrink-0"><Icon n="upload" size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <a href={f.url} target="_blank" rel="noreferrer" className="text-[13.5px] font-semibold text-[var(--text)] hover:underline truncate block">{f.name}</a>
                        <p className="text-[11.5px] text-[var(--text-muted)]">Atendimento de {formatDateBR(f.encounterDate)} · {Math.max(1, Math.round(f.size / 1024))} KB</p>
                      </div>
                      <button type="button" className="il-chip" onClick={() => { const e = encounters.find((x) => x.id === f.encounterId); if (e) setEncounterOpen(e); }}>Abrir atendimento</button>
                    </li>
                  ))}
                </ul>
              )
          )}

          {/* ── FASE 2 · P2/P7 — FINANCEIRO DO PACIENTE ── */}
          {tab === 'finance' && canFinance && (
            !financeLoaded ? <p role="status" className="p-4 text-sm">Carregando financeiro…</p>
              : financeError ? <div role="alert" className="p-4 text-sm"><p>{financeError}</p><Button variant="secondary" size="sm" onClick={() => setFinanceLoaded(false)}>Tentar novamente</Button></div>
              : financeEntries.length === 0 ? <div className="p-4"><Empty hint="Nenhuma movimentação vinculada a este paciente." /></div>
              : (
                <div>
                  <div className="grid grid-cols-2 gap-2 p-4">
                    <Kpi label="Recebido" value={centsToBR(financeReceived)} tone="success" />
                    <Kpi label="Em aberto" value={centsToBR(financePending)} tone={financePending > 0 ? 'warning' : 'default'} />
                  </div>
                  <ul className="divide-y divide-[var(--border-soft)]">
                    {financeEntries.map((f) => (
                      <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="text-[12.5px] text-[var(--text-muted)] tabular-nums w-[92px] shrink-0">{f.dueDate ? f.dueDate.split('-').reverse().join('/') : '—'}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-[var(--text)] truncate">{f.description}</p>
                          <p className="text-[11.5px] text-[var(--text-muted)]">{FINANCE_STATUS_LABEL[f.status]}{f.method ? ` · ${f.method}` : ''}</p>
                        </div>
                        <span className={`text-[13.5px] font-semibold tabular-nums ${f.kind === 'receita' ? 'text-[var(--success-fg)]' : 'text-[var(--danger)]'}`}>
                          {f.kind === 'receita' ? '+' : '−'}{centsToBR(f.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
          )}

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

          {tab === 'encounters' && (
            !encountersLoaded ? <p role="status" className="p-4 text-sm">Carregando atendimentos…</p>
            : encountersError ? <div role="alert" className="p-4 text-sm"><p>{encountersError}</p><Button variant="secondary" onClick={() => setEncountersLoaded(false)}>Tentar novamente</Button></div>
            : encounters.length === 0
              ? <Empty hint="Nenhum registro de atendimento para esta pessoa ainda. Abra um agendamento e use “Atendimento” para registrar o que foi feito." />
              : <div className="px-4 py-3"><EncounterList rows={encounters} onOpen={setEncounterOpen} empty="" /></div>
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
                  Nenhuma observação administrativa ainda. Aqui vai o que ajuda a OPERAR o atendimento —
                  preferência de horário, quem confirmar, convênio, combinados do dia a dia.
                  {' '}<strong className="font-semibold text-[var(--text)]">O que aconteceu no atendimento fica em Atendimentos</strong>,
                  com registro assinado: esta lista não substitui nem copia aquele conteúdo.
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
                  placeholder="Nova observação (ex.: prefere horário da manhã, avisa antes…)" />
                <Button variant="primary" size="sm" onClick={addNote} disabled={!noteDraft.trim() || saving}>
                  <Icon n="plus" size={14} /> Adicionar
                </Button>
              </div>
              <p className="text-[11px] text-[var(--text-faint)]">As observações anteriores nunca são apagadas — o histórico é preservado.</p>
            </div>
          )}
        </div>
      </div>
    </WorkspaceSheet>
    </>
  );
}

/** Linha de dado da carteirinha (rótulo + valor, com ação opcional). */
function Data({ label, value, action, mono }: { label: string; value: string; action?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">{label}</dt>
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
      className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md px-2.5 py-1.5 bg-[var(--success-bg)] text-[var(--success-fg)] border border-[var(--success-border)] hover:bg-[var(--success-bg-hover)]">
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
