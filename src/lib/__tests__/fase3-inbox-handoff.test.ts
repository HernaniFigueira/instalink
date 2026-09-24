// ═══════════════════════════════════════════════════════════════
// F3-F · INBOX + HANDOFF + TAKEOVER — 12 testes obrigatórios
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it, beforeEach } from 'vitest';
import type { DB, User } from '@/lib/types';
import { automationFixtures, FIXED_NOW, user } from './helpers/automation-fixtures';
import {
  agentStateLabel, aiShouldRespond, buildHandoffSummary, conversationSideContext,
  effectiveAgentState, ensureConversation, findDuplicateMessage, handoffToTeam,
  humanSend, pauseAi, receiveInbound, resumeAi, sendOutbound, simulatorAiReply,
  simulatorInbound, wantsHuman, looksClinical, toConversationMessage,
} from '@/lib/inbox/assistant-ops';

describe('F3-F · Inbox + Handoff + Takeover', () => {
  let db: DB;
  let owner: User;
  const BIZ = 'b1';
  const NOW = FIXED_NOW;

  beforeEach(() => {
    db = automationFixtures();
    owner = user('u-owner', 'Dono', 'owner');
    db.users.push(owner);
    db.contacts.push({
      id: 'c1', businessId: BIZ, customerId: 'cust1', name: 'Ana Tutora',
      phone: '11988887777', email: '', createdAt: NOW, updatedAt: NOW,
      source: 'whatsapp', lastInteraction: NOW, marketingOptIn: false,
    } as never);
    db.pets.push({
      id: 'pet-greg', businessId: BIZ, tutorId: 'c1', name: 'Greg',
      photo: '', species: 'cachorro', breed: '', sex: 'M', birthDate: '',
      weightKg: 10, notes: '', active: true, createdAt: NOW, updatedAt: NOW,
    } as never);
  });

  function newConv(over: Record<string, unknown> = {}) {
    return ensureConversation(db, {
      businessId: BIZ,
      channel: 'whatsapp',
      phone: '11988887777',
      name: 'Ana Tutora',
      contactId: 'c1',
      customerId: 'cust1',
      now: NOW,
      ...over,
    });
  }

  // 1. nova conversa → IA ativa
  it('1 · nova conversa nasce com IA ativa e rótulo "✨ IA atendendo"', () => {
    const conv = newConv();
    expect(conv.agentState).toBe('ai_active');
    expect(aiShouldRespond(conv)).toBe(true);
    expect(agentStateLabel(effectiveAgentState(conv))).toBe('✨ IA atendendo');
  });

  // 2. pede humano → handoff
  it('2 · paciente pede humano → handoff (waiting_team), IA não responde mais', () => {
    const conv = newConv();
    const inbound = receiveInbound(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'Quero falar com um atendimento humano',
      provider: 'whatsapp', providerMessageId: 'wamid.1', at: NOW,
    });
    expect(inbound.duplicate).toBe(false);
    expect(wantsHuman('Quero falar com um atendimento humano')).toBe(true);

    const built = buildHandoffSummary(db, conv, 'pedido_humano');
    const hr = handoffToTeam(db, {
      businessId: BIZ, conversationId: conv.id,
      summary: built.summary, intent: built.intent,
      entities: built.entities, actions: built.actions,
      requestedBy: 'paciente', at: NOW,
    });
    expect(hr.ok).toBe(true);
    expect(conv.agentState).toBe('waiting_team');
    expect(aiShouldRespond(conv)).toBe(false);
  });

  // 3. resumo criado (sem chain-of-thought)
  it('3 · handoff persiste resumo/intenção/entidades/ações e NUNCA chain-of-thought', () => {
    const conv = newConv();
    handoffToTeam(db, {
      businessId: BIZ, conversationId: conv.id,
      summary: 'Paciente quer reagendar corte; pet Greg.',
      intent: 'pedir_humano',
      entities: { tutor: 'Ana Tutora', pet: 'Greg' },
      actions: ['Retornar pela recepção'],
      requestedBy: 'paciente', at: NOW,
    });
    expect(conv.handoff?.summary).toContain('reagendar');
    expect(conv.handoff?.intent).toBe('pedir_humano');
    expect(conv.handoff?.entities?.pet).toBe('Greg');
    expect(conv.handoff?.actions?.length).toBeGreaterThan(0);
    // audit sem raciocínio (só summary/intent — nunca campos de CoT)
    const aud = db.audit.filter((a) => a.action === 'conversation.handoff');
    expect(aud.length).toBe(1);
    expect(Object.keys(aud[0].meta)).toEqual(
      expect.arrayContaining(['conversationId', 'intent', 'summary']),
    );
    expect(JSON.stringify(aud[0].meta)).not.toMatch(/"chainOfThought":true|reasoning|scratchpad/i);
  });

  // 4. humano responde → IA pausada (human_active imediato)
  it('4 · resposta do humano → human_active imediato (IA não fica junto)', () => {
    const conv = newConv();
    handoffToTeam(db, {
      businessId: BIZ, conversationId: conv.id,
      summary: 'Pedido de humano', intent: 'pedir_humano', at: NOW,
    });
    humanSend(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'Olá! Aqui é a recepção.', actor: owner, at: NOW,
    });
    expect(conv.agentState).toBe('human_active');
    expect(conv.mode).toBe('human');
    expect(aiShouldRespond(conv)).toBe(false);
  });

  // 5. msg seguinte → IA NÃO responde
  it('5 · mensagem seguinte em human_active: iaShouldRespond=false (IA não responde)', () => {
    const conv = newConv();
    humanSend(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'Oi, estou te ajudando', actor: owner, at: NOW,
    });
    const before = db.messages.filter((m) => m.conversationId === conv.id && m.by === 'automation').length;
    const inbound = receiveInbound(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'Ainda estou aqui', provider: 'whatsapp', providerMessageId: 'wamid.2', at: NOW,
    });
    expect(inbound.duplicate).toBe(false);
    expect(inbound.agentWillRespond).toBe(false);
    const after = db.messages.filter((m) => m.conversationId === conv.id && m.by === 'automation').length;
    expect(after).toBe(before);
  });

  // 6. devolver → audit
  it('6 · devolver para IA grava audit conversation.ai_resumed (sem msg espontânea)', () => {
    const conv = newConv();
    humanSend(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'ok', actor: owner, at: NOW,
    });
    const msgsBefore = db.messages.length;
    const r = resumeAi(db, {
      businessId: BIZ, conversationId: conv.id, actor: owner, at: NOW,
    });
    expect(r.ok).toBe(true);
    expect(conv.agentState).toBe('ai_active');
    expect(db.messages.length).toBe(msgsBefore); // sem mensagem espontânea
    const aud = db.audit.filter((a) => a.action === 'conversation.ai_resumed');
    expect(aud.length).toBe(1);
    expect(aud[0].meta.spontaneousMessage).toBe(false);
  });

  // 7. próxima msg → IA responde
  it('7 · após devolver, próxima mensagem tem agentWillRespond=true', () => {
    const conv = newConv();
    humanSend(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'ok', actor: owner, at: NOW,
    });
    resumeAi(db, { businessId: BIZ, conversationId: conv.id, actor: owner, at: NOW });
    const inbound = receiveInbound(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'Oi, tudo bem?', provider: 'whatsapp', providerMessageId: 'wamid.3', at: NOW,
    });
    expect(inbound.agentWillRespond).toBe(true);
    expect(conv.agentState).toBe('waiting_patient');
  });

  // 8. clínico → handoff
  it('8 · conteúdo clínico → looksClinical e handoff (IA não diagnostica)', () => {
    const conv = newConv();
    expect(looksClinical('Estou com dor no peito e preciso de diagnóstico')).toBe(true);
    const built = buildHandoffSummary(db, conv, 'clinico');
    const hr = handoffToTeam(db, {
      businessId: BIZ, conversationId: conv.id,
      summary: built.summary, intent: built.intent,
      entities: built.entities, actions: built.actions,
      requestedBy: 'sistema', at: NOW,
    });
    expect(hr.ok).toBe(true);
    expect(conv.agentState).toBe('waiting_team');
    expect(conv.handoff?.intent).toBe('clínico');
    expect(aiShouldRespond(conv)).toBe(false);
  });

  // 9. duplicata → sem dupla resposta
  it('9 · duplicata provider+providerMessageId não gera segunda mensagem/resposta', () => {
    const conv = newConv();
    const first = receiveInbound(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'Quero agendar', provider: 'whatsapp', providerMessageId: 'wamid.dup', at: NOW,
    });
    expect(first.duplicate).toBe(false);
    const countAfterFirst = db.messages.filter((m) => m.conversationId === conv.id).length;

    const second = receiveInbound(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'Quero agendar', provider: 'whatsapp', providerMessageId: 'wamid.dup', at: NOW,
    });
    expect(second.duplicate).toBe(true);
    expect(second.messageId).toBe(first.messageId);
    expect(db.messages.filter((m) => m.conversationId === conv.id).length).toBe(countAfterFirst);

    expect(findDuplicateMessage(db, BIZ, 'whatsapp', 'wamid.dup')?.id).toBe(first.messageId);
  });

  // 10. outro business → negado
  it('10 · operação em outro businessId é negada', () => {
    const conv = newConv();
    const r = handoffToTeam(db, {
      businessId: 'b-other', conversationId: conv.id,
      summary: 'x', at: NOW,
    });
    expect(r.ok).toBe(false);
    // ensureConversation de outro business não encontra a conversa
    const r2 = resumeAi(db, {
      businessId: 'b-other', conversationId: conv.id, actor: owner, at: NOW,
    });
    expect(r2.ok).toBe(false);
    expect(conv.agentState).toBe('ai_active');
  });

  // 11. vet → tutor + pet corretos (contexto lateral sem prontuário)
  it('11 · contexto lateral veterinário: Tutor + Pets + Paciente Greg; sem prontuário', () => {
    db.businesses.find((b) => b.id === BIZ)!.clinicType = 'veterinaria';
    const conv = newConv();
    conv.context = { ...(conv.context || {}), activePetId: 'pet-greg', activePetName: 'Greg' };
    const ctx = conversationSideContext(db, BIZ, conv);
    expect(ctx.tutor.name).toBe('Ana Tutora');
    expect(ctx.pets.map((p) => p.name)).toContain('Greg');
    expect(ctx.currentPatient?.name).toBe('Greg');
    // ações administrativas presentes no tipo; nunca prontuário
    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toMatch(/prontu[aá]rio|anamnese|diagn[oó]stico/i);
    expect(Object.keys(ctx)).not.toContain('records');
    expect(Object.keys(ctx)).not.toContain('clinical');
  });

  // 12. audit sem chain-of-thought
  it('12 · audit de handoff/takeover/resume não guarda chain-of-thought', () => {
    const conv = newConv();
    handoffToTeam(db, {
      businessId: BIZ, conversationId: conv.id,
      summary: 'Resumo curto', intent: 'pedir_humano', at: NOW,
    });
    humanSend(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'oi', actor: owner, at: NOW,
    });
    resumeAi(db, { businessId: BIZ, conversationId: conv.id, actor: owner, at: NOW });

    const actions = ['conversation.handoff', 'conversation.takeover', 'conversation.ai_resumed'];
    const entries = db.audit.filter((x) => actions.includes(x.action));
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const a of entries) {
      const keys = Object.keys(a.meta);
      // nenhum campo de raciocínio — nem a flag chainOfThought:true
      expect(keys.some((k) => /reasoning|scratchpad|cot\b|thought/i.test(k))).toBe(false);
      expect(JSON.stringify(a.meta)).not.toMatch(/"chainOfThought":true|vamos pensar passo a passo/i);
    }
  });

  // extras (simulador + badges)
  it('simulador: inbound/outbound com badge SIMULADOR e provider simulator', () => {
    const conv = newConv();
    const r = simulatorInbound(db, {
      businessId: BIZ, conversationId: conv.id,
      body: 'Olá do simulador', at: NOW,
    });
    expect(r.duplicate).toBe(false);
    const msg = db.messages.find((m) => m.id === r.messageId)!;
    expect(msg.meta?.simulator).toBe(true);
    expect(msg.meta?.provider).toBe('simulator');
    const out = simulatorAiReply(db, {
      businessId: BIZ, conversationId: conv.id, body: 'Resposta simulada', at: NOW,
    });
    expect(out.meta?.simulator).toBe(true);
    const cm = toConversationMessage(out);
    expect(cm.provider).toBe('simulator');
    expect(cm.sender).toBe('ai');
  });

  it('pauseAi sem resposta prévia grava audit ai_paused', () => {
    const conv = newConv();
    const r = pauseAi(db, { businessId: BIZ, conversationId: conv.id, actor: owner, at: NOW });
    expect(r.ok).toBe(true);
    expect(conv.agentState).toBe('human_active');
    expect(db.audit.some((a) => a.action === 'conversation.ai_paused')).toBe(true);
  });
});
