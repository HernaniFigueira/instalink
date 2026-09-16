// ═══════════════════════════════════════════════════════════════
// API KEYS — CREDENCIAIS DE INTEGRAÇÃO EXTERNA (P3)
// ═══════════════════════════════════════════════════════════════
// Segurança estrita:
//  - Chave forte aleatória prefixada (`ik_live_...`);
//  - O banco armazena apenas SHA-256 e o prefixo visível;
//  - O segredo completo é retornado SOMENTE no momento da criação;
//  - Revogação com efeito imediato;
//  - Tenant isolation absoluto: cada chave é amarrada a um Business.
//    O contexto autenticado deriva o Business da chave, ignorando
//    qualquer tentativa de sobrescrita externa.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from './db';
import type { ApiKey, Business, DB } from './types';

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret.trim()).digest('hex');
}

export function generateRawSecret(): string {
  return `ik_live_${randomBytes(24).toString('hex')}`;
}

/** Cria uma nova chave de API para o negócio. */
export function createApiKey(
  db: DB,
  businessId: string,
  name: string,
  userId?: string,
  now = new Date().toISOString(),
): { apiKey: ApiKey; fullSecret: string } {
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) throw Object.assign(new Error('Negócio não encontrado.'), { status: 404 });

  if (!Array.isArray(db.apiKeys)) db.apiKeys = [];

  const fullSecret = generateRawSecret();
  const keyHash = hashApiKey(fullSecret);
  const keyPrefix = `${fullSecret.slice(0, 16)}...`;

  const apiKey: ApiKey = {
    id: randomUUID(),
    businessId,
    name: (name || 'Integração externa').trim().slice(0, 60),
    keyPrefix,
    keyHash,
    createdAt: now,
    createdByUserId: userId || '',
  };

  db.apiKeys.push(apiKey);
  return { apiKey, fullSecret };
}

/** Revoga uma chave de API com efeito imediato. */
export function revokeApiKey(
  db: DB,
  businessId: string,
  keyId: string,
  now = new Date().toISOString(),
): boolean {
  if (!Array.isArray(db.apiKeys)) db.apiKeys = [];
  const key = db.apiKeys.find((k) => k.id === keyId && k.businessId === businessId);
  if (!key) return false;
  if (key.revokedAt) return true;
  key.revokedAt = now;
  return true;
}

/** Lista chaves ativas e revogadas do negócio sem expor hashes. */
export function listApiKeys(db: DB, businessId: string): Omit<ApiKey, 'keyHash'>[] {
  if (!Array.isArray(db.apiKeys)) db.apiKeys = [];
  return db.apiKeys
    .filter((k) => k.businessId === businessId)
    .map(({ keyHash, ...safe }) => safe)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Valida o segredo cru contra a base (retorna chave e negócio associado). */
export function authenticateKey(db: DB, rawKey: string): { apiKey: ApiKey; business: Business } | null {
  const secret = String(rawKey || '').trim();
  if (!secret || !secret.startsWith('ik_live_')) return null;

  const keyHash = hashApiKey(secret);
  if (!Array.isArray(db.apiKeys)) db.apiKeys = [];

  const key = db.apiKeys.find((k) => k.keyHash === keyHash && !k.revokedAt);
  if (!key) return null;

  const business = db.businesses.find((b) => b.id === key.businessId);
  if (!business) return null;

  return { apiKey: key, business };
}

/** Extrai a chave de API dos headers da requisição. */
export function extractApiKey(req: NextRequest): string {
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const xApiKey = req.headers.get('x-api-key') || '';
  if (xApiKey) return xApiKey.trim();
  return '';
}

export type ApiKeyAuthResult =
  | { ok: true; db: DB; business: Business; apiKey: ApiKey }
  | { ok: false; res: NextResponse };

/**
 * Guarda central das APIs externas.
 * Tenant Isolation: o `business` vem EXCLUSIVAMENTE da chave autenticada.
 */
export async function requireApiKey(req: NextRequest): Promise<ApiKeyAuthResult> {
  const rawKey = extractApiKey(req);
  if (!rawKey) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Credencial de integração ausente. Forneça o header Authorization: Bearer ik_live_... ou X-Api-Key.', code: 'api_key_required' },
        { status: 401 },
      ),
    };
  }

  const db = await readDB();
  const auth = authenticateKey(db, rawKey);
  if (!auth) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Chave de integração inválida ou revogada.', code: 'api_key_invalid' },
        { status: 401 },
      ),
    };
  }

  // Atualiza lastUsedAt oportunisticamente
  auth.apiKey.lastUsedAt = new Date().toISOString();

  return {
    ok: true,
    db,
    business: auth.business,
    apiKey: auth.apiKey,
  };
}
