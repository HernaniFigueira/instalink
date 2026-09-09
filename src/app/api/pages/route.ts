import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { slugify, isValidSlug } from '@/lib/utils';

// GET ?businessId= — página + tema + blocos (dono)
// PUT — salvar blocos/tema/publicação/slug (dono)
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId && b.ownerId === user.id);
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
  const page = db.pages.find((p) => p.businessId === businessId);
  return NextResponse.json({ business, page });
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { businessId } = body;
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === businessId && b.ownerId === user.id);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

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
