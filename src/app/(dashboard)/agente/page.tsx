'use client';
// AGENTE DE ATENDIMENTO — configuração por empresa.
// O assistente do site consome ESTA configuração (nome, saudação, tom,
// objetivos, orientações, limitações e escalada para humano) + o conhecimento
// real do negócio (serviços, preços públicos, horários, FAQ, Sobre).
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { AgentObjective, AgentTone, BusinessAgent } from '@/lib/types';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';

interface Options { tones: Array<{ id: AgentTone; label: string; hint: string }>; objectives: Array<{ id: AgentObjective; label: string }> }
interface Preview {
  greeting: string;
  knowledge: {
    businessName: string; description: string; hours: string; address: string; about: string;
    services: Array<{ name: string; price: number; durationMin: number; bookable: boolean }>;
    faq: Array<{ q: string; a: string }>;
    extra: Array<{ topic: string; answer: string }>;
  };
  moduleEnabled: boolean; canBook: boolean; whatsapp: boolean; whatsappStatus: string;
}

const input = 'w-full rounded-md border border-zinc-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';
const money = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function AgentePage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [agent, setAgent] = useState<BusinessAgent | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tab, setTab] = useState<'config' | 'conhecimento'>('config');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // 403 → aviso amigável na tela (o usuário continua logado).
  const { denied, report } = useAreaLoad('Agente');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<{ agent: BusinessAgent; options: any; preview: any }>(
      `/api/agent?businessId=${businessId}`, { scope: 'area', area: 'Agente' },
    );
    if (!report(res) || !res.data) return;
    setAgent(res.data.agent);
    setOptions(res.data.options);
    setPreview(res.data.preview);
  }, [businessId, report]);

  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof BusinessAgent>(k: K, v: BusinessAgent[K]) =>
    setAgent((a) => (a ? { ...a, [k]: v } : a));

  async function save() {
    if (!agent) return;
    setSaving(true); setMsg(''); setError('');
    try {
      const res = await apiSend('/api/agent', 'PUT', { ...agent, businessId }, { scope: 'action', area: 'Agente' });
      if (!res.ok) throw new Error(res.message);
      setMsg('Agente salvo. A página pública já usa esta configuração.');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 4000);
    }
  }

  if (denied) return <AccessDenied area="Agente" />;
  if (!agent || !options) return <PageSkeleton />;
  const pv = preview as Preview | null;
  const q = `?b=${businessId}`;

  function toggleObjective(id: AgentObjective) {
    const has = agent!.objectives.includes(id);
    set('objectives', has ? agent!.objectives.filter((o) => o !== id) : [...agent!.objectives, id]);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agente de atendimento</h1>
          <p className="text-sm text-zinc-500 mt-1">
            O assistente que responde na sua página usando os dados reais do negócio — sem inventar e sem mexer na sua agenda.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-bold rounded-full px-3 py-1.5 border inline-flex items-center gap-1.5',
            preview?.moduleEnabled ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-zinc-100 border-zinc-200 text-zinc-500',
          )}>
            <span className={cn('w-2 h-2 rounded-full', preview?.moduleEnabled ? 'bg-emerald-600' : 'bg-zinc-400')} />
            {preview?.moduleEnabled ? 'Módulo ativo na página' : 'Módulo desativado'}
          </span>
          <Link href={`/recursos${q}`} className="text-xs font-bold bg-white border border-zinc-200 rounded-md px-3.5 py-2 hover:bg-zinc-50">
            Recursos
          </Link>
        </div>
      </div>

      {!preview?.moduleEnabled && (
        <p className="mb-4 text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-4 py-3">
          O recurso <strong>Assistente</strong> está desativado na empresa. Configure aqui e ligue em{' '}
          <Link href={`/recursos${q}`} className="underline font-bold">Recursos</Link> para ele aparecer na página.
        </p>
      )}

      <div className="flex gap-1 p-1 bg-zinc-100 rounded-md mb-4 w-fit" role="tablist">
        {(['config', 'conhecimento'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn('text-xs font-bold px-4 py-2 rounded-lg', tab === t ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500')}>
            {t === 'config' ? 'Configuração' : 'Conhecimento usado'}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 text-sm font-semibold bg-emerald-600 text-white rounded-md px-4 py-3">{msg}</p>}
      {error && <p className="mb-4 text-sm font-semibold bg-red-600 text-white rounded-md px-4 py-3">{error}</p>}

      {tab === 'config' ? (
        <div className="space-y-4">
          <section className="bg-white border border-zinc-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="spark" size={16} className="text-zinc-400" /> Identidade</h3>
                <p className="text-xs text-zinc-500 mt-1">Como o agente se apresenta e se comporta.</p>
              </div>
              <button onClick={() => set('enabled', !agent.enabled)} role="switch" aria-checked={agent.enabled}
                className={cn('text-xs font-bold px-3.5 py-2 rounded-full border-2', agent.enabled ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                {agent.enabled ? 'Ativo' : 'Desativado'}
              </button>
            </div>
            <label className="block"><span className="text-xs font-bold text-zinc-500">NOME DO AGENTE</span>
              <input value={agent.name} onChange={(e) => set('name', e.target.value)} className={input + ' mt-1'} placeholder="Ex: Assistente Odonto" /></label>
            <label className="block"><span className="text-xs font-bold text-zinc-500">SAUDAÇÃO</span>
              <textarea value={agent.greeting} onChange={(e) => set('greeting', e.target.value)} rows={2} className={input + ' mt-1'}
                placeholder="Olá! Sou o assistente virtual da {empresa}. Como posso ajudar?" />
              <span className="text-[11px] text-zinc-500">Use <code>{'{empresa}'}</code> para o nome do negócio aparecer automaticamente.</span></label>
            <div>
              <span className="text-xs font-bold text-zinc-500">PERSONALIDADE / TOM</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {options.tones.map((t) => (
                  <button key={t.id} onClick={() => set('tone', t.id)} title={t.hint}
                    className={cn('text-sm font-bold px-3.5 py-2 rounded-md border-2', agent.tone === t.id ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-xs font-bold text-zinc-500">OBJETIVO</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {options.objectives.map((o) => {
                  const on = agent.objectives.includes(o.id);
                  return (
                    <button key={o.id} onClick={() => toggleObjective(o.id)}
                      className={cn('text-sm font-bold px-3.5 py-2 rounded-md border-2', on ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                      {on && <Icon n="check" size={13} className="inline -mt-0.5 mr-1" />}{o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="bg-white border border-zinc-200 rounded-lg p-5 space-y-3.5">
            <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="shield" size={16} className="text-zinc-400" /> Regras e limites</h3>
            <label className="block"><span className="text-xs font-bold text-zinc-500">ORIENTAÇÕES DO AGENTE</span>
              <textarea value={agent.instructions} onChange={(e) => set('instructions', e.target.value)} rows={4} className={input + ' mt-1'}
                placeholder={'Ex: Não informar diagnóstico.\nNão prometer resultados.\nQuando o cliente pedir algo que exija atendimento humano, encaminhar para a equipe.'} /></label>
            <label className="block"><span className="text-xs font-bold text-zinc-500">REGRAS / LIMITAÇÕES</span>
              <textarea value={agent.restrictions} onChange={(e) => set('restrictions', e.target.value)} rows={3} className={input + ' mt-1'}
                placeholder={'Ex: Nunca criar, cancelar ou remarcar agendamento.\nNunca citar valores que não estejam no cadastro.'} /></label>
            <label className="block"><span className="text-xs font-bold text-zinc-500">ESCALADA PARA HUMANO</span>
              <textarea value={agent.handoffMessage} onChange={(e) => set('handoffMessage', e.target.value)} rows={2} className={input + ' mt-1'}
                placeholder="Quando não souber responder, encaminhar para o WhatsApp." /></label>
            <div className="rounded-md bg-zinc-50 border border-zinc-200 p-3.5">
              <p className="text-xs font-bold text-zinc-600 mb-2">CANAIS</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => set('channels', { ...agent.channels, site: !agent.channels.site })}
                  className={cn('text-xs font-bold px-3 py-2 rounded-lg border-2', agent.channels.site ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                  Site {agent.channels.site ? '✓' : '—'}
                </button>
                <Link href={`/canais?tab=canais${businessId ? `&b=${businessId}` : ''}`}
                  className="text-xs font-bold px-3 py-2 rounded-lg border-2 border-zinc-200 text-zinc-500"
                  title="O canal WhatsApp é conectado em Canais & Integrações; as conversas ficam em Conversas">
                  WhatsApp {pv?.whatsappStatus === 'connected' ? '✓' : '— (não conectado)'}
                </Link>
              </div>
            </div>
          </section>

          <section className="bg-white border border-zinc-200 rounded-lg p-5 space-y-3">
            <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="chat" size={16} className="text-zinc-400" /> Conhecimento adicional</h3>
            <p className="text-xs text-zinc-500">Uma linha por assunto, no formato <strong>Tema: resposta</strong>. Ex: <em>Estacionamento: temos convênio ao lado.</em></p>
            <textarea value={agent.knowledgeOverride} onChange={(e) => set('knowledgeOverride', e.target.value)} rows={5} className={input}
              placeholder={'Estacionamento: temos convênio com o estacionamento ao lado.\nFormas de pagamento: PIX, cartão e dinheiro.'} />
            <p className="text-xs text-zinc-500">Além disso, o agente usa: nome, descrição, serviços, preços públicos, duração, horários, endereço, FAQ e a seção Sobre.</p>
          </section>

          <div className="sticky bottom-4">
            <button onClick={save} disabled={saving}
              className="w-full sm:w-auto font-bold bg-zinc-900 text-white px-6 py-3.5 rounded-md disabled:opacity-50 shadow-lg">
              {saving ? 'Salvando…' : 'Salvar agente'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <section className="bg-white border border-zinc-200 rounded-lg p-5">
            <h3 className="font-bold text-sm mb-2">Prévia da saudação</h3>
            <p className="text-sm bg-zinc-50 border border-zinc-200 rounded-md p-3.5">{pv?.greeting}</p>
          </section>
          <section className="bg-white border border-zinc-200 rounded-lg p-5">
            <h3 className="font-bold text-sm mb-3">O que o agente pode usar agora</h3>
            <dl className="text-sm space-y-2">
              <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-semibold">Empresa</dt><dd className="font-bold text-right">{pv?.knowledge.businessName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-semibold">Serviços</dt><dd className="font-bold text-right">{pv?.knowledge.services.length || 0}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-semibold">Agendamento</dt><dd className="font-bold text-right">{pv?.canBook ? 'disponível' : 'indisponível'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-semibold">FAQ publicado</dt><dd className="font-bold text-right">{pv?.knowledge.faq.length || 0} item(ns)</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-semibold">Conhecimento extra</dt><dd className="font-bold text-right">{pv?.knowledge.extra.length || 0} linha(s)</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-zinc-500 font-semibold">Horários</dt><dd className="font-bold text-right max-w-[60%]">{pv?.knowledge.hours || '—'}</dd></div>
            </dl>
          </section>
          {(pv?.knowledge.services.length || 0) > 0 && (
            <section className="bg-white border border-zinc-200 rounded-lg p-5">
              <h3 className="font-bold text-sm mb-2">Serviços que ele conhece</h3>
              <ul className="text-sm space-y-1.5">
                {pv!.knowledge.services.map((s) => (
                  <li key={s.name} className="flex justify-between gap-3">
                    <span>{s.name} <span className="text-zinc-400 text-xs">· {s.durationMin} min</span></span>
                    <span className="font-bold">{money(s.price)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-zinc-500">
            O agente <strong>não cria, não cancela e não remarca</strong> agendamentos, e não promete condições que
            não estejam cadastradas — ele orienta e encaminha para a equipe.
          </p>
        </div>
      )}
    </>
  );
}
