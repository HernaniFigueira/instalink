'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Availability, Professional } from '@/lib/types';
import { Button, ListSkeleton, Notice, PageHeader, SubCard } from '@/components/ui';
import { AccessDenied } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { DeleteSheet, TeamEditor, CatalogCrossLinks } from '@/components/dashboard/catalog-panels';
import { MemberAccessSheet } from '@/components/dashboard/MemberAccessSheet';

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
  // A3.4 · 2.1 — "Profissional criado" não cria login em silêncio: a tela
  // oferece criar o acesso AGORA (já vinculado a este professionalId) ou
  // deixar para depois.
  const [justCreated, setJustCreated] = useState<{ id: string; name: string } | null>(null);
  // A3.4 · 2.1/2.2 — acesso ao sistema aberto a partir do profissional.
  const [access, setAccess] = useState<{ professionalId: string; name: string } | null>(null);
  const [team, setTeam] = useState<Array<{ id: string; name: string; role: string; active: boolean; userId: string; photo?: string; linkedUserName?: string }>>([]);
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
    // A3.4: o estado REAL de acesso vem de /api/team (a lista de profissionais
    // traz `userId`, mas a verdade do vínculo mora lá). Falha aqui não derruba
    // a tela de catálogo.
    const t = await apiGet<any>(`/api/team?businessId=${businessId}`, { scope: 'area', area: 'Profissionais' });
    if (t.ok) setTeam(t.data?.professionals || []);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function call(action: string, payload: Record<string, any>): Promise<any> {
    setMsg('');
    const res = await apiSend<any>('/api/catalog', 'POST', { businessId, action, ...payload }, { scope: 'action', area: 'Profissionais' });
    if (!res.ok) throw new Error(res.message || 'Não foi possível salvar.');
    await load();
    setMsg('Salvo.');
    setTimeout(() => setMsg(''), 2500);
    return res.data || {};
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

      {/* A3.4 — Profissionais × Equipe: uma linha, não um bloco didático. Cada
          linha da lista diz se a pessoa tem acesso e oferece a ação certa. */}
      {loaded && (
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Profissionais são <strong className="text-[var(--text)]">quem atende</strong> — a maioria não precisa de login.
          Quem entra no sistema é gerenciado em{' '}
          <Link href={`/equipe?b=${businessId}`} className="font-semibold underline">Equipe</Link>.
        </p>
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
        <TeamEditor
          businessId={businessId}
          pros={pros}
          rules={rules}
          onSave={call}
          onAskDelete={(p) => ask('professional', p)}
          onCreated={(id, name) => setJustCreated({ id, name })}
          onManageAccess={(p) => {
            // Já tem login → Equipe focada NESSE membro (deep-link estável).
            // Sem login → o fluxo de acesso abre aqui, já vinculado.
            if (p.userId) window.location.assign(`/equipe?b=${encodeURIComponent(businessId)}&professionalId=${encodeURIComponent(p.id)}`);
            else setAccess({ professionalId: p.id, name: p.name });
          }}
        />
      )}

      {/* A3.4 · 2.1 — depois de criar: "Profissional criado" + escolha explícita.
          Nada de criar User/BusinessMember em silêncio. */}
      {justCreated && (
        <SubCard className="mt-4 p-4" role="status">
          <p className="text-sm font-semibold text-[var(--text)]">Profissional criado</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            <strong className="text-[var(--text)]">{justCreated.name}</strong> já pode receber agendamentos.
            Precisa de login no painel?
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button variant="primary" size="sm" onClick={() => { setAccess({ professionalId: justCreated.id, name: justCreated.name }); setJustCreated(null); }}>
              Criar acesso agora
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setJustCreated(null)}>Fazer depois</Button>
          </div>
        </SubCard>
      )}

      {/* Acesso ao sistema a partir do profissional: /api/team grava o vínculo. */}
      <MemberAccessSheet
        open={!!access}
        businessId={businessId}
        professionals={team.length > 0 ? team : pros.map((p) => ({ id: p.id, name: p.name, role: p.role || '', active: p.active !== false, userId: p.userId || '', photo: p.photo || '' }))}
        professionalId={access?.professionalId || ''}
        initialName={access?.name || ''}
        onClose={() => setAccess(null)}
        onCreated={(message) => { setMsg(message); setJustCreated(null); void load(); setTimeout(() => setMsg(''), 6000); }}
      />

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
