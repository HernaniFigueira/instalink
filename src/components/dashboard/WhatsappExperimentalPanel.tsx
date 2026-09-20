'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import { humanDateTime } from '@/lib/tz';

interface Connection {
  configured: boolean; selected: boolean; status: string; displayPhone: string;
  connectedAt: string; lastWebhookAt: string; lastInboundAt: string; lastOutboundAt: string;
  lastError: string; qr?: string | null;
}
const endpoint = '/api/whatsapp/providers/evolution';
const labels: Record<string, string> = { not_configured: 'Não configurado', not_connected: 'Não conectado',
  qr_pending: 'Aguardando leitura do QR', connecting: 'Conectando', connected: 'Conectado', disconnected: 'Desconectado', error: 'Erro na conexão' };

export function WhatsappExperimentalPanel({ businessId, onChange }: { businessId: string; onChange: (selected: boolean, status: string) => void }) {
  const [data, setData] = useState<Connection | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState('');
  const [polling, setPolling] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const apply = useCallback((next: Connection) => { setData(next); onChange(next.selected, next.status); }, [onChange]);

  useEffect(() => {
    let alive = true;
    apiGet<Connection>(`${endpoint}?businessId=${encodeURIComponent(businessId)}`).then(async (r) => {
      if (!alive) return;
      if (!r.ok || !r.data) { setError(r.message); return; }
      apply(r.data);
      if (r.data.selected && r.data.configured) {
        const fresh = await apiSend<Connection>(endpoint, 'POST', { businessId, action: 'status' });
        if (alive && fresh.ok && fresh.data) apply(fresh.data);
      }
    });
    return () => { alive = false; generation.current++; };
  }, [businessId, apply]);
  useEffect(() => {
    if (open) dialog.current?.showModal(); else dialog.current?.close();
  }, [open]);

  const close = () => { generation.current++; setPolling(false); setQr(''); setOpen(false); };
  async function action(kind: string) {
    if ((kind === 'disconnect' || kind === 'remove') && !confirm(kind === 'remove'
      ? 'Remover a instância experimental? Contatos, conversas e agendamentos serão preservados.'
      : 'Desconectar este WhatsApp? Todo o histórico comercial será preservado.')) return;
    const ticket = ++generation.current;
    setBusy(true); setError(''); setPolling(false);
    if (kind === 'connect' || kind === 'qr') { setQr(''); setOpen(true); }
    try {
      const r = await apiSend<Connection>(endpoint, 'POST', { businessId, action: kind });
      if (ticket !== generation.current) return;
      if (!r.ok || !r.data) { setError(r.message); return; }
      apply(r.data);
      if (r.data.status === 'connected') { setQr(''); setOpen(false); }
      else if (kind === 'connect' || kind === 'qr') {
        setQr(r.data.qr || ''); setPolling(true);
      }
    } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!open || !polling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const poll = async () => {
      if (stopped) return;
      if (Date.now() - started > 120_000) { setPolling(false); setQr(''); setError('O QR expirou. Gere um novo QR para continuar.'); return; }
      const r = await apiSend<Connection>(endpoint, 'POST', { businessId, action: 'status' });
      if (stopped) return;
      if (!r.ok || !r.data) { setPolling(false); setQr(''); setError(r.message); return; }
      apply(r.data);
      if (r.data.status === 'connected') { setPolling(false); setQr(''); setOpen(false); return; }
      if (['error', 'not_configured', 'disconnected'].includes(r.data.status)) {
        setPolling(false); setQr(''); setError('Conexão interrompida. Gere um novo QR para tentar novamente.'); return;
      }
      timer = setTimeout(poll, 5000); // sequential, never overlapping requests
    };
    timer = setTimeout(poll, 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [open, polling, businessId, apply]);

  return <section className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5 space-y-3">
    <div className="flex flex-wrap gap-2 items-center"><h3 className="font-semibold">Conexão por QR Code</h3><span className="text-xs rounded-full bg-amber-100 text-amber-900 px-2 py-1">Experimental</span></div>
    <p className="text-sm text-zinc-600">Use para testes e demonstrações. Esta conexão utiliza uma tecnologia não oficial e pode sofrer desconexões ou restrições do WhatsApp.</p>
    {data && <p className="text-sm font-medium" aria-live="polite">{labels[data.status] || 'Não conectado'}{data.displayPhone ? ` · +${data.displayPhone}` : ''}</p>}
    {data && !data.configured && <p className="text-sm text-amber-800">Provider experimental ainda não configurado no servidor.</p>}
    {error && !open && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {data?.status === 'connected' ? <>
        <Link href={`/conversas?b=${encodeURIComponent(businessId)}`}><Button variant="primary">Abrir Conversas</Button></Link>
        <Button variant="secondary" disabled={busy} onClick={() => action('disconnect')}>Desconectar</Button>
      </> : <Button variant="secondary" disabled={busy || !data?.configured} onClick={() => action('connect')}>Conectar por QR Code</Button>}
      {data?.selected && <>
        <Button variant="secondary" disabled={busy} onClick={() => action('status')}>Atualizar estado</Button>
        <button className="text-xs underline text-zinc-600" disabled={busy} onClick={() => action('remove')}>Remover conexão experimental</button>
      </>}
    </div>
    {data?.selected && <details className="text-xs text-zinc-500"><summary className="cursor-pointer">Diagnóstico da conexão</summary>
      <dl className="mt-2 space-y-1">
        {[['Conectado em', data.connectedAt], ['Último webhook', data.lastWebhookAt], ['Última recebida', data.lastInboundAt], ['Última enviada', data.lastOutboundAt]].map(([label, value]) => <div key={label}><dt className="inline">{label}: </dt><dd className="inline">{value ? humanDateTime(value.slice(0, 10), value.slice(11, 16)) : '—'}</dd></div>)}
        {data.lastError && <div className="text-rose-700">{data.lastError}</div>}
      </dl>
    </details>}
    <dialog ref={dialog} onCancel={close} onClose={() => { if (open) close(); }} aria-labelledby="whatsapp-qr-title" className="w-[min(94vw,460px)] rounded-xl p-6 backdrop:bg-[var(--overlay)]">
      <div className="flex items-center justify-between gap-3"><h3 id="whatsapp-qr-title" className="font-semibold">Conectar por QR Code</h3><button onClick={close} aria-label="Fechar QR Code" className="p-2">✕</button></div>
      <p className="text-sm text-zinc-600 mt-3">WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho</p>
      {qr ? <img src={qr} alt="QR Code para vincular seu WhatsApp" width={360} height={360} className="w-full max-w-[360px] mx-auto my-3" />
        : <p className="my-8 text-center text-sm text-zinc-500">{busy ? 'Solicitando QR ao provider…' : 'QR ainda indisponível. Aguarde alguns segundos e gere um novo QR.'}</p>}
      <p className="text-xs text-amber-800">Conexão experimental, não oficial. Use um número de demonstração.</p>
      {error && <p role="alert" className="text-sm text-rose-700 my-3">{error}</p>}
      <div className="flex justify-between gap-2 mt-4"><Button variant="secondary" disabled={busy} onClick={() => action('qr')}>Gerar novo QR</Button><Button variant="secondary" onClick={close}>Fechar</Button></div>
      {polling && <p aria-live="polite" className="text-xs text-zinc-500 mt-2">Aguardando leitura. Verificando a cada 5 segundos, por até 2 minutos.</p>}
    </dialog>
  </section>;
}

export function WhatsappAgentControl({ businessId }: { businessId: string }) {
  const [agent, setAgent] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const [moduleOn, setModuleOn] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([apiGet<any>(`/api/whatsapp?businessId=${businessId}`), apiGet<any>(`/api/agent?businessId=${businessId}`)]).then(([wa, a]) => {
      if (!alive) return;
      setConnected(wa.data?.status === 'connected');
      if (a.ok) { setAgent(a.data?.agent); setModuleOn(a.data?.preview?.moduleEnabled === true); }
      else setError(a.message);
    });
    return () => { alive = false; };
  }, [businessId]);
  if (!connected) return null;
  async function toggle() {
    setBusy(true); setError('');
    const r = await apiSend<any>('/api/agent', 'PUT', { businessId, channels: { whatsapp: !agent.channels.whatsapp } });
    if (r.ok) setAgent(r.data.agent); else setError(r.message);
    setBusy(false);
  }
  return <section className="border border-zinc-200 rounded-lg bg-white p-4 space-y-2">
    <h3 className="font-semibold">Atendimento automático</h3>
    <p className="text-sm text-zinc-600">Permitir que o agente responda novas mensagens neste WhatsApp.</p>
    {agent && <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" checked={agent.channels.whatsapp} disabled={busy} onChange={toggle} />Ativar neste WhatsApp</label>}
    {agent && (!moduleOn || !agent.enabled) && <p className="text-sm text-amber-800">O agente está desativado na unidade. Ative também o recurso e o agente em <Link className="underline" href={`/agente?b=${businessId}`}>Agente</Link>.</p>}
    <p className="text-xs text-zinc-500">Conversas em modo Humano permanecem sem automação, mesmo com esta opção ligada.</p>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
  </section>;
}
