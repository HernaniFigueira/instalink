'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Availability, Professional } from '@/lib/types';
import { ListSkeleton, Notice, PageHeader, SubCard } from '@/components/ui';
import { AccessDenied } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { DeleteSheet, TeamEditor, CatalogCrossLinks } from '@/components/dashboard/catalog-panels';

interface DeleteAsk {
  kind: 'service' | 'professional';
  id: string;
  name: string;
  blocked: boolean;
  entity: any;
}

// ═══════════════════════════════════════════════════════════════
// PROFISSIONAIS — "quem atende"
// Cada profissional tem nome, foto, vínculo com serviços e horário
// (herdado da empresa ou próprio). A distribuição dos agendamentos é
// automática: aqui o dono só diz QUEM existe e QUANDO atende.
// ═══════════════════════════════════════════════════════════════
export default function ProfissionaisPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [pros, setPros] = useState<Professional[]>([]);
  const [rules, setRules] = useState<Availability[]>([]);
  const [refs, setRefs] = useState<{ services: string[]; professionals: string[] }>({ services: [], professionals: [] });
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState('');
  const [askDelete, setAskDelete] = useState<DeleteAsk | null>(null);
  // 403 nesta tela → aviso amigável (o usuário continua logado).
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Profissionais' });
    if (!res.ok) {
      setDenied(res.status === 403);
      setLoaded(true);
      return;
    }
    const d = res.data || {};
    setPros(d.professionals || []);
    setRules(d.availability || []);
    setRefs(d.bookingRefs || { services: [], professionals: [] });
    setDenied(false);
    setLoaded(true);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function call(action: string, payload: Record<string, any>) {
    setMsg('');
    const res = await apiSend('/api/catalog', 'POST', { businessId, action, ...payload }, { scope: 'action', area: 'Profissionais' });
    if (!res.ok) throw new Error(res.message || 'Não foi possível salvar.');
    await load();
    setMsg('Salvo.');
    setTimeout(() => setMsg(''), 2500);
  }

  function ask(kind: DeleteAsk['kind'], entity: any) {
    const blocked = kind === 'service'
      ? refs.services.includes(entity.id)
      : refs.professionals.includes(entity.id);
    setAskDelete({ kind, id: entity.id, name: entity.name, blocked, entity });
  }

  async function doDelete() {
    if (!askDelete) return;
    try {
      await call(askDelete.kind === 'service' ? 'service.delete' : 'professional.delete', { id: askDelete.id });
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setAskDelete(null);
    }
  }

  async function doDeactivate() {
    if (!askDelete) return;
    try {
      const p = askDelete.entity;
      await call('professional.save', { id: p.id, name: p.name, role: p.role, photo: p.photo, active: false });
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setAskDelete(null);
    }
  }

  const header = (
    <PageHeader
      icon="users"
      title="Profissionais"
      hint="Quem atende no seu negócio. Cada um tem agenda própria e aparece na página pública."
    />
  );

  if (denied) {
    return (
      <>
        {header}
        <AccessDenied area="Profissionais" />
      </>
    );
  }

  return (
    <>
      {header}

      {loaded && <CatalogCrossLinks businessId={businessId} current="/profissionais" />}

      {/* Acesso do profissional (P2): o vínculo login↔profissional é feito em
          Equipe. Quem tem vínculo vê SOMENTE a própria agenda (regra do
          servidor). Aqui só deixamos o caminho visível. */}
      {loaded && (
        <Notice tone="info" className="mb-4" title="Um profissional que atende precisa de login?">
          Crie o acesso em{' '}
          <Link href={`/equipe?b=${businessId}`} className="font-semibold underline">Equipe</Link>{' '}
          e vincule ao profissional — ele passa a ver somente a própria agenda, com os clientes da unidade.
        </Notice>
      )}

      {msg && <Notice tone="info" className="mb-4">{msg}</Notice>}
      {!loaded && <ListSkeleton rows={3} />}

      {loaded && (
        <SubCard className="mb-4 p-4 text-sm text-[var(--text-muted)]">
          <strong className="text-[var(--text)]">A distribuição dos agendamentos é automática:</strong>{' '}
          o cliente nunca escolhe profissional. Você só cadastra quem atende; a agenda equilibra a equipe
          sozinha, respeitando horários, vínculos com serviços e pausas.
        </SubCard>
      )}

      {loaded && (
        <TeamEditor businessId={businessId} pros={pros} rules={rules} onSave={call} onAskDelete={(p) => ask('professional', p)} />
      )}

      {askDelete && (
        <DeleteSheet
          name={askDelete.name}
          kindLabel="profissional"
          blocked={askDelete.blocked}
          onDeactivate={doDeactivate}
          onConfirm={doDelete}
          onClose={() => setAskDelete(null)}
        />
      )}
    </>
  );
}
