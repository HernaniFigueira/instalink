// ═══════════════════════════════════════════════════════════════
// IDENTIDADE CANÔNICA DA CONVERSA — uma resolução, duas telas
// ═══════════════════════════════════════════════════════════════
// BUG reproduzido na auditoria real: Bernardo cadastrado em Clientes
// aparecia como "Contato sem cadastro" em Conversas. A causa estava na
// ORIGEM: a lista decidia "cadastrado" por `!!conv.customerId` enquanto o
// detalhe buscava `conv.contactId` — duas regras diferentes para a mesma
// pergunta, e nenhuma delas resolvia telefone.
//
// A resolução canônica desta missão (§5) é UMA, em ordem:
//
//   telefone normalizado → pessoa/contact existente → customer/cliente
//   → conversation
//
// Na prática, para a CONVERSA já criada, resolvemos a pessoa assim:
//   1. contactId válido (da própria conversa);
//   2. customerId da conversa bate com algum contato da unidade;
//   3. telefone normalizado (sem 55, só dígitos) casa com o telefone
//      normalizado de um contato da MESMA unidade.
//
// Nenhuma duplicata é criada, nenhum registro é reescrito: a resolução é de
// LEITURA. A lista e o detalhe de Conversas usam ESTA função — se uma
// conversa resolve, resolve nas duas.
//
// Módulo PURO (sem I/O/DOM): coberto por teste de regressão em
// src/lib/__tests__/conversation-identity.test.ts.
import type { BusinessCustomer, Conversation, DB } from './types';

/**
 * Telefone comparável: só dígitos, sem o 55 do Brasil quando sobram
 * 10–11 dígitos (DDD + número). É a mesma régua do índice do Cliente 360
 * (lib/people360-identity.ts) — nunca uma regra nova por tela.
 */
export function conversationPhoneKey(phone: unknown): string {
  return String(phone || '').replace(/\D/g, '').replace(/^55(\d{10,11})$/, '$1');
}

export type ConversationLike = Pick<Conversation, 'contactId' | 'customerId' | 'phone'> & { businessId?: string };

export type ContactDb = Pick<DB, 'contacts'>;

/**
 * Resolve o contato (BusinessCustomer) de uma conversa na unidade.
 * `undefined` = realmente sem cadastro (Instagram sem perfil ligado, número
 * desconhecido…). Nunca retorna contato de OUTRA unidade.
 */
export function resolveConversationContact<T extends ConversationLike>(
  db: ContactDb,
  businessId: string,
  conversation: T,
): BusinessCustomer | undefined {
  const inUnit = db.contacts.filter((c) => c.businessId === businessId);

  // 1. Vínculo direto da conversa (contactId) — ainda válido?
  const directId = String(conversation.contactId || '');
  if (directId) {
    const byId = inUnit.find((c) => c.id === directId);
    if (byId) return byId;
  }

  // 2. Conta global (customerId) vinculada a um contato da unidade.
  const customerId = String(conversation.customerId || '');
  if (customerId) {
    const byCustomer = inUnit.find((c) => c.customerId === customerId);
    if (byCustomer) return byCustomer;
  }

  // 3. Telefone normalizado — é o caso do Bernardo: contato salvo com um
  //    formato ("5521…") e conversa com outro ("21…"). A régua é a MESMA dos
  //    dois lados, então qualquer formato casa.
  const phone = conversationPhoneKey(conversation.phone);
  if (phone) {
    const byPhone = inUnit.find((c) => {
      const candidate = conversationPhoneKey(c.phone);
      return !!candidate && (candidate === phone
        // Fone com 9º dígito ausente (fixo × celular antigo): casa pelo DDD +
        // 8/9 dígitos restantes quando um é prefixo do outro com o 9 extra.
        || (candidate.length >= 10 && phone.length >= 10
          && (candidate === phone.replace(/^(\d{2})9(\d{8})$/, '$1$2')
            || phone === candidate.replace(/^(\d{2})9(\d{8})$/, '$1$2'))));
    });
    if (byPhone) return byPhone;
  }

  return undefined;
}

/**
 * "Este participante é cliente cadastrado?" — MESMA resolução da ficha.
 * Usada pela LISTA (`registered`) e pelo DETALHE (`contact`) de Conversas:
 * as duas telas não podem mais discordar.
 */
export function conversationRegistered(db: ContactDb, businessId: string, conversation: ConversationLike): boolean {
  return !!resolveConversationContact(db, businessId, conversation);
}
