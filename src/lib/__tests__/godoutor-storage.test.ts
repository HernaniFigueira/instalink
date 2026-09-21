// ═══════════════════════════════════════════════════════════════
// TESTES — uploads GoDoutor (tipo real por MAGIC BYTES, buckets e URLs).
// ═══════════════════════════════════════════════════════════════
// A parte que envolve rede (Storage REST) é exercida com fetch simulado para
// provar o FORMATO das requisições/URLs sem depender do projeto de Supabase
// (indisponível neste ambiente — bloqueio declarado na PR).
import { describe, it, expect, afterEach } from 'vitest';
import {
  sniffContentType, validateUpload, uploadClinicImage, uploadPatientFile,
  signPatientFile,
} from '../storage';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(20)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(10)]);
const AVIF = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif'), Buffer.alloc(12)]);
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0, 0x04, 0, 0, 0]); // MZ (Windows PE)
const HTML = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe('sniffContentType — o tipo REAL vence o declarado', () => {
  it('reconhece os formatos permitidos pelos magic bytes', () => {
    expect(sniffContentType(JPEG)).toBe('image/jpeg');
    expect(sniffContentType(PNG)).toBe('image/png');
    expect(sniffContentType(PDF)).toBe('application/pdf');
    expect(sniffContentType(WEBP)).toBe('image/webp');
    expect(sniffContentType(GIF)).toBe('image/gif');
    expect(sniffContentType(AVIF)).toBe('image/avif');
  });

  it('recusa executáveis, HTML e ruído — mesmo que o cliente diga "image/png"', () => {
    expect(sniffContentType(EXE)).toBeNull();
    expect(sniffContentType(HTML)).toBeNull();
    expect(sniffContentType(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
    expect(sniffContentType(Buffer.alloc(0))).toBeNull();
  });
});

describe('validateUpload — tamanho e allowlist por finalidade', () => {
  it('clinic aceita imagem e recusa PDF', () => {
    expect(validateUpload(JPEG, 'clinic', { declaredType: 'image/jpeg' }).ok).toBe(true);
    expect(validateUpload(PDF, 'clinic', { declaredType: 'application/pdf' }).reason).toBe('type_not_allowed');
  });

  it('patient aceita imagem e PDF', () => {
    expect(validateUpload(PDF, 'patient', { declaredType: 'application/pdf' }).ok).toBe(true);
    expect(validateUpload(JPEG, 'patient').ok).toBe(true);
  });

  it('recusa além do limite por bucket (5MB clínica / 15MB paciente)', () => {
    const bigPng = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect(validateUpload(bigPng, 'clinic').reason).toBe('too_large');
    expect(validateUpload(bigPng, 'patient').ok).toBe(true); // paciente tem mais folga
  });

  it('nunca confia no declaredType para passar executável', () => {
    expect(validateUpload(EXE, 'clinic', { declaredType: 'image/png' }).reason).toBe('unknown_type');
  });
});

describe('Supabase Storage — formato das chamadas e URLs', () => {
  function mockFetch(expectUrl: RegExp, capture: { method?: string; headers?: Record<string, string> } = {}) {
    const impl = async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toMatch(expectUrl);
      capture.method = init?.method;
      capture.headers = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response(JSON.stringify(
        String(url).includes('/sign/') ? { signedURL: '/object/sign/patient-files/arquivo?token=abc' } : {},
      ) as any, { status: 200 });
    };
    (globalThis as any).fetch = impl;
  }

  afterEach(() => { delete (globalThis as any).fetch; });

  it('uploadClinicImage: bucket público, caminho {business}/{uuid}.{ext}, URL pública', async () => {
    process.env.SUPABASE_URL = 'https://sefwhobqafkretljjlqx.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-teste';
    const capture: any = {};
    mockFetch(/\/storage\/v1\/object\/clinic-media\/biz_1\/[0-9a-f-]+\.jpg$/, capture);
    const stored = await uploadClinicImage('biz_1', JPEG, 'image/jpeg', 'jpg');
    expect(capture.method).toBe('POST');
    expect(capture.headers.authorization).toBe('Bearer service-role-teste');
    expect(capture.headers['x-upsert']).toBe('false');
    expect(stored.url).toBe(
      `https://sefwhobqafkretljjlqx.supabase.co/storage/v1/object/public/clinic-media/${stored.path}`,
    );
    expect(stored.path).toMatch(/^biz_1\//);
  });

  it('uploadPatientFile: bucket PRIVADO + devolve URL TEMPORÁRIA com validade', async () => {
    process.env.SUPABASE_URL = 'https://sefwhobqafkretljjlqx.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-teste';
    const capture: any = {};
    mockFetch(/\/storage\/v1\/object\/(patient-files|sign)/, capture);
    const stored = await uploadPatientFile('biz_1', 'ct_9', PDF, 'application/pdf', 'pdf');
    expect(stored.bucket).toBe('patient-files');
    expect(stored.path).toBe(`biz_1/ct_9/${stored.path.split('/')[2]}`);
    expect(stored.url).toContain('/object/sign/patient-files/');
    expect(stored.url).not.toContain('service-role-teste');
    expect(stored.expiresAt).toBeTruthy();
    expect(new Date(stored.expiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('signPatientFile: assinatura pedida ao servidor com Authorization de serviço', async () => {
    process.env.SUPABASE_URL = 'https://sefwhobqafkretljjlqx.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-teste';
    const capture: any = {};
    mockFetch(/\/storage\/v1\/object\/sign\/patient-files\/biz_1\/ct_9\/arquivo\.pdf/, capture);
    const signed = await signPatientFile('biz_1/ct_9/arquivo.pdf', 60);
    expect(capture.method).toBe('POST');
    expect(capture.headers.authorization).toBe('Bearer service-role-teste');
    expect(signed.url).toContain('token=abc');
  });

  it('sem configuração, falha com erro claro (não tenta Vercel Blob em patient)', async () => {
    await expect(signPatientFile('x/y.pdf')).rejects.toThrow(/não configurado/i);
  });
});
