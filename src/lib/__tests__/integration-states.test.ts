// ═══════════════════════════════════════════════════════════════
// ESTADOS CANÔNICOS DE INTEGRAÇÃO — uma palavra por estado, em toda a UI
// ═══════════════════════════════════════════════════════════════
// needs_configuration → Precisa configurar · testing → Em teste ·
// ready → Pronto · degraded → Atenção · failed → Com falha ·
// unavailable → Indisponível. Enquanto não há dado, a UI mostra skeleton —
// nunca um estado falso.
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_INTEGRATION_STATES, canonicalIntegrationState, canonicalStateView,
} from '../integration-states';
import { instagramIntegrationStatus } from '../instagram';

describe('estados canônicos', () => {
  it('um rótulo (e só um) por estado, sem jargão técnico', () => {
    expect(CANONICAL_INTEGRATION_STATES.needs_configuration.label).toBe('Precisa configurar');
    expect(CANONICAL_INTEGRATION_STATES.testing.label).toBe('Em teste');
    expect(CANONICAL_INTEGRATION_STATES.ready.label).toBe('Pronto');
    expect(CANONICAL_INTEGRATION_STATES.degraded.label).toBe('Atenção');
    expect(CANONICAL_INTEGRATION_STATES.failed.label).toBe('Com falha');
    expect(CANONICAL_INTEGRATION_STATES.unavailable.label).toBe('Indisponível');
  });

  it('estado bruto do conector traduz para o canônico', () => {
    expect(canonicalIntegrationState('connected')).toBe('ready');
    expect(canonicalIntegrationState('error')).toBe('failed');
    expect(canonicalIntegrationState('not_connected')).toBe('needs_configuration');
    expect(canonicalIntegrationState('pending')).toBe('testing');
    // pending que exige AÇÃO do usuário é Atenção (funciona, mas não está saudável)
    expect(canonicalIntegrationState('pending', { blocking: true })).toBe('degraded');
    expect(canonicalStateView('connected').label).toBe('Pronto');
    expect(canonicalStateView('error').tone).toBe('danger');
  });

  it('Instagram fala a MESMA língua (selo canônico + detalhe específico)', () => {
    expect(instagramIntegrationStatus('connected').canonical.label).toBe('Pronto');
    expect(instagramIntegrationStatus('waiting_first_event').canonical.label).toBe('Em teste');
    expect(instagramIntegrationStatus('webhook_pending').canonical.label).toBe('Atenção');
    expect(instagramIntegrationStatus('error').canonical.label).toBe('Com falha');
    expect(instagramIntegrationStatus(undefined).canonical.label).toBe('Precisa configurar');
    // O detalhe específico continua existindo (não virou genérico):
    expect(instagramIntegrationStatus('webhook_pending').label).toBe('Falta ativar o webhook');
  });
});

describe('carregando nunca é um estado falso (skeleton)', () => {
  it('os painéis de canal mostram PageSkeleton enquanto não há dado', () => {
    const read = (rel: string) => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', '..', rel), 'utf8');
    const wa = read('src/components/dashboard/WhatsappChannelPanel.tsx');
    const ig = read('src/components/dashboard/InstagramChannelPanel.tsx');
    expect(wa).toMatch(/if \(!data\) return <PageSkeleton \/>/);
    expect(ig).toMatch(/if \(!data\) return <PageSkeleton \/>/);
  });
});
