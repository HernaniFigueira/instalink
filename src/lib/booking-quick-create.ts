'use client';
// ═══════════════════════════════════════════════════════════════
// DS 1.0 · §5 — CRIAÇÃO RÁPIDA ANCORADA NA GRADE (intenção + gravação)
// ═══════════════════════════════════════════════════════════════
// O clique/drag num slot da Agenda abre um POPOVER ancorado no ponto clicado
// (Popover canônico em `components/ui.tsx`). Este módulo é a parte que NÃO é
// desenho:
//
//   • `bookingIntentPayload` — o payload do caso SIMPLES, no MESMO formato que
//     o fluxo completo (NewBookingSheet) envia para `POST /api/bookings`: um
//     único lugar define nomes de campo, para os dois não divergirem;
//   • `submitBookingIntent` — a chamada, com o erro do SERVIDOR preservado
//     (nada de mensagem inventada na tela);
//   • `fetchSlotTimes` — a lista de horários REAIS do intervalo, pelo mesmo
//     endpoint (`mode=slots-admin`) que o fluxo completo usa. A criação rápida
//     nunca inventa horário: se o servidor não devolve o slot, não aparece.
//
// O que fica FORA daqui, por contrato: o servidor continua autoridade total
// (disponibilidade, conflito, bloqueio, fuso, tenant, permissão). A criação
// rápida é um atalho de INTERFACE para o caso comum; tudo que foge dele
// (cadastro novo, encaixe, série, observação, pet) segue no fluxo completo
// pelo botão "Mais opções".
/** Contato como `GET /api/contacts` devolve (mesmo formato do fluxo completo). */
export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
}

export interface BookingIntent {
  contactId: string;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  professionalId: string;
  date: string;
  time: string;
  /** Duração específica deste atendimento (min) — opcional. */
  durationMin?: number;
}

/** Payload canônico do caso simples (mesmos nomes de campo do fluxo completo). */
export function bookingIntentPayload(businessId: string, intent: BookingIntent) {
  return {
    businessId,
    asOwner: true,
    contactId: intent.contactId,
    customerName: intent.customerName,
    customerPhone: intent.customerPhone,
    serviceId: intent.serviceId,
    professionalId: intent.professionalId || '',
    date: intent.date,
    time: intent.time,
    ...(intent.durationMin ? { staffDurationMin: intent.durationMin } : {}),
  };
}

export type SubmitResult =
  | { ok: true; booking: { id?: string; professionalName?: string; date?: string; time?: string } }
  | { ok: false; message: string; conflict?: boolean };

export async function submitBookingIntent(
  businessId: string,
  intent: BookingIntent,
): Promise<SubmitResult> {
  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingIntentPayload(businessId, intent)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 409 = o horário deixou de estar livre (alguém ocupou entre a leitura e
      // o clique): a frase é a do servidor, com o motivo real.
      return { ok: false, message: data.error || 'Não foi possível criar o agendamento.', conflict: res.status === 409 };
    }
    return { ok: true, booking: data.booking || data };
  } catch {
    return { ok: false, message: 'Não foi possível criar o agendamento. Verifique a conexão.' };
  }
}

export interface SlotTimesResult {
  times: string[];
  /** Nenhum horário livre (dia fechado, lotado ou fora do horizonte). */
  empty: boolean;
  loading: boolean;
  error: string;
}

const IDLE: SlotTimesResult = { times: [], empty: false, loading: false, error: '' };

/**
 * Horários REAIS do intervalo para serviço+profissional+data. Mesmo endpoint
 * do fluxo completo — a Agenda não calcula disponibilidade no cliente.
 * `staffDurationMin` entra para o servidor conferir a duração pretendida.
 */
export async function fetchSlotTimes(params: {
  businessId: string;
  serviceId: string;
  date: string;
  professionalId?: string;
  durationMin?: number;
}): Promise<SlotTimesResult> {
  const { businessId, serviceId, date, professionalId, durationMin } = params;
  if (!businessId || !serviceId || !date) return IDLE;
  try {
    const qs = new URLSearchParams({ mode: 'slots-admin', internalSnap: '15', businessId, serviceId, date });
    if (professionalId) qs.set('professionalId', professionalId);
    if (durationMin) qs.set('staffDurationMin', String(durationMin));
    const res = await fetch(`/api/bookings?${qs.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ...IDLE, error: data.error || 'Não foi possível carregar os horários.' };
    const times: string[] = Array.isArray(data.slots) ? data.slots : [];
    return { times, empty: times.length === 0, loading: false, error: '' };
  } catch {
    return { ...IDLE, error: 'Não foi possível carregar os horários.' };
  }
}

/** Busca de paciente no CRM (mesma rota/limite do fluxo completo). */
export async function searchContacts(businessId: string, term: string): Promise<Contact[]> {
  const q = term.trim();
  if (!businessId || q.length < 2) return [];
  try {
    const res = await fetch(`/api/contacts?businessId=${businessId}&q=${encodeURIComponent(q)}&limit=8`);
    const data = await res.json().catch(() => ({}));
    return res.ok ? (data.contacts || []) : [];
  } catch {
    return [];
  }
}
