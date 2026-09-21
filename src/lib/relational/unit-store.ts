// ═══════════════════════════════════════════════════════════════
// CADASTRO/CONFIGURAÇÃO DE UNIDADE no modo relacional (SQL direto).
// ═══════════════════════════════════════════════════════════════
// Mesmas regras de /api/businesses (POST) e /api/pages (PUT): organização
// resolvida e autorizada no servidor, slug único com sufixo de colisão,
// template inicial coerente com os módulos, membro ADMIN quando o dono da
// unidade difere do operador, auditoria. Nada toca no documento legado.
import { randomUUID } from 'node:crypto';
import { getPool } from './pool';
import { rowToBusiness } from './business-row';
import { rowToPage } from './public-store';
import type { User } from '../types';
import { isMasterUser } from '../access-core';

const j = (v: unknown): string => JSON.stringify(v ?? null);

/** Linha businesses → SQL (espelho do import/transform.ts). */
export function businessToRow(b: any, now: string): Record<string, unknown> {
  return {
    id: b.id, organization_id: b.organizationId || null, owner_id: b.ownerId,
    name: b.name ?? '', slug: b.slug ?? '', description: b.description ?? '',
    logo: b.logo ?? '', cover: b.cover ?? '', niche: b.niche || 'outro',
    modes: j(b.modes ?? []), features: j(b.features),
    products_off: typeof b.productsOff === 'boolean' ? b.productsOff : null,
    whatsapp_integration: j(b.whatsappIntegration),
    instagram_integration: j(b.instagramIntegration),
    phone: b.phone ?? '', whatsapp: b.whatsapp ?? '', email: b.email ?? '',
    instagram: b.instagram ?? '', tiktok: b.tiktok ?? '',
    socials: j(b.socials ?? {}), address: b.address ?? '', maps_url: b.mapsUrl ?? '',
    hours: j(b.hours ?? {}), business_timezone: b.businessTimezone || null,
    payment_methods: j(b.paymentMethods ?? []), pix_key: b.pixKey ?? '',
    delivery_fee: b.deliveryFee ?? 0, min_order: b.minOrder ?? 0,
    google_url: b.googleUrl ?? '', google_place_id: b.googlePlaceId ?? '', google_api_key: b.googleApiKey ?? '',
    booking: j(b.booking ?? null), nav: j(b.nav ?? []), nav_custom: b.navCustom === true,
    nav_items: j(b.navItems), automations: j(b.automations),
    capability_flags: j(b.capabilityFlags), about: j(b.about ?? null),
    appearance: j(b.appearance), published: b.published === true,
    subscription: j(b.subscription),
    created_at: new Date(b.createdAt || now), updated_at: new Date(b.updatedAt || now),
  };
}

export function pageToRow(p: any, now: string): Record<string, unknown> {
  return {
    id: p.id, business_id: p.businessId, preset_id: p.presetId ?? '',
    theme: j(p.theme ?? {}), blocks: j(p.blocks ?? []),
    updated_at: new Date(p.updatedAt || now),
  };
}

/** A organização é gerenciável pelo usuário? (espelho de canManageOrganization) */
export async function relCanManageOrganization(user: User, organizationId: string): Promise<boolean> {
  if (isMasterUser(user)) return false;
  const pool = getPool();
  const org = await pool.query('SELECT owner_id FROM app.organizations WHERE id = $1', [organizationId]);
  if (org.rows.length === 0) return false;
  if (org.rows[0].owner_id === user.id) return true;
  const member = await pool.query(
    `SELECT 1 FROM app.organization_members
      WHERE organization_id = $1 AND user_id = $2 AND active = true AND role = 'ADMIN' LIMIT 1`,
    [organizationId, user.id],
  );
  return member.rows.length > 0;
}

/** Organizações visíveis (espelho de organizationsFor — dono, vínculo de unidade ou membro). */
export async function relOrganizationsFor(user: User): Promise<Array<{ id: string; ownerId: string }>> {
  const pool = getPool();
  const owned = await pool.query('SELECT id, owner_id FROM app.organizations WHERE owner_id = $1', [user.id]);
  const member = await pool.query(
    'SELECT o.id, o.owner_id FROM app.organizations o JOIN app.organization_members m ON m.organization_id = o.id WHERE m.user_id = $1 AND m.active = true',
    [user.id],
  );
  const unitOrgs = await pool.query(
    `SELECT DISTINCT o.id, o.owner_id FROM app.organizations o
       JOIN app.businesses b ON b.organization_id = o.id
       JOIN app.members m ON m.business_id = b.id
      WHERE m.user_id = $1 AND m.active = true`,
    [user.id],
  );
  const out = new Map<string, { id: string; ownerId: string }>();
  for (const r of [...owned.rows, ...member.rows, ...unitOrgs.rows]) out.set(String(r.id), { id: String(r.id), ownerId: String(r.owner_id) });
  return [...out.values()];
}

export interface RelCreateBusinessInput {
  user: User;
  name: string;
  slug: string;
  niche: string;
  modes: string[];
  organizationId: string;
  whatsapp: string;
  address: string;
  // Saídas do template (puros — MESMA fonte do caminho do documento):
  defaultBookingConfig: () => any;
  defaultWhatsappIntegration: () => any;
  normalizeFeatures: (b: any, blocks: any[]) => any;
  defaultBlocks: (niche: any, modes: any[]) => any[];
  defaultPresetId: (niche: any) => string;
  defaultTheme: (niche: any) => any;
  NEW_BUSINESS_DEFAULTS: Record<string, unknown>;
  audit: { action: string; actor: User; businessId: string; meta: Record<string, unknown>; at: string };
}

export interface RelCreateBusinessResult {
  businessId: string;
  organizationId: string;
  slug: string;
  ownerId: string;
}

/**
 * Cria organização (quando nova) + unidade + página inicial + membro ADMIN
 * (quando o dono da unidade difere do operador) + auditoria — UMA transação.
 * Colisão de slug resolve com sufixo numérico (mesma política do documento).
 */
export async function relCreateBusiness(input: RelCreateBusinessInput): Promise<RelCreateBusinessResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Organização: existente (reautorizada DENTRO da transação) ou nova.
    let organizationId = input.organizationId;
    if (organizationId) {
      const ok = await relCanManageOrganizationTx(client, input.user, organizationId);
      if (!ok) throw Object.assign(new Error('ORGANIZATION_UNAVAILABLE'), { code: 'ORG' });
    } else {
      organizationId = randomUUID();
    }
    const orgRow = (await client.query('SELECT owner_id FROM app.organizations WHERE id = $1', [organizationId])).rows[0];
    const now = new Date().toISOString();
    if (!orgRow) {
      await client.query(
        `INSERT INTO app.organizations (id, name, owner_id, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, '{}'::jsonb, $4, $4)`,
        [organizationId, input.name, input.user.id, now],
      );
    }
    const unitOwnerId = orgRow ? String(orgRow.owner_id) : input.user.id;

    // Slug único (colisão → sufixo 10–99, como no documento).
    let slug = input.slug;
    const slugFree = async (candidate: string) =>
      (await client.query('SELECT 1 FROM app.businesses WHERE slug = $1 LIMIT 1', [candidate])).rows.length === 0;
    if (!(await slugFree(slug))) {
      let attempt = 0;
      do {
        slug = `${input.slug}${Math.floor(Math.random() * 90 + 10)}`;
        attempt += 1;
      } while (attempt < 12 && !(await slugFree(slug)));
      if (!(await slugFree(slug))) throw Object.assign(new Error('SLUG_UNAVAILABLE'), { code: 'SLUG' });
    }

    const businessId = randomUUID();
    const business: any = {
      id: businessId, ownerId: unitOwnerId, organizationId, name: input.name, slug,
      description: '', logo: '', cover: '', niche: input.niche, modes: input.modes,
      phone: '', whatsapp: input.whatsapp, email: '', instagram: '', tiktok: '',
      address: input.address, mapsUrl: '', hours: {}, paymentMethods: ['pix'], pixKey: '',
      deliveryFee: 0, minOrder: 0,
      googleUrl: '', googlePlaceId: '', googleApiKey: '',
      booking: input.defaultBookingConfig(),
      nav: [], navCustom: false,
      about: { title: '', text: '', image: '', enabled: false },
      whatsappIntegration: input.defaultWhatsappIntegration(),
      published: false, createdAt: now, updatedAt: now,
    };
    const blocks = input.defaultBlocks(input.niche, input.modes);
    business.features = input.normalizeFeatures(
      { about: { title: '', text: '', image: '', enabled: false }, nav: [], modes: input.modes, features: undefined },
      blocks,
    );
    const bRow = businessToRow(business, now);
    const bCols = Object.keys(bRow);
    await client.query(
      `INSERT INTO app.businesses (${bCols.join(', ')}) VALUES (${bCols.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(bRow),
    );
    if (unitOwnerId !== input.user.id) {
      await client.query(
        `INSERT INTO app.members (id, business_id, user_id, role, permissions, active, note, invited_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'ADMIN', '{}'::jsonb, true, $4, $5, $6, $6)`,
        [randomUUID(), businessId, input.user.id, 'Administrador da organização', unitOwnerId, now],
      );
    }
    const page: any = {
      id: randomUUID(), businessId, presetId: input.defaultPresetId(input.niche),
      theme: input.defaultTheme(input.niche), blocks, updatedAt: now,
    };
    const pRow = pageToRow(page, now);
    const pCols = Object.keys(pRow);
    await client.query(
      `INSERT INTO app.pages (${pCols.join(', ')}) VALUES (${pCols.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(pRow),
    );
    await client.query(
      `INSERT INTO app.audit (id, at, action, actor_user_id, actor_email, actor_role, business_id, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        randomUUID(), input.audit.at, input.audit.action, input.audit.actor.id || '', input.audit.actor.email || '',
        input.audit.actor.role || '', businessId, JSON.stringify({ ...(input.audit.meta || {}), organizationId }),
      ],
    );
    await client.query('COMMIT');
    return { businessId, organizationId, slug, ownerId: unitOwnerId };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* conexão já quebrou */ }
    throw e;
  } finally {
    client.release();
  }
}

async function relCanManageOrganizationTx(client: import('pg').PoolClient, user: User, organizationId: string): Promise<boolean> {
  if (isMasterUser(user)) return false;
  const org = await client.query('SELECT owner_id FROM app.organizations WHERE id = $1', [organizationId]);
  if (org.rows.length === 0) return false;
  if (String(org.rows[0].owner_id) === user.id) return true;
  const member = await client.query(
    `SELECT 1 FROM app.organization_members
      WHERE organization_id = $1 AND user_id = $2 AND active = true AND role = 'ADMIN' LIMIT 1`,
    [organizationId, user.id],
  );
  return member.rows.length > 0;
}

/** Slug já usado por OUTRA unidade? (pages PUT) */
export async function relSlugTakenByOther(slug: string, businessId: string): Promise<boolean> {
  const r = await getPool().query(
    'SELECT 1 FROM app.businesses WHERE slug = $1 AND id <> $2 LIMIT 1',
    [slug, businessId],
  );
  return r.rows.length > 0;
}

/** Leitura fresca negócio+página (o editor revalida do ESTADO CANÔNICO). */
export async function relBusinessWithPage(businessId: string): Promise<{ business: ReturnType<typeof rowToBusiness> | null; page: ReturnType<typeof rowToPage> | null }> {
  const pool = getPool();
  const biz = await pool.query('SELECT * FROM app.businesses WHERE id = $1', [businessId]);
  const page = await pool.query('SELECT * FROM app.pages WHERE business_id = $1', [businessId]);
  return {
    business: biz.rows[0] ? rowToBusiness(biz.rows[0]) : null,
    page: page.rows[0] ? rowToPage(page.rows[0]) : null,
  };
}
