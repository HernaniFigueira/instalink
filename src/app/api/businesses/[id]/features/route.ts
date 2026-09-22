import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite } from '@/lib/relational/slice';
import { requireBusiness } from '@/lib/access';
import { featureDef, isValidFeature, normalizeFeatures, offeredFeatureState, withActivationBlock } from '@/lib/features';
import { businessIdFromRoute } from '@/lib/business-context';
import { pushAudit } from '@/lib/audit';
import type { OptionalFeatureId } from '@/lib/types';

// GET /api/businesses/[id]/features — estado dos módulos OFERECIDOS.
// CAUSA RAIZ DO "LOOP DE RECURSOS" (corrigida): antes o GET lia o id SOMENTE
// de ?businessId=, ignorando o [id] do path — a tela chamava sem query e a
// API respondia 400 "Negócio não informado.", prendendo o lojista no ciclo
// erro → "Tentar de novo" → erro. A empresa vem do PATH (a URL já diz qual
// é); a query ?businessId= fica apenas como fallback de compatibilidade.
// Módulos legados (pedidos/orçamentos) não entram na lista: continuam
// resolúveis por isFeatureEnabled (dados e páginas antigas seguem válidos),
// mas a empresa não é convidada a ligá-los/desligá-los — não fazem mais
// parte do posicionamento do GoDoutor.
// PATCH { feature, enabled } — liga/desliga IMEDIATAMENTE (um módulo por
// chamada: sem "salvar tudo" e sem risco de sobrescrever outras
// configurações). Desativar nunca apaga dados.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const businessId = businessIdFromRoute(params, req);
  const guard = await requireBusiness(req, businessId);
  if (!guard.ok) return guard.res;
  return NextResponse.json({
    features: offeredFeatureState(guard.ctx.business).map(({ def, enabled }) => ({
      id: def.id, label: def.label, hint: def.hint, icon: def.icon, group: def.group,
      disabledHint: def.disabledHint, enabled,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    // O path manda; o body.businessId continua aceito como fallback
    // (compatibilidade com clientes antigos que só enviavam o corpo).
    const businessId = String(params?.id || '').trim() || String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'config');
    if (!guard.ok) return guard.res;
    const { ctx } = guard;
    const feature = body.feature;
    if (!isValidFeature(feature)) return NextResponse.json({ error: 'Recurso desconhecido.' }, { status: 400 });
    const enabled = body.enabled !== false && body.enabled !== undefined ? !!body.enabled : false;
    const def = featureDef(feature)!;

    /** Mutação PURA (DOIS MOTORES): liga/desliga módulo e reflete na página. */
    const featureTx = (db: any) => {
      const b = db.businesses.find((x: any) => x.id === businessId);
      if (!b) return null;
      if (def.mode) {
        const set = new Set(b.modes || []);
        if (enabled) set.add(def.mode); else set.delete(def.mode);
        // Sair do papel: remover o módulo é permitido até com a lista vazia
        // (empresa pode ficar sem nenhum módulo opcional ligado).
        b.modes = [...set];
        // Supressão explícita da vitrine: desligar Produtos precisa VENCER o
        // fallback legado de pedidos (senão a vitrine continuava no ar para
        // contas antigas com pedidos — a contradição auditada em §4).
        if (def.id === 'products') b.productsOff = !enabled;
      } else {
        const features = normalizeFeatures(b, db.pages.find((p: any) => p.businessId === b.id)?.blocks || []);
        features[def.id as OptionalFeatureId] = enabled;
        b.features = features;
        // "Sobre" espelha o flag legado para compatibilidade de renderização.
        if (def.id === 'about') {
          b.about = { ...(b.about || { title: '', text: '', image: '', enabled: false }), enabled };
        }
      }
      // ATIVAR reflete na página na hora: garante o bloco de apresentação
      // (aditivo — desativar nunca remove/apaga blocos nem configurações).
      if (enabled) {
        const page = db.pages.find((p: any) => p.businessId === businessId);
        if (page) {
          const next = withActivationBlock(page.blocks, def.id, true);
          if (next !== page.blocks) {
            page.blocks = next;
            page.updatedAt = new Date().toISOString();
          }
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
      return { modes: b.modes, features: normalizeFeatures(b, (db.pages || []).find((p: any) => p.businessId === b.id)?.blocks || []) };
    };
    let result: any;
    if (relationalActive()) {
      // Fatia mínima: a unidade (auto) + a página (blocos refletem ativação).
      result = await runRelationalWrite(businessId, featureTx, { load: { pages: {} } });
    } else {
      result = await updateDB(featureTx);
    }

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
