// ═══════════════════════════════════════════════════════════════
// P6 — CATÁLOGO DE CANAIS, FONTES E INTEGRAÇÕES TÉCNICAS
// ═══════════════════════════════════════════════════════════════
// Fonte ÚNICA da verdade sobre o que existe e o que JÁ FUNCIONA. A regra de
// honestidade do produto vale aqui:
//
//   • `canConnect: true`  → a unidade pode conectar AGORA: endpoint real,
//     token real, evento real entregue ao P4. É o que a interface oferece.
//   • `canConnect: false` → o conector ainda NÃO existe. A interface mostra
//     "Disponível em breve" e o motivo, e a API RECUSA a criação
//     (`provider_unavailable`) — nada de fingir integração.
//
// Nenhuma credencial mora aqui: credenciais de canais oficiais ficam em
// variáveis de ambiente (padrão já usado pelo P3 em `src/lib/whatsapp.ts`).
import type {
  ExternalEventName, IntegrationDirection, IntegrationKind, IntegrationProviderId, SafeIntegration,
} from '../types';

export interface ProviderDef {
  provider: IntegrationProviderId;
  kind: IntegrationKind;
  label: string;
  hint: string;
  /** true = a unidade consegue conectar hoje (fluxo real, ponta a ponta). */
  canConnect: boolean;
  /** Motivo honesto quando ainda não é possível conectar. */
  unavailableReason?: string;
  direction: IntegrationDirection;
  /** Eventos externos que este provedor produz (entrada). */
  events: ExternalEventName[];
  /** Evento padrão quando a origem manda payload cru ('' = exige envelope). */
  defaultEvent: ExternalEventName | '';
  /** Conector NATIVO da plataforma ainda pendente (o caminho por webhook já vale). */
  nativePending?: boolean;
  /** Passo a passo curto mostrado na interface. */
  setupHint?: string;
}

const LEAD_EVENTS: ExternalEventName[] = ['lead.created', 'lead.updated', 'form.submitted'];

export const PROVIDERS: ProviderDef[] = [
  // ── CANAIS (conversa) ────────────────────────────────────────
  {
    provider: 'whatsapp', kind: 'channel', label: 'WhatsApp',
    hint: 'Conversas do WhatsApp na caixa do InstaLink e envio pelo canal oficial.',
    canConnect: true,
    setupHint: 'Configure o WhatsApp Cloud API no painel do negócio ou via Master.',
    direction: 'both', events: ['message.received'], defaultEvent: '',
    nativePending: false,
  },
  {
    provider: 'instagram', kind: 'channel', label: 'Instagram',
    hint: 'Mensagens diretas e comentários do Instagram.',
    canConnect: false,
    unavailableReason: 'A API do Instagram (mensagens e comentários) chega no P6.1.',
    direction: 'both', events: ['message.received'], defaultEvent: '',
    nativePending: true,
  },
  {
    provider: 'messenger', kind: 'channel', label: 'Facebook / Messenger',
    hint: 'Conversas da página do Facebook.',
    canConnect: false,
    unavailableReason: 'A API do Messenger chega no P6.2.',
    direction: 'both', events: ['message.received'], defaultEvent: '',
    nativePending: true,
  },
  {
    provider: 'telegram', kind: 'channel', label: 'Telegram',
    hint: 'Bot do Telegram para atendimento e avisos.',
    canConnect: false,
    unavailableReason: 'O bot do Telegram chega no P6.2.',
    direction: 'both', events: ['message.received'], defaultEvent: '',
    nativePending: true,
  },

  // ── FONTES (origem do lead) ──────────────────────────────────
  {
    provider: 'form', kind: 'source', label: 'Formulário',
    hint: 'Formulário do seu site ou de um sistema externo.',
    canConnect: true, direction: 'in', events: LEAD_EVENTS, defaultEvent: 'form.submitted',
    setupHint: 'Aponte o formulário para o endpoint gerado (ou use o n8n/Zapier no meio) — nome, telefone, e-mail e mensagem já são reconhecidos.',
  },
  {
    provider: 'landing_page', kind: 'source', label: 'Landing page',
    hint: 'Página de campanha com formulário próprio.',
    canConnect: true, direction: 'in', events: LEAD_EVENTS, defaultEvent: 'lead.created',
    setupHint: 'Envie os dados do visitante para o endpoint gerado; a origem fica registrada no lead.',
  },
  {
    provider: 'paid_traffic', kind: 'source', label: 'Tráfego pago',
    hint: 'Leads de campanhas (Meta/Google) que chegam por integração.',
    canConnect: true, direction: 'in', events: LEAD_EVENTS, defaultEvent: 'lead.created',
    nativePending: true,
    setupHint: 'Hoje por webhook (a plataforma de anúncios envia o lead para o endpoint). O conector nativo de Lead Ads entra depois.',
  },
  {
    provider: 'qrcode', kind: 'source', label: 'QR Code',
    hint: 'QR do InstaLink apontando para a sua página.',
    canConnect: false,
    unavailableReason: 'O QR Code já é gerado pelo InstaLink e leva à sua página: a origem aparece no CRM quando o visitante se cadastra. Não há nada para conectar aqui.',
    direction: 'in', events: LEAD_EVENTS, defaultEvent: 'lead.created',
  },
  {
    provider: 'public_page', kind: 'source', label: 'Página pública do InstaLink',
    hint: 'A sua página, com formulário e agendamento.',
    canConnect: false,
    unavailableReason: 'A captação pela sua página já é nativa do InstaLink (CRM + analytics). A lista de origens aqui é informativa.',
    direction: 'in', events: LEAD_EVENTS, defaultEvent: 'lead.created',
  },

  // ── INTEGRAÇÕES TÉCNICAS (transporte) ────────────────────────
  {
    provider: 'inbound_webhook', kind: 'technical', label: 'Webhook de entrada',
    hint: 'Um sistema externo envia eventos no formato canônico do InstaLink.',
    canConnect: true, direction: 'in',
    events: ['lead.created', 'lead.updated', 'contact.created', 'contact.updated', 'form.submitted'],
    defaultEvent: '',
    setupHint: 'POST no endpoint gerado com `Authorization: Bearer <token>`. Aceita envelope canônico ou payload cru de lead.',
  },
  {
    provider: 'n8n', kind: 'technical', label: 'n8n',
    hint: 'Workflow do n8n manda o lead para o InstaLink.',
    canConnect: true, direction: 'in', events: LEAD_EVENTS, defaultEvent: 'lead.created',
    setupHint: 'No n8n, use um nó HTTP Request (POST) para o endpoint gerado, com o token no header Authorization.',
  },
  {
    provider: 'external_api', kind: 'technical', label: 'API de sistema externo',
    hint: 'Seu ERP/CRM/plataforma empurrando dados para o InstaLink.',
    canConnect: true, direction: 'in',
    events: ['lead.created', 'lead.updated', 'contact.created', 'contact.updated'],
    defaultEvent: 'lead.created',
    setupHint: 'Envie o envelope canônico (`event`, `externalId`, `contact`, `data`). Documentado em docs/integracoes-p6.md.',
  },
];

export function providerDef(provider: unknown): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.provider === provider);
}

export function isIntegrationProvider(id: unknown): id is IntegrationProviderId {
  return typeof id === 'string' && PROVIDERS.some((p) => p.provider === id);
}

export function providersOfKind(kind: IntegrationKind): ProviderDef[] {
  return PROVIDERS.filter((p) => p.kind === kind);
}

/** Integrações TÉCNICAS de saída são as do P3 (`db.webhooks`) — não duplicar. */
export const OUTBOUND_WEBHOOKS_OWNER = 'lib/webhooks.ts (P3)';

// ═══════════════════════════════════════════════════════════════
// VISÃO DA INTERFACE (catálogo + o que a unidade já conectou)
// ═══════════════════════════════════════════════════════════════
// Uma entrada por provedor, com as conexões da unidade anexadas. É o que a
// tela "Configurações → Canais/Integrações" consome — a interface NUNCA monta
// a lista de provedores por conta própria (fonte única = catálogo).
export interface ProviderView extends ProviderDef {
  /** Conexões da unidade para este provedor (sem segredo nenhum). */
  connections: SafeIntegration[];
}

export function providerView(def: ProviderDef, connections: SafeIntegration[]): ProviderView {
  return { ...def, connections: connections.filter((c) => c.provider === def.provider) };
}

export function providerViews(connections: SafeIntegration[]): ProviderView[] {
  return PROVIDERS.map((def) => providerView(def, connections));
}

export function providerViewsByKind(connections: SafeIntegration[]): Record<IntegrationKind, ProviderView[]> {
  const out: Record<IntegrationKind, ProviderView[]> = { channel: [], source: [], technical: [] };
  for (const def of PROVIDERS) out[def.kind].push(providerView(def, connections));
  return out;
}
