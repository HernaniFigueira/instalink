// ═══════════════════════════════════════════════════════════════
// DOCUMENTO SINTÉTICO para homologação da migração (handoff §6).
// ═══════════════════════════════════════════════════════════════
// A origem real (Neon) estava bloqueada por quota — a validação do esquema,
// do importador e do núcleo operacional usa ESTE dataset, pequeno e
// verificável: 1 organização (clínica), 2 UNIDADES, equipe, clientes,
// serviços, disponibilidade e agendamentos em períodos distintos.
//
// NUNCA usar contra produção: o destino é decidido por quem invoca — e o
// importador recusa base populada sem decisão explícita.
import { randomUUID } from 'node:crypto';
import type { DB } from '../../../types';
import { emptyDB } from '../../../db';

export function syntheticDocument(now = new Date('2026-09-21T12:00:00Z')): DB {
  const db = emptyDB();
  const t = (offsetDays = 0, hm = '10:00') => {
    const d = new Date(now.getTime() + offsetDays * 86400000);
    return { iso: d.toISOString(), date: d.toISOString().slice(0, 10), time: hm };
  };
  const owner = { id: 'usr_owner_1', name: 'Dona Clínica', email: 'dona@godoutor.test' };
  const org = { id: 'org_clinica', name: 'Clínica GoDoutor', ownerId: owner.id };

  db.users.push({
    id: owner.id, name: owner.name, email: owner.email,
    passwordHash: 'sha512$0000$hash-de-teste', createdAt: t(-300).iso, role: 'owner',
  });
  db.users.push({
    id: 'usr_master_1', name: 'Master', email: 'master@godoutor.test',
    passwordHash: 'sha512$0000$hash-de-teste', createdAt: t(-300).iso, role: 'master',
  });
  db.organizations.push({
    id: org.id, name: org.name, ownerId: org.ownerId, metadata: {},
    createdAt: t(-200).iso, updatedAt: t(-200).iso,
  });

  // ── Unidade A (com página, serviços, equipe e agenda cheia) ──
  const unitA = 'biz_unidade_a';
  const unitB = 'biz_unidade_b';
  for (const [id, name, slug] of [[unitA, 'Unidade Centro', 'unidade-centro'], [unitB, 'Unidade Praia', 'unidade-praia']] as const) {
    db.businesses.push({
      id, ownerId: owner.id, organizationId: org.id, name, slug,
      description: 'Unidade de teste', logo: '', cover: '', niche: 'saude',
      modes: ['bookings'], phone: '1199999000', whatsapp: '1199999000', email: 'contato@godoutor.test',
      instagram: '', tiktok: '', address: '', mapsUrl: '',
      hours: { '1': { open: '08:00', close: '18:00' }, '2': { open: '08:00', close: '18:00' } },
      paymentMethods: ['pix'], pixKey: '', deliveryFee: 0, minOrder: 0,
      googleUrl: '', googlePlaceId: '', googleApiKey: '',
      booking: { teamMode: 'choosable', leadMin: 30, cancelUntilMin: 120, horizonDays: 60, bufferMin: 0 },
      nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
      published: true, createdAt: t(-200).iso, updatedAt: t(-10).iso,
    });
    db.pages.push({
      id: `page_${id}`, businessId: id,
      theme: { primary: '#0ea5e9', secondary: '#0369a1', background: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b', radius: 12, font: 'inter', buttonStyle: 'solid' },
      blocks: [{ id: 'b1', type: 'profile', order: 0, enabled: true, settings: {} }, { id: 'b2', type: 'booking', order: 1, enabled: true, settings: {} }],
      updatedAt: t(-10).iso,
    });
    db.services.push({
      id: `srv_${id}_consulta`, businessId: id, categoryId: '', name: 'Consulta',
      description: '', image: '', price: 15000, durationMin: 30,
      professionalIds: [], active: true, featured: true, bookable: true, questions: ['Veio por indicação?'],
    });
    db.services.push({
      id: `srv_${id}_retorno`, businessId: id, categoryId: '', name: 'Retorno',
      description: '', image: '', price: 0, durationMin: 15,
      professionalIds: [], active: true, featured: false, bookable: true, questions: [],
    });
    db.professionals.push({
      id: `pro_${id}_ana`, businessId: id, name: 'Ana', role: 'Fisioterapeuta',
      photo: '', active: true, userId: '', followBusinessHours: true,
    });
    db.professionals.push({
      id: `pro_${id}_bruno`, businessId: id, name: 'Bruno', role: 'Terapeuta',
      photo: '', active: true, userId: '', followBusinessHours: true,
    });
    // Horário geral da clínica (professionalId '') + personalizado da Ana.
    for (let weekday = 1; weekday <= 5; weekday++) {
      db.availability.push({ id: randomUUID(), businessId: id, professionalId: '', serviceId: '', weekday, start: '08:00', end: '18:00', slotMin: 30 });
    }
    db.availability.push({ id: randomUUID(), businessId: id, professionalId: `pro_${id}_ana`, serviceId: '', weekday: 6, start: '08:00', end: '12:00', slotMin: 30 });
    db.availability.push({ id: randomUUID(), businessId: id, professionalId: `pro_${id}_ana`, serviceId: '', weekday: 1, start: '08:00', end: '12:00', slotMin: 30 });
    db.availability.push({ id: randomUUID(), businessId: id, professionalId: `pro_${id}_ana`, serviceId: '', weekday: 2, start: '08:00', end: '12:00', slotMin: 30 });
    db.availability.push({ id: randomUUID(), businessId: id, professionalId: `pro_${id}_ana`, serviceId: '', weekday: 3, start: '08:00', end: '12:00', slotMin: 30 });
    db.availability.push({ id: randomUUID(), businessId: id, professionalId: `pro_${id}_ana`, serviceId: '', weekday: 4, start: '08:00', end: '12:00', slotMin: 30 });
    db.availability.push({ id: randomUUID(), businessId: id, professionalId: `pro_${id}_ana`, serviceId: '', weekday: 5, start: '08:00', end: '12:00', slotMin: 30 });
    db.members.push({
      id: `mem_${id}`, businessId: id, userId: owner.id, role: 'OWNER',
      permissions: {}, active: true, note: '', invitedBy: '', createdAt: t(-200).iso, updatedAt: t(-200).iso,
    });
  }

  // Exceção na unidade A (dia fechado no período da janela de testes).
  db.exceptions.push({
    id: 'exc_feriado_a', businessId: unitA, date: t(+3).date,
    closed: true, start: '', end: '', note: 'Feriado (teste)',
  });

  // ── Clientes (contas globais) e contatos do CRM por unidade ──
  db.customers.push({
    id: 'cus_carla', name: 'Carla', phone: '11988887777', email: 'carla@cliente.test',
    passwordHash: 'sha512$0000$hash', googleId: '', avatar: '', createdAt: t(-100).iso,
  });
  db.contacts.push({
    id: 'ct_a_carla', businessId: unitA, customerId: 'cus_carla', name: 'Carla',
    phone: '11988887777', email: 'carla@cliente.test', createdAt: t(-100).iso,
    updatedAt: t(-5).iso, source: 'agendamento', lastInteraction: t(-5).iso, marketingOptIn: true,
    note: '', notes: [], profile: undefined, channelIdentities: [],
  });
  db.contacts.push({
    id: 'ct_b_diogo', businessId: unitB, customerId: '', name: 'Diogo', phone: '11977776666',
    email: '', createdAt: t(-50).iso, updatedAt: t(-2).iso, source: 'lead',
    lastInteraction: t(-2).iso, marketingOptIn: false, note: '', notes: [],
  });

  // ── Agendamentos em PERÍODOS distintos (passado, hoje, futuro) ──
  const mk = (id: string, businessId: string, date: string, time: string, status: any, pro: string, service: string, phone: string, name: string) => {
    const createdAt = `${date}T${time}:00Z`;
    db.bookings.push({
      id, businessId, customerId: '', serviceId: service, professionalId: pro,
      date, time, customerName: name, customerPhone: phone, status, note: '',
      answers: [], createdAt, updatedAt: createdAt, history: [],
      rescheduleCount: 0, bookingKind: 'standard',
    });
  };
  // Unidade A: um no passado (concluído), um "hoje" (confirmado) e dois futuros.
  mk('bk_a1', unitA, t(-7).date, '09:00', 'completed', `pro_${unitA}_ana`, `srv_${unitA}_consulta`, '11988887777', 'Carla');
  mk('bk_a2', unitA, t(0).date, '10:00', 'confirmed', `pro_${unitA}_bruno`, `srv_${unitA}_consulta`, '11988887777', 'Carla');
  mk('bk_a3', unitA, t(+1).date, '11:00', 'pending', `pro_${unitA}_ana`, `srv_${unitA}_retorno`, '11977776666', 'Diogo');
  mk('bk_a4', unitA, t(+2).date, '14:00', 'confirmed', '', `srv_${unitA}_consulta`, '11966665555', 'Elisa');
  // Unidade B: um no mesmo "hoje" (isolação entre unidades) e um futuro.
  mk('bk_b1', unitB, t(0).date, '10:00', 'confirmed', `pro_${unitB}_ana`, `srv_${unitB}_consulta`, '11977776666', 'Diogo');
  mk('bk_b2', unitB, t(+5).date, '15:00', 'pending', '', `srv_${unitB}_retorno`, '11955554444', 'Fabiana');

  // ── Fila + atendimento (A3.4) ──
  db.queue.push({
    id: 'q_1', businessId: unitA, customerName: 'Gustavo', customerPhone: '11944443333',
    contactId: '', serviceId: '', professionalId: '', bookingId: '', note: 'chegou sem horário',
    status: 'waiting', date: t(0).date, createdAt: t(0).iso, calledAt: '', startedAt: '',
    endedAt: '', updatedBy: '', updatedAt: t(0).iso,
  });
  db.encounters.push({
    id: 'enc_1', businessId: unitA, bookingId: 'bk_a1', queueId: '', serviceId: `srv_${unitA}_consulta`,
    professionalId: `pro_${unitA}_ana`, customerId: 'cus_carla', contactId: 'ct_a_carla',
    customerName: 'Carla', date: t(-7).date, time: '09:00', complaint: 'dor lombar',
    evolution: 'sessão realizada', guidance: 'alongar', followUp: 'em 30 dias',
    internalNote: '', tags: [], status: 'finalized', version: 1,
    createdAt: t(-7).iso, updatedAt: t(-7).iso, createdBy: 'usr_owner_1', updatedBy: 'usr_owner_1',
    finalizedAt: t(-7).iso, finalizedBy: 'usr_owner_1', signedBy: 'Ana',
  });

  // ── Eventos analíticos em períodos distintos ──
  db.events.push({ id: 'ev_1', businessId: unitA, type: 'page_view', path: '/', meta: {}, createdAt: t(-7).iso });
  db.events.push({ id: 'ev_2', businessId: unitA, type: 'booking_created', path: '', meta: { serviceId: `srv_${unitA}_consulta` }, createdAt: t(0).iso });
  db.events.push({ id: 'ev_3', businessId: unitB, type: 'page_view', path: '/', meta: {}, createdAt: t(0).iso });

  // ── Conversa + mensagem (inbox) ──
  db.conversations.push({
    id: 'conv_1', businessId: unitA, channel: 'whatsapp', channelUserId: '11988887777',
    channelAccountId: '', contactId: 'ct_a_carla', customerId: 'cus_carla', name: 'Carla',
    phone: '11988887777', status: 'open', mode: 'automation', unread: 0,
    lastMessageAt: t(-1).iso, lastMessagePreview: 'Olá! Confirmação...', createdAt: t(-1).iso, context: {},
  });
  db.messages.push({
    id: 'msg_1', businessId: unitA, conversationId: 'conv_1', direction: 'out',
    body: 'Olá! Registramos seu agendamento.', status: 'pending',
    externalId: `auto:booking_confirmation:bk_a2`, by: 'automation', at: t(-1).iso,
  });

  // ── Lead na esteira ──
  db.leads.push({
    id: 'lead_1', businessId: unitB, customerId: '', name: 'Diogo', phone: '11977776666',
    email: '', instagram: '', origin: 'site', channel: 'landing_page', interest: 'Consulta',
    action: '', status: 'new', createdAt: t(-30).iso, lastInteraction: t(-30).iso, stageId: 'new',
    notes: [], stageHistory: [],
  });

  // ── Automação P4 (gatilho booking.created) ──
  db.automations.push({
    id: 'aut_1', businessId: unitA, name: 'Pós-agendamento', description: '', active: true,
    trigger: { event: 'booking.created' },
    nodes: [{ id: 'n1', type: 'trigger', config: { event: 'booking.created' } }, { id: 'n2', type: 'end', config: {} }],
    edges: [{ from: 'n1', to: 'n2' }],
    settings: {}, version: 1, createdByUserId: owner.id, createdAt: t(-20).iso, updatedAt: t(-20).iso,
  });
  db.automationRuns.push({
    id: 'run_1', businessId: unitA, automationId: 'aut_1', automationName: 'Pós-agendamento',
    status: 'completed', triggerEvent: 'booking.created', currentNodeId: 'n2',
    context: { event: { name: 'booking.created' } }, waitingUntil: '', startedAt: t(-1).iso,
    updatedAt: t(-1).iso, finishedAt: t(-1).iso, error: '', history: [], eventKey: 'booking.created:bk_a2:x',
    emittedByRunId: '', steps: 2, resumes: 0,
  });

  return db;
}
