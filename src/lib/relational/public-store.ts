// ═══════════════════════════════════════════════════════════════
// LEITURA PÚBLICA no modo relacional — página da clínica (/[slug]).
// ═══════════════════════════════════════════════════════════════
// Mesmo contrato de getPublicData (lib/public.ts), com consultas ESPECÍFICAS
// por unidade no SQL: negócio por slug, página, catálogo, serviços,
// profissionais, avaliações publicadas e agenda (aberto/agora). Nada disto
// toca no documento legado. Módulo LEVE de propósito: nada aqui importa a
// graph de automação (executor/conectores) — a página pública é caminho quente.
import type { PoolClient } from 'pg';
import { getPool } from './pool';
import { rowToBusiness } from './business-row';
import {
  rowToService, rowToProfessional, rowToAvailability, rowToException,
} from './mapping';
import type {
  BusinessAgent, Category, DB, Page, Product, ProductOption, ProductOptionValue,
  Professional, PublicBusiness, Review, Service,
} from '../types';
import { agentFor, defaultAgent } from '../agent';
import { getBusinessOpenStatus, type OpenStatus } from '../hours';
import { COOKIE_NAME, getUserBySession } from '../auth';
import { cookies } from 'next/headers';


const s = (v: unknown): string => String(v ?? '');
const n = (v: unknown, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d);
const b = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const j = <T>(v: unknown, d: T): T => {
  if (v == null) return d;
  if (typeof v === 'object') return v as T;
  try { return JSON.parse(String(v)) as T; } catch { return d; }
};

// ── Linha → domínio (espelho do import/transform.ts) ──
export function rowToPage(r: any): Page {
  return {
    id: s(r.id), businessId: s(r.business_id), presetId: s(r.preset_id),
    theme: j(r.theme, {} as any), blocks: j(r.blocks, [] as any[]),
    updatedAt: iso(r.updated_at),
  } as Page;
}
function rowToCategory(r: any): Category {
  return {
    id: s(r.id), businessId: s(r.business_id), kind: s(r.kind) as Category['kind'],
    name: s(r.name), order: n(r.order), active: b(r.active, true),
  };
}
function rowToProduct(r: any): Product {
  return {
    id: s(r.id), businessId: s(r.business_id), categoryId: s(r.category_id),
    name: s(r.name), description: s(r.description), image: s(r.image),
    price: n(r.price), promoPrice: n(r.promo_price),
    active: b(r.active, true), featured: b(r.featured), order: n(r.order),
  };
}
function rowToOption(r: any): ProductOption {
  return {
    id: s(r.id), businessId: s(r.business_id), productId: s(r.product_id),
    name: s(r.name), required: b(r.required), multiple: b(r.multiple),
    min: n(r.min), max: n(r.max), order: n(r.order),
  };
}
function rowToOptionValue(r: any): ProductOptionValue {
  return {
    id: s(r.id), optionId: s(r.option_id), name: s(r.name),
    priceDelta: n(r.price_delta), active: b(r.active, true),
  };
}
function rowToReview(r: any): Review {
  return {
    id: s(r.id), businessId: s(r.business_id), customerId: s(r.customer_id),
    customerName: s(r.customer_name), rating: n(r.rating, 5), text: s(r.text),
    source: s(r.source) || 'site', status: s(r.status) || 'pending',
    orderId: s(r.order_id), bookingId: s(r.booking_id), externalId: s(r.external_id),
    createdAt: iso(r.created_at),
  } as Review;
}
function rowToAgent(r: any): BusinessAgent {
  const base = defaultAgent(s(r.business_id), '');
  return {
    ...base,
    id: s(r.id), businessId: s(r.business_id), name: s(r.name),
    enabled: b(r.enabled, true), greeting: s(r.greeting), tone: s(r.tone) || base.tone,
    objectives: j<string[]>(r.objectives, base.objectives),
    instructions: s(r.instructions), restrictions: s(r.restrictions),
    handoffMessage: s(r.handoff_message) || base.handoffMessage,
    knowledgeOverride: s(r.knowledge_override),
    channels: j(r.channels, { site: true, whatsapp: false }),
    ...(r.created_at ? { createdAt: iso(r.created_at) } : {}),
    ...(r.updated_at ? { updatedAt: iso(r.updated_at) } : {}),
  } as BusinessAgent;
}

export interface RelPublicData {
  business: ReturnType<typeof rowToBusiness>;
  page: Page;
  categories: Category[];
  products: Product[];
  options: ProductOption[];
  optionValues: ProductOptionValue[];
  services: Service[];
  serviceCategories: Category[];
  professionals: Professional[];
  reviews: Review[];
  isOwnerPreview: boolean;
  agent: BusinessAgent;
  openNow: OpenStatus | null;
  /** Rascunho visto por visitante: página enxuta, sem conteúdo privado. */
  notPublished?: boolean;
}

/**
 * Dados da página pública direto do SQL. `null` = slug inexistente.
 * Nunca reconstrói documento: cada bloco é uma consulta por unidade.
 */
export async function relPublicData(slug: string): Promise<RelPublicData | null> {
  const pool = getPool();
  const client: PoolClient = await pool.connect();
  try {
    const bizRes = await client.query('SELECT * FROM app.businesses WHERE slug = $1 LIMIT 1', [slug]);
    if (bizRes.rows.length === 0) return null;
    const business = rowToBusiness(bizRes.rows[0]);
    const pageRes = await client.query('SELECT * FROM app.pages WHERE business_id = $1 LIMIT 1', [business.id]);
    if (pageRes.rows.length === 0) return null;
    const page = rowToPage(pageRes.rows[0]);

    const user = await getUserBySession(cookies().get(COOKIE_NAME)?.value);
    const isOwner = !!user && business.ownerId === user.id;
    if (!business.published && !isOwner) {
      return {
        business, page,
        categories: [], products: [], options: [], optionValues: [], services: [],
        serviceCategories: [], professionals: [], reviews: [],
        isOwnerPreview: false, agent: defaultAgent(business.id, business.name), openNow: null,
        notPublished: true,
      };
    }

    const one = async (sql: string) => (await client.query(sql, [business.id])).rows;
    const [categories, products, options, services, professionals, reviewsRows, availability, exceptions, agentsRows] = await Promise.all([
      one(`SELECT * FROM app.categories WHERE business_id = $1 AND kind = 'product' AND active ORDER BY "order" ASC`),
      one(`SELECT * FROM app.products WHERE business_id = $1 AND active ORDER BY featured DESC, "order" ASC`),
      one(`SELECT * FROM app.product_options WHERE business_id = $1`),
      one(`SELECT * FROM app.services WHERE business_id = $1 AND active`),
      one(`SELECT * FROM app.professionals WHERE business_id = $1 AND active`),
      one(`SELECT * FROM app.reviews WHERE business_id = $1 AND status = 'published' ORDER BY created_at DESC LIMIT 4`),
      one(`SELECT * FROM app.availability WHERE business_id = $1`),
      one(`SELECT * FROM app.availability_exceptions WHERE business_id = $1`),
      one(`SELECT * FROM app.agents WHERE business_id = $1`),
    ]);
    const productCategories = categories.map(rowToCategory);
    const optionsList = options.map(rowToOption);
    const optionValues = (await client.query(
      `SELECT v.* FROM app.product_option_values v
        WHERE v.option_id = ANY($1) AND v.active = true`,
      [optionsList.length ? optionsList.map((o) => o.id) : ['__none__']],
    )).rows.map(rowToOptionValue);
    const reviews = reviewsRows.map(rowToReview);

    const agentDb = { agents: agentsRows.length ? [rowToAgent(agentsRows[0])] : [] } as unknown as DB;
    const openNow = getBusinessOpenStatus(business as any, availability.map(rowToAvailability), exceptions.map(rowToException));
    return {
      business, page,
      categories: productCategories,
      products: products.map(rowToProduct),
      options: optionsList,
      optionValues,
      services: services.map(rowToService),
      serviceCategories: (await client.query(
        `SELECT * FROM app.categories WHERE business_id = $1 AND kind = 'service' AND active ORDER BY "order" ASC`,
        [business.id],
      )).rows.map(rowToCategory),
      professionals: professionals.map(rowToProfessional),
      reviews,
      isOwnerPreview: isOwner && !business.published,
      agent: agentFor(agentDb, business as any),
      openNow,
    };
  } finally {
    client.release();
  }
}
