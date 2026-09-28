// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — FUNDACAO (EventLog · DecisionEngine ·
// GenerativeAIProvider · telemetria de IA · Página legada).
//
// Contratos travados:
//   1) EventLog: businessId obrigatório · catálogo fechado · actor/origin ·
//      entityType/entityId · payload SEMPRE redigido · idempotência por
//      tenant · persistência via DomainEventStore (NUNCA instalink_doc);
//   2) DecisionEngine: Disabled é o padrão (sem chave) · Mock determinístico ·
//      TypeSafe bloqueado sem TYPESAFE_API_KEY (fail-closed) · confidence;
//   3) GenerativeAIProvider: desativado sem fornecedor · mock em testes ·
//      telemetria por clínica SEM prompt clínico (AiUsageStore);
//   4) Página legada: fora da navegação por padrão, flag reativa, rotas e
//      APIs preservadas.
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import {
  DOMAIN_EVENT_TYPES, DomainEventError, emitDomainEvent,
} from '../domain-events';
import { MemoryDomainEventStore } from '../domain-events/store';
import {
  DisabledDecisionEngine, MockDecisionEngine, TypeSafeDecisionEngine,
  getDecisionEngine,
} from '../decision';
import type { DecisionRequest } from '../decision';
import {
  MockGenerativeProvider, getGenerativeProvider, trackGenerativeUsage,
} from '../ai/generative';
import { buildAiUsageRecord, estimateAiCost } from '../ai/usage';
import { MemoryAiUsageStore, getAiUsageStore } from '../ai/usage-store';
import { filterNavAreas, isLegacyPagesEnabled } from '../product';

// ── 1) EventLog ────────────────────────────────────────────────────────────
describe('F0 · EventLog (eventos de domínio)', () => {
  it('emite evento com o contrato completo (tenant, ator, entidade, tempo)', () => {
    const event = emitDomainEvent({
      businessId: 'biz-1',
      type: 'appointment.confirmed',
      entityType: 'booking',
      entityId: 'bk-9',
      actor: { kind: 'user', id: 'u-1', name: 'Ana' },
      origin: 'ui',
      payload: { professionalId: 'p-1', slot: '2026-09-27T10:00:00Z' },
      idempotencyKey: 'confirm-bk-9',
      now: '2026-09-27T12:00:00.000Z',
    });
    expect(event.businessId).toBe('biz-1');
    expect(event.type).toBe('appointment.confirmed');
    expect(event.entityType).toBe('booking');
    expect(event.entityId).toBe('bk-9');
    expect(event.actor).toEqual({ kind: 'user', id: 'u-1', name: 'Ana' });
    expect(event.origin).toBe('ui');
    expect(event.occurredAt).toBe('2026-09-27T12:00:00.000Z');
    expect(event.recordedAt).toBe('2026-09-27T12:00:00.000Z');
    expect(event.idempotencyKey).toBe('confirm-bk-9');
    expect(event.payload).toEqual({ professionalId: 'p-1', slot: '2026-09-27T10:00:00Z' });
  });

  it('businessId é obrigatório — evento sem tenant não nasce', () => {
    expect(() => emitDomainEvent({
      businessId: '', type: 'payment.received', entityType: 'invoice', entityId: 'i1',
      actor: { kind: 'system' }, origin: 'api',
    })).toThrow(DomainEventError);
  });

  it('catálogo é fechado — tipo fora do catálogo é rejeitado', () => {
    expect(() => emitDomainEvent({
      businessId: 'b', type: 'invoice.deleted' as never, entityType: 'invoice', entityId: 'i',
      actor: { kind: 'user' }, origin: 'ui',
    })).toThrow(/fora do catálogo/);
    // e o catálogo cobre o fluxo do briefing
    for (const t of [
      'appointment.created', 'appointment.confirmed', 'appointment.cancelled',
      'patient.checked_in', 'encounter.started', 'encounter.finalized',
      'prescription.created', 'exam.ordered', 'exam.resulted',
      'payment.received', 'followup.due', 'inventory.low',
    ] as const) {
      expect(DOMAIN_EVENT_TYPES).toContain(t);
    }
  });

  it('payload é SEMPRE redigido (chave sensível nunca entra no log)', () => {
    const event = emitDomainEvent({
      businessId: 'b', type: 'document.generated', entityType: 'clinical_document', entityId: 'd1',
      actor: { kind: 'agent', id: 'jev' }, origin: 'agent',
      payload: {
        template: 'receita', token: 'sk-SECRET', password: 'x',
        prompt: 'resuma o prontuário', petId: 'pet-7',
      },
    });
    expect(event.payload.petId).toBe('pet-7');
    expect(JSON.stringify(event.payload)).not.toContain('sk-SECRET');
    expect(JSON.stringify(event.payload)).not.toContain('resuma o prontuário');
  });

  it('idempotência por tenant: (businessId + idempotencyKey) repetido é NO-OP', async () => {
    const store = new MemoryDomainEventStore();
    const first = await store.record({
      businessId: 'b', type: 'payment.received', entityType: 'payment', entityId: 'p1',
      actor: { kind: 'system' }, origin: 'api', idempotencyKey: 'pay:p1',
    });
    const again = await store.record({
      businessId: 'b', type: 'payment.received', entityType: 'payment', entityId: 'p1',
      actor: { kind: 'system' }, origin: 'api', idempotencyKey: 'pay:p1',
    });
    expect(again.id).toBe(first.id);
    expect(await store.list('b')).toHaveLength(1);
    // tenant diferente com a MESMA key não colide (isolamento)
    await store.record({
      businessId: 'other', type: 'payment.received', entityType: 'payment', entityId: 'p1',
      actor: { kind: 'system' }, origin: 'api', idempotencyKey: 'pay:p1',
    });
    expect(await store.list('other')).toHaveLength(1);
    expect(await store.list('b')).toHaveLength(1);
  });

  it('tenant A nunca lista tenant B (mesmo com filtros de tipo/entidade)', async () => {
    const store = new MemoryDomainEventStore();
    for (const [biz, type] of [
      ['a', 'encounter.started'], ['a', 'encounter.finalized'], ['b', 'encounter.started'],
    ] as const) {
      await store.record({
        businessId: biz, type, entityType: 'encounter', entityId: 'e1',
        actor: { kind: 'user' }, origin: 'ui',
      });
    }
    expect(await store.list('a')).toHaveLength(2);
    expect(await store.list('b')).toHaveLength(1);
    expect(await store.list('a', { type: 'encounter.finalized' })).toHaveLength(1);
    expect((await store.list('a')).map((e) => e.businessId).every((id) => id === 'a')).toBe(true);
    expect((await store.list('b')).map((e) => e.businessId).every((id) => id === 'b')).toBe(true);
  });
});

// ── 2) DecisionEngine ──────────────────────────────────────────────────────
const decisionRequest: DecisionRequest = {
  businessId: 'biz-1',
  feature: 'followup-triage',
  state: { message: 'meu pet está com febre' },
  questions: {
    is_urgent: { kind: 'noul', instructions: 'A mensagem pede urgência?' },
    topic: {
      kind: 'choice',
      instructions: 'Qual o assunto principal?',
      criteria: { clinical: 'Questão clínica.', billing: 'Questão financeira.', other: 'Outro.' },
    },
    severity: {
      kind: 'score',
      instructions: 'Qual a gravidade aparente?',
      criteria: ['leve', 'moderada', 'grave'],
    },
  },
  routing: { autoActMinConfidence: 0.8 },
};

describe('F0 · DecisionEngine (Jev/TypeSafe-ready)', () => {
  it('padrão é Disabled: sem chave, NADA decide e nada quebra', async () => {
    const engine = getDecisionEngine({}); // sem TYPESAFE_API_KEY
    expect(engine.id).toBe('disabled');
    expect(engine.isAvailable()).toBe(false);
    const result = await engine.decide(decisionRequest);
    expect(result.ok).toBe(false);
    expect(result.via).toBe('disabled');
    expect(result.error).toMatch(/desativado/);
  });

  it('Mock responde Choice/Noul/Score deterministicamente, com confidence', async () => {
    const engine = new MockDecisionEngine();
    const result = await engine.decide(decisionRequest);
    expect(result.ok).toBe(true);
    expect(result.via).toBe('mock');
    const topic = result.answers.topic;
    expect(topic.kind).toBe('choice');
    if (topic.kind === 'choice') {
      expect(topic.choice).toBe('clinical');
      expect(topic.confidence).toBeGreaterThan(0.5);
      expect(Object.values(topic.probabilities).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    }
    const noul = result.answers.is_urgent;
    expect(noul.kind).toBe('noul');
    const severity = result.answers.severity;
    expect(severity.kind).toBe('score');
    if (severity.kind === 'score') {
      expect(severity.score).toBe(2); // nível mais alto do mock
      expect(severity.probabilities).toHaveLength(3);
      expect(severity.confidence).toBeGreaterThan(0.5);
    }
  });

  it('TypeSafe é fail-closed: sem TYPESAFE_API_KEY → bloqueado (sem rede)', async () => {
    const engine = new TypeSafeDecisionEngine({ apiKey: '' });
    expect(engine.isAvailable()).toBe(false);
    const result = await engine.decide(decisionRequest);
    expect(result.ok).toBe(false);
    expect(result.via).toBe('blocked');
    expect(result.error).toMatch(/TYPESAFE_API_KEY/);
  });

  it('factory: mock explícito só por env; com chave → typesafe estrutural', () => {
    expect(getDecisionEngine({ GODOUTOR_DECISION_ENGINE: 'mock' }).id).toBe('mock');
    expect(getDecisionEngine({ TYPESAFE_API_KEY: 'sk-test' }).id).toBe('typesafe');
    expect(getDecisionEngine({ TYPESAFE_API_KEY: 'sk-test' }).isAvailable()).toBe(true);
    expect(getDecisionEngine({}).id).toBe('disabled');
  });
});

// ── 3) GenerativeAIProvider + telemetria ───────────────────────────────────
describe('F0 · GenerativeAIProvider + telemetria de IA', () => {
  it('padrão é Disabled: sem fornecedor, sem geração, sem custo', async () => {
    const provider = getGenerativeProvider({});
    expect(provider.id).toBe('disabled');
    const result = await provider.generate({
      businessId: 'b', feature: 'reply', task: 'reply_suggestion', prompt: 'oi',
    });
    expect(result.ok).toBe(false);
    expect(result.via).toBe('disabled');
    expect(result.outputTokens).toBe(0);
  });

  it('telemetria via store: custo por clínica, SEM prompt/transcrição', async () => {
    const store = new MemoryAiUsageStore();
    const request = {
      businessId: 'biz-1', feature: 'report', task: 'report' as const,
      prompt: 'Resumo clínico do atendimento do paciente Rex', agentId: 'agent-1',
    };
    const result = {
      ok: true, text: 'Texto', via: 'mock' as const, provider: 'mock', model: 'mock-generative-v1',
      inputTokens: 100, outputTokens: 50, latencyMs: 12,
    };
    const rec = await trackGenerativeUsage(store, request, result);
    expect(rec.businessId).toBe('biz-1');
    expect(rec.inputTokens).toBe(100);
    expect(rec.outputTokens).toBe(50);
    expect(rec.estimatedCost).toBe(0); // sem preço na tabela → 0 (não inventa)
    // PRIVACIDADE: o prompt clínico NUNCA é persistido
    const rows = await store.list('biz-1');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('Resumo clínico');
    // custo agregado por clínica (tenant A não vê tenant B)
    await store.record({
      businessId: 'biz-2', agentId: 'a', feature: 'f', provider: 'p', model: 'm',
      inputTokens: 1, outputTokens: 1, latencyMs: 1,
    });
    expect((await store.totals('biz-1')).calls).toBe(1);
    expect((await store.totals('biz-2')).calls).toBe(1);
    expect((await store.totals('biz-1')).inputTokens).toBe(100);
  });

  it('estimateAiCost usa a tabela (0 sem entrada) e o registro nunca guarda prompt', () => {
    expect(estimateAiCost('unknown', 'm', 1000, 1000)).toBe(0);
    const rec = buildAiUsageRecord({
      businessId: 'b', agentId: 'a', feature: 'f', provider: 'p', model: 'm',
      inputTokens: 10, outputTokens: 5, latencyMs: 1,
    });
    expect(rec.decisionType).toBeUndefined();
    // F0 hardening: id é UUID v4 (crypto.randomUUID), não mais `aiu-<data>-<seq>`
    expect(rec.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(JSON.stringify(rec)).not.toContain('prompt');
  });

  it('mock do provider devolve texto canônico via env de teste', async () => {
    const provider = getGenerativeProvider({ GODOUTOR_GENAI: 'mock' });
    expect(provider.id).toBe('mock');
    expect(provider.isAvailable()).toBe(true);
    const result = await (provider as MockGenerativeProvider).generate({
      businessId: 'b', feature: 'summary', task: 'summary', prompt: 'contexto do caso',
    });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('[mock:summary]');
  });

  it('factory de store: sem DATABASE_URL → memória (dev/testes, sem rede)', async () => {
    const store = await getAiUsageStore();
    expect(store).toBeInstanceOf(MemoryAiUsageStore);
  });
});

// ── 4) Página legada (desativação segura) ─────────────────────────────────
describe('F0 · Página pública vira legado (flag GODOUTOR_LEGACY_PAGES)', () => {
  it('padrão: a Página FORA da navegação operacional (link preservado)', () => {
    expect(isLegacyPagesEnabled({})).toBe(false);
    const areas = [
      { id: 'principal' }, { id: 'clinica' }, { id: 'presenca' }, { id: 'automacao' },
    ];
    const visible = filterNavAreas(areas, {});
    expect(visible.map((a) => a.id)).toEqual(['principal', 'clinica', 'automacao']);
  });

  it('flag GODOUTOR_LEGACY_PAGES=1 reativa sem migração', () => {
    expect(isLegacyPagesEnabled({ GODOUTOR_LEGACY_PAGES: '1' })).toBe(true);
    expect(isLegacyPagesEnabled({ GODOUTOR_LEGACY_PAGES: 'true' })).toBe(true);
    const areas = [{ id: 'presenca' }, { id: 'principal' }];
    expect(filterNavAreas(areas, { GODOUTOR_LEGACY_PAGES: '1' })).toHaveLength(2);
  });
});
