import { NextRequest, NextResponse } from 'next/server';
import { requireBusiness } from '@/lib/access';
import { contactNotes } from '@/lib/contacts';
import { getBusinessPipeline, normalizeLeadStageId } from '@/lib/pipeline';
import { taskDueLabel } from '@/lib/automation/tasks';
import { todayISO } from '@/lib/tz';
import { buildPeople360IdentityIndex, people360Phone, type People360Identity } from '@/lib/people360-identity';
// A3.3 — carteirinha do cliente: o 360 entrega também o cadastro rico.
import { ageFromBirthDate, clientTags, countAttended, emptyProfile, isMinor, profileOf } from '@/lib/contact-profile';
import type { ContactProfile } from '@/lib/types';

// GET ?businessId=&q=&page= — cliente 360 (contato-centric).
// A base nasce da relação BusinessCustomer/Contact (cadastro/login na página
// do negócio) e reúne pedidos, agendamentos e conversas daquela pessoa.
// Caminho defensivo: interações sem contato ainda aparecem (dedupe por
// telefone), preservando o histórico legado. Dono.
/** Dígitos de um texto (busca por CPF na carteira). */
function onlyDigitsOf(v: string): string {
  return String(v || '').replace(/\D/g, '');
}

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') || '1', 10) || 1);
  // A3.3 — filtros da lista de clientes (aplicados ANTES da paginação, então o
  // total e o número de páginas refletem o filtro — nunca "página 1 de 1" falso).
  const accessFilter = req.nextUrl.searchParams.get('access') || '';   // 'active' | 'none'
  const consentFilter = req.nextUrl.searchParams.get('consent') || ''; // 'yes' | 'no'
  const minorFilter = (req.nextUrl.searchParams.get('minor') || '') === 'yes';
  // Ponto 9 — "já atendidos" = atendimento CONCLUÍDO, não "tem booking".
  const attendedOnly = (req.nextUrl.searchParams.get('attended') || '') === 'yes';
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
    accountStatus: 'none' | 'active';
    accountEmail: string;
    accountPhone: string;
    mustChangePassword: boolean;
    /**
     * Foto da CONTA global (`Customer.avatar`), quando existe vínculo.
     * Não há segunda foto no contato: sem conta, a UI usa as iniciais.
     */
    avatar: string;
    customerSince: string;
    source: string;
    marketingOptIn: boolean;
    /** A3.3 — dados cadastrais (carteirinha). Vazio quando nunca preenchidos. */
    profile: ContactProfile;
    /** Idade DERIVADA da data de nascimento (null = não informado). */
    age: number | null;
    /** Etiquetas derivadas (menor, responsável, lead, acesso, consentimento). */
    tags: Array<{ id: string; label: string; tone: string; hint: string }>;
    orders: number;
    spent: number;
    lastOrderAt: string;
    bookings: Array<{
      id: string; customerName: string; date: string; time: string; status: string; serviceId: string;
      seriesId?: string; seriesIndex?: number; seriesCount?: number;
      professionalId: string; rescheduleCount: number; previousId: string;
    }>;
    leads: Array<{ id: string; origin: string; status: string; stageId: string; stageName: string; interest: string; action: string; createdAt: string; priority: string; assignedUserId: string; stageHistory: any[]; lastInteraction: string }>;
    conversations: Array<{ id: string; channel: string; status: string; at: string; preview: string; unread: number }>;
    tasks: Array<{ id: string; title: string; status: string; dueAt: string; dueLabel: string; assignedUserId: string; assigneeName: string; leadId: string; bookingId: string }>;
    lastSeen: string;
  }

  const contacts = db.contacts.filter((x) => x.businessId === businessId);
  const orders = db.orders.filter((x) => x.businessId === businessId);
  const bookings = db.bookings.filter((x) => x.businessId === businessId);
  const leads = db.leads.filter((x) => x.businessId === businessId);
  const conversations = db.conversations.filter((x) => x.businessId === businessId);
  const tasks = (db.tasks || []).filter((x) => x.businessId === businessId);

  // Monta todos os aliases ANTES de criar o Map. Assim, quando um contato
  // legado passa de `phone` para `customerId`, o componente já conhece os dois
  // lados e nenhum evento histórico precisa ser regravado ou migrado.
  const identityRecords: People360Identity[] = [
    ...contacts.map((c) => ({ customerId: c.customerId, phone: c.phone, contactId: c.id })),
    ...orders.map((o) => ({ customerId: o.customerId, phone: o.customerPhone })),
    ...bookings.map((b) => ({ customerId: b.customerId, phone: b.customerPhone })),
    ...leads.map((l) => ({ customerId: l.customerId, phone: l.phone })),
    ...conversations.map((c) => ({ customerId: c.customerId, phone: c.phone, contactId: c.contactId })),
  ];

  for (const task of tasks) {
    const linkedLead = task.leadId ? leads.find((l) => l.id === task.leadId) : undefined;
    const linkedBooking = task.bookingId ? bookings.find((b) => b.id === task.bookingId) : undefined;
    const linkedContact = task.customerId
      ? contacts.find((c) => c.id === task.customerId || c.customerId === task.customerId)
      : undefined;
    if (linkedLead) identityRecords.push({ customerId: linkedLead.customerId, phone: linkedLead.phone });
    else if (linkedBooking) identityRecords.push({ customerId: linkedBooking.customerId, phone: linkedBooking.customerPhone });
    else if (linkedContact) identityRecords.push({ customerId: linkedContact.customerId, phone: linkedContact.phone, contactId: linkedContact.id });
    else if (task.customerId) identityRecords.push({ customerId: task.customerId });
  }

  const identity = buildPeople360IdentityIndex(identityRecords);
  const map = new Map<string, P>();
  const selectedContact = new Map<P, { hasCustomer: boolean; createdAt: string; id: string }>();

  const accountFor = (p: P): void => {
    const account = p.customerId ? db.customers.find((customer) => customer.id === p.customerId) : undefined;
    p.registered = !!account;
    p.accountStatus = account ? 'active' : 'none';
    p.accountEmail = account?.email || '';
    p.accountPhone = account?.phone || '';
    p.mustChangePassword = account?.mustChangePassword === true;
    // Ponto 8 — avatar REAL vem da conta global, nunca de um campo novo no
    // contato. Sem Customer vinculado, continua '' e a UI cai nas iniciais.
    p.avatar = account?.avatar || '';
  };

  const get = (customerId: string, rawPhone: string, name: string, contactId = ''): P | null => {
    const digits = people360Phone(rawPhone);
    const key = identity.key({ customerId, phone: digits, contactId }, name);
    if (!key) return null;
    let p = map.get(key);
    if (!p) {
      p = {
        key, contactId: '', note: '', notes: [], customerId: '', name: '', phone: '', email: '', registered: false,
        accountStatus: 'none', accountEmail: '', accountPhone: '', mustChangePassword: false, customerSince: '',
        avatar: '',
        source: '', marketingOptIn: false, profile: emptyProfile(), age: null, tags: [],
        orders: 0, spent: 0, lastOrderAt: '', bookings: [], leads: [], conversations: [], tasks: [], lastSeen: '',
      };
      map.set(key, p);
    }
    // Dados legados podem conter mais de um evento com o mesmo telefone e
    // CustomerId. Se houver conflito, a escolha do alias também precisa ser
    // estável e independente da ordem física do JSON.
    if (customerId && (!p.customerId || customerId < p.customerId)) p.customerId = customerId;
    if (name && !p.name) p.name = name;
    if (digits && !p.phone) p.phone = digits;
    if (contactId && !p.contactId) p.contactId = contactId;
    accountFor(p);
    return p;
  };

  // 1. Contatos (a fonte primária): o cadastro NA PÁGINA já cria a pessoa.
  for (const c of contacts) {
    const p = get(c.customerId, c.phone, c.name, c.id);
    if (!p) continue;
    const rank = { hasCustomer: !!c.customerId, createdAt: c.createdAt || '', id: c.id };
    const previous = selectedContact.get(p);
    const choose = !previous
      || (rank.hasCustomer && !previous.hasCustomer)
      || (rank.hasCustomer === previous.hasCustomer && `${rank.createdAt}:${rank.id}` < `${previous.createdAt}:${previous.id}`);
    if (choose) {
      selectedContact.set(p, rank);
      p.contactId = c.id;
      p.note = c.note || p.note;
      p.customerSince = p.customerSince && p.customerSince < c.createdAt ? p.customerSince : c.createdAt;
      p.source = c.source || p.source;
    }
    // Carteirinha: o contato canônico manda, mas um contato legado pode ter o
    // cadastro preenchido — nunca descartamos dado cadastral existente.
    const contactProfile = profileOf(c);
    p.profile = p.contactId === c.id ? contactProfile : (p.profile.birthDate || p.profile.cpf ? p.profile : contactProfile);
    p.age = ageFromBirthDate(p.profile.birthDate);
    if (!choose && (!p.customerSince || c.createdAt < p.customerSince)) {
      p.customerSince = c.createdAt;
    }
    // Se houver contatos legados duplicados no mesmo telefone, não descarta
    // observações nem consentimento ao escolher o contato canônico.
    const knownNotes = new Set(p.notes.map((note) => note.id));
    for (const note of contactNotes(c)) {
      if (!knownNotes.has(note.id)) p.notes.push(note);
    }
    p.email = p.email || c.email || '';
    p.marketingOptIn = p.marketingOptIn || c.marketingOptIn === true;
    if (!p.lastSeen || c.lastInteraction > p.lastSeen) p.lastSeen = c.lastInteraction;
    accountFor(p);
  }

  // 2. Agregados de interação (pedidos / agendamentos / leads) da pessoa.
  const services = new Map(db.services.filter((s) => s.businessId === businessId).map((s) => [s.id, s.name]));
  for (const o of orders) {
    const p = get(o.customerId, o.customerPhone, o.customerName);
    if (!p) continue;
    p.orders += 1;
    if (o.status !== 'cancelled') p.spent += o.total;
    if (!p.lastOrderAt || o.createdAt > p.lastOrderAt) p.lastOrderAt = o.createdAt;
    if (!p.lastSeen || o.createdAt > p.lastSeen) p.lastSeen = o.createdAt;
  }
  for (const b of bookings) {
    const p = get(b.customerId, b.customerPhone, b.customerName);
    if (!p) continue;
    // Histórico unificado (§16): status, serviço, profissional e a cadeia de
    // reagendamentos — o atendimento concluído continua aqui para sempre,
    // mesmo quando um novo é criado a partir dele.
    p.bookings.push({
      id: b.id, customerName: b.customerName, date: b.date, time: b.time, status: b.status, serviceId: b.serviceId,
      seriesId: b.seriesId, seriesIndex: b.seriesIndex, seriesCount: b.seriesCount,
      professionalId: b.professionalId || '', rescheduleCount: b.rescheduleCount || 0, previousId: b.previousId || '',
    });
    const at = `${b.date}T${b.time}:00`;
    if (!p.lastSeen || at > p.lastSeen) p.lastSeen = at;
  }
  const pipeline = getBusinessPipeline(db, businessId);
  for (const l of leads) {
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
  for (const task of tasks) {
    let p: P | null = null;
    if (task.leadId) {
      const lead = leads.find((l) => l.id === task.leadId);
      if (lead) p = get(lead.customerId, lead.phone, lead.name);
    }
    if (!p && task.bookingId) {
      const b = bookings.find((x) => x.id === task.bookingId);
      if (b) p = get(b.customerId, b.customerPhone, b.customerName);
    }
    if (!p && task.customerId) {
      const c = contacts.find((x) => x.id === task.customerId || x.customerId === task.customerId);
      if (c) p = get(c.customerId, c.phone, c.name, c.id);
      else p = get(task.customerId, '', '');
    }
    if (!p) continue;
    const assignee = task.assignedUserId ? db.users.find((u) => u.id === task.assignedUserId) : null;
    p.tasks.push({ id: task.id, title: task.title, status: task.status, dueAt: task.dueAt || '', dueLabel: taskDueLabel(task.dueAt || '', today), assignedUserId: task.assignedUserId || '', assigneeName: assignee?.name || '', leadId: task.leadId || '', bookingId: task.bookingId || '' });
    if (!p.lastSeen || task.updatedAt > p.lastSeen) p.lastSeen = task.updatedAt;
  }
  // Conversas (WhatsApp/agente) entram como eventos independentes do histórico.
  for (const c of conversations) {
    const p = get(c.customerId, c.phone, c.name, c.contactId);
    if (!p) continue;
    p.conversations.push({
      id: c.id, channel: c.channel, status: c.status, at: c.lastMessageAt || c.createdAt,
      preview: c.lastMessagePreview || '', unread: c.unread || 0,
    });
    if (!p.lastSeen || (c.lastMessageAt || '') > p.lastSeen) p.lastSeen = c.lastMessageAt || p.lastSeen;
  }

  let people = [...map.values()];
  // Etiquetas DERIVADAS depois de todos os eventos conhecidos: uma pessoa pode
  // ser "cliente atendido" E "lead no funil" ao mesmo tempo.
  people.forEach((p) => {
    p.tags = clientTags({
      name: p.name,
      accountStatus: p.accountStatus,
      marketingOptIn: p.marketingOptIn,
      bookingsCount: p.bookings.length,
      // Ponto 9 — só atendimento CONCLUÍDO autoriza "Cliente atendido".
      attendedCount: countAttended(p.bookings),
      leadsCount: p.leads.length,
      profile: p.profile,
    });
  });
  people.forEach((p) => p.leads.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  people.forEach((p) => p.bookings.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1)));
  people.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
  if (q) {
    const qd = people360Phone(q);
    people = people.filter((p) =>
      p.name.toLowerCase().includes(q)
      || (qd && p.phone.includes(qd))
      || p.email.toLowerCase().includes(q)
      // CPF só entra na busca com trecho longo: 2-3 dígitos casariam com quase todos.
      || (qd.length >= 6 && onlyDigitsOf(p.profile.cpf).includes(qd)),
    );
  }
  if (accessFilter === 'active' || accessFilter === 'none') {
    people = people.filter((p) => p.accountStatus === accessFilter);
  }
  if (consentFilter === 'yes' || consentFilter === 'no') {
    const want = consentFilter === 'yes';
    people = people.filter((p) => p.marketingOptIn === want);
  }
  if (minorFilter) people = people.filter((p) => isMinor(p.profile));
  if (attendedOnly) people = people.filter((p) => countAttended(p.bookings) > 0);
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
