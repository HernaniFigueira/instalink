import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { onlyDigits } from '@/lib/utils';
import { contactNotes } from '@/lib/contacts';
import { getBusinessPipeline, normalizeLeadStageId } from '@/lib/pipeline';
import { taskDueLabel } from '@/lib/automation/tasks';
import { todayISO } from '@/lib/tz';

// GET ?businessId=&q=&page= — cliente 360 (contato-centric).
// A base nasce da relação BusinessCustomer/Contact (cadastro/login na página
// do negócio) e reúne pedidos, agendamentos e conversas daquela pessoa.
// Caminho defensivo: interações sem contato ainda aparecem (dedupe por
// telefone), preservando o histórico legado. Dono.
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1);
  const limit = 30;
  const guard = await requireBusiness(req, businessId, 'clientes');
  if (!guard.ok) return guard.res;
  const db = guard.db;

  interface P {
    key: string;
    contactId: string;
    note: string;
    notes: ReturnType<typeof contactNotes>;
    customerId: string;
    name: string;
    phone: string;
    email: string;
    registered: boolean;
    customerSince: string;
    source: string;
    marketingOptIn: boolean;
    orders: number;
    spent: number;
    lastOrderAt: string;
    bookings: Array<{
      id: string; customerName: string; date: string; time: string; status: string; serviceId: string;
      professionalId: string; rescheduleCount: number; previousId: string;
    }>;
    leads: Array<{ id: string; origin: string; status: string; stageId: string; stageName: string; interest: string; action: string; createdAt: string; priority: string; assignedUserId: string; stageHistory: any[]; lastInteraction: string }>;
    conversations: Array<{ id: string; channel: string; status: string; at: string; preview: string; unread: number }>;
    tasks: Array<{ id: string; title: string; status: string; dueAt: string; dueLabel: string; assignedUserId: string; assigneeName: string; leadId: string; bookingId: string }>;
    lastSeen: string;
  }

  const map = new Map<string, P>();
  const keyOf = (customerId: string, phone: string): string => {
    const digits = onlyDigits(phone || '').replace(/^55(\d{10,11})$/, '$1');
    return customerId ? `c:${customerId}` : digits ? `p:${digits}` : '';
  };
  const get = (customerId: string, rawPhone: string, name: string): P | null => {
    const digits = onlyDigits(rawPhone || '').replace(/^55(\d{10,11})$/, '$1');
    let key = keyOf(customerId, digits);
    if (!key) {
      if (!name) return null;
      key = `nome:${name.toLowerCase()}`;
    }
    let p = map.get(key);
    if (!p) {
      p = {
        key, contactId: '', note: '', notes: [], customerId, name, phone: digits, email: '', registered: false, customerSince: '',
        source: '', marketingOptIn: false,
        orders: 0, spent: 0, lastOrderAt: '', bookings: [], leads: [], conversations: [], tasks: [], lastSeen: '',
      };
      map.set(key, p);
    }
    if (customerId && !p.customerId) p.customerId = customerId;
    if (name && !p.name) p.name = name;
    if (digits && !p.phone) p.phone = digits;
    return p;
  };

  // 1. Contatos (a fonte primária): o cadastro NA PÁGINA já cria a pessoa.
  for (const c of db.contacts.filter((x) => x.businessId === businessId)) {
    const p = get(c.customerId, c.phone, c.name);
    if (!p) continue;
    p.registered = !!c.customerId;
    p.customerSince = c.createdAt;
    p.contactId = c.id;
    // Observações: histórico append-only (autor/data/contexto) + campo legado.
    p.note = c.note || '';
    p.notes = contactNotes(c);
    p.source = c.source;
    p.email = c.email || p.email;
    p.marketingOptIn = c.marketingOptIn === true;
    if (!p.lastSeen || c.lastInteraction > p.lastSeen) p.lastSeen = c.lastInteraction;
  }

  // 2. Agregados de interação (pedidos / agendamentos / leads) da pessoa.
  const services = new Map(db.services.filter((s) => s.businessId === businessId).map((s) => [s.id, s.name]));
  for (const o of db.orders.filter((x) => x.businessId === businessId)) {
    const p = get(o.customerId, o.customerPhone, o.customerName);
    if (!p) continue;
    p.orders += 1;
    if (o.status !== 'cancelled') p.spent += o.total;
    if (!p.lastOrderAt || o.createdAt > p.lastOrderAt) p.lastOrderAt = o.createdAt;
    if (!p.lastSeen || o.createdAt > p.lastSeen) p.lastSeen = o.createdAt;
  }
  for (const b of db.bookings.filter((x) => x.businessId === businessId)) {
    const p = get(b.customerId, b.customerPhone, b.customerName);
    if (!p) continue;
    // Histórico unificado (§16): status, serviço, profissional e a cadeia de
    // reagendamentos — o atendimento concluído continua aqui para sempre,
    // mesmo quando um novo é criado a partir dele.
    p.bookings.push({
      id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status, serviceId: b.serviceId,
      professionalId: b.professionalId || '', rescheduleCount: b.rescheduleCount || 0, previousId: b.previousId || '',
    });
    const at = `${b.date}T${b.time}:00`;
    if (!p.lastSeen || at > p.lastSeen) p.lastSeen = at;
  }
  const pipeline = getBusinessPipeline(db, businessId);
  for (const l of db.leads.filter((x) => x.businessId === businessId)) {
    const p = get(l.customerId, l.phone, l.name);
    if (!p) continue;
    const stageId = normalizeLeadStageId(pipeline, l);
    const stage = pipeline.stages.find((s) => s.id === stageId);
    p.leads.push({ id: l.id, origin: l.origin, status: l.status, stageId, stageName: stage?.name || stageId, interest: l.interest || '', action: l.action || '', createdAt: l.createdAt, priority: l.priority || 'medium', assignedUserId: l.assignedUserId || '', stageHistory: l.stageHistory || [], lastInteraction: l.lastInteraction || l.createdAt });
    if (!p.lastSeen || l.createdAt > p.lastSeen) p.lastSeen = l.createdAt;
    const li = l.lastInteraction || l.createdAt;
    if (!p.lastSeen || li > p.lastSeen) p.lastSeen = li;
  }
  // Tarefas vinculadas à pessoa (por lead/booking/customer)
  const today = todayISO();
  for (const task of (db.tasks || []).filter((x) => x.businessId === businessId)) {
    let p: any = null;
    if (task.leadId) {
      const lead = db.leads.find((l) => l.id === task.leadId && l.businessId === businessId);
      if (lead) p = get(lead.customerId, lead.phone, lead.name);
    }
    if (!p && task.bookingId) {
      const b = db.bookings.find((x) => x.id === task.bookingId && x.businessId === businessId);
      if (b) p = get(b.customerId, b.customerPhone, b.customerName);
    }
    if (!p && task.customerId) {
      const c = db.contacts.find((x) => (x.id === task.customerId || x.customerId === task.customerId) && x.businessId === businessId);
      if (c) p = get(c.customerId, c.phone, c.name);
    }
    if (!p) continue;
    const assignee = task.assignedUserId ? db.users.find((u) => u.id === task.assignedUserId) : null;
    p.tasks.push({ id: task.id, title: task.title, status: task.status, dueAt: task.dueAt || '', dueLabel: taskDueLabel(task.dueAt || '', today), assignedUserId: task.assignedUserId || '', assigneeName: assignee?.name || '', leadId: task.leadId || '', bookingId: task.bookingId || '' });
    if (!p.lastSeen || task.updatedAt > p.lastSeen) p.lastSeen = task.updatedAt;
  }
  // Conversas (WhatsApp/agente) entram como eventos independentes do histórico.
  const convById = new Map(db.conversations.filter((c) => c.businessId === businessId).map((c) => [c.id, c]));
  for (const c of convById.values()) {
    const p = get(c.customerId, c.phone, c.name);
    if (!p) continue;
    p.conversations.push({
      id: c.id, channel: c.channel, status: c.status, at: c.lastMessageAt || c.createdAt,
      preview: c.lastMessagePreview || '', unread: c.unread || 0,
    });
    if (!p.lastSeen || (c.lastMessageAt || '') > p.lastSeen) p.lastSeen = c.lastMessageAt || p.lastSeen;
  }

  let people = [...map.values()];
  people.forEach((p) => p.leads.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  people.forEach((p) => p.bookings.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)));
  people.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
  if (q) {
    const qd = q.replace(/\D/g, '');
    people = people.filter((p) =>
      p.name.toLowerCase().includes(q) || (qd && p.phone.replace(/\D/g, '').includes(qd)),
    );
  }
  const total = people.length;
  const pros = new Map(db.professionals.filter((p) => p.businessId === businessId).map((p) => [p.id, p.name]));
  const slice = people.slice((page - 1) * limit, page * limit).map((p) => ({
    ...p,
    bookings: p.bookings.map((b) => ({
      ...b,
      service: services.get(b.serviceId) || 'Serviço',
      professional: b.professionalId ? pros.get(b.professionalId) || '' : '',
    })),
  }));
  return NextResponse.json({ people: slice, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}
