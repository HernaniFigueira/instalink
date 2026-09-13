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
  // Grupos: NEGÓCIO · PÁGINA · AGENDA · CRM · CANAIS (agente/WhatsApp/equipe)
  const [tab, setTab] = useState<'negocio' | 'pagina' | 'agenda' | 'crm' | 'canais'>('negocio');
  const [activeModules, setActiveModules] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/pages?businessId=${businessId}`).then((r) => r.json()).then((d) => setBiz(d.business));
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  // Contagem de módulos ativos (o "ligar/desligar" vive em /recursos, com
  // salvamento imediato; aqui só mostramos o atalho e o estado).
  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/businesses/${businessId}/features`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setActiveModules((d?.features || []).filter((f: any) => f.enabled).length))
      .catch(() => {});
  }, [businessId]);

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
          deliveryFee: biz.deliveryFee, minOrder: biz.minOrder,
          nav: biz.nav, navCustom: biz.navCustom, about: biz.about,
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
  function setAbout(k: 'title' | 'text' | 'image' | 'enabled', v: any) {
    set('about', { ...about, [k]: v });
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-4">Organizado por área: negócio, página, agenda, CRM e canais.</p>
      {msg && <p className="mb-4 text-sm font-medium bg-zinc-900 text-white rounded-xl px-4 py-3">{msg}</p>}

      <div className="flex flex-wrap gap-1 p-1 bg-zinc-100 rounded-xl mb-5 w-fit" role="tablist">
        {([['negocio', 'Negócio'], ['pagina', 'Página'], ['agenda', 'Agenda'], ['crm', 'CRM'], ['canais', 'Canais']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn('text-xs font-bold px-4 py-2 rounded-lg', tab === id ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500')}>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <section className={cn('bg-white border border-zinc-200 rounded-2xl p-5 space-y-3.5', tab !== 'negocio' && 'hidden')}>
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
          <div className="grid sm:grid-cols-2 gap-5">
            <ImageUpload label="LOGO" value={biz.logo} onChange={(url) => set('logo', url)} businessId={businessId} circle />
            <ImageUpload label="CAPA / BANNER" value={biz.cover} onChange={(url) => set('cover', url)} businessId={businessId} />
          </div>
        </section>

        <section className={cn('bg-white border border-zinc-200 rounded-2xl p-5 space-y-3.5', tab !== 'negocio' && 'hidden')}>
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

        <section className={cn('bg-white border border-zinc-200 rounded-2xl p-5 space-y-3.5', tab !== 'negocio' && 'hidden')}>
          <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="pin" size={16} className="text-zinc-400" /> Endereço</h3>
          <label className="block"><span className="text-xs font-bold text-zinc-500">ENDEREÇO</span>
            <input value={biz.address} onChange={(e) => set('address', e.target.value)} className={input + ' mt-1'} placeholder="Rua, número, bairro, cidade" /></label>
          <label className="block"><span className="text-xs font-bold text-zinc-500">LINK DO MAPA</span>
            <input value={biz.mapsUrl} onChange={(e) => set('mapsUrl', e.target.value)} className={input + ' mt-1'} placeholder="Cole o link do Google Maps" />
              <span className="text-[11px] text-zinc-500">Com o link salvo, a página mostra o mapa. Sem link, o bloco nem aparece.</span></label>
        </section>

        <section className={cn('bg-white border border-zinc-200 rounded-2xl p-5', tab !== 'pagina' && 'hidden')}>
          <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="menu" size={16} className="text-zinc-400" /> Navegação da página</h3>
          <p className="text-xs text-zinc-500 mt-1 mb-3">Escolha os itens que aparecem no menu da sua página (botão “Menu” na barra inferior).</p>
          <div className="flex flex-wrap gap-2">
            {NAV_ORDER.map((n) => {
              const on = (biz.nav || []).includes(n.id);
              return (
                <button key={n.id} onClick={() => toggleNav(n.id)}
                  className={cn('text-sm font-bold px-4 py-2.5 rounded-xl border-2', on ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                  {on && <Icon n="check" size={14} className="inline -mt-0.5" />} {n.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className={cn('bg-white border border-zinc-200 rounded-2xl p-5 space-y-3.5', tab !== 'pagina' && 'hidden')}>
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="store" size={16} className="text-zinc-400" /> Sobre a empresa</h3>
            <button onClick={() => setAbout('enabled', !about.enabled)}
              className={cn('text-xs font-bold px-3 py-1.5 rounded-full border-2', about.enabled ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
              {about.enabled ? 'Visível' : 'Oculto'}
            </button>
          </div>
          <p className="text-xs text-zinc-500 -mt-2">Aparece na página como uma seção “Sobre nós”. Se estiver vazio ou oculto, não é exibido.</p>
          <label className="block"><span className="text-xs font-bold text-zinc-500">TÍTULO</span>
            <input value={about.title} onChange={(e) => setAbout('title', e.target.value)} className={input + ' mt-1'} placeholder="Ex: Sobre nós" /></label>
          <label className="block"><span className="text-xs font-bold text-zinc-500">TEXTO</span>
            <textarea value={about.text} onChange={(e) => setAbout('text', e.target.value)} className={input + ' mt-1'} rows={3}
              placeholder="Ex: Somos uma clínica especializada em…" /></label>
          <ImageUpload label="IMAGEM (OPCIONAL)" value={about.image} onChange={(url) => setAbout('image', url)} businessId={businessId} />
        </section>

        <section className={cn('bg-white border border-zinc-200 rounded-2xl p-5 space-y-3.5', tab !== 'negocio' && 'hidden')}>
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
          <div className="grid sm:grid-cols-2 gap-3.5">
            <label className="block"><span className="text-xs font-bold text-zinc-500">TAXA DE ENTREGA (R$)</span>
              <input value={centsToBR(biz.deliveryFee || 0)} onChange={(e) => set('deliveryFee', parseMoneyToCents(e.target.value))} className={input + ' mt-1'} placeholder="0,00" inputMode="decimal" />
              <span className="text-[11px] text-zinc-500">0 = a combinar no WhatsApp.</span></label>
            <label className="block"><span className="text-xs font-bold text-zinc-500">PEDIDO MÍNIMO (R$)</span>
              <input value={centsToBR(biz.minOrder || 0)} onChange={(e) => set('minOrder', parseMoneyToCents(e.target.value))} className={input + ' mt-1'} placeholder="0,00" inputMode="decimal" />
              <span className="text-[11px] text-zinc-500">0 = sem mínimo.</span></label>
          </div>
        </section>

        {tab === 'agenda' && (
          <section className="bg-white border border-zinc-200 rounded-2xl p-5">
            <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="calendar" size={16} className="text-zinc-400" /> Agenda e disponibilidade</h3>
            <p className="text-xs text-zinc-500 mt-1">
              Horários de funcionamento, profissionais vinculados aos serviços, duração, intervalos, exceções,
              horizonte de agendamento, antecedência mínima e taxa de cancelamento ficam em <strong>Serviços &amp; Agenda</strong>.
            </p>
            <Link href={`/servicos?b=${businessId}`} className="inline-block mt-3 text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl">Abrir serviços e agenda</Link>
          </section>
        )}

        {tab === 'crm' && (
          <section className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-3">
            <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="users" size={16} className="text-zinc-400" /> CRM e consentimento</h3>
            <p className="text-xs text-zinc-500">
              A base de contatos cresce sozinha com cadastro, agendamento, pedido e conversa. Cada pessoa tem histórico 360,
              observações da equipe e o interruptor <strong>“autoriza receber promoções”</strong>.
            </p>
            <ul className="text-xs text-zinc-600 space-y-1.5">
              <li>• <strong>Nunca presumimos consentimento:</strong> sem o interruptor ligado, o contato não entra em campanha.</li>
              <li>• Desligar o consentimento não apaga o histórico — só impede envio de marketing.</li>
              <li>• Agendamentos criados pelo painel vinculam o cliente existente em vez de duplicar cadastro.</li>
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link href={`/clientes?b=${businessId}`} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl">Abrir clientes</Link>
              <Link href={`/campanhas?b=${businessId}`} className="text-sm font-bold bg-zinc-100 px-4 py-2.5 rounded-xl">Campanhas</Link>
            </div>
          </section>
        )}

        {tab === 'canais' && (
          <section className="bg-white border border-zinc-200 rounded-2xl p-5 space-y-3">
            <h3 className="font-bold text-sm flex items-center gap-2"><Icon n="toggle" size={16} className="text-zinc-400" /> Recursos, agente, WhatsApp e equipe</h3>
            <p className="text-xs text-zinc-500">
              O que existe no negócio é definido pelos <strong>módulos da empresa</strong> ({activeModules ?? '—'} ativos agora).
              Ligar/desligar salva na hora e reflete na página pública.
            </p>
            <div className="grid sm:grid-cols-2 gap-2 pt-1">
              <Link href={`/recursos?b=${businessId}`} className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl text-center">Recursos da empresa</Link>
              <Link href={`/agente?b=${businessId}`} className="text-sm font-bold bg-zinc-100 px-4 py-2.5 rounded-xl text-center">Agente de atendimento</Link>
              <Link href={`/whatsapp?b=${businessId}`} className="text-sm font-bold bg-zinc-100 px-4 py-2.5 rounded-xl text-center">WhatsApp</Link>
              <Link href={`/equipe?b=${businessId}`} className="text-sm font-bold bg-zinc-100 px-4 py-2.5 rounded-xl text-center">Equipe e permissões</Link>
            </div>
          </section>
        )}

        {tab === 'negocio' && (
          <button onClick={save} disabled={saving} className="text-sm font-bold bg-zinc-900 text-white px-6 py-3 rounded-xl disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar tudo'}
          </button>
        )}
      </div>
    </>
  );
}
