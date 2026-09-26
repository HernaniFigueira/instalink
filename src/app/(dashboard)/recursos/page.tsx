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
import { Badge, Button, EmptyState, Notice, PageHeader, PageSkeleton, SubCard, Switch } from '@/components/ui';
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
  const { denied, report } = useAreaLoad('Capacidades do sistema');

  const load = useCallback(async () => {
    if (!businessId) return;
    setFailed('');
    const res = await apiGet<{ features?: FeatureRow[] }>(`/api/businesses/${businessId}/features`, { scope: 'area', area: 'Capacidades do sistema' });
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
      }, { scope: 'action', area: 'Capacidades do sistema' });
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

  // § missão: "Recursos" deixa de ser um conceito principal do usuário. A tela
  // continua a MESMA (`capabilityFlags` intactos, nenhuma rota apagada) — o que
  // muda é como ela se apresenta: capacidades do sistema, dentro de
  // Configurações. O rótulo da porta no catálogo segue "Recursos" de propósito,
  // para não quebrar links salvos nem permissões gravadas.
  if (denied) return <AccessDenied area="Capacidades do sistema" />;

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
        <Link href="/onboarding" className="mt-4 inline-block"><Button variant="primary" size="sm">Criar meu negócio</Button></Link>
      </div>
    );
  }

  // Falha de rede ao resolver o CONTEXTO: a tentativa recomeça o ciclo
  // inteiro (contexto → dados), nunca um retry decorativo no mesmo erro.
  if (contextError) {
    return (
      <div role="alert">
        <EmptyState icon="alert" title="Sem conexão com o servidor"
          hint="Verifique sua internet e tente novamente."
          action={<Button variant="primary" size="sm" onClick={retry}>Tentar de novo</Button>} />
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
      <PageHeader
        icon="grid"
        title="Capacidades do sistema"
        hint="Ligue e desligue o que existe no seu negócio. A página pública, o menu e os atalhos obedecem na hora."
        action={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={activeCount === rows.length ? 'green' : 'zinc'}>{activeCount} de {rows.length} ativos</Badge>
            <Link href={`/pagina${q}`}><Button variant="secondary" size="sm">Página</Button></Link>
          </span>
        }
      />

      {toast && (
        <div role="status" aria-live="polite">
          <Notice tone={toast.kind === 'ok' ? 'success' : 'warning'} className="mb-4">{toast.text}</Notice>
        </div>
      )}

      {failed && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-md px-4 py-3 flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm font-medium text-red-800 inline-flex items-center gap-2"><Icon n="alert" size={15} /> {failed}</p>
          <Button variant="danger" size="xs" className="ml-auto" onClick={() => { setRows(null); setAttempt((a) => a + 1); }}>
            Tentar de novo
          </Button>
        </div>
      )}

      {!failed && rows.length === 0 && (
        <div className="bg-white border border-zinc-200 rounded-lg text-center py-12 px-6">
          <span className="mx-auto w-10 h-10 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="grid" size={20} /></span>
          <h2 className="font-semibold text-sm mt-3">Nenhum recurso disponível ainda</h2>
          <p className="text-sm text-zinc-500 mt-1">Recarregue a página — se o problema continuar, fale com o suporte.</p>
          <Button variant="primary" size="sm" className="mt-4" onClick={() => { setRows(null); setAttempt((a) => a + 1); }}>Recarregar</Button>
        </div>
      )}

      {!failed && groups.map((group) => (
        <section key={group} className="mb-6 last:mb-0">
          <div className="flex items-baseline gap-2 mb-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{group}</h2>
            <span className="text-xs text-zinc-400">{GROUP_HINT[group] || ''}</span>
          </div>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {rows.filter((r) => r.group === group).map((row) => (
              /* A3.3 (ponto 11): card COMPACTO. O estado ativo é indicado pelo
                 ícone, pelo Switch e pelo Badge — nunca por pintar a borda
                 inteira do card de verde. */
              <div key={row.id} className="ws-panel p-3.5 flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span className={cn(
                    'w-9 h-9 rounded-md flex items-center justify-center shrink-0',
                    row.enabled ? 'bg-[var(--success-bg)] text-[var(--success-fg)]' : 'bg-[var(--surface-2)] text-[var(--text-muted)]',
                  )}>
                    <Icon n={row.icon} size={18} />
                  </span>
                  {/* Switch ÚNICO do design system: clique = salva imediatamente */}
                  <span className={cn(busy === row.id && 'animate-pulse')}>
                    <Switch
                      checked={row.enabled}
                      onChange={() => toggle(row)}
                      disabled={busy === row.id}
                      label={`${row.label}: ${row.enabled ? 'ativo' : 'desativado'}`}
                    />
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-[var(--text)] flex flex-wrap items-center gap-2">
                    {row.label}
                    <Badge tone={row.enabled ? 'green' : 'zinc'}>{row.enabled ? 'Ativo' : 'Desativado'}</Badge>
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{row.hint}</p>
                  {!row.enabled && (
                    <p className="text-[11px] text-[var(--warning-fg)] mt-2 leading-snug">{row.disabledHint}</p>
                  )}
                  {/* Produtos desligado: o caminho claro para cadastrar nunca
                      some — a ativação é aqui em Recursos (regra do produto). */}
                  {!row.enabled && row.id === 'products' && (
                    <p className="text-[11px] text-[var(--text-muted)] mt-2 leading-snug">
                      Ative para cadastrar e exibir a vitrine. Produtos salvos continuam guardados.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <SubCard className="mt-6 p-4">
        <p className="font-semibold text-sm text-[var(--text)] flex items-center gap-2 mb-2">
          <Icon n="shield" size={15} className="text-[var(--text-muted)]" /> Como funciona
        </p>
        <ul className="text-sm text-[var(--text-muted)] space-y-1.5">
          <li>• <strong className="text-[var(--text)]">Módulo da empresa</strong> decide se o recurso existe (é o que você liga aqui).</li>
          <li>• <strong className="text-[var(--text)]">Configuração da página</strong> decide aparência, ordem e conteúdo.</li>
          <li>• Desativar oculta na hora — e <strong className="text-[var(--text)]">não apaga nada</strong>: textos, fotos, serviços e histórico ficam salvos.</li>
          <li>• Reativar devolve o recurso exatamente como estava configurado.</li>
        </ul>
      </SubCard>
    </>
  );
}
