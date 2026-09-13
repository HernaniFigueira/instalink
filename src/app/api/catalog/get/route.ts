import { NextRequest, NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { todayISO } from '@/lib/tz';

// GET ?businessId= — todo o catálogo do negócio (dono) + exceções +
// referências de agendamentos futuros (para exclusão segura).
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  // LEITURA: quem opera agenda/clientes/pedidos precisa dos serviços e
  // profissionais; editar continua exigindo 'catalogo' (rotas de escrita).
  const guard = await requireBusiness(req, businessId, ['catalogo', 'agenda', 'clientes', 'pedidos', 'config', 'pagina']);
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const optIds = new Set(db.options.filter((o) => o.businessId === businessId).map((o) => o.id));
  const today = todayISO();
  const future = db.bookings.filter(
    (b) => b.businessId === businessId && b.status !== 'cancelled' && b.date >= today,
  );
  return NextResponse.json({
    business: guard.ctx.business,
    categories: db.categories.filter((c) => c.businessId === businessId),
    products: db.products.filter((p) => p.businessId === businessId),
    options: db.options.filter((o) => o.businessId === businessId),
    optionValues: db.optionValues.filter((v) => optIds.has(v.optionId)),
    services: db.services.filter((s) => s.businessId === businessId),
    professionals: db.professionals.filter((p) => p.businessId === businessId),
    availability: db.availability.filter((a) => a.businessId === businessId),
    exceptions: db.exceptions
      .filter((e) => e.businessId === businessId && e.date >= today)
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    bookingRefs: {
      services: [...new Set(future.map((b) => b.serviceId))],
      professionals: [...new Set(future.map((b) => b.professionalId).filter(Boolean))],
    },
  });
}
