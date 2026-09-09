'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { Availability, Category, Professional, Service } from '@/lib/types';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';

function cents(v: string): number {
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function reais(c: number): string {
  return (c / 100).toFixed(2).replace('.', ',');
}
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function ServicosPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [tab, setTab] = useState<'services' | 'team' | 'hours'>('services');
  const [cats, setCats] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [pros, setPros] = useState<Professional[]>([]);
  const [rules, setRules] = useState<Availability[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [showCat, setShowCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [showPro, setShowPro] = useState(false);
  const [proName, setProName] = useState('');
  const [proRole, setProRole] = useState('');

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/catalog/get?businessId=${businessId}`)
      .then((r) => r.json())
      .then((d) => {
        setCats((d.categories || []).filter((c: Category) => c.kind === 'service'));
        setServices(d.services || []);
        setPros(d.professionals || []);
        setRules(d.availability || []);
        setLoaded(true);
      });
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function call(action: string, payload: Record<string, any>) {
    setMsg('');
    const res = await fetch('/api/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, action, ...payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    load();
    setMsg('Salvo.');
    setTimeout(() => setMsg(''), 2500);
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Serviços</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Serviços, equipe e horários de atendimento.</p>

      <div className="flex gap-2 mb-5">
        {([['services', 'Serviços'], ['team', 'Equipe'], ['hours', 'Horários']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('text-sm font-bold px-4 py-2.5 rounded-xl', tab === id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600')}>
            {label}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 text-sm font-medium bg-zinc-900 text-white rounded-xl px-4 py-3">{msg}</p>}
      {!loaded && <ListSkeleton rows={3} />}

      {loaded && tab === 'services' && (
        <>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setShowCat(!showCat)} className="text-sm font-bold bg-white border border-zinc-200 px-4 py-2.5 rounded-xl">+ Categoria</button>
            <button onClick={() => { setEditing(null); setShowForm(true); }} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl">+ Serviço</button>
          </div>
          {showCat && (
            <form onSubmit={(e) => { e.preventDefault(); call('category.save', { name: catName, kind: 'service' }).then(() => { setCatName(''); setShowCat(false); }).catch((err) => setMsg(err.message)); }}
              className="mb-4 bg-white border border-zinc-200 rounded-2xl p-4 flex gap-2">
              <input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Nome da categoria (ex: Cabelo)"
                className="flex-1 rounded-xl border border-zinc-300 px-3 py-2.5 text-sm" autoFocus />
              <button className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl">Salvar</button>
            </form>
          )}
          {services.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-2xl text-center py-14 px-6">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="scissors" size={24} /></div>
              <h3 className="font-bold mt-3">Nenhum serviço ainda</h3>
              <p className="text-sm text-zinc-500 mt-1">Cadastre o primeiro para exibir na página e receber agendamentos.</p>
              <button onClick={() => { setEditing(null); setShowForm(true); }} className="mt-4 text-sm font-bold bg-zinc-900 text-white px-5 py-2.5 rounded-xl">Adicionar serviço</button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {services.map((sv) => (
                <div key={sv.id} className={cn('bg-white border border-zinc-200 rounded-2xl p-4 flex items-center gap-3', !sv.active && 'opacity-60')}>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">{sv.name} {sv.featured && <Icon n="star" size={13} className="inline -mt-1 text-amber-500" />}</p>
                    <p className="text-xs text-zinc-500">R$ {reais(sv.price)} · {sv.durationMin} min · {sv.bookable ? 'agendável' : 'somente exibição'}</p>
                  </div>
                  <button onClick={() => { setEditing(sv); setShowForm(true); }} className="text-xs font-bold bg-zinc-100 px-3 py-2 rounded-lg">Editar</button>
                  <button onClick={() => { if (confirm(`Excluir "${sv.name}"?`)) call('service.delete', { id: sv.id }).catch((e) => setMsg(e.message)); }}
                    className="text-xs font-bold text-red-500 px-2 py-2 hover:bg-red-50 rounded-lg inline-flex"><Icon n="x" size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {loaded && tab === 'team' && (
        <>
          <button onClick={() => setShowPro(!showPro)} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl mb-4">+ Profissional</button>
          {showPro && (
            <form onSubmit={(e) => { e.preventDefault(); call('professional.save', { name: proName, role: proRole }).then(() => { setProName(''); setProRole(''); setShowPro(false); }).catch((err) => setMsg(err.message)); }}
              className="mb-4 bg-white border border-zinc-200 rounded-2xl p-4 space-y-2.5">
              <input value={proName} onChange={(e) => setProName(e.target.value)} placeholder="Nome (ex: João)" className="w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm" autoFocus />
              <input value={proRole} onChange={(e) => setProRole(e.target.value)} placeholder="Função (ex: Barbeiro)" className="w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm" />
              <button className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl">Salvar</button>
            </form>
          )}
          {pros.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-2xl text-center py-12 px-6">
              <p className="font-bold">Só você por aqui? Sem problema.</p>
              <p className="text-sm text-zinc-500 mt-1">A agenda funciona sem equipe. Adicione profissionais se precisar.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {pros.map((p) => (
                <div key={p.id} className="bg-white border border-zinc-200 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center font-bold shrink-0">{p.name.slice(0, 1)}</div>
                  <div className="flex-1"><p className="font-bold text-sm">{p.name}</p><p className="text-xs text-zinc-500">{p.role || '—'}</p></div>
                  <button onClick={() => { if (confirm(`Excluir "${p.name}"?`)) call('professional.delete', { id: p.id }).catch((e) => setMsg(e.message)); }}
                    className="text-xs font-bold text-red-500 px-2 py-2 hover:bg-red-50 rounded-lg inline-flex"><Icon n="x" size={13} /></button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {loaded && tab === 'hours' && (
        <HoursEditor rules={rules} onSave={async (r) => { await call('availability.save', { rules: r }); }} />
      )}

      {showForm && (
        <ServiceForm service={editing} cats={cats}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={async (payload) => { await call('service.save', payload); setShowForm(false); setEditing(null); }} />
      )}
    </>
  );
}

function ServiceForm({ service, cats, onClose, onSave }: {
  service: Service | null;
  cats: Category[];
  onClose: () => void;
  onSave: (p: Record<string, any>) => Promise<void>;
}) {
  const [name, setName] = useState(service?.name || '');
  const [description, setDescription] = useState(service?.description || '');
  const [price, setPrice] = useState(service ? reais(service.price) : '');
  const [durationMin, setDurationMin] = useState(service?.durationMin || 45);
  const [categoryId, setCategoryId] = useState(service?.categoryId || '');
  const [active, setActive] = useState(service?.active !== false);
  const [featured, setFeatured] = useState(!!service?.featured);
  const [bookable, setBookable] = useState(service?.bookable !== false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const input = 'w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={(e) => { e.preventDefault(); setError(''); setLoading(true); onSave({ id: service?.id, name, description, price: cents(price), durationMin, categoryId, active, featured, bookable }).catch((err) => setError(err.message)).finally(() => setLoading(false)); }}
        className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">{service ? 'Editar serviço' : 'Novo serviço'}</h3>
          <button type="button" onClick={onClose} className="font-bold text-zinc-400 px-2 inline-flex"><Icon n="x" size={16} /></button>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Nome * (ex: Corte)" autoFocus />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={input} rows={2} placeholder="Descrição (opcional)" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-bold text-zinc-500">PREÇO (R$) *</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} className={input + ' mt-1'} placeholder="45,00" inputMode="decimal" /></label>
          <label className="block"><span className="text-xs font-bold text-zinc-500">DURAÇÃO (MIN)</span>
            <input type="number" min={5} step={5} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} className={input + ' mt-1'} /></label>
        </div>
        <label className="block"><span className="text-xs font-bold text-zinc-500">CATEGORIA</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input + ' mt-1'}>
            <option value="">Sem categoria</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Ativo</label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Destaque</label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={bookable} onChange={(e) => setBookable(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Aceita agendamento</label>
        </div>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <button disabled={loading} className="w-full font-bold bg-zinc-900 text-white py-3 rounded-xl disabled:opacity-50">{loading ? 'Salvando…' : 'Salvar serviço'}</button>
      </form>
    </div>
  );
}

interface DayRule { open: boolean; start: string; end: string; slotMin: number }

function HoursEditor({ rules, onSave }: { rules: Availability[]; onSave: (r: any[]) => Promise<void> }) {
  const [days, setDays] = useState<DayRule[]>(() => {
    const arr: DayRule[] = Array.from({ length: 7 }, () => ({ open: false, start: '09:00', end: '18:00', slotMin: 30 }));
    for (const r of rules) {
      arr[r.weekday] = { open: true, start: r.start, end: r.end, slotMin: r.slotMin || 30 };
    }
    return arr;
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  function setDay(i: number, patch: Partial<DayRule>) {
    setDays((d) => d.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  async function submit() {
    setSaving(true);
    setMsg('');
    try {
      const payload = days.flatMap((d, weekday) => (d.open ? [{ weekday, start: d.start, end: d.end, slotMin: d.slotMin, professionalId: '' }] : []));
      await onSave(payload);
      setMsg('Horários salvos.');
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-5">
      <p className="font-bold text-sm">Quando você atende?</p>
      <p className="text-xs text-zinc-500 mb-4">O cliente só vê horários dentro destes períodos.</p>
      <div className="space-y-2.5">
        {DAYS.map((label, i) => (
          <div key={i} className="flex items-center gap-3">
            <button onClick={() => setDay(i, { open: !days[i].open })}
              className={cn('w-14 text-xs font-bold py-2 rounded-lg', days[i].open ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-400')}>
              {label}
            </button>
            {days[i].open ? (
              <span className="flex items-center gap-2 text-sm">
                <input type="time" value={days[i].start} onChange={(e) => setDay(i, { start: e.target.value })} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" />
                <span className="text-zinc-400">até</span>
                <input type="time" value={days[i].end} onChange={(e) => setDay(i, { end: e.target.value })} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" />
                <select value={days[i].slotMin} onChange={(e) => setDay(i, { slotMin: Number(e.target.value) })} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm">
                  <option value={15}>15min</option>
                  <option value={30}>30min</option>
                  <option value={45}>45min</option>
                  <option value={60}>60min</option>
                </select>
              </span>
            ) : (
              <span className="text-xs text-zinc-400">Fechado</span>
            )}
          </div>
        ))}
      </div>
      {msg && <p className="mt-3 text-sm font-medium">{msg}</p>}
      <button onClick={submit} disabled={saving} className="mt-4 text-sm font-bold bg-zinc-900 text-white px-5 py-2.5 rounded-xl disabled:opacity-50">
        {saving ? 'Salvando…' : 'Salvar horários'}
      </button>
    </div>
  );
}
