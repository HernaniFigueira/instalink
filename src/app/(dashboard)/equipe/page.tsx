'use client';
// EQUIPE — logins internos da empresa, com papel e permissões reais.
// A dashboard mostra só o que o membro pode usar; as APIs revalidam tudo.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { MemberRole, PermissionId } from '@/lib/types';

interface RoleDef { id: MemberRole; label: string; hint: string; permissions: PermissionId[] }
interface PermDef { id: PermissionId; label: string; hint: string }
interface Member {
  id: string; userId: string; name: string; email: string; role: MemberRole;
  permissions: Record<PermissionId, boolean>; active: boolean; note: string; createdAt: string; lastLoginAt: string;
}
interface TeamData {
  roles: RoleDef[]; permissions: PermDef[];
  me: { userId: string; role: MemberRole | 'MASTER'; isOwner: boolean; permissions: Record<PermissionId, boolean> };
  owner: { userId: string; name: string; email: string; role: MemberRole } | null;
  members: Member[];
}

const input = 'w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

export default function EquipePage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [data, setData] = useState<TeamData | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'SECRETARIA' as MemberRole, note: '' });
  const [overrides, setOverrides] = useState<Partial<Record<PermissionId, boolean>>>({});

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/team?businessId=${businessId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {});
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setError(''); setMsg('');
    const res = await fetch('/api/team', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, ...form, permissions: overrides }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error); return; }
    setMsg(d.linkedExistingUser
      ? 'Acesso liberado: esta pessoa já tinha login no InstaLink e agora faz parte da sua equipe.'
      : 'Acesso criado. Envie o e-mail e a senha para a pessoa entrar em /login.');
    setCreating(false);
    setForm({ name: '', email: '', password: '', role: 'SECRETARIA', note: '' });
    setOverrides({});
    load();
  }

  async function saveMember(m: Member, payload: Record<string, any>) {
    setError('');
    const res = await fetch('/api/team', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id: m.id, ...payload }),
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error); return; }
    setEditing(null);
    load();
  }

  async function remove(m: Member) {
    setError('');
    const res = await fetch(`/api/team?businessId=${businessId}&id=${m.id}`, { method: 'DELETE' });
    const d = await res.json();
    if (!res.ok) { setError(d.error); return; }
    load();
  }

  if (!data) return <PageSkeleton />;
  const q = `?b=${businessId}`;
  const roleLabel = (r: string) => data.roles.find((x) => x.id === r)?.label || r;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Equipe</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Crie logins e defina o que cada pessoa pode fazer. O menu mostra só o permitido — e as APIs validam o resto.
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          className="text-sm font-bold bg-zinc-900 text-white px-4 py-2.5 rounded-xl hover:bg-zinc-700 inline-flex items-center gap-2">
          <Icon n="plus" size={16} /> Novo acesso
        </button>
      </div>

      {msg && <p className="mb-4 text-sm font-semibold bg-emerald-600 text-white rounded-xl px-4 py-3">{msg}</p>}
      {error && <p className="mb-4 text-sm font-semibold bg-red-600 text-white rounded-xl px-4 py-3">{error}</p>}

      <section className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
        <div className="p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center font-black shrink-0">
            {(data.owner?.name || 'P').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold truncate">{data.owner?.name} <span className="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full ml-1">PROPRIETÁRIO</span></p>
            <p className="text-xs text-zinc-500 truncate">{data.owner?.email}</p>
          </div>
          <span className="text-xs text-zinc-400 font-semibold shrink-0">acesso total</span>
        </div>

        {data.members.map((m) => (
          <div key={m.id} className="p-4">
            <div className="flex items-center gap-3">
              <span className={cn('w-10 h-10 rounded-full flex items-center justify-center font-black shrink-0',
                m.active ? 'bg-zinc-900 text-white' : 'bg-zinc-200 text-zinc-500')}>
                {(m.name || '?').slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold truncate flex items-center gap-2 flex-wrap">
                  {m.name}
                  <span className="text-[10px] font-extrabold bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">{roleLabel(m.role).toUpperCase()}</span>
                  {!m.active && <span className="text-[10px] font-extrabold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">DESATIVADO</span>}
                </p>
                <p className="text-xs text-zinc-500 truncate">
                  {m.email}{m.lastLoginAt ? ` · último acesso ${m.lastLoginAt.slice(0, 10)}` : ' · nunca acessou'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setEditing(editing?.id === m.id ? null : m)}
                  className="text-xs font-bold bg-zinc-100 px-3 py-2 rounded-lg hover:bg-zinc-200">
                  {editing?.id === m.id ? 'Fechar' : 'Permissões'}
                </button>
                <button onClick={() => saveMember(m, { active: !m.active })}
                  className="text-xs font-bold bg-zinc-100 px-3 py-2 rounded-lg hover:bg-zinc-200">
                  {m.active ? 'Desativar' : 'Ativar'}
                </button>
                <button onClick={() => remove(m)} className="text-xs font-bold text-red-600 px-2 py-2 rounded-lg hover:bg-red-50" aria-label={`Remover ${m.name}`}>
                  <Icon n="x" size={14} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {data.permissions.filter((p) => m.permissions[p.id]).map((p) => (
                <span key={p.id} className="text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-100 px-2 py-0.5 rounded-full">{p.label}</span>
              ))}
              {data.permissions.every((p) => !m.permissions[p.id]) && (
                <span className="text-[10px] font-bold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full">Somente resumo</span>
              )}
            </div>
            {editing?.id === m.id && (
              <div className="mt-3 pt-3 border-t border-zinc-100 space-y-3">
                <div>
                  <span className="text-xs font-bold text-zinc-500">PAPEL</span>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {data.roles.filter((r) => r.id !== 'OWNER').map((r) => (
                      <button key={r.id} onClick={() => saveMember(m, { role: r.id })} title={r.hint}
                        className={cn('text-xs font-bold px-3 py-2 rounded-lg border-2', m.role === r.id ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-bold text-zinc-500">PERMISSÕES</span>
                  <div className="grid sm:grid-cols-2 gap-1.5 mt-1.5">
                    {data.permissions.map((p) => {
                      const on = m.permissions[p.id];
                      return (
                        <button key={p.id} title={p.hint}
                          onClick={() => saveMember(m, { permissions: { [p.id]: !on } })}
                          className={cn('text-left text-xs font-bold px-3 py-2 rounded-lg border-2', on ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-400')}>
                          {on ? '✓ ' : '— '}{p.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-2">Desativar/ativar volta ao padrão do papel. O proprietário nunca perde acesso.</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>

      <p className="text-xs text-zinc-500 mt-4">
        Cada pessoa entra em <Link href="/login" className="underline font-semibold">/login</Link> com o próprio e-mail.
        Ao entrar, ela vê apenas as telas e ações permitidas e só acessa as empresas das quais faz parte.
      </p>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setCreating(false)} />
          <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white/95 backdrop-blur px-5 py-4 flex items-center justify-between border-b border-zinc-100">
              <p className="font-bold text-lg">Novo acesso</p>
              <button onClick={() => setCreating(false)} className="font-bold text-zinc-400 p-2 inline-flex" aria-label="Fechar"><Icon n="x" size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <label className="block"><span className="text-xs font-bold text-zinc-500">NOME *</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input + ' mt-1'} placeholder="Ex: Ana Souza" /></label>
              <label className="block"><span className="text-xs font-bold text-zinc-500">E-MAIL *</span>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input + ' mt-1'} inputMode="email" placeholder="ana@clinica.com" /></label>
              <label className="block"><span className="text-xs font-bold text-zinc-500">SENHA INICIAL *</span>
                <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={input + ' mt-1'} type="text"
                  placeholder="mínimo 6 caracteres" />
                <span className="text-[11px] text-zinc-500">Se a pessoa já tiver login no InstaLink, ela é vinculada sem trocar a senha.</span></label>
              <div>
                <span className="text-xs font-bold text-zinc-500">PAPEL</span>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {data.roles.filter((r) => r.id !== 'OWNER').map((r) => (
                    <button key={r.id} onClick={() => setForm({ ...form, role: r.id })} title={r.hint}
                      className={cn('text-xs font-bold px-3 py-2 rounded-lg border-2', form.role === r.id ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-zinc-200 text-zinc-500')}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block"><span className="text-xs font-bold text-zinc-500">OBSERVAÇÃO (OPCIONAL)</span>
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={input + ' mt-1'} placeholder="Ex: Secretária — recepção" /></label>
              {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
              <button onClick={create} className="w-full font-bold bg-zinc-900 text-white py-3 rounded-xl">Criar acesso</button>
            </div>
          </div>
        </div>
      )}
      <p className="sr-only">{q}</p>
    </>
  );
}
