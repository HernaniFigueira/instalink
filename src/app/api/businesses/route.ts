import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { slugify, isValidSlug } from '@/lib/utils';
import { defaultPresetId, defaultTheme, defaultBlocks } from '@/lib/templates';
import type { BusinessMode, Niche } from '@/lib/types';

// POST = onboarding: cria negócio + página inicial a partir do template
export async function POST(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

    const body = await req.json();
    const name = (body.name || '').trim();
    const niche = (body.niche || 'outro') as Niche;
    const modes = (Array.isArray(body.modes) ? body.modes : []) as BusinessMode[];
    let slug = slugify(body.slug || name);
    if (!name) return NextResponse.json({ error: 'Dê um nome ao seu negócio.' }, { status: 400 });
    if (modes.length === 0) return NextResponse.json({ error: 'Escolha ao menos uma forma de vender.' }, { status: 400 });
    if (!isValidSlug(slug)) return NextResponse.json({ error: 'Esse endereço não é válido. Use ao menos 3 letras/números.' }, { status: 400 });

    const db = await readDB();
    if (db.businesses.some((b) => b.slug === slug)) {
      slug = `${slug}${Math.floor(Math.random() * 90 + 10)}`;
    }

    const now = new Date().toISOString();
    const businessId = randomUUID();
    await updateDB((d) => {
      d.businesses.push({
        id: businessId, ownerId: user.id, name, slug, description: '',
        logo: '', cover: '', niche, modes,
        phone: '', whatsapp: body.whatsapp || '', email: '', instagram: '', tiktok: '',
        address: '', mapsUrl: '', hours: {}, paymentMethods: ['pix'], pixKey: '',
        googleUrl: '', googlePlaceId: '', googleApiKey: '',
        published: false, createdAt: now, updatedAt: now,
      });
      d.pages.push({ id: randomUUID(), businessId, presetId: defaultPresetId(niche), theme: defaultTheme(niche), blocks: defaultBlocks(niche, modes), updatedAt: now });
    });
    return NextResponse.json({ ok: true, businessId, slug });
  } catch {
    return NextResponse.json({ error: 'Não conseguimos criar seu negócio. Tente novamente.' }, { status: 500 });
  }
}
