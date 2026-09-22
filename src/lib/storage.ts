// ═══════════════════════════════════════════════════════════════
// SUPABASE STORAGE — uploads do GoDoutor (só servidor).
// ═══════════════════════════════════════════════════════════════
// Dois buckets (migração 0002), regras distintas:
//   • clinic-media  (PÚBLICO)  → fotos da clínica: logo, capa, catálogo,
//     página. Servidas por /object/public/... (sem assinatura).
//   • patient-files (PRIVADO)  → arquivos de pacientes. Leitura SOMENTE por
//     URL TEMPORÁRIA assinada pelo servidor, com autorização da unidade.
//
// Segurança do conteúdo: o tipo declarado pelo cliente NUNCA é a verdade — o
// tipo real vem dos MAGIC BYTES do arquivo; extensão executável nunca é
// derivada do nome enviado. Nomes são UUID do servidor
// (`{businessId}/{uuid}.{ext}`) — nada do usuário vira caminho.
//
// Credenciais: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY apenas no servidor
// (service_role bypassa RLS do Storage — nunca expor ao browser).
import { randomUUID } from 'node:crypto';
import { storageConfig } from './relational/config';

export type UploadKind = 'clinic' | 'patient';

export const CLINIC_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
export const PATIENT_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export const CLINIC_MAX_BYTES = 5 * 1024 * 1024;   // 5 MB
export const PATIENT_MAX_BYTES = 15 * 1024 * 1024; // 15 MB

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif', 'application/pdf': 'pdf',
};

/**
 * Tipo REAL do arquivo pelos magic bytes (a extensão enviada é ignorada —
 * é isso que impede um .exe ou .html de passar por "imagem").
 */
export function sniffContentType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png';
  const ascii = (start: number, text: string) => buffer.slice(start, start + text.length).toString('latin1') === text;
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  // AVIF/HEIF container: bytes 4-7 = 'ftyp', brand em 8-11.
  if (ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'))) return 'image/avif';
  if (ascii(0, '%PDF-')) return 'application/pdf';
  return null;
}

export interface SniffDecision {
  ok: boolean;
  reason?: 'empty' | 'too_large' | 'unknown_type' | 'type_not_allowed';
  contentType?: string; // o REAL (magic bytes)
  ext?: string;
}

/** Validação comum (tamanho + conteúdo real + allowlist por finalidade). */
export function validateUpload(
  buffer: Buffer,
  kind: UploadKind,
  opts: { declaredType?: string } = {},
): SniffDecision {
  const max = kind === 'clinic' ? CLINIC_MAX_BYTES : PATIENT_MAX_BYTES;
  if (buffer.length === 0) return { ok: false, reason: 'empty' };
  if (buffer.length > max) return { ok: false, reason: 'too_large' };
  const real = sniffContentType(buffer);
  if (!real) return { ok: false, reason: 'unknown_type' }; // executável/HTML/etc. → recusa
  const allowed = kind === 'clinic' ? CLINIC_MIME : PATIENT_MIME;
  if (!allowed.has(real)) return { ok: false, reason: 'type_not_allowed', contentType: real };
  return { ok: true, contentType: real, ext: EXT[real] || 'bin' };
}

// ── Autorização do arquivo PRIVADO (item 4 do roteiro) ──
// O servidor confirma, ANTES de enviar/assinar:
//   1. o contato EXISTE e pertence à UNIDADE (nunca cross-tenant);
//   2. o OPERADOR tem escopo: com escopo de profissional ativo, só pode
//      anexar em contatos que ATENDE (existe atendimento dele com o contato).
// Devolve o contato (dono do dado) ou o motivo da recusa.
export async function authorizePatientUpload(
  businessId: string,
  contactId: string,
  operator: { professionalScope: string },
): Promise<{ ok: true; contactName: string } | { ok: false; reason: 'not_found' | 'out_of_scope' }> {
  const { getPool } = await import('./relational/pool');
  const pool = getPool();
  const c = await pool.query(
    'SELECT id, name FROM app.contacts WHERE id = $1 AND business_id = $2',
    [contactId, businessId],
  );
  if (c.rows.length === 0) return { ok: false, reason: 'not_found' };
  if (operator.professionalScope) {
    const link = await pool.query(
      `SELECT 1 FROM app.bookings
        WHERE business_id = $1 AND customer_phone = (SELECT phone FROM app.contacts WHERE id = $2)
          AND professional_id = $3 LIMIT 1`,
      [businessId, contactId, operator.professionalScope],
    );
    if (link.rows.length === 0) return { ok: false, reason: 'out_of_scope' };
  }
  return { ok: true, contactName: String(c.rows[0].name || '') };
}

/** Referência PERMANENTE do arquivo privado (a URL assinada expira; isto não). */
export async function registerPatientFile(input: {
  businessId: string; contactId: string; bucket: string; path: string;
  contentType: string; sizeBytes: number; uploadedBy: string; originalName: string;
}): Promise<string> {
  const { getPool } = await import('./relational/pool');
  const pool = getPool();
  const id = randomUUID();
  await pool.query(
    `INSERT INTO app.patient_files
       (id, business_id, contact_id, bucket, path, content_type, size_bytes, original_name, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, input.businessId, input.contactId, input.bucket, input.path,
      input.contentType, input.sizeBytes, input.originalName.slice(0, 160), input.uploadedBy],
  );
  return id;
}

export async function getPatientFileRecord(id: string): Promise<{
  id: string; businessId: string; contactId: string; bucket: string; path: string; contentType: string;
} | null> {
  const { getPool } = await import('./relational/pool');
  const pool = getPool();
  const r = await pool.query(
    'SELECT id, business_id, contact_id, bucket, path, content_type FROM app.patient_files WHERE id = $1',
    [id],
  );
  if (!r.rows[0]) return null;
  const f = r.rows[0];
  return {
    id: String(f.id), businessId: String(f.business_id), contactId: String(f.contact_id),
    bucket: String(f.bucket), path: String(f.path), contentType: String(f.content_type),
  };
}

// ── Cliente REST do Storage (fetch — sem dependência nova no bundle) ──

export interface StoredObject {
  bucket: string;
  path: string;   // caminho completo no bucket
  url: string;    // clinic: URL pública; patient: URL temporária
  expiresAt?: string; // só patient (URL assinada)
}

function storageHeaders(cfg: { serviceKey: string }, contentType: string): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.serviceKey}`,
    'Content-Type': contentType,
    'x-upsert': 'false',
  };
}

/**
 * Foto da CLÍNICA → bucket público. Preserva o contrato `{ ok, url }` dos
 * consumidores (página, catálogo, configuração).
 */
export async function uploadClinicImage(
  businessId: string,
  buffer: Buffer,
  contentType: string,
  ext: string,
): Promise<StoredObject> {
  const cfg = storageConfig();
  if (!cfg) throw new Error('Storage não configurado (defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY).');
  const path = `${businessId}/${randomUUID()}.${ext}`;
  const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.publicBucket}/${path}`, {
    method: 'POST',
    headers: storageHeaders(cfg, contentType),
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Falha no upload (clinic-media): ${res.status} ${detail.slice(0, 200)}`);
  }
  return {
    bucket: cfg.publicBucket,
    path,
    url: `${cfg.url}/storage/v1/object/public/${cfg.publicBucket}/${path}`,
  };
}

/**
 * Arquivo de PACIENTE → bucket PRIVADO. O caminho inclui o contato (dono do
 * dado); a leitura acontece por URL temporária criada AQUI, no servidor,
 * depois de autorizar a unidade/papel.
 */
export async function uploadPatientFile(
  businessId: string,
  contactId: string,
  buffer: Buffer,
  contentType: string,
  ext: string,
): Promise<StoredObject> {
  const cfg = storageConfig();
  if (!cfg) throw new Error('Storage não configurado (defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY).');
  const path = `${businessId}/${contactId || 'sem-contato'}/${randomUUID()}.${ext}`;
  const res = await fetch(`${cfg.url}/storage/v1/object/${cfg.privateBucket}/${path}`, {
    method: 'POST',
    headers: storageHeaders(cfg, contentType),
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Falha no upload (patient-files): ${res.status} ${detail.slice(0, 200)}`);
  }
  const signed = await signPatientFile(path, 600);
  return { bucket: cfg.privateBucket, path, url: signed.url, expiresAt: signed.expiresAt };
}

/** URL temporária do bucket privado (autorização é do chamador, no servidor). */
export async function signPatientFile(
  path: string,
  expiresInSec = 600,
): Promise<{ url: string; expiresAt: string }> {
  const cfg = storageConfig();
  if (!cfg) throw new Error('Storage não configurado.');
  const res = await fetch(`${cfg.url}/storage/v1/object/sign/${cfg.privateBucket}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: expiresInSec }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Falha ao assinar URL: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { signedURL?: string };
  if (!data.signedURL) throw new Error('Storage não devolveu URL assinada.');
  return {
    url: `${cfg.url}/storage/v1${data.signedURL}`,
    expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
  };
}
