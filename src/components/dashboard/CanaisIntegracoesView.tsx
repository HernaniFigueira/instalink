'use client';
// ═══════════════════════════════════════════════════════════════
// P6 — CANAIS E INTEGRAÇÕES (Configurações → Canais)
// ═══════════════════════════════════════════════════════════════
// A tela mostra a VERDADE do produto, em três blocos que não se misturam:
//
//   CANAIS        → por onde se conversa (WhatsApp, Instagram, Messenger, Telegram)
//   FONTES        → de onde o lead veio (formulário, landing page, QR, página…)
//   INTEGRAÇÕES   → por onde os dados viajam (webhook de entrada, n8n, API)
//
// Conector que ainda não existe aparece como "Disponível em breve" com o motivo
// — nada de fingir conexão. O que JÁ funciona aparece com "Conectar" e devolve
// endpoint + token reais (o token só é exibido uma vez).
//
// Webhooks de SAÍDA continuam na aba Integrações (canal assinado do P3) — a
// fonte de verdade não foi duplicada.
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { Button, Notice, PageSkeleton } from '@/components/ui';

interface SafeIntegration {
  id: string;
  businessId: string;
  kind: 'channel' | 'source' | 'technical';
  provider: string;
  name: string;
  direction: 'in' | 'out' | 'both';
  status: 'active' | 'paused';
  tokenMasked: string;
  signingSecretMasked: string;
  requireSignature: boolean;
  defaultEvent: string;
  endpointPath: string;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string;
  lastEventAt: string;
  eventCount: number;
}

interface ProviderView {
  provider: string;
  kind: 'channel' | 'source' | 'technical';
  label: string;
  hint: string;
  canConnect: boolean;
  unavailableReason?: string;
  nativePending?: boolean;
  setupHint?: string;
  direction: 'in' | 'out' | 'both';
  events: string[];
  defaultEvent: string;
  connections: SafeIntegration[];
}

interface IntegrationEventRow {
  id: string;
  integrationId: string;
  provider: string;
  direction: 'in' | 'out';
  event: string;
  status: 'processed' | 'duplicate' | 'rejected' | 'failed';
  externalEventId: string;
  httpStatus: number;
  reason: string;
  leadId: string;
  contactId: string;
  automationRunIds: string[];
  at: string;
}

interface ConsoleData {
  channels: ProviderView[];
  sources: ProviderView[];
  technical: ProviderView[];
  connections: SafeIntegration[];
  events: IntegrationEventRow[];
  summary: { total: number; processed: number; duplicate: number; rejected: number; failed: number; lastEventAt: string };
}

const STATUS_TONE: Record<IntegrationEventRow['status'], string> = {
  processed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  duplicate: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  rejected: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
};

const STATUS_LABEL: Record<IntegrationEventRow['status'], string> = {
  processed: 'Processado',
  duplicate: 'Duplicado',
  rejected: 'Recusado',
  failed: 'Falhou',
};

function when(iso: string): string {
  if (!iso) return '—';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

/**
 * `only` restringe a renderização a UM dos três blocos (canais · fontes ·
 * integrações) para que a página /canais possa oferecer abas REAIS e
 * exclusivas. Sem `only`, os três aparecem em sequência (uso em Configurações
 * nunca mais acontece: a porta única é /canais).
 */
export function CanaisIntegracoesView({ only }: { only?: 'channel' | 'source' | 'technical' } = {}) {
  const { businessId, resolving, noBusiness } = useBusinessId();
  const [data, setData] = useState<ConsoleData | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [createFor, setCreateFor] = useState<ProviderView | null>(null);
  const [createName, setCreateName] = useState('');
  const [createEvent, setCreateEvent] = useState('');
  const [requireSignature, setRequireSignature] = useState(false);
  const [revealed, setRevealed] = useState<{ endpoint: string; token: string; signingSecret: string; title: string } | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<ConsoleData>(`/api/integrations?businessId=${businessId}`, { scope: 'area', area: 'Configurações' });
    if (res.ok && res.data) setData(res.data as unknown as ConsoleData);
    else if (!res.ok) setError(res.message);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  function copy(value: string, label: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).then(() => {
        setMsg(`${label} copiado.`);
        setTimeout(() => setMsg(''), 2500);
      }).catch(() => setMsg('Não foi possível copiar automaticamente.'));
    }
  }

  async function create(provider: ProviderView) {
    setBusy(provider.provider);
    setError('');
    const res = await apiSend<{ integration: SafeIntegration; token: string; signingSecret: string; endpointPath: string }>(
      '/api/integrations', 'POST',
      {
        businessId, provider: provider.provider,
        name: createName.trim() || provider.label,
        defaultEvent: createEvent || provider.defaultEvent || undefined,
        requireSignature,
      },
      { scope: 'action', area: 'Configurações' },
    );
    setBusy('');
    if (!res.ok || !res.data) { setError(res.message); return; }
    setCreateFor(null);
    setCreateName('');
    setCreateEvent('');
    setRequireSignature(false);
    setRevealed({
      title: `${provider.label}: credenciais`,
      endpoint: typeof window !== 'undefined' ? `${window.location.origin}${res.data.endpointPath}` : res.data.endpointPath,
      token: res.data.token,
      signingSecret: requireSignature ? res.data.signingSecret : '',
    });
    await load();
  }

  async function act(id: string, action: 'pause' | 'activate' | 'rotate' | 'delete') {
    setBusy(id + action);
    setError('');
    if (action === 'delete') {
      const res = await apiSend('/api/integrations', 'DELETE', { businessId, id }, { scope: 'action', area: 'Configurações' });
      setBusy('');
      if (!res.ok) { setError(res.message); return; }
      setMsg('Integração removida.');
      await load();
      return;
    }
    const res = await apiSend<{ token?: string; signingSecret?: string; integration?: SafeIntegration }>(
      '/api/integrations', 'PATCH', { businessId, id, action }, { scope: 'action', area: 'Configurações' },
    );
    setBusy('');
    if (!res.ok || !res.data) { setError(res.message); return; }
    if (action === 'rotate' && res.data.token) {
      const connection = (data?.connections || []).find((c) => c.id === id);
      setRevealed({
        title: `${connection?.name || 'Integração'}: novo token`,
        endpoint: typeof window !== 'undefined' && connection?.endpointPath
          ? `${window.location.origin}${connection.endpointPath}` : (connection?.endpointPath || ''),
        token: res.data.token,
        signingSecret: res.data.signingSecret || '',
      });
    } else {
      setMsg(action === 'pause' ? 'Integração pausada.' : 'Integração reativada.');
    }
    await load();
  }

  if (noBusiness) return <p className="text-sm text-zinc-500">Nenhuma empresa ativa nesta conta.</p>;
  if (resolving || (!data && !error)) return <PageSkeleton />;

  const groups: Array<{ key: string; title: string; hint: string; items: ProviderView[] }> = [
    { key: 'channel', title: 'Canais', hint: 'Por onde a conversa acontece com o cliente.', items: data?.channels || [] },
    { key: 'source', title: 'Fontes', hint: 'De onde o lead chega até você.', items: data?.sources || [] },
    { key: 'technical', title: 'Integrações', hint: 'Por onde os dados viajam (webhook, n8n, APIs).', items: data?.technical || [] },
  ].filter((g) => !only || g.key === only);
  const showTechnical = !only || only === 'technical';

  return (
    <div className="space-y-4">
      {msg && <Notice tone="info">{msg}</Notice>}
      {error && <p className="text-xs font-medium bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2">{error}</p>}

      <section className="bg-white border border-zinc-200 p-4">
        <h3 className="font-semibold text-sm">Canais e integrações</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          O GoDoutor recebe eventos de fora, transforma em <strong>evento interno</strong> e entrega ao motor de automações
          (e o contrário também: uma automação pode falar com um sistema externo). Cada conexão pertence só a esta empresa.
        </p>
        {(data?.summary.total || 0) > 0 && (
          <p className="text-xs text-zinc-500 mt-2">
            Eventos recebidos: {data?.summary.total} · processados {data?.summary.processed} · duplicados {data?.summary.duplicate} ·
            recusados {data?.summary.rejected} · último {when(data?.summary.lastEventAt || '')}
          </p>
        )}
      </section>

      {groups.map((group) => (
        <section key={group.key} className="bg-white border border-zinc-200">
          <div className="px-4 py-3 border-b border-zinc-100">
            <h3 className="font-semibold text-sm">{group.title}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{group.hint}</p>
          </div>
          <div className="divide-y divide-zinc-100">
            {group.items.map((provider) => (
              <div key={provider.provider} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{provider.label}</p>
                      {!provider.canConnect && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide bg-zinc-100 text-zinc-500 border border-zinc-200 rounded px-1.5 py-0.5">
                          Disponível em breve
                        </span>
                      )}
                      {provider.canConnect && provider.nativePending && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
                          Conector nativo em breve
                        </span>
                      )}
                      {provider.canConnect && provider.connections.length > 0 && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5">
                          {provider.connections.length} conectada{provider.connections.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">{provider.hint}</p>
                    {!provider.canConnect && provider.unavailableReason && (
                      <p className="text-xs text-zinc-400 mt-0.5">{provider.unavailableReason}</p>
                    )}
                    {provider.canConnect && provider.setupHint && (
                      <p className="text-xs text-zinc-400 mt-0.5">{provider.setupHint}</p>
                    )}
                  </div>
                  {provider.canConnect && (
                    <button
                      onClick={() => { setCreateFor(provider); setCreateName(provider.label); setCreateEvent(provider.defaultEvent || ''); }}
                      disabled={busy === provider.provider}
                      className="text-xs font-semibold bg-[var(--brand)] text-white px-3 py-1.5 rounded-md shadow-brand hover:bg-[var(--brand-strong)] disabled:opacity-50 shrink-0"
                    >
                      Conectar
                    </button>
                  )}
                </div>

                {provider.connections.map((connection) => (
                  <div key={connection.id} className="mt-3 border border-zinc-200 rounded-md p-3 bg-zinc-50/60">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-800">
                          {connection.name}
                          <span className={cn('ml-2 text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 border',
                            connection.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-zinc-100 text-zinc-500 border-zinc-200')}>
                            {connection.status === 'active' ? 'Ativa' : 'Pausada'}
                          </span>
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-1 font-mono break-all">
                          {connection.tokenMasked}
                          {connection.requireSignature && ` · assinatura: ${connection.signingSecretMasked}`}
                        </p>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          {connection.eventCount} evento(s) · último {when(connection.lastEventAt)}
                          {connection.endpointPath && ` · ${connection.endpointPath}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5 justify-end shrink-0">
                        <button onClick={() => act(connection.id, 'rotate')} disabled={busy === connection.id + 'rotate'}
                          className="text-[11px] font-semibold bg-white border border-zinc-200 px-2 py-1 rounded">Novo token</button>
                        <button onClick={() => act(connection.id, connection.status === 'active' ? 'pause' : 'activate')}
                          disabled={busy === connection.id + (connection.status === 'active' ? 'pause' : 'activate')}
                          className="text-[11px] font-semibold bg-white border border-zinc-200 px-2 py-1 rounded">
                          {connection.status === 'active' ? 'Pausar' : 'Reativar'}
                        </button>
                        <button onClick={() => act(connection.id, 'delete')} disabled={busy === connection.id + 'delete'}
                          className="text-[11px] font-semibold bg-white border border-zinc-200 text-red-600 px-2 py-1 rounded">Remover</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}

      {showTechnical && (
      <>
      <section className="bg-white border border-zinc-200 p-4">
        <h3 className="font-semibold text-sm">Webhooks de saída</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          Para o GoDoutor <strong>avisar</strong> seu sistema (lead criado, agendamento…), o destino é configurado na aba
          <strong> Integrações</strong>, com assinatura HMAC e reenvio automático — o mesmo canal que as automações usam.
        </p>
      </section>

      <section className="bg-white border border-zinc-200">
        <div className="px-4 py-3 border-b border-zinc-100">
          <h3 className="font-semibold text-sm">Eventos recebidos</h3>
          <p className="text-xs text-zinc-500 mt-0.5">O que chegou de fora, o que o GoDoutor fez com cada evento e por quê.</p>
        </div>
        {(data?.events || []).length === 0 ? (
          <p className="px-4 py-6 text-xs text-zinc-500">Nenhum evento recebido ainda.</p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {(data?.events || []).map((row) => (
              <div key={row.id} className="px-4 py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-800">
                    {row.event || row.direction === 'out' ? row.event || 'envio' : row.event}
                    <span className="text-zinc-400 font-normal"> · {row.provider || 'integração'}</span>
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5 break-words">
                    {row.reason || '—'}
                    {row.automationRunIds.length > 0 && ` · ${row.automationRunIds.length} execução(ões) de automação`}
                    {row.leadId && ' · lead atualizado'}
                    {row.contactId && !row.leadId && ' · contato atualizado'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className={cn('text-[10px] font-semibold uppercase tracking-wide border rounded px-1.5 py-0.5', STATUS_TONE[row.status])}>
                    {STATUS_LABEL[row.status]}
                  </span>
                  <p className="text-[10px] text-zinc-400 mt-1">{when(row.at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      </>
      )}

      {createFor && (
        <div className="fixed inset-0 bg-[var(--overlay)] flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white rounded-lg w-full max-w-md p-5 space-y-3">
            <h2 className="text-sm font-bold">Conectar {createFor.label}</h2>
            <p className="text-xs text-zinc-500">{createFor.setupHint || createFor.hint}</p>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Nome</span>
              <input value={createName} onChange={(e) => setCreateName(e.target.value)} maxLength={60}
                className="w-full mt-1 rounded-md border border-zinc-300 px-3 py-2 text-sm" />
            </label>
            {createFor.events.length > 1 && (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Evento padrão (payload cru)</span>
                <select value={createEvent} onChange={(e) => setCreateEvent(e.target.value)}
                  className="w-full mt-1 rounded-md border border-zinc-300 px-3 py-2 text-sm">
                  <option value="">Exigir envelope canônico (`event`)</option>
                  {createFor.events.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
                </select>
              </label>
            )}
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input type="checkbox" checked={requireSignature} onChange={(e) => setRequireSignature(e.target.checked)} />
              Exigir assinatura HMAC (X-Instalink-Signature) além do token
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setCreateFor(null)} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md">Cancelar</button>
              <button onClick={() => create(createFor)} disabled={busy === createFor.provider}
                className="text-xs font-semibold bg-[var(--brand)] text-white px-3 py-2 rounded-md shadow-brand hover:bg-[var(--brand-strong)] disabled:opacity-50">
                {busy === createFor.provider ? 'Criando…' : 'Criar integração'}
              </button>
            </div>
          </div>
        </div>
      )}

      {revealed && (
        <div className="fixed inset-0 bg-[var(--overlay)] flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <div className="bg-white rounded-lg w-full max-w-lg p-5 space-y-3">
            <h2 className="text-sm font-bold">{revealed.title}</h2>
            <p className="text-xs font-medium bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
              Copie agora: o token não será mostrado novamente.
            </p>
            {revealed.endpoint && (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Endpoint</span>
                <span className="mt-1 flex items-center gap-2">
                  <input readOnly value={revealed.endpoint} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-xs font-mono" />
                  <button onClick={() => copy(revealed.endpoint, 'Endpoint')} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md">Copiar</button>
                </span>
              </label>
            )}
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Token</span>
              <span className="mt-1 flex items-center gap-2">
                <input readOnly value={revealed.token} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-xs font-mono" />
                <button onClick={() => copy(revealed.token, 'Token')} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md">Copiar</button>
              </span>
            </label>
            {revealed.signingSecret && (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Segredo de assinatura</span>
                <span className="mt-1 flex items-center gap-2">
                  <input readOnly value={revealed.signingSecret} className="w-full rounded-md border border-zinc-300 px-3 py-2 text-xs font-mono" />
                  <button onClick={() => copy(revealed.signingSecret, 'Segredo')} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md">Copiar</button>
                </span>
              </label>
            )}
            <details className="text-xs text-zinc-600">
              <summary className="cursor-pointer font-semibold">Exemplo de chamada</summary>
              <pre className="mt-2 bg-[var(--code-bg)] text-[var(--code-fg)] rounded-md p-3 overflow-x-auto text-[11px] leading-relaxed">{`curl -X POST '${revealed.endpoint}' \\
  -H 'Authorization: Bearer ${revealed.token}' \\
  -H 'Content-Type: application/json' \\
  -d '{"event":"lead.created","externalId":"evt-1","contact":{"name":"Maria","phone":"11999998888"},"data":{"interest":"Corte"}}'`}</pre>
            </details>
            <div className="flex justify-end pt-1">
              <Button variant="primary" onClick={() => setRevealed(null)}>Entendi</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
