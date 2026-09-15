// ═══════════════════════════════════════════════════════════════
// InstaLink.app — Domínio universal (INSTA LINK ENGINE)
// Nenhuma entidade aqui é específica de nicho. Nichos são apenas
// configurações iniciais (templates) sobre este motor genérico.
// ═══════════════════════════════════════════════════════════════

export type ID = string;

// Papel de PLATAFORMA (InstaLink). 'master' = superadmin da plataforma,
// separado de qualquer empresa. Promovido por env MASTER_EMAILS ou script
// (nunca senha secreta no código).
export type UserRole = 'owner' | 'admin' | 'master';

export interface User {
  id: ID;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  role?: UserRole; // ausente = 'owner' (compatível com dados legados)
  lastLoginAt?: string;
}

export interface Session {
  id: ID;
  userId: ID;
  createdAt: string;
  expiresAt: string;
}

// ── Consumidor (conta de quem COMPRA/AGENDA na página pública) ──
// Separado de User (lojista). Um customer vale para todos os negócios.
export interface Customer {
  id: ID;
  name: string;
  phone: string; // só dígitos
  email: string;
  passwordHash: string; // '' quando conta só-Google
  googleId: string;
  avatar: string;
  createdAt: string;
}

export interface CustomerSession {
  id: ID;
  customerId: ID;
  createdAt: string;
  expiresAt: string;
}

// ── Recuperação de senha (lojista e consumidor) ──
export interface PasswordReset {
  id: ID;
  kind: 'user' | 'customer';
  accountId: ID;
  tokenHash: string; // sha256 do token (nunca o token puro)
  expiresAt: string;
  usedAt: string; // '' = ainda válido
  createdAt: string;
}

export type Niche =
  | 'alimentacao' | 'loja' | 'beleza' | 'saude' | 'servicos'
  | 'profissional' | 'educacao' | 'pet' | 'outro';

export const VALID_NICHES: Niche[] = [
  'alimentacao', 'loja', 'beleza', 'saude', 'servicos',
  'profissional', 'educacao', 'pet', 'outro',
];

export type BusinessMode =
  | 'products' | 'services' | 'bookings' | 'orders' | 'quote';

export const VALID_MODES: BusinessMode[] = [
  'products', 'services', 'bookings', 'orders', 'quote',
];

// ── Módulos da empresa (FONTE ÚNICA DE VERDADE) ─────────────
// Regra do produto:
//   MÓDULO DA EMPRESA  → define se o recurso EXISTE/está habilitado
//   CONFIGURAÇÃO DA PÁGINA → define aparência, ordem e conteúdo
// Os 5 modos comerciais (BusinessMode) continuam sendo o armazenamento dos
// módulos comerciais — `featureEnabled()` em lib/features.ts é a única
// função que decide. Módulos opcionais novos ficam em `Business.features`.
export type OptionalFeatureId =
  | 'reviews' | 'faq' | 'gallery' | 'location' | 'whatsapp' | 'about' | 'agent';

export type FeatureId = BusinessMode | OptionalFeatureId;

export const VALID_OPTIONAL_FEATURES: OptionalFeatureId[] = [
  'reviews', 'faq', 'gallery', 'location', 'whatsapp', 'about', 'agent',
];

export interface DayHours { open: string; close: string }

// ── Redes sociais da página pública ─────────────────────────
// Instagram/TikTok continuam sendo campos legados (usuário "@perfil" em
// Business.instagram/tiktok — preservados). `socials` guarda URLs COMPLETOS
// das demais redes (Facebook, YouTube, LinkedIn, site…). Só a configurada
// aparece na página.
export type SocialNetworkId = 'instagram' | 'facebook' | 'youtube' | 'tiktok' | 'linkedin' | 'site';

export const SOCIAL_NETWORKS: Array<{ id: SocialNetworkId; label: string; icon: string; placeholder: string }> = [
  { id: 'instagram', label: 'Instagram', icon: 'instagram', placeholder: '@seuperfil' },
  { id: 'tiktok', label: 'TikTok', icon: 'music', placeholder: '@seuperfil' },
  { id: 'facebook', label: 'Facebook', icon: 'facebook', placeholder: 'https://facebook.com/suapagina' },
  { id: 'youtube', label: 'YouTube', icon: 'youtube', placeholder: 'https://youtube.com/@seucanal' },
  { id: 'linkedin', label: 'LinkedIn', icon: 'linkedin', placeholder: 'https://linkedin.com/company/suaempresa' },
  { id: 'site', label: 'Site / outro link', icon: 'external', placeholder: 'https://seusite.com' },
];

// ── Navegação da página pública (v2: âncora × link externo) ──
// Cada item tem nome, tipo, destino, ativo/inativo e ordem (a ordem é a do
// array). Âncoras rolam para a seção correspondente; links abrem destino
// externo. Negócios legados continuam resolvidos por nav/navCustom.
export type NavItemType = 'anchor' | 'link';

export interface NavItemConfig {
  id: string; // 'services' | 'reviews' | ... âncoras · 'instagram' | 'site' | uid() p/ links
  label: string; // nome exibido (customizável)
  type: NavItemType;
  target: string; // âncora: '#servicos' · link: URL completa
  active: boolean;
}

// ── Configuração universal de agenda do negócio ──
export type TeamMode = 'solo' | 'choosable' | 'auto';

export interface BookingConfig {
  teamMode: TeamMode;
  leadMin: number; // antecedência mínima p/ reservar (minutos)
  cancelUntilMin: number; // consumidor pode cancelar até X min antes
  horizonDays: number; // janela máxima de agendamento (dias)
  bufferMin: number; // intervalo entre atendimentos (minutos)
}

export function defaultBookingConfig(): BookingConfig {
  return { teamMode: 'solo', leadMin: 30, cancelUntilMin: 120, horizonDays: 60, bufferMin: 0 };
}

// Seção "Sobre a empresa" da página pública (conteúdo configurável).
export interface AboutSection {
  title: string;
  text: string;
  image: string;
  enabled: boolean;
}

export interface Organization {
  id: ID;
  name: string;
  ownerId: ID;
  metadata: Record<string, unknown>;
  // Ponte para uma futura presença pública principal da marca. Quando vazio,
  // cada unidade continua usando sua página atual sem mudança de UX.
  publicBusinessId?: ID;
  createdAt: string;
  updatedAt: string;
}

export type OrganizationRole = 'OWNER' | 'ADMIN';
export interface OrganizationMember {
  id: ID;
  organizationId: ID;
  userId: ID;
  role: OrganizationRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Business {
  id: ID;
  ownerId: ID; // legado: preservado para compatibilidade e ownership da unidade
  organizationId?: ID; // organização acima da unidade (normalizado para legados)
  name: string;
  slug: string;
  description: string;
  logo: string;
  cover: string;
  niche: Niche;
  modes: BusinessMode[];
  // Módulos opcionais (avaliações, FAQ, galeria, localização, WhatsApp,
  // Sobre, agente). Preenchido de forma defensiva na leitura (migração
  // idempotente derivada de blocos/página em dados legados).
  features?: Record<OptionalFeatureId, boolean>;
  // Supressão explícita da vitrine (auditoria §4): gravada quando o dono
  // DESLIGA "Produtos" em Recursos. Sem ela, o fallback legado de Pedidos
  // (orders) continuaria exibindo a vitrine mesmo com o módulo desligado —
  // o que quebrava a regra "desativar ⇒ a vitrine some da página". O
  // fallback de orders continua valendo para negócios legados que NUNCA
  // gerenciaram Produtos (productsOff ausente): nada legado apaga/quebra.
  productsOff?: boolean;
  // Integração oficial de WhatsApp (nunca guarda tokens — só identificadores
  // públicos e status; credenciais vivem em variáveis de ambiente).
  whatsappIntegration?: WhatsappIntegration;
  phone: string;
  whatsapp: string;
  email: string;
  instagram: string;
  tiktok: string;
  // Redes ampliadas (URLs completos: Facebook, YouTube, LinkedIn, site…).
  // Instagram/TikTok acima continuam como campos legados (@perfil) — a página
  // resolve os dois e mostra SOMENTE o que está configurado.
  socials?: Partial<Record<SocialNetworkId, string>>;
  address: string;
  mapsUrl: string;
  hours: Record<string, DayHours | null>; // 0=dom .. 6=sab
  paymentMethods: string[]; // pix | card | cash | on_delivery
  pixKey: string;
  deliveryFee: number; // centavos (0 = sem taxa / a combinar)
  minOrder: number; // centavos (0 = mínimo)
  googleUrl: string; // link "avaliar no Google" (place compartilhado)
  googlePlaceId: string; // para importar avaliações (opcional)
  googleApiKey: string; // Places API key do lojista (opcional, SECRETO)
  booking: BookingConfig;
  nav: string[]; // ids habilitados no menu (ordem canônica); usado quando navCustom
  navCustom: boolean; // false = detecção automática (negócios legados)
  // Navegação v2 (âncoras + links externos, com nome/ordem/ativo próprios).
  // Presente ⇒ é a fonte da navegação; ausente ⇒ resolução legada nav/navCustom.
  navItems?: NavItemConfig[];
  // Automações operacionais (confirmação, lembrete, pós-atendimento, avaliação,
  // retorno). Ausente/true = ativa; false = desligada pelo lojista.
  automations?: Record<string, boolean>;
  about: AboutSection; // seção "Sobre a empresa" (título/texto/imagem)
  published: boolean;
  createdAt: string;
  updatedAt: string;
  // Placeholders de evolução (assinatura) — nunca inferidos no cliente.
  subscription?: { status: 'trial' | 'active' | 'past_due' | 'cancelled'; plan: string; since: string };
}

// ── Integração de WhatsApp (estrutura; sem credenciais no banco) ──
export type WhatsappStatus = 'not_connected' | 'pending' | 'connected';

export interface WhatsappIntegration {
  status: WhatsappStatus;
  displayPhone: string; // número público exibido ("+55 11 ...")
  phoneNumberId: string; // identificador da conta (público, não secreto)
  wabaId: string;
  connectedAt: string; // '' quando não conectado
  lastWebhookAt: string; // '' quando nunca recebeu evento
  requestedAt: string; // quando o lojista pediu a conexão
}

// ── DTO público: whitelist explícita do que o visitante pode ver ──
// NUNCA incluir: ownerId, pixKey, googleApiKey, dados internos.
export interface PublicBusiness {
  id: ID;
  name: string;
  slug: string;
  description: string;
  logo: string;
  cover: string;
  niche: Niche;
  modes: BusinessMode[];
  phone: string;
  whatsapp: string;
  email: string;
  instagram: string;
  tiktok: string;
  socials: Partial<Record<SocialNetworkId, string>>; // redes configuradas (URLs completos)
  address: string;
  mapsUrl: string;
  hours: Record<string, DayHours | null>;
  paymentMethods: string[];
  deliveryFee: number; // centavos (preço público)
  minOrder: number; // centavos (regra pública)
  booking: BookingConfig; // regras operacionais públicas (modo equipe, prazos)
  nav: string[]; // ids habilitados no menu (ordem canônica)
  navCustom: boolean; // false = detecção automática
  navItems?: NavItemConfig[]; // navegação v2 (âncoras + links), quando configurada
  about: AboutSection;
  googleUrl: string;
  published: boolean;
  // Módulos efetivos (derivados; nunca incluem recurso desativado).
  features: Record<OptionalFeatureId, boolean>;
  // Supressão explícita da vitrine (dono desligou Produtos em Recursos) —
  // vence o fallback legado de pedidos na página pública (ver lib/features).
  productsOff?: boolean;
  // Aparência/integração — sem segredos (tokens nunca saem do servidor).
  whatsappStatus?: WhatsappStatus;
}

export interface Theme {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  radius: number; // px
  font: 'inter' | 'rounded' | 'serif' | 'mono' | 'sora' | 'space';
  buttonStyle: 'solid' | 'outline' | 'soft';
}

export type BlockType =
  | 'profile' | 'cta' | 'buttons' | 'text' | 'image' | 'gallery'
  | 'products' | 'services' | 'professionals' | 'highlights' | 'booking'
  | 'testimonials' | 'faq' | 'location' | 'instagram' | 'whatsapp' | 'quote' | 'concierge';

export interface Block {
  id: ID;
  type: BlockType;
  order: number;
  enabled: boolean;
  settings: Record<string, any>;
}

export interface Page {
  id: ID;
  businessId: ID;
  presetId?: string; // modelo aplicado ('limao', 'rose'…) — '' = personalizado/legado
  theme: Theme;
  blocks: Block[];
  updatedAt: string;
}

export interface Category {
  id: ID;
  businessId: ID;
  kind: 'product' | 'service';
  name: string;
  order: number;
  active: boolean;
}

export interface Product {
  id: ID;
  businessId: ID;
  categoryId: string;
  name: string;
  description: string;
  image: string;
  price: number; // centavos
  promoPrice: number; // centavos, 0 = sem promo
  active: boolean;
  featured: boolean;
  order: number;
}

export interface ProductOption {
  id: ID;
  businessId: ID;
  productId: ID;
  name: string;
  required: boolean;
  multiple: boolean;
  min: number;
  max: number; // 0 = sem limite
  order: number;
}

export interface ProductOptionValue {
  id: ID;
  optionId: ID;
  name: string;
  priceDelta: number; // centavos
  active: boolean;
}

export interface Service {
  id: ID;
  businessId: ID;
  categoryId: string;
  name: string;
  description: string;
  image: string;
  price: number; // centavos
  // Visibilidade pública do preço. true (padrão/legado) = a página pública
  // mostra o preço. false = o preço continua salvo e visível internamente
  // (painel, agenda, CRM), mas NÃO aparece na página pública nem no assistente.
  showPrice?: boolean;
  durationMin: number; // interna: agenda/conflitos/buffer (nunca pública)
  professionalIds: string[]; // [] = todos os profissionais
  active: boolean;
  featured: boolean;
  bookable: boolean;
  questions: string[]; // até 3, respondidas na reserva (estilo Cal.com)
}

export interface Professional {
  id: ID;
  businessId: ID;
  name: string;
  role: string;
  photo: string;
  active: boolean;
  // Vínculo com o horário geral da empresa (lib/schedule.ts):
  //   true  → HERDA o "Horário da clínica" (padrão ao criar um profissional);
  //   false → usa SOMENTE o próprio horário (personalizado);
  //   ausente → dado legado: derivado na leitura (quem já tinha regras
  //             próprias continua personalizado — nada é sobrescrito).
  followBusinessHours?: boolean;
}

// Regra de disponibilidade. Escopos:
//   professionalId '' → HORÁRIO GERAL DA CLÍNICA (herdado por quem tem
//                       followBusinessHours !== false);
//   professionalId X  → horário PERSONALIZADO daquele profissional (só vale
//                       quando ele NÃO segue o horário da clínica).
export interface Availability {
  id: ID;
  businessId: ID;
  professionalId: string; // '' = horário geral da clínica
  serviceId: string; // '' = todos os serviços
  weekday: number; // 0..6
  start: string; // HH:MM
  end: string; // HH:MM
  slotMin: number;
}

export interface AvailabilityException {
  id: ID;
  businessId: ID;
  date: string; // YYYY-MM-DD
  closed: boolean;
  start: string; // horário especial ('' = dia todo / segue regras)
  end: string;
  note: string; // ex: "Natal", "Folga", "Inventário"
}

// ── Histórico de mudanças de status (auditoria) ──
export interface StatusChange {
  at: string;
  from: string;
  to: string;
  by: 'owner' | 'customer' | 'system' | 'master' | 'agent'; // 'agent' = assistente
  note?: string; // ex: "Reagendado de 09/09 14:00 para 16/09 15:30"
}

export type OrderStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'completed' | 'cancelled';

export interface OrderItem {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
  optionsLabel: string;
  note: string;
}

export interface Order {
  id: ID;
  businessId: ID;
  customerId: string; // '' = guest/legado
  code: string; // ex: #0012
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  type: 'delivery' | 'pickup';
  payment: string;
  items: OrderItem[];
  subtotal: number;
  total: number;
  status: OrderStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
  history: StatusChange[];
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';

export interface Booking {
  id: ID;
  businessId: ID;
  customerId: string; // '' = guest/legado
  serviceId: ID;
  professionalId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  customerName: string;
  customerPhone: string;
  status: BookingStatus;
  note: string;
  answers: string[]; // respostas às questions do serviço
  createdAt: string;
  updatedAt: string;
  history: StatusChange[];
  // Cadeia de reagendamentos: quando um atendimento em estado terminal
  // (concluído/faltou/cancelado) é reagendado, um NOVO agendamento é criado
  // e aponta para o anterior — o histórico antigo nunca é sobrescrito.
  previousId?: string; // id do agendamento de origem
  rescheduleCount?: number; // quantas vezes este atendimento já foi movido
}

export type ReviewSource = 'site' | 'google';
export type ReviewStatus = 'pending' | 'published' | 'hidden';

export interface Review {
  id: ID;
  businessId: ID;
  customerId: string; // '' = importada do Google
  customerName: string;
  rating: number; // 1..5
  text: string;
  source: ReviewSource;
  status: ReviewStatus;
  orderId: string;
  bookingId: string;
  externalId: string; // dedupe da importação (autor-tempo)
  createdAt: string;
}

// ── Contato (relação Customer × Business) ───────────────────
// Um Customer é GLOBAL (uma conta vale para todos os negócios).
// BusinessCustomer/Contact representa "esta pessoa faz parte da base
// deste negócio". Nunca duplicar Customer; upsert por customerId/telefone.
// customerId '' = pessoa conhecida por telefone (legado/guest), sem conta.
export interface BusinessCustomer {
  id: ID;
  businessId: ID;
  customerId: ID; // '' = sem conta vinculada (contato legado)
  name: string;
  phone: string; // só dígitos
  email: string;
  createdAt: string; // quando entrou na base do negócio
  updatedAt: string;
  source: string; // signup | login | google | agendamento | pedido | lead | ...
  lastInteraction: string;
  marketingOptIn: boolean; // base p/ campanhas futuras — NUNCA presumido
  note?: string; // observação interna do CRM (visão 360)
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

export interface Lead {
  id: ID;
  businessId: ID;
  customerId: string; // '' = guest / ainda sem conta vinculada
  name: string;
  phone: string;
  email: string;
  instagram: string;
  origin: string;
  interest: string;
  action: string;
  status: LeadStatus;
  createdAt: string;
  lastInteraction: string;
}

export type EventType =  | 'page_view' | 'button_click' | 'product_view' | 'product_add'
  | 'cart_created' | 'checkout_started' | 'order_created'
  | 'booking_started' | 'booking_created' | 'whatsapp_click'
  | 'lead_created' | 'ai_started' | 'ai_recommendation' | 'conversion';

export interface AnalyticsEvent {
  id: ID;
  businessId: ID;
  type: EventType;
  path: string;
  meta: Record<string, any>;
  createdAt: string;
}

export interface DB {
  users: User[];
  sessions: Session[];
  customers: Customer[];
  customerSessions: CustomerSession[];
  passwordResets: PasswordReset[];
  organizations: Organization[];
  organizationMembers: OrganizationMember[];
  businesses: Business[];
  pages: Page[];
  categories: Category[];
  products: Product[];
  options: ProductOption[];
  optionValues: ProductOptionValue[];
  services: Service[];
  professionals: Professional[];
  availability: Availability[];
  exceptions: AvailabilityException[];
  orders: Order[];
  bookings: Booking[];
  leads: Lead[];
  contacts: BusinessCustomer[];
  reviews: Review[];
  events: AnalyticsEvent[];
  // ── Estruturas novas (aditivas; migração defensiva em db.ts) ──
  members: BusinessMember[]; // logins internos da empresa
  agents: BusinessAgent[]; // agente de atendimento por empresa
  conversations: Conversation[]; // inbox (WhatsApp/agente)
  messages: Message[]; // mensagens das conversas
  campaigns: Campaign[]; // campanhas de marketing (consentimento)
  campaignRecipients: CampaignRecipient[];
  audit: AuditEntry[]; // auditoria administrativa
  supportSessions: SupportSession[]; // modo suporte do master
}

// ═══════════════════════════════════════════════════════════════
// EQUIPE — usuários internos da empresa (multi-tenant real)
// Um User pode ser membro de várias empresas com papéis diferentes.
// ═══════════════════════════════════════════════════════════════
export type MemberRole =
  | 'OWNER' | 'ADMIN' | 'SECRETARIA' | 'ATENDENTE' | 'VENDEDOR' | 'VIEWER';

export const VALID_MEMBER_ROLES: MemberRole[] = [
  'OWNER', 'ADMIN', 'SECRETARIA', 'ATENDENTE', 'VENDEDOR', 'VIEWER',
];

export type PermissionId =
  | 'dashboard' | 'agenda' | 'clientes' | 'leads' | 'pedidos' | 'catalogo'
  | 'pagina' | 'agente' | 'whatsapp' | 'campanhas'
  | 'equipe' | 'config' | 'financeiro' | 'admin';

export interface BusinessMember {
  id: ID;
  businessId: ID;
  userId: ID;
  role: MemberRole;
  permissions: Partial<Record<PermissionId, boolean>>; // ausente = padrão do papel
  active: boolean;
  note: string; // ex: "Secretária — recepção"
  invitedBy: ID;
  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// AGENTE DE ATENDIMENTO (por empresa; universal, sem nicho)
// ═══════════════════════════════════════════════════════════════
export type AgentTone = 'profissional' | 'acolhedor' | 'objetivo' | 'comercial';
export const VALID_AGENT_TONES: AgentTone[] = ['profissional', 'acolhedor', 'objetivo', 'comercial'];
export type AgentObjective =
  | 'duvidas' | 'servicos' | 'escolher_servico' | 'orientar_agendamento'
  | 'whatsapp' | 'interesse';
export const VALID_AGENT_OBJECTIVES: AgentObjective[] = [
  'duvidas', 'servicos', 'escolher_servico', 'orientar_agendamento', 'whatsapp', 'interesse',
];

export interface BusinessAgent {
  id: ID;
  businessId: ID;
  name: string;
  enabled: boolean;
  greeting: string;
  tone: AgentTone;
  objectives: AgentObjective[];
  instructions: string; // "Orientações do agente"
  restrictions: string; // "Regras / limitações"
  handoffMessage: string; // escalada para humano
  knowledgeOverride: string; // conhecimento extra do negócio (linhas "Pergunta: Resposta")
  channels: { site: boolean; whatsapp: boolean };
  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// CONVERSAS / MENSAGENS (inbox do CRM — preparado p/ WhatsApp oficial)
// ═══════════════════════════════════════════════════════════════
export type ConversationChannel = 'whatsapp' | 'agent';
export type ConversationStatus = 'open' | 'closed';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Conversation {
  id: ID;
  businessId: ID;
  channel: ConversationChannel;
  contactId: string; // contato do CRM ('' quando ainda não resolvido)
  customerId: string;
  name: string;
  phone: string; // só dígitos
  status: ConversationStatus;
  unread: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  createdAt: string;
  // Contexto do assistente nesta conversa (fluxo de agendamento, dados já
  // coletados do cliente etc.). Opcional e aditivo — conversas antigas não têm.
  context?: Record<string, any>;
}

export interface Message {
  id: ID;
  businessId: ID;
  conversationId: ID;
  direction: 'in' | 'out';
  body: string;
  status: MessageStatus;
  externalId: string; // id do provedor (webhook)
  by: string; // userId do membro (envio interno) ou 'contact' (recebida)
  at: string;
}

// ═══════════════════════════════════════════════════════════════
// CAMPANHAS (marketing) — SOMENTE contatos com marketingOptIn
// ═══════════════════════════════════════════════════════════════
// Ciclo operacional: draft → ready → sending → sent/partial/failed;
// draft/ready/sending podem ser CANCELADOS. Enviadas (sent/partial/failed)
// são HISTÓRICO: nunca editáveis nem apagáveis (auditoria preservada).
export type CampaignStatus = 'draft' | 'ready' | 'sending' | 'sent' | 'partial' | 'failed' | 'cancelled';
export const VALID_CAMPAIGN_STATUSES: CampaignStatus[] = [
  'draft', 'ready', 'sending', 'sent', 'partial', 'failed', 'cancelled',
];

/** Estados em que a campanha ainda pode ser EDITADA (rascunho vivo). */
export const CAMPAIGN_EDITABLE: CampaignStatus[] = ['draft', 'ready', 'cancelled'];
/** Estados em que a campanha pode ser EXCLUÍDA (não destrói auditoria). */
export const CAMPAIGN_DELETABLE: CampaignStatus[] = ['draft'];
/** Estados em que a campanha pode ser CANCELADA (ainda não fez disparo real). */
export const CAMPAIGN_CANCELLABLE: CampaignStatus[] = ['draft', 'ready', 'sending'];

export function campaignStatusDef(s: CampaignStatus): {
  label: string; editable: boolean; deletable: boolean; cancellable: boolean; tone: string;
} {
  const map: Record<CampaignStatus, { label: string; editable: boolean; deletable: boolean; cancellable: boolean; tone: string }> = {
    draft: { label: 'Rascunho', editable: true, deletable: true, cancellable: true, tone: 'zinc' },
    ready: { label: 'Pronta', editable: true, deletable: false, cancellable: true, tone: 'amber' },
    sending: { label: 'Enviando', editable: false, deletable: false, cancellable: true, tone: 'blue' },
    sent: { label: 'Enviada', editable: false, deletable: false, cancellable: false, tone: 'emerald' },
    partial: { label: 'Parcial', editable: false, deletable: false, cancellable: false, tone: 'orange' },
    failed: { label: 'Falhou', editable: false, deletable: false, cancellable: false, tone: 'red' },
    cancelled: { label: 'Cancelada', editable: true, deletable: false, cancellable: true, tone: 'zinc' },
  };
  return map[s] || map.draft;
}

export type CampaignSegment =
  | 'all_optin' | 'new' | 'old' | 'booked' | 'never_booked'
  | 'by_service' | 'inactive' | 'leads';

export const CAMPAIGN_SEGMENTS: Array<{ id: CampaignSegment; label: string; hint: string }> = [
  { id: 'all_optin', label: 'Todos com consentimento', hint: 'Toda a base que autorizou marketing' },
  { id: 'new', label: 'Clientes novos', hint: 'Entraram na base nos últimos 30 dias' },
  { id: 'old', label: 'Clientes antigos', hint: 'Na base há mais de 180 dias' },
  { id: 'booked', label: 'Já agendaram', hint: 'Têm pelo menos um agendamento' },
  { id: 'never_booked', label: 'Nunca agendaram', hint: 'Sem nenhum agendamento' },
  { id: 'inactive', label: 'Sem atendimento recente', hint: 'Último contato há mais de 90 dias' },
  { id: 'by_service', label: 'Por serviço', hint: 'Já agendaram um serviço específico' },
  { id: 'leads', label: 'Leads', hint: 'Contatos com interesse registrado (com consentimento)' },
];

export interface CampaignCounts {
  eligible: number; // público com consentimento
  sent: number;
  delivered: number;
  failed: number;
}

export interface Campaign {
  id: ID;
  businessId: ID;
  name: string;
  message: string;
  segment: CampaignSegment;
  segmentRef: string; // serviceId quando segment = 'by_service'
  status: CampaignStatus;
  counts: CampaignCounts;
  channel: 'whatsapp';
  createdBy: ID;
  createdAt: string;
  updatedAt: string;
  sentAt: string;
}

export interface CampaignRecipient {
  id: ID;
  businessId: ID;
  campaignId: ID;
  contactId: ID;
  name: string;
  phone: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  error: string;
  at: string;
}

// ═══════════════════════════════════════════════════════════════
// MASTER / SUPORTE / AUDITORIA (área da plataforma)
// ═══════════════════════════════════════════════════════════════
export type SupportMode = 'view' | 'admin';

export interface SupportSession {
  id: ID;
  masterUserId: ID;
  masterEmail: string;
  businessId: ID;
  mode: SupportMode;
  reason: string;
  createdAt: string;
  expiresAt: string;
  endedAt: string; // '' = em andamento
}

export type AuditAction =
  | 'support.view_started' | 'support.admin_started' | 'support.ended'
  | 'business.viewed' | 'business.updated_by_master'
  | 'member.created' | 'member.updated' | 'member.removed'
  | 'feature.updated' | 'module.updated'
  | 'campaign.created' | 'campaign.ready' | 'campaign.sent'
  | 'campaign.cancelled' | 'campaign.deleted'
  | 'whatsapp.connect_requested' | 'whatsapp.webhook_received'
  | 'agent.updated' | 'organization.created' | 'unit.created';

export interface AuditEntry {
  id: ID;
  at: string;
  action: AuditAction;
  actorUserId: ID;
  actorEmail: string;
  actorRole: string;
  businessId: string;
  supportSessionId: string;
  meta: Record<string, any>;
}
