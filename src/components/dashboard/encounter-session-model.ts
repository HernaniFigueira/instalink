// ═══════════════════════════════════════════════════════════════
// ENTREGA 2 · MODELO ÚNICO DO RAIL DA SESSÃO CLÍNICA
// ═══════════════════════════════════════════════════════════════
// Atendimento (/atendimento/[id]) e Registro completo (/registro) desenham o
// MESMO contexto: o paciente, o tutor, serviço, profissional, horário, estado
// clínico e status do agendamento. Um builder só — duas telas não podem
// divergir na identidade de quem está sendo atendido.
import { ENCOUNTER_CLINICAL_STATE } from '@/lib/encounters';
import { BOOKING_STATUS, type Tone } from '@/lib/status';
import type { BookingStatus } from '@/lib/types';
import { formatDateBR } from '@/lib/tz';
import type { SessionRailFact } from './EncounterSessionRail';

/** O que a leitura do Encounter traz (workspace e registro usam o mesmo GET). */
export interface EncounterSessionSource {
  status?: string;
  date?: string;
  time?: string;
  bookingId?: string;
  customerName?: string;
  petName?: string;
  serviceName?: string;
  professionalName?: string;
  bookingStatus?: string;
  customerPhone?: string;
  startedAt?: string;
  context?: {
    clinicalState?: 'not_started' | 'in_progress' | 'finalized';
    patient?: { name?: string; speciesLabel?: string; breed?: string; ageLabel?: string; sex?: string } | null;
    responsible?: { name?: string; phone?: string } | null;
    service?: { name?: string } | null;
    professional?: { name?: string } | null;
    booking?: { status?: string } | null;
  } | null;
}

export interface EncounterSessionModel {
  stateId: string;
  eyebrow: string;
  headline: string;
  patientLine: string;
  tutor: string;
  tutorPhone: string;
  facts: SessionRailFact[];
  statusLabel: string;
  statusTone: Tone;
  bookingLabel: string;
  /** Nome curto de quem é dono da ficha de origem (tutor/cliente). */
  clientName: string;
  live: boolean;
}

function joinParts(parts: Array<string | undefined | null>, sep = ' · '): string {
  return parts.map((p) => String(p || '').trim()).filter(Boolean).join(sep);
}

export function encounterSessionModel(row: EncounterSessionSource): EncounterSessionModel {
  const ctx = row.context || null;
  const clinical = ctx?.clinicalState
    || (row.status === 'finalized' ? 'finalized' : 'in_progress');
  const state = ENCOUNTER_CLINICAL_STATE[clinical] || ENCOUNTER_CLINICAL_STATE.in_progress;
  const patient = ctx?.patient || null;
  const tutor = ctx?.responsible?.name || row.customerName || '';
  // Vet primeiro: o PACIENTE é o pet; o humano é o responsável/contexto.
  const headline = patient?.name || row.petName || tutor || 'Paciente';
  const sexLabel = patient?.sex === 'M' ? 'Macho' : patient?.sex === 'F' ? 'Fêmea' : '';
  const patientLine = patient ? joinParts([patient.speciesLabel, patient.breed, patient.ageLabel, sexLabel]) : '';
  const hasPatient = Boolean(patient?.name || row.petName);
  const bookingStatus = (ctx?.booking?.status || row.bookingStatus) as BookingStatus | undefined;
  return {
    stateId: state.id,
    eyebrow: row.bookingId ? 'Atendimento' : 'Atendimento do balcão',
    headline,
    patientLine,
    tutor: hasPatient ? tutor : '',
    tutorPhone: hasPatient ? (ctx?.responsible?.phone || row.customerPhone || '') : '',
    facts: [
      { label: 'Serviço', value: ctx?.service?.name || row.serviceName || '' },
      { label: 'Profissional', value: ctx?.professional?.name || row.professionalName || '' },
      { label: 'Agendado', value: row.date ? `${formatDateBR(row.date)}${row.time ? ` · ${row.time}` : ''}` : '' },
    ],
    statusLabel: state.label.toUpperCase(),
    statusTone: state.tone,
    bookingLabel: bookingStatus && BOOKING_STATUS[bookingStatus] ? BOOKING_STATUS[bookingStatus].panel : '',
    clientName: tutor,
    live: row.status !== 'finalized' && clinical !== 'finalized',
  };
}
