// ═══════════════════════════════════════════════════════════════
// InstaLink.app — Domínio universal (INSTA LINK ENGINE)
// Nenhuma entidade aqui é específica de nicho. Nichos são apenas
// configurações iniciais (templates) sobre este motor genérico.
// ═══════════════════════════════════════════════════════════════

export type ID = string;

export interface User {
  id: ID;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
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

export interface DayHours { open: string; close: string }

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

export interface Business {
  id: ID;
  ownerId: ID;
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
  address: string;
  mapsUrl: string;
  hours: Record<string, DayHours | null>; // 0=dom .. 6=sab
  paymentMethods: string[]; // pix | card | cash | on_delivery
  pixKey: string;
  deliveryFee: number; // centavos (0 = sem taxa / a combinar)
  minOrder: number; // centavos (0 = sem mínimo)
  googleUrl: string; // link "avaliar no Google" (place compartilhado)
  googlePlaceId: string; // para importar avaliações (opcional)
  googleApiKey: string; // Places API key do lojista (opcional, SECRETO)
  booking: BookingConfig;
  nav: string[]; // ids habilitados no menu (ordem canônica); usado quando navCustom
  navCustom: boolean; // false = detecção automática (negócios legados)
  about: AboutSection; // seção "Sobre a empresa" (título/texto/imagem)
  published: boolean;
  createdAt: string;
  updatedAt: string;
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
  address: string;
  mapsUrl: string;
  hours: Record<string, DayHours | null>;
  paymentMethods: string[];
  deliveryFee: number; // centavos (preço público)
  minOrder: number; // centavos (regra pública)
  booking: BookingConfig; // regras operacionais públicas (modo equipe, prazos)
  nav: string[]; // ids habilitados no menu (ordem canônica)
  navCustom: boolean; // false = detecção automática
  about: AboutSection;
  googleUrl: string;
  published: boolean;
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
  | 'products' | 'services' | 'booking' | 'testimonials' | 'faq'
  | 'location' | 'instagram' | 'whatsapp' | 'quote' | 'concierge';

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
  durationMin: number;
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
}

export interface Availability {
  id: ID;
  businessId: ID;
  professionalId: string; // '' = todos
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
  by: 'owner' | 'customer' | 'system';
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

export type EventType =
  | 'page_view' | 'button_click' | 'product_view' | 'product_add'
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
}
