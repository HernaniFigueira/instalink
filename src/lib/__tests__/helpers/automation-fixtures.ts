// Fixtures compartilhadas dos testes do P4 (motor de automações).
// Nada aqui toca o banco: os testes operam sobre `emptyDB()` em memória e,
// quando precisam de persistência, usam o banco temporário do temp-db.ts.
import { emptyDB } from '../../db';
import { DEFAULT_PIPELINE_STAGES } from '../../pipeline';
import { linearToGraph, validateAutomationDraft, type LinearStep } from '../../automation/model';
import type {
  Automation, AutomationEventId, Business, BusinessPipeline, DB, Service, User,
} from '../../types';

export const FIXED_NOW = '2026-09-16T12:00:00.000Z';

export function biz(id: string, extra: Partial<Business> = {}): Business {
  return {
    id,
    ownerId: `owner-${id}`,
    organizationId: `org-${id}`,
    name: `Negócio ${id}`,
    slug: id,
    description: '',
    logo: '',
    cover: '',
    niche: 'servicos',
    modes: ['services', 'bookings'],
    phone: '',
    whatsapp: '11999990000',
    email: '',
    instagram: '',
    tiktok: '',
    address: '',
    mapsUrl: '',
    hours: {
      1: { open: '09:00', close: '18:00' },
      2: { open: '09:00', close: '18:00' },
      3: { open: '09:00', close: '18:00' },
      4: { open: '09:00', close: '18:00' },
      5: { open: '09:00', close: '18:00' },
    },
    paymentMethods: [],
    pixKey: '',
    deliveryFee: 0,
    minOrder: 0,
    googleUrl: '',
    googlePlaceId: '',
    googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
    nav: [],
    navCustom: false,
    about: { title: '', text: '', image: '', enabled: false },
    published: true,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...extra,
  };
}

export function service(id: string, businessId: string, extra: Partial<Service> = {}): Service {
  return {
    id,
    businessId,
    categoryId: '',
    name: 'Corte',
    description: '',
    image: '',
    price: 5000,
    showPrice: true,
    durationMin: 30,
    professionalIds: [],
    active: true,
    featured: false,
    bookable: true,
    questions: [],
    ...extra,
  };
}

export function user(id: string, name: string, role: User['role'] = 'owner'): User {
  return { id, name, email: `${id}@t.com`, passwordHash: 'x', createdAt: FIXED_NOW, role, active: true, lastLoginAt: '' };
}

export function automationFixtures() {
  const db: DB = emptyDB();
  db.businesses.push(biz('b1'), biz('b2'));
  db.users.push(user('owner-b1', 'Dono B1'), user('ana', 'Ana'), user('bruno', 'Bruno'), user('other', 'Gente de fora'));
  db.members.push(
    {
      id: 'm-ana', businessId: 'b1', userId: 'ana', role: 'SECRETARIA', permissions: {},
      active: true, note: 'Secretaria', invitedBy: 'owner-b1', createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
    },
    {
      id: 'm-bruno', businessId: 'b1', userId: 'bruno', role: 'ATENDENTE', permissions: {},
      active: true, note: 'Atendente', invitedBy: 'owner-b1', createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
    },
  );
  db.services.push(service('srv1', 'b1'), service('srv2', 'b2'));
  const pipeline: BusinessPipeline = {
    id: 'pipe-1',
    businessId: 'b1',
    stages: DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s })),
    updatedAt: FIXED_NOW,
  };
  db.pipelines.push(pipeline);
  return db;
}

export interface BuildOptions {
  event?: AutomationEventId;
  condition?: any;
  steps?: LinearStep[];
  elseSteps?: LinearStep[];
  active?: boolean;
  settings?: Record<string, any>;
  serviceIds?: string[];
  businessId?: string;
  id?: string;
  name?: string;
}

/**
 * Constrói uma automação VALIDADA (mesmo caminho da API), pronta para entrar em
 * um `db` de teste. `validateAutomationDraft` é o gate real de gravação.
 */
export function buildAutomation(opts: BuildOptions = {}): Automation {
  const { nodes, edges } = linearToGraph({
    event: opts.event || 'lead.created',
    condition: opts.condition ?? null,
    steps: opts.steps || [],
    elseSteps: opts.elseSteps || [],
  });
  const validation = validateAutomationDraft({
    name: opts.name || 'Automação de teste',
    description: '',
    active: opts.active !== false,
    event: opts.event || 'lead.created',
    condition: opts.condition,
    nodes,
    edges,
    settings: opts.settings || {},
  }, {
    stages: DEFAULT_PIPELINE_STAGES.map((s) => ({ id: s.id, name: s.name })),
    serviceIds: opts.serviceIds || ['srv1'],
  });
  if (!validation.ok) throw new Error(`automação inválida no fixture: ${validation.errors.join(' | ')}`);
  return {
    ...validation.automation,
    id: opts.id || 'auto-1',
    businessId: opts.businessId || 'b1',
    version: 1,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

export function addLead(db: DB, overrides: Partial<DB['leads'][number]> = {}) {
  const lead = {
    id: 'lead-1',
    businessId: 'b1',
    customerId: '',
    name: 'Rafael',
    phone: '11988887777',
    email: 'raf@exemplo.com',
    instagram: '',
    origin: 'instagram',
    interest: 'Corte',
    action: 'contato',
    status: 'new',
    stageId: 'new',
    priority: 'medium',
    assignedUserId: '',
    nextAction: '',
    serviceId: '',
    professionalId: '',
    sourceUrl: '',
    metadata: {},
    notes: [],
    stageHistory: [],
    createdAt: FIXED_NOW,
    lastInteraction: FIXED_NOW,
    ...overrides,
  } as DB['leads'][number];
  db.leads.push(lead);
  return lead;
}

export function addContact(db: DB, overrides: Partial<DB['contacts'][number]> = {}) {
  const contact = {
    id: 'ct-1',
    businessId: 'b1',
    customerId: '',
    name: 'Rafael',
    phone: '11988887777',
    email: 'raf@exemplo.com',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    source: 'lead',
    lastInteraction: FIXED_NOW,
    marketingOptIn: false,
    notes: [],
    ...overrides,
  } as DB['contacts'][number];
  db.contacts.push(contact);
  return contact;
}
