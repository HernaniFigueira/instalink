'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NICHES, MODES } from '@/lib/templates';
import { slugify } from '@/lib/utils';
import type { BusinessMode, Niche } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/icons';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [niche, setNiche] = useState<Niche | ''>('');
  const [modes, setModes] = useState<BusinessMode[]>([]);
  const [whatsapp, setWhatsapp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [restored, setRestored] = useState(false);

  // Rascunho automático: se o servidor cair ou a página recarregar no meio
  // do preenchimento, tudo volta como estava. Limpo ao concluir.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('il-ob-draft');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.name === 'string') setName(d.name);
      if (typeof d.niche === 'string') setNiche(d.niche as Niche);
      if (Array.isArray(d.modes)) setModes(d.modes as BusinessMode[]);
      if (typeof d.whatsapp === 'string') setWhatsapp(d.whatsapp);
      if (d.step === 2 || d.step === 3) setStep(d.step);
      setRestored(true);
    } catch {
      /* sem rascunho: começa do zero */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('il-ob-draft', JSON.stringify({ step, name, niche, modes, whatsapp }));
    } catch {
      /* storage bloqueado: segue sem rascunho */
    }
  }, [step, name, niche, modes, whatsapp]);

  // Guard: sem sessão válida, volta ao login ANTES de preencher tudo
  // (em vez de falhar só no passo 3). Quem já tem negócio vai ao painel.
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

  function toggleMode(m: BusinessMode) {
    setModes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  async function finish() {
    setError('');
    if (!name.trim()) { setError('Dê um nome ao seu negócio para continuar.'); return; }
    if (!niche) { setError('Escolha o tipo do seu negócio.'); return; }
    if (modes.length === 0) { setError('Escolha ao menos uma forma de vender.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, niche, modes, whatsapp, slug: slugify(name) }),
      });
      if (res.status === 401) { router.replace('/login?session=expired'); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      try { localStorage.removeItem('il-ob-draft'); } catch { /* noop */ }
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
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-xl bg-zinc-900 flex items-center justify-center font-black text-white">IL</div>
          <span className="font-bold text-lg">InstaLink<span className="text-emerald-600">.app</span></span>
        </div>
        <div className="flex gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div key={s} className={cn('h-2 flex-1 rounded-full', s <= step ? 'bg-emerald-500' : 'bg-zinc-200')} />
          ))}
        </div>
        <div className="bg-white border border-zinc-200 rounded-3xl p-8 shadow-sm">
          {step === 1 && (
            <>
              <h1 className="text-2xl font-bold tracking-tight">Qual é o seu negócio?</h1>
              <p className="text-sm text-zinc-500 mt-1">Vamos montar a estrutura ideal para você.</p>
              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5" htmlFor="biz">Nome do negócio *</label>
                  <input id="biz" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Barbearia do João"
                    className="w-full rounded-xl border border-zinc-300 px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  {name.trim() && <p className="text-xs text-zinc-500 mt-1">Seu link será: <strong>instalink.app/{slugify(name)}</strong></p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1.5" htmlFor="wa">WhatsApp do negócio</label>
                  <input id="wa" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="(11) 99999-9999"
                    className="w-full rounded-xl border border-zinc-300 px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
              <button onClick={() => name.trim() ? setStep(2) : setError('Dê um nome ao seu negócio para continuar.')}
                className="mt-6 w-full font-bold bg-zinc-900 text-white py-3.5 rounded-xl hover:bg-zinc-700">Continuar</button>
            </>
          )}
          {step === 2 && (
            <>
              <h1 className="text-2xl font-bold tracking-tight">Qual é o tipo do seu negócio?</h1>
              <p className="text-sm text-zinc-500 mt-1">Isso define o ponto de partida — você pode mudar depois.</p>
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {NICHES.map((n) => (
                  <button key={n.id} onClick={() => setNiche(n.id)}
                    className={cn('text-left rounded-2xl border-2 p-4 transition-all', niche === n.id ? 'border-emerald-500 bg-emerald-50' : 'border-zinc-200 hover:border-zinc-300')}>
                    <p className="font-bold text-sm">{n.label}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{n.hint}</p>
                  </button>
                ))}
              </div>
              <div className="mt-6 flex gap-3">
                <button onClick={() => setStep(1)} className="font-semibold bg-zinc-100 px-6 py-3.5 rounded-xl hover:bg-zinc-200">Voltar</button>
                <button onClick={() => niche ? setStep(3) : setError('Escolha o tipo do seu negócio.')}
                  className="flex-1 font-bold bg-zinc-900 text-white py-3.5 rounded-xl hover:bg-zinc-700">Continuar</button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h1 className="text-2xl font-bold tracking-tight">Como você vende?</h1>
              <p className="text-sm text-zinc-500 mt-1">Pode escolher mais de um. Sugerimos os módulos ideais.</p>
              <div className="mt-6 space-y-3">
                {MODES.map((m) => (
                  <button key={m.id} onClick={() => toggleMode(m.id)}
                    className={cn('w-full text-left rounded-2xl border-2 p-4 flex items-center gap-3 transition-all',
                      modes.includes(m.id) ? 'border-emerald-500 bg-emerald-50' : 'border-zinc-200 hover:border-zinc-300')}>
                    <div className={cn('w-6 h-6 rounded-lg border-2 flex items-center justify-center text-sm',
                      modes.includes(m.id) ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-zinc-300')}>
                      {modes.includes(m.id) && <Icon n="check" size={14} />}
                    </div>
                    <div>
                      <p className="font-bold text-sm">{m.label}</p>
                      <p className="text-xs text-zinc-500">{m.hint}</p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-6 flex gap-3">
                <button onClick={() => setStep(2)} className="font-semibold bg-zinc-100 px-6 py-3.5 rounded-xl hover:bg-zinc-200">Voltar</button>
                <button onClick={finish} disabled={loading}
                  className="flex-1 font-bold bg-emerald-600 text-white py-3.5 rounded-xl hover:bg-emerald-500 disabled:opacity-50">
                  {loading ? 'Montando sua estrutura…' : 'Criar minha estrutura'}
                </button>
              </div>
            </>
          )}
          {error && <p className="mt-4 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}
          {restored && !error && (
            <p className="mt-4 text-xs text-zinc-500">Rascunho restaurado — continue de onde parou.</p>
          )}
        </div>
      </div>
    </main>
  );
}
