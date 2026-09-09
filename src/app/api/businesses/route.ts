import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { slugify, isValidSlug } from '@/lib/utils';
import { defaultPresetId, defaultTheme, defaultBlocks } from '@/lib/templates';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import type { BusinessMode, Niche } from '@/lib/types';
import { VALID_MODES, VALID_NICHES, defaultBookingConfig } from '@/lib/types';

// POST = onboarding: cria negócio + página inicial a partir do template
export async function POST(req: NextRequest) {
  const rl = rateLimit(`biz:${ipFrom(req)}`, 10, 3600000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitos negócios criados. Aguarde um pouco.' }, { status: 429 });
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

    const body = await req.json();
    const name = (body.name || '').trim().slice(0, 80);
    const niche: Niche = VALID_NICHES.includes(body.niche) ? body.niche : 'outro';
    const modes = (Array.isArray(body.modes) ? body.modes : []).filter((m: string) => VALID_MODES.includes(m as BusinessMode)) as BusinessMode[];
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
        phone: '', whatsapp: String(body.whatsapp || '').slice(0, 20), email: '', instagram: '', tiktok: '',
        address: '', mapsUrl: '', hours: {}, paymentMethods: ['pix'], pixKey: '',
        deliveryFee: 0, minOrder: 0,
        googleUrl: '', googlePlaceId: '', googleApiKey: '',
        booking: defaultBookingConfig(),
        published: false, createdAt: now, updatedAt: now,
      });
      d.pages.push({ id: randomUUID(), businessId, presetId: defaultPresetId(niche), theme: defaultTheme(niche), blocks: defaultBlocks(niche, modes), updatedAt: now });
    });
    return NextResponse.json({ ok: true, businessId, slug });
  } catch {
    return NextResponse.json({ error: 'Não conseguimos criar seu negócio. Tente novamente.' }, { status: 500 });
  }
}
