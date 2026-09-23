import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { canManageOrganization, organizationsFor } from '@/lib/organization';
import { pushAudit } from '@/lib/audit';
import { slugify, isValidSlug } from '@/lib/utils';
import { defaultPresetId, defaultTheme, defaultBlocks } from '@/lib/templates';
import { normalizeFeatures } from '@/lib/features';
import { defaultWhatsappIntegration } from '@/lib/whatsapp';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import type { BusinessMode, Niche } from '@/lib/types';
import { VALID_MODES, VALID_NICHES, defaultBookingConfig, isClinicType } from '@/lib/types';
import { NEW_BUSINESS_DEFAULTS } from '@/lib/templates';
import { templateFromPreset } from '@/lib/clinic-presets';

// POST = cria negócio + página inicial a partir do template.
// NOVO FLUXO: o cadastro não pergunta mais "tipo de negócio" nem "forma de
// vender" — sem nicho/modes no corpo, o negócio nasce com o padrão de
// atendimento (Serviços + Agendamentos; vitrine desligada; sem pedidos).
// Os campos antigos continuam ACEITOS (e-2e, admin e integrações existentes),
// preservando compatibilidade — nada é quebrado para quem já chamava assim.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`biz:${ipFrom(req)}`, 10, 3600000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitos negócios criados. Aguarde um pouco.' }, { status: 429 });
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

    const body = await req.json();
    const name = (body.name || '').trim().slice(0, 80);
    const niche: Niche = VALID_NICHES.includes(body.niche) ? body.niche : NEW_BUSINESS_DEFAULTS.niche;
    const modes = (Array.isArray(body.modes) ? body.modes : NEW_BUSINESS_DEFAULTS.modes)
      .filter((m: string) => VALID_MODES.includes(m as BusinessMode)) as BusinessMode[];
    // FASE 2 · P5 — tipo de clínica (preset, não aplicação separada). Ausente
    // ou inválido = 'geral' (compatível com qualquer chamador legado).
    const clinicType = isClinicType(body.clinicType) ? body.clinicType : 'geral';
    let slug = slugify(body.slug || name);
    if (!name) return NextResponse.json({ error: 'Dê um nome ao seu negócio.' }, { status: 400 });
    // Lista vazia é permitida de propósito: o InstaLink também serve como
    // página de perfil (link na bio). O painel guia a ativação dos recursos.
    if (!isValidSlug(slug)) return NextResponse.json({ error: 'Esse endereço não é válido. Use ao menos 3 letras/números.' }, { status: 400 });

    const db = await readDB();
    // Organização é resolvida e autorizada no servidor. Para contas legadas,
    // usa a organização normalizada do proprietário; jamais aceita org alheia.
    let organizationId = String(body.organizationId || '');
    if (organizationId && !canManageOrganization(db, user, organizationId)) {
      return NextResponse.json({ error: 'Você não pode adicionar unidades nesta organização.' }, { status: 403 });
    }
    if (!organizationId) organizationId = organizationsFor(db, user).find((o) => o.ownerId === user.id)?.id || '';
    if (!organizationId) {
      organizationId = randomUUID();
    }
    if (db.businesses.some((b) => b.slug === slug)) {
      slug = `${slug}${Math.floor(Math.random() * 90 + 10)}`;
    }

    const organization = db.organizations.find((o) => o.id === organizationId);
    const unitOwnerId = organization?.ownerId || user.id;
    const now = new Date().toISOString();
    const businessId = randomUUID();
    await updateDB((d) => {
      // A concurrently deleted organization must not be silently recreated.
      if (body.organizationId && !canManageOrganization(d, user, organizationId)) throw new Error('ORGANIZATION_UNAVAILABLE');
      if (!d.organizations.some((o) => o.id === organizationId)) {
        d.organizations.push({ id: organizationId, name, ownerId: user.id, metadata: {}, createdAt: now, updatedAt: now });
      }
      d.businesses.push({
        id: businessId, ownerId: unitOwnerId, organizationId, name, slug, description: '',
        logo: '', cover: '', niche, clinicType, modes,
        phone: '', whatsapp: String(body.whatsapp || '').slice(0, 20), email: '', instagram: '', tiktok: '',
        address: String(body.address || '').trim().slice(0, 240), mapsUrl: '', hours: {}, paymentMethods: ['pix'], pixKey: '',
        deliveryFee: 0, minOrder: 0,
        googleUrl: '', googlePlaceId: '', googleApiKey: '',
        booking: defaultBookingConfig(),
        nav: [], navCustom: false,
        about: { title: '', text: '', image: '', enabled: false },
        whatsappIntegration: defaultWhatsappIntegration(),
        features: normalizeFeatures(
          { about: { title: '', text: '', image: '', enabled: false }, nav: [], modes, features: undefined } as any,
          [],
        ),
        published: false, createdAt: now, updatedAt: now,
      });
      const created = d.businesses[d.businesses.length - 1];
      const blocks = defaultBlocks(niche, modes);
      // Módulos opcionais nascem coerentes com os blocos criados.
      created.features = normalizeFeatures(created, blocks);
      if (unitOwnerId !== user.id) {
        d.members.push({ id: randomUUID(), businessId, userId: user.id, role: 'ADMIN', permissions: {}, active: true, note: 'Administrador da organização', invitedBy: unitOwnerId, createdAt: now, updatedAt: now });
      }
      d.pages.push({ id: randomUUID(), businessId, presetId: defaultPresetId(niche), theme: defaultTheme(niche), blocks, updatedAt: now });
      // FASE 2 · P5 — configuração inicial: semeia a ficha de anamnese do
      // preset do tipo de clínica ('geral' não semeia — o hub pode criar depois).
      if (clinicType !== 'geral') {
        const tpl = templateFromPreset(clinicType, () => randomUUID(), now);
        tpl.businessId = businessId;
        d.anamneseTemplates.push(tpl);
      }
      pushAudit(d, { action: 'unit.created', actor: user, businessId, meta: { organizationId, clinicType } });
    });
    return NextResponse.json({ ok: true, businessId, organizationId, slug });
  } catch (error) {
    if (error instanceof Error && error.message === 'ORGANIZATION_UNAVAILABLE') return NextResponse.json({ error: 'A organização não está mais disponível. Atualize a página.' }, { status: 409 });
    return NextResponse.json({ error: 'Não conseguimos criar seu negócio. Tente novamente.' }, { status: 500 });
  }
}
