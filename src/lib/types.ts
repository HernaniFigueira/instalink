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
  // ── PERFIL PESSOAL (aditivo — doc antigo sem estes campos continua válido) ──
  /** Telefone de contato do usuário (formato livre). */
  phone?: string;
  /** Foto de perfil (URL). A topbar passa a usá-la quando presente. */
  photo?: string;
  /** Cargo/função na empresa (ex.: "Clínico responsável"). */
  title?: string;
  /** Conselho profissional (ex.: "CRM 123456", "CRO 7890"). */
  conselho?: string;
  /** Breve apresentação profissional (dados complementares). */
  professionalBio?: string;
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
  /**
   * FASE 2 · P5 — TIPO DE CLÍNICA (preset, NÃO aplicação separada).
   * Define terminologia, templates de anamnese sugeridos, módulos sugeridos e
   * configuração inicial. É UM produto com presets — nunca cria dashboards,
   * rotas ou componentes diferentes. Ausente/'geral' = genérico (compatível
   * com todo dado legado; nada é migrado nem adivinhado).
   */
  clinicType?: ClinicType;
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
  /**
   * A3.4 · Bloco 9 — canal do Instagram Direct (Instagram API with Instagram
   * Login). Estrutura ADITIVA por Business, no mesmo formato do WhatsApp:
   * credencial criptografada (AES-256-GCM) + identificadores PÚBLICOS da conta
   * (que não são segredo). Registros antigos simplesmente não têm o campo.
   */
  instagramIntegration?: InstagramIntegration;
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
  /**
   * FASE 2 · P8 — itens OBRIGATÓRIOS do checklist de onboarding que o usuário
   * PULOU (ids em lib/dashboard.ts). Aditivo/ausente = nada pulado. Itens não
   * listados aqui nunca são afetados; só os `optional` podem ser pulados.
   */
  setupSkipped?: string[];
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
export type WhatsappStatus = 'not_connected' | 'pending' | 'connected' | 'error';

export interface WhatsappIntegration {
  status: WhatsappStatus;
  displayPhone: string; // número público exibido ("+55 11 ...")
  phoneNumberId: string; // identificador da conta (público, não secreto)
  wabaId: string;
  connectedAt: string; // '' quando não conectado
  lastWebhookAt: string; // '' quando nunca recebeu evento
  requestedAt: string; // quando o lojista pediu a conexão
  // Credencial criptografada por Business (AES-256-GCM via WHATSAPP_CREDENTIALS_KEY)
  encryptedAccessToken?: string;
  keyFingerprint?: string;
  verifiedName?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  webhookVerifiedAt?: string;
  /**
   * Como esta unidade foi conectada: 'embedded_signup' (a própria unidade
   * autorizou no popup oficial da Meta) ou 'master' (credenciais cadastradas
   * pelo suporte). Vazio nos registros anteriores ao Bloco 8.
   */
  source?: 'embedded_signup' | 'master' | '';
  /** Data e hora em que o código do popup foi trocado pelo token. */
  tokenIssuedAt?: string;
  /** Quando a Meta confirmou a assinatura do webhook desta WABA. */
  webhookSubscribedAt?: string;
  /**
   * Quando o NÚMERO foi registrado na Cloud API. Sem registro comprovado o
   * número não envia nem recebe pela API — por isso a unidade fica `pending`
   * (autorizado ≠ conectado).
   */
  registeredAt?: string;
  /** Falta registrar o número (fluxo padrão Cloud API). */
  registrationRequired?: boolean;
  /** O que a Meta disse que este onboarding é (nunca presumimos coexistence). */
  onboardingType?: 'standard' | 'coexistence' | 'unknown';
  /** Confirmação oficial server-to-server da Meta para Coexistence (is_on_biz_app=true && platform_type=CLOUD_API). */
  coexistenceConfirmedAt?: string;
  isOnBizApp?: boolean;
  platformType?: string;
}

// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 9 — INSTAGRAM DIRECT (canal de conversa)
// ═══════════════════════════════════════════════════════════════
// Estados do canal — os mesmos conceitos do WhatsApp, com os nomes do fluxo do
// Instagram: autorizou ≠ conectado. `webhook_pending` existe porque a Meta só
// entrega eventos depois que a conta é assinada (`subscribed_apps`), e
// `waiting_first_event` é o estado honesto de "tudo pronto, nada recebido".
export type InstagramStatus =
  | 'not_connected'
  | 'authorization_pending'
  | 'webhook_pending'
  | 'waiting_first_event'
  | 'connected'
  | 'error';

export interface InstagramIntegration {
  status: InstagramStatus;
  /** Identificador PÚBLICO da conta profissional (entry.id dos webhooks). */
  igUserId: string;
  /** @ do usuário profissional (público, vem da própria API). */
  username: string;
  /** Nome de exibição da conta profissional (público). */
  displayName: string;
  /** Quando a autorização (OAuth) foi concluída. */
  authorizedAt: string;
  /** Quando a Meta confirmou a assinatura do webhook desta conta. */
  webhookSubscribedAt: string;
  /** Quando o token foi trocado pelo de longa duração (60 dias). */
  tokenIssuedAt: string;
  /** Quando o token de longa duração precisa ser renovado (informativo). */
  tokenExpiresAt?: string;
  connectedAt: string;
  lastWebhookAt: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  requestedAt: string;
  /** Credencial criptografada por Business (AES-256-GCM). */
  encryptedAccessToken?: string;
  keyFingerprint?: string;
  /** Como a conta entrou: 'business_login' (fluxo oficial) ou 'master'. */
  source?: 'business_login' | 'master' | '';
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
  // ── A3.4 · Bloco 4 — operação do dia ──
  /** 'fit_in' = ENCAIXE: agendamento aceito fora da grade, com conflito
   *  reconhecido por quem criou. Ausente = agendamento normal. */
  bookingKind?: BookingKind;
  /** Check-in do cliente no balcão (ISO). Ausente = ainda não chegou. */
  checkedInAt?: string;
  /** Quem registrou o check-in (memberId) e o rótulo legível do autor. */
  checkedInBy?: string;
  checkedInByName?: string;
  /** P6 · veterinária — pet atendido ('' quando não se aplica). Aditivo. */
  petId?: string;
  /**
   * FASE 2 · P6 — CAMPO DERIVADO de leitura (a agenda resolve o pet ativo).
   * NUNCA é persistido nem aceito na escrita — existe só para a UI mostrar o
   * PET primeiro na clínica veterinária.
   */
  petName?: string;
}

/** Tipo do agendamento. `standard` é o fluxo normal da grade. */
export type BookingKind = 'standard' | 'fit_in';

// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 4 — FILA DE ESPERA (entidade PRÓPRIA)
// ═══════════════════════════════════════════════════════════════
// Fila NÃO é agenda: quem chega sem horário marcado não pode virar um Booking
// falso (ocuparia a grade, apareceria em relatório de agendamentos e mentiria
// sobre disponibilidade). A entrada de fila tem vida própria, pode virar
// atendimento depois (bookingId) e guarda os horários de chamada/atendimento.
export type QueueStatus = 'waiting' | 'called' | 'in_service' | 'done' | 'left';

export interface QueueEntry {
  id: ID;
  businessId: ID;
  customerName: string;
  customerPhone: string; // só dígitos (mesma chave do CRM)
  contactId: string; // '' = ainda não vinculado
  serviceId: string; // '' = a definir
  professionalId: string; // '' = qualquer um
  /** Agendamento de origem, quando a entrada veio de um horário marcado. */
  bookingId: string;
  note: string;
  status: QueueStatus;
  /** Dia do negócio em que entrou na fila (YYYY-MM-DD, fuso da unidade). */
  date: string;
  createdAt: string;
  calledAt: string;
  startedAt: string;
  endedAt: string; // done/left
  /** Quem operou a última transição (memberId/servidor). */
  updatedBy: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 5 — REGISTRO DO ATENDIMENTO (Encounter)
// ═══════════════════════════════════════════════════════════════
// O que foi feito, o que foi orientado e o que fica para a próxima vez. É uma
// ENTIDADE PRÓPRIA, separada do agendamento:
//   • um agendamento pode ter UM registro (1:1 opcional) — o histórico do
//     serviço prestado não pode ser um campo de texto livre no Booking;
//   • o registro tem dono (o profissional que atendeu) e escopo por unidade;
//   • nasce rascunho e é FINALIZADO (a partir daí, editar é decisão explícita
//     e auditada — registro de atendimento não muda sozinho).
export type EncounterStatus = 'draft' | 'finalized';

export interface Encounter {
  id: ID;
  businessId: ID;
  /** Agendamento de origem ('' quando o registro foi feito sem agendamento). */
  bookingId: string;
  /**
   * A3.4 fix (2ª revisão) — entrada da FILA de origem ('' quando não veio do
   * balcão). É a chave do 1:1 com o walk-in: um cliente que chegou sem horário
   * tem UM registro, mesmo que a tela seja aberta várias vezes.
   */
  queueId: string;
  serviceId: string;
  professionalId: string;
  customerId: string; // conta do cliente ('' = visitante/legado)
  contactId: string; // contato do CRM (fonte do histórico 360)
  customerName: string;
  /** Dia do atendimento (YYYY-MM-DD, fuso da unidade). */
  date: string;
  time: string;
  /** O que o cliente procurou / queixa principal. */
  complaint: string;
  /** O que foi feito (evolução do atendimento). */
  evolution: string;
  /** Orientações entregues ao cliente (aparecem na impressão). */
  guidance: string;
  /** Retorno sugerido (texto curto: "em 30 dias", "se persistir"). */
  followUp: string;
  /** Anotações internas — NÃO saem na impressão entregue ao cliente. */
  internalNote: string;
  /** Etiquetas livres (procedimentos, materiais, região tratada…). */
  tags: string[];
  status: EncounterStatus;
  /**
   * A3.4 fix (revisão B5): revisão OPTIMISTA. Cada alteração REAL grava
   * `version + 1`; a tela manda `expectedVersion` e o servidor recusa (409)
   * quando não bate. É o que impede duas abas de se sobrescreverem em
   * silêncio. Registros legados sem o campo valem 1 (ver `normalizeDB`).
   */
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  finalizedAt: string;
  finalizedBy: string;
  /** Quem assina o registro (nome do profissional no momento da finalização). */
  signedBy: string;
  /** P6 · veterinária — pet atendido ('' quando não se aplica). Aditivo. */
  petId?: string;
  // ── FASE 2 · P3 — retorno ESTRUTURADO (aditivo) ──
  // Ausente em dado legado (normalizeDB deriva: texto ⇒ 'custom', vazio ⇒ 'none').
  //   none    → sem retorno; date → data específica; interval → após N dias;
  //   custom  → só o texto livre (`followUp`, que continua imprimível).
  followUpMode?: EncounterFollowUpMode;
  followUpDate?: string; // YYYY-MM-DD (modo 'date')
  followUpDays?: number; // dias (modo 'interval')
  // Arquivos do atendimento: SÓ referências/metadados — o binário fica no
  // Storage (Vercel Blob), nunca no documento. Aditivo/ausente = sem arquivos.
  files?: EncounterFile[];
}

/** Como fica o acompanhamento depois deste atendimento. */
export type EncounterFollowUpMode = 'none' | 'date' | 'interval' | 'custom';

/** Referência de um arquivo anexado ao atendimento (Storage + metadados). */
export interface EncounterFile {
  id: ID;
  name: string;
  url: string;
  size: number;
  createdAt: string;
  by: string;
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
  // ── A3.3 — DADOS CADASTRAIS RICOS (carteirinha do cliente) ──
  // Campo ADITIVO e opcional: contato antigo simplesmente não tem perfil e a
  // UI mostra os campos vazios para preencher. Nada é migrado nem destruído.
  // Regra de compatibilidade: `profile` nunca substitui name/phone/email —
  // esses três continuam sendo a identidade usada no dedupe (lib/contacts.ts).
  profile?: ContactProfile;
  /**
   * A3.4 · B9 — identidades de CANAL da pessoa (Instagram hoje; WhatsApp entra
   * pelo telefone). Aditivo e opcional: contato antigo não tem a lista.
   *
   * Serve para duas coisas: achar a mesma pessoa quando ela volta a escrever
   * pelo mesmo canal (sem depender de nome) e registrar por onde ela veio. O
   * vínculo com um cadastro existente é sempre EXPLÍCITO — nada de merge por
   * nome ou por username.
   */
  channelIdentities?: ChannelIdentity[];
}

/**
 * Identidade externa de um canal. `participantId` é o identificador oficial do
 * usuário no provedor (IGSID no Instagram) — opaco e estável por conta.
 */
export interface ChannelIdentity {
  provider: 'instagram';
  /** Conta do negócio no provedor (conta profissional do Instagram). */
  accountId: string;
  /** Usuário no provedor (IGSID). */
  participantId: string;
  /** @ do usuário quando a API informar. Nunca é chave de dedupe. */
  username?: string;
  /** Quando este vínculo foi registrado. */
  linkedAt: string;
}

/** Endereço do cliente (A3.3). Todos os campos são texto livre opcional. */
export interface ContactAddress {
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}

/**
 * Responsável por menor de idade (A3.3).
 * `isMinor` é a declaração da equipe; a idade derivada da data de nascimento
 * também sinaliza menor de idade (lib/contact-profile.ts) — as duas fontes
 * aparecem na carteirinha, nunca se contradizem em silêncio.
 */
export interface ContactGuardian {
  /**
   * Declaração da equipe. SÓ vale quando não há data de nascimento: com
   * `birthDate` válida, a idade derivada é a autoridade (ponto 6 do
   * fechamento A3.3) — assim `isMinor: true` com nascimento em 1990 não
   * classifica um adulto como menor.
   */
  isMinor: boolean;
  name: string;
  phone: string; // só dígitos
  cpf: string;
  /**
   * Vínculo com outro `BusinessCustomer` da MESMA unidade ('' = responsável
   * ainda é texto livre). Reservado para o próximo passo — "vincular
   * responsável existente" — e opcional de propósito: nada hoje o exige,
   * então registros antigos continuam válidos sem migração.
   */
  contactId?: string;
  /** Grau de relação em texto livre ('' = não informado): mãe, pai, tutor… */
  relationship?: string;
}

/** Dados cadastrais do cliente/paciente (A3.3 — carteirinha). */
export interface ContactProfile {
  /** Nascimento em YYYY-MM-DD ('' = não informado). Idade é DERIVADA. */
  birthDate: string;
  /** CPF do cliente ('' = não informado). */
  cpf: string;
  /** Como a pessoa se identifica ('' = não informado). */
  gender: string;
  /** Observação administrativa (preferências, restrições, convênio…). */
  adminNote: string;
  address: ContactAddress;
  guardian: ContactGuardian;
  /** Etiquetas livres curtas (ex.: convênio, indicação, VIP). */
  tags: string[];
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

export interface DeletionAuthorization {
  tokenHash: string; userId: string; sessionHash: string;
  kind: 'business' | 'organization'; targetId: string; organizationId: string; targetName: string;
  expiresAt: number; usedAt: number;
}

export interface DB {
  /** Short-lived, single-action reauthentication. Never contains a password. */
  deletionAuthorizations?: DeletionAuthorization[];
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
  // ── A3.4 · Bloco 4: fila de espera (entidade própria, fora da agenda) ──
  queue: QueueEntry[];
  // ── A3.4 · Bloco 5: registros de atendimento (dado sensível, com dono) ──
  encounters: Encounter[];
  // ── FASE 2 · Product Revolution (ADITIVAS; defaults em normalizeDB) ──
  pets: Pet[]; // P6 — veterinária: tutor (contato) ≠ pet (paciente)
  anamneseTemplates: AnamneseTemplate[]; // P4 — motor único de anamnese
  anamneseResponses: AnamneseResponse[]; // P4 — respostas do paciente
  financeEntries: FinanceEntry[]; // P7 — financeiro básico (não é ERP)
  followUpRules: FollowUpRule[]; // P10/11 — fundação de follow-up
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

/** Eventos que LIGAM automações (Event Layer da Fase 3). */
export type AutomationEventId =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.stage_changed'
  | 'lead.assigned'
  | 'customer.created'
  | 'customer.updated'
  | 'booking.created'
  | 'booking.confirmed'
  | 'booking.rescheduled'
  | 'booking.cancelled'
  | 'booking.no_show'
  | 'booking.completed'
  | 'encounter.started'
  | 'encounter.completed'
  | 'followup.due'
  | 'patient.inactive'
  | 'conversation.started'
  | 'conversation.handoff'
  | 'message.received'
  | 'message.sent';

export const AUTOMATION_EVENTS: AutomationEventId[] = [
  'lead.created', 'lead.updated', 'lead.stage_changed', 'lead.assigned',
  'customer.created', 'customer.updated',
  'booking.created', 'booking.confirmed', 'booking.rescheduled',
  'booking.cancelled', 'booking.no_show', 'booking.completed',
  'encounter.started', 'encounter.completed',
  'followup.due', 'patient.inactive',
  'conversation.started', 'conversation.handoff',
  'message.received', 'message.sent',
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
  | 'dispatch_webhook'
  | 'send_channel_message';

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
  /** A3.4 fix (2ª revisão): pendência nascida de um atendimento (retorno). */
  encounterId?: string;
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
  | 'equipe' | 'config' | 'financeiro' | 'admin'
  // A3.4 · Bloco 5 — registro do atendimento (evolução, orientações e
  // histórico do serviço prestado). Dado próprio: NÃO vem junto com
  // "clientes" e não é dado por padrão para quem só opera o balcão.
  | 'atendimento';

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
// 'instagram' entrou de forma ADITIVA no Bloco 9: conversa antiga continua
// 'whatsapp'/'agent' e nada precisa migrar.
export type ConversationChannel = 'whatsapp' | 'instagram' | 'agent';
export type ConversationStatus = 'open' | 'closed';
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface Conversation {
  id: ID;
  businessId: ID;
  channel: ConversationChannel;
  /**
   * Identidade do PARTICIPANTE no canal — a chave que NÃO é telefone.
   * WhatsApp: wa_id; Instagram: IGSID (Instagram-scoped ID). Existe desde o
   * P6.1 e é o que o Bloco 9 usa para o Instagram (nunca o nome, nunca o
   * username).
   */
  channelUserId?: string;
  /**
   * A3.4 · B9 — conta do canal dona desta conversa (`entry.id` dos webhooks do
   * Instagram = conta profissional). Com `channelUserId`, forma a chave
   * estável e por unidade: businessId + channel + channelAccountId +
   * channelUserId.
   */
  channelAccountId?: string;
  /**
   * A3.4 · B9 (correção) — última mensagem RECEBIDA **deste participante nesta
   * conversa**. É a única fonte da janela de resposta do Instagram: mensagem do
   * cliente A não abre (nem renova) a janela do cliente B. Nunca diminui —
   * webhook atrasado/fora de ordem não retrocede o valor.
   */
  lastInboundAt?: string;
  /** @ do participante quando a API informa (exibição; nunca chave). */
  channelUsername?: string;
  contactId: string; // contato do CRM ('' quando ainda não resolvido)
  customerId: string;
  name: string;
  phone: string; // só dígitos
  status: ConversationStatus;
  mode?: 'automation' | 'human'; // 'automation' (padrão) | 'human' (equipe assumiu)
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
  externalId: string; // id do provedor (webhook: wamid)
  by: string; // userId do membro (envio interno) ou 'contact' (recebida) ou 'automation'
  byName?: string;
  channel?: string;
  channelUserId?: string;
  at: string;
  error?: string;
  claimToken?: string;
  claimExpiresAt?: string;
  attempts?: number;
  nextRetryAt?: string;
  meta?: Record<string, any>;
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
/** Estados em que a campanha pode ser CANCELADA (ainda não começou envio real: apenas draft ou ready).
 * Campanhas em 'sending' não podem ser canceladas nesta versão para evitar estados inconsistentes
 * na fila ativa de disparos e entrega pós-commit. */
export const CAMPAIGN_CANCELLABLE: CampaignStatus[] = ['draft', 'ready'];

export function campaignStatusDef(s: CampaignStatus): {
  label: string; editable: boolean; deletable: boolean; cancellable: boolean; tone: string;
} {
  const map: Record<CampaignStatus, { label: string; editable: boolean; deletable: boolean; cancellable: boolean; tone: string }> = {
    draft: { label: 'Rascunho', editable: true, deletable: true, cancellable: true, tone: 'zinc' },
    ready: { label: 'Pronta', editable: true, deletable: false, cancellable: true, tone: 'amber' },
    sending: { label: 'Enviando', editable: false, deletable: false, cancellable: false, tone: 'blue' },
    sent: { label: 'Enviada', editable: false, deletable: false, cancellable: false, tone: 'emerald' },
    partial: { label: 'Parcial', editable: false, deletable: false, cancellable: false, tone: 'orange' },
    failed: { label: 'Falhou', editable: false, deletable: false, cancellable: false, tone: 'red' },
    cancelled: { label: 'Cancelada', editable: true, deletable: false, cancellable: false, tone: 'zinc' },
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
  templateName?: string;
  templateLanguage?: string;
  templateParams?: Record<string, any>;
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
  externalId?: string;
  error: string;
  at: string;
  nextRetryAt?: string;
  attempts?: number;
  claimToken?: string;
  claimExpiresAt?: string;
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
  | 'entity.deletion_authorized' | 'entity.deletion_password_failed' | 'entity.deletion_denied' | 'entity.deleted'
  | 'support.view_started' | 'support.admin_started' | 'support.ended'
  | 'business.viewed' | 'business.updated_by_master'
  | 'member.created' | 'member.updated' | 'member.removed'
  | 'feature.updated' | 'module.updated'
  | 'campaign.created' | 'campaign.ready' | 'campaign.sent'
  | 'campaign.cancelled' | 'campaign.deleted'
  | 'whatsapp.connect_requested' | 'whatsapp.webhook_received'
  // A3.4 · Bloco 8 — onboarding real (Embedded Signup)
  | 'whatsapp.connected' | 'whatsapp.disconnected'
  | 'whatsapp.onboarding_blocked' | 'whatsapp.onboarding_failed'
  | 'whatsapp.registration_pending'
  | 'agent.updated' | 'organization.created' | 'unit.created'
  | 'master.created' | 'master.promoted' | 'master.revoked'
  | 'user.login'
  // P2 — vínculo de acesso e identidade do painel
  | 'member.professional_linked' | 'member.professional_unlinked'
  | 'appearance.updated' | 'contact.note_added'
  // Fechamento A3.3 — edição de nome/telefone/e-mail do contato da unidade
  | 'contact.identity_updated'
  // A3.4 · Bloco 4 — operação do dia (check-in e fila de espera)
  | 'booking.checkin' | 'booking.checkin_undo'
  | 'queue.created' | 'queue.updated' | 'queue.removed' | 'queue.booked'
  // A3.4 · Bloco 5 — registro do atendimento
  | 'encounter.created' | 'encounter.updated' | 'encounter.finalized'
  | 'encounter.reopened' | 'encounter.removed'
  // A3.4 · Bloco 7 — base de clientes entra e sai em arquivo
  | 'contact.imported' | 'contact.exported'
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
  | 'integration.token_rotated'
  // A3.4 · Bloco 9 — Instagram Direct entra no inbox unificado
  | 'instagram.connected' | 'instagram.disconnected'
  | 'instagram.onboarding_failed' | 'instagram.webhook_received'
  | 'instagram.token_refreshed' | 'instagram.token_refresh_failed'
  // FASE 2 · P4 — motor de anamnese (templates administrativos editáveis)
  | 'anamnese.template_created' | 'anamnese.template_updated'
  | 'anamnese.template_deleted' | 'anamnese.response_saved'
  // FASE 2 · P6 — pacientes veterinários (tutor ≠ pet)
  | 'pet.created' | 'pet.updated' | 'pet.deleted';

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

// ═══════════════════════════════════════════════════════════════
// FASE 2 — PRODUCT REVOLUTION (GoDoutor)
// Estruturas ADITIVAS. Nenhum dado legado é migrado nem destruído: arrays e
// campos novos ganham defaults em normalizeDB (db.ts). Um produto, presets.
// ═══════════════════════════════════════════════════════════════

// ── P5 · Tipo de clínica (preset, não aplicação separada) ──
export type ClinicType = 'medica' | 'odontologica' | 'veterinaria' | 'estetica' | 'geral';

export const VALID_CLINIC_TYPES: ClinicType[] = [
  'medica', 'odontologica', 'veterinaria', 'estetica', 'geral',
];

export function isClinicType(v: unknown): v is ClinicType {
  return typeof v === 'string' && (VALID_CLINIC_TYPES as string[]).includes(v);
}

// ── P6 · Veterinária: TUTOR (contato) ≠ PET (paciente) ──
// O tutor é um BusinessCustomer normal (pessoa de contato). O Pet é entidade
// própria ligada a um tutor; um tutor pode ter vários pets. Essa estrutura NÃO
// se aplica às outras clínicas (petId fica '' — aditivo e opcional).
export interface Pet {
  id: ID;
  businessId: ID;
  /** Tutor — contato do CRM (BusinessCustomer.id) dono do pet. */
  tutorId: ID;
  name: string;
  photo: string;
  species: string; // espécie: cachorro, gato, ave…
  breed: string; // raça
  sex: 'M' | 'F' | ''; // '' = não informado
  birthDate: string; // YYYY-MM-DD ('' = não informado); idade é derivada
  weightKg: number; // 0 = não informado
  notes: string; // observações (comportamento, alergias, cuidados)
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── P4 · Motor único de anamnese (template → campos → resposta) ──
// NÃO é uma tabela hardcoded por clínica: é um motor de formulários clínicos.
// Templates administrativos editáveis — NÃO são diagnóstico médico.
export type AnamneseFieldType =
  | 'text' | 'textarea' | 'boolean' | 'select' | 'multiselect'
  | 'number' | 'date' | 'scale' | 'note';

export interface AnamneseField {
  id: ID;
  label: string;
  type: AnamneseFieldType;
  required: boolean;
  help?: string; // texto de apoio exibido abaixo do rótulo
  options?: string[]; // select / multiselect
  scaleMin?: number; // escala
  scaleMax?: number;
  scaleMinLabel?: string; // rótulo dos extremos (ex.: "Nenhuma" / "Muita")
  scaleMaxLabel?: string;
}

export interface AnamneseTemplate {
  id: ID;
  businessId: ID;
  name: string;
  description: string;
  /** Preset de origem. '' = criado/editado pela clínica. */
  preset: ClinicType | 'custom' | '';
  fields: AnamneseField[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnamneseResponse {
  id: ID;
  businessId: ID;
  templateId: ID;
  /** Atendimento de origem ('' = resposta avulsa, sem atendimento). */
  encounterId: ID;
  /** Paciente (contato do CRM). */
  contactId: ID;
  /** Pet ('' quando não é veterinária). */
  petId: ID;
  professionalId: ID;
  /** fieldId → valor (string | number | boolean | string[] conforme o tipo). */
  answers: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy: ID;
}

// ── P7 · Financeiro básico (não é ERP) ──
export type FinanceKind = 'receita' | 'despesa';
export type FinanceStatus = 'previsto' | 'pendente' | 'pago' | 'cancelado';

export interface FinanceEntry {
  id: ID;
  businessId: ID;
  kind: FinanceKind;
  status: FinanceStatus;
  /** Valor em centavos (sempre positivo; o `kind` define receita/despesa). */
  amount: number;
  description: string;
  dueDate: string; // YYYY-MM-DD — data prevista
  paidAt: string; // YYYY-MM-DD — data do pagamento ('' = não pago)
  method: string; // pix | card | cash | … ('' = não informado)
  // Vínculos opcionais ('' = não vinculado).
  contactId: ID; // paciente
  bookingId: ID;
  serviceId: ID;
  professionalId: ID;
  encounterId: ID;
  note: string;
  createdAt: string;
  updatedAt: string;
  createdBy: ID;
}

// ── P10/11 · Follow-up: fundação (receitas internas) ──
// NÃO envia nada sozinho nesta fase. Cada receita descreve gatilho, atraso,
// público e ação pretendida. Quando o canal (WhatsApp) não estiver operacional,
// a UI mostra "Aguardando conexão do WhatsApp" — nunca finge envio.
export type FollowUpTrigger =
  | 'lead_no_booking' // lead não agendou após X tempo
  | 'before_appointment' // confirmação antes do atendimento
  | 'no_show' // após falta
  | 'after_completion' // pós-atendimento
  | 'return_due' // retorno na data/intervalo definido
  | 'inactive_patient'; // sem atendimento há X tempo

export interface FollowUpRule {
  id: ID;
  businessId: ID;
  name: string;
  trigger: FollowUpTrigger;
  active: boolean;
  /** Atraso em relação ao gatilho. */
  delayValue: number;
  delayUnit: 'minutes' | 'hours' | 'days';
  /**
   * Parâmetros do gatilho:
   *  - before_appointment: horas antes do atendimento;
   *  - inactive_patient: dias sem atendimento;
   *  - return_due: deriva do Encounter.followUp / data de retorno.
   */
  params: Record<string, unknown>;
  /** Ação pretendida (descrição; o canal pode não estar operacional). */
  action: string;
  channel: 'whatsapp' | 'interno' | 'email';
  /** Descrição do público (ex.: "todos os pacientes ativos"). */
  audience: string;
  createdAt: string;
  updatedAt: string;
}
