'use client';
// RECURSOS DA EMPRESA — o painel de módulos.
// Regra do produto: o MÓDULO decide se o recurso existe; a página só decide
// aparência. Aqui o toggle liga/desliga na hora (um por clique, sem "salvar
// tudo") e o feedback explica o efeito. Desativar NUNCA apaga configuração.
//
// CONTEXTO DA EMPRESA (causa raiz do antigo "loop de Recursos"):
//   • ?b= continua valendo (contexto explícito/compatibilidade);
//   • sem ?b=, a empresa ativa é resolvida pelo /api/auth/me — a mesma
//     fonte do DashboardShell (useBusinessId);
//   • a API /api/businesses/[id]/features lê o id do PATH (corrigido).
//
// Cada falha tem seu estado próprio — NUNCA "Negócio não encontrado" para
// tudo e NUNCA "Tentar de novo" mascarando contexto:
//   sem empresa   → estado de ausência de empresa (CTA criar negócio);
//   erro de rede  → mensagem de conexão + tentativa que recomeça o ciclo;
//   permissão     → aviso de acesso (sessão preservada);
//   404 real      → o único caso chamado "não encontrado".
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageSkeleton } from '@/components/ui';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
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
  const { businessId, resolving, noBusiness, contextError, retry } = useBusinessId();
  const [rows, setRows] = useState<FeatureRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const [failed, setFailed] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [toast, setToast] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);
  const toastTimer = useRef<number | null>(null);

  // 403 → aviso amigável (sessão preservada), nunca skeleton infinito.
  const { denied, report } = useAreaLoad('Recursos');

  const load = useCallback(async () => {
    if (!businessId) return;
    setFailed('');
    const res = await apiGet<{ features?: FeatureRow[] }>(`/api/businesses/${businessId}/features`, { scope: 'area', area: 'Recursos' });
    if (!report(res)) {
      // Falhou (rede/500/400): mostra erro acionável em vez de carregar para sempre.
      setRows([]);
      setFailed(res.message || 'Não foi possível carregar os recursos.');
      return;
    }
    setRows(res.data?.features || []);
  }, [businessId, report]);

  useEffect(() => { load(); }, [load, attempt]);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  async function toggle(row: FeatureRow) {
    setBusy(row.id);
    setToast(null);
    try {
      const res = await apiSend<{ effect?: string }>('/api/businesses/' + businessId + '/features', 'PATCH', {
        businessId, feature: row.id, enabled: !row.enabled,
      }, { scope: 'action', area: 'Recursos' });
      if (!res.ok) throw new Error(res.message || 'Não foi possível atualizar.');
      // Confirmação pelo servidor (releitura), não só pelo estado local:
      // "salvo" aqui significa relido do banco.
      await load();
      // O shell do painel guarda módulos/permissões em memória; sem este
      // aviso, uma área recém-ativada ainda pareceria "sem acesso" até F5.
      window.dispatchEvent(new Event('il:business-refresh'));
      setToast({ kind: !row.enabled ? 'ok' : 'warn', text: res.data?.effect || (row.enabled ? 'Recurso ocultado.' : 'Recurso ativado.') });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 6000);
    } catch (e: any) {
      setToast({ kind: 'warn', text: e.message });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 8000);
    } finally {
      setBusy('');
    }
  }

  if (denied) return <AccessDenied area="Recursos" />;

  // ── Estados de CONTEXTO (antes de falar de dados) ────────────
  // Sem empresa na conta: não é erro — é um estado com caminho claro.
  if (noBusiness) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg text-center py-12 px-6">
        <span className="mx-auto w-10 h-10 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="store" size={20} /></span>
        <h2 className="font-semibold text-sm mt-3">Nenhuma empresa nesta conta ainda</h2>
        <p className="text-sm text-zinc-500 mt-1 max-w-sm mx-auto">
          Os recursos (agendamentos, serviços, produtos…) pertencem a uma empresa. Crie a sua para ativar o que você precisa.
        </p>
        <Link href="/onboarding" className="mt-4 inline-flex text-xs font-bold bg-zinc-900 text-white px-4 py-2 rounded-md">Criar meu negócio</Link>
      </div>
    );
  }

  // Falha de rede ao resolver o CONTEXTO: a tentativa recomeça o ciclo
  // inteiro (contexto → dados), nunca um retry decorativo no mesmo erro.
  if (contextError) {
    return (
      <div className="bg-white border border-red-200 rounded-lg px-4 py-10 text-center" role="alert">
        <span className="mx-auto w-10 h-10 rounded-md bg-red-50 border border-red-200 text-red-600 flex items-center justify-center"><Icon n="alert" size={18} /></span>
        <p className="text-sm font-medium text-zinc-700 mt-3">Sem conexão com o servidor. Verifique sua internet.</p>
        <button onClick={retry} className="mt-4 text-xs font-bold bg-zinc-900 text-white px-4 py-2 rounded-md">Tentar de novo</button>
      </div>
    );
  }

  // Resolvendo a empresa ativa (sem ?b= na URL): dizemos o que está
  // acontecendo em vez de um skeleton mudo — e isso tem FIM.
  if (resolving || !businessId) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg px-4 py-10 text-center">
        <p className="text-sm text-zinc-500 inline-flex items-center gap-2">
          <span className="w-3.5 h-3.5 border-2 border-zinc-300 border-t-zinc-700 rounded-full animate-spin" />
          Carregando sua empresa…
        </p>
      </div>
    );
  }

  if (rows === null) return <PageSkeleton />;

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
        )} role="status" aria-live="polite">{toast.text}</p>
      )}

      {failed && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-md px-4 py-3 flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm font-medium text-red-800 inline-flex items-center gap-2"><Icon n="alert" size={15} /> {failed}</p>
          <button onClick={() => { setRows(null); setAttempt((a) => a + 1); }}
            className="ml-auto text-xs font-bold bg-white border border-red-200 text-red-700 px-3 py-1.5 rounded-md hover:bg-red-100">
            Tentar de novo
          </button>
        </div>
      )}

      {!failed && rows.length === 0 && (
        <div className="bg-white border border-zinc-200 rounded-lg text-center py-12 px-6">
          <span className="mx-auto w-10 h-10 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="grid" size={20} /></span>
          <h2 className="font-semibold text-sm mt-3">Nenhum recurso disponível ainda</h2>
          <p className="text-sm text-zinc-500 mt-1">Recarregue a página — se o problema continuar, fale com o suporte.</p>
          <button onClick={() => { setRows(null); setAttempt((a) => a + 1); }}
            className="mt-4 text-xs font-bold bg-zinc-900 text-white px-4 py-2 rounded-md">Recarregar</button>
        </div>
      )}

      {!failed && groups.map((group) => (
        <section key={group} className="mb-6 last:mb-0">
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
                  {/* Produtos desligado: o caminho claro para cadastrar nunca
                      some — a ativação é aqui em Recursos (regra do produto). */}
                  {!row.enabled && row.id === 'products' && (
                    <p className="text-[11px] text-zinc-400 mt-2 leading-snug">
                      Ative para cadastrar e exibir a vitrine. Produtos salvos continuam guardados.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

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
