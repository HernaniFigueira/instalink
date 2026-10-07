'use client';
// ═══════════════════════════════════════════════════════════════
// 403 AMIGÁVEL — o usuário continua logado
// ═══════════════════════════════════════════════════════════════
// Regra definitiva (lib/http.ts): 403 NUNCA desloga, NUNCA limpa token,
// NUNCA manda para /login. Estas três peças garantem a mensagem amigável:
//
//   <AccessDenied/>      → rota inteira sem permissão (403 de área);
//   <ForbiddenToasts/>   → aviso global para qualquer 403 de ação;
//   useForbiddenNotice() → mensagem inline dentro de uma tela específica.
//
// O erro cru da API nunca é exibido: o texto vem das mensagens canônicas.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { onForbidden, type ForbiddenDetail } from '@/lib/client-auth';
import { PERMISSION_MESSAGES, deniedInfo, type DeniedContext } from '@/lib/http';
import { Button, Notice, ToastViewport, useToasts } from '@/components/ui';

/**
 * Destino de volta do 403 — derivado do CATÁLOGO (firstAllowedPath) e injetado
 * pelo DashboardShell. Nenhuma tela precisa saber (ou chutar) para onde mandar
 * quem não tem acesso: se o shell existe, existe uma porta de volta; fora do
 * painel (sem Provider) o botão simplesmente não aparece.
 */
const PanelHomeContext = createContext<string>('');

export function PanelHomeProvider({ home, children }: { home: string; children: React.ReactNode }) {
  return <PanelHomeContext.Provider value={home}>{children}</PanelHomeContext.Provider>;
}

/** 'Voltar para o início' do 403 (vazio = fora do painel). */
export function usePanelHome(): string {
  return useContext(PanelHomeContext);
}

/** Aviso de 403 para uma ÁREA do painel (acesso direto pela URL). */
export function AccessDenied({ area, hint, homeHref }: {
  area?: string;
  hint?: string;
  /** Opcional: fora dele, usa o destino que o shell derivou do catálogo. */
  homeHref?: string;
}) {
  const info = deniedInfo({ scope: 'area', area });
  const panelHome = usePanelHome();
  const backHref = homeHref || panelHome;
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg" role="status" aria-live="polite">
      <div className="px-5 py-8 text-center max-w-md mx-auto">
        <span className="mx-auto w-11 h-11 rounded-lg bg-[var(--warning-bg)] border border-[var(--warning-border)] text-[var(--warning-fg)] flex items-center justify-center">
          <Icon n="lock" size={20} />
        </span>
        <h1 className="gd-t-section text-[var(--text)] mt-3">{info.title}</h1>
        <p className="gd-t-body text-[var(--text-muted)] mt-1.5">
          {hint || (area
            ? `Seu perfil atual não inclui a área “${area}”. Você continua conectado — se precisar desse acesso, fale com o administrador da empresa.`
            : 'Você continua conectado. Se precisar desse acesso, fale com o administrador da empresa.')}
        </p>
        {backHref && (
          <Link href={backHref} className="mt-4 inline-block"><Button variant="primary" size="sm">Voltar para o início</Button></Link>
        )}
      </div>
    </div>
  );
}

/**
 * Mensagem inline de permissão (ação bloqueada dentro de uma tela).
 *
 * DS 1.1 · §12 — é um aviso de CONTEXTO LOCAL: fica onde a ação foi negada, com
 * a superfície canônica (`Notice`) e os tokens de warning do DS. O `amber-*` do
 * Tailwind que existia aqui era cor de página, não do sistema. Peso leve: só
 * anuncia e some quando a pessoa mandar — não bloqueia, não vira modal.
 */
export function PermissionNotice({ message, hint, onDismiss }: {
  message?: string;
  hint?: string;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <Notice tone="warning" icon="lock" onDismiss={onDismiss} dismissLabel="Fechar aviso" live className="mb-3">
      <span className="block font-semibold">{message}</span>
      {hint && <span className="mt-0.5 block font-normal opacity-90">{hint}</span>}
    </Notice>
  );
}

/**
 * Toast global de 403: qualquer chamada negada no painel mostra a mensagem
 * amigável e some sozinha. A sessão permanece intacta.
 *
 * DS 1.1 · §12/§14 — a confirmação transitória usa a pilha canônica do DS
 * (`useToasts` + `ToastViewport`, superfície `.gd-toast`): mesmo canto, mesma
 * tipografia, mesmo botão de fechar de qualquer outro aviso do produto. A cor
 * `amber-*` e o `zinc-*` locais saíram — nada de alerta com identidade própria.
 */
export function ForbiddenToasts({ context }: { context?: DeniedContext }) {
  const { toasts, push, dismiss } = useToasts();
  const seenRef = useRef<Map<string, number>>(new Map());

  const emitir = useCallback((detail: ForbiddenDetail) => {
    const info = deniedInfo(context || {}, detail.message);
    push({
      tone: 'warning',
      title: info.title,
      message: [info.hint, 'Você continua conectado.'].filter(Boolean).join(' '),
    });
  }, [context, push]);

  // §8–10 — barreira extra contra "loop de toasts": o mesmo caminho não
  // repete aviso em 30s (revalidação/polling/múltiplos cliques). O disparo
  // principal já é só de AÇÕES (lib/client-auth.ts).
  useEffect(() => onForbidden((detail) => {
    const now = Date.now();
    const key = detail.path || 'unknown';
    const last = seenRef.current.get(key) || 0;
    if (now - last < 30000) return;
    seenRef.current.set(key, now);
    emitir(detail);
  }), [emitir]);

  return <ToastViewport toasts={toasts} onDismiss={dismiss} autoDismissMs={6000} />;
}

/**
 * Hook para telas que querem mostrar o 403 no próprio corpo (além do toast).
 * `notice.title` é sempre uma mensagem canônica — nunca o erro cru.
 */
export function useForbiddenNotice(area?: string) {
  const [notice, setNotice] = useState<{ title: string; hint: string } | null>(null);

  useEffect(() => onForbidden((detail) => {
    const info = deniedInfo({ scope: 'action', area }, detail.message);
    setNotice({ title: info.title, hint: info.hint });
  }), [area]);

  const dismiss = useCallback(() => setNotice(null), []);
  return { notice, dismiss, setNotice };
}

/**
 * Carregamento de área com tratamento de 403/erro — evita o "skeleton infinito"
 * quando o usuário não tem permissão (o caso clássico: a API responde 403, a
 * tela não recebe dados e continua carregando para sempre).
 *
 * REGRA FINAL (missão de consolidação §8–10) — dois papéis, nunca misturados:
 *
 *   report(res)         → request PRINCIPAL da área. Um 403 aqui PROMOVE a
 *                         negação da tela inteira (`denied`), porque a página
 *                         realmente não tem como mostrar nada.
 *   reportFeature(res)  → request SECUNDÁRIA (apoio a uma feature). Um 403
 *                         aqui NUNCA promove a negação da área: a tela apenas
 *                         esconde ou desabilita a feature correspondente. A
 *                         página permitida continua mostrando o que pode.
 *
 * Uso:
 *   const { denied, failed, report, reportFeature } = useAreaLoad('Equipe');
 *   const res = await apiGet(url, { scope: 'area', area: 'Equipe' });
 *   if (!report(res)) return;            // 403/falha → nada de setar dados
 *   setData(res.data);
 *   ...
 *   if (denied) return <AccessDenied area="Equipe" />;
 *
 * Em 403 a sessão permanece intacta: nenhuma chamada aqui limpa token nem
 * redireciona para /login (isso é exclusivo do 401, em lib/client-auth.ts).
 */
export function useAreaLoad(area: string) {
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState('');

  const report = useCallback((res: { ok: boolean; status: number; message?: string }) => {
    if (res.ok) {
      setDenied(false);
      setFailed('');
      return true;
    }
    if (res.status === 403) setDenied(true);
    else setFailed(res.message || `Não foi possível carregar ${area}.`);
    return false;
  }, [area]);

  /**
   * Request SECUNDÁRIA: o retorno diz se a feature recebeu dados, mas o
   * estado da ÁREA não muda — um 403 aqui é "só esta feature não está
   * disponível para o seu perfil", nunca "você não tem acesso a esta área".
   * Erros de rede/500 de apoio também não derrubam a página (a feature
   * aparece vazia/oculta; o dado principal continua de pé).
   */
  const reportFeature = useCallback((res: { ok: boolean }) => res.ok, []);

  const reset = useCallback(() => { setDenied(false); setFailed(''); }, []);

  return { denied, failed, report, reportFeature, reset, area };
}

export { PERMISSION_MESSAGES };

/** A failed request is neither an empty list nor an endless skeleton. */
export function AreaLoadError({ area, message, onRetry }: { area: string; message: string; onRetry: () => void | Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  return <section role="alert" className="rounded-lg border border-[var(--danger-border)] bg-[var(--surface)] p-6 space-y-3">
    <h2 className="font-semibold">Não foi possível carregar {area.toLocaleLowerCase('pt-BR')}</h2>
    <p className="text-sm text-[var(--text-muted)]">{message} Nenhum dado foi apagado. Sua sessão foi preservada.</p>
    <Button variant="secondary" disabled={retrying} onClick={async () => { setRetrying(true); try { await onRetry(); } finally { setRetrying(false); } }}>{retrying ? 'Tentando…' : 'Tentar novamente'}</Button>
  </section>;
}
