'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { cn, parseMoneyToCents, centsToBR } from '@/lib/utils';
import { NAV_ORDER } from '@/lib/nav';
import type { Business } from '@/lib/types';
import { PageSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';

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
  const [tab, setTab] = useState<'negocio' | 'pagina' | 'agenda' | 'crm' | 'canais'>('negocio');
  const [activeModules, setActiveModules] = useState<number | null>(null);

  // 403 → aviso amigável (sessão preservada), nunca skeleton infinito.
  const { denied, report } = useAreaLoad('Configurações');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<{ business: Business }>(`/api/pages?businessId=${businessId}`, { scope: 'area', area: 'Configurações' });
    if (!report(res) || !res.data) return;
    setBiz(res.data.business);
  }, [businessId, report]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!businessId) return;
    apiGet<{ features?: any[] }>(`/api/businesses/${businessId}/features`, { scope: 'area', area: 'Configurações' })
      .then((res) => { if (res.ok) setActiveModules((res.data?.features || []).filter((f: any) => f.enabled).length); });
  }, [businessId]);

  async function save() {
    if (!biz) return;
    setSaving(true); setMsg('');
    try {
      const res = await apiSend(`/api/businesses/${businessId}`, 'PATCH', {
          name: biz.name, description: biz.description, logo: biz.logo, cover: biz.cover,
          modes: biz.modes, phone: biz.phone, whatsapp: biz.whatsapp, email: biz.email,
          instagram: biz.instagram, tiktok: biz.tiktok, address: biz.address,
          mapsUrl: biz.mapsUrl, paymentMethods: biz.paymentMethods, pixKey: biz.pixKey,
          deliveryFee: biz.deliveryFee, minOrder: biz.minOrder,
          nav: biz.nav, navCustom: biz.navCustom, about: biz.about,
      }, { scope: 'action', area: 'Configurações' });
      if (!res.ok) throw new Error(res.message);
      setMsg('Configurações salvas.');
    } catch (err: any) { setMsg(err.message); } finally { setSaving(false); setTimeout(() => setMsg(''), 3000); }
  }

  if (denied) return <AccessDenied area="Configurações" />;
  if (!biz) return <PageSkeleton />;
  const set = (k: keyof Business, v: any) => setBiz({ ...biz, [k]: v });
  const input = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900';
  function togglePay(id: string) {
    const has = (biz!.paymentMethods || []).includes(id);
    set('paymentMethods', has ? biz!.paymentMethods.filter((x) => x !== id) : [...(biz!.paymentMethods || []), id]);
  }
  function toggleNav(id: string) {
    const cur = biz!.nav || [];
    set('nav', cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    set('navCustom', true);
  }
  const about = biz!.about || { title: '', text: '', image: '', enabled: false };
  function setAbout(k: 'title' | 'text' | 'image' | 'enabled', v: any) { set('about', { ...about, [k]: v }); }

  return (
    <>
      <h1 className="text-base font-semibold">Configurações</h1>
      <p className="text-sm text-zinc-500 mt-0.5 mb-4">Organizado por área: negócio, página, agenda, CRM e canais.</p>
      {msg && <p className="mb-3 text-sm font-medium bg-zinc-900 text-white rounded-md px-3 py-2">{msg}</p>}

      <div className="flex flex-wrap gap-1 p-1 bg-zinc-100 rounded-md mb-4 w-fit" role="tablist">
        {([['negocio', 'Negócio'], ['pagina', 'Página'], ['agenda', 'Agenda'], ['crm', 'CRM'], ['canais', 'Canais']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('text-xs font-medium px-3 py-1.5 rounded', tab === id ? 'bg-white shadow-sm border border-zinc-200 text-zinc-900' : 'text-zinc-500')}>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <section className={cn('bg-white border border-zinc-200 p-4 space-y-3', tab !== 'negocio' && 'hidden')}>
          <h3 className="font-semibold text-sm">Perfil</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Nome *</span><input value={biz.name} onChange={(e) => set('name', e.target.value)} className={input + ' mt-1'} /></label>
            <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">E-mail</span><input value={biz.email} onChange={(e) => set('email', e.target.value)} className={input + ' mt-1'} /></label>
          </div>
          <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Descrição</span><textarea value={biz.description} onChange={(e) => set('description', e.target.value)} className={input + ' mt-1'} rows={2} placeholder="Ex: Os melhores hambúrgueres da região." /></label>
          <div className="grid sm:grid-cols-2 gap-4">
            <ImageUpload label="LOGO" value={biz.logo} onChange={(url) => set('logo', url)} businessId={businessId} circle />
            <ImageUpload label="CAPA / BANNER" value={biz.cover} onChange={(url) => set('cover', url)} businessId={businessId} />
          </div>
        </section>

        <section className={cn('bg-white border border-zinc-200 p-4 space-y-3', tab !== 'negocio' && 'hidden')}>
          <h3 className="font-semibold text-sm">Contato e redes</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">WhatsApp *</span><input value={biz.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} className={input + ' mt-1'} placeholder="(11) 99999-9999" /></label>
            <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Telefone</span><input value={biz.phone} onChange={(e) => set('phone', e.target.value)} className={input + ' mt-1'} /></label>
            <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Instagram</span><input value={biz.instagram} onChange={(e) => set('instagram', e.target.value)} className={input + ' mt-1'} placeholder="@seuperfil" /></label>
            <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">TikTok</span><input value={biz.tiktok} onChange={(e) => set('tiktok', e.target.value)} className={input + ' mt-1'} placeholder="@seuperfil" /></label>
          </div>
        </section>

        <section className={cn('bg-white border border-zinc-200 p-4 space-y-3', tab !== 'negocio' && 'hidden')}>
          <h3 className="font-semibold text-sm">Endereço</h3>
          <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Endereço</span><input value={biz.address} onChange={(e) => set('address', e.target.value)} className={input + ' mt-1'} placeholder="Rua, número, bairro, cidade" /></label>
          <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Link do mapa</span><input value={biz.mapsUrl} onChange={(e) => set('mapsUrl', e.target.value)} className={input + ' mt-1'} placeholder="Cole o link do Google Maps" /><span className="text-xs text-zinc-500">Com o link salvo, a página mostra o mapa.</span></label>
        </section>

        <section className={cn('bg-white border border-zinc-200 p-4', tab !== 'pagina' && 'hidden')}>
          <h3 className="font-semibold text-sm">Navegação da página</h3>
          <p className="text-xs text-zinc-500 mt-1 mb-3">Escolha os itens do menu da sua página.</p>
          <div className="flex flex-wrap gap-1.5">
            {NAV_ORDER.map((n) => {
              const on = (biz.nav || []).includes(n.id);
              return (
                <button key={n.id} onClick={() => toggleNav(n.id)} className={cn('text-xs font-medium px-3 py-1.5 rounded-md border', on ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 text-zinc-600')}>
                  {n.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className={cn('bg-white border border-zinc-200 p-4 space-y-3', tab !== 'pagina' && 'hidden')}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Sobre a empresa</h3>
            <button onClick={() => setAbout('enabled', !about.enabled)} className={cn('text-xs font-medium px-3 py-1 rounded-full border', about.enabled ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 text-zinc-500')}>{about.enabled ? 'Visível' : 'Oculto'}</button>
          </div>
          <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Título</span><input value={about.title} onChange={(e) => setAbout('title', e.target.value)} className={input + ' mt-1'} placeholder="Ex: Sobre nós" /></label>
          <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Texto</span><textarea value={about.text} onChange={(e) => setAbout('text', e.target.value)} className={input + ' mt-1'} rows={3} placeholder="Ex: Somos uma clínica especializada em…" /></label>
          <ImageUpload label="IMAGEM (OPCIONAL)" value={about.image} onChange={(url) => setAbout('image', url)} businessId={businessId} />
        </section>

        <section className={cn('bg-white border border-zinc-200 p-4 space-y-3', tab !== 'negocio' && 'hidden')}>
          <h3 className="font-semibold text-sm">Pagamento</h3>
          <div className="flex flex-wrap gap-1.5">
            {PAYMENTS.map((p) => (
              <button key={p.id} onClick={() => togglePay(p.id)} className={cn('text-xs font-medium px-3 py-1.5 rounded-md border', (biz.paymentMethods || []).includes(p.id) ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 text-zinc-600')}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Chave PIX</span><input value={biz.pixKey} onChange={(e) => set('pixKey', e.target.value)} className={input + ' mt-1'} placeholder="CPF, e-mail, telefone ou aleatória" /></label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Taxa de entrega (R$)</span><input value={centsToBR(biz.deliveryFee || 0)} onChange={(e) => set('deliveryFee', parseMoneyToCents(e.target.value))} className={input + ' mt-1'} placeholder="0,00" inputMode="decimal" /></label>
            <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Pedido mínimo (R$)</span><input value={centsToBR(biz.minOrder || 0)} onChange={(e) => set('minOrder', parseMoneyToCents(e.target.value))} className={input + ' mt-1'} placeholder="0,00" inputMode="decimal" /></label>
          </div>
        </section>

        {tab === 'agenda' && (
          <div className="bg-white border border-zinc-200 divide-y divide-zinc-100">
            {[
              { title: 'Agenda', hint: 'Configure horários, profissionais e regras', href: `/servicos?b=${businessId}` },
              { title: 'CRM', hint: 'Clientes, contatos e histórico', href: `/clientes?b=${businessId}` },
              { title: 'Agente', hint: 'Assistente que responde na página', href: `/agente?b=${businessId}` },
              { title: 'WhatsApp', hint: 'Conexão oficial e conversas', href: `/whatsapp?b=${businessId}` },
              { title: 'Equipe', hint: 'Membros, papéis e permissões', href: `/equipe?b=${businessId}` },
            ].map((r) => (
              <Link key={r.title} href={r.href} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50">
                <div>
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-zinc-500">{r.hint}</p>
                </div>
                <span className="text-xs font-medium bg-white border border-zinc-200 px-3 py-1 rounded-md">Abrir</span>
              </Link>
            ))}
          </div>
        )}

        {tab === 'crm' && (
          <section className="bg-white border border-zinc-200 p-4 space-y-2">
            <h3 className="font-semibold text-sm">CRM e consentimento</h3>
            <p className="text-xs text-zinc-500">Base cresce sozinha com cadastro, agendamento, pedido e conversa.</p>
            <ul className="text-xs text-zinc-600 space-y-1 list-disc pl-4">
              <li><strong>Nunca presumimos consentimento.</strong></li>
              <li>Desligar não apaga histórico.</li>
              <li>Agendamentos vinculam cliente existente.</li>
            </ul>
            <div className="flex gap-2 pt-2">
              <Link href={`/clientes?b=${businessId}`} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md">Abrir clientes</Link>
              <Link href={`/campanhas?b=${businessId}`} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md">Campanhas</Link>
            </div>
          </section>
        )}

        {tab === 'canais' && (
          <section className="bg-white border border-zinc-200 p-4 space-y-3">
            <h3 className="font-semibold text-sm">Recursos, agente, WhatsApp e equipe</h3>
            <p className="text-xs text-zinc-500">Módulos da empresa ({activeModules ?? '—'} ativos).</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <Link href={`/recursos?b=${businessId}`} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md text-center">Recursos da empresa</Link>
              <Link href={`/agente?b=${businessId}`} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md text-center">Agente</Link>
              <Link href={`/whatsapp?b=${businessId}`} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md text-center">WhatsApp</Link>
              <Link href={`/equipe?b=${businessId}`} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md text-center">Equipe</Link>
            </div>
          </section>
        )}

        {tab === 'negocio' && (
          <button onClick={save} disabled={saving} className="text-sm font-semibold bg-zinc-900 text-white px-5 py-2.5 rounded-md disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar tudo'}</button>
        )}
      </div>
    </>
  );
}
