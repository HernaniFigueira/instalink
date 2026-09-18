// ═══════════════════════════════════════════════════════════════
// /AGENDAR — fluxo público autônomo de agendamento (A2-B2 · F1)
// ═══════════════════════════════════════════════════════════════
// Server Component: resolve o negócio pela FONTE CANÔNICA de dados públicos
// (o mesmo banco/leitura da página pública — lib/public.ts) e entrega os
// dados enxutos para o fluxo (AgendarFlow). Nada de /api/checkout-info
// (que é checkout de PIX, não catálogo). Slots e reserva seguem pelas APIs
// oficiais GET/POST /api/bookings — um único motor de agenda.
// Também é a página embutida pelo widget /widget/booking.js (?embed=1).
import { readDB } from '@/lib/db';
import { isFeatureEnabled } from '@/lib/features';
import { effectiveTimezone, todayISO } from '@/lib/tz';
import {
  publicBookableServices, publicActiveProfessionals,
  resolvePublicBookingTarget,
} from '@/lib/agendar';
import AgendarFlow from '@/components/public/AgendarFlow';

interface SearchParams {
  businessId?: string;
  b?: string;
  slug?: string;
  serviceId?: string;
  s?: string;
  professionalId?: string;
  p?: string;
  date?: string;
  leadId?: string;
  embed?: string;
}

function State({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-h-[400px] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white p-6 rounded-xl border border-zinc-200 text-center shadow-sm">
        <span className="inline-flex w-12 h-12 rounded-full bg-zinc-100 text-zinc-400 items-center justify-center text-xl font-bold mb-3">•</span>
        <h1 className="text-base font-bold text-zinc-900 mb-1">{title}</h1>
        <p className="text-xs text-zinc-500">{text}</p>
      </div>
    </div>
  );
}

export default async function AgendarPage({ searchParams }: { searchParams: SearchParams }) {
  const key = searchParams.businessId || searchParams.b || searchParams.slug || '';
  const embed = searchParams.embed === '1' || searchParams.embed === 'true';
  const db = await readDB();
  const target = resolvePublicBookingTarget(db, key);

  if (!target) {
    return (
      <main data-agendar-page="error">
        <State
          title="Agendamento não encontrado"
          text="Verifique o endereço ou entre em contato com o estabelecimento."
        />
      </main>
    );
  }

  const { business, notPublished } = target;

  if (notPublished) {
    return (
      <main data-agendar-page="closed">
        <State
          title={`${business.name}`}
          text="A página de agendamentos deste negócio ainda não está aberta ao público."
        />
      </main>
    );
  }

  // Módulo de agendamentos desligado: nenhum horário é oferecido (honesto).
  const full = db.businesses.find((b) => b.id === business.id);
  if (!full || !isFeatureEnabled(full, 'bookings')) {
    return (
      <main data-agendar-page="off">
        <State
          title={business.name}
          text="Este negócio não está recebendo agendamentos online no momento. Fale com a equipe pelo WhatsApp."
        />
      </main>
    );
  }

  const services = publicBookableServices(db, business.id);
  const professionals = publicActiveProfessionals(db, business.id);
  const initialServiceId = searchParams.serviceId || searchParams.s || '';
  const initialDate = searchParams.date || '';
  const leadId = searchParams.leadId || '';

  return (
    <main data-agendar-page="ok" data-business-id={business.id} className="min-h-screen bg-zinc-50">
      <AgendarFlow
        business={business}
        services={services}
        professionals={professionals}
        today={todayISO(new Date(), effectiveTimezone(business.timezone))}
        initialServiceId={initialServiceId}
        initialDate={initialDate}
        leadId={leadId}
        embed={embed}
      />
    </main>
  );
}
