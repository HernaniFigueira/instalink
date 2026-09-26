// ═══════════════════════════════════════════════════════════════
// REGRESSÃO §5 — Bernardo É cliente cadastrado nas DUAS telas
// ═══════════════════════════════════════════════════════════════
// Bug real da auditoria: cliente existente (com pet e atendimentos)
// aparecia como "Contato sem cadastro" em Conversas porque a lista usava
// `!!conv.customerId` e o detalhe usava `conv.contactId` — nenhuma das duas
// resolvia telefone, e o formato do número diferia (5521… × 21…).
//
// Contrato deste teste: a MESMA função (lib/conversation-identity.ts) decide
// "cadastrado" na lista E no detalhe, por telefone normalizado, sem duplicar
// registro e sem vazar contato de outra unidade.
import { describe, expect, it } from 'vitest';
import {
  conversationPhoneKey, conversationRegistered, resolveConversationContact,
} from '../conversation-identity';
import type { BusinessCustomer, Conversation, DB } from '../types';

function contact(over: Partial<BusinessCustomer>): BusinessCustomer {
  return {
    id: 'c1', businessId: 'biz', customerId: '', name: 'Bernardo', phone: '21988966462',
    email: '', createdAt: '', updatedAt: '', source: '', lastInteraction: '',
    marketingOptIn: false, ...over,
  };
}

function conversation(over: Partial<Conversation> & { phone: string }): Conversation {
  return {
    id: 'conv1', businessId: 'biz', channel: 'whatsapp', contactId: '', customerId: '',
    name: 'Bernardo', status: 'open', unread: 0, lastMessageAt: '', lastMessagePreview: '',
    createdAt: '', ...over,
  };
}

function db(contacts: BusinessCustomer[]): Pick<DB, 'contacts'> {
  return { contacts } as Pick<DB, 'contacts'>;
}

describe('conversationPhoneKey — normalização única', () => {
  it('tira o 55 do Brasil quando sobram 10–11 dígitos', () => {
    expect(conversationPhoneKey('+55 (21) 98896-6462')).toBe('21988966462');
    expect(conversationPhoneKey('5521988966462')).toBe('21988966462');
    expect(conversationPhoneKey('21988966462')).toBe('21988966462');
  });

  it('não destrói números de outro país nem códigos longos', () => {
    expect(conversationPhoneKey('15551234567')).toBe('15551234567');
    expect(conversationPhoneKey('')).toBe('');
  });
});

describe('resolveConversationContact — resolução canônica', () => {
  it('cliente cadastrado + conversa pelo MESMO telefone (formatos diferentes) resolve o MESMO cliente', () => {
    const bernardo = contact({ id: 'bernardo', phone: '5521988966462', customerId: 'custo-1' });
    const conv = conversation({ phone: '21988966462', contactId: '', customerId: '' });
    const resolved = resolveConversationContact(db([bernardo]), 'biz', conv);
    expect(resolved?.id).toBe('bernardo');
    expect(conversationRegistered(db([bernardo]), 'biz', conv)).toBe(true);
  });

  it('conversa com contactId legado inválido cai no telefone e ainda resolve', () => {
    const bernardo = contact({ id: 'bernardo', phone: '21988966462' });
    const conv = conversation({ phone: '5521988966462', contactId: 'contato-antigo-apagado' });
    expect(resolveConversationContact(db([bernardo]), 'biz', conv)?.id).toBe('bernardo');
  });

  it('customerId da conversa resolve mesmo sem contactId e sem phone', () => {
    const bernardo = contact({ id: 'bernardo', customerId: 'custo-9' });
    const conv = conversation({ phone: '', customerId: 'custo-9' });
    expect(resolveConversationContact(db([bernardo]), 'biz', conv)?.id).toBe('bernardo');
  });

  it('celular antigo sem o 9º dígito ainda casa (fixo × celular)', () => {
    // Cadastro legado com 8 dígitos locais × conversa com o 9º dígito.
    const bernardo = contact({ id: 'bernardo', phone: '2188966462' });
    const conv = conversation({ phone: '21988966462' });
    expect(resolveConversationContact(db([bernardo]), 'biz', conv)?.id).toBe('bernardo');
  });

  it('NUNCA resolve contato de outra unidade (tenant isolation)', () => {
    const outra = contact({ id: 'outro', businessId: 'outra-biz', phone: '21988966462' });
    const conv = conversation({ phone: '21988966462' });
    expect(resolveConversationContact(db([outra]), 'biz', conv)).toBeUndefined();
    expect(conversationRegistered(db([outra]), 'biz', conv)).toBe(false);
  });

  it('telefone realmente desconhecido continua "sem cadastro" (nada inventado)', () => {
    const conv = conversation({ phone: '11999998888' });
    expect(resolveConversationContact(db([]), 'biz', conv)).toBeUndefined();
    expect(conversationRegistered(db([]), 'biz', conv)).toBe(false);
  });

  it('lista e detalhe usam a mesma função — mesma resposta para a mesma conversa', () => {
    const bernardo = contact({ id: 'bernardo', phone: '21988966462', customerId: 'custo-1' });
    const store = db([bernardo]);
    const conv = conversation({ phone: '21988966462', customerId: '', contactId: '' });
    // "lista": registered
    const listSays = conversationRegistered(store, 'biz', conv);
    // "detalhe": contato resolvido
    const detailContact = resolveConversationContact(store, 'biz', conv);
    expect(listSays).toBe(true);
    expect(detailContact?.id).toBe('bernardo');
    expect(listSays).toBe(!!detailContact);
  });
});
