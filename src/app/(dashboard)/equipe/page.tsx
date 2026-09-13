'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { MemberRole, PermissionId } from '@/lib/types';

interface RoleDef { id: MemberRole; label: string; hint: string; permissions: PermissionId[] }
interface PermDef { id: PermissionId; label: string; hint: string }
interface Member { id: string; userId: string; name: string; email: string; role: MemberRole; permissions: Record<PermissionId, boolean>; active: boolean; note: string; createdAt: string; lastLoginAt: string; }
interface TeamData { roles: RoleDef[]; permissions: PermDef[]; me: { userId: string; role: MemberRole | 'MASTER'; isOwner: boolean; permissions: Record<PermissionId, boolean> }; owner: { userId: string; name: string; email: string; role: MemberRole } | null; members: Member[]; }

const input = 'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900';

export default function EquipePage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [data, setData] = useState<TeamData | null>(null);
  const [creating, setCreating] = useState(false);
  const [drawer, setDrawer] = useState<Member | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'SECRETARIA' as MemberRole, note: '' });

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/team?businessId=${businessId}`).then((r) => (r.ok ? r.json() : null)).then((d) => setData(d)).catch(() => {});
  }, [businessId]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setError(''); setMsg('');
    const res = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId, ...form }) });
    const d = await res.json();
    if (!res.ok) { setError(d.error); return; }
    setMsg(d.linkedExistingUser ? 'Acesso liberado — pessoa já tinha login e agora faz parte da equipe.' : 'Acesso criado. Envie e-mail e senha para /login.');
    setCreating(false);
    setForm({ name: '', email: '', password: '', role: 'SECRETARIA', note: '' });
    load();
  }
  async function saveMember(m: Member, payload: Record<string, any>) {
    setError('');
    const res = await fetch('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId, id: m.id, ...payload }) });
    const d = await res.json();
    if (!res.ok) { setError(d.error); return; }
    if (drawer?.id === m.id) setDrawer({ ...drawer, ...payload, permissions: payload.permissions ? { ...drawer.permissions, ...payload.permissions } : drawer.permissions, role: payload.role || drawer.role, active: payload.active ?? drawer.active });
    load();
  }
  async function remove(m: Member) {
    setError('');
    const res = await fetch(`/api/team?businessId=${businessId}&id=${m.id}`, { method: 'DELETE' });
    const d = await res.json();
    if (!res.ok) { setError(d.error); return; }
    setDrawer(null);
    load();
  }

  if (!data) return <PageSkeleton />;
  const q = `?b=${businessId}`;
  const roleLabel = (r: string) => data.roles.find((x) => x.id === r)?.label || r;

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-base font-semibold">Equipe</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Quem pode acessar e o que pode fazer.</p>
        </div>
        <button onClick={() => setCreating(true)} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Icon n="plus" size={14} /> Adicionar membro</button>
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
              <span className="hidden sm:block text-sm text-zinc-700">{roleLabel(m.role)}</span>
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
