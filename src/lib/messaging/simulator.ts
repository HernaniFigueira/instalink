// ═══════════════════════════════════════════════════════════════
// F3-G · SimulatorProvider — NUNCA envia externamente (sem rede)
// ═══════════════════════════════════════════════════════════════
// Homologação de Automation + Agent + Inbox sem Meta.
// Tudo é marcado SIMULADOR; nunca mistura com envio real sem identificação.

import { randomUUID } from 'node:crypto';
import type {
  ConnectionStatusView, MessagingProvider, MessagingResult,
  SendInteractiveParams, SendTemplateParams, SendTextParams,
} from './types';

/** Chamadas de rede feitas pelo simulador — deve ficar 0 em testes. */
export let simulatorNetworkCalls = 0;

export function resetSimulatorNetworkCounter(): void {
  simulatorNetworkCalls = 0;
}

export const SIMULATOR_PROVIDER_ID = 'simulator' as const;

export class SimulatorProvider implements MessagingProvider {
  id = SIMULATOR_PROVIDER_ID;

  getConnectionStatus(): ConnectionStatusView {
    return {
      provider: this.id,
      status: 'simulator',
      detail: 'SIMULADOR — nenhuma mensagem sai para a rede.',
    };
  }

  private accept(kind: string): MessagingResult {
    // Qualquer fetch real aqui seria bug — não usamos fetch.
    return {
      ok: true,
      provider: this.id,
      providerMessageId: `sim-${randomUUID()}`,
      status: 'accepted',
      errorMessage: undefined,
    };
  }

  async sendText(params: SendTextParams): Promise<MessagingResult> {
    void params;
    return this.accept('text');
  }

  async sendTemplate(params: SendTemplateParams): Promise<MessagingResult> {
    void params;
    return this.accept('template');
  }

  async sendInteractive(params: SendInteractiveParams): Promise<MessagingResult> {
    void params;
    return this.accept('interactive');
  }
}

export const simulatorProvider = new SimulatorProvider();
