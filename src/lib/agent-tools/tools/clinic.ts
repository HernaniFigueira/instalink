// F3-D — tools de CLÍNICA (leitura do cadastro público/admin da unidade)
import type { ToolDef } from '../types';
import { scheduleSummary, getBusinessOpenStatus } from '../../hours';

function bizOf(ctx: { db: { businesses: Array<any> }; businessId: string }) {
  return ctx.db.businesses.find((b) => b.id === ctx.businessId) || null;
}

export const getClinicInfo: ToolDef<Record<string, never>, {
  name: string; description: string; phone: string; whatsapp: string; email: string; clinicType: string;
}> = {
  name: 'getClinicInfo',
  description: 'Nome, descrição e contato da clínica (unidade da sessão).',
  domain: 'clinic',
  sideEffect: 'read',
  requiresPermission: null,
  requiresConfirm: false,
  inputSchema: [],
  outputSchema: 'any',
  handler: (_input, ctx) => {
    const b = bizOf(ctx);
    if (!b) throw Object.assign(new Error('Unidade não encontrada.'), { status: 404 });
    return {
      name: b.name || '',
      description: b.description || '',
      phone: b.phone || '',
      whatsapp: b.whatsapp || '',
      email: b.email || '',
      clinicType: String(b.clinicType || ''),
    };
  },
};

export const getOpeningHours: ToolDef<Record<string, never>, { summary: string; openNow: boolean; label: string }> = {
  name: 'getOpeningHours',
  description: 'Horários de atendimento e se está aberto agora.',
  domain: 'clinic',
  sideEffect: 'read',
  requiresPermission: null,
  requiresConfirm: false,
  inputSchema: [],
  outputSchema: 'any',
  handler: (_input, ctx) => {
    const b = bizOf(ctx);
    if (!b) throw Object.assign(new Error('Unidade não encontrada.'), { status: 404 });
    const rules = (ctx.db.availability || []).filter((a: any) => a.businessId === ctx.businessId);
    const exceptions = (ctx.db.exceptions || []).filter((e: any) => e.businessId === ctx.businessId);
    const summary = scheduleSummary(b, rules);
    const status = getBusinessOpenStatus(b, rules, exceptions, ctx.now ? new Date(ctx.now) : new Date());
    return {
      summary,
      openNow: !!status?.open,
      label: status?.label || '',
    };
  },
};

export const getLocation: ToolDef<Record<string, never>, { address: string; mapsUrl: string }> = {
  name: 'getLocation',
  description: 'Endereço e link de mapas da unidade.',
  domain: 'clinic',
  sideEffect: 'read',
  requiresPermission: null,
  requiresConfirm: false,
  inputSchema: [],
  outputSchema: 'any',
  handler: (_input, ctx) => {
    const b = bizOf(ctx);
    if (!b) throw Object.assign(new Error('Unidade não encontrada.'), { status: 404 });
    return { address: b.address || '', mapsUrl: b.mapsUrl || '' };
  },
};

export const listServices: ToolDef<{ activeOnly?: boolean }, Array<{ id: string; name: string; durationMin: number; price: number; showPrice: boolean }>> = {
  name: 'listServices',
  description: 'Lista serviços agendáveis da unidade.',
  domain: 'clinic',
  sideEffect: 'read',
  requiresPermission: null,
  requiresConfirm: false,
  inputSchema: [{ name: 'activeOnly', type: 'boolean', required: false }],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const activeOnly = input.activeOnly !== false;
    return (ctx.db.services || [])
      .filter((s) => s.businessId === ctx.businessId && (!activeOnly || s.active !== false))
      .map((s) => ({
        id: s.id,
        name: s.name,
        durationMin: s.durationMin,
        price: s.price,
        showPrice: s.showPrice !== false,
      }));
  },
};

export const getServiceInfo: ToolDef<{ serviceId: string }, { id: string; name: string; durationMin: number; description: string } | null> = {
  name: 'getServiceInfo',
  description: 'Detalhe de um serviço pelo id da unidade.',
  domain: 'clinic',
  sideEffect: 'read',
  requiresPermission: null,
  requiresConfirm: false,
  inputSchema: [{ name: 'serviceId', type: 'string', required: true, max: 64 }],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const s = (ctx.db.services || []).find(
      (x) => x.id === input.serviceId && x.businessId === ctx.businessId,
    );
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
      description: s.description || '',
    };
  },
};

export const listProfessionals: ToolDef<Record<string, never>, Array<{ id: string; name: string; role: string }>> = {
  name: 'listProfessionals',
  description: 'Profissionais ativos da unidade (sem dados de login).',
  domain: 'clinic',
  sideEffect: 'read',
  requiresPermission: null,
  requiresConfirm: false,
  inputSchema: [],
  outputSchema: 'any',
  handler: (_input, ctx) =>
    (ctx.db.professionals || [])
      .filter((p) => p.businessId === ctx.businessId && p.active !== false)
      .map((p) => ({ id: p.id, name: p.name, role: p.role || '' })),
};

export const clinicTools = [
  getClinicInfo, getOpeningHours, getLocation, listServices, getServiceInfo, listProfessionals,
];
