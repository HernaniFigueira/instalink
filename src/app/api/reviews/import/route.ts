import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';

// POST { businessId } — importa as avaliações do Google (Places API).
// Requer googlePlaceId + googleApiKey salvos no negócio. Novas entram
// como pendentes: o lojista publica ou não, uma a uma.
export async function POST(req: NextRequest) {
  try {
    const { businessId } = await req.json();
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === businessId && b.ownerId === user.id);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    const placeId = (business.googlePlaceId || '').trim();
    const key = (business.googleApiKey || '').trim();
    if (!placeId || !key) {
      return NextResponse.json({ error: 'Informe o Place ID e a chave da Places API primeiro.' }, { status: 400 });
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,rating,reviews&key=${encodeURIComponent(key)}&language=pt-BR`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK') {
      const msg: Record<string, string> = {
        REQUEST_DENIED: 'Chave inválida ou API não liberada no Google Cloud.',
        INVALID_REQUEST: 'Place ID inválido.',
        NOT_FOUND: 'Estabelecimento não encontrado no Google.',
      };
      return NextResponse.json({ error: msg[data.status as string] || 'O Google não retornou avaliações agora.' }, { status: 400 });
    }
    const incoming: Array<{ author_name?: string; rating?: number; text?: string; time?: number }> =
      Array.isArray(data.result?.reviews) ? data.result.reviews : [];
    if (incoming.length === 0) {
      return NextResponse.json({ ok: true, imported: 0, message: 'Nenhuma avaliação encontrada no Google.' });
    }

    const now = new Date().toISOString();
    let imported = 0;
    await updateDB((d) => {
      for (const rv of incoming.slice(0, 5)) {
        const externalId = `${rv.author_name || 'anon'}|${rv.time || ''}`;
        const exists = d.reviews.some((x) => x.businessId === business.id && x.externalId === externalId);
        if (exists) continue;
        d.reviews.push({
          id: randomUUID(), businessId: business.id, customerId: '',
          customerName: String(rv.author_name || 'Cliente Google').slice(0, 80),
          rating: Math.max(1, Math.min(5, Number(rv.rating) || 5)),
          text: String(rv.text || '').slice(0, 500),
          source: 'google', status: 'pending',
          orderId: '', bookingId: '', externalId, createdAt: now,
        });
        imported += 1;
      }
    });
    return NextResponse.json({ ok: true, imported });
  } catch {
    return NextResponse.json({ error: 'Falha ao falar com o Google. Tente novamente.' }, { status: 500 });
  }
}
