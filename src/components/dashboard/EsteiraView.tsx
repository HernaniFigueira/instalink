'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Lead, PipelineStage, BusinessPipeline, LeadPriority } from '@/lib/types';
import { leadOriginLabel } from '@/lib/leads';
// Módulo PURO (sem node:crypto) — seguro para componente de cliente.
import { normalizeLeadStageId } from '@/lib/pipeline-stages';
import { onlyDigits, waLink, cn, money } from '@/lib/utils';
import { todayISO, addDaysISO } from '@/lib/tz';
import { AreaLoadError } from './AccessNotice';
import { Button, buttonCls, Dialog, Field, Input, Notice, SearchField, Select, Textarea } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import { PhoneBRInput } from '@/components/dashboard/PhoneBRInput';
import Link from 'next/link';
import { PipelineStagesPanel } from '@/components/dashboard/PipelineStagesPanel';

function formatDateTime(iso: string): string {
  if (!iso) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} às ${iso.slice(11, 16)}`;
}

interface TeamMember {
  userId: string;
  name: string;
  role: string;
}

interface ServiceItem {
  id: string;
  name: string;
  durationMin: number;
  price: number;
}

interface ProfessionalItem {
  id: string;
  name: string;
}

export function EsteiraView() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';

  const [leads, setLeads] = useState<Lead[]>([]);
  const [pipeline, setPipeline] = useState<BusinessPipeline | null>(null);
  // A1.2 · Bloco 3: o nome da empresa vem do SERVIDOR (GET /api/leads →
  // business.name, resolvido na mesma unidade do contexto). Nada de usar o
  // `businessId` como se fosse nome — era isso que vazava para a mensagem.
  const [businessName, setBusinessName] = useState('');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [professionals, setProfessionals] = useState<ProfessionalItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // Modo de exibição: simples (empresa pequena) x completa (todas as etapas)
  const [simpleMode, setSimpleMode] = useState(false);

  // A1.2 · Bloco 2: administrar etapas é ação de configuração — o editor só
  // aparece quando o servidor confirma a permissão (canEditPipeline).
  const [canEditPipeline, setCanEditPipeline] = useState(false);
  const [showStagesPanel, setShowStagesPanel] = useState(false);

  // Filtros
  const [search, setSearch] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  // Modais
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [bookingLead, setBookingLead] = useState<Lead | null>(null);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);

  // Form states para agendamento
  const [bookServiceId, setBookServiceId] = useState('');
  const [bookProId, setBookProId] = useState('');
  const [bookDate, setBookDate] = useState(todayISO());
  const [bookTime, setBookTime] = useState('');
  const [bookNote, setBookNote] = useState('');
  const [bookSlots, setBookSlots] = useState<string[]>([]);
  const [bookingLoading, setBookingLoading] = useState(false);

  // Form states para novo lead manual
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadEmail, setNewLeadEmail] = useState('');
  const [newLeadInterest, setNewLeadInterest] = useState('');
  const [newLeadPriority, setNewLeadPriority] = useState<LeadPriority>('medium');
  const [newLeadAssignee, setNewLeadAssignee] = useState('');
  const [newLeadMessage, setNewLeadMessage] = useState('');
  const [savingNewLead, setSavingNewLead] = useState(false);

  // Observação rápida no modal
  const [newNoteText, setNewNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  // A3 — 360 extras (bookings/tasks/conversation preview)
  const [leadBookings, setLeadBookings] = useState<any[]>([]);
  const [leadTasks, setLeadTasks] = useState<any[]>([]);
  const [ctxTaskTitle, setCtxTaskTitle] = useState('');
  const [ctxTaskNote, setCtxTaskNote] = useState('');
  const [ctxTaskDueAt, setCtxTaskDueAt] = useState('');
  const [ctxTaskAssignee, setCtxTaskAssignee] = useState('');
  const [ctxTaskBusy, setCtxTaskBusy] = useState(false);
  // A3 drag-and-drop
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  // 1. Carrega leads, esteira e equipe
  const loadLeads = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await apiGet<{ leads: Lead[]; pipeline: BusinessPipeline; members: TeamMember[]; canEditPipeline?: boolean; business?: { id: string; name: string } | null }>(
        `/api/leads?businessId=${businessId}&limit=200`,
        { scope: 'area', area: 'Funil' },
      );
      if (!res.ok) setLoadError(res.message || 'Falha de conexão.');
      if (res.ok && res.data) {
        setLoadError('');
        setLeads(res.data.leads || []);
        setPipeline(res.data.pipeline || null);
        setMembers(res.data.members || []);
        setCanEditPipeline(res.data.canEditPipeline === true);
        // Só aceita o nome da MESMA unidade pedida (defesa em profundidade —
        // a resposta já vem escopada pelo guard do servidor).
        setBusinessName(res.data.business?.id === businessId ? (res.data.business.name || '') : '');
      }
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  // Carrega catálogo de serviços e profissionais para agendamento rápido
  const loadCatalog = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<{ services: ServiceItem[]; professionals: ProfessionalItem[] }>(
      `/api/catalog/get?businessId=${businessId}`,
      { scope: 'area', area: 'Funil' },
    );
    if (res.ok && res.data) {
      setServices(res.data.services || []);
      setProfessionals(res.data.professionals || []);
      if (res.data.services?.length) setBookServiceId(res.data.services[0].id);
    }
  }, [businessId]);

  useEffect(() => {
    loadLeads();
    loadCatalog();
  }, [loadLeads, loadCatalog]);

  // A3 — carrega 360 do lead selecionado (agendamentos e tarefas vinculadas)
  // Bookings via contrato administrativo correto (mode=manage, tenant-scoped, respeita permissão agenda)
  useEffect(() => {
    if (!selectedLead || !businessId) { setLeadBookings([]); setLeadTasks([]); return; }
    const sel = selectedLead;
    let cancel=false;
    async function load360(){
      try {
        const [bRes, tRes] = await Promise.all([
          apiGet<any>(`/api/bookings?businessId=${businessId}&mode=manage&limit=100`, { scope:'area', area:'Funil'}),
          apiGet<any>(`/api/tasks?businessId=${businessId}&status=all`, { scope:'area', area:'Funil'}),
        ]);
        if (cancel) return;
        if (bRes.ok && bRes.data) {
          const all = (bRes.data.bookings || bRes.data.items || []);
          const arr = Array.isArray(all)? all : [];
          // nunca usa contrato público (slots); apenas lista administrativa
          if (arr.length === 0 && (bRes.data as any).slots !== undefined) {
            // resposta pública inesperada — ignora para não exibir dado errado
            setLeadBookings([]);
          } else {
            const filtered = arr.filter((b:any)=> b.leadId===sel.id || (b.customerPhone && onlyDigits(b.customerPhone)===onlyDigits(sel.phone)) );
            setLeadBookings(filtered.slice(0,5));
          }
        } else {
          // sem permissão agenda → não exibe bookings (respeita permissão, não amplia)
          setLeadBookings([]);
        }
        if (tRes.ok && tRes.data) {
          const allT = (tRes.data.tasks || []);
          setLeadTasks(allT.filter((x:any)=> x.leadId===sel.id).slice(0,5));
        }
      } catch {}
    }
    load360();
    return ()=> {cancel=true};
  }, [selectedLead, businessId]);

  // Carrega slots livres quando data/serviço mudam no agendamento
  useEffect(() => {
    if (!businessId || !bookServiceId || !bookDate || !bookingLead) return;
    let cancel = false;
    async function fetchSlots() {
      const res = await apiGet<{ slots: string[] }>(
        `/api/bookings?mode=slots-admin&businessId=${businessId}&serviceId=${bookServiceId}&date=${bookDate}&professionalId=${bookProId}`,
        { scope: 'area', area: 'Agenda' },
      );
      if (!cancel && res.ok && res.data) {
        setBookSlots(res.data.slots || []);
      }
    }
    fetchSlots();
    return () => { cancel = true; };
  }, [businessId, bookServiceId, bookDate, bookProId, bookingLead]);

  // Estágios visíveis
  const visibleStages = useMemo(() => {
    if (!pipeline?.stages) return [];
    if (!simpleMode) return pipeline.stages;
    const simpleSet = new Set(['new', 'in_progress', 'scheduled', 'converted']);
    return pipeline.stages.filter((s) => simpleSet.has(s.id));
  }, [pipeline, simpleMode]);

  // Leads filtrados
  const filteredLeads = useMemo(() => {
    let list = leads;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.phone.includes(q) ||
          l.email?.toLowerCase().includes(q) ||
          l.interest?.toLowerCase().includes(q),
      );
    }
    if (filterUser) {
      if (filterUser === 'unassigned') {
        list = list.filter((l) => !l.assignedUserId);
      } else {
        list = list.filter((l) => l.assignedUserId === filterUser);
      }
    }
    if (filterPriority) {
      list = list.filter((l) => l.priority === filterPriority);
    }
    return list;
  }, [leads, search, filterUser, filterPriority]);

  // Agrupa leads por etapa — A1.2 · Bloco 2 (F3): a chave vem da leitura
  // NORMALIZADA (mesma função do servidor): etapa ausente/inválida nunca
  // deixa lead invisível; no modo simples, etapa fora do recorte cai na
  // primeira coluna visível (comportamento anterior, agora com chave válida).
  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const st of visibleStages) {
      map.set(st.id, []);
    }
    for (const l of filteredLeads) {
      const stageKey = pipeline ? normalizeLeadStageId(pipeline, l) : (l.stageId || l.status || 'new');
      if (map.has(stageKey)) {
        map.get(stageKey)!.push(l);
      } else if (map.has('in_progress')) {
        map.get('in_progress')!.push(l);
      } else if (visibleStages[0]) {
        map.get(visibleStages[0].id)!.push(l);
      }
    }
    return map;
  }, [filteredLeads, visibleStages, pipeline]);

  // Helper: abrir agendamento para lead (único caminho para `scheduled`)
  function openBookingForLead(lead: Lead | null | undefined) {
    if (!lead) return;
    setBookingLead(lead);
    if (services.length > 0 && !bookServiceId) setBookServiceId(services[0].id);
  }

  // Ação: Mover etapa do Lead — A3: otimista + rollback, idempotente, `scheduled` nunca manual
  async function handleMoveStage(leadId: string, toStageId: string, note?: string) {
    // A3.1: scheduled nunca via PATCH manual — abre fluxo de agendamento
    if (toStageId === 'scheduled') {
      const targetLead = leads.find((l)=> l.id===leadId) || selectedLead;
      // Não altera estado, apenas abre booking modal
      if (targetLead) openBookingForLead(targetLead as Lead);
      return;
    }
    const leadBefore = leads.find((l)=>l.id===leadId);
    const currentStage = leadBefore && pipeline ? normalizeLeadStageId(pipeline, leadBefore) : leadBefore?.stageId;
    if (currentStage === toStageId) return;
    // Otimista
    const prevLeads = leads;
    setLeads((prev) => prev.map((l)=> l.id===leadId ? { ...l, stageId: toStageId, lastInteraction: new Date().toISOString() } : l));
    if (selectedLead?.id === leadId) setSelectedLead((prev)=> prev? { ...prev, stageId: toStageId }: null);
    const res = await apiSend('/api/leads', 'PATCH', {
      businessId,
      id: leadId,
      stageId: toStageId,
      note,
    }, { scope: 'action', area: 'Funil' });
    if (res.ok) {
      setMsg('Etapa atualizada.');
      setTimeout(() => setMsg(''), 2500);
      loadLeads();
    } else {
      // rollback
      setLeads(prevLeads);
      if (selectedLead?.id === leadId && leadBefore) setSelectedLead(leadBefore);
      alert(res.message || 'Não foi possível mover etapa.');
    }
  }
  // Wrapper para selects que precisam interceptar scheduled
  function handleStageSelect(leadId: string, newStageId: string) {
    if (newStageId === 'scheduled') {
      const l = leads.find((x)=> x.id===leadId) || selectedLead;
      if (l) openBookingForLead(l as Lead);
      return;
    }
    handleMoveStage(leadId, newStageId);
  }

  // Ação: Atribuir responsável
  async function handleAssignUser(leadId: string, assignedUserId: string) {
    const res = await apiSend('/api/leads', 'PATCH', {
      businessId,
      id: leadId,
      assignedUserId,
    }, { scope: 'action', area: 'Funil' });

    if (res.ok) {
      setLeads((prev) =>
        prev.map((l) =>
          l.id === leadId
            ? { ...l, assignedUserId, lastInteraction: new Date().toISOString() }
            : l,
        ),
      );
      if (selectedLead?.id === leadId) {
        setSelectedLead((prev) => prev ? { ...prev, assignedUserId } : null);
      }
      loadLeads();
    }
  }

  // Ação: Alterar prioridade
  async function handleChangePriority(leadId: string, priority: LeadPriority) {
    const res = await apiSend('/api/leads', 'PATCH', {
      businessId,
      id: leadId,
      priority,
    }, { scope: 'action', area: 'Funil' });

    if (res.ok) {
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, priority } : l)),
      );
      if (selectedLead?.id === leadId) {
        setSelectedLead((prev) => prev ? { ...prev, priority } : null);
      }
    }
  }

  // Ação: Adicionar observação
  async function handleAddNote(leadId: string) {
    if (!newNoteText.trim()) return;
    setSavingNote(true);
    const res = await apiSend('/api/leads', 'PATCH', {
      businessId,
      id: leadId,
      noteText: newNoteText.trim(),
    }, { scope: 'action', area: 'Funil' });
    setSavingNote(false);

    if (res.ok) {
      setNewNoteText('');
      loadLeads();
    } else {
      alert(res.message || 'Erro ao adicionar observação.');
    }
  }

  // Ação: Confirmar agendamento a partir do Lead
  async function handleConfirmBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!bookingLead || !bookServiceId || !bookDate || !bookTime) {
      alert('Selecione serviço, dia e horário.');
      return;
    }

    setBookingLoading(true);
    try {
      const res = await apiSend(`/api/leads/${bookingLead.id}/book`, 'POST', {
        businessId,
        serviceId: bookServiceId,
        professionalId: bookProId || undefined,
        date: bookDate,
        time: bookTime,
        note: bookNote,
      }, { scope: 'action', area: 'Agenda' });

      if (res.ok) {
        setBookingLead(null);
        setBookTime('');
        setBookNote('');
        setMsg('Agendamento realizado com sucesso! O lead foi marcado como Agendado.');
        setTimeout(() => setMsg(''), 4000);
        loadLeads();
      } else {
        alert(res.message || 'Não foi possível confirmar o agendamento.');
      }
    } finally {
      setBookingLoading(false);
    }
  }

  // Ação: criar oportunidade manual
  async function handleCreateManualLead(e: React.FormEvent) {
    e.preventDefault();
    const digits = onlyDigits(newLeadPhone);
    if (!newLeadName.trim() && digits.length < 8 && !newLeadEmail.trim()) {
      alert('Informe ao menos nome, telefone ou e-mail.');
      return;
    }

    setSavingNewLead(true);
    try {
      const res = await apiSend('/api/leads/manual', 'POST', {
        businessId,
        name: newLeadName.trim(),
        phone: digits,
        email: newLeadEmail.trim(),
        interest: newLeadInterest.trim(),
        priority: newLeadPriority,
        assignedUserId: newLeadAssignee || undefined,
        message: newLeadMessage.trim() || undefined,
      }, { scope: 'action', area: 'Funil' });

      if (res.ok) {
        setShowNewLeadModal(false);
        setNewLeadName('');
        setNewLeadPhone('');
        setNewLeadEmail('');
        setNewLeadInterest('');
        setNewLeadMessage('');
        loadLeads();
      } else {
        alert(res.message || 'Erro ao criar lead.');
      }
    } finally {
      setSavingNewLead(false);
    }
  }

  const priorityBadge = (priority?: LeadPriority) => {
    switch (priority) {
      case 'urgent': return <span className="bg-[var(--danger)] text-white text-[10px] px-2 py-0.5 rounded-pill font-semibold uppercase tracking-wider shadow-xs">Urgente</span>;
      case 'high': return <span className="bg-[var(--warning-bg)] text-[var(--warning-fg)] border border-[var(--warning-border)] text-[10px] px-2 py-0.5 rounded-pill font-semibold uppercase tracking-wider">Alta</span>;
      case 'low': return <span className="bg-[var(--surface-3)] text-[var(--text-muted)] border border-[var(--border)] text-[10px] px-2 py-0.5 rounded-pill font-semibold uppercase tracking-wider">Baixa</span>;
      default: return null;
    }
  };

  /**
   * Ponto de cor da coluna (A3.3): cada etapa tem uma cor estável, e a coluna
   * inteira fica reconhecível sem depender só do nome. Mesma semântica de cor
   * do restante do produto (azul = novo, âmbar = em andamento, verde = ganho,
   * vermelho = perdido).
   */
  const stageToneDot = (stage: { id: string; color?: string }) => {
    switch (stage.id) {
      case 'new': return 'bg-[var(--info)]';
      case 'in_progress': return 'bg-[var(--warning)]';
      case 'qualifying': return 'bg-[var(--info)]';
      case 'qualified': return 'bg-[var(--success)]';
      case 'waiting_secretary': return 'bg-[var(--warning)]';
      case 'scheduled': return 'bg-[var(--brand)]';
      case 'converted': return 'bg-[var(--success-strong)]';
      case 'lost': return 'bg-[var(--danger)]';
      default: return 'bg-[var(--text-faint)]';
    }
  };

  const stageColorBadge = (stageId: string) => {
    switch (stageId) {
      case 'new': return 'border-[var(--info-border)] text-[var(--info-fg)] bg-[var(--info-bg)]';
      case 'in_progress': return 'border-[var(--warning-border)] text-[var(--warning-fg)] bg-[var(--warning-bg)]';
      case 'qualifying': return 'border-[var(--info-border)] text-[var(--info-fg)] bg-[var(--info-bg)]';
      case 'qualified': return 'border-[var(--success-border)] text-[var(--success-fg)] bg-[var(--success-bg)]';
      case 'waiting_secretary': return 'border-[var(--warning-border)] text-[var(--warning-fg)] bg-[var(--warning-bg)]';
      case 'scheduled': return 'border-[var(--info-border)] text-[var(--info-fg)] bg-[var(--info-bg)]';
      case 'converted': return 'border-[var(--success-border)] text-[var(--success-fg)] bg-[var(--success-bg)]';
      case 'lost': return 'border-[var(--danger-border)] text-[var(--danger-fg)] bg-[var(--danger-bg)]';
      default: return 'border-zinc-300 text-zinc-700 bg-zinc-50';
    }
  };

  if (loadError) return <AreaLoadError area="Funil" message={loadError} onRetry={loadLeads} />;
  return (
    <div className="space-y-4">
      {msg && <Notice tone="success" className="mb-1">{msg}</Notice>}

      {/* Barra de Ações e Filtros */}
      <div className="ws-panel p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          {/* DS 1.0 · §21 — busca é o SearchField canônico (não um <input> com
              contorno e raio próprios desta tela). */}
          <SearchField
            value={search}
            onChange={setSearch}
            label="Buscar oportunidades"
            placeholder="Buscar por nome, telefone ou interesse…"
            className="w-full sm:w-64"
          />

          {/* A largura vai no WRAPPER: o controle do DS é `w-full` de propósito
              (ocupa o campo do Field) e não deve ser sobrescrito por classe. */}
          <div className="w-full sm:w-56">
            <Select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              aria-label="Filtrar por responsável"
            >
              <option value="">Todos os responsáveis</option>
              <option value="unassigned">Sem responsável</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name} ({m.role})</option>
              ))}
            </Select>
          </div>

          <div className="w-full sm:w-48">
          <Select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            aria-label="Filtrar por prioridade"
          >
            <option value="">Todas prioridades</option>
            <option value="urgent">Urgente</option>
            <option value="high">Alta</option>
            <option value="medium">Média</option>
            <option value="low">Baixa</option>
          </Select>
          </div>
        </div>

        {/* DS 1.0 · §12/§26 — no celular a barra de ações ocupa a própria linha e
            QUEBRA: sem isto o CTA primário ("Nova oportunidade") saía cortado
            aos 390px (medido em browser real). */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {/* Alternar modo simples / completo — botão do DS (secondary), com a
              seleção anunciada por aria-pressed em vez de repintar de acento. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setSimpleMode(!simpleMode)}
            aria-pressed={simpleMode}
            title="Modo simplificado para profissional autônomo ou enxuto"
          >
            {simpleMode ? 'Modo simplificado' : 'Modo completo'}
          </Button>

          {/* A1.2 · Bloco 2: administração das etapas da MESMA máquina usada
              pelo backend (PATCH /api/pipeline). Só aparece com permissão de
              configuração confirmada pelo servidor (canEditPipeline). */}
          {canEditPipeline && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowStagesPanel(true)}>
              Configurar etapas
            </Button>
          )}

          {/* UMA PRIMARY por superfície (§3): a criação de oportunidade. */}
          <Button type="button" onClick={() => setShowNewLeadModal(true)}>
            Nova oportunidade
          </Button>
        </div>
      </div>

      {/* Quadro Kanban do Funil */}
      {loading ? (
        <div className="p-12 text-center text-[var(--text-muted)] text-sm font-semibold">Carregando oportunidades…</div>
      ) : (
        <div className="grid grid-flow-col auto-cols-[280px] sm:auto-cols-[300px] gap-3.5 overflow-x-auto pb-4 scrollbar-none items-start">
          {visibleStages.map((stage) => {
            const stageLeads = leadsByStage.get(stage.id) || [];
            return (
              <div
                key={stage.id}
                onDragOver={(e)=>{e.preventDefault(); setDragOverStage(stage.id);}}
                onDragLeave={()=> setDragOverStage((prev)=> prev===stage.id? null: prev)}
                onDrop={(e)=>{e.preventDefault(); if (dragLeadId) { if (stage.id==='scheduled') { const l = leads.find((x)=> x.id===dragLeadId); if (l) openBookingForLead(l); } else handleMoveStage(dragLeadId, stage.id); } setDragLeadId(null); setDragOverStage(null);}}
                className={cn(
                  'rounded-xl p-3 flex flex-col max-h-[78vh] flex-shrink-0 border transition-[box-shadow,border-color,background-color]',
                  dragOverStage === stage.id
                    // Destino do arraste: verde = pode soltar aqui (regra não mudou).
                    ? 'bg-[var(--success-bg)] border-[var(--success)] shadow-md'
                    : 'bg-[var(--surface-3)] border-[var(--border)]',
                )}
              >
                {/* Cabeçalho da coluna */}
                <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span aria-hidden="true" className={cn('w-2.5 h-2.5 rounded-full shrink-0', stageToneDot(stage))} />
                    <span className="font-semibold text-xs text-[var(--text)] uppercase tracking-wide truncate">
                      {stage.name}
                    </span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white border border-[var(--border)] text-[var(--text-muted)] tabular-nums">
                      {stageLeads.length}
                    </span>
                  </div>
                </div>

                {/* Lista de cards */}
                <div className="space-y-2.5 overflow-y-auto pr-1 flex-1">
                  {stageLeads.length === 0 ? (
                    <div className="py-6 text-center text-[var(--text-faint)] text-xs font-medium">
                      Nenhuma oportunidade nesta etapa
                    </div>
                  ) : (
                    stageLeads.map((lead) => {
                      const assignee = members.find((m) => m.userId === lead.assignedUserId);
                      return (
                        <div
                          key={lead.id}
                          draggable
                          onDragStart={()=> setDragLeadId(lead.id)}
                          onDragEnd={()=> {setDragLeadId(null); setDragOverStage(null);}}
                          className={cn(
                            'bg-white border rounded-xl p-3.5 shadow-sm transition hover:shadow-md hover:border-[var(--brand-border)] cursor-grab active:cursor-grabbing space-y-2.5',
                            dragLeadId === lead.id ? 'il-dragging border-[var(--brand)]' : 'border-[var(--border)]',
                          )}
                          onClick={() => setSelectedLead(lead)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-sm text-[var(--text)] leading-snug">
                                {lead.name || 'Sem nome informado'}
                              </p>
                              {lead.phone && (
                                <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">
                                  {lead.phone}
                                </p>
                              )}
                            </div>
                            {priorityBadge(lead.priority)}
                          </div>

                          {lead.interest && (
                            <p className="text-xs text-[var(--text)] bg-[var(--surface-3)] p-1.5 rounded-md border border-[var(--border-soft)] line-clamp-2">
                              {lead.interest}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center justify-between text-[11px] text-[var(--text-muted)] pt-1.5 border-t border-[var(--border-soft)] gap-1.5">
                            <span className="bg-[var(--surface-3)] border border-[var(--border)] px-2 py-0.5 rounded-pill text-[var(--text-muted)] font-semibold">
                              {leadOriginLabel(lead.origin)}
                            </span>

                            {assignee ? (
                              <span className="text-[var(--text)] font-semibold inline-flex items-center gap-1" title={`Responsável: ${assignee.name}`}>
                                <span aria-hidden="true" className="w-4 h-4 rounded-full bg-[var(--brand-soft)] text-[var(--brand-fg)] text-[9px] font-semibold inline-flex items-center justify-center">
                                  {assignee.name.trim().slice(0, 1).toUpperCase()}
                                </span>
                                {assignee.name}
                              </span>
                            ) : (
                              <span className="text-[var(--text-faint)]">Sem responsável</span>
                            )}
                          </div>

                          {/* Mover para (mobile) */}
                          <div className="sm:hidden" onClick={(e)=>e.stopPropagation()}>
                            <label className="il-type-label text-[var(--gd-text-muted)]">Mover para…</label>
                            <Select
                              value={pipeline ? normalizeLeadStageId(pipeline, lead) : lead.stageId}
                              onChange={(e) => handleStageSelect(lead.id, e.target.value)}
                              aria-label="Mover oportunidade para outra etapa"
                              className="mt-1"
                            >
                              {(pipeline?.stages||[]).map((s)=> <option key={s.id} value={s.id}>{s.name}</option>)}
                            </Select>
                          </div>
                          {/* Ações Rápidas no Card */}
                          <div
                            className="pt-1.5 flex items-center justify-between gap-1.5 border-t border-[var(--border-soft)] text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {lead.phone && (
                              <a
                                href={waLink(lead.phone, `Olá ${lead.name || ''}, tudo bem? Sou da equipe da ${businessName || 'empresa'}.`)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={buttonCls('secondary', 'sm')}
                              >
                                WhatsApp
                              </a>
                            )}

                            <div className="flex items-center gap-1.5">
                              {/* Encaminhar é aviso operacional: warning SOFT. */}
                              {stage.id !== 'waiting_secretary' && (
                                <button
                                  type="button"
                                  onClick={() => handleMoveStage(lead.id, 'waiting_secretary', 'Encaminhado para secretaria')}
                                  title="Encaminhar atendimento para a secretaria"
                                  className={buttonCls('warning', 'sm')}
                                >
                                  Secretaria
                                </button>
                              )}

                              {/* Ação de avanço do card — secundária (a PRIMARY
                                  da superfície é criar oportunidade). */}
                              <button
                                type="button"
                                onClick={() => {
                                  setBookingLead(lead);
                                  if (services.length > 0) setBookServiceId(services[0].id);
                                }}
                                className={buttonCls('secondary', 'sm')}
                              >
                                Agendar
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DS 1.0 · §43 — o detalhe da oportunidade é o Dialog CANÔNICO: o X é
          o CloseButton neutro do sistema, o foco fica contido, Escape e
          backdrop respeitam a guarda de descarte e a rolagem é interna. Antes
          era um modal artesanal com ✕ próprio e cartões cinza empilhados. */}
      <Dialog
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        title={selectedLead?.name || 'Oportunidade sem nome'}
        subtitle={selectedLead ? `Origem: ${leadOriginLabel(selectedLead.origin)} · Entrada: ${formatDateTime(selectedLead.createdAt)}` : ''}
        width="720px"
      >
        {selectedLead && (
          <div className="space-y-5">
            {/* Dados de contato — rótulo/valor, sem caixa em volta */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="il-type-label block text-[var(--gd-text-muted)]">WhatsApp</span>
                <span className="tabular-nums font-medium">{selectedLead.phone || 'Não informado'}</span>
                {selectedLead.phone && (
                  <a
                    href={waLink(selectedLead.phone, 'Olá, tudo bem?')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs font-semibold text-[var(--gd-info-fg)] hover:underline"
                  >
                    Abrir conversa no WhatsApp →
                  </a>
                )}
              </div>
              <div>
                <span className="il-type-label block text-[var(--gd-text-muted)]">E-mail</span>
                <span>{selectedLead.email || 'Não informado'}</span>
              </div>
              {selectedLead.sourceUrl && (
                <div className="sm:col-span-2">
                  <span className="il-type-label block text-[var(--gd-text-muted)]">URL de origem</span>
                  <a href={selectedLead.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-[var(--gd-info-fg)] hover:underline">
                    {selectedLead.sourceUrl}
                  </a>
                </div>
              )}
            </div>

            {/* Etapa · responsável · prioridade (Field canônico) */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Etapa atual">
                <Select
                  value={pipeline ? normalizeLeadStageId(pipeline, selectedLead) : (selectedLead.stageId || 'new')}
                  onChange={(e) => handleStageSelect(selectedLead.id, e.target.value)}
                  aria-label="Etapa atual"
                >
                  {pipeline?.stages.map((st) => (
                    <option key={st.id} value={st.id}>{st.name}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Responsável">
                <Select
                  value={selectedLead.assignedUserId || ''}
                  onChange={(e) => handleAssignUser(selectedLead.id, e.target.value)}
                  aria-label="Responsável"
                >
                  <option value="">Sem responsável</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Prioridade">
                <Select
                  value={selectedLead.priority || 'medium'}
                  onChange={(e) => handleChangePriority(selectedLead.id, e.target.value as LeadPriority)}
                  aria-label="Prioridade"
                >
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </Select>
              </Field>
            </div>

            {/* Ações diretas — semântica do §3: agendar é a ação primária,
                encaminhar para a secretaria é aviso operacional (warning soft). */}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  setBookingLead(selectedLead);
                  if (services.length > 0) setBookServiceId(services[0].id);
                }}
              >
                Agendar atendimento
              </Button>
              <Button
                type="button"
                variant="warning"
                onClick={() => handleMoveStage(selectedLead.id, 'waiting_secretary', 'Encaminhado para secretaria')}
              >
                Aguardando secretaria
              </Button>
            </div>

            {/* Observações da equipe (append-only) */}
            <div className="space-y-3 border-t border-[var(--gd-border-soft)] pt-4">
              <h3 className="il-type-section font-semibold text-[var(--gd-text)]">Observações da equipe</h3>

              <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
                {(!selectedLead.notes || selectedLead.notes.length === 0) ? (
                  <p className="text-xs italic text-[var(--gd-text-faint)]">Nenhuma observação registrada.</p>
                ) : (
                  selectedLead.notes.map((n) => (
                    <div key={n.id} className="space-y-1 border-l-2 border-[var(--gd-border-soft)] pl-3 text-xs">
                      <div className="flex justify-between text-[11px] text-[var(--gd-text-muted)]">
                        <span className="font-semibold text-[var(--gd-text)]">{n.byName || 'Membro'}</span>
                        <span className="tabular-nums">{formatDateTime(n.at)}</span>
                      </div>
                      <p className="text-[var(--gd-text)]">{n.text}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Escrever observação interna…"
                  aria-label="Nova observação interna"
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={savingNote || !newNoteText.trim()}
                  onClick={() => handleAddNote(selectedLead.id)}
                >
                  Salvar
                </Button>
              </div>
            </div>

            {/* Histórico de movimentação */}
            {selectedLead.stageHistory && selectedLead.stageHistory.length > 0 && (
              <div className="space-y-2 border-t border-[var(--gd-border-soft)] pt-4">
                <h3 className="il-type-section font-semibold text-[var(--gd-text)]">Histórico de movimentação</h3>
                <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                  {selectedLead.stageHistory.map((h) => (
                    <div key={h.id} className="flex items-start gap-2 text-[11px] text-[var(--gd-text-muted)]">
                      <span className="tabular-nums whitespace-nowrap">
                        {h.at.slice(11, 16)} · {h.at.slice(8, 10)}/{h.at.slice(5, 7)}
                      </span>
                      <span>
                        <strong className="text-[var(--gd-text)]">{h.movedByName || 'Sistema'}</strong>: {h.fromStage ? `de ${h.fromStage} para ` : ''}<strong className="text-[var(--gd-text)]">{h.toStage}</strong>
                        {h.note && <span className="italic"> ({h.note})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 360 — agendamentos e pendências vinculadas */}
            <div className="space-y-3 border-t border-[var(--gd-border-soft)] pt-4">
              <h3 className="il-type-section font-semibold text-[var(--gd-text)]">Visão 360 — atendimentos e pendências</h3>
              {leadBookings.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold">Agendamentos ({leadBookings.length})</p>
                  {leadBookings.map((b: any) => (
                    <div key={b.id} className="flex items-center justify-between gap-2 border-b border-[var(--gd-border-soft)] py-1.5 text-xs last:border-0">
                      <span className="tabular-nums font-medium">{b.date} {b.time} · {b.status}</span>
                      <Link href={`/agenda?b=${businessId}&data=${b.date}`} className="text-[11px] text-[var(--gd-text-muted)] underline">Ver agenda</Link>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--gd-text-muted)]">Nenhum agendamento vinculado.</p>
              )}

              <div className="space-y-1.5">
                <p className="text-xs font-semibold">Pendências ({leadTasks.length})</p>
                {leadTasks.length > 0 ? leadTasks.map((tt: any) => (
                  <div key={tt.id} className="flex items-center justify-between gap-2 border-b border-[var(--gd-border-soft)] py-1.5 text-xs last:border-0">
                    <span className="font-medium">{tt.title} · {tt.status}</span>
                    <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-[var(--gd-text-muted)]">
                      {tt.dueLabel || tt.dueAt || ''}
                      {tt.leadId && <Link href={`/funil?b=${businessId}#${tt.leadId}`} className="underline">Funil</Link>}
                      {tt.bookingId && <Link href={`/agenda?b=${businessId}`} className="underline">Agenda</Link>}
                    </span>
                  </div>
                )) : <p className="text-xs text-[var(--gd-text-faint)]">Nenhuma pendência vinculada.</p>}

                {/* Nova pendência contextual (sem digitar leadId) */}
                <div className="space-y-2 border-t border-[var(--gd-border-soft)] pt-3">
                  <p className="text-xs font-semibold">Nova pendência para esta oportunidade</p>
                  <Field label="Título">
                    <Input value={ctxTaskTitle} onChange={(e) => setCtxTaskTitle(e.target.value)} placeholder="Ex: retornar ligação" />
                  </Field>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Field label="Prazo">
                      <Input value={ctxTaskDueAt} onChange={(e) => setCtxTaskDueAt(e.target.value)} placeholder="AAAA-MM-DD" />
                    </Field>
                    <Field label="Responsável">
                      <Select value={ctxTaskAssignee} onChange={(e) => setCtxTaskAssignee(e.target.value)} aria-label="Responsável da pendência">
                        <option value="">Sem responsável</option>
                        {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Nota (opcional)">
                    <Input value={ctxTaskNote} onChange={(e) => setCtxTaskNote(e.target.value)} placeholder="Contexto para quem for executar" />
                  </Field>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={ctxTaskBusy || !ctxTaskTitle.trim()}
                    onClick={async () => {
                      if (!ctxTaskTitle.trim()) return;
                      setCtxTaskBusy(true);
                      const res = await apiSend('/api/tasks', 'POST', { businessId, title: ctxTaskTitle.trim(), note: ctxTaskNote.trim(), dueAt: ctxTaskDueAt.trim(), assignedUserId: ctxTaskAssignee, leadId: selectedLead.id });
                      setCtxTaskBusy(false);
                      if (res.ok) {
                        setCtxTaskTitle(''); setCtxTaskNote(''); setCtxTaskDueAt(''); setCtxTaskAssignee('');
                        // recarrega tasks do lead
                        try {
                          const tRes = await apiGet<any>(`/api/tasks?businessId=${businessId}&status=all`, { scope: 'area', area: 'Funil' });
                          if (tRes.ok) setLeadTasks((tRes.data.tasks || []).filter((x: any) => x.leadId === selectedLead.id).slice(0, 5));
                        } catch {}
                      } else alert(res.message || 'Erro ao criar tarefa');
                    }}
                  >
                    Criar pendência
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="button" size="sm" variant="secondary" onClick={() => openBookingForLead(selectedLead)}>Agendar atendimento</Button>
                {selectedLead.phone && <Link href={`/conversas?b=${businessId}&q=${encodeURIComponent(selectedLead.phone)}`} className="il-control il-control--sm inline-flex items-center rounded-sm border border-[var(--gd-border)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--gd-text)] hover:bg-[var(--gd-bg-hover)]">Abrir no inbox</Link>}
                {selectedLead.phone && <a href={waLink(selectedLead.phone, `Olá ${selectedLead.name || ''}, tudo bem?`)} target="_blank" rel="noopener noreferrer" className="il-control il-control--sm inline-flex items-center rounded-sm border border-[var(--gd-border)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--gd-text)] hover:bg-[var(--gd-bg-hover)]">WhatsApp</a>}
                <Link href={`/clientes?b=${businessId}&q=${encodeURIComponent(selectedLead.phone || selectedLead.name || '')}`} className="text-xs font-medium text-[var(--gd-text-muted)] underline">Ver cliente no CRM 360 →</Link>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      {/* DS 1.0 · §43 — agendar a partir da oportunidade usa o MESMO Dialog
          canônico (e o MESMO Select/Field), em vez de um terceiro modal próprio. */}
      <Dialog
        open={!!bookingLead}
        onClose={() => setBookingLead(null)}
        title={bookingLead ? `Agendar para ${bookingLead.name}` : 'Agendar atendimento'}
        subtitle={bookingLead?.phone ? `WhatsApp: ${bookingLead.phone}` : undefined}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setBookingLead(null)} disabled={bookingLoading}>Cancelar</Button>
            <Button type="submit" form="lead-booking-form" disabled={bookingLoading || !bookTime}>
              {bookingLoading ? 'Criando agendamento…' : 'Confirmar e marcar agendado'}
            </Button>
          </>
        }
      >
        <form id="lead-booking-form" onSubmit={handleConfirmBooking} className="space-y-3.5">
          <Field label="Serviço" required>
            <Select
              value={bookServiceId}
              onChange={(e) => setBookServiceId(e.target.value)}
              aria-label="Serviço"
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min - {money(s.price)})</option>
              ))}
            </Select>
          </Field>

          {professionals.length > 1 && (
            <Field label="Profissional">
              <Select value={bookProId} onChange={(e) => setBookProId(e.target.value)} aria-label="Profissional">
                <option value="">Automático (menor carga)</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Data" required>
            <Input type="date" value={bookDate} min={todayISO()} onChange={(e) => setBookDate(e.target.value)} aria-label="Data" />
          </Field>

          <div>
            <span className="il-type-label block text-[var(--gd-text-muted)]">Horário *</span>
            {bookSlots.length === 0 ? (
              <Notice tone="warning" className="mt-1.5">Nenhum horário livre nesta data.</Notice>
            ) : (
              <div className="mt-1.5 grid max-h-32 grid-cols-4 gap-1.5 overflow-y-auto">
                {bookSlots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBookTime(s)}
                    aria-pressed={bookTime === s}
                    className={cn(
                      'tabular-nums rounded-sm border px-1.5 py-1.5 text-xs font-semibold transition-colors',
                      bookTime === s
                        ? 'border-[var(--gd-accent-border)] bg-[var(--gd-accent-soft)] text-[var(--gd-accent-fg)]'
                        : 'border-[var(--gd-border)] bg-[var(--gd-bg-surface)] text-[var(--gd-text)] hover:bg-[var(--gd-bg-hover)]',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Field label="Observações internas">
            <Textarea
              rows={2}
              value={bookNote}
              onChange={(e) => setBookNote(e.target.value)}
              placeholder="Ex: primeira consulta indicada pelo Instagram"
            />
          </Field>
        </form>
      </Dialog>

      {/* DS 1.0 · §4/§43 — o cadastro rápido de oportunidade é o Dialog
          CANÔNICO: foco contido, Escape/backdrop com guarda de descarte, X
          neutro do sistema e rodapé com UMA ação preenchida. Antes era um
          modal artesanal (camada própria + ✕ próprio + botão próprio). */}
      <Dialog
        open={showNewLeadModal}
        onClose={() => setShowNewLeadModal(false)}
        title="Nova oportunidade"
        subtitle="O cadastro cria a oportunidade na primeira etapa do funil."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setShowNewLeadModal(false)} disabled={savingNewLead}>Cancelar</Button>
            <Button type="submit" form="new-lead-form" disabled={savingNewLead}>
              {savingNewLead ? 'Salvando…' : 'Criar oportunidade'}
            </Button>
          </>
        }
      >
        <form id="new-lead-form" onSubmit={handleCreateManualLead} className="space-y-3.5">
          <Field label="Nome">
            <Input
              type="text"
              placeholder="Ex: Mariana Costa"
              value={newLeadName}
              onChange={(e) => setNewLeadName(e.target.value)}
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="WhatsApp">
              <PhoneBRInput value={newLeadPhone} onChange={setNewLeadPhone} placeholder="(11) 99999-9999" />
            </Field>
            <Field label="E-mail">
              <Input
                type="email"
                placeholder="mariana@email.com"
                value={newLeadEmail}
                onChange={(e) => setNewLeadEmail(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Interesse / serviço">
            <Input
              type="text"
              placeholder="Ex: avaliação inicial ou procedimento X"
              value={newLeadInterest}
              onChange={(e) => setNewLeadInterest(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Prioridade">
              <Select
                value={newLeadPriority}
                onChange={(e) => setNewLeadPriority(e.target.value as LeadPriority)}
                aria-label="Prioridade"
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </Select>
            </Field>

            <Field label="Responsável">
              <Select
                value={newLeadAssignee}
                onChange={(e) => setNewLeadAssignee(e.target.value)}
                aria-label="Responsável"
              >
                <option value="">Sem responsável</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Observações iniciais">
            <Textarea
              rows={2}
              placeholder="Detalhes adicionais sobre o contato…"
              value={newLeadMessage}
              onChange={(e) => setNewLeadMessage(e.target.value)}
            />
          </Field>
        </form>
      </Dialog>

      {/* ── A1.2 · Bloco 2 — administração das etapas do funil ──
          A MESMA máquina de estados do backend (PipelineStage): renomear,
          reordenar, marcar etapa final, criar e remover etapas. Salva via
          PATCH /api/pipeline (permissão 'config' no servidor). */}
      {showStagesPanel && pipeline && (
        <PipelineStagesPanel
          businessId={businessId}
          pipeline={pipeline}
          onClose={() => setShowStagesPanel(false)}
          onSaved={() => { setShowStagesPanel(false); loadLeads(); }}
        />
      )}
    </div>
  );
}
