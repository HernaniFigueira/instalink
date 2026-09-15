'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { MemberRole, PermissionId } from '@/lib/types';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';

interface RoleDef { id: MemberRole; label: string; hint: string; permissions: PermissionId[] }
interface PermDef { id: PermissionId; label: string; hint: string }
interface Member { id: string; userId: string; name: string; email: string; role: MemberRole; permissions: Record<PermissionId, boolean>; active: boolean; note: string; createdAt: string; lastLoginAt: string; professionalId?: string; professionalName?: string; }
interface ProfessionalOption { id: string; name: string; role: string; active: boolean; userId: string; linkedUserName: string }
interface TeamData {
  roles: RoleDef[]; permissions: PermDef[];
  me: { userId: string; role: MemberRole | 'MASTER'; isOwner: boolean; permissions: Record<PermissionId, boolean> };
  owner: { userId: string; name: string; email: string; role: MemberRole } | null;
  members: Member[];
  professionals?: ProfessionalOption[];
}

const input = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900';

export default function EquipePage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [data, setData] = useState<TeamData | null>(null);
  const [creating, setCreating] = useState(false);
  const [drawer, setDrawer] = useState<Member | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  // VÍNCULO User → Professional (P2): o login passa a representar um
  // profissional da unidade e vê SOMENTE a própria agenda (regra aplicada no
  // backend). Fica no mesmo lugar em que se criam acessos.
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'SECRETARIA' as MemberRole, note: '', professionalId: '' });
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

  async function create() {
    setError(''); setMsg('');
    const res = await apiSend<{ linkedExistingUser?: boolean }>('/api/team', 'POST', { businessId, ...form }, { scope: 'action', area: 'Equipe' });
    const d = res.data || {};
    if (!res.ok) { setError(res.message); return; }
    setMsg(d.linkedExistingUser ? 'Acesso liberado — pessoa já tinha login e agora faz parte da equipe.' : 'Acesso criado. Envie e-mail e senha para /login.');
    setCreating(false);
    setForm({ name: '', email: '', password: '', role: 'SECRETARIA', note: '', professionalId: '' });
    load();
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
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-base font-semibold">Equipe</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Quem acessa o painel — contas, papéis e permissões.</p>
        </div>
        <button onClick={() => setCreating(true)} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Icon n="plus" size={14} /> Adicionar membro</button>
      </div>

      {/* Profissionais × Equipe: conceitos separados, nunca confundidos.
          Aqui é acesso administrativo; quem ATENDE mora em /profissionais. */}
      <div className="mb-4 text-xs text-zinc-600 bg-white border border-zinc-200 rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong>Sem confusão:</strong>
        <span>aqui você gerencia <strong>quem tem login</strong> no painel (dono, recepcionista, gerente).</span>
        <a href={`/profissionais?b=${businessId}`} className="font-semibold text-zinc-900 underline">Quem realiza os atendimentos → Profissionais</a>
      </div>
      {msg && <p className="mb-3 text-sm font-medium bg-zinc-900 text-white rounded-md px-3 py-2">{msg}</p>}
      {error && <p className="mb-3 text-sm font-medium bg-red-600 text-white rounded-md px-3 py-2">{error}</p>}

      <div className="bg-white border border-zinc-200">
        <div className="px-4 py-2.5 border-b border-zinc-200 flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Membros · {data.members.length + 1}</p>
          <span className="text-xs text-zinc-400 hidden sm:inline">Clique para gerenciar</span>
        </div>
        {/* Proprietário — linha enxuta */}
        <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_140px_100px] gap-2 px-4 py-3 border-b border-zinc-100 bg-zinc-50/50 items-center">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-bold shrink-0">{(data.owner?.name || 'P').slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{data.owner?.name} <span className="text-xs font-semibold bg-zinc-900 text-white px-1.5 py-0.5 rounded ml-1">PROPRIETÁRIO</span></p>
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
                <span className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0', m.active ? 'bg-white border border-zinc-200 text-zinc-700' : 'bg-zinc-100 text-zinc-400')}>
                  {(m.name || '?').slice(0, 1).toUpperCase()}
                </span>
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

      {/* Drawer lateral — permissões agrupadas */}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawer(null)} />
          <div className="relative w-full sm:max-w-[420px] bg-white h-full overflow-y-auto border-l border-zinc-200 shadow-xl">
            <div className="sticky top-0 bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">{drawer.name}</p>
                <p className="text-xs text-zinc-500">{drawer.email}</p>
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
                    <button key={r.id} onClick={() => { saveMember(drawer, { role: r.id }); setDrawer({ ...drawer, role: r.id }); }} className={cn('text-xs font-medium px-3 py-2 rounded-md border text-left', drawer.role === r.id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50')}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              {(data.professionals || []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Profissional vinculado</p>
                  <select
                    value={drawer.professionalId || ''}
                    onChange={(e) => linkProfessional(drawer, e.target.value)}
                    aria-label="Profissional vinculado a este acesso"
                    className={input}
                  >
                    <option value="">Nenhum — acesso administrativo</option>
                    {(data.professionals || []).map((p) => (
                      <option key={p.id} value={p.id} disabled={!!p.userId && p.userId !== drawer.userId}>
                        {p.name}{p.role ? ` · ${p.role}` : ''}{p.userId && p.userId !== drawer.userId ? ` (vinculado a ${p.linkedUserName})` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-zinc-500 mt-1.5">
                    Ao vincular, este login passa a ver <strong>somente a própria agenda</strong> — os clientes da unidade continuam acessíveis.
                    Quem atende é cadastrado em <a href={`/profissionais?b=${businessId}`} className="underline font-medium">Profissionais</a>.
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
                <p className="text-xs text-zinc-500 mt-2">Inclui <strong>Dashboard</strong> como permissão independente — desative para ocultar o resumo de quem não precisa.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCreating(false)} />
          <div className="relative w-full sm:max-w-md bg-white rounded-lg border border-zinc-200 max-h-[90vh] overflow-y-auto shadow-lg">
            <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
              <p className="font-semibold text-sm">Novo acesso</p>
              <button onClick={() => setCreating(false)} className="p-1.5 hover:bg-zinc-100 rounded-md"><Icon n="x" size={14} /></button>
            </div>
            <div className="px-4 py-4 space-y-3">
              <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Nome *</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input + ' mt-1'} placeholder="Ana Souza" /></label>
              <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">E-mail *</span><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input + ' mt-1'} placeholder="ana@clinica.com" /></label>
              <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Senha inicial *</span><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={input + ' mt-1'} type="text" placeholder="mín. 6 caracteres" /></label>
              <div>
                <span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Papel</span>
                <div className="grid grid-cols-2 gap-1.5 mt-1">
                  {data.roles.filter((r) => r.id !== 'OWNER').map((r) => (
                    <button key={r.id} onClick={() => setForm({ ...form, role: r.id })} className={cn('text-xs font-medium px-3 py-2 rounded-md border', form.role === r.id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200')}>{r.label}</button>
                  ))}
                </div>
              </div>
              {(data.professionals || []).length > 0 && (
                <label className="block">
                  <span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Profissional vinculado</span>
                  <select value={form.professionalId} onChange={(e) => setForm({ ...form, professionalId: e.target.value })} className={input + ' mt-1'}>
                    <option value="">Nenhum — acesso administrativo</option>
                    {(data.professionals || []).filter((p) => !p.userId).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.role ? ` · ${p.role}` : ''}</option>
                    ))}
                  </select>
                  <span className="block text-[11px] text-zinc-500 mt-1">Vincule para que este login veja somente a própria agenda.</span>
                </label>
              )}
              <label className="block"><span className="text-xs font-semibold tracking-wide uppercase text-zinc-500">Observação</span><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={input + ' mt-1'} placeholder="Opcional" /></label>
              {error && <p className="text-sm font-medium text-red-600">{error}</p>}
              <button onClick={create} className="w-full font-semibold bg-zinc-900 text-white py-2.5 rounded-md">Criar acesso</button>
            </div>
          </div>
        </div>
      )}
      <p className="sr-only">{q}</p>
    </>
  );
}
