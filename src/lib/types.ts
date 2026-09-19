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
  active?: boolean;
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
  // Acesso criado pela equipe: a senha real nunca é persistida em claro.
  // Estes campos são aditivos e deixam pronta a futura troca obrigatória
  // sem alterar o fluxo público de /api/customer/register.
  mustChangePassword?: boolean;
  accessCreatedAt?: string;
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

// ── Identidade visual do DASHBOARD (P2) ─────────────────────
// Configuração SIMPLES (uma cor principal) por Business. Independe da
// identidade da página pública (Theme) — nada aqui afeta o público.
export interface BusinessAppearance {
  /** Cor principal da navegação/sidebar (hex `#rrggbb`). '' = padrão atual. */
  navColor: string;
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
  // A2-B5 (F9): fuso IANA do negócio para TODAS as regras de agenda
  // (disponibilidade, exceções, horizonte, "hoje"). Ausente/inválido ⇒
  // America/Sao_Paulo (default do produto). Nunca o fuso do navegador.
  businessTimezone?: string;
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
  // P4 — bandeiras de CAPACIDADE por unidade (camada única de planos/flags).
  // Nunca é lida fora de lib/automation/capabilities.ts; ausente = padrão do
  // produto (nada de `if plan === ...` espalhado pelo código).
  capabilityFlags?: Record<string, boolean>;
  about: AboutSection; // seção "Sobre a empresa" (título/texto/imagem)
  // Identidade visual do painel (P2). Ausente = padrão do produto.
  appearance?: BusinessAppearance;
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
  // A2-B5 (F9): fuso do negócio para a ilha de booking montar dias (o
  // servidor segue sendo quem decide as regras).
  businessTimezone?: string;
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
  // ── VÍNCULO User → Professional (P2) ─────────────────────────
  // Quando um login da equipe REPRESENTA este profissional, guardamos aqui o
  // id do User. A relação vive no Professional (uma pessoa = um login por
  // unidade) e é editada em Equipe/Profissionais pelo Admin.
  // '' ou ausente = sem login vinculado (dado legado permanece válido).
  userId?: string;
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
  /** Série aditiva: cada ocorrência continua um Booking independente. */
  seriesId?: string;
  seriesIndex?: number; // 1-based; preservado ao reagendar
  seriesCount?: number;
  seriesRequestId?: string; // idempotência tenant-scoped
  seriesFingerprint?: string; // recusa reutilização da chave com outro payload
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
  // P3 — vínculo com o lead que originou o agendamento
  leadId?: string;
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
  // Observação interna LEGADA (texto único, preservado sem alteração).
  // Continua válida e visível; a partir do P2 as novas observações são
  // registradas em `notes` (append-only, com autor e data).
  note?: string;
  // Histórico de observações da equipe (P2) — APPEND-ONLY: nada é
  // sobrescrito nem apagado. Cada registro guarda quem escreveu, quando e o
  // contexto (agendamento, quando houver).
  notes?: ContactNote[];
}

export interface ContactNote {
  id: ID;
  at: string; // ISO
  by: ID; // userId do autor ('' = legado/sistema)
  byName: string; // nome do autor no momento da escrita (auditoria legível)
  text: string;
  /** Contexto opcional: agendamento relacionado à observação. */
  bookingId?: string;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

export type LeadPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface LeadStageHistory {
  id: ID;
  fromStage: string;
  toStage: string;
  movedBy: string; // userId or 'system' or 'api'
  movedByName: string; // display name
  at: string; // ISO
  note?: string;
}

export interface LeadNote {
  id: ID;
  at: string; // ISO
  by: string; // userId
  byName: string;
  text: string;
}

export interface Lead {
  id: ID;
  businessId: ID;
  customerId: string; // '' = guest / ainda sem conta vinculada
  name: string;
  phone: string;
  email: string;
  instagram: string;
  origin: string;
  channel?: string; // canal específico (ex: landing_page, site, embed, api, whatsapp)
  interest: string;
  action: string;
  status: LeadStatus;
  createdAt: string;
  lastInteraction: string;
  // ── P3: Esteira Operacional & Integrações ──
  stageId?: string; // id da etapa na esteira (default: 'new')
  assignedUserId?: string; // id do usuário responsável
  priority?: LeadPriority; // prioridade do lead
  nextAction?: string; // próxima ação prevista
  serviceId?: string; // serviço de interesse vinculado
  professionalId?: string; // profissional de interesse vinculado
  sourceUrl?: string; // URL da página de origem
  metadata?: Record<string, any>; // metadados complementares da entrada
  bookingId?: string; // vínculo com atendimento agendado
  notes?: LeadNote[]; // histórico de observações da equipe (append-only)
  stageHistory?: LeadStageHistory[]; // histórico de movimentação na esteira
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
  // ── P3: Motor Operacional & Integrações Externas ──
  pipelines: BusinessPipeline[];
  apiKeys: ApiKey[];
  webhooks: WebhookConfig[];
  webhookDeliveries: WebhookDelivery[];
  idempotencyKeys: IdempotencyRecord[];
  integrationLogs: IntegrationLog[];
  // ── P4: Motor de Automações (definições + execuções persistidas) ──
  automations: Automation[];
  automationRuns: AutomationRun[];
  tasks: Task[];
  // ── P5: propostas de automação geradas por IA (nunca executam sozinhas) ──
  aiProposals: AiProposal[];
  // ── P6: canais e integrações externas (conexões + log de entregas) ──
  integrations: Integration[];
  integrationEvents: IntegrationEvent[];
}

// ═══════════════════════════════════════════════════════════════
// P3 — ESTEIRA OPERACIONAL (PIPELINE)
// ═══════════════════════════════════════════════════════════════
export interface PipelineStage {
  id: string; // 'new' | 'in_progress' | 'qualifying' | 'qualified' | 'waiting_secretary' | 'scheduled' | 'converted' | 'lost' | custom
  name: string;
  order: number;
  color?: string; // badge tone or color
  isTerminal?: boolean; // converted/lost
  isSystem?: boolean;
  mappedStatus?: LeadStatus;
}

export interface BusinessPipeline {
  id: ID;
  businessId: ID;
  stages: PipelineStage[];
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// P3 — API KEYS PARA INTEGRAÇÃO EXTERNA
// ═══════════════════════════════════════════════════════════════
export interface ApiKey {
  id: ID;
  businessId: ID;
  name: string;
  keyPrefix: string; // e.g. "ik_live_abc123"
  keyHash: string; // SHA-256 hash do segredo completo
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdByUserId?: string;
}

// ═══════════════════════════════════════════════════════════════
// P3 — WEBHOOKS DE SAÍDA
// ═══════════════════════════════════════════════════════════════
export type WebhookEvent =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.stage_changed'
  | 'booking.created'
  | 'booking.updated'
  | 'booking.cancelled';

export const VALID_WEBHOOK_EVENTS: WebhookEvent[] = [
  'lead.created',
  'lead.updated',
  'lead.stage_changed',
  'booking.created',
  'booking.updated',
  'booking.cancelled',
];

export interface WebhookConfig {
  id: ID;
  businessId: ID;
  url: string;
  secret: string; // whsec_... (armazenado com segurança no banco; nunca exposto em GET/listagem)
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SafeWebhookConfig {
  id: ID;
  businessId: ID;
  url: string;
  secretMasked: string; // ex: whsec_••••••••1234 (representação segura para exibição)
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookAttempt {
  attempt: number;
  at: string;
  statusCode?: number;
  error?: string;
  durationMs: number;
}

export interface WebhookDelivery {
  id: ID;
  webhookId: ID;
  businessId: ID;
  event: WebhookEvent;
  eventId: string; // ID único do evento, preservado entre retries para idempotência do receptor
  url: string;
  payloadSummary: Record<string, any>;
  status: 'pending' | 'success' | 'failed';
  statusCode?: number;
  error?: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: string;
  deliveredAt?: string;
  attemptsHistory: WebhookAttempt[];
  createdAt: string;
  updatedAt: string;
  // ── Posse temporária (lease) do consumidor automático da fila ──
  // Preenchidos SOMENTE enquanto uma execução (cron) está tentando entregar
  // esta entrega e limpos ao final do ciclo. Impedem que duas execuções
  // concorrentes entreguem a MESMA tentativa duas vezes. Nunca expostos ao
  // painel (ver sanitizeWebhookDeliveryForDisplay).
  claimToken?: string;
  claimExpiresAt?: string;
}

// ═══════════════════════════════════════════════════════════════
// P3 — IDEMPOTÊNCIA
// ═══════════════════════════════════════════════════════════════
export interface IdempotencyRecord {
  id: ID;
  businessId: ID;
  key: string;
  endpoint: string;
  statusCode: number;
  responseBody: any;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════
// P3 — OBSERVABILIDADE DE INTEGRAÇÕES
// ═══════════════════════════════════════════════════════════════
export interface IntegrationLog {
  id: ID;
  businessId: ID;
  endpoint: string;
  method: string;
  source: string;
  status: number;
  operationId: string;
  errorMessage?: string;
  at: string;
}

// ═══════════════════════════════════════════════════════════════
// P4 — MOTOR DE AUTOMAÇÕES
// ═══════════════════════════════════════════════════════════════
// Uma automação é um GRAFO simples e validável:
//
//   GATILHO → CONDIÇÃO → AÇÃO → ESPERA → RAMIFICAÇÃO → AÇÃO → FIM
//
// A definição é DADOS (nunca código): é o que permite (a) validar no servidor,
// (b) persistir estado de execução retomável sem manter HTTP aberto e
// (c) no futuro, um agente de IA gerar/editar automações sem conhecer o banco
// — ele só precisa conhecer este catálogo. Nenhuma expressão é avaliada: o
// motor interpreta operadores fixos (`equals`, `contains`, …).
//
// Multi-tenancy: `businessId` está em TODA entidade e é revalidado em cada
// passo. Uma execução jamais toca linha de outra empresa.

/** Eventos que LIGAM automações. São os eventos que o sistema já produz. */
export type AutomationEventId =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.stage_changed'
  | 'lead.assigned'
  | 'customer.created'
  | 'customer.updated'
  | 'booking.created'
  | 'booking.confirmed'
  | 'booking.cancelled'
  | 'booking.completed';

export const AUTOMATION_EVENTS: AutomationEventId[] = [
  'lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned',
  'customer.created', 'customer.updated',
  'booking.created', 'booking.confirmed', 'booking.cancelled', 'booking.completed',
];

// ── Condições (P4.3) ─────────────────────────────────────────
export type ConditionOperator =
  | 'equals' | 'not_equals' | 'contains' | 'not_contains'
  | 'exists' | 'not_exists' | 'greater_than' | 'less_than';

export const CONDITION_OPERATORS: ConditionOperator[] = [
  'equals', 'not_equals', 'contains', 'not_contains',
  'exists', 'not_exists', 'greater_than', 'less_than',
];

export type LogicOperator = 'and' | 'or' | 'not';

/** Comparação de um CAMPO DO CONTEXTO do evento com um valor fixo. */
export interface AutomationFieldCondition {
  field: string;
  operator: ConditionOperator;
  value?: string | number | boolean | null;
}

/** Composição lógica (AND/OR/NOT) de condições — aninhável. */
export interface AutomationConditionGroup {
  logic: LogicOperator;
  conditions: AutomationCondition[];
}

export type AutomationCondition = AutomationFieldCondition | AutomationConditionGroup;

export function isConditionGroup(c: AutomationCondition | undefined | null): c is AutomationConditionGroup {
  return !!c && typeof c === 'object' && Array.isArray((c as AutomationConditionGroup).conditions);
}

// ── Nós do grafo (P4.2 / P4.4 / P4.5 / P4.6) ─────────────────
export type AutomationNodeType = 'trigger' | 'condition' | 'branch' | 'action' | 'wait' | 'end';

export type AutomationActionType =
  | 'update_lead'
  | 'change_lead_stage'
  | 'assign_lead'
  | 'add_lead_note'
  | 'update_customer'
  | 'create_task'
  | 'create_booking'
  | 'cancel_booking'
  | 'dispatch_webhook';

/** Modo de espera (P4.6). `event` está Preparado, ainda não dispara. */
export type AutomationWaitMode = 'duration' | 'until' | 'event';

export interface AutomationWaitConfig {
  mode: AutomationWaitMode;
  /** duration: minutos a esperar (10 min, 2 h = 120, 1 dia = 1440). */
  minutes?: number;
  /** until: ISO `YYYY-MM-DDTHH:mm` (no fuso do produto) para retomar. */
  at?: string;
  /** event: (futuro) evento que libera a espera. */
  waitForEvent?: string;
}

export interface AutomationBranchConfig {
  id: string;
  label: string;
  condition: AutomationCondition;
}

export interface AutomationNodeConfig {
  /** trigger */
  event?: AutomationEventId;
  /** condition / branch */
  condition?: AutomationCondition;
  branches?: AutomationBranchConfig[];
  /** action */
  action?: { type: AutomationActionType; params: Record<string, any> };
  /** wait */
  wait?: AutomationWaitConfig;
}

export interface AutomationNode {
  id: string;
  type: AutomationNodeType;
  label?: string;
  config: AutomationNodeConfig;
}

/** `branch` só importa em condition/branch: 'yes' | 'no' | id do ramo. */
export interface AutomationEdge {
  from: string;
  to: string;
  branch?: string;
}

export interface AutomationSettings {
  /** Tetos operacionais (P4.4/P4.9). Ausente = padrão do produto. */
  maxSteps?: number;
  maxWaitMinutes?: number;
  /** true ⇒ ações da própria automação podem disparar novas execuções. */
  allowReentry?: boolean;
  /** true ⇒ erro em ação encerra a execução (padrão); false ⇒ segue. */
  stopOnActionError?: boolean;
  /** Caminho no contexto que identifica o "assunto" (dedupe por evento). */
  dedupeField?: string;
}

export interface Automation {
  id: ID;
  businessId: ID;
  name: string;
  description: string;
  active: boolean;
  /** Gatilho + condição de entrada (atalho do editor linear). */
  trigger: { event: AutomationEventId; condition?: AutomationCondition };
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  settings: AutomationSettings;
  /** Origem (template interno) e versão do formato — nunca interpretado. */
  templateId?: string;
  version: number;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Execução persistida (P4.1 / P4.7 / P4.8) ────────────────
export type AutomationRunStatus =
  | 'queued'    // criado pelo gatilho, ainda não processado
  | 'running'   // reivindicado por UMA execução do motor
  | 'waiting'   // pausado em delay — retoma quando `waitingUntil` vencer
  | 'completed'
  | 'failed'
  | 'cancelled';

export const AUTOMATION_RUN_TERMINAL: AutomationRunStatus[] = ['completed', 'failed', 'cancelled'];

/** Um passo do histórico — destinado a DIAGNÓSTICO (nunca guarda segredo). */
export interface AutomationRunStep {
  at: string;
  nodeId: string;
  nodeType: AutomationNodeType | 'run';
  /** O que aconteceu (rótulo estável para UI/filtros). */
  outcome:
    | 'triggered' | 'true' | 'false' | 'executed' | 'skipped'
    | 'waiting' | 'resumed' | 'error' | 'finished' | 'cancelled';
  label: string;
  detail?: string;
}

export interface AutomationRun {
  id: ID;
  businessId: ID;
  automationId: ID;
  /** Nome congelado no disparo (a automação pode mudar/depois ser apagada). */
  automationName: string;
  status: AutomationRunStatus;
  triggerEvent: AutomationEventId;
  /** Nó a processar (após um wait, é o ponto de retomada). */
  currentNodeId: string;
  /** Dados do evento + resultado das ações. Nada sensível. */
  context: Record<string, any>;
  /** ISO de retomada quando `status = 'waiting'`. */
  waitingUntil: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string;
  error: string;
  history: AutomationRunStep[];
  /** Chave de idempotência do gatilho (mesma chave ⇒ no máximo 1 execução). */
  eventKey: string;
  /** Nó/entidade que originou (anti-loop: evento gerado por automação). */
  emittedByRunId: string;
  steps: number;
  resumes: number;
  lastActionType?: AutomationActionType | '';
  lastError?: string;
  // ── Posse temporária do motor (a mesma entrega webhook do P3) ──
  claimToken?: string;
  claimExpiresAt?: string;
}

// ── TAREFAS INTERNAS (criadas por automação ou pela equipe) ──
// Não existe "task" no P0–P3. O motor precisava de uma e cria UMA estrutura
// compartilhada (não um campo solto): `Task` é a fila de trabalho da unidade,
// vinculada a lead/agendamento/cliente quando houver. Espelhar em
// `Lead.nextAction` mantém a esteira informada (nunca o contrário).
export type TaskStatus = 'open' | 'done' | 'cancelled';

export interface Task {
  id: ID;
  businessId: ID;
  title: string;
  note: string;
  status: TaskStatus;
  dueAt: string; // '' = sem prazo
  createdAt: string;
  updatedAt: string;
  doneAt: string;
  assignedUserId: string; // '' = qualquer um da equipe
  /** Quem criou: userId ou 'automation'. */
  createdBy: string;
  automationId?: string;
  automationRunId?: string;
  /** Nó que a criou — dedupe quando a execução é retomada. */
  automationNodeId?: string;
  leadId?: string;
  bookingId?: string;
  customerId?: string;
  source: 'automation' | 'manual';
}

// ═══════════════════════════════════════════════════════════════
// P5 — PROPOSTA DE AUTOMAÇÃO GERADA POR IA
// ═══════════════════════════════════════════════════════════════
// A IA NÃO executa. O plano é a projeção LINEAR do P4 (mesmo contrato do
// editor). Publicar grava uma `Automation` canônica; o executor do P4 é
// quem roda depois da aprovação humana. Texto livre nunca vira código.

export interface AiPlanStep {
  kind: 'action' | 'wait' | 'condition';
  label?: string;
  action?: { type: AutomationActionType; params: Record<string, any> };
  wait?: AutomationWaitConfig;
  condition?: AutomationCondition;
}

export interface AiPlan {
  name: string;
  description: string;
  prompt: string;
  event: AutomationEventId;
  condition: AutomationCondition | null;
  steps: AiPlanStep[];
  elseSteps: AiPlanStep[];
  settings: AutomationSettings;
  /** 0..1 — diagnóstico; nunca decide publicação. */
  confidence: number;
  assumptions: string[];
  unresolved: string[];
}

export type AiProposalStatus = 'draft' | 'approved' | 'published' | 'cancelled';

export interface AiProposal {
  id: ID;
  businessId: ID;
  status: AiProposalStatus;
  prompt: string;
  plan: AiPlan;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  automationId?: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

// ═══════════════════════════════════════════════════════════════
// EQUIPE — usuários internos da empresa (multi-tenant real)
// Um User pode ser membro de várias empresas com papéis diferentes.
// ═══════════════════════════════════════════════════════════════
export type MemberRole =
  | 'OWNER' | 'ADMIN' | 'SECRETARIA' | 'ATENDENTE' | 'VENDEDOR' | 'VIEWER'
  // PROFISSIONAL (P2): login de quem ATENDE. É um papel de tenant como os
  // demais — nenhuma arquitetura paralela de usuários. O escopo de agenda
  // (ver/só a própria) vem do VÍNCULO User→Professional (Professional.userId),
  // não do papel: papéis administrativos preservam o acesso amplo atual.
  | 'PROFISSIONAL';

export const VALID_MEMBER_ROLES: MemberRole[] = [
  'OWNER', 'ADMIN', 'SECRETARIA', 'ATENDENTE', 'VENDEDOR', 'VIEWER', 'PROFISSIONAL',
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
// P6 — CANAIS E INTEGRAÇÕES EXTERNAS
// ═══════════════════════════════════════════════════════════════
// TRÊS CONCEITOS DIFERENTES, um REGISTRO genérico (`Integration`) com
// discriminante explícito `kind` — nenhuma categoria é "achatada":
//
//   • CANAL   (`channel`)   → por onde se CONVERSA:
//                             WhatsApp, Instagram, Facebook/Messenger, Telegram;
//   • FONTE   (`source`)    → de onde o LEAD veio:
//                             formulário, landing page, tráfego pago, QR Code,
//                             página pública, formulário externo;
//   • TÉCNICA (`technical`) → por onde os DADOS viajam:
//                             webhook de entrada, n8n, API de sistema externo.
//
// O catálogo de provedores (o que existe, o que já funciona e o que ainda não)
// vive em `src/lib/integrations/catalog.ts` — o registro guarda só o que a
// UNIDADE conectou. Toda linha pertence a exatamente um Business.
export type IntegrationKind = 'channel' | 'source' | 'technical';

export const INTEGRATION_KINDS: IntegrationKind[] = ['channel', 'source', 'technical'];

export type IntegrationProviderId =
  // Canais (conversa)
  | 'whatsapp' | 'instagram' | 'messenger' | 'telegram'
  // Fontes (origem do lead)
  | 'form' | 'landing_page' | 'paid_traffic' | 'qrcode' | 'public_page'
  // Integrações técnicas (transporte de dados)
  | 'inbound_webhook' | 'n8n' | 'external_api';

/**
 * Eventos EXTERNOS normalizados (contrato do P6).
 *
 * Menor conjunto capaz de provar a arquitetura: o que já é entregue ao P4 hoje
 * (`supported: true` no catálogo de eventos) e o que fica declarado para os
 * conectores seguintes. Nome do evento é o MESMO vocabulário do produto
 * (`lead.created`), para não existir tradução no meio do caminho.
 */
export type ExternalEventName =
  | 'lead.created'
  | 'lead.updated'
  | 'form.submitted'
  | 'contact.created'
  | 'contact.updated'
  | 'message.received'
  | 'booking.requested';

export const EXTERNAL_EVENTS: ExternalEventName[] = [
  'lead.created', 'lead.updated', 'form.submitted',
  'contact.created', 'contact.updated',
  'message.received', 'booking.requested',
];

export interface ExternalEventDef {
  id: ExternalEventName;
  label: string;
  hint: string;
  /** O P6 já ENTREGA este evento ao P4 (verdade do produto, não promessa). */
  supported: boolean;
  /** Serviço oficial que recebe o evento quando suportado. */
  forward: 'lead' | 'contact' | 'message' | 'booking' | 'none';
}

export const EXTERNAL_EVENT_DEFS: ExternalEventDef[] = [
  {
    id: 'lead.created', label: 'Lead criado', supported: true, forward: 'lead',
    hint: 'Entra pelo serviço oficial de leads (deduplicação + gatilhos do P4).',
  },
  {
    id: 'lead.updated', label: 'Lead atualizado', supported: true, forward: 'lead',
    hint: 'Atualiza o lead existente e mantém a origem original.',
  },
  {
    id: 'form.submitted', label: 'Formulário enviado', supported: true, forward: 'lead',
    hint: 'Formulário/landing page: cria ou atualiza o lead da unidade.',
  },
  {
    id: 'contact.created', label: 'Contato criado', supported: true, forward: 'contact',
    hint: 'Entra na base de clientes e dispara os gatilhos de cliente do P4.',
  },
  {
    id: 'contact.updated', label: 'Contato atualizado', supported: true, forward: 'contact',
    hint: 'Atualiza o contato existente (nunca sobrescreve com dado vazio).',
  },
  {
    id: 'message.received', label: 'Mensagem recebida', supported: false, forward: 'message',
    hint: 'Declarado para os canais de conversa (P6.1); depende do conector do canal.',
  },
  {
    id: 'booking.requested', label: 'Agendamento solicitado', supported: false, forward: 'booking',
    hint: 'Declarado para o P6.2; hoje sistemas externos agendam pela API do P3.',
  },
];

export type IntegrationDirection = 'in' | 'out' | 'both';
export type IntegrationStatus = 'active' | 'paused';

/**
 * Conexão/integração de uma unidade (registro genérico).
 *
 * SEGREDOS: o TOKEN de integração é guardado apenas como SHA-256 (`tokenHash`)
 * e existe em claro só no momento da criação; o SEGREDO DE ASSINATURA é o único
 * material reversível (é preciso conferir o HMAC na entrada) e nunca sai da API
 * depois de criado — a UI vê apenas a máscara. Tokens de canais oficiais
 * (WhatsApp/Instagram/...) NÃO moram aqui: ficam em variáveis de ambiente, como
 * já acontece no P3 (`src/lib/whatsapp.ts`).
 */
export interface Integration {
  id: ID;
  businessId: ID;
  kind: IntegrationKind;
  provider: IntegrationProviderId;
  name: string;
  direction: IntegrationDirection;
  status: IntegrationStatus;
  tokenHash: string; // SHA-256 do token `ilk_live_...`
  tokenPrefix: string; // ex.: "ilk_live_3f9a…" (visível)
  signingSecret: string; // `ilsec_...` (HMAC de entrada; nunca devolvido)
  signingSecretPrefix: string;
  requireSignature: boolean;
  /** Evento canônico padrão quando a origem manda payload cru ('' = exige envelope). */
  defaultEvent: ExternalEventName | '';
  /** Configuração NÃO sensível do conector (ex.: phoneNumberId, fieldMap). */
  config: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  rotatedAt: string; // última rotação de credenciais
  lastEventAt: string;
  eventCount: number;
}

/** Versão segura para API/painel: sem hash, sem segredo, com máscaras. */
export interface SafeIntegration {
  id: ID;
  businessId: ID;
  kind: IntegrationKind;
  provider: IntegrationProviderId;
  name: string;
  direction: IntegrationDirection;
  status: IntegrationStatus;
  tokenMasked: string;
  signingSecretMasked: string;
  requireSignature: boolean;
  defaultEvent: ExternalEventName | '';
  config: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string;
  lastEventAt: string;
  eventCount: number;
  /** Caminho do endpoint de entrada ('' quando o provedor não recebe dados). */
  endpointPath: string;
}

export type IntegrationEventStatus = 'processed' | 'duplicate' | 'rejected' | 'failed';

/**
 * Registro de uma entrega externa (append-only). É o LOG do P6:
 *  - nunca guarda o token nem o segredo (só o prefixo, quando muito);
 *  - `idempotencyKey` = integração + identificador externo do evento;
 *  - `automationRunIds` prova o encaminhamento ao P4 (execuções criadas).
 */
export interface IntegrationEvent {
  id: ID;
  businessId: ID;
  integrationId: ID;
  provider: IntegrationProviderId | '';
  direction: 'in' | 'out';
  event: ExternalEventName | '';
  status: IntegrationEventStatus;
  externalEventId: string;
  idempotencyKey: string;
  httpStatus: number;
  reason: string;
  leadId: string;
  contactId: string;
  automationRunIds: string[];
  payloadSummary: Record<string, any>;
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
  | 'agent.updated' | 'organization.created' | 'unit.created'
  | 'master.created' | 'master.promoted' | 'master.revoked'
  | 'user.login'
  // P2 — vínculo de acesso e identidade do painel
  | 'member.professional_linked' | 'member.professional_unlinked'
  | 'appearance.updated' | 'contact.note_added'
  // P3 — esteira operacional e integrações
  | 'pipeline.updated' | 'api_key.created' | 'api_key.revoked'
  | 'webhook.created' | 'webhook.updated' | 'webhook.deleted'
  | 'lead.created' | 'lead.updated'
  | 'lead.stage_changed' | 'lead.assigned' | 'lead.booked' | 'lead.note_added'
  | 'customer.access_created'
  // P4 — motor de automações e tarefas
  | 'automation.created' | 'automation.updated' | 'automation.deleted'
  | 'automation.toggled' | 'automation.duplicated'
  | 'automation.run_cancelled' | 'task.created' | 'task.completed'
  // P5 — propostas de IA (a publicação cria automation.created)
  | 'ai.proposal_created' | 'ai.proposal_updated' | 'ai.proposal_approved'
  | 'ai.proposal_cancelled' | 'ai.proposal_published' | 'ai.proposal_regenerated'
  // P6 — canais e integrações externas
  | 'integration.created' | 'integration.updated' | 'integration.deleted'
  | 'integration.token_rotated';

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
