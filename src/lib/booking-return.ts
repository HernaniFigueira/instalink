// ═══════════════════════════════════════════════════════════════
// RETORNO CONTEXTUAL DO CADASTRO COMPLETO (Missão 02)
// ═══════════════════════════════════════════════════════════════
// Novo Agendamento → "+ Novo cliente" → /clientes/novo → Salvar → Cliente 360
// → "Continuar agendamento". O rascunho do agendamento em andamento vive em
// sessionStorage, com chave por UNIDADE (businessId): é limitado à aba e à
// unidade, não viaja na URL e não se mistura entre unidades.
//
// Regras:
//   • a URL carrega só `b` (unidade) e a origem (`from`) — nunca nome,
//     telefone, busca ou estado completo do agendamento;
//   • o rascunho é validado ao ler: versão, unidade e tipos; inválido = nulo;
//   • a disponibilidade NÃO é presumida no retorno: a Agenda recarrega os
//     horários e o servidor revalida no envio (POST /api/bookings).
//
// Módulo PURO na parte de parse/build (coberto por teste); o acesso a
// sessionStorage é protegido para ambiente sem `window`.

export const BOOKING_RETURN_VERSION = 1 as const;

export interface BookingReturnDraft {
  v: typeof BOOKING_RETURN_VERSION;
  businessId: string;
  savedAt: number;
  contactId: string;
  name: string;
  phone: string;
  /** Termo digitado na busca do cliente (sem contato selecionado). */
  query: string;
  petId: string;
  serviceId: string;
  professionalId: string;
  date: string;
  time: string;
  durationMin: number | '';
  note: string;
  vetMode: boolean;
}

const STRING_FIELDS = ['contactId', 'name', 'phone', 'query', 'petId', 'serviceId', 'professionalId', 'date', 'time', 'note'] as const;

/** Chave de sessionStorage por unidade. */
export function bookingReturnStorageKey(businessId: string): string {
  return `gd.booking-return.${businessId}`;
}

/** Valida e normaliza um rascunho lido do storage. Qualquer desvio = null. */
export function parseBookingReturn(raw: string | null | undefined, businessId: string): BookingReturnDraft | null {
  if (!raw || !businessId) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.v !== BOOKING_RETURN_VERSION) return null;
  if (d.businessId !== businessId) return null;
  if (typeof d.savedAt !== 'number' || !Number.isFinite(d.savedAt)) return null;
  for (const f of STRING_FIELDS) if (typeof d[f] !== 'string') return null;
  if (typeof d.vetMode !== 'boolean') return null;
  if (d.durationMin !== '' && (typeof d.durationMin !== 'number' || !Number.isFinite(d.durationMin))) return null;
  return {
    v: BOOKING_RETURN_VERSION,
    businessId,
    savedAt: d.savedAt as number,
    contactId: d.contactId as string,
    name: d.name as string,
    phone: d.phone as string,
    query: d.query as string,
    petId: d.petId as string,
    serviceId: d.serviceId as string,
    professionalId: d.professionalId as string,
    date: d.date as string,
    time: d.time as string,
    durationMin: d.durationMin as number | '',
    note: d.note as string,
    vetMode: d.vetMode as boolean,
  };
}

/** Atualiza o tutor/pet recém-cadastrados no rascunho (função pura). */
export function withRegisteredClient(
  draft: BookingReturnDraft,
  client: { contactId: string; petId?: string; name?: string; phone?: string },
): BookingReturnDraft {
  return {
    ...draft,
    contactId: client.contactId,
    petId: client.petId || '',
    name: client.name ?? draft.name,
    phone: client.phone ?? draft.phone,
    query: '',
  };
}

/** Destino de "+ Novo cliente" a partir da Agenda. Sem dados pessoais. */
export function newClientFromBookingHref(businessId: string): string {
  return `/clientes/novo?b=${encodeURIComponent(businessId)}&from=agenda`;
}

/** Destino de "+ Novo cliente" a partir da lista de Clientes. */
export function newClientFromListHref(businessId: string): string {
  return `/clientes/novo?b=${encodeURIComponent(businessId)}&from=clientes`;
}

/** Retorno à Agenda que reabre o agendamento salvo no rascunho. */
export function continueBookingHref(businessId: string): string {
  return `/agenda?b=${encodeURIComponent(businessId)}&retomar=agendamento`;
}

function hasWindowStorage(): boolean {
  return typeof window !== 'undefined' && !!window.sessionStorage;
}

export function readBookingReturn(businessId: string): BookingReturnDraft | null {
  if (!hasWindowStorage() || !businessId) return null;
  try {
    return parseBookingReturn(window.sessionStorage.getItem(bookingReturnStorageKey(businessId)), businessId);
  } catch {
    return null;
  }
}

export function writeBookingReturn(draft: Omit<BookingReturnDraft, 'v' | 'savedAt'>): BookingReturnDraft | null {
  if (!hasWindowStorage() || !draft.businessId) return null;
  const full: BookingReturnDraft = { ...draft, v: BOOKING_RETURN_VERSION, savedAt: Date.now() };
  try {
    window.sessionStorage.setItem(bookingReturnStorageKey(draft.businessId), JSON.stringify(full));
    return full;
  } catch {
    return null;
  }
}

export function clearBookingReturn(businessId: string): void {
  if (!hasWindowStorage() || !businessId) return;
  try { window.sessionStorage.removeItem(bookingReturnStorageKey(businessId)); } catch { /* storage indisponível */ }
}

/**
 * Query da lista de Clientes (busca, filtro, página) guardada ao abrir o
 * cadastro, para o "Voltar" devolver a lista COMO ESTAVA (mesmo contrato de
 * lib/client-return.ts). Fica na sessão, não na URL do cadastro.
 */
export function clientsListStorageKey(businessId: string): string {
  return `gd.clients-list.${businessId}`;
}

export function rememberClientsListQuery(businessId: string, query: string): void {
  if (!hasWindowStorage() || !businessId) return;
  try { window.sessionStorage.setItem(clientsListStorageKey(businessId), query || ''); } catch { /* storage indisponível */ }
}

export function readClientsListQuery(businessId: string): string {
  if (!hasWindowStorage() || !businessId) return '';
  try { return window.sessionStorage.getItem(clientsListStorageKey(businessId)) || ''; } catch { return ''; }
}
