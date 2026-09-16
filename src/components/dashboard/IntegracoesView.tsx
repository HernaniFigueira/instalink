'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiGet, apiSend } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { ApiKey, SafeWebhookConfig, WebhookDelivery, WebhookEvent } from '@/lib/types';
import { VALID_WEBHOOK_EVENTS } from '@/lib/types';

function formatDateTime(iso: string): string {
  if (!iso) return '';
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)} às ${iso.slice(11, 16)}`;
}

interface ServiceItem {
  id: string;
  name: string;
}

interface ProfessionalItem {
  id: string;
  name: string;
}

export function IntegracoesView() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';

  const [activeTab, setActiveTab] = useState<'api' | 'webhooks' | 'embed'>('api');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // API Keys state
  const [keys, setKeys] = useState<Omit<ApiKey, 'keyHash'>[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [showNewKeyModal, setShowNewKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [codeLang, setCodeLang] = useState<'curl' | 'js' | 'python'>('curl');

  // Webhooks state
  const [webhooks, setWebhooks] = useState<SafeWebhookConfig[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(true);
  const [showNewWebhookModal, setShowNewWebhookModal] = useState(false);
  const [generatedWebhookSecret, setGeneratedWebhookSecret] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([...VALID_WEBHOOK_EVENTS]);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);

  // Widget / Agendamento Externo state
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [pros, setPros] = useState<ProfessionalItem[]>([]);
  const [previewServiceId, setPreviewServiceId] = useState('');
  const [previewProId, setPreviewProId] = useState('');
  const [embedCopied, setEmbedCopied] = useState(false);

  const [origin, setOrigin] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  // 1. Carrega API keys
  const loadKeys = useCallback(async () => {
    if (!businessId) return;
    setKeysLoading(true);
    try {
      const res = await apiGet<{ keys: Omit<ApiKey, 'keyHash'>[] }>(
        `/api/integrations/keys?businessId=${businessId}`,
        { scope: 'area', area: 'Configurações' },
      );
      if (res.ok && res.data) {
        setKeys(res.data.keys || []);
      }
    } finally {
      setKeysLoading(false);
    }
  }, [businessId]);

  // 2. Carrega Webhooks
  const loadWebhooks = useCallback(async () => {
    if (!businessId) return;
    setWebhooksLoading(true);
    try {
      const res = await apiGet<{ webhooks: SafeWebhookConfig[]; deliveries: WebhookDelivery[] }>(
        `/api/integrations/webhooks?businessId=${businessId}`,
        { scope: 'area', area: 'Configurações' },
      );
      if (res.ok && res.data) {
        setWebhooks(res.data.webhooks || []);
        setDeliveries(res.data.deliveries || []);
      }
    } finally {
      setWebhooksLoading(false);
    }
  }, [businessId]);

  // 3. Carrega Catálogo para o gerador de Widget
  const loadCatalog = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<{ services: ServiceItem[]; professionals: ProfessionalItem[] }>(
      `/api/catalog/get?businessId=${businessId}`,
      { scope: 'area', area: 'Configurações' },
    );
    if (res.ok && res.data) {
      setServices(res.data.services || []);
      setPros(res.data.professionals || []);
    }
  }, [businessId]);

  useEffect(() => {
    loadKeys();
    loadWebhooks();
    loadCatalog();
  }, [loadKeys, loadWebhooks, loadCatalog]);

  // Gerar chave de API
  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    setGeneratingKey(true);
    setError('');
    try {
      const res = await apiSend('/api/integrations/keys', 'POST', {
        businessId,
        name: newKeyName.trim() || 'Nova Chave',
      }, { scope: 'action', area: 'Configurações' });

      if (res.ok && res.data?.fullSecret) {
        setGeneratedSecret(res.data.fullSecret);
        setNewKeyName('');
        loadKeys();
      } else {
        setError(res.message || 'Erro ao gerar chave.');
      }
    } finally {
      setGeneratingKey(false);
    }
  }

  // Revogar chave de API
  async function handleRevokeKey(keyId: string) {
    if (!confirm('Deseja realmente revogar esta chave? Qualquer integração que utilize esta credencial parará de funcionar imediatamente.')) {
      return;
    }

    const res = await apiSend('/api/integrations/keys', 'DELETE', {
      businessId,
      keyId,
    }, { scope: 'action', area: 'Configurações' });

    if (res.ok) {
      setMsg('Chave revogada.');
      setTimeout(() => setMsg(''), 3000);
      loadKeys();
    } else {
      alert(res.message || 'Erro ao revogar chave.');
    }
  }

  // Salvar Webhook
  async function handleSaveWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!webhookUrl.trim()) return;

    setSavingWebhook(true);
    try {
      const res = await apiSend('/api/integrations/webhooks', 'POST', {
        businessId,
        url: webhookUrl.trim(),
        secret: webhookSecret.trim() || undefined,
        events: webhookEvents,
      }, { scope: 'action', area: 'Configurações' });

      if (res.ok) {
        const sec = res.data?.secret || res.data?.webhook?.secret;
        if (sec) {
          setGeneratedWebhookSecret(sec);
        } else {
          setShowNewWebhookModal(false);
        }
        setWebhookUrl('');
        setWebhookSecret('');
        setMsg('Webhook configurado com sucesso.');
        setTimeout(() => setMsg(''), 3000);
        loadWebhooks();
      } else {
        alert(res.message || 'Erro ao salvar webhook.');
      }
    } finally {
      setSavingWebhook(false);
    }
  }

  // Testar Webhook
  async function handleTestWebhook(hook: SafeWebhookConfig) {
    setTestingWebhookId(hook.id);
    setTestResult(null);
    try {
      const res = await apiSend('/api/integrations/webhooks/test', 'POST', {
        businessId,
        webhookId: hook.id,
      }, { scope: 'action', area: 'Configurações' });

      setTestResult(res.data);
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || 'Erro ao testar' });
    } finally {
      setTestingWebhookId(null);
    }
  }

  // Excluir Webhook
  async function handleDeleteWebhook(webhookId: string) {
    if (!confirm('Deseja excluir este webhook?')) return;
    const res = await apiSend('/api/integrations/webhooks', 'DELETE', {
      businessId,
      webhookId,
    }, { scope: 'action', area: 'Configurações' });

    if (res.ok) {
      loadWebhooks();
    }
  }

  // Deep link calculado
  const deepLinkUrl = useMemo(() => {
    let url = `${origin}/agendar?b=${encodeURIComponent(businessId)}`;
    if (previewServiceId) url += `&s=${encodeURIComponent(previewServiceId)}`;
    if (previewProId) url += `&p=${encodeURIComponent(previewProId)}`;
    return url;
  }, [origin, businessId, previewServiceId, previewProId]);

  const iframeSnippet = useMemo(() => {
    let src = `${origin}/agendar?b=${encodeURIComponent(businessId)}&embed=1`;
    if (previewServiceId) src += `&s=${encodeURIComponent(previewServiceId)}`;
    if (previewProId) src += `&p=${encodeURIComponent(previewProId)}`;
    return `<iframe src="${src}" style="width: 100%; height: 680px; border: none; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06);" allow="camera; microphone"></iframe>`;
  }, [origin, businessId, previewServiceId, previewProId]);

  const scriptSnippet = useMemo(() => {
    let attr = `data-business="${businessId}"`;
    if (previewServiceId) attr += ` data-service="${previewServiceId}"`;
    if (previewProId) attr += ` data-professional="${previewProId}"`;
    return `<div id="instalink-booking" ${attr}></div>\n<script src="${origin}/widget/booking.js" async></script>`;
  }, [origin, businessId, previewServiceId, previewProId]);

  return (
    <div className="space-y-4">
      {msg && <p className="text-sm font-medium bg-zinc-900 text-white rounded-md px-3 py-2">{msg}</p>}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-zinc-100 rounded-lg w-fit" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'api'}
          onClick={() => setActiveTab('api')}
          className={cn('text-xs font-semibold px-3 py-1.5 rounded-md transition', activeTab === 'api' ? 'bg-white shadow-sm border border-zinc-200 text-zinc-900' : 'text-zinc-500 hover:text-zinc-900')}
        >
          API de Integração
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'webhooks'}
          onClick={() => setActiveTab('webhooks')}
          className={cn('text-xs font-semibold px-3 py-1.5 rounded-md transition', activeTab === 'webhooks' ? 'bg-white shadow-sm border border-zinc-200 text-zinc-900' : 'text-zinc-500 hover:text-zinc-900')}
        >
          Webhooks de Saída
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'embed'}
          onClick={() => setActiveTab('embed')}
          className={cn('text-xs font-semibold px-3 py-1.5 rounded-md transition', activeTab === 'embed' ? 'bg-white shadow-sm border border-zinc-200 text-zinc-900' : 'text-zinc-500 hover:text-zinc-900')}
        >
          Agendamento Externo & Widget
        </button>
      </div>

      {/* ── ABA 1: API KEYS ── */}
      {activeTab === 'api' && (
        <div className="space-y-4">
          <section className="bg-white border border-zinc-200 p-5 rounded-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm text-zinc-900">Chaves de API para Integrações</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Conecte seu site externo, formulário ou sistema próprio diretamente ao InstaLink com segurança isolada por negócio.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGeneratedSecret(null);
                  setShowNewKeyModal(true);
                }}
                className="px-3.5 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 transition"
              >
                + Gerar Nova Chave
              </button>
            </div>

            {keysLoading ? (
              <p className="text-xs text-zinc-400 py-4">Carregando chaves…</p>
            ) : keys.length === 0 ? (
              <div className="py-8 text-center text-zinc-400 text-xs border border-dashed border-zinc-200 rounded-xl">
                Nenhuma credencial gerada ainda. Clique em "+ Gerar Nova Chave" para integrar seu site.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl overflow-hidden">
                {keys.map((k) => (
                  <div key={k.id} className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-zinc-50/50">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-zinc-900">{k.name}</span>
                        {k.revokedAt ? (
                          <span className="bg-red-100 text-red-700 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide">
                            Revogada
                          </span>
                        ) : (
                          <span className="bg-emerald-100 text-emerald-700 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wide">
                            Ativa
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 font-mono mt-0.5">{k.keyPrefix}</p>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        Criada em {formatDateTime(k.createdAt)} · {k.lastUsedAt ? `Último uso em ${formatDateTime(k.lastUsedAt)}` : 'Nunca utilizada'}
                      </p>
                    </div>

                    {!k.revokedAt && (
                      <button
                        type="button"
                        onClick={() => handleRevokeKey(k.id)}
                        className="text-xs text-red-600 font-semibold hover:underline border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50"
                      >
                        Revogar Chave
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Exemplos de Código para Desenvolvedores */}
          <section className="bg-white border border-zinc-200 p-5 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-zinc-900">Exemplos de Integração</h3>
                <p className="text-xs text-zinc-500">Envie leads e consulte disponibilidade a partir de qualquer backend ou formulário externo.</p>
              </div>
              <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg">
                {(['curl', 'js', 'python'] as const).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setCodeLang(lang)}
                    className={cn(
                      'text-[11px] px-2.5 py-1 rounded font-semibold transition',
                      codeLang === lang ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-900',
                    )}
                  >
                    {lang.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-zinc-900 text-zinc-100 p-4 rounded-xl font-mono text-xs overflow-x-auto">
              {codeLang === 'curl' && (
                <pre>{`# 1. Enviar Lead Externo
curl -X POST "${origin}/api/external/leads" \\
  -H "Authorization: Bearer SUA_CHAVE_AQUI" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: lead_${Date.now()}" \\
  -d '{
    "name": "Carlos Silva",
    "phone": "11999998888",
    "email": "carlos@exemplo.com",
    "message": "Tenho interesse no serviço",
    "source": "site_externo"
  }'

# 2. Consultar Horários Livres
curl "${origin}/api/external/availability?serviceId=SEU_SERVICO_ID&date=2026-09-20" \\
  -H "Authorization: Bearer SUA_CHAVE_AQUI"`}</pre>
              )}

              {codeLang === 'js' && (
                <pre>{`// JavaScript / Node.js Fetch
const response = await fetch("${origin}/api/external/leads", {
  method: "POST",
  headers: {
    "Authorization": "Bearer SUA_CHAVE_AQUI",
    "Content-Type": "application/json",
    "Idempotency-Key": "lead_" + Date.now()
  },
  body: JSON.stringify({
    name: "Carlos Silva",
    phone: "11999998888",
    email: "carlos@exemplo.com",
    message: "Quero marcar uma consulta",
    source: "landing_page"
  })
});
const data = await response.json();
console.log(data);`}</pre>
              )}

              {codeLang === 'python' && (
                <pre>{`# Python requests
import requests, time

url = "${origin}/api/external/leads"
headers = {
    "Authorization": "Bearer SUA_CHAVE_AQUI",
    "Content-Type": "application/json",
    "Idempotency-Key": f"lead_{int(time.time())}"
}
payload = {
    "name": "Carlos Silva",
    "phone": "11999998888",
    "email": "carlos@exemplo.com",
    "source": "site_externo"
}
res = requests.post(url, json=payload, headers=headers)
print(res.json())`}</pre>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ── ABA 2: WEBHOOKS ── */}
      {activeTab === 'webhooks' && (
        <div className="space-y-4">
          <section className="bg-white border border-zinc-200 p-5 rounded-xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm text-zinc-900">Webhooks de Saída</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Receba notificações em tempo real assinadas com HMAC-SHA256 sempre que um lead for criado ou agendamento confirmado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewWebhookModal(true)}
                className="px-3.5 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 transition"
              >
                + Adicionar Webhook
              </button>
            </div>

            {webhooksLoading ? (
              <p className="text-xs text-zinc-400 py-4">Carregando webhooks…</p>
            ) : webhooks.length === 0 ? (
              <div className="py-8 text-center text-zinc-400 text-xs border border-dashed border-zinc-200 rounded-xl">
                Nenhum endpoint configurado. Clique em "+ Adicionar Webhook" para receber eventos em tempo real.
              </div>
            ) : (
              <div className="space-y-3">
                {webhooks.map((hook) => (
                  <div key={hook.id} className="p-4 border border-zinc-200 rounded-xl space-y-3 hover:bg-zinc-50/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-xs font-bold text-zinc-900 break-all">{hook.url}</span>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {hook.events.map((ev) => (
                            <span key={ev} className="bg-zinc-100 text-zinc-700 text-[10px] px-2 py-0.5 rounded font-mono">
                              {ev}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={testingWebhookId === hook.id}
                          onClick={() => handleTestWebhook(hook)}
                          className="text-xs font-semibold px-3 py-1.5 border border-zinc-300 rounded-lg bg-white hover:bg-zinc-100"
                        >
                          {testingWebhookId === hook.id ? 'Testando…' : 'Testar Envio'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteWebhook(hook.id)}
                          className="text-xs text-red-600 font-semibold px-2 py-1.5 hover:underline"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>

                    <div className="text-xs text-zinc-500 bg-zinc-50 p-2.5 rounded-lg border border-zinc-100 flex items-center justify-between gap-2">
                      <span>Segredo da assinatura: <strong className="font-mono text-zinc-800">{hook.secretMasked || '••••••••'}</strong></span>
                      <span className="text-[11px] text-zinc-400">Protegido (armazenado com segurança)</span>
                    </div>

                    {testResult && testingWebhookId === null && (
                      <div className={cn(
                        'text-xs p-3 rounded-lg border',
                        testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800',
                      )}>
                        <strong>Resultado do Teste:</strong> {testResult.message} ({testResult.durationMs}ms)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Histórico de Entregas */}
          {deliveries.length > 0 && (
            <section className="bg-white border border-zinc-200 p-5 rounded-xl space-y-3">
              <h3 className="font-semibold text-sm text-zinc-900">Histórico Recente de Entregas</h3>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {deliveries.map((del) => (
                  <div key={del.id} className="text-xs flex items-center justify-between p-2 rounded bg-zinc-50 border border-zinc-100">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'w-2 h-2 rounded-full',
                        del.statusCode === 200 || del.statusCode === 201 ? 'bg-emerald-500' : 'bg-red-500',
                      )} />
                      <span className="font-mono font-semibold">{del.event}</span>
                      <span className="text-zinc-400 font-mono text-[10px]">HTTP {del.statusCode || 0}</span>
                    </div>
                    <span className="text-zinc-400 text-[10px]">{formatDateTime(del.createdAt)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ── ABA 3: EMBED & WIDGET ── */}
      {activeTab === 'embed' && (
        <div className="space-y-4">
          <section className="bg-white border border-zinc-200 p-5 rounded-xl space-y-4">
            <div>
              <h3 className="font-semibold text-sm text-zinc-900">Widget de Agendamento Online</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Permita que clientes agendem pelo seu site externo (WordPress, Webflow, Wix, HTML) utilizando a mesma agenda e disponibilidade.
              </p>
            </div>

            {/* Filtros para gerar código pré-selecionado */}
            <div className="grid sm:grid-cols-2 gap-3 bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Pré-selecionar Serviço</label>
                <select
                  value={previewServiceId}
                  onChange={(e) => setPreviewServiceId(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-zinc-300 bg-white"
                >
                  <option value="">Nenhum (cliente escolhe na tela)</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Pré-selecionar Profissional</label>
                <select
                  value={previewProId}
                  onChange={(e) => setPreviewProId(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-zinc-300 bg-white"
                >
                  <option value="">Qualquer profissional</option>
                  {pros.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 1. Link Direto */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-700">1. Link Direto (Deep Link)</span>
              <p className="text-xs text-zinc-500">Envie por WhatsApp, direct do Instagram ou coloque em um botão "Agendar Agora" no seu site.</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={deepLinkUrl}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-xs font-mono bg-zinc-50 text-zinc-700"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(deepLinkUrl);
                    alert('Link copiado!');
                  }}
                  className="px-3.5 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 whitespace-nowrap"
                >
                  Copiar Link
                </button>
                <a
                  href={deepLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-2 border border-zinc-300 text-zinc-700 text-xs font-semibold rounded-lg hover:bg-zinc-50 whitespace-nowrap"
                >
                  Testar ↗
                </a>
              </div>
            </div>

            {/* 2. Código Iframe */}
            <div className="space-y-1.5 pt-3 border-t border-zinc-100">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-700">2. Código Incorporado (Iframe HTML)</span>
              <p className="text-xs text-zinc-500">Copie e cole este código dentro de qualquer página HTML, WordPress (bloco HTML) ou Webflow.</p>
              <div className="relative">
                <textarea
                  readOnly
                  rows={3}
                  value={iframeSnippet}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-xs font-mono bg-zinc-900 text-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(iframeSnippet);
                    setEmbedCopied(true);
                    setTimeout(() => setEmbedCopied(false), 2000);
                  }}
                  className="absolute right-2 top-2 px-2.5 py-1 bg-white text-zinc-900 text-[11px] font-bold rounded shadow"
                >
                  {embedCopied ? 'Copiado!' : 'Copiar Iframe'}
                </button>
              </div>
            </div>

            {/* 3. Código Widget Script */}
            <div className="space-y-1.5 pt-3 border-t border-zinc-100">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-700">3. Código Widget (Script)</span>
              <p className="text-xs text-zinc-500">Alternativa leve via tag script que monta o componente automaticamente no elemento indicado.</p>
              <textarea
                readOnly
                rows={3}
                value={scriptSnippet}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-xs font-mono bg-zinc-900 text-zinc-100"
              />
            </div>
          </section>
        </div>
      )}

      {/* ── Modal Gerar Nova Chave ── */}
      {showNewKeyModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl animate-scaleUp">
            <div className="flex items-start justify-between border-b pb-3">
              <h2 className="text-base font-bold text-zinc-900">Gerar Chave de Integração</h2>
              <button
                type="button"
                onClick={() => {
                  setShowNewKeyModal(false);
                  setGeneratedSecret(null);
                }}
                className="w-7 h-7 rounded-full border border-zinc-200 text-zinc-500 flex items-center justify-center hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>

            {generatedSecret ? (
              <div className="space-y-4">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs space-y-1">
                  <p className="font-bold">⚠️ Copie sua chave de API agora!</p>
                  <p>Por motivos de segurança, esta credencial completa não será exibida novamente.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Chave de API (Segredo Completo)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedSecret}
                      className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-xs font-mono bg-zinc-50 font-bold"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(generatedSecret);
                        alert('Chave copiada para a área de transferência!');
                      }}
                      className="px-3.5 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800"
                    >
                      Copiar
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowNewKeyModal(false);
                    setGeneratedSecret(null);
                  }}
                  className="w-full py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg"
                >
                  Entendi, já guardei a chave
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateKey} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Nome da Integração *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Site Principal, Landing Page de Implantes…"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-zinc-300"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">Um nome para identificar onde esta chave está sendo usada.</p>
                </div>

                <button
                  type="submit"
                  disabled={generatingKey || !newKeyName.trim()}
                  className="w-full py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition"
                >
                  {generatingKey ? 'Gerando…' : 'Gerar Chave'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Modal Adicionar Webhook ── */}
      {showNewWebhookModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl animate-scaleUp">
            <div className="flex items-start justify-between border-b pb-3">
              <h2 className="text-base font-bold text-zinc-900">
                {generatedWebhookSecret ? 'Segredo do Webhook Gerado' : 'Novo Webhook de Saída'}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowNewWebhookModal(false);
                  setGeneratedWebhookSecret(null);
                }}
                className="w-7 h-7 rounded-full border border-zinc-200 text-zinc-500 flex items-center justify-center hover:bg-zinc-100"
              >
                ✕
              </button>
            </div>

            {generatedWebhookSecret ? (
              <div className="space-y-4">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
                  <strong>Atenção:</strong> Guarde este segredo agora. Por motivos de segurança, ele não será exibido novamente no painel nem em requisições GET.
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Segredo da Assinatura HMAC (whsec_...)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedWebhookSecret}
                      className="flex-1 text-xs font-mono p-2.5 rounded-lg border border-zinc-300 bg-zinc-50 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(generatedWebhookSecret);
                        alert('Segredo copiado para a área de transferência!');
                      }}
                      className="px-3.5 py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800"
                    >
                      Copiar
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowNewWebhookModal(false);
                    setGeneratedWebhookSecret(null);
                  }}
                  className="w-full py-2 bg-zinc-900 text-white text-xs font-semibold rounded-lg"
                >
                  Entendi, já guardei o segredo
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveWebhook} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">URL de Destino (HTTPS) *</label>
                  <input
                    type="url"
                    required
                    placeholder="https://seusite.com/api/webhooks/instalink"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-zinc-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">Eventos Ativos</label>
                  <div className="space-y-1.5 border border-zinc-200 rounded-lg p-2.5 max-h-40 overflow-y-auto">
                    {VALID_WEBHOOK_EVENTS.map((ev) => (
                      <label key={ev} className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={webhookEvents.includes(ev)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setWebhookEvents([...webhookEvents, ev]);
                            } else {
                              setWebhookEvents(webhookEvents.filter((x) => x !== ev));
                            }
                          }}
                          className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                        />
                        <span className="font-mono">{ev}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingWebhook || !webhookUrl.trim() || webhookEvents.length === 0}
                  className="w-full py-2.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-800 disabled:opacity-50 transition"
                >
                  {savingWebhook ? 'Salvando…' : 'Salvar Webhook'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
