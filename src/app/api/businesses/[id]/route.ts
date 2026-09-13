import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { clampCents } from '@/lib/utils';
import type { BusinessMode, TeamMode } from '@/lib/types';
import { VALID_MODES, defaultBookingConfig } from '@/lib/types';
import { VALID_NAV } from '@/lib/nav';

// PATCH — atualiza perfil do negócio (dono). Campos permitidos explícitos,
// com whitelist e sanitização por tipo.
const ALLOWED = ['name', 'description', 'logo', 'cover', 'modes', 'phone', 'whatsapp', 'email', 'instagram', 'tiktok', 'address', 'mapsUrl', 'hours', 'paymentMethods', 'pixKey', 'deliveryFee', 'minOrder', 'googleUrl', 'googlePlaceId', 'googleApiKey'] as const;
const PAY_METHODS = ['pix', 'card', 'cash', 'on_delivery'];
const TEAM_MODES: TeamMode[] = ['solo', 'choosable', 'auto'];

const str = (v: unknown, max: number): string => String((v as string) || '').slice(0, max);

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
        if (body[key] === undefined) continue;
        if (key === 'modes') {
          const modes = (Array.isArray(body.modes) ? body.modes : []).filter((m: string) => VALID_MODES.includes(m as BusinessMode));
          if (modes.length > 0) b.modes = modes;
        } else if (key === 'paymentMethods') {
          const pm = (Array.isArray(body.paymentMethods) ? body.paymentMethods : []).filter((m: string) => PAY_METHODS.includes(m));
          b.paymentMethods = pm;
        } else if (key === 'deliveryFee' || key === 'minOrder') {
          b[key] = clampCents(Number(body[key]) || 0);
        } else if (key === 'hours') {
          if (body.hours && typeof body.hours === 'object') b.hours = body.hours;
        } else {
          (b as any)[key] = str(body[key], key === 'description' ? 500 : 200);
        }
      }
      // Navegação pública (menu configurável)
      if (body.nav !== undefined) {
        const nav = Array.isArray(body.nav) ? body.nav.filter((n: unknown) => VALID_NAV.includes(n as string)) : [];
        b.nav = [...new Set(nav as string[])]; // ordem canônica aplicada no render
      }
      if (body.navCustom !== undefined) {
        b.navCustom = !!body.navCustom;
      }
      // Seção "Sobre a empresa"
      if (body.about !== undefined && body.about && typeof body.about === 'object') {
        const a = body.about as Record<string, any>;
        b.about = {
          title: str(a.title, 80),
          text: str(a.text, 1200),
          image: str(a.image, 500),
          enabled: a.enabled !== false && !!a.enabled,
        };
      }
      // Config de agenda (validada campo a campo)
      if (body.booking && typeof body.booking === 'object') {
        const cur = { ...defaultBookingConfig(), ...b.booking };
        const nb = body.booking;
        if (TEAM_MODES.includes(nb.teamMode)) cur.teamMode = nb.teamMode;
        if (Number.isFinite(Number(nb.leadMin))) cur.leadMin = Math.max(0, Math.min(1440, Math.round(Number(nb.leadMin))));
        if (Number.isFinite(Number(nb.cancelUntilMin))) cur.cancelUntilMin = Math.max(0, Math.min(10080, Math.round(Number(nb.cancelUntilMin))));
        if (Number.isFinite(Number(nb.horizonDays))) cur.horizonDays = Math.max(1, Math.min(365, Math.round(Number(nb.horizonDays))));
        if (Number.isFinite(Number(nb.bufferMin))) cur.bufferMin = Math.max(0, Math.min(240, Math.round(Number(nb.bufferMin))));
        b.booking = cur;
      }
      b.updatedAt = new Date().toISOString();
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível salvar as configurações.' }, { status: 500 });
  }
}
