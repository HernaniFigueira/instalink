'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MODES } from '@/lib/templates';
import { cn } from '@/lib/utils';
import type { Business, BusinessMode } from '@/lib/types';
import { PageSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';

const PAYMENTS = [
  { id: 'pix', label: 'PIX' },
  { id: 'card', label: 'Cartão' },
  { id: 'cash', label: 'Dinheiro' },
  { id: 'on_delivery', label: 'Na entrega' },
];

export default function ConfigPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [biz, setBiz] = useState<Business | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/pages?businessId=${businessId}`).then((r) => r.json()).then((d) => setBiz(d.business));
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!biz) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch(`/api/businesses/${businessId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: biz.name, description: biz.description, logo: biz.logo, cover: biz.cover,
          modes: biz.modes, phone: biz.phone, whatsapp: biz.whatsapp, email: biz.email,
          instagram: biz.instagram, tiktok: biz.tiktok, address: biz.address,
          mapsUrl: biz.mapsUrl, paymentMethods: biz.paymentMethods, pixKey: biz.pixKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('Configurações salvas.');
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 3000);
    }
  }

  if (!biz) return <PageSkeleton />;
  const set = (k: keyof Business, v: any) => setBiz({ ...biz, [k]: v });
  const input = 'w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

  function toggleMode(m: BusinessMode) {
    const has = biz!.modes.includes(m);
    set('modes', has ? biz!.modes.filter((x) => x !== m) : [...biz!.modes, m]);
  }
  function togglePay(id: string) {
    const has = (biz!.paymentMethods || []).includes(id);
    set('paymentMethods', has ? biz!.paymentMethods.filter((x) => x !== id) : [...(biz!.paymentMethods || []), id]);
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Dados do negócio, contato e formas de vender.</p>
      {msg && <p className="mb-4 text-sm font-medium bg-zinc-900 text-white rounded-xl px-4 py-3">{msg}</p>}

      <div className="space-y-4">
        <section className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-3.5">
          <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="store" size={16} className="text-zinc-400" /> Perfil</h3>
          <div className="grid sm:grid-cols-2 gap-3.5">
            <label className="block"><span className="text-xs font-bold text-zinc-500">NOME *</span>
              <input value={biz.name} onChange={(e) => set('name', e.target.value)} className={input + ' mt-1'} /></label>
            <label className="block"><span className="text-xs font-bold text-zinc-500">E-MAIL</span>
              <input value={biz.email} onChange={(e) => set('email', e.target.value)} className={input + ' mt-1'} /></label>
          </div>
          <label className="block"><span className="text-xs font-bold text-zinc-500">DESCRIÇÃO</span>
            <textarea value={biz.description} onChange={(e) => set('description', e.target.value)} className={input + ' mt-1'} rows={2}
              placeholder="Ex: Os melhores hambúrgueres artesanais da região." /></label>
          <div className="grid sm:grid-cols-2 gap-3.5">
            <label className="block"><span className="text-xs font-bold text-zinc-500">LOGO (URL)</span>
              <input value={biz.logo} onChange={(e) => set('logo', e.target.value)} className={input + ' mt-1'} placeholder="https://…" /></label>
            <label className="block"><span className="text-xs font-bold text-zinc-500">CAPA (URL)</span>
              <input value={biz.cover} onChange={(e) => set('cover', e.target.value)} className={input + ' mt-1'} placeholder="https://…" /></label>
          </div>
        </section>

        <section className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-3.5">
          <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="chat" size={16} className="text-zinc-400" /> Contato e redes</h3>
          <div className="grid sm:grid-cols-2 gap-3.5">
            <label className="block"><span className="text-xs font-bold text-zinc-500">WHATSAPP *</span>
              <input value={biz.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} className={input + ' mt-1'} placeholder="(11) 99999-9999" /></label>
            <label className="block"><span className="text-xs font-bold text-zinc-500">TELEFONE</span>
              <input value={biz.phone} onChange={(e) => set('phone', e.target.value)} className={input + ' mt-1'} /></label>
            <label className="block"><span className="text-xs font-bold text-zinc-500">INSTAGRAM</span>
              <input value={biz.instagram} onChange={(e) => set('instagram', e.target.value)} className={input + ' mt-1'} placeholder="@seuperfil" /></label>
            <label className="block"><span className="text-xs font-bold text-zinc-500">TIKTOK</span>
              <input value={biz.tiktok} onChange={(e) => set('tiktok', e.target.value)} className={input + ' mt-1'} placeholder="@seuperfil" /></label>
          </div>
        </section>

        <section className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-3.5">
          <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="pin" size={16} className="text-zinc-400" /> Endereço</h3>
          <label className="block"><span className="text-xs font-bold text-zinc-500">ENDEREÇO</span>
            <input value={biz.address} onChange={(e) => set('address', e.target.value)} className={input + ' mt-1'} placeholder="Rua, número, bairro, cidade" /></label>
          <label className="block"><span className="text-xs font-bold text-zinc-500">LINK DO MAPA</span>
            <input value={biz.mapsUrl} onChange={(e) => set('mapsUrl', e.target.value)} className={input + ' mt-1'} placeholder="Cole o link do Google Maps" />
              <span className="text-[11px] text-zinc-500">Com o link salvo, a página mostra o mapa. Sem link, o bloco nem aparece.</span></label>
        </section>

        <section className="bg-white border border-zinc-200 rounded-2xl p-5">
          <h3 className="font-bold text-sm mb-1 flex items-center gap-2"><Icon n="bag" size={16} className="text-zinc-400" /> Como você vende</h3>
          <p className="text-xs text-zinc-500 mb-3">Ativar um módulo mostra o menu correspondente no painel.</p>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => toggleMode(m.id)}
                className={cn('text-sm font-bold px-4 py-2.5 rounded-xl border-2', biz.modes.includes(m.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                {biz.modes.includes(m.id) && <Icon n="check" size={14} className="inline -mt-0.5" />} {m.label}
              </button>
            ))}
          </div>
        </section>

        <section className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-3.5">
          <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="card" size={16} className="text-zinc-400" /> Pagamento</h3>
          <div className="flex flex-wrap gap-2">
            {PAYMENTS.map((p) => (
              <button key={p.id} onClick={() => togglePay(p.id)}
                className={cn('text-sm font-bold px-4 py-2.5 rounded-xl border-2', (biz.paymentMethods || []).includes(p.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                {(biz.paymentMethods || []).includes(p.id) && <Icon n="check" size={14} className="inline -mt-0.5" />} {p.label}
              </button>
            ))}
          </div>
          <label className="block"><span className="text-xs font-bold text-zinc-500">CHAVE PIX</span>
            <input value={biz.pixKey} onChange={(e) => set('pixKey', e.target.value)} className={input + ' mt-1'} placeholder="CPF, e-mail, telefone ou aleatória" /></label>
        </section>

        <button onClick={save} disabled={saving} className="text-sm font-bold bg-zinc-900 text-white px-6 py-3 rounded-xl disabled:opacity-50">
          {saving ? 'Salvando…' : 'Salvar tudo'}
        </button>
      </div>
    </>
  );
}
