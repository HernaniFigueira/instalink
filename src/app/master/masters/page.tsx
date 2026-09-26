'use client';
import { useCallback, useEffect, useState } from 'react';
import { ListSkeleton } from '@/components/ui';

interface MasterRow {
  id: string; name: string; email: string; createdAt: string; lastLoginAt: string;
  masterSource?: 'role' | 'env' | null;
}

export default function MasterMastersPage() {
  const [rows, setRows] = useState<MasterRow[] | null>(null);
  const [envOnly, setEnvOnly] = useState<MasterRow[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/master/masters')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setRows(d.masters);
          setEnvOnly(d.envOnlyMasters || []);
        } else setError('Falha ao carregar.');
      })
      .catch(() => setError('Falha ao carregar.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addMaster(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`Confirma adicionar/promover Master para ${email}?`)) return;
    setBusy(true); setError(''); setMsg('');
    try {
      const res = await fetch('/api/master/masters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password, confirm: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Falha.');
      setMsg(d.action === 'created'
        ? `Master criado: ${d.email}. A senha não é exibida — use a que você definiu.`
        : `Master promovido: ${d.email}.`);
      setEmail(''); setName(''); setPassword('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(m: MasterRow) {
    if (rows && rows.length <= 1) {
      setError('Não é possível remover o último Master da plataforma.');
      return;
    }
    if (!confirm(`Remover privilégio Master de ${m.email}? O acesso cai imediatamente (sessões invalidadas).`)) return;
    setBusy(true); setError(''); setMsg('');
    try {
      const res = await fetch('/api/master/masters', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: m.id, confirm: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Falha.');
      setMsg(`Privilégio Master removido de ${d.email}.`);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Masters</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">
        Contas Master do GoDoutor. Não pertencem a Organizations. Ações críticas exigem confirmação e vão para a auditoria.
        O último Master não pode ser removido.
      </p>

      {error && <p className="mb-4 text-sm font-semibold bg-red-600 text-white rounded-xl px-4 py-3">{error}</p>}
      {msg && <p className="mb-4 text-sm font-semibold bg-emerald-600 text-white rounded-xl px-4 py-3">{msg}</p>}

      <section className="bg-white border border-zinc-200 rounded-xl p-5 mb-5 max-w-xl">
        <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 mb-3">Adicionar / promover Master</p>
        <form onSubmit={addMaster} className="space-y-3">
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-500">E-MAIL</span>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="block w-full mt-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm" placeholder="pessoa@seudominio.com" />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-500">NOME (opcional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="block w-full mt-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-500">SENHA (obrigatória só se o e-mail ainda não existir)</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8}
              className="block w-full mt-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              placeholder="mín. 8 caracteres — nunca exibida depois" autoComplete="new-password" />
          </label>
          <button disabled={busy} className="text-sm font-bold bg-zinc-900 text-white px-5 py-2.5 rounded-xl disabled:opacity-50">
            {busy ? 'Salvando…' : 'Confirmar e adicionar'}
          </button>
        </form>
      </section>

      {!rows ? <ListSkeleton rows={3} /> : rows.length === 0 ? (
        <p className="bg-white border border-zinc-200 rounded-xl text-center py-12 text-sm text-zinc-500">
          Nenhum Master com <code className="font-mono">role=master</code> no banco. Use o formulário acima ou o bootstrap CLI.
        </p>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-100">
          {rows.map((m) => (
            <div key={m.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm">{m.name || '—'}</p>
                <p className="text-xs text-zinc-500">{m.email}</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  role=master · criado {(m.createdAt || '').slice(0, 10)}
                  {m.lastLoginAt ? ` · último acesso ${m.lastLoginAt.slice(0, 16).replace('T', ' ')}` : ' · nunca acessou'}
                </p>
              </div>
              <button onClick={() => revoke(m)} disabled={busy || (rows.length <= 1)}
                title={rows.length <= 1 ? 'Não é possível remover o último Master' : 'Remover privilégio Master'}
                className="text-xs font-bold bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg disabled:opacity-40">
                Remover Master
              </button>
            </div>
          ))}
        </div>
      )}

      {envOnly.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-5 mt-5">
          <p className="text-xs font-extrabold uppercase tracking-wider text-amber-800 mb-2">
            Fallback MASTER_EMAILS (sem role=master)
          </p>
          <p className="text-xs text-amber-900 mb-3">
            Estes usuários autenticam como Master via env, mas <strong>não</strong> contam na proteção do último Master
            e não têm role persistente. Promova-os (formulário acima) para gravar <code className="font-mono">role=master</code>,
            ou remova o e-mail de <code className="font-mono">MASTER_EMAILS</code>.
          </p>
          <ul className="space-y-2">
            {envOnly.map((m) => (
              <li key={m.id} className="text-sm flex flex-wrap gap-2 items-baseline">
                <span className="font-bold">{m.name || '—'}</span>
                <span className="text-xs text-amber-900">{m.email}</span>
                <span className="text-[10px] font-extrabold bg-amber-200 text-amber-950 px-2 py-0.5 rounded-full">ENV ONLY</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
