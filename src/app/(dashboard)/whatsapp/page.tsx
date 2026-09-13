'use client';
// WHATSAPP — estado REAL da integração + inbox do CRM (estrutura pronta).
// Nada aqui finge conexão: sem credenciais no servidor o produto diz
// exatamente o que falta e mantém o link externo como fallback.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { humanDateTime } from '@/lib/tz';

interface Conversation {
  id: string; name: string; phone: string; status: string; unread: number;
  lastMessageAt: string; lastMessagePreview: string; registered: boolean;
}
interface Message { id: string; direction: 'in' | 'out'; body: string; status: string; at: string }
interface WaData {
  status: 'not_connected' | 'pending' | 'connected';
  label: { state: string; label: string; detail: string };
  integration: { displayPhone: string; connectedAt: string; lastWebhookAt: string; requestedAt: string; phoneNumberId: string };
  server: { configured: boolean; missingEnv: string[]; envVars: readonly string[] };
  inbox: { conversations: number; open: number; unread: number };
  linkFallback: string;
}

export default function WhatsappPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [data, setData] = useState<WaData | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<{ conversation: Conversation; messages: Message[] } | null>(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/whatsapp?businessId=${businessId}`).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
    fetch(`/api/conversations?businessId=${businessId}`).then((r) => (r.ok ? r.json() : null))
      .then((d) => setConversations(d?.conversations || [])).catch(() => {});
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function openConversation(id: string) {
    const res = await fetch(`/api/conversations?businessId=${businessId}&id=${id}`);
    const d = await res.json();
    if (res.ok) setActive({ conversation: d.conversation, messages: d.messages || [] });
  }

  async function connect() {
    setBusy(true); setMsg(''); setError('');
    try {
      const res = await fetch('/api/whatsapp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, action: 'connect', displayPhone: phone }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error + (d.missingEnv?.length ? ` Faltando: ${d.missingEnv.join(', ')}` : ''));
      setMsg(d.message);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <PageSkeleton />;
  const q = `?b=${businessId}`;
  const connected = data.status === 'connected';

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">WhatsApp</h1>
          <p className="text-sm text-zinc-500 mt-1">Conversas dentro do CRM. A integração oficial é opcional — sem ela, o botão abre o WhatsApp normalmente.</p>
        </div>
        <Link href={`/clientes${q}`} className="text-xs font-bold bg-white border border-zinc-200 rounded-xl px-3.5 py-2 hover:bg-zinc-50">
          Ver clientes
        </Link>
      </div>

      {msg && <p className="mb-4 text-sm font-semibold bg-emerald-600 text-white rounded-xl px-4 py-3">{msg}</p>}
      {error && <p className="mb-4 text-sm font-semibold bg-amber-600 text-white rounded-xl px-4 py-3">{error}</p>}

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <section className={cn('rounded-2xl border p-5 lg:col-span-2',
          connected ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-zinc-200')}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Estado da conexão</p>
              <p className="text-xl font-extrabold mt-1 flex items-center gap-2">
                {data.label.label}
                <span className={cn('w-2.5 h-2.5 rounded-full',
                  connected ? 'bg-emerald-500' : data.status === 'pending' ? 'bg-amber-500' : 'bg-zinc-300')} />
              </p>
              <p className="text-sm text-zinc-600 mt-1">{data.label.detail}</p>
            </div>
          </div>

          {data.integration.displayPhone && (
            <p className="text-sm mt-3"><span className="text-zinc-500">Número:</span> <strong>{data.integration.displayPhone}</strong></p>
          )}
          {data.integration.lastWebhookAt && (
            <p className="text-xs text-zinc-500 mt-1">Último evento recebido: {humanDateTime(data.integration.lastWebhookAt.slice(0, 10), data.integration.lastWebhookAt.slice(11, 16))}</p>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-xs font-bold text-zinc-500">NÚMERO DA CONTA OFICIAL</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 99999-9999"
                className="block w-56 rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm mt-1" />
            </label>
            <button onClick={connect} disabled={busy}
              className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl disabled:opacity-50">
              {busy ? 'Registrando…' : connected ? 'Atualizar conta' : 'Conectar WhatsApp'}
            </button>
            {data.linkFallback && (
              <a href={data.linkFallback} target="_blank" rel="noreferrer"
                className="text-sm font-bold bg-white border border-zinc-200 px-4 py-2.5 rounded-xl hover:bg-zinc-50 inline-flex items-center gap-2">
                <Icon n="whatsapp" size={16} /> Abrir WhatsApp (link)
              </a>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-2">
            A conexão só fica <strong>conectada</strong> quando as credenciais oficiais existem no servidor e a conta é
            validada pelo webhook. Nenhum token é guardado no banco nem mostrado na tela.
          </p>
        </section>

        <section className="bg-white border border-zinc-200 rounded-2xl p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Inbox</p>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div><p className="text-2xl font-extrabold">{data.inbox.conversations}</p><p className="text-[11px] text-zinc-500">conversas</p></div>
            <div><p className="text-2xl font-extrabold">{data.inbox.open}</p><p className="text-[11px] text-zinc-500">abertas</p></div>
            <div><p className="text-2xl font-extrabold">{data.inbox.unread}</p><p className="text-[11px] text-zinc-500">não lidas</p></div>
          </div>
          <div className="mt-4 pt-4 border-t border-zinc-100">
            <p className="text-xs font-bold text-zinc-500 mb-1.5">O QUE FALTA NO SERVIDOR</p>
            <ul className="text-xs text-zinc-600 space-y-1">
              {data.server.envVars.map((v) => (
                <li key={v} className={cn('font-mono', data.server.missingEnv.includes(v) ? 'text-amber-700' : 'text-emerald-700')}>
                  {data.server.missingEnv.includes(v) ? '• ' : '✓ '}{v}
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-zinc-500 mt-2">Configure em variáveis de ambiente (Vercel → Settings → Environment Variables) e reinicie. O webhook é <span className="font-mono">/api/whatsapp/webhook</span>.</p>
          </div>
        </section>
      </div>

      {!connected && (
        <p className="mb-4 text-sm bg-white border border-zinc-200 rounded-2xl px-4 py-3 text-zinc-600">
          <strong>WhatsApp ainda não conectado.</strong> As conversas aparecem aqui automaticamente quando a integração
          oficial estiver ativa. Enquanto isso, os atalhos de WhatsApp continuam funcionando no link externo e cada
          conversa também entra no histórico do cliente.
        </p>
      )}

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <section className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
          <p className="px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-zinc-400 border-b border-zinc-100">Conversas</p>
          {conversations.length === 0 ? (
            <p className="text-sm text-zinc-500 px-4 py-8 text-center">Nenhuma conversa ainda.</p>
          ) : (
            <ul>
              {conversations.map((c) => (
                <li key={c.id}>
                  <button onClick={() => openConversation(c.id)}
                    className={cn('w-full text-left px-4 py-3 border-b border-zinc-50 hover:bg-zinc-50', active?.conversation.id === c.id && 'bg-zinc-50')}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm truncate">{c.name}</span>
                      {c.unread > 0 && <span className="text-[10px] font-extrabold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full shrink-0">{c.unread}</span>}
                    </span>
                    <span className="block text-xs text-zinc-500 truncate mt-0.5">{c.lastMessagePreview || c.phone}</span>
                    <span className="block text-[11px] text-zinc-400 mt-0.5">{c.phone}{c.registered ? ' · cliente' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-zinc-200 rounded-2xl flex flex-col min-h-[320px]">
          {active ? (
            <>
              <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold">{active.conversation.name}</p>
                  <p className="text-xs text-zinc-500">{active.conversation.phone}{active.conversation.registered ? ' · cliente existente ✓' : ''}</p>
                </div>
                <Link href={`/clientes${q}`} className="text-xs font-bold text-emerald-700 hover:underline">Ver histórico 360</Link>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5 max-h-[420px]">
                {active.messages.map((m) => (
                  <div key={m.id} className={m.direction === 'out' ? 'flex justify-end' : 'flex justify-start'}>
                    <div className={cn('max-w-[80%] px-3.5 py-2 rounded-2xl text-sm',
                      m.direction === 'out' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-900')}>
                      {m.body}
                      <span className="block text-[10px] opacity-60 mt-1">{m.at.slice(11, 16)} · {m.status}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-zinc-100 flex gap-2">
                <input disabled={!connected} placeholder={connected ? 'Digite uma mensagem…' : 'WhatsApp ainda não conectado.'}
                  className="flex-1 rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm disabled:bg-zinc-50 disabled:text-zinc-400" />
                <button disabled={!connected} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl disabled:opacity-40">Enviar</button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
              <Icon n="inbox" size={30} className="text-zinc-300" />
              <p className="font-bold mt-3">Escolha uma conversa</p>
              <p className="text-sm text-zinc-500 mt-1 max-w-sm">
                Quando a integração oficial estiver conectada, cada mensagem vira histórico do cliente — e o agente de
                atendimento pode responder com os dados do negócio.
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
