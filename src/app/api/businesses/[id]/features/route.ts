import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { featureDef, featureState, isValidFeature, normalizeFeatures } from '@/lib/features';
import { pushAudit } from '@/lib/audit';
import type { OptionalFeatureId } from '@/lib/types';

// GET ?businessId= — estado de todos os módulos + catálogo conceitual.
// PATCH { businessId, feature, enabled } — liga/desliga IMEDIATAMENTE
// (um módulo por chamada: sem "salvar tudo" e sem risco de sobrescrever
// outras configurações). Desativar nunca apaga dados.
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId);
  if (!guard.ok) return guard.res;
  return NextResponse.json({
    features: featureState(guard.ctx.business).map(({ def, enabled }) => ({
      id: def.id, label: def.label, hint: def.hint, icon: def.icon, group: def.group,
      disabledHint: def.disabledHint, enabled,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;
    const { ctx } = guard;
    const feature = body.feature;
    if (!isValidFeature(feature)) return NextResponse.json({ error: 'Recurso desconhecido.' }, { status: 400 });
    const enabled = body.enabled !== false && body.enabled !== undefined ? !!body.enabled : false;
    const def = featureDef(feature)!;

    const result = await updateDB((db) => {
      const b = db.businesses.find((x) => x.id === businessId);
      if (!b) return null;
      if (def.mode) {
        const set = new Set(b.modes || []);
        if (enabled) set.add(def.mode); else set.delete(def.mode);
        // Sair do papel: remover o módulo é permitido até com a lista vazia
        // (empresa pode ficar sem nenhum módulo opcional ligado).
        b.modes = [...set];
      } else {
        const features = normalizeFeatures(b, db.pages.find((p) => p.businessId === b.id)?.blocks || []);
        features[def.id as OptionalFeatureId] = enabled;
        b.features = features;
        // "Sobre" espelha o flag legado para compatibilidade de renderização.
        if (def.id === 'about') {
          b.about = { ...(b.about || { title: '', text: '', image: '', enabled: false }), enabled };
        }
      }
      b.updatedAt = new Date().toISOString();
      pushAudit(db, {
        action: 'feature.updated',
        actor: { ...ctx.user, role: ctx.role },
        businessId,
        supportSessionId: ctx.support?.id,
        meta: { feature: def.id, enabled },
      });
      return { modes: b.modes, features: normalizeFeatures(b, db.pages.find((p) => p.businessId === b.id)?.blocks || []) };
    });

    if (!result) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      feature: def.id,
      enabled,
      modes: result.modes,
      features: result.features,
      // Feedback honesto do que acabou de mudar na página pública.
      effect: enabled
        ? `${def.label} está ativo e já aparece na sua página.`
        : `${def.label} foi ocultado da página, do menu e dos atalhos. Nada foi apagado.`,
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar o recurso.' }, { status: 500 });
  }
}
