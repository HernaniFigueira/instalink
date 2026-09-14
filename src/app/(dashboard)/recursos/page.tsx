'use client';
// RECURSOS DA EMPRESA — o painel de módulos.
// Regra do produto: o MÓDULO decide se o recurso existe; a página só decide
// aparência. Aqui o toggle liga/desliga na hora (um por clique, sem "salvar
// tudo") e o feedback explica o efeito. Desativar NUNCA apaga configuração.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { apiGet, apiSend } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface FeatureRow {
  id: string;
  label: string;
  hint: string;
  icon: string;
  group: string;
  disabledHint: string;
  enabled: boolean;
}

const GROUP_HINT: Record<string, string> = {
  Atendimento: 'Como o cliente marca e é atendido',
  Catálogo: 'O que você oferece',
  Conteúdo: 'Prova social e informação',
  Canais: 'Onde a conversa acontece',
};

export default function RecursosPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [rows, setRows] = useState<FeatureRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  // 403 → aviso amigável (sessão preservada), nunca skeleton infinito.
  const { denied, report } = useAreaLoad('Recursos');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<{ features?: FeatureRow[] }>(`/api/businesses/${businessId}/features`, { scope: 'area', area: 'Recursos' });
    if (!report(res)) return;
    setRows(res.data?.features || []);
  }, [businessId, report]);

  useEffect(() => { load(); }, [load]);

  async function toggle(row: FeatureRow) {
    setBusy(row.id);
    setToast(null);
    try {
      const res = await fetch(`/api/businesses/${businessId}/features`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, feature: row.id, enabled: !row.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível atualizar.');
      // Atualização otimista local + confirmação do servidor.
      setRows((rs) => (rs || []).map((r) => (r.id === row.id ? { ...r, enabled: !row.enabled } : r)));
      setToast({ kind: !row.enabled ? 'ok' : 'warn', text: data.effect });
      // A página pública é renderizada no servidor: recarrega para refletir já.
      setTimeout(() => setToast(null), 5000);
    } catch (e: any) {
      setToast({ kind: 'warn', text: e.message });
    } finally {
      setBusy('');
    }
  }

  if (denied) return <AccessDenied area="Recursos" />;
  if (!rows) return <PageSkeleton />;
  const q = `?b=${businessId}`;
  const groups = [...new Set(rows.map((r) => r.group))];
  const activeCount = rows.filter((r) => r.enabled).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recursos da empresa</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Ligue e desligue o que existe no seu negócio. A página pública, o menu e os atalhos obedecem na hora.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-zinc-500 bg-white border border-zinc-200 rounded-full px-3 py-1.5">
            {activeCount} de {rows.length} ativos
          </span>
          <Link href={`/pagina${q}`} className="text-xs font-bold bg-white border border-zinc-200 rounded-md px-3.5 py-2 hover:bg-zinc-50">
            Página
          </Link>
        </div>
      </div>

      {toast && (
        <p className={cn(
          'mb-4 text-sm font-semibold rounded-md px-4 py-3 border',
          toast.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900',
        )}>{toast.text}</p>
      )}

      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group}>
            <div className="flex items-baseline gap-2 mb-2.5">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-400">{group}</h2>
              <span className="text-xs text-zinc-400">{GROUP_HINT[group] || ''}</span>
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {rows.filter((r) => r.group === group).map((row) => (
                <div key={row.id}
                  className={cn(
                    'bg-white rounded-lg border p-4 flex flex-col gap-3 transition-colors',
                    row.enabled ? 'border-emerald-200' : 'border-zinc-200',
                  )}>
                  <div className="flex items-start justify-between gap-3">
                    <span className={cn(
                      'w-10 h-10 rounded-md flex items-center justify-center shrink-0',
                      row.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-400',
                    )}>
                      <Icon n={row.icon} size={20} />
                    </span>
                    {/* Toggle visual: clique = salva imediatamente */}
                    <button
                      onClick={() => toggle(row)}
                      disabled={busy === row.id}
                      role="switch"
                      aria-checked={row.enabled}
                      aria-label={`${row.label}: ${row.enabled ? 'ativo' : 'desativado'}`}
                      className={cn(
                        'relative w-14 h-8 rounded-full transition-colors shrink-0 disabled:opacity-60',
                        row.enabled ? 'bg-emerald-500' : 'bg-zinc-300',
                      )}>
                      <span className={cn(
                        'absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all',
                        row.enabled ? 'left-7' : 'left-1',
                        busy === row.id && 'animate-pulse',
                      )} />
                    </button>
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold flex items-center gap-2">
                      {row.label}
                      <span className={cn(
                        'text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full',
                        row.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-500',
                      )}>
                        {row.enabled ? 'Ativo' : 'Desativado'}
                      </span>
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">{row.hint}</p>
                    {!row.enabled && (
                      <p className="text-[11px] text-amber-700 mt-2 leading-snug">{row.disabledHint}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-8 bg-zinc-900 text-white rounded-lg p-5">
        <p className="font-bold flex items-center gap-2"><Icon n="shield" size={16} /> Como funciona</p>
        <ul className="mt-2 text-sm text-zinc-300 space-y-1.5">
          <li>• <strong>Módulo da empresa</strong> decide se o recurso existe (é o que você liga aqui).</li>
          <li>• <strong>Configuração da página</strong> decide aparência, ordem e conteúdo.</li>
          <li>• Desativar oculta na hora — e <strong>não apaga nada</strong>: textos, fotos, serviços e histórico ficam salvos.</li>
          <li>• Reativar devolve o recurso exatamente como estava configurado.</li>
        </ul>
      </div>
    </>
  );
}
