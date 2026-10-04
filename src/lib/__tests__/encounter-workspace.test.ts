import { describe, expect, it } from 'vitest';
import { encounterReturnHref, encounterWorkspaceHref, isSafeInternalHref } from '@/lib/encounter-workspace';

describe('full-page clinical workspace navigation', () => {
  it('keeps only identity ids in the URL and preserves an internal return context', () => {
    const href = encounterWorkspaceHref({
      businessId: 'biz 42', bookingId: 'booking-1', returnTo: '/clientes/client-7?b=biz%2042&tab=history',
    });
    const parsed = new URL(href, 'https://app.example');
    expect(parsed.pathname).toBe('/atendimento');
    expect(parsed.searchParams.get('b')).toBe('biz 42');
    expect(parsed.searchParams.get('bookingId')).toBe('booking-1');
    expect(parsed.searchParams.get('returnTo')).toBe('/clientes/client-7?b=biz%2042&tab=history');
    expect(href).not.toContain('customerName');
    expect(href).not.toContain('phone=');
  });

  it('accepts encounter, booking, and queue origins without adding a visible menu destination', () => {
    // F1A — com ID, a rota é a CANÔNICA do workspace (sobrevive a F5/voltar).
    expect(encounterWorkspaceHref({ businessId: 'b', id: 'e-1' })).toBe('/atendimento/e-1?b=b');
    // Sem ID, a origem operacional vai para o resolvedor (start or resume).
    expect(encounterWorkspaceHref({ businessId: 'b', queueId: 'q-1' })).toContain('queueId=q-1');
    expect(encounterWorkspaceHref({ businessId: 'b', bookingId: 'bk-1' })).toContain('bookingId=bk-1');
    expect(encounterWorkspaceHref({ businessId: 'b', bookingId: 'bk-1' }).startsWith('/atendimento?')).toBe(true);
  });

  it('F1A · the canonical route by id keeps the unit context and an internal return', () => {
    const href = encounterWorkspaceHref({ businessId: 'b', id: 'e-1', returnTo: '/agenda?b=b' });
    expect(href).toBe('/atendimento/e-1?b=b&returnTo=%2Fagenda%3Fb%3Db');
    // Nenhum dado de paciente na URL (PII nunca viaja em query string).
    expect(href).not.toContain('customerName');
    expect(href).not.toContain('phone=');
    expect(href).not.toContain('petName');
  });

  it('rejects external and protocol-relative return destinations', () => {
    expect(isSafeInternalHref('/agenda?b=b1')).toBe(true);
    expect(isSafeInternalHref('//evil.example')).toBe(false);
    expect(isSafeInternalHref('/\\evil.example')).toBe(false);
    expect(isSafeInternalHref('https://evil.example')).toBe(false);
    expect(encounterReturnHref('https://evil.example', 'biz')).toBe('/agenda?b=biz');
  });
});
