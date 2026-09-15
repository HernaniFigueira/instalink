import { NextRequest, NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { can, requireBusiness, requireUser, resolveAccess } from '@/lib/access';
import { unitsForOrganization } from '@/lib/organization';
import { isFeatureEnabled } from '@/lib/features';
import { resolvePeriodSpec } from '@/lib/periods';
import { todayISO } from '@/lib/tz';
import { collectResults, type ResultsUnit } from '@/lib/insights';
import type { Business } from '@/lib/types';

// Rota dinâmica por natureza (lê período/unidade da query e o banco a cada
// chamada). Declarado explicitamente para o build não tentar pré-renderizar.
export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════
// RESULTADOS — indicadores REAIS do período (P2, Bloco 1)
// ═══════════════════════════════════════════════════════════════
// GET ?businessId=&period=[today|7|30|90|365|month|all|custom]&from=&to=
//     → resultados de UMA unidade.
// GET ?organizationId=&period=…&from=&to=
//     → visão consolidada: agrega SOMENTE as unidades da organização às quais
//       o usuário realmente tem acesso E permissão de resultados
//       ('financeiro'). A lista de unidades NUNCA vem do cliente.
//
// ISOLAMENTO: `businessId` é validado por `requireBusiness` (dono, membro,
// org-admin ou master em suporte); `organizationId` é resolvido no servidor e
// cada unidade passa pela MESMA resolução de acesso. Nenhum caminho aceita
// ids de outras organizações.
//
// SEMÂNTICA DAS DATAS: ver cabeçalho de lib/insights.ts (data do atendimento ×
// data de criação × data de cadastro). Nada é estimado: sem base confiável o
// indicador vem com `hasData: false` e explicação.
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const businessId = q.get('businessId') || '';
    const organizationId = q.get('organizationId') || '';
    const db = await readDB();
    const today = todayISO();
    const spec = resolvePeriodSpec({
      period: q.get('period'), from: q.get('from'), to: q.get('to'), today,
    });
    const window = { from: spec.from, to: spec.to };
    const previous = spec.hasPrevious ? { from: spec.prevFrom, to: spec.prevTo } : null;

    // ── Visão consolidada da organização ──
    if (organizationId) {
      const auth = await requireUser(req);
      if (!auth.ok) return auth.res;
      const { user } = auth;
      const organization = db.organizations.find((o) => o.id === organizationId);
      // Unidades acessíveis da organização (organization.ts já filtra por
      // acesso real do usuário — nunca por parâmetro do cliente).
      const accessible = unitsForOrganization(db, user, organizationId)
        .filter((b) => {
          const ctx = resolveAccess(db, user, b.id, null);
          return !!ctx && can(ctx, 'financeiro');
        });
      if (!organization || accessible.length === 0) {
        return NextResponse.json(
          { error: 'Você não tem acesso aos resultados desta organização.' },
          { status: 403 },
        );
      }
      return NextResponse.json({
        scope: 'organization',
        organization: { id: organization.id, name: organization.name },
        period: describePeriod(spec),
        window,
        units: accessible.map((business) => ({
          id: business.id,
          name: business.name,
          slug: business.slug,
          results: collectResults(db, [unitOf(business)], window, previous),
        })),
        consolidated: collectResults(
          db, accessible.map(unitOf), window, previous, `em ${accessible.length} unidade(s)`,
        ),
      });
    }

    // ── Uma unidade ──
    if (!businessId) {
      return NextResponse.json({ error: 'Negócio não informado.' }, { status: 400 });
    }
    const guard = await requireBusiness(req, businessId, 'financeiro');
    if (!guard.ok) return guard.res;

    return NextResponse.json({
      scope: 'business',
      business: { id: guard.ctx.business.id, name: guard.ctx.business.name, slug: guard.ctx.business.slug },
      period: describePeriod(spec),
      window,
      results: collectResults(guard.db, [unitOf(guard.ctx.business)], window, previous),
    });
  } catch (e) {
    console.error('[results] falhou:', e);
    return NextResponse.json({ error: 'Não foi possível carregar os resultados.' }, { status: 500 });
  }
}

/** Descrição da janela para a tela (rótulo, datas e janela de comparação). */
function describePeriod(spec: ReturnType<typeof resolvePeriodSpec>) {
  return {
    key: spec.key,
    label: spec.label,
    shortLabel: spec.shortLabel,
    custom: spec.custom,
    from: spec.from,
    to: spec.to,
    prevFrom: spec.prevFrom,
    prevTo: spec.prevTo,
    hasPrevious: spec.hasPrevious,
  };
}

/** Unidade → recorte para o motor de resultados (módulos ativos importam). */
function unitOf(business: Business): ResultsUnit {
  return {
    id: business.id,
    hasBookings: isFeatureEnabled(business, 'bookings') || isFeatureEnabled(business, 'services'),
    hasOrders: isFeatureEnabled(business, 'orders'),
  };
}
