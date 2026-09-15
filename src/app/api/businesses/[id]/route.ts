import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { clampCents } from '@/lib/utils';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { normalizeFeatures } from '@/lib/features';
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
    const guard = await requireBusiness(req, params.id, 'config');
    if (!guard.ok) return guard.res;
    const { ctx } = guard;
    const body = await req.json();

    await updateDB((d) => {
      const b = d.businesses.find((x) => x.id === params.id)!;
      for (const key of ALLOWED) {
        if (body[key] === undefined) continue;
        if (key === 'modes') {
          const modes = (Array.isArray(body.modes) ? body.modes : []).filter((m: string) => VALID_MODES.includes(m as BusinessMode));
          // CORREÇÃO CRÍTICA: lista vazia é uma escolha VÁLIDA (empresa sem
          // módulo comercial ligado). Antes a API ignorava o vazio e o painel
          // ficava dessincronizado com a página.
          b.modes = modes;
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
      // Redes sociais ampliadas (Facebook, YouTube, LinkedIn, site…): só redes
      // conhecidas, com valor em texto. Nada é apagado quando o campo não vem.
      if (body.socials !== undefined && body.socials && typeof body.socials === 'object') {
        const valid = ['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin', 'site'];
        const clean: Record<string, string> = { ...(b.socials || {}) };
        for (const [k, v] of Object.entries(body.socials as Record<string, unknown>)) {
          if (!valid.includes(k)) continue;
          const val = String(v || '').trim().slice(0, 300);
          if (val) clean[k] = val;
          else delete clean[k]; // limpou o campo no editor → rede sai da página
        }
        b.socials = clean;
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
      // Módulos opcionais: aceita toggles explícitos (mesma verdade da área
      // "Recursos") sem apagar os demais.
      if (body.features !== undefined && body.features && typeof body.features === 'object') {
        const features = normalizeFeatures(b, d.pages.find((p) => p.businessId === b.id)?.blocks || []);
        for (const key of Object.keys(body.features)) {
          if (!(key in features)) continue;
          features[key as keyof typeof features] = body.features[key] === true;
        }
        b.features = features;
      }
      b.updatedAt = new Date().toISOString();
      if (ctx.readOnly === false && (ctx.role === 'MASTER' || ctx.role === 'OWNER')) {
        pushAudit(d, {
          action: 'business.updated_by_master',
          actor: { ...ctx.user, role: ctx.role },
          businessId: b.id,
          supportSessionId: ctx.support?.id,
          meta: { keys: Object.keys(body).slice(0, 20) },
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível salvar as configurações.' }, { status: 500 });
  }
}
