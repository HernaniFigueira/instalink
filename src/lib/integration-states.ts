// ═══════════════════════════════════════════════════════════════
// ESTADOS CANÔNICOS DE INTEGRAÇÃO — uma palavra por estado (GODOUTOR final)
// ═══════════════════════════════════════════════════════════════
// Cada integração/canal fala a MESMA língua em toda a interface:
//
//   needs_configuration → "Precisa configurar"  (nada conectado ainda)
//   testing             → "Em teste"            (validando com o provedor)
//   ready               → "Pronto"              (conectado e usable)
//   degraded            → "Atenção"             (funciona, mas requer ação)
//   failed              → "Com falha"           (o provedor devolveu erro)
//   unavailable         → "Indisponível"        (o recurso não existe aqui)
//
// Enquanto o estado não chegou do servidor, a UI mostra SKELETON — nunca um
// estado falso. Os DETALHES específicos (ex.: "Falta registrar o número")
// continuam sendo a linha secundária; o selo é sempre o rótulo canônico.

export type CanonicalIntegrationState =
  | 'needs_configuration' | 'testing' | 'ready' | 'degraded' | 'failed' | 'unavailable';

export interface CanonicalStateView {
  label: string;
  /** Família de cor do design system (nunca hex aqui). */
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}

export const CANONICAL_INTEGRATION_STATES: Record<CanonicalIntegrationState, CanonicalStateView> = {
  needs_configuration: { label: 'Precisa configurar', tone: 'neutral' },
  testing: { label: 'Em teste', tone: 'warning' },
  ready: { label: 'Pronto', tone: 'success' },
  degraded: { label: 'Atenção', tone: 'warning' },
  failed: { label: 'Com falha', tone: 'danger' },
  unavailable: { label: 'Indisponível', tone: 'neutral' },
};

/** Estado bruto de conexão usado pelos conectores (whatsapp-onboarding). */
export type RawConnectionStatus = 'not_connected' | 'pending' | 'connected' | 'error';

/**
 * Traduz o estado bruto do conector para o estado canônico.
 * `blocking` marca o pending que exige AÇÃO do usuário (registro/coexistência)
 * — funciona, mas não está saudável: "Atenção", não "Em teste".
 */
export function canonicalIntegrationState(
  status: RawConnectionStatus,
  opts: { blocking?: boolean } = {},
): CanonicalIntegrationState {
  if (status === 'connected') return 'ready';
  if (status === 'error') return 'failed';
  if (status === 'pending') return opts.blocking ? 'degraded' : 'testing';
  return 'needs_configuration';
}

/** Selo canônico (rótulo + tom) de um estado bruto. */
export function canonicalStateView(
  status: RawConnectionStatus,
  opts: { blocking?: boolean } = {},
): CanonicalStateView {
  return CANONICAL_INTEGRATION_STATES[canonicalIntegrationState(status, opts)];
}
