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

export type Niche =
  | 'alimentacao' | 'loja' | 'beleza' | 'saude' | 'servicos'
  | 'profissional' | 'educacao' | 'pet' | 'outro';

export type BusinessMode =
  | 'products' | 'services' | 'bookings' | 'orders' | 'quote';

export interface DayHours { open: string; close: string }

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
  googleUrl: string; // link "avaliar no Google" (place compartilhado)
  googlePlaceId: string; // para importar avaliações (opcional)
  googleApiKey: string; // Places API key do lojista (opcional)
  published: boolean;
  createdAt: string;
  updatedAt: string;
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
  active: boolean;
  featured: boolean;
  bookable: boolean;
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
  customerId: string; // '' = sem conta (legado)
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
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';

export interface Booking {
  id: ID;
  businessId: ID;
  customerId: string; // '' = sem conta (legado)
  serviceId: ID;
  professionalId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  customerName: string;
  customerPhone: string;
  status: BookingStatus;
  note: string;
  createdAt: string;
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

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

export interface Lead {
  id: ID;
  businessId: ID;
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
  reviews: Review[];
  events: AnalyticsEvent[];
}
