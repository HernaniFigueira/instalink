'use client';
// ═══════════════════════════════════════════════════════════════
// PAINÉIS DE CATÁLOGO — compartilhados entre Serviços / Profissionais / Disponibilidade
// ═══════════════════════════════════════════════════════════════
// A mesma fonte de dados (/api/catalog) alimenta as três telas do
// Atendimento: o que eu ofereço (Serviços), quem atende (Profissionais) e
// quando atende (Disponibilidade). Conceitos SEPARADOS na interface — nunca
// uma tela confusa que esconde os três.
//
// A1.2 · Bloco 2: as REGRAS DE RESERVA (BookingSettings) saíram daqui —
// "como o cliente reserva" é configuração do negócio e mora em Configurações
// → aba Agenda. Disponibilidade ficou só com "quando atende".
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn, parseMoneyToCents, centsToBR } from '@/lib/utils';
import { apiSend } from '@/lib/api-client';
import type { Availability, AvailabilityException, ScheduleResource, Category, Professional, Service } from '@/lib/types';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, Drawer } from '@/components/ui';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { followsBusinessHours } from '@/lib/schedule';
import { useOverlayDismissGuard } from '@/components/dashboard/OverlayDismissGuard';
import { panelRoutesIn } from '@/lib/panel';
import { searchVetCatalog, VET_CATALOG, durationSuggestionLabel } from '@/lib/vet-service-catalog';
import { serviceProfessionalMode } from '@/lib/booking';

// ── Confirmação de exclusão (em sheet, nunca confirm() nativo) ──
export function DeleteSheet({ name, kindLabel, blocked, onDeactivate, onConfirm, onClose }: {
  name: string; kindLabel: string; blocked: boolean;
  onDeactivate: () => void; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Drawer open onClose={onClose} title={`Excluir ${kindLabel}`} width="max-w-md">
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-xl p-6 space-y-3">
        <h3 className="font-semibold text-lg">Excluir {kindLabel} “{name}”?</h3>
        {blocked ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-4 py-3">
            Este registro possui histórico e não pode ser excluído. Desative-o para removê-lo da agenda, mas o histórico permanece íntegro.
          </p>
        ) : (
          <p className="text-sm text-zinc-500">Sem agendamentos vinculados. A exclusão não afeta o histórico.</p>
        )}
        <div className="space-y-2 pt-1">
          {blocked && (
            <Button variant="primary" size="lg" className="w-full" onClick={onDeactivate}>Desativar</Button>
          )}
          {!blocked && (
            <button onClick={onConfirm} className="w-full font-semibold bg-red-50 text-red-600 py-3 rounded-md">Excluir</button>
          )}
          <button onClick={onClose} className="w-full font-semibold bg-zinc-100 py-3 rounded-md">Cancelar</button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Formulário de serviço ──
export function ServiceForm({ businessId, service, cats, pros, resources = [], onClose, onSave }: {
  businessId: string;
  service: Service | null;
  resources?: ScheduleResource[];
  cats: Category[];
  pros: Professional[];
  onClose: () => void;
  onSave: (p: Record<string, any>) => Promise<void>;
}) {
  const [name, setName] = useState(service?.name || '');
  const [description, setDescription] = useState(service?.description || '');
  // Foto removida (Clinical Structure Consolidation): campo image permanece no DB por compatibilidade,
  // mas não é exposto nem editado na UI clínica — serviço é operacional, não exposição pública.
  const image = service?.image || '';
  const [price, setPrice] = useState(service ? centsToBR(service.price) : '');
  // Duração padrão: texto editável. Serviço novo começa VAZIO (nenhum número arbitrário
  // escondido); a biblioteca só SUGERE (durSuggested) e a clínica decide.
  const [durationText, setDurationText] = useState(service ? String(service.durationMin || '') : '');
  const [durSuggested, setDurSuggested] = useState(0);
  const durationMin = parseInt(durationText, 10) || 0;
  const [categoryId, setCategoryId] = useState(service?.categoryId || '');
  const [suggestedGroupName, setSuggestedGroupName] = useState('');
  const [professionalMode, setProfessionalMode] = useState<'all' | 'selected'>(service ? serviceProfessionalMode(service as any) : 'all');
  const [proIds, setProIds] = useState<string[]>(service?.professionalIds || []);
  const [active, setActive] = useState(service?.active !== false);
  const [bookable, setBookable] = useState(service?.bookable !== false);
  const [before, setBefore] = useState(service?.bufferBeforeMin === undefined ? '' : String(service.bufferBeforeMin));
  const [after, setAfter] = useState(service?.bufferAfterMin === undefined ? '' : String(service.bufferAfterMin));
  const [resourceIds, setResourceIds] = useState(service?.resourceRequirements?.[0] || []);
  // questions removidas da UI clínica — preservadas no banco por compatibilidade (não enviadas daqui)
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const suggestionRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showSug) return;
    // Native scrollbar dragging can focus the enclosing <dialog>. That focus
    // is not an outside interaction: preserve the popup for the whole gesture.
    let pointerInside = false;
    const outside = (event: PointerEvent) => {
      pointerInside = !!suggestionRoot.current?.contains(event.target as Node);
      if (!pointerInside) setShowSug(false);
    };
    const pointerEnd = () => { pointerInside = false; };
    const focusOutside = (event: FocusEvent) => {
      if (!pointerInside && !suggestionRoot.current?.contains(event.target as Node)) setShowSug(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    document.addEventListener('pointerup', pointerEnd);
    document.addEventListener('pointercancel', pointerEnd);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focusOutside);
      document.removeEventListener('pointerup', pointerEnd);
      document.removeEventListener('pointercancel', pointerEnd);
    };
  }, [showSug]);
  const initialSnapshot = useRef(JSON.stringify({
    name: service?.name || '', description: service?.description || '',
    price: service ? centsToBR(service.price) : '',
    durationMin: service ? (service.durationMin || 0) : 0, categoryId: service?.categoryId || '', suggestedGroupName: '',
    professionalMode: service ? serviceProfessionalMode(service as any) : 'all',
    proIds: service?.professionalIds || [], active: service?.active !== false,
    bookable: service?.bookable !== false, before: service?.bufferBeforeMin === undefined ? '' : String(service.bufferBeforeMin), after: service?.bufferAfterMin === undefined ? '' : String(service.bufferAfterMin), resourceIds: service?.resourceRequirements?.[0] || [],
  }));
  const dirty = JSON.stringify({ name, description, price, durationMin, categoryId, suggestedGroupName, professionalMode, proIds, active, bookable, before, after, resourceIds }) !== initialSnapshot.current;
  const sugList = name.trim().length >= 2 ? searchVetCatalog(name, 12) : VET_CATALOG;
  const dismissState = {
    dirty, saving: loading, context: 'edit' as const,
    title: service ? 'Descartar alterações do serviço?' : 'Descartar novo serviço?',
    description: 'As informações preenchidas ainda não foram salvas.',
  };
  const input = 'w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  function chooseSuggestion(s: typeof VET_CATALOG[number]) {
    setName(s.name); setDurationText(s.duracaoMin ? String(s.duracaoMin) : ''); setDurSuggested(s.duracaoMin || 0);
    const match = cats.find(c => c.name.toLowerCase().trim() === s.grupo.toLowerCase().trim());
    setCategoryId(match?.id || ''); setSuggestedGroupName(match ? '' : s.grupo);
    setShowSug(false); setSuggestionIndex(-1);
  }

  function togglePro(id: string) {
    setProIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }

  return (
    <Drawer open onClose={() => { if (!loading) onClose(); }} dismissGuard={dismissState} title={service ? 'Editar serviço' : 'Novo serviço'} width="max-w-lg">
      <form onSubmit={async (e) => { e.preventDefault(); setError(''); if (durationMin < 5) { setError('Informe a duração padrão do serviço (mínimo 5 minutos).'); return; } setLoading(true); try { let resolvedCategoryId: string | undefined = categoryId || undefined; if (!resolvedCategoryId && suggestedGroupName) { const r:any = await apiSend('/api/catalog','POST',{ businessId, action:'category.save', kind:'service', name: suggestedGroupName.trim() },{ scope:'action', area:'Serviços' }); if (!r.ok || !r.data?.categoryId) throw new Error(r.message || 'Não foi possível criar o grupo sugerido.'); resolvedCategoryId = r.data.categoryId; } await onSave({ id: service?.id, name, description, image, price: parseMoneyToCents(price), durationMin, professionalMode, professionalIds: professionalMode === 'all' ? [] : proIds, categoryId: resolvedCategoryId, active, bookable, bufferBeforeMin: before === '' ? null : Number(before), bufferAfterMin: after === '' ? null : Number(after), resourceRequirements: resourceIds.length ? [resourceIds] : [] }); } catch (err:any) { setError(err.message || 'Falha ao salvar.'); } finally { setLoading(false); } }}
        className="p-5 space-y-3.5">
        <div className="relative" ref={suggestionRoot} onKeyDown={e => { if (e.key === 'Escape' && showSug) { e.preventDefault(); e.stopPropagation(); setShowSug(false); } }}>
          <label className="block text-xs font-semibold mb-1" htmlFor="clinical-service-name">Serviço / procedimento</label>
          <p className="text-xs text-zinc-500 mb-2">Escolha na biblioteca veterinária ou digite livremente.</p>
          <input id="clinical-service-name" role="combobox" aria-expanded={showSug && sugList.length > 0} aria-controls="clinical-service-suggestions" aria-activedescendant={showSug && suggestionIndex >= 0 ? `clinical-suggestion-${sugList[suggestionIndex]?.id}` : undefined} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setShowSug(true); setSuggestionIndex(i => Math.max(0, Math.min(sugList.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); } else if (e.key === 'Enter' && showSug && suggestionIndex >= 0 && sugList[suggestionIndex]) { e.preventDefault(); chooseSuggestion(sugList[suggestionIndex]); } else if (e.key === 'Escape' && showSug) { e.preventDefault(); e.stopPropagation(); setShowSug(false); } }} aria-autocomplete="list" autoComplete="off" aria-label="Serviço / procedimento" value={name} onChange={(e) => { setName(e.target.value); setShowSug(true); setSuggestionIndex(-1); }} onFocus={()=>setShowSug(true)}  className={input} placeholder="Buscar procedimento ou digitar novo…" autoFocus />
          {showSug && sugList.length > 0 && (
            <div id="clinical-service-suggestions" role="listbox" aria-label="Biblioteca veterinária" className="absolute z-10 mt-1 w-full bg-white border border-zinc-200 rounded-md shadow-lg max-h-48 overflow-auto">
              <p className="px-3 py-1 text-[11px] font-semibold tracking-wide uppercase text-zinc-500 border-b">Sugestões clínicas (biblioteca) — toque para preencher</p>
              {sugList.map(s => (
                <button key={s.id} id={`clinical-suggestion-${s.id}`} role="option" aria-selected={suggestionIndex >= 0 && sugList[suggestionIndex]?.id === s.id} type="button" onMouseDown={(e)=>e.preventDefault()} onClick={() => chooseSuggestion(s)} className="w-full text-left px-3 py-2 hover:bg-zinc-50 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{s.name}</span>
                  <span className="text-xs text-zinc-500 shrink-0">{s.grupo} · {durationSuggestionLabel(s.duracaoMin)}</span>
                </button>
              ))}
              <p className="px-3 py-1 text-[11px] text-zinc-400 border-t">Não cria automaticamente — só sugere Nome/Grupo/Duração (a duração é sugestão e pode ser alterada).</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-semibold text-zinc-500">PREÇO BASE (R$)</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} className={input + ' mt-1'} placeholder="Opcional — ex: 120,00" inputMode="decimal" />
            <span className="text-[11px] text-zinc-500">Valor operacional — referência para financeiro/relatórios e futura comissão.</span></label>
          <label className="block"><span className="text-xs font-semibold text-zinc-500">DURAÇÃO PADRÃO (MIN)</span>
            <input aria-label="Duração padrão em minutos" type="number" min={5} step={5} inputMode="numeric" placeholder="Ex.: 30" value={durationText} onChange={(e) => { setDurationText(e.target.value); setDurSuggested(0); }} className={input + ' mt-1'} />
            {durSuggested > 0 && <span className="block text-[11px] text-amber-700">{durationSuggestionLabel(durSuggested)} — ajuste conforme a rotina da clínica.</span>}
            <span className="text-[11px] text-zinc-500">Duração padrão para novos agendamentos — não trava encaixe, ordem de chegada ou cirurgia longa.</span></label>
        </div>
        <label className="block"><span className="text-xs font-semibold text-zinc-500">GRUPO</span>
          <select value={categoryId || (suggestedGroupName ? '__suggested' : '')} onChange={(e) => { setCategoryId(e.target.value === '__suggested' ? '' : e.target.value); if (e.target.value !== '__suggested') setSuggestedGroupName(''); }} className={input + ' mt-1'}>
            <option value="">Sem grupo (opcional)</option>
            {suggestedGroupName && <option value="__suggested">{suggestedGroupName} (sugerido)</option>}
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {suggestedGroupName && <p className="text-[11px] text-amber-700 mt-1">Grupo sugerido: {suggestedGroupName} — Será criado automaticamente ao salvar</p>}
          <span className="text-[11px] text-zinc-500">Usado para organizar os serviços da clínica.</span></label>

        {/* Perguntas no agendamento removidas do cadastro básico de Serviço — ver GODOUTOR-MASTER-PLAN.md (futuro motor de intake). Questões legadas preservadas no banco/API. */}
        {pros.length > 0 && (
          <div>
            <span className="text-xs font-semibold text-zinc-500">QUEM REALIZA ESTE ATENDIMENTO?</span>
            <p className="text-[11px] text-zinc-500 mt-0.5">Defina se todos os profissionais ativos podem realizar este serviço ou apenas os selecionados. O vínculo serviço↔profissional define quem pode realizar este serviço.</p>
            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="professionalMode" checked={professionalMode==='all'} onChange={()=> setProfessionalMode('all')} className="accent-emerald-600" />
                <span className="text-sm">Todos os profissionais ativos</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="professionalMode" checked={professionalMode==='selected'} onChange={()=> setProfessionalMode('selected')} className="accent-emerald-600" />
                <span className="text-sm">Somente profissionais selecionados</span>
              </label>
            </div>
            {professionalMode==='selected' && (
              <>
                <div className="flex flex-wrap gap-2 mt-2">
                  {pros.filter((p) => p.active !== false).map((p) => (
                    <button type="button" key={p.id} onClick={() => togglePro(p.id)}
                      className={cn('text-sm font-semibold px-4 py-2 rounded-md border-2', proIds.includes(p.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                      {p.name}
                    </button>
                  ))}
                </div>
                {proIds.length===0 && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">Nenhum profissional está vinculado; este serviço não terá profissional elegível.</p>}
              </>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Ativo na clínica<span className="text-[11px] font-normal text-zinc-500">Disponível para uso.</span></label>
          <label className="flex flex-col gap-0.5 text-sm font-medium"><span className="flex items-center gap-2"><input type="checkbox" checked={bookable} onChange={(e) => setBookable(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Pode ser agendado</span><span className="text-[11px] font-normal text-zinc-500 ml-6">Aparece como opção para criar agendamentos.</span></label>
        </div>
        <details className="rounded-md border border-zinc-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Observação interna (opcional)</summary><p className="text-xs text-zinc-500 my-2">Informação interna para a equipe. Não é exibida ao paciente.</p>
        <textarea aria-label="Observação interna" value={description} onChange={(e) => setDescription(e.target.value)} className={input} rows={2} placeholder="Observação interna (opcional)" />
        </details>
        <details className="rounded-md border border-zinc-200 p-3"><summary className="cursor-pointer text-sm font-semibold">Agenda e recursos · avançado</summary>
          <p className="text-xs text-zinc-500 my-2">Use somente quando o procedimento precisa reservar sala, equipamento ou tempo de preparação/limpeza.</p>
        <fieldset className="border border-zinc-200 rounded-md p-3 space-y-2">
          <legend className="text-xs font-semibold">Preparação e recursos</legend>
          <p className="text-xs text-zinc-500">Deixe vazio para usar os buffers da clínica. Não altera agendamentos existentes.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">Preparação antes (min)<input type="number" min={0} max={240} value={before} onChange={e => setBefore(e.target.value)} placeholder="Padrão da clínica" className={input} /></label>
            <label className="text-xs">Tempo de liberação depois (min)<input type="number" min={0} max={240} value={after} onChange={e => setAfter(e.target.value)} placeholder="Padrão da clínica" className={input} /></label>
          </div>
          <p className="text-xs font-semibold">Recursos necessários (um dos selecionados; quantidade 1)</p>
          {resources.filter(r => r.active || resourceIds.includes(r.id)).map(r => <label key={r.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={resourceIds.includes(r.id)} onChange={() => setResourceIds(ids => ids.includes(r.id) ? ids.filter(x => x !== r.id) : [...ids, r.id])} />{r.name} · {r.kind === 'room' ? 'Sala' : 'Equipamento'}
          </label>)}
          {resources.length === 0 && <p className="text-xs text-zinc-500">Cadastre salas ou equipamentos em Configurações → Agenda.</p>}
        </fieldset>
        </details>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>{loading ? 'Salvando…' : 'Salvar serviço'}</Button>
      </form>
    </Drawer>
  );
}

// ── Profissionais (quem REALIZA os atendimentos) ──
export function TeamEditor({ businessId, pros, rules, onSave, onAskDelete, onCreated, onManageAccess, hideList, hideTrigger }: {
  businessId: string;
  pros: Professional[];
  /** Regras de disponibilidade — para saber quem herda o horário da empresa. */
  rules: Availability[];
  /** Devolve o payload da API (`professionalId` no save) — A3.4. */
  onSave: (action: string, payload: Record<string, any>) => Promise<any>;
  onAskDelete: (p: Professional) => void;
  /** A3.4: profissional recém-criado (a tela pergunta "criar acesso agora?"). */
  onCreated?: (professionalId: string, name: string) => void;
  /** A3.4: abrir o fluxo de acesso (Criar) ou o membro já vinculado (Gerenciar). */
  onManageAccess?: (p: Professional) => void;
  /** Clinical Closure: quando true, não renderiza lista interna (usado pela Equipe unificada) */
  hideList?: boolean;
  /** Quando true, não mostra o botão primário "Profissional" — criação vem pelo chooser único de Equipe */
  hideTrigger?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Professional | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [photo, setPhoto] = useState('');
  const [active, setActive] = useState(true);
  // Padrão do produto: profissional novo SEGUE o horário da empresa.
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    function onEdit(e: any) { open(e.detail as Professional); }
    function onCreate() { open(null); }
    window.addEventListener('equipe:edit-professional', onEdit as any);
    window.addEventListener('equipe:create-professional', onCreate as any);
    return () => {
      window.removeEventListener('equipe:edit-professional', onEdit as any);
      window.removeEventListener('equipe:create-professional', onCreate as any);
    };
  }, [rules]);

  function open(p: Professional | null) {
    setEditing(p);
    setName(p?.name || '');
    setRole(p?.role || '');
    setPhoto(p?.photo || '');
    setActive(p?.active !== false);
    setFollow(p ? followsBusinessHours(p, rules) : true);
    setError('');
    setShow(true);
  }

  return (
    <>
      {!hideTrigger && <Button variant="primary" className="mb-4" onClick={() => open(null)}><Icon n="plus" size={14} /> Profissional</Button>}
      <Drawer open={show} onClose={() => setShow(false)} title={editing ? 'Editar profissional' : 'Novo profissional'} subtitle={editing ? 'Atualize os dados de quem realiza atendimentos' : 'Quem vai realizar atendimentos na clínica'} width="max-w-md">
        <form onSubmit={(e) => { e.preventDefault(); setError(''); onSave('professional.save', { id: editing?.id, name, role, photo, active, followBusinessHours: follow }).then((data: any) => { setShow(false); if (!editing) onCreated?.(String(data?.professionalId || ''), name); }).catch((err) => setError(err.message)); }}
          className="p-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome * (ex: Dra. Ana)" className="w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm" autoFocus />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Função / especialidade (ex: Veterinário, Cirurgião, Anestesista)" className="w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm" />
          <ImageUpload label="FOTO DO PROFISSIONAL" value={photo} onChange={setPhoto} businessId={businessId} circle />
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Ativo (disponível para agenda)</label>
          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="w-4 h-4 accent-emerald-600 mt-0.5" />
            <span>
              Seguir horário da clínica
              <span className="block text-xs font-normal text-zinc-500">
                {follow
                  ? 'Atende nos horários gerais — mudanças lá valem automaticamente aqui.'
                  : 'Horário personalizado: edite em Disponibilidade.'}
              </span>
            </span>
          </label>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" className="flex-1">Salvar</Button>
            <Button type="button" variant="secondary" onClick={() => setShow(false)} className="flex-1">Cancelar</Button>
          </div>
        </form>
      </Drawer>
      {hideList ? null : (pros.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg text-center py-12 px-6">
          <p className="font-semibold">Só você por aqui? Sem problema.</p>
          <p className="text-sm text-zinc-500 mt-1">A agenda funciona sem equipe. Adicione profissionais se precisar.</p>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200">
          <div className="hidden sm:grid grid-cols-[1fr_130px_90px_160px] gap-3 px-4 py-2 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide uppercase text-zinc-500">
            <span>Profissional</span><span>Agenda</span><span>Acesso</span><span className="text-right">Ações</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {pros.map((p) => (
              <div key={p.id} className={cn('px-4 py-3 flex sm:grid sm:grid-cols-[1fr_130px_90px_160px] gap-3 items-center hover:bg-zinc-50', !p.active && 'opacity-60')}>
                <span className="flex items-center gap-3 min-w-0 flex-1">
                  <Avatar name={p.name} src={p.photo || undefined} size={36} />
                  <span className="min-w-0">
                    <span className="text-sm font-medium truncate block">{p.name}</span>
                    <span className="text-xs text-zinc-500 truncate block">{p.role || '—'}{!p.active && ' · inativo'}</span>
                  </span>
                </span>
                <span className={cn('hidden sm:block text-[11px] font-semibold px-2 py-1 rounded-full border w-fit', followsBusinessHours(p, rules) ? 'border-zinc-200 bg-zinc-50 text-zinc-600' : 'border-blue-200 bg-blue-50 text-blue-700')}>
                  {followsBusinessHours(p, rules) ? 'Segue a clínica' : 'Horário próprio'}
                </span>
                <span className="hidden sm:block">
                  {p.userId ? (
                    <Badge tone="green" icon="shield">Acesso ativo</Badge>
                  ) : (
                    <Badge tone="zinc" icon="lock">Sem acesso</Badge>
                  )}
                </span>
                <span className="flex items-center gap-1.5 justify-end shrink-0">
                  {onManageAccess && (
                    <button onClick={() => onManageAccess(p)} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-1.5 rounded-md hover:bg-zinc-50">
                      {p.userId ? 'Gerenciar acesso' : 'Criar acesso'}
                    </button>
                  )}
                  <button onClick={() => open(p)} className="text-xs font-semibold bg-zinc-100 px-3 py-1.5 rounded-md hover:bg-zinc-200">Editar</button>
                  <button onClick={() => onAskDelete(p)} aria-label={`Excluir ${p.name}`}
                    className="text-xs font-semibold text-red-500 px-2 py-1.5 hover:bg-red-50 rounded-md inline-flex"><Icon n="x" size={13} /></button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// ── Exceções: fechar dia / horário especial ──
export function ExceptionsManager({ exceptions, onSave, onDelete }: {
  exceptions: AvailabilityException[];
  onSave: (p: Record<string, any>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [date, setDate] = useState('');
  const [closed, setClosed] = useState(true);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setMsg(''); setSaving(true);
    try {
      await onSave({ date, closed, start: closed ? '' : start, end: closed ? '' : end, note });
      setDate(''); setNote(''); setClosed(true);
    } catch (err: any) {
      setMsg(err.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5">
      <p className="font-semibold text-sm">Dias especiais</p>
      <p className="text-xs text-zinc-500 mb-4">Exceção de funcionamento em uma data específica. Informe o período em que a clínica atende ou marque o fechamento do dia inteiro.</p>
      {exceptions.length > 0 && (
        <div className="space-y-2 mb-4">
          {exceptions.map((x) => (
            <div key={x.id} className="flex items-center gap-3 bg-zinc-50 border border-zinc-200 rounded-md px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{x.date.split('-').reverse().join('/')} · {x.closed ? 'Fechado' : `${x.start}–${x.end}`}</p>
                {x.note && <p className="text-xs text-zinc-500">{x.note}</p>}
              </div>
              <button onClick={() => onDelete(x.id)} className="text-xs font-semibold text-red-500 hover:bg-red-50 px-2 py-1.5 rounded-lg">Remover</button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2.5">
        <label className="block"><span className="text-xs font-semibold text-zinc-500">DATA</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="block rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1" /></label>
        <label className="block"><span className="text-xs font-semibold text-zinc-500">TIPO</span>
          <select value={closed ? 'closed' : 'special'} onChange={(e) => setClosed(e.target.value === 'closed')} className="block rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1">
            <option value="closed">Fechado o dia todo</option>
            <option value="special">Horário especial</option>
          </select></label>
        {!closed && (
          <>
            <label className="block"><span className="text-xs font-semibold text-zinc-500">DAS</span>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="block rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1" /></label>
            <label className="block"><span className="text-xs font-semibold text-zinc-500">ATÉ</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="block rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1" /></label>
          </>
        )}
        <label className="block flex-1 min-w-[140px]"><span className="text-xs font-semibold text-zinc-500">MOTIVO (OPCIONAL)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: Natal" className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1" /></label>
        <Button type="submit" disabled={saving} variant="primary">{saving ? 'Salvando…' : 'Adicionar'}</Button>
      </form>
      {msg && <p className="mt-2 text-sm font-medium text-red-600">{msg}</p>}
    </div>
  );
}

// ── Ponteiros entre as três telas (Serviços · Profissionais · Disponibilidade) ──
/**
 * Atalhos contextuais entre as telas de Oferta (A1.2 · §"nada é ilha").
 * A lista é PROJETADA do catálogo: seção 'oferta', destinos de serviço
 * (`modes` inclui 'services'), com linha no menu. Renomear ou reordenar lá
 * atualiza aqui sozinho — não existe uma segunda lista de links.
 *
 * `current` é o href da tela em que o atalho aparece (nunca linka para si).
 */
const CROSS_HINTS: Record<string, string> = {
  '/servicos': 'o que eu ofereço',
  '/profissionais': 'quem atende',
  '/disponibilidade': 'quando atende',
};
const CROSS_ICONS: Record<string, string> = {
  '/servicos': 'service',
  '/profissionais': 'userCircle',
  '/disponibilidade': 'clock',
};

export function CatalogCrossLinks({ businessId, current }: { businessId: string; current: string }) {
  const items = panelRoutesIn('oferta').filter(
    (r) => r.sidebar !== false && (r.modes || []).includes('services') && r.href !== current,
  );
  // Fallback: quando /profissionais saiu do menu (consolidação), ainda mostrar atalho contextual
  // para quem navega de Serviços/Disponibilidade — link leva ao redirect que cai em Equipe.
  const fallback: Array<{ href: string; label: string; icon: string; description: string }> =
    current !== '/profissionais' && panelRoutesIn('oferta').length <= 1
      ? [{ href: '/profissionais', label: 'Profissionais', icon: 'idcard', description: 'quem atende' }]
      : [];
  const display = items.length > 0 ? items : fallback;
  if (display.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {display.map((r: any) => (
        <Link key={r.href} href={`${r.href}?b=${businessId}`} title={r.description}
          className="text-xs font-semibold bg-white border border-zinc-200 px-3.5 py-2 rounded-md hover:border-zinc-400 inline-flex items-center gap-1.5">
          <Icon n={CROSS_ICONS[r.href] || r.icon} size={13} />
          {r.label} <span className="text-zinc-400 font-normal">· {CROSS_HINTS[r.href] || r.description}</span>
        </Link>
      ))}
    </div>
  );
}
