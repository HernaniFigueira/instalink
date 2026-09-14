'use client';
// ═══════════════════════════════════════════════════════════════
// CONFIGURAÇÕES — área administrativa (Negócio · Agenda · CRM · Canais)
// ═══════════════════════════════════════════════════════════════
// SEPARAÇÃO CLARA DE RESPONSABILIDADES (regra do produto):
//   • Informações do negócio (nome, logo, contatos, endereço, descrição)
//     → CONFIGURAÇÕES → Negócio. É a fonte de verdade; o bloco "Perfil" da
//       página lê exatamente daqui.
//   • Aparência e conteúdo da página pública (blocos, ordem, navegação,
//     "Sobre", tema, vitrine, publicação) → EDITOR DA PÁGINA (/pagina).
// Nada de duplicar: aqui não existe mais aba "Página" com menu/Sobre —
// só um ponteiro para o editor, para quem procurar em Configurações.
//
// Campos legados de venda (taxa de entrega, pedido mínimo, formas de
// pagamento no checkout) saíram da experiência: continuam no banco e em
// APIs antigas para dados já existentes, mas não são mais oferecidos aqui.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { Business } from '@/lib/types';
import { PageSkeleton } from '@/components/ui';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';

export default function ConfigPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [biz, setBiz] = useState<Business | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'negocio' | 'agenda' | 'crm' | 'canais'>('negocio');
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
      // Sem nav/navCustom/about aqui: essa configuração vive no editor da
      // página (fonte única). Enviar o que já está salvo também seria
      // duplicar responsabilidade — os campos simplesmente não saem daqui.
      const res = await apiSend(`/api/businesses/${businessId}`, 'PATCH', {
        name: biz.name, description: biz.description, logo: biz.logo, cover: biz.cover,
        phone: biz.phone, whatsapp: biz.whatsapp, email: biz.email,
        instagram: biz.instagram, tiktok: biz.tiktok, address: biz.address, mapsUrl: biz.mapsUrl,
      }, { scope: 'action', area: 'Configurações' });
      if (!res.ok) throw new Error(res.message);
      setMsg('Configurações salvas.');
    } catch (err: any) { setMsg(err.message); } finally { setSaving(false); setTimeout(() => setMsg(''), 3000); }
  }

  if (denied) return <AccessDenied area="Configurações" />;
  if (!biz) return <PageSkeleton />;
  const set = (k: keyof Business, v: any) => setBiz({ ...biz, [k]: v });
  const input = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900';

  return (
    <>
      <h1 className="text-base font-semibold">Configurações</h1>
      <p className="text-sm text-zinc-500 mt-0.5 mb-4">As informações do seu negócio e os acessos administrativos. A página pública se constrói no editor de Página.</p>
      {msg && <p className="mb-3 text-sm font-medium bg-zinc-900 text-white rounded-md px-3 py-2">{msg}</p>}

      <div className="flex flex-wrap gap-1 p-1 bg-zinc-100 rounded-md mb-4 w-fit" role="tablist">
        {([['negocio', 'Negócio'], ['agenda', 'Agenda'], ['crm', 'CRM'], ['canais', 'Canais']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('text-xs font-medium px-3 py-1.5 rounded', tab === id ? 'bg-white shadow-sm border border-zinc-200 text-zinc-900' : 'text-zinc-500')}>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {tab === 'negocio' && (
          <>
            <section className="bg-white border border-zinc-200 p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-sm">Informações do negócio</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Esta é a fonte de verdade do perfil: a página pública lê estes dados automaticamente.</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Nome *</span><input value={biz.name} onChange={(e) => set('name', e.target.value)} className={input + ' mt-1'} /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">E-mail</span><input value={biz.email} onChange={(e) => set('email', e.target.value)} className={input + ' mt-1'} /></label>
              </div>
              <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Descrição</span><textarea value={biz.description} onChange={(e) => set('description', e.target.value)} className={input + ' mt-1'} rows={2} placeholder="Ex: Consultas de estética avançada com hora marcada." /></label>
              <div className="grid sm:grid-cols-2 gap-4">
                <ImageUpload label="LOGO" value={biz.logo} onChange={(url) => set('logo', url)} businessId={businessId} circle />
                <ImageUpload label="CAPA / BANNER" value={biz.cover} onChange={(url) => set('cover', url)} businessId={businessId} />
              </div>
            </section>

            <section className="bg-white border border-zinc-200 p-4 space-y-3">
              <h3 className="font-semibold text-sm">Contato e redes</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">WhatsApp *</span><input value={biz.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} className={input + ' mt-1'} placeholder="(11) 99999-9999" /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Telefone</span><input value={biz.phone} onChange={(e) => set('phone', e.target.value)} className={input + ' mt-1'} /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Instagram</span><input value={biz.instagram} onChange={(e) => set('instagram', e.target.value)} className={input + ' mt-1'} placeholder="@seuperfil" /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">TikTok</span><input value={biz.tiktok} onChange={(e) => set('tiktok', e.target.value)} className={input + ' mt-1'} placeholder="@seuperfil" /></label>
              </div>
            </section>

            <section className="bg-white border border-zinc-200 p-4 space-y-3">
              <h3 className="font-semibold text-sm">Endereço</h3>
              <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Endereço</span><input value={biz.address} onChange={(e) => set('address', e.target.value)} className={input + ' mt-1'} placeholder="Rua, número, bairro, cidade" /></label>
              <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Link do mapa</span><input value={biz.mapsUrl} onChange={(e) => set('mapsUrl', e.target.value)} className={input + ' mt-1'} placeholder="Cole o link do Google Maps" /><span className="text-xs text-zinc-500">Com o link salvo, o bloco Localização da página mostra o mapa.</span></label>
            </section>

            <section className="bg-white border border-zinc-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-sm">Página pública</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Blocos, ordem, navegação, “Sobre”, visual e publicação ficam no editor da Página — um só lugar.</p>
                </div>
                <Link href={`/pagina?b=${businessId}`} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md shrink-0">Editar página pública</Link>
              </div>
            </section>

            <button onClick={save} disabled={saving} className="text-sm font-semibold bg-zinc-900 text-white px-5 py-2.5 rounded-md disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar informações'}</button>
          </>
        )}

        {tab === 'agenda' && (
          <div className="bg-white border border-zinc-200 divide-y divide-zinc-100">
            {[
              { title: 'Horários e profissionais', hint: 'Janela da clínica, equipe e regras de reserva (antecedência, buffer, horizonte)', href: `/servicos?b=${businessId}` },
              { title: 'Agenda do dia', hint: 'Grade Day/Week/Month, drag para remarcar e fechamento de atendimentos', href: `/agenda?b=${businessId}` },
              { title: 'Serviços', hint: 'Catálogo com preço, duração e quem atende', href: `/servicos?b=${businessId}` },
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
            <p className="text-xs text-zinc-500">A base cresce sozinha com cadastro, agendamento e conversa — o histórico do cliente nunca é apagado.</p>
            <ul className="text-xs text-zinc-600 space-y-1 list-disc pl-4">
              <li><strong>Nunca presumimos consentimento.</strong></li>
              <li>Desligar um módulo não apaga histórico.</li>
              <li>Agendamentos vinculam o cliente existente (visão 360).</li>
            </ul>
            <div className="flex gap-2 pt-2">
              <Link href={`/clientes?b=${businessId}`} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md">Abrir clientes</Link>
              <Link href={`/campanhas?b=${businessId}`} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md">Campanhas</Link>
            </div>
          </section>
        )}

        {tab === 'canais' && (
          <section className="bg-white border border-zinc-200 p-4 space-y-3">
            <h3 className="font-semibold text-sm">Recursos, assistente, WhatsApp e equipe</h3>
            <p className="text-xs text-zinc-500">Módulos da empresa ({activeModules ?? '—'} ativos) — ligue e desligue em Recursos.</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <Link href={`/recursos?b=${businessId}`} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md text-center">Recursos da empresa</Link>
              <Link href={`/agente?b=${businessId}`} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md text-center">Assistente</Link>
              <Link href={`/whatsapp?b=${businessId}`} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md text-center">WhatsApp</Link>
              <Link href={`/equipe?b=${businessId}`} className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md text-center">Equipe</Link>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
