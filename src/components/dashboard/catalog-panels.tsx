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
import { useState } from 'react';
import Link from 'next/link';
import { cn, parseMoneyToCents, centsToBR } from '@/lib/utils';
import type { Availability, AvailabilityException, Category, Professional, Service } from '@/lib/types';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, Drawer } from '@/components/ui';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { followsBusinessHours } from '@/lib/schedule';
import { panelRoutesIn } from '@/lib/panel';

// ── Confirmação de exclusão (em sheet, nunca confirm() nativo) ──
export function DeleteSheet({ name, kindLabel, blocked, onDeactivate, onConfirm, onClose }: {
  name: string; kindLabel: string; blocked: boolean;
  onDeactivate: () => void; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Drawer open onClose={onClose} title={`Excluir ${kindLabel}`} width="max-w-md">
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 space-y-3">
        <h3 className="font-semibold text-lg">Excluir {kindLabel} “{name}”?</h3>
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
            <Button variant="primary" size="lg" className="w-full" onClick={onDeactivate}>Desativar (recomendado)</Button>
          )}
          <button onClick={onConfirm} className="w-full font-semibold bg-red-50 text-red-600 py-3 rounded-md">Excluir mesmo assim</button>
          <button onClick={onClose} className="w-full font-semibold bg-zinc-100 py-3 rounded-md">Voltar</button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Formulário de serviço ──
export function ServiceForm({ businessId, service, cats, pros, onClose, onSave }: {
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
  // Preço público (§ Serviços): desmarcado, o preço continua salvo/interno —
  // só sai da página pública e do assistente.
  const [showPrice, setShowPrice] = useState(service ? service.showPrice !== false : true);
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
    <Drawer open onClose={() => { if (!loading) onClose(); }} title={service ? 'Editar serviço' : 'Novo serviço'} width="max-w-lg">
      <form onSubmit={(e) => { e.preventDefault(); setError(''); setLoading(true); onSave({ id: service?.id, name, description, image, price: parseMoneyToCents(price), showPrice, durationMin, professionalIds: proIds, categoryId, active, featured, bookable, questions }).catch((err) => setError(err.message)).finally(() => setLoading(false)); }}
        className="p-5 space-y-3.5">
        <input aria-label="Nome do serviço" value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Nome * (ex: Consulta inicial)" autoFocus />
        <textarea aria-label="Descrição do serviço" value={description} onChange={(e) => setDescription(e.target.value)} className={input} rows={2} placeholder="Descrição (opcional)" />
        <ImageUpload label="FOTO DO SERVIÇO" value={image} onChange={setImage} businessId={businessId} />
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-semibold text-zinc-500">PREÇO (R$) *</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} className={input + ' mt-1'} placeholder="45,00" inputMode="decimal" /></label>
          <label className="block"><span className="text-xs font-semibold text-zinc-500">DURAÇÃO (MIN)</span>
            <input type="number" min={5} step={5} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} className={input + ' mt-1'} />
            <span className="text-[11px] text-zinc-500">Interna — usada pela agenda (conflito, buffer).</span></label>
        </div>
        <label className="flex items-start gap-2.5 bg-zinc-50 border border-zinc-200 rounded-md px-3.5 py-3 cursor-pointer select-none">
          <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} className="mt-0.5 w-4 h-4 accent-emerald-600 shrink-0" />
          <span className="text-sm">
            <span className="font-semibold">Mostrar preço na página pública</span>
            <span className="block text-xs text-zinc-500 mt-0.5">
              {showPrice
                ? 'O visitante vê o preço deste serviço na página e no assistente.'
                : 'O preço continua salvo e visível aqui e na agenda — apenas some da página pública.'}
            </span>
          </span>
        </label>
        <label className="block"><span className="text-xs font-semibold text-zinc-500">CATEGORIA</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input + ' mt-1'}>
            <option value="">Sem categoria</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <div>
          <span className="text-xs font-semibold text-zinc-500">PERGUNTAS NA RESERVA (OPCIONAL, ATÉ 3)</span>
          {[0, 1, 2].map((i) => (
            <input key={i} value={questions[i] || ''} onChange={(e) => setQuestions((v) => { const n = [...v]; n[i] = e.target.value; return n; })}
              className={input + ' mt-1.5'} placeholder={i === 0 ? 'Ex: Possui convênio? Qual?' : `Pergunta ${i + 1}`} maxLength={120} />
          ))}
        </div>
        {pros.length > 0 && (
          <div>
            <span className="text-xs font-semibold text-zinc-500">QUEM REALIZA ESTE ATENDIMENTO?</span>
            <p className="text-[11px] text-zinc-500 mt-0.5">Sem seleção = todos os profissionais elegíveis. O cliente não escolhe — a distribuição é automática.</p>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {pros.filter((p) => p.active !== false).map((p) => (
                <button type="button" key={p.id} onClick={() => togglePro(p.id)}
                  className={cn('text-sm font-semibold px-4 py-2 rounded-md border-2', proIds.includes(p.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
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
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>{loading ? 'Salvando…' : 'Salvar serviço'}</Button>
      </form>
    </Drawer>
  );
}

// ── Profissionais (quem REALIZA os atendimentos) ──
export function TeamEditor({ businessId, pros, rules, onSave, onAskDelete, onCreated, onManageAccess }: {
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
      <Button variant="primary" className="mb-4" onClick={() => open(null)}><Icon n="plus" size={14} /> Profissional</Button>
      {show && (
        <form onSubmit={(e) => { e.preventDefault(); setError(''); onSave('professional.save', { id: editing?.id, name, role, photo, active, followBusinessHours: follow }).then((data: any) => { setShow(false); if (!editing) onCreated?.(String(data?.professionalId || ''), name); }).catch((err) => setError(err.message)); }}
          className="mb-4 bg-white border border-zinc-200 rounded-lg p-4 space-y-2.5">
          <p className="font-semibold text-sm">{editing ? 'Editar profissional' : 'Novo profissional'}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome * (ex: Dra. Ana)" className="w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm" autoFocus />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Função (ex: Dentista)" className="w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm" />
          <ImageUpload label="FOTO DO PROFISSIONAL" value={photo} onChange={setPhoto} businessId={businessId} circle />
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-emerald-600" /> Ativo (aparece na agenda e na página)</label>
          <label className="flex items-start gap-2 text-sm font-medium">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="w-4 h-4 accent-emerald-600 mt-0.5" />
            <span>
              Seguir horário da empresa
              <span className="block text-xs font-normal text-zinc-500">
                {follow
                  ? 'Atende nos horários gerais — mudanças lá valem automaticamente aqui.'
                  : 'Horário personalizado: edite em Disponibilidade.'}
              </span>
            </span>
          </label>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary">Salvar</Button>
            <Button type="button" variant="secondary" onClick={() => setShow(false)}>Voltar</Button>
          </div>
        </form>
      )}
      {pros.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-lg text-center py-12 px-6">
          <p className="font-semibold">Só você por aqui? Sem problema.</p>
          <p className="text-sm text-zinc-500 mt-1">A agenda funciona sem equipe. Adicione profissionais se precisar.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {pros.map((p) => (
            <div key={p.id} className={cn('bg-white border border-zinc-200 rounded-lg p-4 flex flex-wrap items-center gap-3', !p.active && 'opacity-60')}>
              {/* Ponto 9 — o MESMO Avatar de Clientes: rounded-square suave,
                  foto real quando existe, iniciais como fallback. */}
              <Avatar name={p.name} src={p.photo || undefined} size={40} />
              <div className="flex-1 min-w-0 basis-[180px]">
                <p className="font-semibold text-sm flex flex-wrap items-center gap-2">
                  {p.name}
                  <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border', followsBusinessHours(p, rules) ? 'border-zinc-200 bg-zinc-50 text-zinc-600' : 'border-blue-200 bg-blue-50 text-blue-700')}>
                    {followsBusinessHours(p, rules) ? 'Segue a empresa' : 'Horário próprio'}
                  </span>
                </p>
                <p className="text-xs text-zinc-500">
                  {p.role || '—'}{!p.active && ' · inativo'}
                </p>
                {/* A3.4 — ACESSO AO SISTEMA é o outro conceito. Aqui ele aparece
                    no lugar em que a dúvida nasce: "essa pessoa entra no
                    painel?". Nunca criamos login em silêncio. */}
                <p className="mt-1">
                  {p.userId ? (
                    <Badge tone="green" icon="shield">Acesso ativo</Badge>
                  ) : (
                    <Badge tone="zinc" icon="lock">Sem acesso ao sistema</Badge>
                  )}
                </p>
              </div>
              {onManageAccess && (
                <button onClick={() => onManageAccess(p)} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-lg hover:bg-zinc-50">
                  {p.userId ? 'Gerenciar acesso' : 'Criar acesso'}
                </button>
              )}
              <button onClick={() => open(p)} className="text-xs font-semibold bg-zinc-100 px-3 py-2 rounded-lg">Editar</button>
              <button onClick={() => onAskDelete(p)} aria-label={`Excluir ${p.name}`}
                className="text-xs font-semibold text-red-500 px-2 py-2 hover:bg-red-50 rounded-lg inline-flex"><Icon n="x" size={13} /></button>
            </div>
          ))}
        </div>
      )}
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
      <p className="font-semibold text-sm">Dias especiais</p>
      <p className="text-xs text-zinc-500 mb-4">Feriados, folgas e horários excepcionais — sem editar nada técnico.</p>
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
        <Button type="submit" variant="primary">Adicionar</Button>
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
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {items.map((r) => (
        <Link key={r.href} href={`${r.href}?b=${businessId}`} title={r.description}
          className="text-xs font-semibold bg-white border border-zinc-200 px-3.5 py-2 rounded-md hover:border-zinc-400 inline-flex items-center gap-1.5">
          <Icon n={CROSS_ICONS[r.href] || r.icon} size={13} />
          {r.label} <span className="text-zinc-400 font-normal">· {CROSS_HINTS[r.href] || r.description}</span>
        </Link>
      ))}
    </div>
  );
}
