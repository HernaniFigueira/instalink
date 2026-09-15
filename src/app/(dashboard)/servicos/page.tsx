'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn, centsToBR } from '@/lib/utils';
import type { Category, Professional, Service } from '@/lib/types';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';
import { AccessDenied } from '@/components/dashboard/AccessNotice';
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
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Serviços' });
    if (!res.ok) {
      // Sem permissão: mostra o aviso e NÃO tenta desenhar a tela vazia.
      setDenied(res.status === 403);
      setLoaded(true);
      return;
    }
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

  if (denied) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight">Serviços</h1>
        <p className="text-sm text-zinc-500 mt-1 mb-5">O que o seu negócio oferece — nomes, preços e detalhes.</p>
        <AccessDenied area="Serviços" />
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Serviços</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">O que o seu negócio oferece — nomes, preços e detalhes.</p>

      {loaded && <CatalogCrossLinks businessId={businessId} current="servicos" />}

      {msg && <p className="mb-4 text-sm font-medium bg-zinc-900 text-white rounded-md px-4 py-3">{msg}</p>}
      {!loaded && <ListSkeleton rows={3} />}

      {loaded && (
        <>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setShowCat(!showCat)} className="text-sm font-bold bg-white border border-zinc-200 px-4 py-2.5 rounded-md">+ Categoria</button>
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-md">+ Serviço</button>
          </div>
          {showCat && (
            <form onSubmit={(e) => { e.preventDefault(); call('category.save', { name: catName, kind: 'service' }).then(() => { setCatName(''); setShowCat(false); }).catch((err) => setMsg(err.message)); }}
              className="mb-4 bg-white border border-zinc-200 rounded-lg p-4 flex gap-2">
              <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Nome da categoria (ex: Cabelo)"
                className="flex-1 rounded-md border border-zinc-300 px-3 py-2.5 text-sm" autoFocus />
              <button className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-md">Salvar</button>
            </form>
          )}
          {services.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-lg text-center py-14 px-6">
              <div className="mx-auto w-12 h-12 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="service" size={24} /></div>
              <h3 className="font-bold mt-3">Nenhum serviço ainda</h3>
              <p className="text-sm text-zinc-500 mt-1">Cadastre o primeiro para exibir na página e receber agendamentos.</p>
              <button onClick={() => { setEditing(null); setShowForm(true); }} className="mt-4 text-sm font-bold bg-zinc-900 text-white px-5 py-2.5 rounded-md">Adicionar serviço</button>
            </div>
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
                      <img src={sv.image} alt={sv.name} className="w-11 h-11 rounded-md object-cover shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-md bg-zinc-100 flex items-center justify-center font-extrabold text-zinc-400 shrink-0">{sv.name.slice(0, 1)}</div>
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
                    <button onClick={() => { setEditing(sv); setShowForm(true); }} className="text-xs font-bold bg-zinc-100 px-3 py-2 rounded-lg">Editar</button>
                    <button onClick={() => ask('service', sv)}
                      aria-label={`Excluir ${sv.name}`}
                      className="text-xs font-bold text-red-500 px-2 py-2 hover:bg-red-50 rounded-lg inline-flex"><Icon n="x" size={13} /></button>
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
