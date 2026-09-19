'use client';
// ═══════════════════════════════════════════════════════════════
// CONFIGURAÇÕES — área administrativa (Negócio · Agenda · Aparência)
// ═══════════════════════════════════════════════════════════════
// Configurações não é uma segunda navegação: cada aba EDITA algo desta
// empresa — nada de aba que só aponta para portas do menu.
//
// SEPARAÇÃO CLARA DE RESPONSABILIDADES (regra do produto):
//   • Informações do negócio (nome, logo, contatos, endereço, descrição)
//     → CONFIGURAÇÕES → Negócio. É a fonte de verdade; o bloco "Perfil" da
//       página lê exatamente daqui.
//   • Aparência e conteúdo da página pública (blocos, ordem, navegação,
//     "Sobre", tema, vitrine, publicação) → EDITOR DA PÁGINA (/pagina).
// Nada de duplicar: aqui não existe mais aba "Página" com menu/Sobre —
// só um ponteiro para o editor, para quem procurar em Configurações.
//
// A1.2 · Bloco 1 — SEM NAVEGAÇÃO PARALELA: as abas "Canais" e "Integrações"
// saíram daqui (eram a mesma tela em dois endereços). Canais, fontes e
// integrações têm porta própria (/canais). Quem chegar por um link antigo
// (?tab=canais | ?tab=integracoes) é levado para /canais com a unidade
// preservada — nada de tela duplicada com conteúdo divergente.
//
// A1.2 · Bloco 2 — REGRAS DE RESERVA: "quando atende" permanece em
// /disponibilidade; "como o cliente pode reservar" (antecedência, prazo de
// cancelamento, horizonte da agenda, buffer, distribuição da equipe) é
// configuração do negócio e mora aqui, na aba Agenda — EDITANDO os valores
// (mesmo PATCH /api/businesses/:id de antes; nenhuma regra da engine de
// agenda mudou). A aba "CRM" antiga saiu: só continha texto e links para
// portas que já estão no menu (Clientes e Campanhas).
//
// Abas sincronizadas com a URL (?tab=): refresh preserva a aba, o botão
// voltar funciona e o link direto (ex.: /configuracoes?tab=agenda) abre na
// aba certa.
//
// Campos legados de venda (taxa de entrega, pedido mínimo, formas de
// pagamento no checkout) saíram da experiência: continuam no banco e em
// APIs antigas para dados já existentes, mas não são mais oferecidos aqui.
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { BookingConfig, Business } from '@/lib/types';
import { defaultBookingConfig } from '@/lib/types';
import { Button, PageHeader, PageSkeleton, Tabs } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';

type ConfigTab = 'negocio' | 'agenda';

/**
 * Abas REAIS de configuração desta empresa: cada uma EDITA algo aqui.
 *
 * Saiu daqui:
 *   • "Canais" e "Integrações" (Bloco 1) → porta própria /canais;
 *   • "CRM" (Bloco 2) → não configurava nada: texto + links para portas que
 *     já estão no menu (Clientes, Campanhas). Consentimento continua visível
 *     na ficha de cada cliente.
 * Voltou (Bloco 2):
 *   • "Agenda" → agora EDITA as regras de reserva (antes viviam dentro de
 *     Disponibilidade, misturadas com "quando atende").
 */
/** Ícone de cada aba (A3.3): a aba é reconhecível sem ler o rótulo. */
const CONFIG_TAB_ICON: Record<ConfigTab, string> = {
  negocio: 'store',
  agenda: 'calendar',
};

const CONFIG_TABS: Array<[ConfigTab, string]> = [
  ['negocio', 'Negócio'],
  ['agenda', 'Agenda'],
];

/** Aba antiga → porta canônica (links antigos continuam chegando no lugar). */
const LEGACY_TAB_REDIRECT: Record<string, string> = {
  canais: '/canais?tab=canais',
  integracoes: '/canais?tab=integracoes',
};

function tabFromParam(value: string | null): ConfigTab {
  return CONFIG_TABS.some(([id]) => id === value) ? (value as ConfigTab) : 'negocio';
}

// ── Regras de reserva (A1.2 · Bloco 2) ───────────────────────
// "Como o cliente pode reservar?" — a mesma configuração (BookingConfig) que
// antes era editada dentro de Disponibilidade. Engine intacta: os campos são
// validados no servidor (PATCH /api/businesses/:id) e consumidos pela MESMA
// lógica de slots/antecedência/horizonte — só o endereço da edição mudou.
function BookingRules({ businessId, initial, onSaved }: {
  businessId: string;
  initial: BookingConfig;
  onSaved: () => void;
}) {
  const [cfg, setCfg] = useState<BookingConfig>({ ...defaultBookingConfig(), ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hasTeam, setHasTeam] = useState<boolean | null>(null);

  // A distribuição da equipe só faz sentido quando existe equipe.
  useEffect(() => {
    let cancelled = false;
    apiGet<{ professionals?: Array<{ id: string }> }>(`/api/catalog/get?businessId=${businessId}`, { scope: 'action', area: 'Configurações' })
      .then((res) => { if (!cancelled) setHasTeam(res.ok ? (res.data?.professionals || []).length > 0 : false); });
    return () => { cancelled = true; };
  }, [businessId]);

  async function save() {
    setSaving(true);
    setError('');
    const res = await apiSend(`/api/businesses/${businessId}`, 'PATCH', { booking: cfg }, { scope: 'action', area: 'Configurações' });
    setSaving(false);
    if (!res.ok) { setError(res.message || 'Não foi possível salvar as regras.'); return; }
    onSaved();
  }

  const num = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm mt-1';
  return (
    <section className="bg-white border border-zinc-200 p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">Regras de reserva</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          Como o cliente pode reservar: prazos e limites que valem para todos os agendamentos.
          Quando a casa e cada profissional atendem se configura em{' '}
          <Link href={`/disponibilidade?b=${businessId}`} className="font-medium underline underline-offset-2">Disponibilidade</Link>.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3.5">
        {hasTeam === true && (
          <div className="sm:col-span-2">
            {/* A1.2 · Bloco 3 — SEM CONTROLE FALSO: a distribuição automática
                é regra do produto (quem atende é resolvido pela engine, com
                profissionais ativos, vínculo serviço → profissional, horários,
                buffers e exceções). Não existe configuração alternativa
                persistida/consumida, então não há <select> aqui — um controle
                aparentemente editável que não salva nada criava expectativa
                de funcionamento. A indicação abaixo é explicitamente NÃO
                interativa. */}
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5" aria-label="Distribuição dos agendamentos: automática (fixa)">
              <p className="text-xs font-bold text-zinc-500">DISTRIBUIÇÃO DOS AGENDAMENTOS</p>
              <p className="text-sm font-medium text-zinc-800 mt-1 inline-flex items-center gap-1.5">
                <Icon n="lock" size={13} className="text-zinc-400" />
                Automática — equilibra a equipe
              </p>
              <span className="block text-[11px] text-zinc-500 mt-0.5">O cliente nunca escolhe o profissional — a regra é interna do negócio. Quem atende é resolvido automaticamente, respeitando profissionais ativos, vínculo serviço → profissional, horários, buffers e exceções.</span>
            </div>
          </div>
        )}
        <label className="block"><span className="text-xs font-bold text-zinc-500">ANTECEDÊNCIA MÍNIMA (MIN)</span>
          <input type="number" min={0} max={1440} value={cfg.leadMin} onChange={(e) => setCfg({ ...cfg, leadMin: Number(e.target.value) })} className={num} />
          <span className="text-[11px] text-zinc-500">Ex: 30 = só reserva com 30 min de folga.</span></label>
        <label className="block"><span className="text-xs font-bold text-zinc-500">CANCELAR ATÉ (MIN ANTES)</span>
          <input type="number" min={0} max={10080} value={cfg.cancelUntilMin} onChange={(e) => setCfg({ ...cfg, cancelUntilMin: Number(e.target.value) })} className={num} />
          <span className="text-[11px] text-zinc-500">Depois disso, só falando com você.</span></label>
        <label className="block"><span className="text-xs font-bold text-zinc-500">AUTOAGENDAMENTO PÚBLICO (DIAS)</span>
          <input type="number" min={1} max={365} value={cfg.horizonDays} onChange={(e) => setCfg({ ...cfg, horizonDays: Number(e.target.value) })} className={num} />
          <span className="text-[11px] text-zinc-500">Janela do cliente na página pública. A equipe pode agendar até 5 anos à frente.</span></label>
        <label className="block"><span className="text-xs font-bold text-zinc-500">INTERVALO ENTRE ATENDIMENTOS (MIN)</span>
          <input type="number" min={0} max={240} value={cfg.bufferMin} onChange={(e) => setCfg({ ...cfg, bufferMin: Number(e.target.value) })} className={num} /></label>
      </div>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <Button variant="primary" onClick={save} disabled={saving}>
        {saving ? 'Salvando…' : 'Salvar regras'}
      </Button>
    </section>
  );
}

export default function ConfigPage() {
  const router = useRouter();
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [biz, setBiz] = useState<Business | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  // Aba = URL: derivada do parâmetro a cada render, então refresh, botão
  // voltar e deep-link funcionam sem estado paralelo.
  const tabParam = params.get('tab') || '';
  const tab = tabFromParam(tabParam);

  function choose(next: ConfigTab) {
    if (next === tab) return;
    const qs = new URLSearchParams();
    qs.set('tab', next);
    if (businessId) qs.set('b', businessId);
    // push (não replace): cada troca de aba entra no histórico — o botão
    // voltar percorre as abas visitadas.
    router.push(`/configuracoes?${qs.toString()}`, { scroll: false });
  }

  // Abas que viraram porta própria: leva o link antigo até /canais (com ?b=).
  useEffect(() => {
    if (!LEGACY_TAB_REDIRECT[tabParam]) return;
    const target = LEGACY_TAB_REDIRECT[tabParam];
    // A unidade ativa segue junto (e o destino pode já trazer a própria aba).
    const sep = target.includes('?') ? '&' : '?';
    router.replace(businessId ? `${target}${sep}b=${businessId}` : target);
  }, [tabParam, businessId, router]);

  // 403 → aviso amigável (sessão preservada), nunca skeleton infinito.
  const { denied, report } = useAreaLoad('Configurações');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<{ business: Business }>(`/api/pages?businessId=${businessId}`, { scope: 'area', area: 'Configurações' });
    if (!report(res) || !res.data) return;
    setBiz(res.data.business);
  }, [businessId, report]);
  useEffect(() => { load(); }, [load]);

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
        // Redes adicionais (socials v2): URL completa, exibidas no perfil e
        // disponíveis como itens de menu da página pública.
        socials: {
          ...(biz.socials || {}),
          facebook: (biz.socials || {}).facebook || '',
          youtube: (biz.socials || {}).youtube || '',
          linkedin: (biz.socials || {}).linkedin || '',
          site: (biz.socials || {}).site || '',
        },
      }, { scope: 'action', area: 'Configurações' });
      if (!res.ok) throw new Error(res.message);
      setMsg('Configurações salvas.');
    } catch (err: any) { setMsg(err.message); } finally { setSaving(false); setTimeout(() => setMsg(''), 3000); }
  }

  // ── Identidade visual do DASHBOARD (P2) ──────────────────────
  // Salva só a cor da navegação; a página pública não é tocada.

  if (denied) return <AccessDenied area="Configurações" />;
  if (!biz) return <PageSkeleton />;
  const set = (k: keyof Business, v: any) => setBiz({ ...biz, [k]: v });
  const input = 'w-full rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm shadow-xs focus:outline-none focus:shadow-focus focus:border-[var(--brand)]';

  return (
    <>
      <PageHeader
        icon="settings"
        title="Configurações"
        hint="As informações do seu negócio e as regras de reserva. A página pública se constrói no editor de Página."
      />
      {msg && <p role="status" className="mb-3 text-sm font-semibold bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success-fg)] rounded-md px-3 py-2">{msg}</p>}

      <div className="mb-4">
        <Tabs
          items={CONFIG_TABS.map(([id, label]) => ({ id: id as ConfigTab, label, icon: CONFIG_TAB_ICON[id as ConfigTab] }))}
          value={tab}
          onChange={(id) => choose(id)}
          ariaLabel="Seções de Configurações"
        />
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
              <p className="text-[11px] text-zinc-500 -mt-1">Instagram e TikTok aceitam @usuário — a página completa o link. As redes abaixo pedem o endereço completo.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {([['facebook', 'Facebook', 'https://facebook.com/suanegocio'], ['youtube', 'YouTube', 'https://youtube.com/@seucanal'], ['linkedin', 'LinkedIn', 'https://linkedin.com/company/suanegocio'], ['site', 'Meu site', 'https://seusite.com.br']] as const).map(([key, label, ph]) => (
                  <label key={key} className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">{label}</span>
                    <input value={(biz.socials || {})[key] || ''} onChange={(e) => set('socials', { ...(biz.socials || {}), [key]: e.target.value })} className={input + ' mt-1'} placeholder={ph} /></label>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500">Cada rede preenchida aparece no perfil da página pública e pode entrar no menu (editor da Página → Navegação).</p>
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
                <Link href={`/pagina?b=${businessId}`} className="shrink-0"><Button variant="secondary" size="sm">Editar página pública</Button></Link>
              </div>
            </section>

            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar informações'}</Button>
          </>
        )}

        {/* A1.2 · Bloco 2 — REGRAS DE RESERVA ("como o cliente pode reservar")
            moram em Configurações. "Quando atende" permanece em
            /disponibilidade. A engine de agenda NÃO foi tocada: mesma
            BookingConfig, mesma validação no servidor, mesmos consumidores. */}
        {tab === 'agenda' && biz && (
          <BookingRules
            businessId={businessId}
            initial={biz.booking || defaultBookingConfig()}
            onSaved={() => { setMsg('Regras de reserva salvas.'); setTimeout(() => setMsg(''), 3000); }}
          />
        )}


      </div>
    </>
  );
}
