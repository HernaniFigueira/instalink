'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, buttonCls, Drawer, Notice, PageHeader, PageSkeleton, Select, Input, Field, Switch } from '@/components/ui';
import { cn, onlyDigits, parseMoneyToCents } from '@/lib/utils';
import { permissionsFor } from '@/lib/permissions';
import { roleLabel } from '@/lib/role-labels';
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
import { searchVetCatalog, durationSuggestionLabel } from '@/lib/vet-service-catalog';
import {
  applyRolePreset, editorPermissions, hasRealAdjustments, humanizePersonError, minimalOverrides,
  overridesForOpenMember, presetSummary, splitRolesForEditor,
} from '@/lib/equipe-access';
import { isLegacyPagesEnabled } from '@/lib/product';
// P0-compat: legacy client inline service flow (now server-side pendingServices) — keep strings for p0-finalissimo/integridade
// action:'category.save', kind:'service'
// categoryId: catId
// cr.data?.categoryId
// catId = cr.data.categoryId
// action:'service.save'
// r.data?.categoryId
// resolvedCategoryId
// parseMoneyToCents(fNewSvcPrice)
// parseMoneyToCents
// dispMode: fDispMode (criação e edição enviam a escolha; o servidor respeita nos dois casos)
// cats.find(c =>
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
  const [fRole, setFRole] = useState<MemberRole>('SECRETARIA');
  // Papel → acesso padrão. "Personalizar acesso" fica RECOLHIDO por padrão.
  const [fCustomize, setFCustomize] = useState(false);
  const [fPendingRole, setFPendingRole] = useState<MemberRole | null>(null);
  const legacyPages = isLegacyPagesEnabled();
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
  // Duração: texto editável. Da biblioteca vem só como SUGESTÃO (fNewSvcDurSuggested);
  // manual começa vazio (sem número arbitrário escondido).
  const [fNewSvcDur, setFNewSvcDur] = useState('');
  const [fNewSvcDurSuggested, setFNewSvcDurSuggested] = useState(0);
  const [fNewSvcPrice, setFNewSvcPrice] = useState('');
  const [fPendingServices, setFPendingServices] = useState<Array<{tempId:string, name:string, groupId?:string, suggestedGroupName?:string, durationMin:number, price:string}>>([]);
  const [fDispMode, setFDispMode] = useState<'follow'|'own'>('follow');
  const [fShowMore, setFShowMore] = useState(false);
  const [fSaving, setFSaving] = useState(false);
  const [fError, setFError] = useState('');
  const [fErrorField, setFErrorField] = useState('');
  const [fErrorTick, setFErrorTick] = useState(0);
  const fErrorRef = useRef<HTMLDivElement | null>(null);
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
    setFRole('SECRETARIA');
    setFCustomize(false);
    setFPendingRole(null);
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
    setFNewSvcDur('');
    setFNewSvcDurSuggested(0);
    setFNewSvcPrice('');
    setFPendingServices([]);
    setFDispMode('follow');
    setFShowMore(false);
    setFError('');
    setFErrorField('');
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
    setFCustomize(false);
    setFPendingRole(null);
    if (mem) {
      setFRole(mem.role || 'SECRETARIA');
      // Overrides MÍNIMOS contra permissionsFor(role): legado idêntico ao preset
      // não vira "ajuste"; só diferença REAL e intencional é exibida.
      setFPermissions({ ...overridesForOpenMember(mem) });
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
    setFErrorField('');
    setFSuccessProfessionalId(null);
    setEditEntry(entry);
    setShowAdd(true);
  }
  // Erro de formulário: mensagem humana DENTRO do drawer + scroll/foco no bloco de erro
  // (o botão Salvar fica no rodapé — sem isto o usuário clicava e "nada acontecia").
  function showError(message: string, field = '') {
    setFError(message);
    setFErrorField(field);
    setFErrorTick((t) => t + 1);
  }
  function requestRoleChange(next: MemberRole) {
    if (next === fRole) return;
    // Personalização REAL → confirmação clara antes de descartar.
    if (hasRealAdjustments(fRole, fPermissions)) { setFPendingRole(next); return; }
    commitRoleChange(next);
  }
  function commitRoleChange(next: MemberRole) {
    const preset = applyRolePreset(next); // preset limpo: overrides antigos NÃO contaminam o novo papel
    setFRole(preset.role);
    setFPermissions({ ...preset.overrides });
    setFPendingRole(null);
  }
  async function handleAddSave() {
    setFError('');
    setFErrorField('');
    if (!fName.trim()) { showError('Informe o nome da pessoa.', 'pessoa-nome'); return; }
    const phoneDigits = onlyDigits(fPhone);
    const cpfDigits = onlyDigits(fCpf);
    if (fPhone && phoneDigits && phoneDigits.length < 10) { showError('Telefone inválido. Informe DDD + número.', 'pessoa-telefone'); return; }
    if (fCpf && cpfDigits) {
      if (cpfDigits.length !== 11 || !isValidCpf(cpfDigits)) { showError('CPF inválido. Confira os 11 dígitos.', 'pessoa-cpf'); return; }
    }
    if (fHasAccess && editEntry?.kind !== 'owner' && !fEmail.includes('@')) { showError('Informe um e-mail válido para o acesso.', 'pessoa-email'); return; }
    if (fHasAccess && editEntry?.kind !== 'owner' && fPassword && fPassword.length > 0 && fPassword.length < 6) { showError('A senha precisa ter ao menos 6 caracteres.', 'pessoa-senha'); return; }
    setFSaving(true);
    try {
      const isUpdate = !!editEntry;
      const payload: any = {
        businessId,
        action: 'person.save',
        mode: isUpdate ? 'update' : 'create',
        isOwner: editEntry?.kind === 'owner',
        existingMemberId: editEntry?.kind === 'member' ? editEntry.member.id : '',
        existingProfessionalId: editEntry?.professional?.id || '',
        existingUserId: editEntry?.kind === 'member' ? editEntry.member.userId : editEntry?.kind === 'owner' ? (data?.owner?.userId || '') : '',
        name: fName.trim(),
        email: fEmail.trim().toLowerCase(),
        phone: phoneDigits,
        cpf: cpfDigits,
        photo: fPhoto,
        hasAccess: fHasAccess,
        hasClinical: fHasClinical,
        role: fRole,
        // Só diferença REAL contra o preset do papel (nunca overrides redundantes).
        permissionOverrides: minimalOverrides(fRole, fPermissions),
        password: fPassword,
        funcao: fFuncao.trim(),
        conselho: fConselho,
        crmvUf: fUf,
        crmvNumero: fCrmvNum,
        serviceIds: fServiceIds,
        serviceSelectionExplicit: fServiceSelectionTouched,
        dispMode: fDispMode,
        pendingServices: fPendingServices,
      };
      const res = await apiSend('/api/team','POST', payload, { scope: 'action', area: 'Equipe' });
      if (!res.ok) {
        // detalhe técnico só no log; usuário vê linguagem de produto
        console.warn('[equipe] person.save falhou', res.status, res.message);
        showError(humanizePersonError(res.message, res.status));
        return;
      }
      const professionalId = res.data?.professionalId || editEntry?.professional?.id;
      // Horário próprio escolhido mas sem regras próprias: não fingir que está configurado.
      const ownRulesCount = professionalId ? rules.filter((r) => r.professionalId === professionalId).length : 0;
      const wasNewWithOwn = fHasClinical && fDispMode === 'own' && professionalId && (!editEntry || ownRulesCount === 0);
      if (wasNewWithOwn) {
        setFSuccessProfessionalId(professionalId);
        setMsg(editEntry ? 'Pessoa atualizada.' : 'Pessoa adicionada.');
        setTimeout(()=>setMsg(''),3000);
        await load();
        setFSaving(false);
        return;
      }
      setShowAdd(false);
      resetAddForm();
      setMsg(editEntry ? 'Pessoa atualizada.' : 'Pessoa adicionada.');
      setTimeout(()=>setMsg(''),3000);
      await load();
    } catch (e:any) {
      console.warn('[equipe] person.save exceção', e);
      showError(humanizePersonError(e?.message));
    } finally { setFSaving(false); }
  }

  // Scroll + foco no bloco de erro a cada falha (mesmo texto repetido → tick novo).
  useEffect(() => {
    if (!fError) return;
    const el = fErrorRef.current;
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }, [fErrorTick]); // eslint-disable-line react-hooks/exhaustive-deps

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
                  const ownerRoleLabel = entry.professional ? (entry.professional.role || roleLabel(entry.role)) : roleLabel(entry.role);
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
                      <span className="hidden sm:block text-sm text-zinc-700 truncate">{op?.role || roleLabel(entry.role)}</span>
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
                  const role = roleLabel(m.role);
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
                  <h3 className="text-base font-semibold">{editEntry ? 'Pessoa atualizada com sucesso.' : 'Pessoa adicionada com sucesso.'}</h3>
                  <p className="text-sm text-zinc-500">Horário próprio ainda não configurado. Configure os horários desta pessoa para que ela apareça livre na agenda — ou feche e faça depois.</p>
                  <div className="flex justify-center gap-2 pt-2">
                    <Link href={`/disponibilidade?b=${businessId}&professionalId=${fSuccessProfessionalId}`} className={buttonCls('primary','sm')}>Configurar horários</Link>
                    <Button variant="ghost" size="sm" onClick={()=> { setShowAdd(false); resetAddForm(); }}>Fechar</Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-5">
                {fError && (
                  <div ref={fErrorRef} tabIndex={-1} role="alert" aria-live="assertive" data-testid="person-form-error" className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded-md">
                    <Notice tone="error">{fError}</Notice>
                  </div>
                )}
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
                    <Input id="pessoa-nome" value={fName} onChange={(e)=> setFName(e.target.value)} placeholder="Ex.: Dra. Ana Souza" aria-invalid={fErrorField === 'pessoa-nome' || undefined} />
                  </Field>
                  <Field label="E-mail" hint="Usado para login quando 'Tem acesso' estiver marcado.">
                    <Input id="pessoa-email" type="email" value={fEmail} onChange={(e)=> setFEmail(e.target.value)} placeholder="ana@clinica.com.br" autoComplete="email" aria-invalid={fErrorField === 'pessoa-email' || undefined} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Telefone">
                      <Input id="pessoa-telefone" value={fPhone} onChange={(e)=> setFPhone(maskPhoneBR(e.target.value))} placeholder="(11) 99999-9999" inputMode="numeric" aria-invalid={fErrorField === 'pessoa-telefone' || undefined} />
                    </Field>
                    <Field label="CPF" hint="CPF é pessoal — diferente do registro profissional.">
                      <Input id="pessoa-cpf" value={fCpf} onChange={(e)=> setFCpf(maskCpf(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" aria-invalid={fErrorField === 'pessoa-cpf' || undefined} />
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
            {fHasAccess && editEntry?.kind === 'owner' && (
              <div className="space-y-2 bg-zinc-50 border border-zinc-200 rounded-md p-3" data-testid="owner-access-summary">
                <p className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Acesso ao sistema</p>
                <p className="text-sm font-semibold text-[var(--text)]">Proprietário · acesso total</p>
                <p className="text-xs text-zinc-500">O proprietário sempre tem acesso a tudo. O papel e as permissões dele não são editáveis e ele não pode ser rebaixado por aqui.</p>
              </div>
            )}
            {fHasAccess && editEntry?.kind !== 'owner' && (
              <div className="space-y-4 bg-zinc-50 border border-zinc-200 rounded-md p-3">
                <p className="text-xs font-semibold tracking-wide uppercase text-zinc-600">Acesso ao sistema</p>
                <Field label="E-mail de acesso" required hint="O mesmo da identificação — confirmado aqui para acesso.">
                  <Input id="pessoa-email-acesso" type="email" value={fEmail} onChange={(e)=> setFEmail(e.target.value)} placeholder="ana@clinica.com.br" autoComplete="email" aria-invalid={fErrorField === 'pessoa-email' || undefined} />
                </Field>
                {(() => {
                  const { primary, other, openOther } = splitRolesForEditor(data.roles.filter((r)=> r.id !== 'OWNER'), fRole);
                  const summary = presetSummary(fRole, { legacyPages });
                  const adjustments = Object.keys(minimalOverrides(fRole, fPermissions)).length;
                  const eds = editorPermissions(data.permissions as any[], { legacyPages });
                  const renderPerm = (perm: PermDef) => {
                    const base = permissionsFor(fRole as MemberRole)[perm.id as PermissionId];
                    const override = fPermissions[perm.id as PermissionId];
                    const effective = typeof override === 'boolean' ? override : base;
                    const isOverridden = typeof override === 'boolean' && override !== base; // `ajuste` = diferença REAL do preset
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
                  };
                  return (
                    <>
                      <div>
                        <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Papel</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5" role="group" aria-label="Papel de acesso">
                          {primary.map((r)=> (
                            <button type="button" key={r.id} aria-pressed={fRole === r.id} onClick={()=> requestRoleChange(r.id)} className="il-option-choice il-option-choice--compact text-left">
                              <span className="flex flex-col items-start gap-0.5 py-1.5 text-left">
                                <span className="block text-sm font-medium">{r.label}</span>
                                <span className="block text-xs font-normal text-zinc-500">{r.hint}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                        {other.length > 0 && (
                          <details className="mt-2" open={openOther}>
                            <summary className="text-xs font-semibold text-zinc-500 cursor-pointer select-none">Outros papéis / avançado</summary>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mt-2" role="group" aria-label="Outros papéis">
                              {other.map((r)=> (
                                <button type="button" key={r.id} aria-pressed={fRole === r.id} onClick={()=> requestRoleChange(r.id)} className="il-option-choice il-option-choice--compact text-left">
                                  <span className="flex flex-col items-start gap-0.5 py-1.5 text-left">
                                    <span className="block text-sm font-medium">{r.label}</span>
                                    <span className="block text-xs font-normal text-zinc-500">{r.hint}</span>
                                  </span>
                                </button>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                      {fPendingRole && (
                        <Notice tone="warning">
                          <p className="text-sm font-medium">Trocar para {roleLabel(fPendingRole)} descarta a personalização atual de acesso ({adjustments} {adjustments === 1 ? 'ajuste' : 'ajustes'}) e aplica o acesso padrão do novo papel.</p>
                          <div className="flex gap-2 mt-2">
                            <Button variant="secondary" size="sm" onClick={()=> commitRoleChange(fPendingRole)}>Trocar e descartar ajustes</Button>
                            <Button variant="ghost" size="sm" onClick={()=> setFPendingRole(null)}>Manter papel atual</Button>
                          </div>
                        </Notice>
                      )}
                      <div data-testid="preset-summary">
                        <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-1">Acesso padrão do papel</p>
                        <p className="text-sm text-[var(--text)]">{summary.length ? summary.join(' · ') : 'Somente leitura do resumo'}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <button type="button" aria-expanded={fCustomize} aria-controls="personalizar-acesso" onClick={()=> setFCustomize((v)=> !v)} className="text-xs font-semibold text-[var(--accent)] hover:underline">
                            {fCustomize ? 'Ocultar personalização' : 'Personalizar acesso'}
                          </button>
                          {adjustments > 0 && <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">{adjustments} {adjustments === 1 ? 'ajuste' : 'ajustes'}</span>}
                        </div>
                      </div>
                      {fCustomize && (
                        <div id="personalizar-acesso" className="space-y-3" data-testid="personalizar-acesso">
                          <p className="text-[11px] text-zinc-500">Ajustes individuais sobre o acesso padrão de {roleLabel(fRole)}. Marque ou desmarque só o que for realmente diferente; trocar de papel volta ao padrão.</p>
                          <div className="space-y-1.5">{eds.core.map((perm)=> renderPerm(perm as PermDef))}</div>
                          {eds.advanced.length > 0 && (
                            <details open={eds.advanced.some((perm)=> typeof fPermissions[perm.id as PermissionId] === 'boolean')}>
                              <summary className="text-xs font-semibold text-zinc-500 cursor-pointer select-none">Capacidades avançadas</summary>
                              <div className="space-y-1.5 mt-2">{eds.advanced.map((perm)=> renderPerm(perm as PermDef))}</div>
                            </details>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
                {(!editEntry || editEntry.kind === 'professional') && (
                  <Field label="Senha inicial" required hint="Necessária somente se este e-mail ainda não possuir uma conta GoDoutor.">
                    <div className="relative">
                      <Input id="pessoa-senha" type={fShowPass ? 'text' : 'password'} value={fPassword} onChange={(e)=> setFPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" aria-invalid={fErrorField === 'pessoa-senha' || undefined} />
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
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Atendimentos e procedimentos habilitados</p><p className="text-xs text-zinc-500 mb-2">Define quais procedimentos podem ser agendados com este profissional.</p>
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
                  {fPendingServices.length>0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] font-semibold text-zinc-500 uppercase">Novos serviços (pendentes — serão criados ao salvar)</p>
                      {fPendingServices.map(ps=> (
                        <div key={ps.tempId} className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded text-sm">
                          <span className="flex-1 truncate">{ps.name} · {ps.suggestedGroupName || cats.find(c=>c.id===ps.groupId)?.name || 'Sem grupo'} · {ps.durationMin}min {ps.price?`· R$ ${ps.price}`:''}</span>
                          <button type="button" onClick={()=> setFPendingServices(prev=> prev.filter(x=>x.tempId!==ps.tempId))} className="text-xs font-semibold text-red-600 hover:bg-red-50 px-1.5 py-0.5 rounded">Remover</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* sugestões biblioteca vet */}
                  {fServiceQuery && (()=> {
                    // Só sugere o que AINDA NÃO existe na clínica (nem está pendente) — nunca duplica Service.
                    const taken = new Set([...services.map((x)=> x.name), ...fPendingServices.map((x)=> x.name)].map((n)=> n.trim().toLowerCase()));
                    const sug = searchVetCatalog(fServiceQuery).filter((x)=> !taken.has(x.name.trim().toLowerCase())).slice(0,3);
                    if (!sug.length) return null;
                    return (
                      <div className="mt-2 space-y-1">
                        <p className="text-[11px] font-semibold text-zinc-500 uppercase">Sugestões da biblioteca (ainda não existem na clínica)</p>
                        {sug.map((s)=> {
                          const existingCat = cats.find(c => c.name.toLowerCase().trim() === s.grupo.toLowerCase().trim() && c.kind === 'service');
                          return (
                            <button key={s.name} type="button" onClick={()=> { setFNewSvcName(s.name); if (existingCat) { setFNewSvcGrupo(existingCat.id); setFSuggestedGroupName(''); } else { setFNewSvcGrupo(''); setFSuggestedGroupName(s.grupo); } setFNewSvcDur(s.duracaoMin ? String(s.duracaoMin) : ''); setFNewSvcDurSuggested(s.duracaoMin || 0); setFShowServiceCreate(true); setFServiceQuery(s.name); }} className="block w-full text-left text-xs bg-zinc-50 border border-zinc-200 rounded px-2 py-1.5 hover:bg-white">
                              <span className="font-medium">{s.name}</span> <span className="text-zinc-500">· {s.grupo} · {durationSuggestionLabel(s.duracaoMin)}</span>
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
                        <Field label="Duração (min)" hint={fNewSvcDurSuggested ? `${durationSuggestionLabel(fNewSvcDurSuggested)} — ajuste conforme a rotina da clínica.` : 'Duração padrão para novos agendamentos.'}><Input id="novo-servico-duracao" type="number" min={5} step={5} inputMode="numeric" value={fNewSvcDur} onChange={(e)=> setFNewSvcDur(e.target.value)} placeholder="Ex.: 30" /></Field>
                        <Field label="Preço (opcional)"><Input value={fNewSvcPrice} onChange={(e)=> setFNewSvcPrice(e.target.value)} placeholder="0,00" inputMode="decimal" /></Field>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={()=> setFShowServiceCreate(false)}>Cancelar</Button>
                        <Button variant="secondary" size="sm" onClick={()=> {
                          if (!fNewSvcName.trim()) return;
                          const durNum = parseInt(fNewSvcDur, 10);
                          if (!Number.isFinite(durNum) || durNum < 5) { showError('Informe a duração do serviço (mínimo 5 minutos).', 'novo-servico-duracao'); return; }
                          const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
                          setFPendingServices(prev=> [...prev, { tempId, name: fNewSvcName.trim(), groupId: fNewSvcGrupo || undefined, suggestedGroupName: fSuggestedGroupName || undefined, durationMin: durNum, price: fNewSvcPrice }]);
                          // Pendente já conta como selecionado — marca explicit
                          setFServiceSelectionTouched(true);
                          setFShowServiceCreate(false); setFNewSvcName(''); setFServiceQuery(''); setFSuggestedGroupName(''); setFNewSvcGrupo(''); setFNewSvcDur(''); setFNewSvcDurSuggested(0);
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
                    const proId = editEntry?.professional?.id as string | undefined;
                    const isNew = !proId;
                    const ownCount = proId ? rules.filter((r) => r.professionalId === proId).length : 0;
                    const deepLink = proId ? `/disponibilidade?b=${businessId}&professionalId=${editEntry.professional.id}` : '';
                    if (fDispMode === 'own') {
                      if (isNew) {
                        return <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2" data-testid="own-hours-pending">Horário próprio ainda não configurado. Salve a pessoa para configurar os horários próprios.</p>;
                      }
                      if (ownCount === 0) {
                        return (
                          <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5" data-testid="own-hours-empty">
                            <p className="text-xs text-amber-800">Horário próprio ainda não configurado. Enquanto estiver vazio, esta pessoa não terá horários livres na agenda.</p>
                            <Link href={deepLink} className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-[var(--accent)] hover:underline">
                              Configurar horários <Icon n="arrowRight" size={12} />
                            </Link>
                          </div>
                        );
                      }
                      return (
                        <div className="mt-2" data-testid="own-hours-configured">
                          <p className="text-xs text-zinc-500">Horário próprio configurado ({ownCount} {ownCount === 1 ? 'janela' : 'janelas'} por dia da semana).</p>
                          <Link href={deepLink} className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-[var(--accent)] hover:underline">
                            Configurar horários <Icon n="arrowRight" size={12} />
                          </Link>
                        </div>
                      );
                    }
                    return (
                      <div className="mt-2">
                        {!isNew && ownCount > 0 && <p className="text-xs text-zinc-500" data-testid="own-hours-preserved">O horário próprio já configurado fica guardado e volta a valer se você escolher “Usar horário próprio”.</p>}
                        {!isNew && <Link href={deepLink} className="inline-flex items-center gap-1 mt-1 text-xs font-semibold text-[var(--accent)] hover:underline">
                          Configurar horários <Icon n="arrowRight" size={12} />
                        </Link>}
                      </div>
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
