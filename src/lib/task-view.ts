// Visão de uma tarefa para a equipe (Pendências). Só LEITURA DERIVADA: nada aqui
// é persistido. Extraído da rota /api/tasks para ser testável (o Next não aceita
// exports extras em arquivos de rota).
import type { Task } from '@/lib/types';
import { taskDueLabel } from '@/lib/automation/tasks';

/**
 * Paciente da tarefa: o pet do ATENDIMENTO (ou do agendamento) vinculado.
 * Só é exibido quando o pet é da MESMA unidade e pertence ao MESMO tutor da
 * tarefa — nunca pet de outro tutor ou de outra unidade, nunca o "primeiro".
 */
export function taskPatientName(db: any, t: Task, contact: any, booking: any): string {
  const encounter = t.encounterId
    ? (db.encounters || []).find((e: any) => e.id === t.encounterId && e.businessId === t.businessId)
    : null;
  const petId = String(encounter?.petId || booking?.petId || '');
  if (!petId) return '';
  const tutorIds = [t.customerId, contact?.id, contact?.customerId].map((x) => String(x || '')).filter(Boolean);
  if (!tutorIds.length) return '';
  const pet = (db.pets || []).find((p: any) =>
    p.id === petId && p.businessId === t.businessId && tutorIds.includes(String(p.tutorId || '')));
  return pet?.name ? String(pet.name) : '';
}

/** Solicitante: quem criou a tarefa (pessoa da equipe) ou a automação. */
export function taskRequesterName(db: any, t: Task): string {
  if (t.createdBy === 'automation') return 'Automação';
  const user = (db.users || []).find((u: any) => u.id === t.createdBy);
  return user?.name ? String(user.name) : '';
}

export function taskView(db: any, t: Task, today: string) {
  // Toda referência é lida DENTRO da unidade da tarefa: um vínculo que não é
  // dali nunca vira nome exibido (defesa em profundidade — a criação já recusa).
  const lead = t.leadId ? (db.leads || []).find((l: any) => l.id === t.leadId && l.businessId === t.businessId) : null;
  const booking = t.bookingId ? (db.bookings || []).find((b: any) => b.id === t.bookingId && b.businessId === t.businessId) : null;
  // A3.4 fix (fechamento do B5): a ficha da pessoa mostra o contato — a view
  // devolve a quem a tarefa está amarrada para a equipe não ficar adivinhando.
  const contact = t.customerId
    ? (db.contacts || []).find((c: any) => (c.id === t.customerId || c.customerId === t.customerId) && c.businessId === t.businessId)
    : null;
  const assignee = t.assignedUserId ? (db.users || []).find((u: any) => u.id === t.assignedUserId) : null;
  return {
    ...t,
    dueLabel: taskDueLabel(t.dueAt, today),
    leadName: lead?.name || '',
    bookingLabel: booking ? `${booking.date.split('-').reverse().join('/')} ${booking.time}` : '',
    contactId: contact?.id || '',
    contactName: contact?.name || t.customerId && booking?.customerName || '',
    patientName: taskPatientName(db, t, contact, booking),
    requesterName: taskRequesterName(db, t),
    assigneeName: assignee?.name || '',
    fromAutomation: t.createdBy === 'automation',
  };
}
