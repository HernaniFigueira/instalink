// ═══════════════════════════════════════════════════════════════
// REGRESSÃO §11–15 — identidade em Conversas (testes A–D) + reconciliação
// ═══════════════════════════════════════════════════════════════
// Cenários travados:
//   A. Contato EXISTENTE por telefone em formato diferente (5521… × 21…)
//      NUNCA aparece como "sem cadastro" — resolve e a reconciliação vincula;
//   B. Contato EXISTENTE por customerId resolve mesmo sem contactId/phone;
//   C. Contato NOVO de verdade continua "Não está na base" — e a
//      reconciliação NÃO o transforma em cliente (nada é criado em leitura
//      nem na reconciliação; o cadastro é ação explícita do usuário);
//   D. MESMO telefone em OUTRA unidade nunca resolve (tenant isolation);
//   Reconciliação: explícita, idempotente, completa customerId, não reescreve
//   identidade e não toca em conversas de outro tenant.
import { describe, expect, it } from 'vitest';
import {
  conversationRegistered, reconcileConversations, resolveConversationContact,
} from '../conversation-identity';
import type { BusinessCustomer, Conversation, DB } from '../types';

const NOW = '2026-09-27T12:00:00.000Z';

function contact(over: Partial<BusinessCustomer>): BusinessCustomer {
  return {
    id: 'c1', businessId: 'biz-1', customerId: '', name: 'Bernardo Lima', phone: '5521981234567',
    email: '', createdAt: NOW, updatedAt: NOW, source: 'agendamento', lastInteraction: NOW,
    marketingOptIn: false, ...over,
  };
}

function conversation(over: Partial<Conversation>): Conversation {
  return {
    id: 'conv1', businessId: 'biz-1', channel: 'whatsapp', contactId: '', customerId: '',
    name: 'Bernardo', phone: '', status: 'open', unread: 0, lastMessageAt: NOW,
    lastMessagePreview: '', createdAt: NOW, ...over,
  };
}

type MiniDB = Pick<DB, 'contacts' | 'conversations'>;
function db(contacts: BusinessCustomer[], conversations: Conversation[]): MiniDB {
  return { contacts, conversations } as MiniDB;
}

// ── A — existente por telefone, formatos diferentes ──
describe('A · contato existente por telefone (5521… × 21…)', () => {
  const bernardo = contact({ id: 'cont-bernardo', customerId: 'cust-1' });
  const conv = conversation({ id: 'conv-a', name: 'Bernardo Lima', phone: '21981234567' });

  it('resolve o MESMO contato; lista e detalhe concordam', () => {
    const d = db([bernardo], [conv]);
    expect(resolveConversationContact(d, 'biz-1', conv)?.id).toBe('cont-bernardo');
    expect(conversationRegistered(d, 'biz-1', conv)).toBe(true);
  });

  it('reconciliação grava o vínculo permanente (contactId) e completa customerId', () => {
    const d = db([bernardo], [conv]);
    const out = reconcileConversations(d, 'biz-1');
    expect(out.linked).toBe(1);
    expect(out.linkedIds).toContain('conv-a');
    expect(conv.contactId).toBe('cont-bernardo');
    expect(conv.customerId).toBe('cust-1');
    // nome/telefone da conversa nunca são reescritos
    expect(conv.phone).toBe('21981234567');
    expect(conv.name).toBe('Bernardo Lima');
  });
});

// ── B — existente por customerId ──
describe('B · contato existente por customerId', () => {
  it('resolve sem contactId e sem phone; reconciliação vincula', () => {
    const mariana = contact({ id: 'cont-mariana', customerId: 'cust-2', name: 'Mariana', phone: '21933332222' });
    const conv = conversation({ id: 'conv-b', name: 'Mariana', phone: '', customerId: 'cust-2' });
    const d = db([mariana], [conv]);
    expect(conversationRegistered(d, 'biz-1', conv)).toBe(true);
    const out = reconcileConversations(d, 'biz-1');
    expect(out.linked).toBe(1);
    expect(conv.contactId).toBe('cont-mariana');
  });
});

// ── C — contato NOVO de verdade ──
describe('C · contato novo de verdade', () => {
  it('continua "não está na base" — a reconciliação NUNCA cria cliente', () => {
    const bernardo = contact({ id: 'cont-bernardo' });
    const nova = conversation({ id: 'conv-c', name: 'Tereza Alves', phone: '21912345678' });
    const d = db([bernardo], [nova]);
    expect(conversationRegistered(d, 'biz-1', nova)).toBe(false);
    const out = reconcileConversations(d, 'biz-1');
    expect(out.unresolved).toBe(1);
    expect(out.linked).toBe(0);
    // NENHUM contato novo foi inventado
    expect(d.contacts).toHaveLength(1);
    expect(nova.contactId).toBe('');
    // e a conversa continua apresentável para o CTA "Cadastrar cliente"
    expect(nova.name).toBe('Tereza Alves');
    expect(nova.phone).toBe('21912345678');
  });
});

// ── D — tenant isolation ──
describe('D · mesmo telefone em OUTRA unidade', () => {
  it('nunca resolve para o contato de outro tenant (leitura e reconciliação)', () => {
    const gemio = contact({ id: 'cont-gemeo', businessId: 'biz-2', name: 'Bernardo (outro)', phone: '21981234567' });
    const conv = conversation({ id: 'conv-d', businessId: 'biz-1', name: 'Bernardo (outro)', phone: '21981234567' });
    const d = db([gemio], [conv]);
    expect(conversationRegistered(d, 'biz-1', conv)).toBe(false);
    const out = reconcileConversations(d, 'biz-1');
    expect(out.linked).toBe(0);
    expect(out.unresolved).toBe(1);
    expect(conv.contactId).toBe('');
  });
});

// ── Reconciliação: contrato ──
describe('reconcileConversations · explícita e idempotente', () => {
  it('segunda rodada não muda nada (outcome zero de linked)', () => {
    const bernardo = contact({ id: 'cont-bernardo', customerId: 'cust-1' });
    const conv = conversation({ id: 'conv-x', phone: '21981234567' });
    const d = db([bernardo], [conv]);
    const first = reconcileConversations(d, 'biz-1');
    expect(first.linked).toBe(1);
    const second = reconcileConversations(d, 'biz-1');
    expect(second.linked).toBe(0);
    expect(second.already).toBe(1);
    expect(second.linkedIds).toEqual([]);
  });

  it('não regride vínculo existente válido nem para contatos de outra unidade', () => {
    const ana = contact({ id: 'cont-ana', name: 'Ana', phone: '21922221111' });
    const conv = conversation({ id: 'conv-ana', contactId: 'cont-ana', name: 'Ana', phone: '21922221111' });
    const d = db([ana], [conv]);
    const out = reconcileConversations(d, 'biz-1');
    expect(out.already).toBe(1);
    expect(conv.contactId).toBe('cont-ana');
  });

  it('contactId apontando para contato apagado/estranho é resolvido de novo pela regra canônica', () => {
    const bernardo = contact({ id: 'cont-bernardo' });
    const conv = conversation({ id: 'conv-stale', contactId: 'cont-sumiu', phone: '21981234567' });
    const d = db([bernardo], [conv]);
    const out = reconcileConversations(d, 'biz-1');
    expect(out.linked).toBe(1);
    expect(conv.contactId).toBe('cont-bernardo');
  });

  it('conversas de OUTRA unidade não entram no outcome', () => {
    const bernardo = contact({ id: 'cont-bernardo' });
    const convOutra = conversation({ id: 'conv-outro-tenant', businessId: 'biz-2', phone: '21981234567' });
    const d = db([bernardo], [convOutra]);
    const out = reconcileConversations(d, 'biz-1');
    expect(out.linked).toBe(0);
    expect(out.already).toBe(0);
    expect(out.unresolved).toBe(0);
    expect(convOutra.contactId).toBe('');
  });

  it('mix realista: 3 conversas antigas — 2 resolvem, 1 continua nova', () => {
    const bernardo = contact({ id: 'cont-bernardo', customerId: 'cust-1' });
    const mariana = contact({ id: 'cont-mariana', customerId: 'cust-2', name: 'Mariana', phone: '21933332222' });
    const convs = [
      conversation({ id: 'k1', phone: '21981234567' }),
      conversation({ id: 'k2', customerId: 'cust-2' }),
      conversation({ id: 'k3', name: 'Tereza', phone: '21912345678' }),
    ];
    const d = db([bernardo, mariana], convs);
    const out = reconcileConversations(d, 'biz-1');
    expect(out.linked).toBe(2);
    expect(out.unresolved).toBe(1);
    expect(convs[0].contactId).toBe('cont-bernardo');
    expect(convs[1].contactId).toBe('cont-mariana');
    expect(convs[2].contactId).toBe('');
  });
});
