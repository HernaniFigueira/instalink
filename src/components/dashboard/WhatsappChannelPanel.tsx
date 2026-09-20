'use client';
// ═══════════════════════════════════════════════════════════════
// CANAL WHATSAPP — estado da conexão (Canais & Integrações → Canais)
// ═══════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Button, PageSkeleton } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import { humanDateTime } from '@/lib/tz';
import {
  EMBEDDED_SIGNUP_SDK_SRC, SIGNUP_CODE_TTL_SECONDS, SIGNUP_MESSAGE_ORIGIN, SIGNUP_MESSAGE_TYPE,
  WA_ME_TEST_DISCLAIMER, parseSignupMessage,
} from '@/lib/whatsapp-onboarding';

// ── SDK do Facebook (só carrega quando alguém vai conectar) ──
declare global {
  interface Window { FB?: any; fbAsyncInit?: () => void }
}

interface OnboardingItemView { key: string; label: string; why: string; ok: boolean; secret: boolean; required: boolean }
interface OnboardingLayerView {
  id: 'platform' | 'unit'; title: string; owner: string; items: OnboardingItemView[]; ready: boolean; missing: string[];
}
interface OnboardingStepView { id: string; label: string; ok: boolean; current: boolean; detail: string }
export interface WaOnboardingView {
  plan: {
    state: string; headline: string; detail: string; code: string;
    layers: OnboardingLayerView[];
    steps: OnboardingStepView[];
    nextAction: { kind: string; label: string; detail: string };
    version: { current: string; level: string; message: string };
    clientConfig: { appId: string; configId: string; version: string } | null;
  };
  masterRouteAvailable: boolean;
  webhookPath: string;
  signupState?: string;
}

export interface WaChannelData {
  status: 'not_connected' | 'pending' | 'connected' | 'error';
  label: { state: string; label: string; detail: string };
  integration: {
    displayPhone: string;
    connectedAt: string;
    lastWebhookAt: string;
    lastInboundAt?: string;
    lastOutboundAt?: string;
    lastError?: string;
    requestedAt: string;
    phoneNumberId: string;
    wabaId?: string;
  };
  canViewDiagnostics?: boolean;
  diagnostics?: {
    credentialsConfigured: boolean;
    credentialSource: string;
    hasPhoneNumberId: boolean;
    hasWabaId: boolean;
    webhookReceived: boolean;
    lastInboundAt: string;
    lastOutboundAt: string;
    recentError: string;
  };
  server?: { configured: boolean; missingEnv: string[]; envVars: readonly string[] };
  inbox: { conversations: number; open: number; unread: number };
  linkFallback: string;
}

/**
 * Carrega o SDK do Facebook uma única vez e inicializa com o App ID da
 * plataforma. Sem `window.FB` não existe popup oficial — e aí a tela diz isso,
 * em vez de fingir uma conexão.
 */
let fbSdkPromise: Promise<any> | null = null;
function loadFacebookSdk(appId: string, version: string): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Sem navegador para abrir o popup da Meta.'));
  if (window.FB) return Promise.resolve(window.FB);
  if (fbSdkPromise) return fbSdkPromise;
  fbSdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('facebook-jssdk');
    const init = () => {
      try {
        window.FB.init({ appId, version, xfbml: false, cookie: false });
        resolve(window.FB);
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Falha ao inicializar o SDK da Meta.'));
      }
    };
    if (existing) { init(); return; }
    window.fbAsyncInit = init;
    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = EMBEDDED_SIGNUP_SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => reject(new Error('Não consegui carregar o SDK da Meta. Verifique se o painel não está bloqueando connect.facebook.net.'));
    document.body.appendChild(script);
    // Se o SDK travar (bloqueio de rede/adblock), não deixamos a tela em "abrindo…".
    setTimeout(() => { if (!window.FB) reject(new Error('O SDK da Meta demorou demais para carregar. Verifique bloqueadores de conteúdo e tente de novo.')); }, 15000);
  });
  return fbSdkPromise;
}

function LayerCard({ layer, tone }: { layer: OnboardingLayerView; tone: 'platform' | 'unit' }) {
  return (
    <div className="border border-zinc-200 rounded-md p-3 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{layer.title}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{layer.owner}</p>
        </div>
        <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${
          layer.ready
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : tone === 'platform'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-zinc-100 border-zinc-200 text-zinc-600'
        }`}>
          {layer.ready ? 'Pronto' : tone === 'platform' ? 'Bloqueio da plataforma' : 'Pendente'}
        </span>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {layer.items.map((item) => (
          <li key={item.key} className="flex items-start gap-2">
            <span className={`mt-0.5 text-xs ${item.ok ? 'text-emerald-700' : item.required ? 'text-rose-700' : 'text-zinc-400'}`}>
              {item.ok ? '✓' : '•'}
            </span>
            <span className="min-w-0">
              <span className={`text-xs font-medium ${item.ok ? 'text-zinc-800' : 'text-zinc-700'}`}>
                {item.label}{item.secret && !item.ok ? ' (segredo — só no servidor)' : ''}
              </span>
              {!item.ok && <span className="block text-[11px] text-zinc-500">{item.why}</span>}
            </span>
          </li>
        ))}
      </ul>
      {!layer.ready && layer.missing.length > 0 && (
        <p className="text-[11px] font-mono text-amber-800 mt-2">falta: {layer.missing.join(', ')}</p>
      )}
    </div>
  );
}

export function WhatsappChannelPanel({ businessId }: { businessId: string }) {
  const [data, setData] = useState<WaChannelData | null>(null);
  const [guide, setGuide] = useState<WaOnboardingView | null>(null);
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  // O popup devolve o WABA (e às vezes o número) por postMessage, ANTES do
  // callback com o código. Guardamos para mandar junto na troca.
  const signupRef = useRef<{ wabaId: string; phoneNumberId: string }>({ wabaId: '', phoneNumberId: '' });

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<WaChannelData>(`/api/whatsapp?businessId=${businessId}`, {
      scope: 'area', area: 'Canais',
    });
    if (!res.ok) { setError(res.message); return; }
    setData(res.data || null);
    setError('');
    const g = await apiGet<WaOnboardingView>(`/api/whatsapp/onboarding?businessId=${businessId}`, {
      scope: 'area', area: 'Canais',
    });
    if (g.ok) setGuide(g.data || null);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Conexão OFICIAL (Embedded Signup): abre o popup da Meta, recebe o código e
   * manda para o NOSSO servidor trocar pelo token. O navegador nunca vê token,
   * segredo nem código de longa duração.
   */
  async function connectWithMeta() {
    const cfg = guide?.plan.clientConfig;
    if (!cfg) {
      setError('A conexão oficial ainda não está habilitada nesta instalação. Veja o que falta na camada "Plataforma".');
      return;
    }
    setSigning(true); setMsg(''); setError('');
    signupRef.current = { wabaId: '', phoneNumberId: '' };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== SIGNUP_MESSAGE_ORIGIN) return;
      const parsed = parseSignupMessage(event.data);
      if (String((event.data as any)?.type || '') !== SIGNUP_MESSAGE_TYPE) return;
      signupRef.current = { wabaId: parsed.wabaId, phoneNumberId: parsed.phoneNumberId };
      if (parsed.event && parsed.event.startsWith('CANCEL')) {
        setError('Conexão cancelada no popup da Meta. Nada foi alterado.');
      }
    };
    window.addEventListener('message', onMessage);

    try {
      const FB = await loadFacebookSdk(cfg.appId, cfg.version);
      const code = await new Promise<string>((resolve, reject) => {
        FB.login((response: any) => {
          const auth = response?.authResponse?.code;
          if (auth) return resolve(String(auth));
          reject(new Error('O popup foi fechado antes de autorizar. Nada foi alterado.'));
        }, {
          config_id: cfg.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: { setup: {} },
        });
      });
      // O código vale 30 segundos e é de uso único: troca imediata, sem retry.
      const res = await apiSend<{ message?: string }>('/api/whatsapp/onboarding', 'POST', {
        businessId, action: 'exchange', code,
        state: guide?.signupState || '',
        wabaId: signupRef.current.wabaId,
        phoneNumberId: signupRef.current.phoneNumberId,
        pin: pin.trim() || undefined,
      }, { scope: 'action', area: 'Canais' });
      const data = res.data as any;
      if (!res.ok && !data?.pending) throw new Error(res.message || 'A Meta recusou a conexão.');
      // Pendente de registro não é erro: é a etapa seguinte (o PIN).
      setMsg(data?.message || (data?.pending ? 'Falta registrar o número.' : 'Conta oficial conectada.'));
      if (!data?.pending) setPin('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível abrir o popup da Meta.');
    } finally {
      window.removeEventListener('message', onMessage);
      setSigning(false);
    }
  }

  /**
   * Conclui o registro do número com o PIN de duas etapas usando a autorização
   * já guardada (sem repetir o popup).
   */
  async function registerNumber() {
    setBusy(true); setMsg(''); setError('');
    try {
      const res = await apiSend<{ message?: string }>('/api/whatsapp/onboarding', 'POST', {
        businessId, action: 'register', pin: pin.trim(),
      }, { scope: 'action', area: 'Canais' });
      if (!res.ok) throw new Error(res.message || 'Não consegui registrar o número.');
      setPin('');
      setMsg(res.data?.message || 'Número registrado.');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não consegui registrar o número.');
    } finally {
      setBusy(false);
    }
  }

  /** Caminho assistido: servidor já tem credenciais globais e valida um número. */
  async function connectAssistant() {
    setBusy(true); setMsg(''); setError('');
    try {
      const res = await apiSend<{ message?: string; missingEnv?: string[] }>(
        '/api/whatsapp', 'POST', { businessId, action: 'connect', displayPhone: phone },
        { scope: 'action', area: 'Canais' },
      );
      const d = res.data || {};
      if (!res.ok) throw new Error(res.message + (d.missingEnv?.length ? ` Faltando: ${d.missingEnv.join(', ')}` : ''));
      setMsg(d.message || res.message || '');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível conectar.'); }
    finally { setBusy(false); }
  }

  async function testConnection() {
    setTesting(true); setMsg(''); setError('');
    try {
      const res = await apiSend<{ message?: string; verifiedName?: string }>(
        '/api/whatsapp', 'POST', { businessId, action: 'test' },
        { scope: 'action', area: 'Canais' },
      );
      if (!res.ok) throw new Error(res.message || 'Falha ao testar conexão.');
      setMsg(`Conexão confirmada com a Meta! Nome verificado: ${res.data?.verifiedName || 'Sim'}`);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao testar conexão.'); }
    finally { setTesting(false); }
  }

  async function disconnect() {
    if (!confirm('Tem certeza que deseja desconectar a conta do WhatsApp desta unidade?')) return;
    setBusy(true); setMsg(''); setError('');
    try {
      const res = await apiSend<{ message?: string }>(
        '/api/whatsapp', 'POST', { businessId, action: 'disconnect' },
        { scope: 'action', area: 'Canais' },
      );
      if (!res.ok) throw new Error(res.message || 'Não foi possível desconectar.');
      setMsg('WhatsApp desconectado com sucesso.');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao desconectar.'); }
    finally { setBusy(false); }
  }

  if (!data) return <PageSkeleton />;

  const q = `?b=${businessId}`;
  const status = data.status;
  const connected = status === 'connected';

  return (
    <div className="space-y-3">
      {msg && <p className="text-sm font-medium bg-emerald-700 text-white rounded-md px-3 py-2">{msg}</p>}
      {error && <p className="text-sm font-medium bg-amber-600 text-white rounded-md px-3 py-2">{error}</p>}

      <div className="bg-white border border-zinc-200">
        <div className="px-4 py-3 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">WhatsApp · estado da conexão</p>
            <p className="text-xs text-zinc-500 mt-0.5">{data.label.detail}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium border rounded-full px-2 py-0.5 ${
              status === 'connected'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : status === 'pending'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : status === 'error'
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-zinc-100 border-zinc-200 text-zinc-600'
            }`}>
              {status === 'connected' ? 'Conectado' : status === 'pending' ? 'Configurando' : status === 'error' ? 'Erro' : 'Não conectado'}
            </span>
            {connected && (
              <Link href={`/conversas${q}`} className="inline-block"><Button variant="secondary" size="xs">Abrir Conversas</Button></Link>
            )}
          </div>
        </div>

        {connected ? (
          <div className="px-4 py-4 space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-zinc-500">Número</p>
                <p className="text-sm font-semibold mt-0.5">{data.integration.displayPhone || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Phone Number ID</p>
                <p className="text-sm font-mono text-zinc-700 mt-0.5">{data.integration.phoneNumberId || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">WABA ID</p>
                <p className="text-sm font-mono text-zinc-700 mt-0.5">{data.integration.wabaId || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Último webhook</p>
                <p className="text-sm font-semibold mt-0.5">
                  {data.integration.lastWebhookAt
                    ? humanDateTime(data.integration.lastWebhookAt.slice(0, 10), data.integration.lastWebhookAt.slice(11, 16))
                    : 'Nenhum evento recebido'}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Última mensagem recebida</p>
                <p className="text-sm font-semibold mt-0.5">
                  {data.integration.lastInboundAt
                    ? humanDateTime(data.integration.lastInboundAt.slice(0, 10), data.integration.lastInboundAt.slice(11, 16))
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Última mensagem enviada</p>
                <p className="text-sm font-semibold mt-0.5">
                  {data.integration.lastOutboundAt
                    ? humanDateTime(data.integration.lastOutboundAt.slice(0, 10), data.integration.lastOutboundAt.slice(11, 16))
                    : '—'}
                </p>
              </div>
            </div>

            {data.integration.lastError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-md p-2.5 text-xs">
                <span className="font-semibold">Erro recente:</span> {data.integration.lastError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-100">
              <Link href={`/conversas${q}`} className="inline-block"><Button variant="secondary" size="xs">Abrir Conversas</Button></Link>
              <button
                onClick={testConnection}
                disabled={testing}
                className="text-xs font-medium bg-white border border-zinc-300 text-zinc-700 rounded-md px-3 py-1.5 hover:bg-zinc-50 disabled:opacity-50"
              >
                {testing ? 'Testando…' : 'Testar conexão'}
              </button>
              <button
                onClick={disconnect}
                disabled={busy}
                className="text-xs font-medium text-rose-700 border border-rose-200 bg-rose-50 rounded-md px-3 py-1.5 hover:bg-rose-100 disabled:opacity-50 ml-auto"
              >
                Desconectar
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 sm:px-6 py-6 space-y-4">
            <div className="text-center max-w-xl mx-auto">
              <div className="w-12 h-12 rounded-md bg-[var(--success-bg)] text-[var(--success-fg)] flex items-center justify-center mx-auto"><Icon n="whatsapp" size={24} /></div>
              <h3 className="font-semibold mt-3">{guide?.plan.headline || 'WhatsApp não conectado'}</h3>
              <p className="text-sm text-zinc-500 mt-1">
                {guide?.plan.detail
                  || (status === 'error'
                    ? data.integration.lastError || 'Houve uma falha na autenticação da conta junto à Meta.'
                    : 'Conecte sua conta oficial do WhatsApp Business Cloud API para receber mensagens e agendamentos.')}
              </p>
            </div>

            {/* As duas camadas: o que é da plataforma (não é sua culpa) e o que é seu. */}
            {/* A ordem REAL: autorizado → webhook → número → registro → conectado. */}
            {guide && guide.plan.steps.length > 0 && (
              <ol className="border border-zinc-200 rounded-md divide-y divide-zinc-100 bg-white">
                {guide.plan.steps.map((step) => (
                  <li key={step.id} className="px-3 py-2 flex items-start gap-2">
                    <span className={`mt-0.5 text-xs ${step.ok ? 'text-emerald-700' : step.current ? 'text-amber-700' : 'text-zinc-400'}`}>
                      {step.ok ? '✓' : step.current ? '→' : '•'}
                    </span>
                    <span className="min-w-0">
                      <span className={`text-xs font-medium ${step.ok ? 'text-zinc-800' : step.current ? 'text-amber-900' : 'text-zinc-600'}`}>
                        {step.label}{step.current && !step.ok ? ' — agora' : ''}
                      </span>
                      <span className="block text-[11px] text-zinc-500">{step.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {guide && (
              <details className="text-xs text-zinc-600">
                <summary className="cursor-pointer">Ver requisitos por camada (plataforma e unidade)</summary>
                <div className="grid sm:grid-cols-2 gap-3 mt-2">
                  {guide.plan.layers.map((layer) => (
                    <LayerCard key={layer.id} layer={layer} tone={layer.id} />
                  ))}
                </div>
              </details>
            )}

            {guide?.plan.version.level !== 'ok' && (
              <p className={`text-xs rounded-md px-3 py-2 border ${
                guide?.plan.version.level === 'expired'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}>
                <span className="font-semibold">Graph API {guide?.plan.version.current}:</span> {guide?.plan.version.message}
              </p>
            )}

            <div className="max-w-xl mx-auto space-y-3">
              {guide?.plan.nextAction.kind === 'embedded_signup' && (
                <div className="space-y-2">
                  <Button variant="primary" onClick={connectWithMeta} disabled={signing}>
                    {signing ? 'Abrindo o popup da Meta…' : 'Conectar com a Meta'}
                  </Button>
                  <p className="text-xs text-zinc-500">
                    Abre o popup oficial: você entra com o Facebook da clínica, escolhe a conta WhatsApp Business e o número.
                    O código vale {SIGNUP_CODE_TTL_SECONDS} segundos e é trocado no nosso servidor — nenhum token passa pelo navegador.
                  </p>
                  <div className="flex items-end gap-2">
                    <label className="text-xs text-zinc-600">
                      PIN de verificação em duas etapas (opcional, se o número ainda não estiver registrado)
                      <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={6}
                        aria-label="PIN de verificação em duas etapas"
                        className="mt-1 block rounded-md border border-zinc-300 px-3 py-2 text-sm w-32 font-mono" />
                    </label>
                    <button type="button" onClick={() => setShowPin((v) => !v)} className="text-xs text-zinc-500 underline">
                      {showPin ? 'ocultar' : 'para que serve?'}
                    </button>
                  </div>
                  {showPin && (
                    <p className="text-xs text-zinc-500">
                      O PIN é o mesmo de duas etapas configurado no WhatsApp Manager. Ele só é usado para registrar o número na
                      Cloud API, vai direto do nosso servidor para a Meta e não fica guardado aqui.
                    </p>
                  )}
                </div>
              )}

              {guide?.plan.nextAction.kind === 'register_number' && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2">
                <p className="text-sm font-semibold text-amber-900">{guide.plan.nextAction.label}</p>
                <p className="text-xs text-amber-900/80">{guide.plan.nextAction.detail}</p>
                <div className="flex items-end gap-2">
                  <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" maxLength={6}
                    aria-label="PIN de verificação em duas etapas" placeholder="PIN de 6 dígitos"
                    className="rounded-md border border-zinc-300 px-3 py-2 text-sm w-40 font-mono" />
                  <Button variant="primary" onClick={registerNumber} disabled={busy || pin.trim().length !== 6}>
                    {busy ? 'Registrando…' : 'Registrar número'}
                  </Button>
                </div>
                <p className="text-[11px] text-amber-900/80">
                  O PIN vai direto do nosso servidor para a Meta e não fica guardado aqui.
                </p>
              </div>
            )}

            {guide?.plan.nextAction.kind === 'fix_platform' && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-sm font-semibold text-amber-900">{guide.plan.nextAction.label}</p>
                  <p className="text-xs text-amber-900/80 mt-1">{guide.plan.nextAction.detail}</p>
                  <p className="text-xs text-amber-900/80 mt-1">
                    Enquanto isso, o link de teste abaixo conversa com o número atual — só para não travar o atendimento.
                  </p>
                </div>
              )}

              {/* Caminho assistido: só quando o servidor JÁ tem credenciais globais e usuário tem permissão técnica. */}
              {data.canViewDiagnostics && data.server?.configured && (status === 'error' || guide?.plan.nextAction.kind === 'test_connection') && (
                <div className="border border-zinc-200 rounded-md p-3">
                  <p className="text-xs font-semibold text-zinc-600">Caminho assistido (suporte Master)</p>
                  <div className="flex items-center gap-2 mt-2">
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 99999-9999"
                      aria-label="Número de WhatsApp" className="rounded-md border border-zinc-300 px-3 py-2 text-sm w-56" />
                    <Button variant="secondary" onClick={connectAssistant} disabled={busy}>
                      {busy ? 'Validando…' : 'Validar número'}
                    </Button>
                  </div>
                </div>
              )}

              {data.linkFallback && (
                <div className="text-center">
                  <a href={data.linkFallback} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 underline">
                    Abrir conversa no WhatsApp (teste) <Icon n="external" size={12} />
                  </a>
                  <p className="text-[11px] text-zinc-500 mt-1 max-w-md mx-auto">{WA_ME_TEST_DISCLAIMER}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {data.canViewDiagnostics && data.server && (
          <details className="border-t border-zinc-200 text-left bg-zinc-50 p-3">
            <summary className="text-xs font-semibold cursor-pointer">Diagnóstico técnico (Master / Administrador)</summary>
            <ul className="text-xs font-mono mt-2 space-y-1">
              {data.server.envVars.map((v) => (
                <li key={v} className={data.server?.missingEnv.includes(v) ? 'text-amber-700' : 'text-emerald-700'}>
                  {data.server?.missingEnv.includes(v) ? '• ' : '✓ '}{v}
                </li>
              ))}
            </ul>
            <p className="text-xs text-zinc-500 mt-2">Webhook URL da Meta: <span className="font-mono text-zinc-800">/api/whatsapp/webhook</span></p>
            <p className="text-xs text-zinc-500 mt-1">
              Graph API: <span className="font-mono text-zinc-800">{guide?.plan.version.current || '—'}</span>
              {guide?.plan.version.level === 'ok' ? ' ✓' : ` — ${guide?.plan.version.message || ''}`}
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              Conectado por: <span className="font-mono text-zinc-800">
                {(data.integration as any).source === 'embedded_signup'
                  ? 'popup oficial (a própria unidade autorizou)'
                  : (data.integration as any).source === 'master' ? 'suporte Master' : 'não registrado'}
              </span>
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
