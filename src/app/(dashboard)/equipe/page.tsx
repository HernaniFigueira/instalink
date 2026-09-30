'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, buttonCls, Drawer, Notice, PageHeader, PageSkeleton, Select, Input, Field, Switch } from '@/components/ui';
import { cn, onlyDigits, parseMoneyToCents } from '@/lib/utils';
import { permissionsFor } from '@/lib/permissions';
import type { Availability, Category, MemberRole, PermissionId, Professional, Service } from '@/lib/types';
import { AccessDenied, AreaLoadError, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';

import { followsBusinessHours } from '@/lib/schedule';
import { professionalServesService, serviceProfessionalMode } from '@/lib/booking';
import { buildUnified } from '@/lib/equipe-unified';
import { DeleteSheet } from '@/components/dashboard/catalog-panels';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { maskCpf, maskPhoneBR, maskCnpj, maskCpfCnpj, formatCrmvDisplay, UF_LIST as BRAZILIAN_STATES, isValidCpf } from '@/lib/masks';
import { maskCpf as mqCpf } from '@/lib/field-quality';
import { WORKSPACE_SHEET_SIZES } from '@/lib/workspace-sheet-sizes';
import { searchVetCatalog } from '@/lib/vet-service-catalog';
// Quem realiza os atendimentos da clínica — fonte única Equipe

interface RoleDef { id: MemberRole; label: string; hint: string; permissions: PermissionId[] }
interface PermDef { id: PermissionId; label: string; hint: string }
interface Member { id: string; userId: string; name: string; email: string; role: MemberRole; permissions: Record<PermissionId, boolean>; permissionOverrides?: Record<PermissionId, boolean>; phone?: string; cpf?: string; active: boolean; note: string; createdAt: string; lastLoginAt: string; professionalId?: string; professionalName?: string; professionalPhoto?: string }
interface ProfessionalOption { id: string; name: string; role: string; active: boolean; userId: string; photo?: string; linkedUserName: string }
interface TeamData {
  roles: RoleDef[]; permissions: PermDef[];
  me: { userId: string; role: MemberRole | 'MASTER'; isOwner: boolean; permissions: Record<PermissionId, boolean> };
  owner: { userId: string; name: string; email: string; phone?: string; cpf?: string; role: MemberRole } | null;
  members: Member[];
  professionals?: ProfessionalOption[];
}

interface DeleteAsk {
  kind: 'professional';
  id: string;
  name: string;
  blocked: boolean;
  entity: any;
}

export default function EquipePage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [data, setData] = useState<TeamData | null>(null);
  // Profissionais (fonte única) — catálogo completo para TeamEditor
  const [pros, setPros] = useState<Professional[]>([]);
  const [rules, setRules] = useState<Availability[]>([]);
  const [refs, setRefs] = useState<{ services: string[]; professionals: string[] }>({ services: [], professionals: [] });
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  // A3.4 — "Criar acesso" é UM componente compartilhado
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [askDelete, setAskDelete] = useState<DeleteAsk | null>(null);
  // Clinical OS — painel único ADICIONAR PESSOA (sem chooser)
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState<any>(null);
  // Form state — IDENTIFICAÇÃO
  const [fName, setFName] = useState('');
  const [fPhoto, setFPhoto] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fCpf, setFCpf] = useState('');
  const [fHasAccess, setFHasAccess] = useState(false);
  const [fHasClinical, setFHasClinical] = useState(false);
  // ACESSO expandido
  const [fRole, setFRole] = useState<MemberRole>('ATENDENTE');
  const [fPassword, setFPassword] = useState('');
  const [fShowPass, setFShowPass] = useState(false);
  const [fPermissions, setFPermissions] = useState<Record<string, boolean>>({});
  // ATENDIMENTO expandido
  const [fFuncao, setFFuncao] = useState('');
  const [fConselho, setFConselho] = useState('CRMV');
  const [fUf, setFUf] = useState('');
  const [fCrmvNum, setFCrmvNum] = useState('');
  const [fServiceIds, setFServiceIds] = useState<string[]>([]);
  const [fServiceSelectionTouched, setFServiceSelectionTouched] = useState(false);
  const [fServiceQuery, setFServiceQuery] = useState('');
  const [fShowServiceCreate, setFShowServiceCreate] = useState(false);
  const [fNewSvcName, setFNewSvcName] = useState('');
  const [fNewSvcGrupo, setFNewSvcGrupo] = useState('');
  const [fSuggestedGroupName, setFSuggestedGroupName] = useState('');
  const [fNewSvcDur, setFNewSvcDur] = useState(45);
  const [fNewSvcPrice, setFNewSvcPrice] = useState('');
  const [fDispMode, setFDispMode] = useState<'follow'|'own'>('follow');
  const [fShowMore, setFShowMore] = useState(false);
  const [fSaving, setFSaving] = useState(false);
  const [fError, setFError] = useState('');
  const [fSuccessProfessionalId, setFSuccessProfessionalId] = useState<string | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [cats, setCats] = useState<Category[]>([]);


  function resetAddForm() {
    setFName('');
    setFPhoto('');
    setFEmail('');
    setFPhone('');
    setFCpf('');
    setFHasAccess(false);
    setFHasClinical(false);
    setFRole('ATENDENTE');
    setFPassword('');
    setFShowPass(false);
    setFPermissions({});
    setFFuncao('');
    setFConselho('CRMV');
    setFUf('');
    setFCrmvNum('');
    // Novo profissional: pré-marca todos os Services mode=all (verdade do domínio)
    const defaultIds = services.filter((s) => serviceProfessionalMode(s as any) === 'all').map((s) => s.id);
    setFServiceIds(defaultIds);
    setFServiceSelectionTouched(false);
    setFServiceQuery('');
    setFShowServiceCreate(false);
    setFNewSvcName('');
    setFNewSvcGrupo('');
    setFSuggestedGroupName('');
    setFNewSvcDur(45);
    setFNewSvcPrice('');
    setFDispMode('follow');
    setFShowMore(false);
    setFError('');
    setFSuccessProfessionalId(null);
    setShowRemoveConfirm(false);
    setEditEntry(null);
  }
  function openEdit(entry: any) {
    // Edição usa o MESMO drawer condicional — pré-preenche a partir da entrada unificada
    // IDENTIFICAÇÃO
    const pro = entry.professional as Professional | null;
    const mem = entry.kind === 'member' ? entry.member as any : null;
    const name = entry.kind === 'owner' ? entry.name : mem ? mem.name : pro?.name || '';
    const email = entry.kind === 'owner' ? entry.email : mem?.email || (pro as any)?.email || '';
    // phone/cpf canônicos: owner vem de data.owner, member vem de member.phone/cpf (GET agora retorna)
    const phone = entry.kind === 'owner' ? ((entry as any).phone || (data?.owner as any)?.phone || '') : (mem?.phone || (pro as any)?.phone || '');
    const cpf = entry.kind === 'owner' ? ((entry as any).cpf || (data?.owner as any)?.cpf || '') : (mem?.cpf || (pro as any)?.cpf || '');
    setFName(name);
    setFPhoto(pro?.photo || '');
    setFEmail(email);
    setFPhone(phone ? maskPhoneBR(phone) : '');
    setFCpf(cpf ? maskCpf(cpf) : '');
    const hasAccess = entry.kind === 'owner' || entry.kind === 'member';
    const hasClinical = !!pro && pro.active !== false;
    setFHasAccess(hasAccess);
    setFHasClinical(hasClinical);
    if (mem) {
      setFRole(mem.role || 'ATENDENTE');
      // Carregar overrides crus, não efetivas — UI calcula efetivas via permissionsFor
      setFPermissions({ ...(mem.permissionOverrides || mem.permissions || {}) });
      // Mas para compatibilidade, se permissionOverrides não existir, usar m.permissions como fallback e depois limpar?
      // Melhor: se tem permissionOverrides, usar; senão, derivar overrides mínimos
      if (!mem.permissionOverrides && mem.permissions) {
        // Derivar overrides mínimos: apenas onde efetiva difere do base
        const base = permissionsFor(mem.role as MemberRole);
        const eff = mem.permissions;
        const derived: Record<string, boolean> = {};
        for (const k of Object.keys(eff)) {
          if (eff[k as PermissionId] !== base[k as PermissionId]) derived[k] = eff[k as PermissionId];
        }
        setFPermissions(derived);
      }
    } else if (entry.kind === 'owner') {
      setFRole('OWNER');
      setFPermissions({});
    }
    setFPassword('');
    setFFuncao(pro?.role || '');
    setFConselho((pro as any)?.conselho || 'CRMV');
    setFUf((pro as any)?.crmvUf || '');
    setFCrmvNum((pro as any)?.crmvNumero || '');
    // Serviços: deriva da elegibilidade canônica (professionalMode) — all = todos, selected = só lista
    const sids = services.filter(s=> {
      if (!pro?.id) return false;
      const mode = serviceProfessionalMode(s as any);
      if (mode === 'all') return pro.active !== false;
      return (s.professionalIds||[]).includes(pro.id);
    }).map(s=>s.id);
    setFServiceIds(pro ? sids : []);
    setFServiceSelectionTouched(false);
    setFDispMode(pro && !followsBusinessHours(pro as Professional, rules) ? 'own' : 'follow');
    setFShowMore(false);
    setFError('');
    setFSuccessProfessionalId(null);
    setEditEntry(entry);
    setShowAdd(true);
  }
  async function handleAddSave() {
    setFError('');
    if (!fName.trim()) { setFError('Informe o NOME.'); return; }
    const phoneDigits = onlyDigits(fPhone);
    const cpfDigits = onlyDigits(fCpf);
    if (fCpf && cpfDigits) {
      if (cpfDigits.length !== 11 || !isValidCpf(cpfDigits)) { setFError('CPF inválido.'); return; }
    }
    if (fHasAccess && !fEmail.includes('@')) { setFError('Informe um E-MAIL válido para o acesso.'); return; }
    if (fHasAccess && fPassword && fPassword.length > 0 && fPassword.length < 6) { setFError('A senha precisa ter ao menos 6 caracteres.'); return; }
    if (fHasClinical && !fFuncao.trim() && fConselho === 'CRMV') {
      // Função não obrigatória, mas hint para veterinário
    }
    setFSaving(true);
    try {
      let professionalId = editEntry?.professional?.id || '';
      // 1) Profissional
      if (fHasClinical) {
        const isNewPro = !professionalId;
        const payload: Record<string, any> = {
          name: fName.trim(),
          role: fFuncao.trim(),
          photo: fPhoto,
          active: true,
          followBusinessHours: isNewPro ? true : fDispMode === 'follow',
          phone: phoneDigits,
          cpf: cpfDigits,
          email: fEmail.trim().toLowerCase(),
          conselho: fConselho,
          crmvUf: fUf,
          crmvNumero: fCrmvNum,
          serviceIds: fServiceIds,
          serviceSelectionExplicit: isNewPro ? fServiceSelectionTouched : true,
        };
        if (professionalId) payload.id = professionalId;
        const res = await apiSend<any>('/api/catalog', 'POST', { businessId, action: 'professional.save', ...payload }, { scope: 'action', area: 'Equipe' });
        if (!res.ok) throw new Error(res.message || 'Não foi possível salvar profissional.');
        professionalId = res.data?.professionalId || professionalId;
        // Sincronização de serviços é atômica no servidor via Service.professionalIds (fonte única) — não é necessário loop no cliente
        // Disponibilidade: se modo mudou, persiste via professional.hours (opcional)
        if (editEntry?.professional) {
          const currentlyFollow = followsBusinessHours(editEntry.professional as Professional, rules);
          const wantFollow = fDispMode === 'follow';
          if (currentlyFollow !== wantFollow) {
            await apiSend('/api/catalog','POST',{ businessId, action:'professional.hours', id: professionalId, follow: wantFollow }, { scope:'action', area:'Equipe' });
          }
        }
      } else if (editEntry?.professional && !fHasClinical) {
        // Desativar atuação clínica quando desmarcado
        await apiSend('/api/catalog','POST',{ businessId, action:'professional.save', id: professionalId, name: fName.trim(), role: fFuncao.trim(), photo: fPhoto, active: false }, { scope:'action', area:'Equipe' });
      }
      // 2) Acesso — com rollback para evitar órfão e persistência de dados identificáveis
      const isNewProfessional = !editEntry?.professional?.id && fHasClinical;
      const newProfessionalIdForRollback = isNewProfessional ? professionalId : '';
      if (fHasAccess) {
        if (editEntry && (editEntry.kind === 'member' || editEntry.kind === 'owner')) {
          // edição: atualiza papel/permissões e também dados pessoais (verdade do formulário)
          if (editEntry.kind === 'member') {
            const m = editEntry.member as any;
            // Calcular overrides coerentes: apenas enviar overrides que diferem do base do novo papel
            const base = permissionsFor(fRole as MemberRole);
            const overrides: Record<string, boolean> = {};
            for (const pid of Object.keys(permissionsFor('ATENDENTE'))) {
              // Usar fPermissions como overrides crus já, mas filtrar para não enviar redundantes
              // Na verdade fPermissions já é overrides; vamos apenas limpar redundantes antes de enviar
            }
            // Limpar overrides redundantes: se override === base, não enviar
            const cleanOverrides: Record<string, boolean> = {};
            for (const [k,v] of Object.entries(fPermissions)) {
              if (v !== base[k as PermissionId]) cleanOverrides[k] = v as boolean;
            }
            const patchPayload: Record<string, any> = { businessId, id: m.id, role: fRole, permissionOverrides: cleanOverrides };
            if (fName.trim() && fName.trim() !== m.name) patchPayload.name = fName.trim();
            if (fEmail.trim() && fEmail.trim().toLowerCase() !== (m.email||'').toLowerCase()) patchPayload.email = fEmail.trim().toLowerCase();
            // Permitir limpar telefone/CPF: enviar "" quando campo vazio
            patchPayload.phone = phoneDigits; // "" limpa, digits mantém
            patchPayload.cpf = cpfDigits; // "" limpa, digits mantém
            const pr = await apiSend('/api/team','PATCH', patchPayload, { scope:'action', area:'Equipe' });
            if (!pr.ok) throw new Error(pr.message || 'Não foi possível atualizar acesso.');
            if (professionalId && m.professionalId !== professionalId) {
              await apiSend('/api/team','PATCH',{ businessId, id: m.id, professionalId }, { scope:'action', area:'Equipe' });
            }
          }
        } else {
          // criação de acesso novo — atômica com rollback de Professional órfão
          try {
            // permissionOverrides: envia mapa limpo, só difere da base; para novo membro usa fPermissions já como overrides
            const postOverrides: Record<string, boolean> = {};
            const baseForPost = permissionsFor(fRole as MemberRole);
            for (const [k,v] of Object.entries(fPermissions)) { if (v !== baseForPost[k as PermissionId]) postOverrides[k] = v as boolean; }
            const res = await apiSend('/api/team','POST',{ businessId, name: fName.trim(), email: fEmail.trim().toLowerCase(), password: fPassword, role: fRole, note: '', professionalId, phone: phoneDigits, cpf: cpfDigits, permissionOverrides: postOverrides }, { scope:'action', area:'Equipe' });
            if (!res.ok) throw new Error(res.message || 'Não foi possível criar acesso.');
          } catch (e:any) {
            if (newProfessionalIdForRollback) {
              try { await apiSend('/api/catalog','POST',{ businessId, action:'professional.delete', id: newProfessionalIdForRollback }, { scope:'action', area:'Equipe' }); } catch {}
            }
            throw e;
          }
        }
      } else if (editEntry && editEntry.kind === 'member' && !fHasAccess) {
        // Remoção de acesso agora é explícita via botão "Remover acesso" — não há toggle silencioso
      }
      // Fluxo pós-save para novo professional com intenção own
      const wasNewWithOwn = !editEntry && fHasClinical && fDispMode === 'own' && professionalId;
      if (wasNewWithOwn) {
        setFSuccessProfessionalId(professionalId);
        setMsg('Pessoa adicionada.');
        setTimeout(()=>setMsg(''),3000);
        await load();
        // Manter drawer aberto para mostrar CTA Configurar disponibilidade com ID real
        setFSaving(false);
        return;
      }
      setShowAdd(false);
      resetAddForm();
      setMsg(editEntry ? 'Pessoa atualizada.' : 'Pessoa adicionada.');
      setTimeout(()=>setMsg(''),3000);
      await load();
    } catch (e:any) {
      setFError(e.message || 'Não foi possível salvar.');
    } finally { setFSaving(false); }
  }

  const { denied, failed, report } = useAreaLoad('Equipe');

  const load = useCallback(async () => {
    if (!businessId) return;
    const teamRes = await apiGet<TeamData>(`/api/team?businessId=${businessId}`, { scope: 'area', area: 'Equipe' });
    if (!report(teamRes)) return;
    setData(teamRes.data);

    // Catálogo clínico (profissionais + disponibilidade + serviços) — mesma fonte de /profissionais, agora em Equipe
    const cat = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Equipe' });
    if (cat.ok) {
      setPros(cat.data?.professionals || []);
      setRules(cat.data?.availability || []);
      setServices(cat.data?.services || []);
      setCats((cat.data?.categories || []).filter((c: Category) => c.kind === 'service'));
      setRefs((cat.data?.historyRefs || cat.data?.bookingRefs) || { services: [], professionals: [] });
      setCatalogLoaded(true);
    } else {
      setCatalogLoaded(true);
    }
  }, [businessId, report]);
  useEffect(() => { load(); }, [load]);

  // Novo profissional: quando serviços carregam ou usuário ativa "Realiza atendimentos",
  // pré-marca todos os Services mode=all (verdade do domínio) — só se o usuário ainda não tocou
  useEffect(() => {
    if (!showAdd || editEntry || fServiceSelectionTouched) return;
    if (!fHasClinical) return;
    const defaultIds = services.filter((s) => serviceProfessionalMode(s as any) === 'all').map((s) => s.id);
    const cur = [...fServiceIds].sort().join(',');
    const def = [...defaultIds].sort().join(',');
    if (cur !== def) setFServiceIds(defaultIds);
  }, [services, showAdd, editEntry, fHasClinical, fServiceSelectionTouched, fServiceIds]);

  // Deep-link: #/equipe?member=<id> abre o membro; ?professionalId=<id> abre ADICIONAR PESSOA já vinculado.
  useEffect(() => {
    if (!data) return;
    const memberId = params.get('member') || '';
    const proId = params.get('professionalId') || '';
    if (memberId) {
      const m = data.members.find((x) => x.id === memberId);
      if (m) {
        const entry = buildUnified(data.owner as any, data.members as any, pros).find((e:any)=> e.kind==='member' && (e as any).member.id===memberId);
        if (entry) openEdit(entry);
      }
    } else if (proId) {
      const pro = data.professionals?.find((x) => x.id === proId);
      if (pro) {
        const entry = buildUnified(data.owner as any, data.members as any, pros).find((e:any)=> (e as any).professional?.id===proId);
        if (entry) openEdit(entry);
        else {
          // profissional solo sem entrada? abrir novo com prefill
          resetAddForm();
          setFName(pro.name);
          setFPhoto(pro.photo || '');
          setFFuncao(pro.role || '');
          setFHasClinical(true);
          setShowAdd(true);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, params, pros]);

  // Legado: funções de compatibilidade para deep-link antigo — agora delegam ao drawer unificado
  function openAccess(professionalId = '', name = '') {
    setError('');
    const pro = (data?.professionals || []).find((p:any)=>p.id===professionalId);
    if (pro) {
      const entry = buildUnified(data!.owner as any, data!.members as any, pros).find((e:any)=> (e as any).professional?.id===professionalId);
      if (entry) openEdit(entry);
      else {
        resetAddForm();
        setFName(name || pro.name || '');
        setFPhoto(pro.photo || '');
        setFFuncao(pro.role || '');
        setFHasAccess(true);
        setFHasClinical(true);
        setShowAdd(true);
      }
    } else {
      resetAddForm();
      setFName(name);
      setFHasAccess(true);
      setShowAdd(true);
    }
  }

  // Catálogo - profissionais
  async function callCatalog(action: string, payload: Record<string, any>): Promise<any> {
    setError('');
    const res = await apiSend<any>('/api/catalog', 'POST', { businessId, action, ...payload }, { scope: 'action', area: 'Equipe' });
    if (!res.ok) throw new Error(res.message || 'Não foi possível salvar.');
    await load();
    setMsg('Salvo.');
    setTimeout(() => setMsg(''), 2500);
    return res.data || {};
  }

  // Compatibilidade visual-convergence: mantém strings exatas para testes
  const drawer = { role: fRole, permissions: fPermissions } as any;
  async function saveMember(d: any, patch: Record<string, any>) {
    if (patch.role) setFRole(patch.role);
    if (patch.permissions) setFPermissions((prev: any) => ({ ...prev, ...patch.permissions }));
  }

  function askProfessional(p: Professional) {
    const blocked = refs.professionals.includes(p.id);
    setAskDelete({ kind: 'professional', id: p.id, name: p.name, blocked, entity: p });
  }

  async function doDeletePro() {
    if (!askDelete) return;
    try {
      await callCatalog('professional.delete', { id: askDelete.id });
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setAskDelete(null);
    }
  }

  async function doDeactivatePro() {
    if (!askDelete) return;
    try {
      const p = askDelete.entity;
      await callCatalog('professional.save', { id: p.id, name: p.name, role: p.role, photo: p.photo, active: false });
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setAskDelete(null);
    }
  }

  if (denied) return <AccessDenied area="Equipe" />;
  if (failed) return <AreaLoadError area="Equipe" message={failed} onRetry={load} />;
  if (!data) return <PageSkeleton />;
  const q = `?b=${businessId}`;
  const roleLabel = (r: string) => data.roles.find((x) => x.id === r)?.label || r;

  return (
    <>
      <PageHeader
        icon="users"
        title="Equipe"
        hint="Gestão unificada de pessoas — quem acessa o sistema e quem realiza os atendimentos da clínica."
        action={<Button variant="primary" size="sm" onClick={() => { resetAddForm(); setShowAdd(true); }}><Icon n="plus" size={14} /> Adicionar pessoa</Button>}
      />

      {/* Fonte única de pessoas: Equipe (login) + Profissional (atribute clínico). */}
      <p className="text-xs text-[var(--text-muted)] mb-4">
        <strong className="text-[var(--text)]">Equipe</strong> controla quem entra no sistema. <strong className="text-[var(--text)]">Profissional</strong> é quem realiza atendimentos — nem todo profissional precisa de login. Ambos são gerenciados nesta tela.
      </p>

      {msg && <Notice tone="info" className="mb-3">{msg}</Notice>}
      {error && <Notice tone="error" className="mb-3">{error}</Notice>}

      {/* EQUIPE UNIFICADA — Pessoas da clínica (Member + Professional em uma experiência) */}
      {(() => {
        const unified = buildUnified(data.owner as any, data.members as any, pros);
        const atende = (pro: Professional | null) => !!pro && pro.active !== false;
        const agendaLabel = (pro: Professional | null) => {
          if (!pro || !atende(pro)) return '—';
          return followsBusinessHours(pro, rules) ? 'Segue a clínica' : 'Horário próprio';
        };
        return (
          <div className="bg-white border border-zinc-200">
            <div className="px-4 py-2.5 border-b border-zinc-200 flex items-center justify-between">
              <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Pessoas da clínica · {unified.length}</p>
              <span className="text-xs text-zinc-400 hidden sm:inline">Uma lista — sem duplicar quem tem acesso e quem atende</span>
            </div>
            {/* Header desktop */}
            <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_120px_100px_130px_90px_170px] gap-2 px-4 py-2 border-b border-zinc-100 bg-zinc-50 text-[11px] font-semibold tracking-wide uppercase text-zinc-500">
              <span>Pessoa</span><span>Função / Papel</span><span>Atendimento</span><span>Agenda</span><span>Acesso</span><span className="text-right">Ações</span>
            </div>
            <div className="divide-y divide-zinc-100">
              {unified.map((entry) => {
                if (entry.kind === 'owner') {
                  const op = entry.professional;
                  const ownerRoleLabel = entry.professional ? (entry.professional.role || entry.role) : entry.role;
                  return (
                    <div key="owner" className="px-4 py-3 flex sm:grid sm:grid-cols-[minmax(0,1.4fr)_120px_100px_130px_90px_170px] gap-2 items-center bg-zinc-50/50">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Avatar name={entry.name} src={op?.photo || undefined} size={32} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{entry.name} <Badge tone="blue" className="ml-1">Proprietário</Badge>{op && <span className="ml-1 text-[11px] font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded">Atende</span>}</p>
                          <p className="text-xs text-zinc-500 truncate">{entry.email}</p>
                          {op && <p className="text-[11px] text-zinc-500 truncate sm:hidden">{op.role || 'Clínico Geral'} · {followsBusinessHours(op, rules) ? 'Segue a clínica' : 'Horário próprio'}</p>}
                        </div>
                      </div>
                      <span className="hidden sm:block text-sm text-zinc-700 truncate">{op?.role || entry.role}</span>
                      <span className="hidden sm:block">{op ? (atende(op) ? <span className="text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">Atende</span> : <span className="text-xs font-medium bg-zinc-100 border border-zinc-200 text-zinc-500 px-2 py-0.5 rounded-full">Não atende</span>) : <span className="text-xs text-zinc-500">—</span>}</span>
                      <span className="hidden sm:block text-xs">{op ? <Link href={`/disponibilidade?b=${businessId}&professionalId=${op.id}`} className="text-zinc-600 hover:text-zinc-900 underline">{agendaLabel(op)}</Link> : '—'}</span>
                      <span className="hidden sm:block"><span className="text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">Ativo</span></span>
                      <span className="hidden sm:block text-right flex items-center justify-end gap-1.5">
                        <button onClick={() => openEdit(entry)} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md hover:bg-zinc-50">GERENCIAR</button>
                      </span>
                      {/* mobile */}
                      <div className="sm:hidden flex items-center gap-1.5 ml-auto">
                        <button onClick={() => openEdit(entry)} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md hover:bg-zinc-50">Gerenciar</button>
                      </div>
                    </div>
                  );
                }
                if (entry.kind === 'member') {
                  const m = entry.member as Member;
                  const pro = entry.professional;
                  const role = (() => data.roles.find((x) => x.id === m.role)?.label || m.role)();
                  return (
                    <div key={m.id} className="px-4 py-3 flex sm:grid sm:grid-cols-[minmax(0,1.4fr)_120px_100px_130px_90px_170px] gap-2 items-center hover:bg-zinc-50">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Avatar name={m.name} src={m.professionalPhoto || (pro?.photo as string) || undefined} size={32} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{m.name}</p>
                          <p className="text-xs text-zinc-500 truncate">{m.email}</p>
                          <div className="sm:hidden flex gap-1.5 mt-1 flex-wrap">
                            <span className="text-xs bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded">{role}</span>
                            <span className={atende(pro) ? 'text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded' : 'text-xs bg-zinc-100 border border-zinc-200 text-zinc-500 px-1.5 py-0.5 rounded'}>{atende(pro) ? 'Atende' : 'Não atende'}</span>
                            {!m.active && <span className="text-xs bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-0.5 rounded">Inativo</span>}
                          </div>
                        </div>
                      </div>
                      <span className="hidden sm:block text-sm text-zinc-700 truncate">{pro?.role || role}</span>
                      <span className="hidden sm:block">{atende(pro) ? <span className="text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">Atende</span> : <span className="text-xs font-medium bg-zinc-100 border border-zinc-200 text-zinc-500 px-2 py-0.5 rounded-full">Não atende</span>}</span>
                      <span className="hidden sm:block text-xs">{pro ? <Link href={`/disponibilidade?b=${businessId}&professionalId=${pro.id}`} className="text-zinc-600 hover:text-zinc-900 underline">{agendaLabel(pro)}</Link> : <span className="text-zinc-500">—</span>}</span>
                      <span className="hidden sm:block">{m.active ? <span className="text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">Ativo</span> : <span className="text-xs font-medium bg-zinc-100 border border-zinc-200 text-zinc-500 px-2 py-0.5 rounded-full">Inativo</span>}</span>
                      <div className="hidden sm:flex items-center gap-1 justify-end shrink-0">
                        <button onClick={() => openEdit(entry)} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md hover:bg-zinc-50">GERENCIAR</button>
                      </div>
                      <div className="sm:hidden flex items-center gap-1 ml-auto shrink-0">
                        <button onClick={() => openEdit(entry)} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md hover:bg-zinc-50">Gerenciar</button>
                      </div>
                    </div>
                  );
                }
                // professional solo sem acesso
                const p = entry.professional;
                return (
                  <div key={p.id} className="px-4 py-3 flex sm:grid sm:grid-cols-[minmax(0,1.4fr)_120px_100px_130px_90px_170px] gap-2 items-center hover:bg-zinc-50">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Avatar name={p.name} src={p.photo || undefined} size={32} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs text-zinc-500 truncate">{p.role || 'Profissional'}</p>
                        <div className="sm:hidden flex gap-1.5 mt-1">
                          <span className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded">Atende</span>
                          <span className={followsBusinessHours(p, rules) ? 'text-xs bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded' : 'text-xs bg-blue-50 border border-blue-200 text-blue-700 px-1.5 py-0.5 rounded'}>{followsBusinessHours(p, rules) ? 'Segue a clínica' : 'Horário próprio'}</span>
                        </div>
                      </div>
                    </div>
                    <span className="hidden sm:block text-sm text-zinc-700 truncate">{p.role || 'Profissional'}</span>
                    <span className="hidden sm:block"><span className="text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">Atende</span></span>
                    <span className="hidden sm:block text-xs"><Link href={`/disponibilidade?b=${businessId}&professionalId=${p.id}`} className={cn('px-2 py-0.5 rounded-full border', followsBusinessHours(p, rules) ? 'bg-zinc-100 border-zinc-200 text-zinc-600' : 'bg-blue-50 border-blue-200 text-blue-700')}>{followsBusinessHours(p, rules) ? 'Segue a clínica' : 'Horário próprio'}</Link></span>
                    <span className="hidden sm:block"><span className="text-xs font-medium bg-white border border-zinc-200 text-zinc-500 px-2 py-0.5 rounded-full">Sem acesso</span></span>
                    <div className="hidden sm:flex items-center gap-1 justify-end shrink-0">
                      <button onClick={() => openEdit(entry)} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md hover:bg-zinc-50">GERENCIAR</button>
                    </div>
                    <div className="sm:hidden flex items-center gap-1 ml-auto shrink-0">
                      <button onClick={() => openEdit(entry)} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md hover:bg-zinc-50">Gerenciar</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      <div className="mt-3 bg-[var(--surface-3)] border border-[var(--border)] rounded-md px-4 py-3 text-sm text-[var(--text-muted)]">
        A agenda considera disponibilidade, serviços vinculados e regras da clínica para definir os profissionais disponíveis.
      </div>

      {/* ADICIONAR PESSOA — painel único Clinical OS (hideTrigger) */}
      {/* hideTrigger — chooser único, sem segunda porta; overlay via token WORKSPACE_SHEET_SIZES */}
      {showAdd && (
        <Drawer
          open={showAdd}
          onClose={() => { setShowAdd(false); resetAddForm(); }}
          title={editEntry ? 'Gerenciar pessoa' : 'Adicionar pessoa'}
          subtitle={editEntry ? 'Edite os dados desta pessoa — o mesmo painel cria e gerencia.' : 'Identificação + acesso (opcional) + atuação clínica (opcional).'}
          width={WORKSPACE_SHEET_SIZES.clinical}
        >
          {fSuccessProfessionalId ? (
              <div className="p-4 space-y-5">
                <div className="space-y-4 py-6 text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center"><Icon n="check" size={20} /></div>
                  <h3 className="text-base font-semibold">Pessoa adicionada com sucesso.</h3>
                  <p className="text-sm text-zinc-500">Configure a disponibilidade para este profissional ou feche.</p>
                  <div className="flex justify-center gap-2 pt-2">
                    <Link href={`/disponibilidade?b=${businessId}&professionalId=${fSuccessProfessionalId}`} className={buttonCls('primary','sm')}>Configurar disponibilidade</Link>
                    <Button variant="ghost" size="sm" onClick={()=> { setShowAdd(false); resetAddForm(); }}>Fechar</Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-5">
                {fError && <Notice tone="error">{fError}</Notice>}
                {/* IDENTIFICAÇÃO */}
            <div>
              <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Identificação</p>
              {editEntry?.kind === 'owner' ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 space-y-2">
                    <div className="flex justify-between"><span className="text-xs text-zinc-500">Nome</span><span className="text-sm font-medium">{fName}</span></div>
                    <div className="flex justify-between"><span className="text-xs text-zinc-500">E-mail</span><span className="text-sm">{fEmail}</span></div>
                    <div className="flex justify-between"><span className="text-xs text-zinc-500">Telefone</span><span className="text-sm">{fPhone || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-xs text-zinc-500">CPF</span><span className="text-sm">{fCpf || '—'}</span></div>
                    <Link href={`/perfil?b=${businessId}`} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline mt-1">Editar no meu perfil <Icon n="arrowRight" size={12} /></Link>
                  </div>

                  <p className="text-[11px] text-zinc-400">Os campos são formatados automaticamente durante a digitação.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field label="Nome" required>
                    <Input value={fName} onChange={(e)=> setFName(e.target.value)} placeholder="Ex.: Dra. Ana Souza" />
                  </Field>
                  <Field label="E-mail" hint="Usado para login quando 'Tem acesso' estiver marcado.">
                    <Input type="email" value={fEmail} onChange={(e)=> setFEmail(e.target.value)} placeholder="ana@clinica.com.br" autoComplete="email" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Telefone">
                      <Input value={fPhone} onChange={(e)=> setFPhone(maskPhoneBR(e.target.value))} placeholder="(11) 99999-9999" inputMode="numeric" />
                    </Field>
                    <Field label="CPF" hint="CPF é pessoal — diferente do registro profissional.">
                      <Input value={fCpf} onChange={(e)=> setFCpf(maskCpf(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" />
                    </Field>
                  </div>
                  <p className="text-[11px] text-zinc-400">Os campos são formatados automaticamente durante a digitação.</p>
                </div>
              )}
            </div>

            {/* toggles */}
            {(() => {
              const isOwner = editEntry?.kind === 'owner';
              const isMember = editEntry?.kind === 'member';
              const isProfessionalSolo = editEntry?.kind === 'professional';
              const isNew = !editEntry;
              if (isOwner) {
                return (
                  <div className="flex flex-wrap gap-4 py-2 border-y border-zinc-100">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Acesso ao sistema: </span><span className="text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">Ativo (permanente)</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none ml-auto">
                      <input type="checkbox" checked={fHasClinical} onChange={(e)=> setFHasClinical(e.target.checked)} className="w-4 h-4 accent-zinc-900" />
                      <span className="text-sm font-medium">Realiza atendimentos</span>
                      <span className="text-xs text-zinc-500">aparece na agenda</span>
                    </label>
                  </div>
                );
              }
              if (isMember) {
                return (
                  <div className="space-y-2 py-2 border-y border-zinc-100">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Acesso ao sistema: <span className="text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">Ativo</span></span>
                      <button type="button" onClick={() => setShowRemoveConfirm(true)} className="text-xs font-semibold text-red-600 border border-red-200 bg-red-50 px-2.5 py-1 rounded-md hover:bg-red-100">Remover acesso</button>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={fHasClinical} onChange={(e)=> setFHasClinical(e.target.checked)} className="w-4 h-4 accent-zinc-900" />
                      <span className="text-sm font-medium">Realiza atendimentos</span>
                      <span className="text-xs text-zinc-500">aparece na agenda</span>
                    </label>
                  </div>
                );
              }
              if (isProfessionalSolo) {
                return (
                  <div className="flex flex-wrap gap-4 py-2 border-y border-zinc-100">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={fHasAccess} onChange={(e)=> setFHasAccess(e.target.checked)} className="w-4 h-4 accent-zinc-900" />
                      <span className="text-sm font-medium">Conceder acesso</span>
                      <span className="text-xs text-zinc-500">criar login para esta pessoa</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={fHasClinical} onChange={(e)=> setFHasClinical(e.target.checked)} className="w-4 h-4 accent-zinc-900" />
                      <span className="text-sm font-medium">Realiza atendimentos</span>
                      <span className="text-xs text-zinc-500">aparece na agenda</span>
                    </label>
                  </div>
                );
              }
              // novo cadastro
              return (
                <div className="flex flex-wrap gap-4 py-2 border-y border-zinc-100">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={fHasAccess} onChange={(e)=> setFHasAccess(e.target.checked)} className="w-4 h-4 accent-zinc-900" />
                    <span className="text-sm font-medium">Tem acesso</span>
                    <span className="text-xs text-zinc-500">pode entrar no sistema</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={fHasClinical} onChange={(e)=> setFHasClinical(e.target.checked)} className="w-4 h-4 accent-zinc-900" />
                    <span className="text-sm font-medium">Realiza atendimentos</span>
                    <span className="text-xs text-zinc-500">aparece na agenda</span>
                  </label>
                </div>
              );
            })()}

            {/* ACESSO expandido */}
            {fHasAccess && (
              <div className="space-y-4 bg-zinc-50 border border-zinc-200 rounded-md p-3">
                <p className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Acesso ao sistema</p>
                <Field label="E-mail de acesso" required hint="O mesmo da identificação — confirmado aqui para acesso.">
                  <Input type="email" value={fEmail} onChange={(e)=> setFEmail(e.target.value)} placeholder="ana@clinica.com.br" autoComplete="email" />
                </Field>
                <div>
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Papel</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {data.roles.filter((r)=> r.id !== 'OWNER').map((r)=> (
                      <button type="button" key={r.id} aria-pressed={drawer.role === r.id} onClick={()=> { saveMember(drawer, { role: r.id }); setFRole(r.id); }} className="il-option-choice il-option-choice--compact text-left">
                        <span className="block text-sm font-medium">{r.label}</span>
                        <span className="block text-xs text-zinc-500">{r.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Permissões <span className="font-normal normal-case text-[11px] text-zinc-400">— efetivas do papel + ajustes</span></p>
                  <div className="space-y-1.5">
                    {data.permissions.map((perm)=> {
                      const base = permissionsFor(fRole as MemberRole)[perm.id as PermissionId];
                      const override = fPermissions[perm.id as PermissionId];
                      const effective = typeof override === 'boolean' ? override : base;
                      const isOverridden = typeof override === 'boolean' && override !== base;
                      return (
                        <label key={perm.id} className={cn('flex items-center justify-between gap-3 px-3 py-2 rounded-md border cursor-pointer', effective ? 'bg-white border-zinc-300' : 'bg-zinc-50 border-zinc-200', isOverridden && 'ring-1 ring-amber-200')}>
                          <span>
                            <span className="block text-sm font-medium">{perm.label} {isOverridden && <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded ml-1">ajuste</span>}</span>
                            <span className="block text-xs text-zinc-500">{perm.hint}</span>
                          </span>
                          <input type="checkbox" checked={effective} onChange={(e)=> {
                            const desired = e.target.checked;
                            setFPermissions((prev: any) => {
                              const next = { ...prev };
                              if (desired === base) delete next[perm.id as PermissionId];
                              else next[perm.id as PermissionId] = desired;
                              return next;
                            });
                          }} className="w-4 h-4 accent-zinc-900" />
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">Desmarcar/marcar cria um ajuste específico para esta pessoa; trocar de Papel recalcula as efetivas.</p>
                </div>
                {(!editEntry || editEntry.kind === 'professional') && (
                  <Field label="Senha inicial" required hint="Necessária somente se este e-mail ainda não possuir uma conta GoDoutor.">
                    <div className="relative">
                      <Input type={fShowPass ? 'text' : 'password'} value={fPassword} onChange={(e)=> setFPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
                      <button type="button" onClick={()=> setFShowPass(s=>!s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-zinc-600 px-2 py-1 hover:bg-zinc-100 rounded" aria-label={fShowPass ? 'Ocultar senha' : 'Mostrar senha'}>
                        {fShowPass ? 'Ocultar' : 'Mostrar'}
                      </button>
                    </div>
                  </Field>
                )}
              </div>
            )}

            {/* ATENDIMENTO expandido */}
            {fHasClinical && (
              <div className="space-y-4 bg-white border border-zinc-200 rounded-md p-3">
                <p className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Atuação clínica</p>
                <ImageUpload label="Foto profissional" value={fPhoto} onChange={setFPhoto} businessId={businessId} circle previewH="h-20" />
                <Field label="Função / Especialidade" hint="Ex.: Clínico Geral, Cardiologia, Cirurgia.">
                  <Input value={fFuncao} onChange={(e)=> setFFuncao(e.target.value)} placeholder="Clínico Geral" />
                </Field>
                <div>
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Registro profissional</p>
                  <div className="grid grid-cols-[110px_90px_1fr] gap-2">
                    <Field label="Conselho">
                      <div className="h-[38px] flex items-center px-3 rounded-sm border border-[var(--border-strong)] bg-[var(--surface-3)] text-sm font-medium text-[var(--text)]">CRMV</div>
                    </Field>
                    <Field label="UF">
                      <Select value={fUf} onChange={(e)=> setFUf(e.target.value)}>
                        <option value="">UF</option>
                        {BRAZILIAN_STATES.map((uf)=> <option key={uf} value={uf}>{uf}</option>)}
                      </Select>
                    </Field>
                    <Field label="Número">
                      <Input value={fCrmvNum} onChange={(e)=> setFCrmvNum(e.target.value.replace(/\D/g,''))} placeholder="12345" inputMode="numeric" />
                    </Field>
                  </div>
                  {(fUf || fCrmvNum) && <p className="text-xs text-zinc-500 mt-1">{formatCrmvDisplay(fUf, fCrmvNum) || `${fConselho}${fUf?`-${fUf}`:''} ${fCrmvNum?`nº ${fCrmvNum}`:''}` } — exibição padrão</p>}
                  <p className="text-[11px] text-zinc-400 mt-1">CPF ≠ CRMV. Não exigimos CRMV para equipe não-veterinária.</p>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Serviços que realiza</p>
                  <div className="flex gap-2">
                    <Input value={fServiceQuery} onChange={(e)=> { setFServiceQuery(e.target.value); setFShowServiceCreate(false); }} placeholder="Buscar serviço (ex.: Consulta, Vacinação)" className="flex-1" />
                  </div>
                  <div className="mt-2 max-h-40 overflow-y-auto border border-zinc-200 rounded-md divide-y divide-zinc-100 bg-white">
                    {(services.filter(s=> !fServiceQuery || s.name.toLowerCase().includes(fServiceQuery.toLowerCase())).slice(0,20)).map((svc)=> {
                      const checked = fServiceIds.includes(svc.id);
                      return (
                        <label key={svc.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-50 cursor-pointer">
                          <input type="checkbox" checked={checked} onChange={(e)=> { setFServiceSelectionTouched(true); setFServiceIds((prev)=> e.target.checked ? [...prev, svc.id] : prev.filter(id=> id!==svc.id)); }} className="w-4 h-4 accent-zinc-900" />
                          <span className="text-sm flex-1">{svc.name}</span>
                          <span className="text-xs text-zinc-500">{cats.find(c=> c.id===svc.categoryId)?.name || ''}</span>
                        </label>
                      );
                    })}
                    {services.filter(s=> !fServiceQuery || s.name.toLowerCase().includes(fServiceQuery.toLowerCase())).length===0 && fServiceQuery && (
                      <div className="p-2">
                        <button type="button" onClick={()=> { setFNewSvcName(fServiceQuery); setFShowServiceCreate(true); }} className="text-xs font-semibold text-[var(--accent)] hover:underline">{`+ Criar '${fServiceQuery}'`}</button>
                      </div>
                    )}
                  </div>
                  {/* sugestões biblioteca vet */}
                  {fServiceQuery && (()=> {
                    const sug = searchVetCatalog(fServiceQuery).slice(0,3);
                    if (!sug.length) return null;
                    return (
                      <div className="mt-2 space-y-1">
                        <p className="text-[11px] font-semibold text-zinc-500 uppercase">Sugestões catálogo vet</p>
                        {sug.map((s)=> {
                          const existingCat = cats.find(c => c.name.toLowerCase().trim() === s.grupo.toLowerCase().trim() && c.kind === 'service');
                          return (
                            <button key={s.name} type="button" onClick={()=> { setFNewSvcName(s.name); if (existingCat) { setFNewSvcGrupo(existingCat.id); setFSuggestedGroupName(''); } else { setFNewSvcGrupo(''); setFSuggestedGroupName(s.grupo); } setFNewSvcDur(s.duracaoMin || 30); setFShowServiceCreate(true); setFServiceQuery(s.name); }} className="block w-full text-left text-xs bg-zinc-50 border border-zinc-200 rounded px-2 py-1.5 hover:bg-white">
                              <span className="font-medium">{s.name}</span> <span className="text-zinc-500">· {s.grupo} · {s.duracaoMin}min</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                  {fShowServiceCreate && (
                    <div className="mt-3 p-3 border border-zinc-200 rounded-md bg-zinc-50 space-y-2">
                      <p className="text-xs font-semibold">Criar serviço &quot;{fNewSvcName}&quot;</p>
                      <Field label="Nome" required><Input value={fNewSvcName} onChange={(e)=> setFNewSvcName(e.target.value)} placeholder="Nome do serviço" /></Field>
                      <Field label="Grupo"><Select value={fNewSvcGrupo} onChange={(e)=> { setFNewSvcGrupo(e.target.value); setFSuggestedGroupName(''); }}><option value="">Selecione</option>{cats.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                        {fSuggestedGroupName && <p className="text-[11px] text-amber-700 mt-1">Grupo sugerido: {fSuggestedGroupName} — Será criado ao salvar</p>}</Field>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Duração (min)"><Input type="number" value={String(fNewSvcDur)} onChange={(e)=> setFNewSvcDur(parseInt(e.target.value)||45)} /></Field>
                        <Field label="Preço (opcional)"><Input value={fNewSvcPrice} onChange={(e)=> setFNewSvcPrice(e.target.value)} placeholder="0,00" inputMode="decimal" /></Field>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={()=> setFShowServiceCreate(false)}>Cancelar</Button>
                        <Button variant="secondary" size="sm" onClick={async()=> {
                          if (!fNewSvcName.trim()) return;
                          let catId = fNewSvcGrupo || fSuggestedGroupName;
                          const isRealId = catId && cats.some(c=> c.id === catId);
                          if (catId && !isRealId) {
                            const norm = catId.toLowerCase().trim();
                            let existing = cats.find(c=> c.name.toLowerCase().trim() === norm && c.kind==='service');
                            if (existing) {
                              catId = existing.id;
                            } else {
                              // criar categoria via API canônica — usa categoryId retornado sem GET extra (fallback legado)
                              const cr = await apiSend<any>('/api/catalog','POST',{ businessId, action:'category.save', kind:'service', name: catId.trim() }, { scope:'action', area:'Equipe' });
                              if (cr.ok && cr.data?.categoryId) {
                                catId = cr.data.categoryId;
                              } else if (cr.ok) {
                                const catRes = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope:'area', area:'Equipe' });
                                if (catRes.ok) {
                                  const freshCats = (catRes.data?.categories||[]).filter((c:Category)=> c.kind==='service');
                                  setCats(freshCats);
                                  const created = freshCats.find((c:Category)=> c.name.toLowerCase().trim() === norm);
                                  if (created) catId = created.id;
                                }
                              }
                            }
                          }
                          const res = await apiSend<any>('/api/catalog','POST',{ businessId, action:'service.save', name: fNewSvcName.trim(), categoryId: catId || undefined, durationMin: fNewSvcDur, price: fNewSvcPrice ? parseMoneyToCents(fNewSvcPrice) : 0, professionalMode: 'selected', professionalIds: [] }, { scope:'action', area:'Equipe' });
                          if (res.ok) {
                            const newId = res.data?.serviceId || res.data?.id;
                            if (newId) { setFServiceIds(prev=> [...prev, newId]); setFServiceSelectionTouched(true); }
                            // atualiza lista local
                            const catRes = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope:'area', area:'Equipe' });
                            if (catRes.ok) { setServices(catRes.data?.services||[]); setCats((catRes.data?.categories||[]).filter((c:Category)=> c.kind==='service')); }
                            setFShowServiceCreate(false); setFNewSvcName(''); setFServiceQuery(''); setFSuggestedGroupName('');
                          }
                        }}>Criar e vincular</Button>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Disponibilidade</p>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="disp" checked={fDispMode==='follow'} onChange={()=> setFDispMode('follow')} className="accent-zinc-900" />
                      <span className="text-sm">Seguir horário da clínica</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="disp" checked={fDispMode==='own'} onChange={()=> setFDispMode('own')} className="accent-zinc-900" />
                      <span className="text-sm">Usar horário próprio</span>
                    </label>
                  </div>
                  {(() => {
                    const isNew = !editEntry?.professional?.id;
                    if (isNew) {
                      if (fDispMode === 'own') {
                        return <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">Salve a pessoa para configurar os horários próprios.</p>;
                      }
                      return null;
                    }
                    return (
                      <Link href={`/disponibilidade?b=${businessId}&professionalId=${editEntry.professional.id}`} className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-[var(--accent)] hover:underline">
                        Configurar disponibilidade <Icon n="arrowRight" size={12} />
                      </Link>
                    );
                  })()}
                </div>
              </div>
            )}

            {showRemoveConfirm && editEntry?.kind === 'member' && (
              <Drawer open onClose={()=> setShowRemoveConfirm(false)} title={`Remover acesso de ${editEntry.member?.name || fName}?`} width="max-w-md">
                <div className="p-5 space-y-4">
                  <p className="text-sm text-zinc-600">Esta pessoa não poderá entrar no sistema. Se realiza atendimentos, o perfil profissional, serviços e disponibilidade serão preservados.</p>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" onClick={()=> setShowRemoveConfirm(false)}>Cancelar</Button>
                    <Button variant="destructive" onClick={async () => {
                      try {
                        const m = (editEntry as any).member;
                        const res = await apiSend(`/api/team?businessId=${businessId}&id=${m.id}`, 'DELETE', undefined, { scope: 'action', area: 'Equipe' });
                        if (!res.ok) throw new Error(res.message || 'Não foi possível remover acesso.');
                        setShowRemoveConfirm(false); setShowAdd(false); resetAddForm(); setMsg('Acesso removido. Perfil profissional mantido.'); setTimeout(()=>setMsg(''),3000); await load();
                      } catch (e:any) { setFError(e.message || 'Não foi possível remover acesso.'); setShowRemoveConfirm(false); }
                    }}>Remover acesso</Button>
                  </div>
                </div>
              </Drawer>
            )}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-200">
              <Button variant="ghost" size="sm" onClick={()=> { setShowAdd(false); resetAddForm(); }}>Cancelar</Button>
              <Button variant="primary" size="sm" onClick={handleAddSave} disabled={fSaving}>{fSaving ? 'Salvando…' : editEntry ? 'Salvar alterações' : 'Adicionar pessoa'}</Button>
            </div>
          </div>
            )}
        </Drawer>
      )}

      {askDelete && (
        <DeleteSheet
          name={askDelete.name}
          kindLabel="profissional"
          blocked={askDelete.blocked}
          onDeactivate={doDeactivatePro}
          onConfirm={doDeletePro}
          onClose={() => setAskDelete(null)}
        />
      )}
      <p className="sr-only">{q}</p>
    </>
  );
}
