import { NextRequest, NextResponse } from 'next/server';
import { readDB } from '@/lib/db';
import { requireBusiness, scopeInfo, scopeProfessionals } from '@/lib/access';
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
  // ESCOPO DO PROFISSIONAL (P2): o login vinculado a um profissional recebe
  // apenas o PRÓPRIO profissional e o PRÓPRIO horário. Assim a agenda, a
  // captura de agendamento e os filtros da tela não expõem colegas — nem por
  // URL manipulada, nem por chamada direta à API.
  const scope = guard.ctx.professionalScope;
  const optIds = new Set(db.options.filter((o) => o.businessId === businessId).map((o) => o.id));
  const today = todayISO();
  // Agenda can inspect a historical day: do not silently omit that day's exceptions.
  // Same business/professional guard as before; only the read window changes.
  const fromParam=req.nextUrl.searchParams.get('from')||'', toParam=req.nextUrl.searchParams.get('to')||'';
  const exceptionFrom=/^\d{4}-\d{2}-\d{2}$/.test(fromParam)?fromParam:today;
  const exceptionTo=/^\d{4}-\d{2}-\d{2}$/.test(toParam)?toParam:'';
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
    professionals: scopeProfessionals(db.professionals.filter((p) => p.businessId === businessId), scope),
    availability: db.availability
      .filter((a) => a.businessId === businessId)
      // Regras do horário geral da empresa continuam disponíveis para o
      // funcionamento da grade; horários PERSONALIZADOS de colegas não.
      .filter((a) => !scope || !a.professionalId || a.professionalId === scope),
    exceptions: db.exceptions
      .filter((e) => e.businessId === businessId && e.date >= exceptionFrom && (!exceptionTo || e.date <= exceptionTo))
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
    scope: scopeInfo(guard.ctx),
    bookingRefs: {
      services: [...new Set(future.map((b) => b.serviceId))],
      professionals: [...new Set(future
        .filter((b) => !scope || (b.professionalId || '') === scope)
        .map((b) => b.professionalId).filter(Boolean))],
    },
  });
}
