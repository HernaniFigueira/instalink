'use client';
// ═══════════════════════════════════════════════════════════════
// PERFIL 360 — ROTA PRÓPRIA (§11)
// ═══════════════════════════════════════════════════════════════
// Antes, a ficha inteira da pessoa só existia dentro de uma gaveta estreita
// sobre a lista: com abas, atendimentos, arquivos e financeiro, isso é
// PÁGINA — não pop-up. Aqui a mesma ficha (mesmo componente, mesmo corpo,
// mesmos dados e mesma permissão) vive na área principal, com sidebar e
// topbar no lugar, endereço compartilhável e "← Voltar para clientes".
//
// A gaveta continua existindo como PASSAGEM rápida na lista, com a ação
// "Ver perfil completo" apontando para cá.
import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { BusinessPipeline } from '@/lib/types';
import { apiGet } from '@/lib/api-client';
import { ClientProfileDrawer, type Person360 } from '@/components/dashboard/ClientProfileDrawer';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { AccessDenied, AreaLoadError, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { effectiveHorizonDays } from '@/lib/booking-ops';
import { Button, Skeleton } from '@/components/ui';
import { Icon } from '@/components/icons';

export default function ClientePerfilPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  // A empresa ativa vem do MESMO resolvedor das outras telas (?b= quando
  // existe, senão /api/auth/me) — a rota não inventa contexto próprio.
  const { businessId, resolving, noBusiness } = useBusinessId();
  const key = decodeURIComponent(params?.id || '');
  const b = search.get('b') || '';
  // P1.7 — o "Voltar para clientes" devolve a lista COMO ESTAVA: a busca, o
  // filtro e a página viajam na URL da ficha e voltam inteiras.
  const listState = new URLSearchParams();
  if (b) listState.set('b', b);
  for (const key of ['q', 'filter', 'page', 'tab']) {
    const v = search.get(key);
    if (v) listState.set(key, v);
  }
  const listHref = `/clientes${listState.toString() ? `?${listState.toString()}` : ''}`;

  const [person, setPerson] = useState<Person360 | null>(null);
  const [pipeline, setPipeline] = useState<BusinessPipeline | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [retry, setRetry] = useState(0);

  const { denied, failed, report } = useAreaLoad('Clientes');
  const { permissions, ready: permsReady } = usePanelPermissions();
  const canFunil = permsReady && permissions.leads === true;

  // Ficha completa: uma pessoa por identidade estável (`key`), mesmo payload
  // e mesma permissão da lista — sem endpoint paralelo com regra própria.
  const load = useCallback(async () => {
    if (!businessId || !key) return;
    setLoaded(false);
    setMissing(false);
    const res = await apiGet<{ people?: Person360[] }>(
      `/api/people360?businessId=${encodeURIComponent(businessId)}&key=${encodeURIComponent(key)}`,
      { scope: 'area', area: 'Clientes' },
    );
    if (!report(res)) { setLoaded(true); return; }
    const found = (res.data?.people || []).find((p) => p.key === key) || null;
    if (!found) setMissing(true);
    setPerson(found);
    setLoaded(true);
  }, [businessId, key, report]);

  useEffect(() => { load(); }, [load, retry]);

  useEffect(() => {
    if (!businessId || !canFunil) return;
    let cancelled = false;
    apiGet<{ pipeline?: BusinessPipeline }>(`/api/pipeline?businessId=${encodeURIComponent(businessId)}`, { scope: 'area', area: 'Clientes' })
      .then((res) => { if (!cancelled && res.ok) setPipeline((res.data as any)?.pipeline || null); })
      .catch(() => { /* funil indisponível não derruba a ficha */ });
    return () => { cancelled = true; };
  }, [businessId, canFunil, retry]);

  // "Novo agendamento" a partir da ficha: mesma folha de agendamento da lista.
  const [services, setServices] = useState<any[]>([]);
  const [pros, setPros] = useState<any[]>([]);
  const [booking, setBooking] = useState<{ cfg: any; tz: string } | null>(null);
  const [bookingFor, setBookingFor] = useState<Person360 | null>(null);

  async function openBooking(p: Person360) {
    setBookingFor(p);
    const res = await apiGet<any>(`/api/catalog/get?businessId=${encodeURIComponent(businessId)}`, { scope: 'action', area: 'Clientes' });
    if (!res.ok) return;
    setServices(res.data?.services || []);
    setPros(res.data?.professionals || []);
    setBooking({ cfg: res.data?.business?.booking || null, tz: res.data?.business?.businessTimezone || '' });
  }

  const backLink = (
    <Link href={listHref}
      className="-ml-2 inline-flex items-center gap-1.5 h-9 px-2 rounded-md text-[13px] font-semibold text-[var(--text-soft)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:shadow-focus">
      <Icon n="chevL" size={14} /> Voltar para clientes
    </Link>
  );

  if (denied) return <AccessDenied area="Clientes" homeHref={b ? `/dashboard?b=${b}` : '/dashboard'} />;

  if (noBusiness) {
    return (
      <div className="space-y-3">
        {backLink}
        <div className="ws-panel p-6">
          <h1 className="text-[22px] font-semibold text-[var(--text)]">Clientes</h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-1.5">Sua conta ainda não tem uma unidade ativa.</p>
          <Link href="/dashboard" className="inline-block mt-3"><Button variant="secondary" size="sm">Ir para o painel</Button></Link>
        </div>
      </div>
    );
  }

  if (resolving || (!loaded && !failed)) {
    return (
      <div className="space-y-3" aria-busy="true">
        {backLink}
        <div className="ws-panel p-4 space-y-3">
          <div className="flex items-center gap-3.5">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
          </div>
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }

  if (failed || missing || !person) {
    return (
      <div className="space-y-3">
        {backLink}
        <AreaLoadError
          area="Clientes"
          message={failed || 'Esta pessoa não está na base desta unidade.'}
          onRetry={() => setRetry((n) => n + 1)}
        />
      </div>
    );
  }

  return (
    <>
      <ClientProfileDrawer
        variant="page"
        person={person}
        businessId={businessId}
        pipeline={pipeline}
        canFunil={canFunil}
        onClose={() => { /* em página, sair é usar o link "Voltar para clientes" */ }}
        onChanged={load}
        onNewBooking={(p) => openBooking(p)}
      />

      {bookingFor && (
        <NewBookingSheet
          businessId={businessId}
          services={services}
          pros={pros}
          horizonDays={effectiveHorizonDays(booking?.cfg)}
          timezone={booking?.tz || ''}
          initial={{ contactId: bookingFor.contactId, name: bookingFor.name, phone: bookingFor.phone, email: bookingFor.email }}
          onClose={() => setBookingFor(null)}
          onCreated={load}
        />
      )}
    </>
  );
}
