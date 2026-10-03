'use client';
// ═══════════════════════════════════════════════════════════════
// CONFIGURAÇÕES — cadastro institucional e operacional da clínica
// ═══════════════════════════════════════════════════════════════
// Fonte institucional: dados da clínica, responsável técnico, endereço,
// identidade visual e operação/agenda. Redes e página pública são
// Informações da clínica e regras de agendamento. (legado: hint condicional quando GODOUTOR_LEGACY_PAGES desligado)
// secundárias (compatibilidade). "Quando atende" vive em Disponibilidade;
// "como reserva" (regras) vive na aba Agenda aqui. Nada de duplicar
// navegação: Canais & Integrações mora em /canais.
//
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { BookingConfig, Business, ScheduleResource } from '@/lib/types';
import { defaultBookingConfig } from '@/lib/types';
import { Button, PageHeader, PageSkeleton, Tabs } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ImageUpload } from '@/components/dashboard/ImageUpload';
import { AccessDenied, AreaLoadError, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { isLegacyPagesEnabled } from '@/lib/product';

type ConfigTab = 'negocio' | 'agenda';

const CONFIG_TAB_ICON: Record<ConfigTab, string> = {
  negocio: 'store',
  agenda: 'calendar',
};

const CONFIG_TABS: Array<[ConfigTab, string]> = [
  ['negocio', 'Clínica'],
  ['agenda', 'Agenda'],
];

const LEGACY_TAB_REDIRECT: Record<string, string> = {
  canais: '/canais?tab=canais',
  integracoes: '/canais?tab=integracoes',
};

function tabFromParam(value: string | null): ConfigTab {
  return CONFIG_TABS.some(([id]) => id === value) ? (value as ConfigTab) : 'negocio';
}

// ── Regras da agenda ───────────────────────
// Classificação BookingConfig (auditoria 2026-09-29):
// INTERNAL/SHARED: leadMin (antecedência mínima grade), bufferMin (intervalo entre atendimentos) — valem para agenda interna e pública (slots)
// PUBLIC_BOOKING (legado): horizonDays (janela máxima de autoagendamento público), cancelUntilMin (limite de cancelamento pelo cliente) — só autoagendamento
// teamMode legado: política de atribuição antes era “solo/choosable/auto” (vitrine), hoje “Política da agenda” neutra
function BookingRules({ businessId, initial, onSaved }: {
  businessId: string;
  initial: BookingConfig;
  onSaved: () => void;
}) {
  const legacyPagesEnabled = isLegacyPagesEnabled();
  const [cfg, setCfg] = useState<BookingConfig>({ ...defaultBookingConfig(), ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hasTeam, setHasTeam] = useState<boolean | null>(null);
  const [resources, setResources] = useState<ScheduleResource[]>([]);
  const [resourceName, setResourceName] = useState('');
  const [resourceKind, setResourceKind] = useState<'room' | 'equipment'>('room');
  const [editingResource, setEditingResource] = useState<ScheduleResource | null>(null);
  async function saveResource(data: Record<string, unknown>) {
    const res = await apiSend('/api/schedule-operations', 'POST', { businessId, ...data }, { scope: 'action', area: 'Configurações' });
    if (!res.ok) { setError(res.message || 'Não foi possível salvar o recurso.'); return; }
    const list = await apiGet<{ resources: ScheduleResource[] }>(`/api/schedule-operations?businessId=${businessId}`, { scope: 'action', area: 'Configurações' });
    if (list.ok) setResources(list.data?.resources || []);
    setResourceName(''); setEditingResource(null);
  }

  useEffect(() => {
    let cancelled = false;
    apiGet<{ professionals?: Array<{ id: string }>; scheduleResources?: ScheduleResource[] }>(`/api/catalog/get?businessId=${businessId}`, { scope: 'action', area: 'Configurações' })
      .then((res) => { if (!cancelled) { setHasTeam(res.ok ? (res.data?.professionals || []).length > 0 : false); if (res.ok) setResources(res.data?.scheduleResources || []); } });
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
    <section className="bg-white border border-zinc-200 p-5 space-y-3">
      <div>
        <h3 className="font-semibold text-sm">{legacyPagesEnabled ? 'Regras de reserva' : 'Regras da agenda'}</h3>
        <p className="text-xs text-zinc-500 mt-0.5">
          {legacyPagesEnabled ? (
            <>Como o cliente pode reservar: prazos e limites do <strong>autoagendamento público</strong>. Para operação interna, antecedência e intervalo valem para todos; a equipe pode agendar até 5 anos.</>
          ) : (
            <>Como a agenda funciona: antecedência e intervalos da <strong>operação interna</strong>. Quando a clínica e cada profissional atendem se configura em{' '}
              <Link href={`/disponibilidade?b=${businessId}`} className="font-medium underline underline-offset-2">Disponibilidade</Link>.</>
          )}

        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3.5">
        {hasTeam === true && (
          <div className="sm:col-span-2">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5" aria-label="Atribuição de profissional — política da agenda">
              <p className="text-xs font-semibold text-zinc-500">ATRIBUIÇÃO DE PROFISSIONAL</p>
              <p className="text-sm font-medium text-zinc-800 mt-1">
                Política da agenda
              </p>
              <span className="block text-[11px] text-zinc-500 mt-0.5">A agenda considera disponibilidade, serviços vinculados e regras da clínica para definir os profissionais disponíveis.</span>
            </div>
          </div>
        )}
        <label className="block"><span className="text-xs font-semibold text-zinc-500">ANTECEDÊNCIA MÍNIMA (MIN)</span>
          <input type="number" min={0} max={1440} value={cfg.leadMin} onChange={(e) => setCfg({ ...cfg, leadMin: Number(e.target.value) })} className={num} />
          <span className="text-[11px] text-zinc-500">Ex: 30 = só reserva com 30 min de folga. Vale para agenda interna e pública (grade).</span></label>
        <label className="block"><span className="text-xs font-semibold text-zinc-500">PREPARAÇÃO ANTES (MIN)</span>
          <input type="number" min={0} max={240} value={cfg.bufferBeforeMin ?? 0} onChange={(e) => setCfg({ ...cfg, bufferBeforeMin: Number(e.target.value) })} className={num} />
          <span className="text-[11px] text-zinc-500">Reserva capacidade antes do atendimento; não aumenta o cartão.</span></label>
        <label className="block"><span className="text-xs font-semibold text-zinc-500">TEMPO DEPOIS (MIN)</span>
          <input type="number" min={0} max={240} value={cfg.bufferAfterMin ?? cfg.bufferMin} onChange={(e) => setCfg({ ...cfg, bufferAfterMin: Number(e.target.value) })} className={num} />
          <span className="text-[11px] text-zinc-500">Para dados antigos, o intervalo legado é aplicado somente depois.</span></label>
        <div className="sm:col-span-2 border-t border-zinc-200 pt-3 space-y-2">
          <h4 className="text-sm font-semibold">Recursos · salas e equipamentos</h4>
          <p className="text-xs text-zinc-500">Um recurso não pode atender dois profissionais ao mesmo tempo. Desative os que têm histórico.</p>
          {resources.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-md px-3 py-2 text-sm">
            <span>{r.name} · {r.kind === 'room' ? 'Sala' : 'Equipamento'}{!r.active && ' · Inativo'}</span>
            <span className="flex gap-2"><button type="button" className="underline" onClick={() => { setEditingResource(r); setResourceName(r.name); setResourceKind(r.kind); }}>Editar</button>
              <button type="button" className="underline" onClick={() => void saveResource({ action: 'resource.save', id: r.id, name: r.name, kind: r.kind, active: !r.active })}>{r.active ? 'Desativar' : 'Ativar'}</button></span>
          </div>)}
          <div className="flex flex-wrap gap-2"><input aria-label="Nome do recurso" value={resourceName} onChange={e => setResourceName(e.target.value)} placeholder="Sala 1 ou Ultrassom 01" className="border rounded-md px-2 py-2 text-sm flex-1 min-w-36" />
            <select aria-label="Tipo do recurso" value={resourceKind} onChange={e => setResourceKind(e.target.value as 'room' | 'equipment')} className="border rounded-md px-2 py-2 text-sm"><option value="room">Sala</option><option value="equipment">Equipamento</option></select>
            <button type="button" className="border rounded-md px-3 py-2 text-sm font-semibold" onClick={() => void saveResource({ action: 'resource.save', id: editingResource?.id, name: resourceName, kind: resourceKind, active: editingResource?.active ?? true })}>{editingResource ? 'Salvar recurso' : 'Adicionar recurso'}</button>
            {editingResource && <button type="button" onClick={() => { setEditingResource(null); setResourceName(''); }}>Cancelar</button>}
          </div>
        </div>
        {legacyPagesEnabled && (
          <>
            <label className="block"><span className="text-xs font-semibold text-zinc-500">CANCELAR ATÉ (MIN ANTES) — público</span>
          <input type="number" min={0} max={10080} value={cfg.cancelUntilMin} onChange={(e) => setCfg({ ...cfg, cancelUntilMin: Number(e.target.value) })} className={num} />
          <span className="text-[11px] text-zinc-500">Limite de cancelamento pelo cliente no autoagendamento. Equipe cancela sem limite interno.</span></label>
            <label className="block"><span className="text-xs font-semibold text-zinc-500">JANELA DE AUTOAGENDAMENTO (DIAS) — público</span>
          <input type="number" min={1} max={365} value={cfg.horizonDays} onChange={(e) => setCfg({ ...cfg, horizonDays: Number(e.target.value) })} className={num} />
          <span className="text-[11px] text-zinc-500">Janela máxima que o cliente vê no autoagendamento. A equipe pode agendar até 5 anos à frente.</span></label>
          </>
        )}
      </div>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      <Button variant="primary" onClick={save} disabled={saving}>
        {saving ? 'Salvando…' : 'Salvar regras'}
      </Button>
    </section>
  );
}


export default function ConfigPage() {
  // endereço público legado — GODOUTOR_LEGACY_PAGES: o que ainda depende de
  // página pública (capa, perfil da vitrine, Instagram de vitrine) só aparece
  // com a flag ON; o núcleo clínico (agenda/regras/whatsapp) é sempre exibido.
  const legacyPagesEnabled = isLegacyPagesEnabled();
  const router = useRouter();
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [biz, setBiz] = useState<Business | null>(null);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const tabParam = params.get('tab') || '';
  const tab = tabFromParam(tabParam);

  function choose(next: ConfigTab) {
    if (next === tab) return;
    const qs = new URLSearchParams();
    qs.set('tab', next);
    if (businessId) qs.set('b', businessId);
    router.push(`/configuracoes?${qs.toString()}`, { scroll: false });
  }

  useEffect(() => {
    if (!LEGACY_TAB_REDIRECT[tabParam]) return;
    const target = LEGACY_TAB_REDIRECT[tabParam];
    const sep = target.includes('?') ? '&' : '?';
    router.replace(businessId ? `${target}${sep}b=${businessId}` : target);
  }, [tabParam, businessId, router]);

  const { denied, failed, report } = useAreaLoad('Configurações');

  const load = useCallback(async () => {
    if (!businessId) return;
    // Clinical OS: cadastro institucional carrega pelo domínio Business, não pelo domínio Page
    const res = await apiGet<{ business: Business }>(`/api/businesses/${businessId}`, { scope: 'area', area: 'Configurações' });
    if (!report(res) || !res.data) return;
    setBiz(res.data.business);
    // diagnóstico técnico removido da superfície clínica — não movido nesta fase (ver relatório)
  }, [businessId, report]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!biz) return;
    setSaving(true); setMsg('');
    try {
      const res = await apiSend(`/api/businesses/${businessId}`, 'PATCH', {
        name: biz.name,
        fantasyName: (biz as any).fantasyName || '',
        document: (biz as any).document || '',
        description: biz.description,
        logo: biz.logo,
        phone: biz.phone,
        whatsapp: biz.whatsapp,
        email: biz.email,
        address: biz.address,
        city: (biz as any).city || '',
        state: (biz as any).state || '',
        zip: (biz as any).zip || '',
        mapsUrl: biz.mapsUrl,
        responsibleName: (biz as any).responsibleName || '',
        responsibleDocument: (biz as any).responsibleDocument || '',
        responsibleRegistry: (biz as any).responsibleRegistry || '',
        responsibleRole: (biz as any).responsibleRole || '',
        instagram: biz.instagram,
        tiktok: biz.tiktok,
        socials: {
          ...(biz.socials || {}),
          facebook: (biz.socials || {}).facebook || '',
          youtube: (biz.socials || {}).youtube || '',
          linkedin: (biz.socials || {}).linkedin || '',
          site: (biz.socials || {}).site || '',
        },
      }, { scope: 'action', area: 'Configurações' });
      if (!res.ok) throw new Error(res.message);
      setMsg('Cadastro da clínica salvo.');
    } catch (err: any) { setMsg(err.message); } finally { setSaving(false); setTimeout(() => setMsg(''), 3000); }
  }

  if (denied) return <AccessDenied area="Configurações" />;
  if (failed) return <AreaLoadError area="Configurações" message={failed} onRetry={load} />;
  if (!biz) return <PageSkeleton />;
  const set = (k: keyof Business, v: any) => setBiz({ ...biz, [k]: v } as Business);
  const setAny = (k: string, v: any) => setBiz({ ...biz, [k]: v } as any);
  const input = 'w-full rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm shadow-xs focus:outline-none focus:shadow-focus focus:border-[var(--brand)]';

  return (
    <>
      <PageHeader
        icon="settings"
        title="Configurações"
        hint="Cadastro institucional e operacional da clínica."
      />
      {msg && <p role="status" className="mb-3 text-sm font-semibold bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success-fg)] rounded-md px-3 py-2">{msg}</p>}
      {/* Diagnóstico 'Como está a inteligência' movido para Canais — ver /canais */}
<div className="mb-4">
        <Tabs
          items={CONFIG_TABS.map(([id, label]) => ({ id: id as ConfigTab, label, icon: CONFIG_TAB_ICON[id as ConfigTab] }))}
          value={tab}
          onChange={(id) => choose(id)}
          ariaLabel="Seções de Configurações"
        />
      </div>

      <div className="max-w-[60rem] mx-auto space-y-4">
        {tab === 'negocio' && (
          <>
            {/* Dados da clínica */}
            <section className="bg-white border border-zinc-200 p-5 space-y-4">
              <div>
                <h3 className="font-semibold text-sm">Dados da clínica</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Identificação e contato institucional — fonte do cadastro e de documentos.</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block sm:col-span-2"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Nome da clínica *</span><input value={biz.name} onChange={(e) => set('name', e.target.value)} className={input + ' mt-1'} placeholder="Clínica Veterinária Exemplo" /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Nome fantasia</span><input value={(biz as any).fantasyName || ''} onChange={(e) => setAny('fantasyName', e.target.value)} className={input + ' mt-1'} placeholder="Opcional" /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">CNPJ / CPF</span><input value={(biz as any).document || ''} onChange={(e) => setAny('document', e.target.value)} className={input + ' mt-1'} placeholder="00.000.000/0000-00" /></label>
              </div>
              <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Descrição</span><textarea value={biz.description} onChange={(e) => set('description', e.target.value)} className={input + ' mt-1'} rows={2} placeholder="Ex: Clínica veterinária com atendimento 24h, consultas e cirurgia." /></label>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">E-mail principal</span><input value={biz.email} onChange={(e) => set('email', e.target.value)} className={input + ' mt-1'} placeholder="contato@clinica.com.br" /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Telefone</span><input value={biz.phone} onChange={(e) => set('phone', e.target.value)} className={input + ' mt-1'} placeholder="(11) 3333-3333" /></label>
                <label className="block sm:col-span-2"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">WhatsApp *</span><input value={biz.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} className={input + ' mt-1'} placeholder="(11) 99999-9999" /></label>
              </div>
              <div className="space-y-2">
                <ImageUpload label="LOGO DA CLÍNICA" value={biz.logo} onChange={(url) => set('logo', url)} businessId={businessId} circle />
                <p className="text-[11px] text-zinc-500">
                  Usado no painel, documentos e como identidade da clínica.
                  {legacyPagesEnabled ? ' A capa da página pública, quando usada, é editada em Página → Perfil.' : ''}
                </p>
              </div>
            </section>

            {/* Endereço */}
            <section className="bg-white border border-zinc-200 p-5 space-y-3">
              <h3 className="font-semibold text-sm">Endereço</h3>
              <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Endereço</span><input value={biz.address} onChange={(e) => set('address', e.target.value)} className={input + ' mt-1'} placeholder="Rua, número, bairro" /></label>
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Cidade</span><input value={(biz as any).city || ''} onChange={(e) => setAny('city', e.target.value)} className={input + ' mt-1'} placeholder="São Paulo" /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Estado</span><input value={(biz as any).state || ''} onChange={(e) => setAny('state', e.target.value)} className={input + ' mt-1'} placeholder="SP" /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">CEP</span><input value={(biz as any).zip || ''} onChange={(e) => setAny('zip', e.target.value)} className={input + ' mt-1'} placeholder="00000-000" /></label>
              </div>
              <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Link do mapa (opcional)</span><input value={biz.mapsUrl} onChange={(e) => set('mapsUrl', e.target.value)} className={input + ' mt-1'} placeholder="Cole o link do Google Maps" /></label>
            </section>

            {/* Responsável técnico */}
            <section className="bg-white border border-zinc-200 p-5 space-y-3">
              <div>
                <h3 className="font-semibold text-sm">Responsável técnico</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Dados do responsável pela clínica — usado em documentos e identificação institucional.</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Nome do responsável</span><input value={(biz as any).responsibleName || ''} onChange={(e) => setAny('responsibleName', e.target.value)} className={input + ' mt-1'} placeholder="Dra. Ana Silva" /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Função / cargo</span><input value={(biz as any).responsibleRole || ''} onChange={(e) => setAny('responsibleRole', e.target.value)} className={input + ' mt-1'} placeholder="Veterinária responsável" /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Documento (CPF/RG)</span><input value={(biz as any).responsibleDocument || ''} onChange={(e) => setAny('responsibleDocument', e.target.value)} className={input + ' mt-1'} placeholder="000.000.000-00" /></label>
                <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Registro profissional</span><input value={(biz as any).responsibleRegistry || ''} onChange={(e) => setAny('responsibleRegistry', e.target.value)} className={input + ' mt-1'} placeholder="CRMV 12345" /></label>
              </div>
            </section>

            {legacyPagesEnabled && (
            /* Redes e site — secundário (legado, oculto quando GODOUTOR_LEGACY_PAGES OFF) */
            <details className="bg-white border border-zinc-200 rounded-lg">
              <summary className="px-5 py-3 flex items-center gap-2 cursor-pointer select-none list-none">
                <Icon n="external" size={14} />
                <h3 className="text-sm font-semibold">Redes e site (opcional — secundário)</h3>
                <span className="text-xs text-zinc-400 font-normal ml-auto">clique para expandir</span>
              </summary>
              <div className="px-5 pb-5 pt-2 space-y-3 border-t border-zinc-100">
                <p className="text-xs text-zinc-500">Canais secundários. Não são protagonistas do cadastro institucional — a operação vive em Canais & Integrações.</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Instagram</span><input value={biz.instagram} onChange={(e) => set('instagram', e.target.value)} className={input + ' mt-1'} placeholder="@seuperfil" /></label>
                  <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">TikTok</span><input value={biz.tiktok} onChange={(e) => set('tiktok', e.target.value)} className={input + ' mt-1'} placeholder="@seuperfil" /></label>
                  {([['facebook', 'Facebook', 'https://facebook.com/suaclinica'], ['youtube', 'YouTube', 'https://youtube.com/@seucanal'], ['linkedin', 'LinkedIn', 'https://linkedin.com/company/suaclinica'], ['site', 'Meu site', 'https://suaclinica.com.br']] as const).map(([key, label, ph]) => (
                    <label key={key} className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">{label}</span>
                      <input value={(biz.socials || {})[key] || ''} onChange={(e) => set('socials', { ...(biz.socials || {}), [key]: e.target.value })} className={input + ' mt-1'} placeholder={ph} /></label>
                  ))}
                </div>
              </div>
            </details>
            )}

            {/* Canais e integrações — ponte */}
            <section className="bg-zinc-50 border border-zinc-200 p-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm">Canais e integrações</h3>
                <p className="text-xs text-zinc-500 mt-0.5">WhatsApp, Instagram e integrações técnicas são configurados em local próprio.</p>
              </div>
              <Link href={`/canais?b=${businessId}`} className="shrink-0"><Button variant="secondary" size="sm">Abrir Canais</Button></Link>
            </section>

            {legacyPagesEnabled && <section className="bg-white border border-zinc-200 p-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-sm">Página pública</h3>
                <p className="text-xs text-zinc-500 mt-0.5">Cadastro legado — editor e publicação da página/presença online.</p>
              </div>
              <Link href={`/pagina?b=${businessId}`} className="shrink-0"><Button variant="secondary" size="sm">Editar página pública</Button></Link>
            </section>}

            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar cadastro da clínica'}</Button>
          </>
        )}

        {tab === 'agenda' && biz && (
          <BookingRules
            businessId={businessId}
            initial={biz.booking || defaultBookingConfig()}
            onSaved={() => { setMsg(legacyPagesEnabled ? 'Regras de reserva salvas.' : 'Regras da agenda salvas.'); setTimeout(() => setMsg(''), 3000); }}
          />
        )}

        {/* Aparência movida para Perfil — tema do navegador (preferência do usuário), não tenant */}


      </div>
    </>
  );
}
