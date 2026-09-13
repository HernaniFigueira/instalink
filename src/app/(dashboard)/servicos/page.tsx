'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn, parseMoneyToCents, centsToBR } from '@/lib/utils';
import type { Availability, AvailabilityException, BookingConfig, Category, Professional, Service } from '@/lib/types';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ImageUpload } from '@/components/dashboard/ImageUpload';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface DeleteAsk {
  kind: 'service' | 'professional';
  id: string;
  name: string;
  blocked: boolean;
  entity: any;
}

export default function ServicosPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [tab, setTab] = useState<'services' | 'team' | 'hours'>('services');
  const [cats, setCats] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [pros, setPros] = useState<Professional[]>([]);
  const [rules, setRules] = useState<Availability[]>([]);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [refs, setRefs] = useState<{ services: string[]; professionals: string[] }>({ services: [], professionals: [] });
  const [bookingCfg, setBookingCfg] = useState<BookingConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [showCat, setShowCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [askDelete, setAskDelete] = useState<DeleteAsk | null>(null);

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/catalog/get?businessId=${businessId}`)
      .then((r) => r.json())
      .then((d) => {
        setCats((d.categories || []).filter((c: Category) => c.kind === 'service'));
        setServices(d.services || []);
        setPros(d.professionals || []);
        setRules(d.availability || []);
        setExceptions(d.exceptions || []);
        setRefs(d.bookingRefs || { services: [], professionals: [] });
        setBookingCfg(d.business?.booking || null);
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

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Serviços</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Serviços, equipe, horários e políticas de agendamento.</p>

      <div className="flex gap-2 mb-5">
        {([['services', 'Serviços'], ['team', 'Equipe'], ['hours', 'Horários']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('text-sm font-bold px-4 py-2.5 rounded-md', tab === id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600')}>
            {label}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 text-sm font-medium bg-zinc-900 text-white rounded-md px-4 py-3">{msg}</p>}
      {!loaded && <ListSkeleton rows={3} />}

      {loaded && tab === 'services' && (
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
              <div className="mx-auto w-12 h-12 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="scissors" size={24} /></div>
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
                return (
                  <div key={sv.id} className={cn('bg-white border border-zinc-200 rounded-lg p-4 flex items-center gap-3', !sv.active && 'opacity-60')}>
                    {sv.image ? (
                      <img src={sv.image} alt={sv.name} className="w-11 h-11 rounded-md object-cover shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-md bg-zinc-100 flex items-center justify-center font-extrabold text-zinc-400 shrink-0">{sv.name.slice(0, 1)}</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm">{sv.name} {sv.featured && <Icon n="star" size={13} className="inline -mt-1 text-amber-500" />}</p>
                      <p className="text-xs text-zinc-500">R$ {centsToBR(sv.price)} · {sv.durationMin} min · {sv.bookable ? 'agendável' : 'somente exibição'}</p>
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

      {loaded && tab === 'team' && (
        <TeamEditor businessId={businessId} pros={pros} onSave={call} onAskDelete={(p) => ask('professional', p)} />
      )}

      {loaded && tab === 'hours' && (
        <div className="space-y-4">
          <HoursEditor
            rules={rules} pros={pros}
            onSave={async (scope, r) => { await call('availability.save', { scope, rules: r }); }}
          />
          <ExceptionsManager
            exceptions={exceptions}
            onSave={async (payload) => { await call('exception.save', payload); }}
            onDelete={async (id) => { await call('exception.delete', { id }); }}
          />
          {bookingCfg && (
            <BookingSettings
              businessId={businessId} initial={bookingCfg} hasTeam={pros.length > 0}
              onSaved={() => { setMsg('Políticas salvas.'); setTimeout(() => setMsg(''), 2500); load(); }}
            />
          )}
        </div>
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

// ── Confirmação de exclusão (em sheet, nunca confirm() nativo) ──
function DeleteSheet({ name, kindLabel, blocked, onDeactivate, onConfirm, onClose }: {
  name: string; kindLabel: string; blocked: boolean;
  onDeactivate: () => void; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`Excluir ${kindLabel}`}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 space-y-3">
        <h3 className="font-bold text-lg">Excluir {kindLabel} “{name}”?</h3>
        {blocked ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-4 py-3">
            Existem agendamentos futuros vinculados. Excluir vai deixá-los sem {kindLabel === 'serviço' ? 'serviço' : 'profissional'}.
            Recomendamos <strong>desativar</strong>: some da página, mas o histórico continua íntegro.
          </p>
        ) : (
          <p className="text-sm text-zinc-500">Sem agendamentos futuros vinculados. A exclusão não afeta o histórico passado.</p>
        )}
        <div className="space-y-2 pt-1">
          {blocked && (
            <button onClick={onDeactivate} className="w-full font-bold bg-zinc-900 text-white py-3 rounded-md">Desativar (recomendado)</button>
          )}
          <button onClick={onConfirm} className="w-full font-bold bg-red-50 text-red-600 py-3 rounded-md">Excluir mesmo assim</button>
          <button onClick={onClose} className="w-full font-bold bg-zinc-100 py-3 rounded-md">Voltar</button>
        </div>
      </div>
    </div>
  );
}

function ServiceForm({ businessId, service, cats, pros, onClose, onSave }: {
  businessId: string;
  service: Service | null;
  cats: Category[];
  pros: Professional[];
  onClose: () => void;
  onSave: (p: Record<string, any>) => Promise<void>;
}) {
  const [name, setName] = useState(service?.name || '');
  const [description, setDescription] = useState(service?.description || '');
  const [image, setImage] = useState(service?.image || '');
  const [price, setPrice] = useState(service ? centsToBR(service.price) : '');
  const [durationMin, setDurationMin] = useState(service?.durationMin || 45);
  const [categoryId, setCategoryId] = useState(service?.categoryId || '');
  const [proIds, setProIds] = useState<string[]>(service?.professionalIds || []);
  const [active, setActive] = useState(service?.active !== false);
  const [featured, setFeatured] = useState(!!service?.featured);
  const [bookable, setBookable] = useState(service?.bookable !== false);
  const [questions, setQuestions] = useState<string[]>(service?.questions || []);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const input = 'w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  function togglePro(id: string) {
    setProIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={service ? 'Editar serviço' : 'Novo serviço'}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={(e) => { e.preventDefault(); setError(''); setLoading(true); onSave({ id: service?.id, name, description, image, price: parseMoneyToCents(price), durationMin, professionalIds: proIds, categoryId, active, featured, bookable, questions }).catch((err) => setError(err.message)).finally(() => setLoading(false)); }}
        className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">{service ? 'Editar serviço' : 'Novo serviço'}</h3>
          <button type="button" onClick={onClose} className="font-bold text-zinc-400 px-2 inline-flex" aria-label="Fechar"><Icon n="x" size={16} /></button>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Nome * (ex: Corte)" autoFocus />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={input} rows={2} placeholder="Descrição (opcional)" />
        <ImageUpload label="FOTO DO SERVIÇO" value={image} onChange={setImage} businessId={businessId} />
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
        <div>
          <span className="text-xs font-bold text-zinc-500">PERGUNTAS NA RESERVA (OPCIONAL, ATÉ 3)</span>
          {[0, 1, 2].map((i) => (
            <input key={i} value={questions[i] || ''} onChange={(e) => setQuestions((v) => { const n = [...v]; n[i] = e.target.value; return n; })}
              className={input + ' mt-1.5'} placeholder={i === 0 ? 'Ex: Possui convênio? Qual?' : `Pergunta ${i + 1}`} maxLength={120} />
          ))}
        </div>
        {pros.length > 0 && (
          <div>
            <span className="text-xs font-bold text-zinc-500">QUEM REALIZA? (vazio = toda a equipe)</span>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {pros.map((p) => (
                <button type="button" key={p.id} onClick={() => togglePro(p.id)}
                  className={cn('text-sm font-bold px-4 py-2 rounded-md border-2', proIds.includes(p.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Ativo</label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Destaque</label>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={bookable} onChange={(e) => setBookable(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Aceita agendamento</label>
        </div>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <button disabled={loading} className="w-full font-bold bg-zinc-900 text-white py-3 rounded-md disabled:opacity-50">{loading ? 'Salvando…' : 'Salvar serviço'}</button>
      </form>
    </div>
  );
}

// ── Equipe ──
function TeamEditor({ businessId, pros, onSave, onAskDelete }: {
  businessId: string;
  pros: Professional[];
  onSave: (action: string, payload: Record<string, any>) => Promise<void>;
  onAskDelete: (p: Professional) => void;
}) {
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Professional | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [photo, setPhoto] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');

  function open(p: Professional | null) {
    setEditing(p);
    setName(p?.name || '');
    setRole(p?.role || '');
    setPhoto(p?.photo || '');
    setActive(p?.active !== false);
    setError('');
    setShow(true);
  }

  return (
    <>
      <button onClick={() => open(null)} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-md mb-4">+ Profissional</button>
      {show && (
        <form onSubmit={(e) => { e.preventDefault(); setError(''); onSave('professional.save', { id: editing?.id, name, role, photo, active }).then(() => setShow(false)).catch((err) => setError(err.message)); }}
          className="mb-4 bg-white border border-zinc-200 rounded-lg p-4 space-y-2.5">
          <p className="font-bold text-sm">{editing ? 'Editar profissional' : 'Novo profissional'}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome * (ex: João)" className="w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm" autoFocus />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Função (ex: Barbeiro)" className="w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm" />
          <ImageUpload label="FOTO DO PROFISSIONAL" value={photo} onChange={setPhoto} businessId={businessId} circle />
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Ativo (aparece na agenda)</label>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-md">Salvar</button>
            <button type="button" onClick={() => setShow(false)} className="text-sm font-bold bg-zinc-100 px-4 py-2.5 rounded-md">Voltar</button>
          </div>
        </form>
      )}
      {pros.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg text-center py-12 px-6">
          <p className="font-bold">Só você por aqui? Sem problema.</p>
          <p className="text-sm text-zinc-500 mt-1">A agenda funciona sem equipe. Adicione profissionais se precisar.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {pros.map((p) => (
            <div key={p.id} className={cn('bg-white border border-zinc-200 rounded-lg p-4 flex items-center gap-3', !p.active && 'opacity-60')}>
              {p.photo ? (
                <img src={p.photo} alt={p.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center font-bold shrink-0">{p.name.slice(0, 1)}</div>
              )}
              <div className="flex-1"><p className="font-bold text-sm">{p.name}</p><p className="text-xs text-zinc-500">{p.role || '—'}{!p.active && ' · inativo'}</p></div>
              <button onClick={() => open(p)} className="text-xs font-bold bg-zinc-100 px-3 py-2 rounded-lg">Editar</button>
              <button onClick={() => onAskDelete(p)} aria-label={`Excluir ${p.name}`}
                className="text-xs font-bold text-red-500 px-2 py-2 hover:bg-red-50 rounded-lg inline-flex"><Icon n="x" size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Horários: escopo por profissional + múltiplos períodos/dia ──
interface Period { start: string; end: string; slotMin: number }

function periodsFromRules(rules: Availability[], scopePro: string): Period[][] {
  const days: Period[][] = Array.from({ length: 7 }, () => []);
  for (const r of rules) {
    if (scopePro === '') {
      if (r.professionalId) continue;
    } else if (r.professionalId !== scopePro) continue;
    if (r.weekday >= 0 && r.weekday <= 6) {
      days[r.weekday].push({ start: r.start, end: r.end, slotMin: r.slotMin ?? 0 });
    }
  }
  return days;
}

function HoursScopeEditor({ scopePro, rules, onSave }: {
  scopePro: string;
  rules: Availability[];
  onSave: (rules: any[]) => Promise<void>;
}) {
  const [days, setDays] = useState<Period[][]>(() => periodsFromRules(rules, scopePro));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  function addPeriod(i: number) {
    setDays((d) => d.map((list, idx) => {
      if (idx !== i || list.length >= 3) return list;
      return [...list, { start: '09:00', end: '18:00', slotMin: 0 }];
    }));
  }

  function setPeriod(i: number, j: number, patch: Partial<Period>) {
    setDays((d) => d.map((list, idx) => (idx === i ? list.map((p, k) => (k === j ? { ...p, ...patch } : p)) : list)));
  }

  function removePeriod(i: number, j: number) {
    setDays((d) => d.map((list, idx) => (idx === i ? list.filter((_, k) => k !== j) : list)));
  }

  async function submit() {
    setSaving(true);
    setMsg('');
    try {
      const payload = days.flatMap((list, weekday) =>
        list.map((p) => ({ weekday, start: p.start, end: p.end, slotMin: p.slotMin })),
      );
      await onSave(payload);
      setMsg('Horários salvos.');
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="space-y-2.5">
        {DAYS.map((label, i) => (
          <div key={i} className="flex items-start gap-3">
            <button onClick={() => (days[i].length ? setDays((d) => d.map((l, idx) => (idx === i ? [] : l))) : addPeriod(i))}
              className={cn('w-14 shrink-0 text-xs font-bold py-2 rounded-lg', days[i].length ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-400')}>
              {label}
            </button>
            {days[i].length === 0 ? (
              <span className="text-xs text-zinc-400 py-2">Fechado</span>
            ) : (
              <div className="space-y-2 flex-1">
                {days[i].map((p, j) => (
                  <span key={j} className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="time" value={p.start} onChange={(e) => setPeriod(i, j, { start: e.target.value })} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" aria-label="Início" />
                    <span className="text-zinc-400">até</span>
                    <input type="time" value={p.end} onChange={(e) => setPeriod(i, j, { end: e.target.value })} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" aria-label="Fim" />
                    <select value={p.slotMin} onChange={(e) => setPeriod(i, j, { slotMin: Number(e.target.value) })} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm" aria-label="Intervalo">
                      <option value={0}>Duração do serviço</option>
                      <option value={15}>15min</option>
                      <option value={30}>30min</option>
                      <option value={45}>45min</option>
                      <option value={60}>60min</option>
                    </select>
                    {days[i].length > 1 && (
                      <button onClick={() => removePeriod(i, j)} className="text-zinc-400 hover:text-red-500 px-1" aria-label="Remover período"><Icon n="x" size={14} /></button>
                    )}
                  </span>
                ))}
                {days[i].length < 3 && days[i].length >= 1 && (
                  <button onClick={() => addPeriod(i)} className="text-xs font-bold text-emerald-700">+ período (ex: almoço separado)</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {msg && <p className="mt-3 text-sm font-medium">{msg}</p>}
      <button onClick={submit} disabled={saving} className="mt-4 text-sm font-bold bg-zinc-900 text-white px-5 py-2.5 rounded-md disabled:opacity-50">
        {saving ? 'Salvando…' : 'Salvar horários'}
      </button>
    </div>
  );
}

function HoursEditor({ rules, pros, onSave }: {
  rules: Availability[];
  pros: Professional[];
  onSave: (scope: { professionalId: string }, rules: any[]) => Promise<void>;
}) {
  const [scope, setScope] = useState('');
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5">
      <p className="font-bold text-sm">Quando você atende?</p>
      <p className="text-xs text-zinc-500 mb-4">O cliente só vê horários dentro destes períodos. Salvar aqui nunca apaga horários de outra pessoa.</p>
      {pros.length > 0 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button onClick={() => setScope('')}
            className={cn('shrink-0 text-xs font-bold px-3.5 py-2 rounded-full', scope === '' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600')}>
            Horário geral
          </button>
          {pros.map((p) => (
            <button key={p.id} onClick={() => setScope(p.id)}
              className={cn('shrink-0 text-xs font-bold px-3.5 py-2 rounded-full', scope === p.id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600')}>
              {p.name}
            </button>
          ))}
        </div>
      )}
      <HoursScopeEditor
        key={scope}
        scopePro={scope}
        rules={rules}
        onSave={(r) => onSave({ professionalId: scope }, r)}
      />
    </div>
  );
}

// ── Exceções: fechar dia / horário especial ──
function ExceptionsManager({ exceptions, onSave, onDelete }: {
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await onSave({ date, closed, start: closed ? '' : start, end: closed ? '' : end, note });
      setDate(''); setNote(''); setClosed(true);
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5">
      <p className="font-bold text-sm">Dias especiais</p>
      <p className="text-xs text-zinc-500 mb-4">Feriados, folgas e horários excepcionais — sem editar nada técnico.</p>
      {exceptions.length > 0 && (
        <div className="space-y-2 mb-4">
          {exceptions.map((x) => (
            <div key={x.id} className="flex items-center gap-3 bg-zinc-50 border border-zinc-200 rounded-md px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{x.date.split('-').reverse().join('/')} · {x.closed ? 'Fechado' : `${x.start}–${x.end}`}</p>
                {x.note && <p className="text-xs text-zinc-500">{x.note}</p>}
              </div>
              <button onClick={() => onDelete(x.id)} className="text-xs font-bold text-red-500 hover:bg-red-50 px-2 py-1.5 rounded-lg">Remover</button>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2.5">
        <label className="block"><span className="text-xs font-bold text-zinc-500">DATA</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="block rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1" /></label>
        <label className="block"><span className="text-xs font-bold text-zinc-500">TIPO</span>
          <select value={closed ? 'closed' : 'special'} onChange={(e) => setClosed(e.target.value === 'closed')} className="block rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1">
            <option value="closed">Fechado o dia todo</option>
            <option value="special">Horário especial</option>
          </select></label>
        {!closed && (
          <>
            <label className="block"><span className="text-xs font-bold text-zinc-500">DAS</span>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="block rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1" /></label>
            <label className="block"><span className="text-xs font-bold text-zinc-500">ATÉ</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="block rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1" /></label>
          </>
        )}
        <label className="block flex-1 min-w-[140px]"><span className="text-xs font-bold text-zinc-500">MOTIVO (OPCIONAL)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: Natal" className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1" /></label>
        <button className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-md">Adicionar</button>
      </form>
      {msg && <p className="mt-2 text-sm font-medium text-red-600">{msg}</p>}
    </div>
  );
}

// ── Políticas da agenda ──
function BookingSettings({ businessId, initial, hasTeam, onSaved }: {
  businessId: string;
  initial: BookingConfig;
  hasTeam: boolean;
  onSaved: () => void;
}) {
  const [cfg, setCfg] = useState<BookingConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/businesses/${businessId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking: cfg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const num = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1';
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-5">
      <p className="font-bold text-sm">Como a agenda funciona</p>
      <p className="text-xs text-zinc-500 mb-4">Regras simples que valem para todos os agendamentos.</p>
      <div className="grid sm:grid-cols-2 gap-3.5">
        {hasTeam && (
          <div className="sm:col-span-2">
            <span className="text-xs font-bold text-zinc-500">DISTRIBUIÇÃO DOS AGENDAMENTOS</span>
            <select value="balanced" className={num}>
              <option value="balanced">Equilibrar equipe — quem tem menos atendimentos no dia</option>
              <option value="soon" disabled>Em breve: outros modos de distribuição</option>
            </select>
            <span className="text-[11px] text-zinc-500">O cliente nunca escolhe o profissional — a regra é interna do negócio. Quem atende é resolvido automaticamente, respeitando profissionais ativos, vínculo serviço → profissional, horários, buffers e exceções.</span>
          </div>
        )}
        <label className="block"><span className="text-xs font-bold text-zinc-500">ANTECEDÊNCIA MÍNIMA (MIN)</span>
          <input type="number" min={0} max={1440} value={cfg.leadMin} onChange={(e) => setCfg({ ...cfg, leadMin: Number(e.target.value) })} className={num} />
          <span className="text-[11px] text-zinc-500">Ex: 30 = só reserva com 30 min de folga.</span></label>
        <label className="block"><span className="text-xs font-bold text-zinc-500">CANCELAR ATÉ (MIN ANTES)</span>
          <input type="number" min={0} max={10080} value={cfg.cancelUntilMin} onChange={(e) => setCfg({ ...cfg, cancelUntilMin: Number(e.target.value) })} className={num} />
          <span className="text-[11px] text-zinc-500">Depois disso, só falando com você.</span></label>
        <label className="block"><span className="text-xs font-bold text-zinc-500">AGENDA ABERTA (DIAS)</span>
          <input type="number" min={1} max={365} value={cfg.horizonDays} onChange={(e) => setCfg({ ...cfg, horizonDays: Number(e.target.value) })} className={num} /></label>
        <label className="block"><span className="text-xs font-bold text-zinc-500">INTERVALO ENTRE ATENDIMENTOS (MIN)</span>
          <input type="number" min={0} max={240} value={cfg.bufferMin} onChange={(e) => setCfg({ ...cfg, bufferMin: Number(e.target.value) })} className={num} /></label>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
      <button onClick={save} disabled={saving} className="mt-4 text-sm font-bold bg-zinc-900 text-white px-5 py-2.5 rounded-md disabled:opacity-50">
        {saving ? 'Salvando…' : 'Salvar regras'}
      </button>
    </div>
  );
}
