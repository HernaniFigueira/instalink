'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Lead, PipelineStage, BusinessPipeline, LeadPriority } from '@/lib/types';
import { leadOriginLabel } from '@/lib/leads';
import { onlyDigits, waLink, cn, money } from '@/lib/utils';
import { todayISO, addDaysISO } from '@/lib/tz';
import { apiGet, apiSend } from '@/lib/api-client';

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
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [professionals, setProfessionals] = useState<ProfessionalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  // Modo de exibição: simples (empresa pequena) x completa (todas as etapas)
  const [simpleMode, setSimpleMode] = useState(false);

  // Filtros
  const [search, setSearch] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  // Modais
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [bookingLead, setBookingLead] = useState<Lead | null>(null);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);

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

  // 1. Carrega leads, esteira e equipe
  const loadLeads = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await apiGet<{ leads: Lead[]; pipeline: BusinessPipeline; members: TeamMember[] }>(
        `/api/leads?businessId=${businessId}&limit=200`,
        { scope: 'area', area: 'Clientes' },
      );
      if (res.ok && res.data) {
        setLeads(res.data.leads || []);
        setPipeline(res.data.pipeline || null);
        setMembers(res.data.members || []);
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
      { scope: 'area', area: 'Clientes' },
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

  // Carrega slots livres quando data/serviço mudam no agendamento
  useEffect(() => {
    if (!businessId || !bookServiceId || !bookDate || !bookingLead) return;
    let cancel = false;
    async function fetchSlots() {
      const res = await apiGet<{ slots: string[] }>(
        `/api/bookings?businessId=${businessId}&serviceId=${bookServiceId}&date=${bookDate}&professionalId=${bookProId}`,
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

  // Agrupa leads por estágio
  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const st of visibleStages) {
      map.set(st.id, []);
    }
    for (const l of filteredLeads) {
      const stageKey = l.stageId || l.status || 'new';
      if (map.has(stageKey)) {
        map.get(stageKey)!.push(l);
      } else if (map.has('in_progress')) {
        map.get('in_progress')!.push(l);
      } else if (visibleStages[0]) {
        map.get(visibleStages[0].id)!.push(l);
      }
    }
    return map;
  }, [filteredLeads, visibleStages]);

  // Ação: Mover etapa do Lead
  async function handleMoveStage(leadId: string, toStageId: string, note?: string) {
    const res = await apiSend('/api/leads', 'PATCH', {
      businessId,
      id: leadId,
      stageId: toStageId,
      note,
    }, { scope: 'action', area: 'Clientes' });

    if (res.ok) {
      setLeads((prev) =>
        prev.map((l) =>
          l.id === leadId
            ? { ...l, stageId: toStageId, lastInteraction: new Date().toISOString() }
            : l,
        ),
      );
      if (selectedLead?.id === leadId) {
        setSelectedLead((prev) => prev ? { ...prev, stageId: toStageId } : null);
      }
      setMsg('Etapa atualizada.');
      setTimeout(() => setMsg(''), 2500);
      loadLeads(); // recarrega histórico completo
    } else {
      alert(res.message || 'Não foi possível mover etapa.');
    }
  }

  // Ação: Atribuir responsável
  async function handleAssignUser(leadId: string, assignedUserId: string) {
    const res = await apiSend('/api/leads', 'PATCH', {
      businessId,
      id: leadId,
      assignedUserId,
    }, { scope: 'action', area: 'Clientes' });

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
    }, { scope: 'action', area: 'Clientes' });

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
    }, { scope: 'action', area: 'Clientes' });
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

  // Ação: Criar lead manual
  async function handleCreateManualLead(e: React.FormEvent) {
    e.preventDefault();
    const digits = onlyDigits(newLeadPhone);
    if (!newLeadName.trim() && digits.length < 8 && !newLeadEmail.trim()) {
      alert('Informe ao menos nome, telefone ou e-mail.');
      return;
    }

    setSavingNewLead(true);
    try {
      const res = await apiSend('/api/leads', 'POST', {
        businessId,
        name: newLeadName.trim(),
        phone: digits,
        email: newLeadEmail.trim(),
        interest: newLeadInterest.trim(),
        origin: 'manual',
        priority: newLeadPriority,
        assignedUserId: newLeadAssignee || undefined,
        message: newLeadMessage.trim() || undefined,
      }, { scope: 'action', area: 'Clientes' });

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
      case 'urgent': return <span className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Urgente</span>;
      case 'high': return <span className="bg-orange-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Alta</span>;
      case 'low': return <span className="bg-zinc-200 text-zinc-700 text-[10px] px-1.5 py-0.5 rounded font-semibold">Baixa</span>;
      default: return null;
    }
  };

  const stageColorBadge = (stageId: string) => {
    switch (stageId) {
      case 'new': return 'border-blue-300 text-blue-700 bg-blue-50';
      case 'in_progress': return 'border-amber-300 text-amber-700 bg-amber-50';
      case 'qualifying': return 'border-purple-300 text-purple-700 bg-purple-50';
      case 'qualified': return 'border-emerald-300 text-emerald-700 bg-emerald-50';
      case 'waiting_secretary': return 'border-orange-300 text-orange-700 bg-orange-50';
      case 'scheduled': return 'border-emerald-300 text-emerald-700 bg-emerald-50';
      case 'converted': return 'border-emerald-400 text-emerald-800 bg-emerald-100';
      case 'lost': return 'border-red-300 text-red-700 bg-red-50';
      default: return 'border-zinc-300 text-zinc-700 bg-zinc-50';
    }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className="p-3 bg-zinc-900 text-white rounded-lg text-sm font-medium animate-fadeIn">
          {msg}
        </div>
      )}

      {/* Barra de Ações e Filtros */}
      <div className="bg-white border border-zinc-200 rounded-xl p-3 sm:p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou interesse…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-900 w-full sm:w-64"
          />

          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 bg-white text-zinc-700 focus:outline-none"
          >
            <option value="">Todos os responsáveis</option>
            <option value="unassigned">Sem responsável</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name} ({m.role})</option>
            ))}
          </select>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-zinc-300 bg-white text-zinc-700 focus:outline-none"
          >
            <option value="">Todas prioridades</option>
            <option value="urgent">Urgente</option>
            <option value="high">Alta</option>
            <option value="medium">Média</option>
            <option value="low">Baixa</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          {/* Alternar modo simples / completo */}
          <button
            type="button"
            onClick={() => setSimpleMode(!simpleMode)}
            className={cn(
              'px-3 py-1.5 text-xs font-semibold rounded-lg border transition',
              simpleMode
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50',
            )}
            title="Modo simplificado para profissional autônomo ou enxuto"
          >
            {simpleMode ? 'Modo Simplificado' : 'Modo Completo'}
          </button>

          <button
            type="button"
            onClick={() => setShowNewLeadModal(true)}
            className="px-3 py-1.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 transition flex items-center gap-1.5"
          >
            <span>+</span> Novo Lead
          </button>
        </div>
      </div>

      {/* Quadro Kanban da Esteira */}
      {loading ? (
        <div className="p-12 text-center text-zinc-400 text-sm">Carregando esteira operacional…</div>
      ) : (
        <div className="grid grid-flow-col auto-cols-[280px] sm:auto-cols-[300px] gap-3.5 overflow-x-auto pb-4 scrollbar-none items-start">
          {visibleStages.map((stage) => {
            const stageLeads = leadsByStage.get(stage.id) || [];
            return (
              <div
                key={stage.id}
                className="bg-zinc-100/80 border border-zinc-200 rounded-xl p-3 flex flex-col max-h-[78vh] flex-shrink-0"
              >
                {/* Cabeçalho da coluna */}
                <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-zinc-200/80">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-zinc-900 uppercase tracking-wide">
                      {stage.name}
                    </span>
                    <span className="text-[11px] font-bold px-1.5 py-0.2 rounded-full bg-zinc-200 text-zinc-700">
                      {stageLeads.length}
                    </span>
                  </div>
                </div>

                {/* Lista de cards */}
                <div className="space-y-2.5 overflow-y-auto pr-1 flex-1">
                  {stageLeads.length === 0 ? (
                    <div className="py-6 text-center text-zinc-400 text-xs italic">
                      Nenhum lead nesta etapa
                    </div>
                  ) : (
                    stageLeads.map((lead) => {
                      const assignee = members.find((m) => m.userId === lead.assignedUserId);
                      return (
                        <div
                          key={lead.id}
                          className="bg-white border border-zinc-200 hover:border-zinc-300 rounded-xl p-3.5 shadow-sm transition hover:shadow cursor-pointer space-y-2.5"
                          onClick={() => setSelectedLead(lead)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-bold text-sm text-zinc-900 leading-snug">
                                {lead.name || 'Sem nome informado'}
                              </p>
                              {lead.phone && (
                                <p className="text-xs text-zinc-500 font-mono mt-0.5">
                                  {lead.phone}
                                </p>
                              )}
                            </div>
                            {priorityBadge(lead.priority)}
                          </div>

                          {lead.interest && (
                            <p className="text-xs text-zinc-700 bg-zinc-50 p-1.5 rounded border border-zinc-100 line-clamp-2">
                              {lead.interest}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center justify-between text-[11px] text-zinc-500 pt-1 border-t border-zinc-100 gap-1.5">
                            <span className="bg-zinc-100 px-2 py-0.5 rounded text-zinc-600 font-medium">
                              {leadOriginLabel(lead.origin)}
                            </span>

                            {assignee ? (
                              <span className="text-zinc-600 font-semibold" title={`Responsável: ${assignee.name}`}>
                                👤 {assignee.name}
                              </span>
                            ) : (
                              <span className="text-zinc-400">Sem responsável</span>
                            )}
                          </div>

                          {/* Ações Rápidas no Card */}
                          <div
                            className="pt-1 flex items-center justify-between gap-1 border-t border-zinc-100 text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {lead.phone && (
                              <a
                                href={waLink(lead.phone, `Olá ${lead.name || ''}, tudo bem? Sou da equipe da ${pipeline?.businessId || 'empresa'}.`)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-emerald-700 hover:underline font-semibold flex items-center gap-1"
                              >
                                WhatsApp
                              </a>
                            )}

                            <div className="flex items-center gap-1.5">
                              {/* Botão Aguardando Secretaria */}
                              {stage.id !== 'waiting_secretary' && (
                                <button
                                  type="button"
                                  onClick={() => handleMoveStage(lead.id, 'waiting_secretary', 'Encaminhado para secretaria')}
                                  title="Encaminhar atendimento para a secretaria"
                                  className="text-[11px] px-2 py-1 rounded bg-orange-50 text-orange-700 border border-orange-200 font-medium hover:bg-orange-100"
                                >
                                  Secretaria
                                </button>
                              )}

                              {/* Botão Agendar */}
                              <button
                                type="button"
                                onClick={() => {
                                  setBookingLead(lead);
                                  if (services.length > 0) setBookServiceId(services[0].id);
                                }}
                                className="text-[11px] px-2 py-1 rounded bg-zinc-900 text-white font-medium hover:bg-zinc-800"
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

      {/* ── Modal Detalhes do Lead ── */}
      {selectedLead && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-xl animate-scaleUp">
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <h2 className="text-lg font-bold text-zinc-900">{selectedLead.name || 'Lead sem nome'}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-zinc-500">
                  <span>Origem: <strong>{leadOriginLabel(selectedLead.origin)}</strong></span>
                  <span>·</span>
                  <span>Entrada: {formatDateTime(selectedLead.createdAt)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLead(null)}
                className="w-8 h-8 rounded-full border border-zinc-200 text-zinc-500 flex items-center justify-center hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>

            {/* Dados de Contato */}
            <div className="grid sm:grid-cols-2 gap-3 text-sm bg-zinc-50 p-3 rounded-xl border border-zinc-200">
              <div>
                <span className="text-xs text-zinc-500 font-semibold uppercase block">WhatsApp</span>
                <span className="font-mono font-medium">{selectedLead.phone || 'Não informado'}</span>
                {selectedLead.phone && (
                  <a
                    href={waLink(selectedLead.phone, 'Olá, tudo bem?')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-emerald-700 font-semibold hover:underline mt-0.5"
                  >
                    Abrir conversa no WhatsApp →
                  </a>
                )}
              </div>
              <div>
                <span className="text-xs text-zinc-500 font-semibold uppercase block">E-mail</span>
                <span>{selectedLead.email || 'Não informado'}</span>
              </div>
              {selectedLead.sourceUrl && (
                <div className="sm:col-span-2">
                  <span className="text-xs text-zinc-500 font-semibold uppercase block">URL de Origem</span>
                  <a href={selectedLead.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline break-all">
                    {selectedLead.sourceUrl}
                  </a>
                </div>
              )}
            </div>

            {/* Controles de Estágio, Responsável e Prioridade */}
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Etapa Atual</label>
                <select
                  value={selectedLead.stageId || selectedLead.status || 'new'}
                  onChange={(e) => handleMoveStage(selectedLead.id, e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-zinc-300 font-semibold bg-white"
                >
                  {pipeline?.stages.map((st) => (
                    <option key={st.id} value={st.id}>{st.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Responsável</label>
                <select
                  value={selectedLead.assignedUserId || ''}
                  onChange={(e) => handleAssignUser(selectedLead.id, e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-zinc-300 bg-white"
                >
                  <option value="">Sem responsável</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Prioridade</label>
                <select
                  value={selectedLead.priority || 'medium'}
                  onChange={(e) => handleChangePriority(selectedLead.id, e.target.value as LeadPriority)}
                  className="w-full text-xs p-2 rounded-lg border border-zinc-300 bg-white"
                >
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>
            </div>

            {/* Ações Diretas */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => {
                  setBookingLead(selectedLead);
                  if (services.length > 0) setBookServiceId(services[0].id);
                }}
                className="flex-1 py-2 bg-zinc-900 text-white font-semibold text-xs rounded-lg hover:bg-zinc-800 transition"
              >
                Agendar Atendimento
              </button>
              <button
                type="button"
                onClick={() => handleMoveStage(selectedLead.id, 'waiting_secretary', 'Encaminhado para secretaria')}
                className="px-4 py-2 bg-orange-50 border border-orange-200 text-orange-700 font-semibold text-xs rounded-lg hover:bg-orange-100 transition"
              >
                Aguardando Secretaria
              </button>
            </div>

            {/* Observações / Timeline de notas */}
            <div className="space-y-3 pt-3 border-t border-zinc-200">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-600">Observações da Equipe</h3>

              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {(!selectedLead.notes || selectedLead.notes.length === 0) ? (
                  <p className="text-xs text-zinc-400 italic">Nenhuma observação registrada.</p>
                ) : (
                  selectedLead.notes.map((n) => (
                    <div key={n.id} className="text-xs p-2.5 bg-zinc-50 rounded-lg border border-zinc-200 space-y-1">
                      <div className="flex justify-between text-zinc-400 text-[10px]">
                        <span className="font-semibold text-zinc-700">{n.byName || 'Membro'}</span>
                        <span>{formatDateTime(n.at)}</span>
                      </div>
                      <p className="text-zinc-800">{n.text}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Escrever observação interna…"
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  className="flex-1 text-xs px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none"
                />
                <button
                  type="button"
                  disabled={savingNote || !newNoteText.trim()}
                  onClick={() => handleAddNote(selectedLead.id)}
                  className="px-3 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                >
                  Salvar
                </button>
              </div>
            </div>

            {/* Histórico de Movimentações */}
            {selectedLead.stageHistory && selectedLead.stageHistory.length > 0 && (
              <div className="space-y-2 pt-3 border-t border-zinc-200">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-600">Histórico de Movimentação</h3>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {selectedLead.stageHistory.map((h) => (
                    <div key={h.id} className="text-[11px] text-zinc-600 flex items-start gap-2">
                      <span className="text-zinc-400 font-mono text-[10px] whitespace-nowrap">
                        {h.at.slice(11, 16)} · {h.at.slice(8, 10)}/{h.at.slice(5, 7)}
                      </span>
                      <span>
                        <strong>{h.movedByName || 'Sistema'}</strong>: {h.fromStage ? `de ${h.fromStage} para ` : ''}<strong>{h.toStage}</strong>
                        {h.note && <span className="text-zinc-500 italic"> ({h.note})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal de Agendamento Direto a partir do Lead (Bloco 5) ── */}
      {bookingLead && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmBooking}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl animate-scaleUp"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h2 className="text-base font-bold text-zinc-900">Agendar para {bookingLead.name}</h2>
                <p className="text-xs text-zinc-500 font-mono">{bookingLead.phone}</p>
              </div>
              <button
                type="button"
                onClick={() => setBookingLead(null)}
                className="w-7 h-7 rounded-full border border-zinc-200 text-zinc-500 flex items-center justify-center hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Serviço *</label>
              <select
                value={bookServiceId}
                onChange={(e) => setBookServiceId(e.target.value)}
                className="w-full text-xs p-2.5 rounded-lg border border-zinc-300 font-medium bg-white"
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min - {money(s.price)})</option>
                ))}
              </select>
            </div>

            {professionals.length > 1 && (
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Profissional</label>
                <select
                  value={bookProId}
                  onChange={(e) => setBookProId(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-zinc-300 bg-white"
                >
                  <option value="">Automático (menor carga)</option>
                  {professionals.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Data *</label>
              <input
                type="date"
                value={bookDate}
                min={todayISO()}
                onChange={(e) => setBookDate(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-zinc-300"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Horário *</label>
              {bookSlots.length === 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                  Nenhum horário livre nesta data.
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5 max-h-32 overflow-y-auto">
                  {bookSlots.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setBookTime(s)}
                      className={cn(
                        'p-1.5 rounded text-xs font-semibold border transition',
                        bookTime === s
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white text-zinc-800 border-zinc-200 hover:bg-zinc-50',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Observações internas</label>
              <textarea
                rows={2}
                value={bookNote}
                onChange={(e) => setBookNote(e.target.value)}
                placeholder="Ex: Primeira consulta indicada pelo Instagram"
                className="w-full text-xs p-2 rounded-lg border border-zinc-300"
              />
            </div>

            <button
              type="submit"
              disabled={bookingLoading || !bookTime}
              className="w-full py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition"
            >
              {bookingLoading ? 'Criando agendamento…' : 'Confirmar e Marcar Agendado'}
            </button>
          </form>
        </div>
      )}

      {/* ── Modal Novo Lead Manual ── */}
      {showNewLeadModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateManualLead}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3.5 shadow-xl animate-scaleUp"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <h2 className="text-base font-bold text-zinc-900">Novo Lead / Oportunidade</h2>
              <button
                type="button"
                onClick={() => setShowNewLeadModal(false)}
                className="w-7 h-7 rounded-full border border-zinc-200 text-zinc-500 flex items-center justify-center hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Nome</label>
              <input
                type="text"
                placeholder="Ex: Mariana Costa"
                value={newLeadName}
                onChange={(e) => setNewLeadName(e.target.value)}
                className="w-full text-xs p-2.5 rounded-lg border border-zinc-300"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">WhatsApp</label>
                <input
                  type="tel"
                  placeholder="(11) 99999-9999"
                  value={newLeadPhone}
                  onChange={(e) => setNewLeadPhone(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-zinc-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">E-mail</label>
                <input
                  type="email"
                  placeholder="mariana@email.com"
                  value={newLeadEmail}
                  onChange={(e) => setNewLeadEmail(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-zinc-300"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Interesse / Serviço</label>
              <input
                type="text"
                placeholder="Ex: Avaliação facial ou procedimento X"
                value={newLeadInterest}
                onChange={(e) => setNewLeadInterest(e.target.value)}
                className="w-full text-xs p-2.5 rounded-lg border border-zinc-300"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Prioridade</label>
                <select
                  value={newLeadPriority}
                  onChange={(e) => setNewLeadPriority(e.target.value as LeadPriority)}
                  className="w-full text-xs p-2.5 rounded-lg border border-zinc-300 bg-white"
                >
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">Responsável</label>
                <select
                  value={newLeadAssignee}
                  onChange={(e) => setNewLeadAssignee(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-zinc-300 bg-white"
                >
                  <option value="">Sem responsável</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">Observações iniciais</label>
              <textarea
                rows={2}
                placeholder="Detalhes adicionais sobre o contato…"
                value={newLeadMessage}
                onChange={(e) => setNewLeadMessage(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-zinc-300"
              />
            </div>

            <button
              type="submit"
              disabled={savingNewLead}
              className="w-full py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition"
            >
              {savingNewLead ? 'Salvando…' : 'Criar Oportunidade'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
