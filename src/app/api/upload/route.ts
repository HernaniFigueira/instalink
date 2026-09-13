import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { put } from '@vercel/blob';
import { requireBusiness } from '@/lib/access';
import { rateLimit, ipFrom } from '@/lib/rate-limit';

// POST multipart (campo "file" + "businessId") — upload de imagem para o
// Vercel Blob. O arquivo binário NÃO vai para o Neon: o banco guarda só a
// URL devolvida. Requer sessão de dono + posse do negócio.
// Ativação: definir BLOB_READ_WRITE_TOKEN (Vercel Blob) no ambiente.
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
};

export async function POST(req: NextRequest) {
  const rl = rateLimit(`upload:${ipFrom(req)}`, 40, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitos uploads. Aguarde um instante.' }, { status: 429 });
  try {
    const form = await req.formData();
    const businessId = String(form.get('businessId') || '');
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Envie uma imagem.' }, { status: 400 });
    // Upload é usado por página, catálogo e configuração: basta ter um deles.
    const guard = await requireBusiness(req, businessId);
    if (!guard.ok) return guard.res;
    const canUpload = ['pagina', 'catalogo', 'config'] as const;
    if (!canUpload.some((perm) => guard.ctx.permissions[perm])) {
      return NextResponse.json({ error: 'Seu perfil não tem permissão para enviar imagens.' }, { status: 403 });
    }
    const type = file.type || 'image/jpeg';
    if (!ALLOWED.has(type)) {
      return NextResponse.json({ error: 'Formato não suportado. Use JPG, PNG, WebP ou GIF.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Imagem muito grande (máx. 5 MB).' }, { status: 400 });
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: 'Upload de imagens ainda não configurado. Adicione BLOB_READ_WRITE_TOKEN (Vercel Blob) e tente de novo.' },
        { status: 503 },
      );
    }
    const pathname = `instalink/${businessId}/${randomUUID()}.${EXT[type] || 'jpg'}`;
    const blob = await put(pathname, file, { access: 'public', contentType: type });
    return NextResponse.json({ ok: true, url: blob.url });
  } catch (e: any) {
    console.error('[upload] falhou:', e);
    return NextResponse.json({ error: 'Não foi possível enviar a imagem. Tente novamente.' }, { status: 500 });
  }
}
