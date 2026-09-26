// F3-D — tools de PESSOAS (CRM: contatos; SEM prontuário/anamnese)
import type { ToolDef } from '../types';
import { findContact, upsertContact } from '../../contacts';
import { onlyDigits } from '../../utils';

export const findClient: ToolDef<{ query?: string; phone?: string; email?: string }, Array<{
  id: string; name: string; phone: string; email: string;
}>> = {
  name: 'findClient',
  description: 'Busca cliente na carteira da unidade por nome, telefone ou e-mail.',
  domain: 'people',
  sideEffect: 'read',
  requiresPermission: 'clientes',
  requiresConfirm: false,
  inputSchema: [
    { name: 'query', type: 'string', required: false, max: 120 },
    { name: 'phone', type: 'string', required: false, max: 20 },
    { name: 'email', type: 'string', required: false, max: 120 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const q = String(input.query || '').toLowerCase().trim();
    const digits = onlyDigits(input.phone || '');
    const email = String(input.email || '').toLowerCase().trim();
    return (ctx.db.contacts || [])
      .filter((c) => c.businessId === ctx.businessId)
      .filter((c) => {
        if (digits && onlyDigits(c.phone) === digits) return true;
        if (email && (c.email || '').toLowerCase() === email) return true;
        if (q && (c.name || '').toLowerCase().includes(q)) return true;
        if (!digits && !email && q && (c.phone || '').includes(q)) return true;
        return false;
      })
      .slice(0, 20)
      .map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email || '' }));
  },
};

export const createClient: ToolDef<{ name: string; phone?: string; email?: string }, {
  id: string; name: string; phone: string; created: boolean;
}> = {
  name: 'createClient',
  description: 'Cadastra cliente (upsert — não duplica por telefone).',
  domain: 'people',
  sideEffect: 'write',
  requiresPermission: 'clientes',
  requiresConfirm: false,
  inputSchema: [
    { name: 'name', type: 'string', required: true, max: 80 },
    { name: 'phone', type: 'string', required: false, max: 20 },
    { name: 'email', type: 'string', required: false, max: 120 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const before = findContact(ctx.db, ctx.businessId, '', input.phone || '', input.name, input.email || '');
    const c = upsertContact(ctx.db, {
      businessId: ctx.businessId,
      name: input.name,
      phone: input.phone || '',
      email: input.email || '',
      source: 'agent',
      now: ctx.now,
    });
    if (!c) throw Object.assign(new Error('Informe nome com telefone ou e-mail.'), { status: 400 });
    return { id: c.id, name: c.name, phone: c.phone, created: !before };
  },
};

export const getClientBasics: ToolDef<{ contactId?: string; phone?: string }, {
  id: string; name: string; phone: string; email: string; lastInteraction: string;
  /** SEM anamnese/prontuário/campos clínicos. */
  clinical: false;
} | null> = {
  name: 'getClientBasics',
  description: 'Básico do cliente (nome/contato) — nunca expõe prontuário ou anamnese.',
  domain: 'people',
  sideEffect: 'read',
  requiresPermission: 'clientes',
  requiresConfirm: false,
  inputSchema: [
    { name: 'contactId', type: 'string', required: false, max: 64 },
    { name: 'phone', type: 'string', required: false, max: 20 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const c = (ctx.db.contacts || []).find(
      (x) => x.businessId === ctx.businessId
        && ((input.contactId && x.id === input.contactId)
          || (input.phone && onlyDigits(x.phone) === onlyDigits(input.phone))),
    );
    if (!c) return null;
    // Nunca devolve notes clínicas, anamnese ou evolution de encounter.
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email || '',
      lastInteraction: c.lastInteraction || '',
      clinical: false as const,
    };
  },
};

export const peopleTools = [findClient, createClient, getClientBasics];
