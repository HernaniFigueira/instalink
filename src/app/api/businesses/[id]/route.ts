import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';

// PATCH — atualiza perfil do negócio (dono). Campos permitidos explícitos.
const ALLOWED = ['name', 'description', 'logo', 'cover', 'modes', 'phone', 'whatsapp', 'email', 'instagram', 'tiktok', 'address', 'mapsUrl', 'hours', 'paymentMethods', 'pixKey', 'googleUrl', 'googlePlaceId', 'googleApiKey'] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    const body = await req.json();
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === params.id && b.ownerId === user.id);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

    await updateDB((d) => {
      const b = d.businesses.find((x) => x.id === params.id)!;
      for (const key of ALLOWED) {
        if (body[key] !== undefined) (b as any)[key] = body[key];
      }
      b.updatedAt = new Date().toISOString();
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível salvar as configurações.' }, { status: 500 });
  }
}
