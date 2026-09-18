'use client';
// CAMPANHAS — mensagens para quem autorizou receber (LGPD).
// A base são SOMENTE contatos com consentimento explícito de marketing.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { CAMPAIGN_SEGMENTS } from '@/lib/types';
import type { CampaignSegment } from '@/lib/types';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';

interface Campaign {
  id: string; name: string; message: string; segment: CampaignSegment; status: string;
  createdAt: string; updatedAt: string; sentAt: string; createdBy: string;
  counts: { eligible: number; sent: number; delivered: number; failed: number };
}
interface Data {
  campaigns: Campaign[];
  audience: { segment: CampaignSegment; count: number }[];
  consent: { total: number; optedIn: number; optedOut: number; rule: string };
  whatsapp: { status: string; canSend: boolean };
  opportunities?: {
    winBack: number;
    sample: Array<{ name: string; phone: string; lastBooking: string; days: number }>;
  };
}

// Ciclo de vida: rascunho → pronta → enviando → enviada/parcial/falhou.
// Cancelada é um estado terminal amigável (registro permanece).
const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-600',
  ready: 'bg-amber-100 text-amber-800',
  sending: 'bg-blue-100 text-blue-800',
  sent: 'bg-emerald-100 text-emerald-800',
  partial: 'bg-orange-100 text-orange-800',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-zinc-200 text-zinc-500',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', ready: 'Pronta', sending: 'Enviando', sent: 'Enviada',
  partial: 'Parcial', failed: 'Falhou', cancelled: 'Cancelada',
};
const input = 'w-full rounded-md border border-zinc-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

export default function CampanhasPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [data, setData] = useState<Data | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; message: string; segment: CampaignSegment }>({ name: '', message: '', segment: 'all_optin' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  // 403 → aviso amigável (sessão preservada), nunca skeleton infinito.
  const { denied, report } = useAreaLoad('Campanhas');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<Data>(`/api/campaigns?businessId=${businessId}`, { scope: 'area', area: 'Campanhas' });
    if (!report(res)) return;
    setData(res.data);
  }, [businessId, report]);
  useEffect(() => { load(); }, [load]);

  async function call(method: 'POST' | 'PATCH' | 'DELETE', payload: Record<string, any>) {
    setBusy(payload.action || 'save'); setError(''); setMsg('');
    try {
      const res = method === 'DELETE'
        ? await apiSend<any>(`/api/campaigns?businessId=${businessId}&id=${payload.id}`, 'DELETE', undefined, { scope: 'action', area: 'Campanhas' })
        : await apiSend<any>('/api/campaigns', method, { businessId, ...payload }, { scope: 'action', area: 'Campanhas' });
      const d = res.data || {};
      if (!res.ok) throw new Error(res.message || 'Não foi possível.');
      setMsg(d.message || 'Feito.');
      setCreating(false);
      setForm({ name: '', message: '', segment: 'all_optin' });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
      setTimeout(() => setMsg(''), 6000);
    }
  }

  if (denied) return <AccessDenied area="Campanhas" />;
  if (!data) return <PageSkeleton />;
  const q = `?b=${businessId}`;
  const segLabel = (id: CampaignSegment) => CAMPAIGN_SEGMENTS.find((s) => s.id === id)?.label || id;
  const eligiblePreview = data.audience.find((a) => a.segment === form.segment)?.count ?? 0;
  const connected = data.whatsapp.canSend;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campanhas</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Mensagens para clientes que autorizaram receber. Promoção de setembro, retorno, data especial — você escolhe o público.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link2 href={`/clientes${q}`} label="Clientes" />
          <button onClick={() => setCreating(true)}
            className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-md hover:bg-zinc-700 inline-flex items-center gap-2">
            <Icon n="megaphone" size={16} /> Nova campanha
          </button>
        </div>
      </div>

      {msg && <p className="mb-4 text-sm font-semibold bg-emerald-600 text-white rounded-md px-4 py-3">{msg}</p>}
      {error && <p className="mb-4 text-sm font-semibold bg-amber-600 text-white rounded-md px-4 py-3">{error}</p>}

      <div className="grid sm:grid-cols-4 gap-3 mb-6">
        <Card label="Autorizaram (opt-in)" value={data.consent.optedIn} tone="ok" hint="podem receber campanha" />
        <Card label="Sem autorização" value={data.consent.optedOut} tone="warn" hint="nunca entram na campanha" />
        <Card label="Base de contatos" value={data.consent.total} />
        <Card label="WhatsApp" value={connected ? 'conectado' : 'não conectado'} tone={connected ? 'ok' : 'warn'} hint={connected ? 'envio disponível' : 'campanhas ficam salvas'} />
      </div>

      <p className="text-xs text-zinc-500 mb-5 bg-white border border-zinc-200 rounded-lg px-4 py-3">
        <strong>Regra de consentimento:</strong> {data.consent.rule} O sistema nunca presume autorização — promoções por
        WhatsApp/E-mail só vão para quem marcou a autorização no cadastro do cliente.
      </p>

      {(data.opportunities?.winBack ?? 0) > 0 && (
        <section className="bg-white border border-zinc-200 rounded-lg p-4 mb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-sm flex items-center gap-2">
                <Icon n="spark" size={15} className="text-amber-500" />
                Clientes sem retorno
                <span className="text-[10px] font-extrabold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                  {data.opportunities!.winBack} oportunidade(s)
                </span>
              </p>
              <p className="text-xs text-zinc-500 mt-1 max-w-xl">
                Clientes que já agendaram antes e passaram muito tempo sem voltar. Ao criar as oportunidades, elas
                aparecem em <strong>Clientes</strong> como leads “retorno” — você decide se vira conversa (e campanha
                só para quem autorizou).
              </p>
              {data.opportunities!.sample.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {data.opportunities!.sample.map((w, i) => (
                    <span key={i} className="text-[11px] font-semibold bg-zinc-50 border border-zinc-200 rounded-full px-2.5 py-1">
                      {w.name} · {w.days}d sem retorno
                    </span>
                  ))}
                  {data.opportunities!.winBack > data.opportunities!.sample.length && (
                    <span className="text-[11px] font-semibold text-zinc-400 px-1 py-1">+{data.opportunities!.winBack - data.opportunities!.sample.length}…</span>
                  )}
                </div>
              )}
            </div>
            <button onClick={() => call('POST', { action: 'winback' })} disabled={busy === 'winback'}
              className="text-xs font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-lg hover:bg-zinc-700 disabled:opacity-50 shrink-0">
              {busy === 'winback' ? 'Criando…' : 'Criar oportunidades'}
            </button>
          </div>
        </section>
      )}

      <section className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
        {data.campaigns.length === 0 && (
          <p className="text-sm text-zinc-500 px-4 py-8 text-center">Nenhuma campanha ainda. Crie a primeira — ela nasce como rascunho.</p>
        )}
        {data.campaigns.map((c) => (
          <div key={c.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold flex items-center gap-2 flex-wrap">
                  {c.name}
                  <span className={cn('text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full', STATUS_STYLE[c.status] || 'bg-zinc-100 text-zinc-600')}>{STATUS_LABEL[c.status] || c.status}</span>
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Público: <strong>{segLabel(c.segment)}</strong> · {c.counts.eligible} elegível(is)
                  {c.sentAt ? ` · enviada em ${c.sentAt.slice(0, 16).replace('T', ' ')}` : ''}
                  {c.createdBy ? ` · por ${c.createdBy}` : ''}
                </p>
                <p className="text-sm text-zinc-700 mt-2 bg-zinc-50 border border-zinc-100 rounded-md px-3 py-2 whitespace-pre-wrap">{c.message}</p>
                <div className="flex flex-wrap gap-3 mt-2 text-[11px] font-bold text-zinc-500">
                  <span>elegíveis {c.counts.eligible}</span>
                  <span>enviadas {c.counts.sent}</span>
                  <span>entregues {c.counts.delivered}</span>
                  <span className={c.counts.failed ? 'text-red-600' : ''}>falhas {c.counts.failed}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                {c.status === 'draft' && (
                  <button onClick={() => call('PATCH', { id: c.id, action: 'ready' })} disabled={busy === 'ready'}
                    className="text-xs font-bold bg-zinc-900 text-white px-3.5 py-2 rounded-lg disabled:opacity-50">Marcar como pronta</button>
                )}
                {(c.status === 'draft' || c.status === 'ready') && (
                  <button onClick={() => call('PATCH', { id: c.id, action: 'send' })} disabled={busy === 'send'}
                    className={cn('text-xs font-bold px-3.5 py-2 rounded-lg disabled:opacity-50',
                      connected ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-500')}
                    title={connected ? 'Enviar campanha' : 'WhatsApp ainda não conectado'}>
                    Enviar
                  </button>
                )}
                {(c.status === 'draft' || c.status === 'ready') && (
                  <button onClick={() => call('PATCH', { id: c.id, action: 'cancel' })}
                    className="text-xs font-bold bg-zinc-100 px-3.5 py-2 rounded-lg hover:bg-zinc-200">Cancelar</button>
                )}
                {c.status !== 'sent' && (
                  <button onClick={() => call('PATCH', { id: c.id, action: 'duplicate' })}
                    className="text-xs font-bold bg-zinc-100 px-3.5 py-2 rounded-lg hover:bg-zinc-200">Duplicar</button>
                )}
                {c.status === 'draft' && (
                  <button onClick={() => call('DELETE', { id: c.id })}
                    className="text-xs font-bold text-red-500 px-3.5 py-2 rounded-lg hover:bg-red-50">Excluir</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setCreating(false)} />
          <div className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white/95 backdrop-blur px-5 py-4 flex items-center justify-between border-b border-zinc-100">
              <p className="font-bold text-lg">Nova campanha</p>
              <button onClick={() => setCreating(false)} className="font-bold text-zinc-400 p-2 inline-flex" aria-label="Fechar"><Icon n="x" size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-3.5">
              <label className="block"><span className="text-xs font-bold text-zinc-500">NOME *</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input + ' mt-1'} placeholder="Ex: Promoção de Setembro" /></label>
              <div>
                <span className="text-xs font-bold text-zinc-500">PÚBLICO</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {CAMPAIGN_SEGMENTS.map((s) => {
                    const count = data.audience.find((a) => a.segment === s.id)?.count ?? 0;
                    return (
                      <button key={s.id} onClick={() => setForm({ ...form, segment: s.id })}
                        className={cn('text-xs font-bold px-3 py-2 rounded-lg border-2 text-left',
                          form.segment === s.id ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                        {s.label} <span className="opacity-60">({count})</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-zinc-500 mt-1.5">
                  Este público tem <strong>{eligiblePreview}</strong> contato(s) com autorização de marketing.
                </p>
              </div>
              <label className="block"><span className="text-xs font-bold text-zinc-500">MENSAGEM *</span>
                <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={5} className={input + ' mt-1'}
                  placeholder="Ex: Olá {nome}! Setembro chegou com 20% de desconto no corte. Responda AGENDAR para marcar ✂️" />
                <span className="text-[11px] text-zinc-500">Use <code>{'{nome}'}</code> para o primeiro nome do cliente.</span></label>
              {!connected && (
                <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-3 py-2">
                  WhatsApp ainda não conectado — a campanha pode ser criada e preparada, mas o envio fica bloqueado até a
                  integração oficial existir. Nada é enviado por canais falsos.
                </p>
              )}
              <button onClick={() => call('POST', form)} disabled={busy === 'save' || !form.name || !form.message}
                className="w-full font-bold bg-zinc-900 text-white py-3 rounded-md disabled:opacity-50">
                {busy === 'save' ? 'Salvando…' : 'Salvar rascunho'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Card({ label, value, hint, tone }: { label: string; value: number | string; hint?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className={cn('rounded-lg border p-4', tone === 'ok' ? 'bg-emerald-50 border-emerald-200' : tone === 'warn' ? 'bg-amber-50 border-amber-200' : 'bg-white border-zinc-200')}>
      <p className="text-xs font-bold text-zinc-500">{label}</p>
      <p className="text-xl font-extrabold mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function Link2({ href, label }: { href: string; label: string }) {
  // A1.2 · Bloco 3: navegação interna via Link (sem recarregar a aplicação).
  return <Link href={href} className="text-xs font-bold bg-white border border-zinc-200 rounded-md px-3.5 py-2 hover:bg-zinc-50">{label}</Link>;
}
