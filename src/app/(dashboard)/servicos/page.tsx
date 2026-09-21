'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn, centsToBR } from '@/lib/utils';
import type { Category, Professional, Service } from '@/lib/types';
import { Button, EmptyState, IconButton, ListSkeleton, Notice, PageHeader } from '@/components/ui';
import { Icon } from '@/components/icons';
import { AccessDenied, AreaLoadError } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { DeleteSheet, ServiceForm, CatalogCrossLinks } from '@/components/dashboard/catalog-panels';

interface DeleteAsk {
  kind: 'service' | 'professional';
  id: string;
  name: string;
  blocked: boolean;
  entity: any;
}

// ═══════════════════════════════════════════════════════════════
// SERVIÇOS — "o que eu ofereço"
// Uma pergunta só. Equipe e horários têm telas próprias (profissionais/
// horarios) — esta tela não mistura os conceitos.
// ═══════════════════════════════════════════════════════════════
export default function ServicosPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [cats, setCats] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [pros, setPros] = useState<Professional[]>([]);
  const [refs, setRefs] = useState<{ services: string[]; professionals: string[] }>({ services: [], professionals: [] });
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [showCat, setShowCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [askDelete, setAskDelete] = useState<DeleteAsk | null>(null);
  // 403 nesta tela → aviso amigável (o usuário continua logado).
  const [loadError, setLoadError] = useState('');
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Serviços' });
    if (!res.ok) {
      // Sem permissão: mostra o aviso e NÃO tenta desenhar a tela vazia.
      setLoadError(res.message || 'Falha de conexão.');
      setDenied(res.status === 403);
      setLoaded(true);
      return;
    }
    setLoadError('');
    const d = res.data || {};
    setCats((d.categories || []).filter((c: Category) => c.kind === 'service'));
    setServices(d.services || []);
    setPros(d.professionals || []);
    setRefs(d.bookingRefs || { services: [], professionals: [] });
    setDenied(false);
    setLoaded(true);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function call(action: string, payload: Record<string, any>) {
    setMsg('');
    // apiSend nunca lança por status: em 403 a mensagem é amigável e a sessão
    // continua intacta (o toast global também aparece).
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
      hint="O que o seu negócio oferece — nomes, preços e detalhes."
      action={loaded ? (
        <span className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setShowCat(!showCat)}>
            <Icon n="plus" size={14} /> Categoria
          </Button>
          <Button variant="primary" onClick={() => { setEditing(null); setShowForm(true); }}>
            <Icon n="plus" size={14} /> Serviço
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
      {!loaded && <ListSkeleton rows={3} />}

      {loaded && (
        <>
          {showCat && (
            <form onSubmit={(e) => { e.preventDefault(); call('category.save', { name: catName, kind: 'service' }).then(() => { setCatName(''); setShowCat(false); }).catch((err) => setMsg(err.message)); }}
              className="mb-4 ws-panel p-4 flex flex-wrap gap-2">
              <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Nome da categoria (ex: Cabelo)"
                className="flex-1 min-w-[200px] rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm focus:outline-none focus:shadow-focus" autoFocus />
              <Button type="submit" variant="primary">Salvar</Button>
            </form>
          )}
          {services.length === 0 ? (
            <EmptyState
              icon="service"
              title="Nenhum serviço ainda"
              hint="Cadastre o primeiro para exibir na página e receber agendamentos."
              action={<Button variant="primary" onClick={() => { setEditing(null); setShowForm(true); }}><Icon n="plus" size={14} /> Adicionar serviço</Button>}
            />
          ) : (
            <div className="space-y-2.5">
              {services.map((sv) => {
                const who = (sv.professionalIds || []).length === 0
                  ? 'toda a equipe'
                  : (sv.professionalIds || []).map((id) => pros.find((p) => p.id === id)?.name || '?').join(', ');
                const pricePublic = sv.showPrice !== false;
                return (
                  <div key={sv.id} className={cn('bg-white border border-zinc-200 rounded-lg p-4 flex items-center gap-3', !sv.active && 'opacity-60')}>
                    {sv.image ? (
                      <img src={sv.image} alt={sv.name} className="w-11 h-11 rounded-md object-cover shrink-0 border border-[var(--border)]" />
                    ) : (
                      <div className="w-11 h-11 rounded-md bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center font-extrabold text-[var(--text-faint)] shrink-0">{sv.name.slice(0, 1)}</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm">{sv.name} {sv.featured && <Icon n="star" size={13} className="inline -mt-1 text-amber-500" />}</p>
                      <p className="text-xs text-zinc-500">
                        R$ {centsToBR(sv.price)}
                        {!pricePublic && <span className="font-semibold text-amber-700"> · preço oculto na página</span>}
                        {' · '}{sv.bookable ? 'agendável' : 'somente exibição'}
                      </p>
                      {pros.length > 0 && <p className="text-xs text-zinc-400">Realizado por: {who}</p>}
                    </div>
                    <Button variant="secondary" size="xs" onClick={() => { setEditing(sv); setShowForm(true); }}>Editar</Button>
                    <IconButton icon="x" label={`Excluir ${sv.name}`} tip={`Excluir ${sv.name}`} variant="danger" size="sm" onClick={() => ask('service', sv)} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showForm && (
        <ServiceForm businessId={businessId} service={editing} cats={cats} pros={pros}
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
