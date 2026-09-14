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
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { onForbidden, type ForbiddenDetail } from '@/lib/client-auth';
import { PERMISSION_MESSAGES, deniedInfo, type DeniedContext } from '@/lib/http';

/** Aviso de 403 para uma ÁREA do painel (acesso direto pela URL). */
export function AccessDenied({ area, hint, homeHref }: {
  area?: string;
  hint?: string;
  homeHref?: string;
}) {
  const info = deniedInfo({ scope: 'area', area });
  return (
    <div className="bg-white border border-zinc-200 rounded-lg" role="status" aria-live="polite">
      <div className="px-5 py-8 text-center max-w-md mx-auto">
        <span className="mx-auto w-11 h-11 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center">
          <Icon n="lock" size={20} />
        </span>
        <h1 className="text-base font-semibold text-zinc-900 mt-3">{info.title}</h1>
        <p className="text-sm text-zinc-500 mt-1.5">
          {hint || (area
            ? `Seu perfil atual não inclui a área “${area}”. Você continua conectado — se precisar desse acesso, fale com o administrador da empresa.`
            : 'Você continua conectado. Se precisar desse acesso, fale com o administrador da empresa.')}
        </p>
        {homeHref && (
          <Link href={homeHref} className="mt-4 inline-flex text-xs font-semibold bg-zinc-900 text-white px-3.5 py-2 rounded-md">
            Voltar para o início
          </Link>
        )}
      </div>
    </div>
  );
}

/** Mensagem inline de permissão (ações bloqueadas dentro de uma tela). */
export function PermissionNotice({ message, hint, onDismiss }: {
  message?: string;
  hint?: string;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="mb-3 flex items-start gap-2.5 border border-amber-200 bg-amber-50 rounded-md px-3 py-2.5" role="status" aria-live="polite">
      <Icon n="lock" size={15} className="text-amber-700 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-amber-900">{message}</p>
        {hint && <p className="text-[11px] text-amber-800 mt-0.5">{hint}</p>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Fechar aviso" className="text-amber-700 hover:text-amber-900 shrink-0">
          <Icon n="x" size={13} />
        </button>
      )}
    </div>
  );
}

interface Toast extends ForbiddenDetail {
  key: number;
  title: string;
  hint: string;
}

let toastSeq = 0;

/**
 * Toast global de 403: qualquer chamada negada no painel mostra a mensagem
 * amigável e some sozinha. A sessão permanece intacta.
 */
export function ForbiddenToasts({ context }: { context?: DeniedContext }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((detail: ForbiddenDetail) => {
    const info = deniedInfo(context || {}, detail.message);
    const key = ++toastSeq;
    setToasts((list) => [...list.slice(-2), { ...detail, key, title: info.title, hint: info.hint }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.key !== key)), 6000);
  }, [context]);

  useEffect(() => onForbidden(push), [push]);

  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2 max-w-sm" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className="flex items-start gap-2.5 bg-white border border-amber-300 rounded-lg shadow-sm px-3.5 py-3">
          <Icon n="lock" size={16} className="text-amber-600 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-zinc-900">{t.title}</p>
            {t.hint && <p className="text-[11px] text-zinc-500 mt-0.5 break-words">{t.hint}</p>}
            <p className="text-[10px] text-zinc-400 mt-1">Você continua conectado.</p>
          </div>
          <button onClick={() => setToasts((list) => list.filter((x) => x.key !== t.key))} aria-label="Fechar aviso" className="text-zinc-400 hover:text-zinc-700 shrink-0">
            <Icon n="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
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
 * Uso:
 *   const { denied, failed, report } = useAreaLoad('Equipe');
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

  const reset = useCallback(() => { setDenied(false); setFailed(''); }, []);

  return { denied, failed, report, reset, area };
}

export { PERMISSION_MESSAGES };
