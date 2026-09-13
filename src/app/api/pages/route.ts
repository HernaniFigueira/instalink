import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { slugify, isValidSlug } from '@/lib/utils';

// GET ?businessId= — página + tema + blocos (dono)
// PUT — salvar blocos/tema/publicação/slug (dono)
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId);
  if (!guard.ok) return guard.res;
  const page = guard.db.pages.find((p) => p.businessId === businessId);
  return NextResponse.json({ business: guard.ctx.business, page });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { businessId } = body;
    const guard = await requireBusiness(req, businessId, 'pagina');
    if (!guard.ok) return guard.res;
    const db = guard.db;

    if (body.slug !== undefined) {
      const slug = slugify(body.slug);
      if (!isValidSlug(slug)) return NextResponse.json({ error: 'Endereço inválido.' }, { status: 400 });
      if (db.businesses.some((b) => b.slug === slug && b.id !== businessId)) {
        return NextResponse.json({ error: 'Este endereço já está em uso.' }, { status: 400 });
      }
      await updateDB((d) => { d.businesses.find((b) => b.id === businessId)!.slug = slug; });
    }
    if (body.published !== undefined) {
      await updateDB((d) => {
        const b = d.businesses.find((x) => x.id === businessId)!;
        b.published = !!body.published;
        b.updatedAt = new Date().toISOString();
      });
    }
    if (body.theme || body.blocks || body.presetId !== undefined) {
      await updateDB((d) => {
        const page = d.pages.find((p) => p.businessId === businessId);
        if (!page) return;
        if (body.theme) page.theme = { ...page.theme, ...body.theme };
        if (body.presetId !== undefined) page.presetId = String(body.presetId || '');
        if (Array.isArray(body.blocks)) {
          page.blocks = body.blocks.map((bl: any, i: number) => ({
            id: String(bl.id), type: bl.type, order: i,
            // `enabled` é APRESENTAÇÃO: o módulo da empresa (lib/features)
            // continua sendo quem decide se o recurso existe no ar.
            enabled: bl.enabled !== false,
            settings: (bl.settings && typeof bl.settings === 'object') ? bl.settings : {},
          }));
        }
        page.updatedAt = new Date().toISOString();
      });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 });
  }
}
