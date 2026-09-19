'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Avatar, Badge, Button, Notice, PageHeader, PageSkeleton, Select } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { MemberRole, PermissionId } from '@/lib/types';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { MemberAccessSheet } from '@/components/dashboard/MemberAccessSheet';

interface RoleDef { id: MemberRole; label: string; hint: string; permissions: PermissionId[] }
interface PermDef { id: PermissionId; label: string; hint: string }
interface Member { id: string; userId: string; name: string; email: string; role: MemberRole; permissions: Record<PermissionId, boolean>; active: boolean; note: string; createdAt: string; lastLoginAt: string; professionalId?: string; professionalName?: string; professionalPhoto?: string }
interface ProfessionalOption { id: string; name: string; role: string; active: boolean; userId: string; photo?: string; linkedUserName: string }
interface TeamData {
  roles: RoleDef[]; permissions: PermDef[];
  me: { userId: string; role: MemberRole | 'MASTER'; isOwner: boolean; permissions: Record<PermissionId, boolean> };
  owner: { userId: string; name: string; email: string; role: MemberRole } | null;
  members: Member[];
  professionals?: ProfessionalOption[];
}

export default function EquipePage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [data, setData] = useState<TeamData | null>(null);
  // A3.4 — "Criar acesso" é UM componente compartilhado (MemberAccessSheet):
  // aberto daqui ou de /profissionais, o efeito é o mesmo (/api/team grava o
  // vínculo Professional.userId). Nada de dois formulários de acesso.
  const [creating, setCreating] = useState(false);
  const [presetProfessionalId, setPresetProfessionalId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [drawer, setDrawer] = useState<Member | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [linkMsg, setLinkMsg] = useState('');

  // 403 aqui não pode virar "carregando para sempre": mostramos o aviso e o
  // usuário continua logado (somente 401 inicia o fluxo de login).
  const { denied, report } = useAreaLoad('Equipe');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<TeamData>(`/api/team?businessId=${businessId}`, { scope: 'area', area: 'Equipe' });
    if (!report(res)) return;
    setData(res.data);
  }, [businessId, report]);
  useEffect(() => { load(); }, [load]);

  // Deep-link (A3.4): #/equipe?member=<id> abre o membro; ?professionalId=<id>
  // abre "Criar acesso" já vinculado. É o alvo estável do CTA "Gerenciar
  // acesso" lá em Profissionais — um link que continua valendo depois do F5.
  useEffect(() => {
    if (!data) return;
    const memberId = params.get('member') || '';
    const proId = params.get('professionalId') || '';
    if (memberId) {
      const m = data.members.find((x) => x.id === memberId);
      if (m) setDrawer(m);
    } else if (proId) {
      const pro = data.professionals?.find((x) => x.id === proId);
      if (pro && !pro.userId) openAccess(pro.id, pro.name);
      else if (pro?.userId) {
        const m = data.members.find((x) => x.professionalId === proId);
        if (m) setDrawer(m);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, params]);

  function openAccess(professionalId = '', name = '') {
    setError('');
    setPresetProfessionalId(professionalId);
    setPresetName(name);
    setCreating(true);
  }
  async function saveMember(m: Member, payload: Record<string, any>) {
    setError('');
    const res = await apiSend('/api/team', 'PATCH', { businessId, id: m.id, ...payload }, { scope: 'action', area: 'Equipe' });
    if (!res.ok) { setError(res.message); return; }
    if (drawer?.id === m.id) setDrawer({ ...drawer, ...payload, permissions: payload.permissions ? { ...drawer.permissions, ...payload.permissions } : drawer.permissions, role: payload.role || drawer.role, active: payload.active ?? drawer.active });
    load();
  }
  async function linkProfessional(m: Member, professionalId: string) {
    setError(''); setLinkMsg('');
    const res = await apiSend('/api/team', 'PATCH', { businessId, id: m.id, professionalId }, { scope: 'action', area: 'Equipe' });
    if (!res.ok) { setError(res.message); return; }
    const pro = (data?.professionals || []).find((p) => p.id === professionalId);
    setDrawer((cur) => (cur && cur.id === m.id
      ? { ...cur, professionalId, professionalName: pro?.name || '' }
      : cur));
    setLinkMsg(professionalId ? 'Vínculo salvo: este login vê somente a própria agenda.' : 'Vínculo removido.');
    setTimeout(() => setLinkMsg(''), 4000);
    load();
  }

  async function remove(m: Member) {
    setError('');
    const res = await apiSend(`/api/team?businessId=${businessId}&id=${m.id}`, 'DELETE', undefined, { scope: 'action', area: 'Equipe' });
    if (!res.ok) { setError(res.message); return; }
    setDrawer(null);
    load();
  }

  if (denied) return <AccessDenied area="Equipe" />;
  if (!data) return <PageSkeleton />;
  const q = `?b=${businessId}`;
  const roleLabel = (r: string) => data.roles.find((x) => x.id === r)?.label || r;

  return (
    <>
      <PageHeader
        icon="users"
        title="Equipe"
        hint="Quem acessa o painel — contas, papéis e permissões."
        action={<Button variant="primary" size="sm" onClick={() => openAccess()}><Icon n="plus" size={14} /> Adicionar membro</Button>}
      />

      {/* Profissionais × Equipe: conceitos separados, nunca confundidos.
          A3.4: uma linha, não um bloco didático — a própria tela mostra as duas
          populações (acessos × profissionais sem acesso) e isso explica sozinho. */}
      <p className="text-xs text-[var(--text-muted)] mb-4">
        <strong className="text-[var(--text)]">Equipe</strong> controla quem entra no sistema.{' '}
        <Link href={`/profissionais?b=${businessId}`} className="font-semibold underline">Profissionais</Link>{' '}
        controla quem realiza os atendimentos — nem todo profissional precisa de login.
      </p>
      {msg && <Notice tone="info" className="mb-3">{msg}</Notice>}
      {error && <Notice tone="error" className="mb-3">{error}</Notice>}

      <div className="bg-white border border-zinc-200">
        <div className="px-4 py-2.5 border-b border-zinc-200 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Pessoas com acesso · {data.members.length + 1}</p>
          <span className="text-xs text-zinc-400 hidden sm:inline">Clique para gerenciar</span>
        </div>
        {/* Proprietário — linha enxuta */}
        <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_140px_100px] gap-2 px-4 py-3 border-b border-zinc-100 bg-zinc-50/50 items-center">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={data.owner?.name || 'Proprietário'} size={32} />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{data.owner?.name} <Badge tone="blue" className="ml-1">Proprietário</Badge></p>
              <p className="text-xs text-zinc-500 truncate">{data.owner?.email}</p>
            </div>
          </div>
          <span className="hidden sm:block text-xs font-medium text-zinc-600">Acesso total</span>
          <span className="text-xs text-zinc-400">—</span>
        </div>
        {/* Tabela de membros — linhas, não cards */}
        <div className="hidden sm:grid grid-cols-[1fr_140px_90px_80px] gap-2 px-4 py-2 border-b border-zinc-100 bg-zinc-50 text-xs font-semibold tracking-wide uppercase text-zinc-500">
          <span>Nome</span><span>Função</span><span>Status</span><span className="text-right">Ações</span>
        </div>
        <div className="divide-y divide-zinc-100">
          {data.members.map((m) => (
            <div key={m.id} className="px-4 py-3 flex sm:grid sm:grid-cols-[1fr_140px_90px_80px] gap-2 items-center hover:bg-zinc-50">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {/* A3.4: quando o acesso representa um profissional, a foto vem
                    do PROFESSIONAL — a mesma pessoa não aparece com foto numa
                    tela e com inicial genérica na outra. */}
                <Avatar name={m.name} src={m.professionalPhoto || undefined} size={32} />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{m.name}</p>
                  <p className="text-xs text-zinc-500 truncate">{m.email}</p>
                  <div className="sm:hidden flex gap-1.5 mt-1">
                    <span className="text-xs bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded">{roleLabel(m.role)}</span>
                    {!m.active && <span className="text-xs bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-0.5 rounded">Inativo</span>}
                  </div>
                </div>
              </div>
              <span className="hidden sm:block text-sm text-zinc-700">
                {roleLabel(m.role)}
                {m.professionalId && <span className="block text-[11px] text-zinc-500">Agenda: {m.professionalName || 'própria'}</span>}
              </span>
              <span className="hidden sm:block">{m.active ? <span className="text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">Ativo</span> : <span className="text-xs font-medium bg-zinc-100 border border-zinc-200 text-zinc-500 px-2 py-0.5 rounded-full">Inativo</span>}</span>
              <div className="flex items-center gap-1 justify-end shrink-0">
                <button onClick={() => setDrawer(m)} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md hover:bg-zinc-50">Gerenciar</button>
              </div>
            </div>
          ))}
          {data.members.length === 0 && <p className="text-sm text-zinc-500 px-4 py-8 text-center">Nenhum membro além do proprietário.</p>}
        </div>
      </div>
      <p className="text-xs text-zinc-500 mt-3">Cada pessoa entra em <Link href="/login" className="underline font-medium">/login</Link> com o próprio e-mail.</p>

      {/* ── PROFISSIONAIS SEM ACESSO (A3.4) ──
          Quem atende e ainda não tem login. A foto é a REAL do Professional:
          a pergunta "quem é essa pessoa?" se responde olhando. */}
      {(() => {
        const semAcesso = (data.professionals || []).filter((p) => !p.userId && p.active !== false);
        if (semAcesso.length === 0) return null;
        return (
          <div className="mt-6 bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide uppercase text-[var(--text-muted)]">
                Profissionais sem acesso · {semAcesso.length}
              </p>
              <Link href={`/profissionais?b=${businessId}`} className="text-xs font-semibold underline text-[var(--text-muted)]">Ver todos</Link>
            </div>
            <div className="divide-y divide-[var(--border-soft)]">
              {semAcesso.map((p) => (
                <div key={p.id} className="px-4 py-3 flex items-center gap-3">
                  <Avatar name={p.name} src={p.photo || undefined} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{p.role || 'Profissional'}</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => openAccess(p.id, p.name)}>
                    Criar acesso
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Drawer lateral — permissões agrupadas */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-[var(--overlay)]" onClick={() => setDrawer(null)} />
          <div className="relative w-full sm:max-w-[420px] bg-white h-full overflow-y-auto border-l border-zinc-200 shadow-xl">
            <div className="sticky top-0 bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar name={drawer.name} src={drawer.professionalPhoto || undefined} size={32} />
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{drawer.name}</p>
                  <p className="text-xs text-zinc-500 truncate">{drawer.email}</p>
                </div>
              </div>
              <button onClick={() => setDrawer(null)} className="p-1.5 hover:bg-zinc-100 rounded-md"><Icon n="x" size={16} /></button>
            </div>
            <div className="p-4 space-y-5">
              <div className="flex items-center gap-2">
                <button onClick={() => saveMember(drawer, { active: !drawer.active })} className={`text-xs font-semibold px-3 py-1.5 rounded-md border ${drawer.active ? 'bg-white border-zinc-200' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>{drawer.active ? 'Desativar' : 'Ativar'}</button>
                <button onClick={() => remove(drawer)} className="text-xs font-semibold text-red-600 px-3 py-1.5 rounded-md hover:bg-red-50">Remover</button>
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Papel</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {data.roles.filter((r) => r.id !== 'OWNER').map((r) => (
                    <button key={r.id} onClick={() => { saveMember(drawer, { role: r.id }); setDrawer({ ...drawer, role: r.id }); }} className={cn('text-xs font-medium px-3 py-2 rounded-md border text-left', drawer.role === r.id ? 'bg-[var(--brand-soft)] border-[var(--brand-border)] text-[var(--brand-fg)]' : 'bg-white border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)]')}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              {(data.professionals || []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Profissional vinculado</p>
                  <Select
                    value={drawer.professionalId || ''}
                    onChange={(e) => linkProfessional(drawer, e.target.value)}
                    aria-label="Profissional vinculado a este acesso"
                  >
                    <option value="">Nenhum — acesso administrativo</option>
                    {(data.professionals || []).map((p) => (
                      <option key={p.id} value={p.id} disabled={!!p.userId && p.userId !== drawer.userId}>
                        {p.name}{p.role ? ` · ${p.role}` : ''}{p.userId && p.userId !== drawer.userId ? ` (vinculado a ${p.linkedUserName})` : ''}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-zinc-500 mt-1.5">
                    Ao vincular, este login passa a ver <strong>somente a própria agenda</strong> — os clientes da unidade continuam acessíveis.
                    Quem atende é cadastrado em <Link href={`/profissionais?b=${businessId}`} className="underline font-medium">Profissionais</Link>.
                  </p>
                  {linkMsg && <p className="text-xs font-medium text-emerald-700 mt-1" role="status">{linkMsg}</p>}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Permissões</p>
                <div className="space-y-1.5">
                  {data.permissions.map((p) => {
                    const on = drawer.permissions[p.id];
                    return (
                      <label key={p.id} className={cn('flex items-center justify-between gap-3 px-3 py-2 rounded-md border cursor-pointer', on ? 'bg-zinc-50 border-zinc-200' : 'bg-white border-zinc-100')}>
                        <span>
                          <span className="block text-sm font-medium">{p.label}</span>
                          <span className="block text-xs text-zinc-500">{p.hint}</span>
                        </span>
                        <input type="checkbox" checked={!!on} onChange={() => { const v = !on; saveMember(drawer, { permissions: { [p.id]: v } }); setDrawer({ ...drawer, permissions: { ...drawer.permissions, [p.id]: v } }); }} className="w-4 h-4 accent-zinc-900" />
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-zinc-500 mt-2">Inclui <strong>Início</strong> como permissão independente — desative para ocultar o resumo de quem não precisa.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Criar/gerenciar acesso — componente COMPARTILHADO com Profissionais. */}
      <MemberAccessSheet
        open={creating}
        businessId={businessId}
        professionals={data.professionals || []}
        professionalId={presetProfessionalId}
        initialName={presetName}
        onClose={() => setCreating(false)}
        onCreated={(message) => { setMsg(message); void load(); }}
      />
      <p className="sr-only">{q}</p>
    </>
  );
}
