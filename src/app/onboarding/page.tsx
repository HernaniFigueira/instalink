'use client';
// ═══════════════════════════════════════════════════════════════
// CRIAR NEGÓCIO — uma tela só. O antigo onboarding de 3 passos
// (nicho → forma de vender → produtos/serviços) foi REMOVIDO:
// o InstaLink é uma plataforma de atendimento com agenda, então o
// negócio novo já nasce configurado para isso (Serviços + Agenda
// ativos; vitrine de produtos desligada; nada de pedidos).
// O usuário pode ajustar tudo depois em Recursos/Configurações.
// ═══════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { slugify } from '@/lib/utils';
import { Icon } from '@/components/icons';

const WHATSAPP_DRAFT_KEY = 'il-biz-draft';

export default function CreateBusinessPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // Guarda de sessão: sem login volta para /login; quem já tem negócio
  // (mais de um ou já criado) vai direto para o destino certo — nada de
  // wizard bloqueando quem só quer trabalhar.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.user) { router.replace('/login?session=expired'); return; }
        if (d.businesses?.length > 0) { router.replace(`/dashboard?b=${d.businesses[0].id}`); return; }
        setChecking(false);
      })
      .catch(() => router.replace('/login?session=expired'));
  }, [router]);

  // Rascunho de segurança: recarregar a página não faz o usuário perder o
  // que digitou (não é onboarding multi-tela — só conveniência).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WHATSAPP_DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.name === 'string') setName(d.name);
      if (typeof d.whatsapp === 'string') setWhatsapp(d.whatsapp);
    } catch { /* sem rascunho */ }
  }, []);
  useEffect(() => {
    try {
      if (name || whatsapp) localStorage.setItem(WHATSAPP_DRAFT_KEY, JSON.stringify({ name, whatsapp }));
      else localStorage.removeItem(WHATSAPP_DRAFT_KEY);
    } catch { /* storage bloqueado: segue sem rascunho */ }
  }, [name, whatsapp]);

  async function finish(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Dê um nome ao seu negócio para continuar.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // SEM niche/modes: a API aplica o padrão de atendimento
        // (lib/templates.ts → NEW_BUSINESS_DEFAULTS).
        body: JSON.stringify({ name, whatsapp, slug: slugify(name) }),
      });
      if (res.status === 401) { router.replace('/login?session=expired'); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      try { localStorage.removeItem(WHATSAPP_DRAFT_KEY); } catch { /* noop */ }
      router.push(`/dashboard?b=${data.businessId}&welcome=1`);
      router.refresh();
    } catch (err: any) {
      if (err instanceof TypeError) {
        setError('Sem conexão com o servidor. Seus dados estão salvos aqui — aguarde um instante e tente de novo.');
      } else {
        setError(err.message || 'Não conseguimos criar. Tente de novo.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
        <p className="text-sm text-zinc-500">Verificando sua conta…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-xl bg-zinc-900 flex items-center justify-center font-black text-white">IL</div>
          <span className="font-bold text-lg">InstaLink<span className="text-emerald-600">.app</span></span>
        </div>

        <form onSubmit={finish} className="bg-white border border-zinc-200 rounded-lg p-6 shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight">Crie o seu negócio</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Uma pergunta só: como ele se chama? Sua página, agenda, catálogo de serviços e
            clientes já nascem prontos para atendimento.
          </p>

          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5" htmlFor="biz">Nome do negócio *</label>
              <input id="biz" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Studio Bela Vida, Clínica Odonto Sorriso, Estúdio Pilates Fluxo"
                className="w-full rounded-md border border-zinc-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              {name.trim() && (
                <p className="text-xs text-zinc-500 mt-1.5">
                  Seu link: <strong>instalink.app/{slugify(name) || '…'}</strong>
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1.5" htmlFor="wa">WhatsApp do negócio <span className="font-normal text-zinc-400">(opcional)</span></label>
              <input id="wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel"
                className="w-full rounded-md border border-zinc-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>

          <div className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 px-3.5 py-3">
            <p className="text-xs font-semibold text-zinc-700 mb-1.5">Você começa com:</p>
            <ul className="space-y-1 text-xs text-zinc-600">
              <li className="flex items-center gap-1.5"><Icon n="check" size={12} className="text-emerald-600" /> Agenda de atendimentos ativa</li>
              <li className="flex items-center gap-1.5"><Icon n="check" size={12} className="text-emerald-600" /> Catálogo de serviços com agendamento</li>
              <li className="flex items-center gap-1.5"><Icon n="check" size={12} className="text-emerald-600" /> Página pública pronta para publicar</li>
              <li className="flex items-center gap-1.5 text-zinc-400"><Icon n="x" size={12} /> Vitrine de produtos (opcional — ative em Recursos)</li>
            </ul>
          </div>

          {error && <p className="mt-4 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">{error}</p>}

          <button type="submit" disabled={loading || !name.trim()}
            className="mt-5 w-full font-bold bg-zinc-900 text-white py-3 rounded-md hover:bg-zinc-700 disabled:opacity-50">
            {loading ? 'Criando seu negócio…' : 'Criar e ir para o painel'}
          </button>
          <p className="text-[11px] text-zinc-400 mt-3 text-center">Nada para configurar agora — o painel traz um checklist curto para os primeiros passos.</p>
        </form>
      </div>
    </main>
  );
}
