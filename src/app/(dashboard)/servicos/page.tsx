'use client';
import { durationLabel } from '@/lib/duration-label';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn, centsToBR } from '@/lib/utils';
import type { Category, Professional, ScheduleResource, Service } from '@/lib/types';
import { Button, Drawer, EmptyState, IconButton, ListSkeleton, Notice, PageHeader } from '@/components/ui';
import { Icon } from '@/components/icons';
import { AccessDenied, AreaLoadError } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { DeleteSheet, ServiceForm, CatalogCrossLinks } from '@/components/dashboard/catalog-panels';
import { eligibleProfessionalIds, serviceProfessionalMode } from '@/lib/booking';

interface DeleteAsk {
  kind: 'service' | 'professional';
  id: string;
  name: string;
  blocked: boolean;
  entity: any;
}

// ═══════════════════════════════════════════════════════════════
// SERVIÇOS — o que a clínica realiza e pode registrar/agendar/cobrar
// Cada serviço tem nome, descrição clínica, preço base (referência
// financeira), duração base (sugestão da agenda, não trava rígida),
// categoria interna, profissionais elegíveis, status ativo e se aceita
// agendamento. Foto de serviço removida — serviço é dado operacional.
// ═══════════════════════════════════════════════════════════════
export default function ServicosPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [cats, setCats] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [resources, setResources] = useState<ScheduleResource[]>([]);
  const [pros, setPros] = useState<Professional[]>([]);
  const [refs, setRefs] = useState<{ services: string[]; professionals: string[] }>({ services: [], professionals: [] });
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [showCat, setShowCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [askDelete, setAskDelete] = useState<DeleteAsk | null>(null);
  const [loadError, setLoadError] = useState('');
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Serviços' });
    if (!res.ok) {
      setLoadError(res.message || 'Falha de conexão.');
      setDenied(res.status === 403);
      setLoaded(true);
      return;
    }
    setLoadError('');
    const d = res.data || {};
    setCats((d.categories || []).filter((c: Category) => c.kind === 'service'));
    setServices(d.services || []);
    setResources(d.scheduleResources || []);
    setPros(d.professionals || []);
    setRefs((d.historyRefs || d.bookingRefs) || { services: [], professionals: [] });
    setDenied(false);
    setLoaded(true);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function call(action: string, payload: Record<string, any>) {
    setMsg('');
    const res = await apiSend('/api/catalog', 'POST', { businessId, action, ...payload }, { scope: 'action', area: 'Serviços' });
    if (!res.ok) throw new Error(res.message || 'Não foi possível salvar.');
    await load();
    setMsg('Salvo.');
    setTimeout(() => setMsg(''), 2500);
  }

  function ask(kind: DeleteAsk['kind'], entity: any) {
    const blocked = kind === 'service'
      ? refs.services.includes(entity.id)
      : refs.professionals.includes(entity.id);
    setAskDelete({ kind, id: entity.id, name: entity.name, blocked, entity });
  }

  async function doDelete() {
    if (!askDelete) return;
    try {
      await call(askDelete.kind === 'service' ? 'service.delete' : 'professional.delete', { id: askDelete.id });
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setAskDelete(null);
    }
  }

  async function doDeactivate() {
    if (!askDelete) return;
    try {
      if (askDelete.kind === 'service') {
        const s = askDelete.entity;
        await call('service.save', { ...s, active: false });
      } else {
        const p = askDelete.entity;
        await call('professional.save', { id: p.id, name: p.name, role: p.role, photo: p.photo, active: false });
      }
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setAskDelete(null);
    }
  }

  const header = (
    <PageHeader
      icon="service"
      title="Serviços"
      hint="O que a clínica realiza — procedimentos com preço base, duração base e profissionais elegíveis."
      action={loaded ? (
        <span className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setShowCat(true)}>
            <Icon n="tag" size={14} /> Grupos
          </Button>
          <Button variant="primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            <Icon n="plus" size={14} /> Novo serviço
          </Button>
        </span>
      ) : undefined}
    />
  );

  if (denied) {
    return (
      <>
        {header}
        <AccessDenied area="Serviços" />
      </>
    );
  }

  if (loadError) return <>{header}<AreaLoadError area="Serviços" message={loadError} onRetry={load} /></>;

  return (
    <>
      {header}

      {loaded && <CatalogCrossLinks businessId={businessId} current="/servicos" />}

      {msg && <Notice tone="info" className="mb-4">{msg}</Notice>}
      <p className="text-xs text-[var(--text-muted)] mb-2">Ativo = disponível para uso na clínica. Pode ser agendado = pode receber um horário na agenda.</p>
      {!loaded && <ListSkeleton rows={3} />}

      {loaded && (
        <>
          {showCat && (
            <Drawer open onClose={() => { setShowCat(false); setEditingCat(null); setCatName(''); }} title="Grupos" subtitle="Grupos internos da clínica (opcional, sem migração)" width="max-w-md">
              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  {cats.length === 0 ? (
                    <p className="text-sm text-zinc-500">Nenhum grupo ainda. Crie o primeiro para organizar os serviços. (Opcional)</p>
                  ) : (
                    <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-md">
                      {cats.map((c) => {
                        const count = services.filter((s) => s.categoryId === c.id).length;
                        return (
                          <div key={c.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-zinc-50">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{c.name}</p>
                              <p className="text-xs text-zinc-500">{count} serviço{count !== 1 ? 's' : ''}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button variant="secondary" size="xs" onClick={() => { setEditingCat(c); setCatName(c.name); }}>Renomear</Button>
                              <IconButton icon="x" label={`Excluir ${c.name}`} tip={count > 0 ? `${count} serviços usam esta categoria` : `Excluir ${c.name}`} variant="destructive-soft" size="sm" onClick={() => {
                                if (count > 0) { setMsg(`${count} serviços usam esta categoria. Mova-os antes de excluir.`); setTimeout(() => setMsg(''), 4000); return; }
                                call('category.delete', { id: c.id }).catch((err) => setMsg(err.message));
                              }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); const payload = editingCat ? { id: editingCat.id, name: catName, kind: 'service' } : { name: catName, kind: 'service' }; call('category.save', payload).then(() => { setCatName(''); setEditingCat(null); }).catch((err) => setMsg(err.message)); }} className="flex gap-2 pt-2 border-t border-zinc-100">
                  <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder={editingCat ? 'Novo nome' : 'Novo grupo (ex: Consultas, Vacinas)'} className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" autoFocus />
                  <Button type="submit" variant="primary">{editingCat ? 'Salvar' : 'Criar'}</Button>
                  {editingCat && <Button type="button" variant="secondary" onClick={() => { setEditingCat(null); setCatName(''); }}>Cancelar</Button>}
                </form>
                {editingCat && <p className="text-xs text-zinc-500">Renomeando: {editingCat.name} — serviços vinculados continuam pelo ID.</p>}
              </div>
            </Drawer>
          )}
          {services.length === 0 ? (
            <EmptyState
              icon="service"
              title="Nenhum serviço ainda"
              hint="Cadastre o primeiro para organizar a agenda e o atendimento."
              action={<Button variant="primary" onClick={() => { setEditing(null); setShowForm(true); }}><Icon n="plus" size={14} /> Adicionar serviço</Button>}
            />
          ) : (
            <div className="bg-white border border-zinc-200">
              <div className="hidden sm:grid grid-cols-[1.4fr_120px_140px_150px_90px_80px] gap-3 px-4 py-2 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide uppercase text-zinc-500">
                <span>Serviço</span><span>Grupo</span><span>Preço · Duração</span><span>Quem realiza</span><span>Situação</span><span className="text-right">Ações</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {services.map((sv) => {
                  const hasEligible = eligibleProfessionalIds(sv, pros).length > 0;
                  const canSchedule = sv.active && sv.bookable && hasEligible;
                  const cat = cats.find((c) => c.id === sv.categoryId);
                  const who = serviceProfessionalMode(sv as any) === 'all'
                    ? 'toda a equipe'
                    : ((sv.professionalIds || []).length === 0 ? '— nenhum vinculado' : (sv.professionalIds || []).map((id) => pros.find((p) => p.id === id)?.name || '?').join(', '));
                  return (
                    <div key={sv.id} className={cn('px-4 py-3 flex sm:grid sm:grid-cols-[1.4fr_120px_140px_150px_90px_80px] gap-2 items-center hover:bg-zinc-50', !sv.active && 'opacity-60')}>
                      <span className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="w-9 h-9 rounded-md bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center font-semibold text-[var(--text-faint)] shrink-0 text-sm">
                          {sv.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="text-sm font-medium truncate block">{sv.name}</span>
                          {sv.description && <span className="hidden sm:block text-xs text-zinc-500 truncate">{sv.description}</span>}
                          <span className="sm:hidden text-xs text-zinc-500">{sv.price > 0 ? `R$ ${centsToBR(sv.price)} · ${durationLabel(sv.durationMin)}` : `Sem preço base · ${durationLabel(sv.durationMin)}`}</span>
                        </span>
                      </span>
                      <span className="hidden sm:block text-xs text-zinc-500 truncate">{cat?.name || 'Sem grupo'}</span>
                      <span className="hidden sm:block text-sm">
                        {sv.price > 0 ? <><span className="font-medium">R$ {centsToBR(sv.price)}</span><span className="text-zinc-500"> · {durationLabel(sv.durationMin)}</span></> : <><span className="text-zinc-500">Sem preço base</span><span className="text-zinc-500"> · {durationLabel(sv.durationMin)}</span></>}
                      </span>
                      <span className="hidden sm:block text-xs text-zinc-500 truncate">{who}</span>
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border', sv.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-500 border-zinc-200')}>
                          {sv.active ? 'Ativo' : 'Inativo'}
                        </span>
                        <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border', canSchedule ? 'bg-zinc-50 text-zinc-600 border-zinc-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
                          {!hasEligible ? 'Sem profissional habilitado' : canSchedule ? 'Pode ser agendado' : 'Não agendável'}
                        </span>
                      </span>
                      <span className="flex justify-end items-center gap-1.5 text-xs shrink-0">
                        <Button variant="secondary" size="xs" onClick={() => { setEditing(sv); setShowForm(true); }}>Editar</Button>
                        <IconButton icon="x" label={`Excluir ${sv.name}`} tip={`Excluir ${sv.name}`} variant="destructive-soft" size="sm" onClick={() => ask('service', sv)} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {showForm && (
        <ServiceForm businessId={businessId} service={editing} cats={cats} pros={pros} resources={resources}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={async (payload) => { await call('service.save', payload); setShowForm(false); setEditing(null); }} />
      )}

      {askDelete && (
        <DeleteSheet
          name={askDelete.name}
          kindLabel={askDelete.kind === 'service' ? 'serviço' : 'profissional'}
          blocked={askDelete.blocked}
          onDeactivate={doDeactivate}
          onConfirm={doDelete}
          onClose={() => setAskDelete(null)}
        />
      )}
    </>
  );
}
