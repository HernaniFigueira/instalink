// ═══════════════════════════════════════════════════════════════
// F3-G · MessagingProvider — contrato compartilhado de canais
// ═══════════════════════════════════════════════════════════════
// WhatsApp é UM provider. Inbox/Agent/Automações falam com
// MessagingService → MessagingProvider. NUNCA com a Graph API direto.
// O provedor NÃO devolve payload Meta bruto para a UI.

export type MessagingProviderId = 'whatsapp_cloud' | 'simulator';

/** Status canônico de envio (não confundir com MessageStatus do domínio). */
export type MessagingSendStatus =
  | 'accepted'   // API aceitou; temos providerMessageId (não = delivered)
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'awaiting_channel'  // canal não conectado
  | 'template_required' // fora da janela de freeform
  | 'template_not_configured'
  | 'blocked';          // política (marketing sem consentimento etc.)

export interface MessagingResult {
  ok: boolean;
  provider: MessagingProviderId | string;
  /** wamid (Meta) ou uuid do simulador; '' quando falhou. */
  providerMessageId: string;
  status: MessagingSendStatus;
  errorCode?: string | number;
  /** Mensagem amigável para UI — nunca token/payload sensível. */
  errorMessage?: string;
  /** Transitorio? (retry limitado) */
  retryable?: boolean;
  /** Código de política quando barrou. */
  policyCode?: string;
}

export interface SendTextParams {
  businessId: string;
  to: string; // telefone normalizado (dígitos + DDI)
  body: string;
  /** Força template quando política exigir (senão o serviço decide). */
  forceTemplate?: boolean;
}

export interface SendTemplateParams {
  businessId: string;
  to: string;
  templateName: string;
  language?: string;
  components?: unknown[];
}

export interface SendInteractiveParams {
  businessId: string;
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
}

export interface ConnectionStatusView {
  provider: MessagingProviderId | string;
  status: 'connected' | 'configuring' | 'disconnected' | 'error' | 'simulator';
  detail?: string;
  /** IDs públicos apenas — nunca token. */
  phoneNumberId?: string;
  displayPhoneNumber?: string;
}

/**
 * Contrato de canal. Implementações: WhatsAppCloudProvider, SimulatorProvider.
 * Resultado SEMPRE normalizado (sem JSON cru da Meta).
 */
export interface MessagingProvider {
  id: string;
  getConnectionStatus(businessId: string): ConnectionStatusView | Promise<ConnectionStatusView>;
  sendText(params: SendTextParams): Promise<MessagingResult>;
  sendTemplate(params: SendTemplateParams): Promise<MessagingResult>;
  sendInteractive(params: SendInteractiveParams): Promise<MessagingResult>;
}

/** Entrada normalizada de inbound Meta → nosso modelo. */
export interface NormalizedInboundMessage {
  provider: 'whatsapp' | string;
  providerMessageId: string;
  from: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'unsupported_media' | 'unsupported' | string;
  text?: string;
  interactiveReply?: { id?: string; title?: string; kind?: 'button_reply' | 'list_reply' };
  media?: { mimeType?: string; mediaId?: string; kind?: string };
  contactName?: string;
}
