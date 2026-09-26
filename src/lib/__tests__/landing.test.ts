// ═══════════════════════════════════════════════════════════════
// REGRESSÃO §P1.12 — LANDING POR PAPEL, nunca um 403 automático
// ═══════════════════════════════════════════════════════════════
// Depois do login: OWNER/ADMIN → Visão geral; Atendente/Secretaria →
// Agenda; Profissional → "Meu dia" (/dashboard); perfis sem visão geral →
// primeiro destino LIBERADO pelo catálogo. Ninguém é enviado para uma rota
// que o servidor recusaria.
import { describe, expect, it } from 'vitest';
import { landingPathFor } from '../landing';
import { permissionsFor } from '../permissions';

const CLINIC = { modes: ['services', 'bookings'] as any, features: {} };

describe('landingPathFor — destino por papel', () => {
  it('OWNER e ADMIN começam na Visão geral', () => {
    expect(landingPathFor({ role: 'OWNER', ...CLINIC, permissions: permissionsFor('OWNER') })).toBe('/dashboard');
    expect(landingPathFor({ role: 'ADMIN', ...CLINIC, permissions: permissionsFor('ADMIN') })).toBe('/dashboard');
  });

  it('ATENDENTE e SECRETARIA começam na Agenda (a operação do dia)', () => {
    expect(landingPathFor({ role: 'ATENDENTE', ...CLINIC, permissions: permissionsFor('ATENDENTE') })).toBe('/agenda');
    expect(landingPathFor({ role: 'SECRETARIA', ...CLINIC, permissions: permissionsFor('SECRETARIA') })).toBe('/agenda');
  });

  it('PROFISSIONAL começa no "Meu dia" (visão geral recortada)', () => {
    expect(landingPathFor({ role: 'PROFISSIONAL', ...CLINIC, permissions: permissionsFor('PROFISSIONAL') })).toBe('/dashboard');
  });

  it('MASTER continua indo para a área da plataforma', () => {
    expect(landingPathFor({ role: 'MASTER', ...CLINIC, permissions: {} })).toBe('/master');
  });

  it('perfil SEM visão geral NUNCA cai em /dashboard (nada de 403 automático)', () => {
    // VIEWER com override só de agenda:
    const perms = { ...permissionsFor('VIEWER'), agenda: true } as any;
    expect(landingPathFor({ role: 'VIEWER', ...CLINIC, permissions: perms })).toBe('/agenda');
    // Atendente de um negócio SEM agenda (varejo) cai no primeiro destino liberado
    // (Pendências entra antes de Clientes na ordem do catálogo — os dois são
    // destinos acessíveis e honestos para quem atende):
    const desk = { ...permissionsFor('ATENDENTE'), dashboard: false } as any;
    const retail = landingPathFor({ role: 'ATENDENTE', modes: ['products', 'orders'], features: {}, permissions: { ...desk, clientes: true, whatsapp: false } });
    expect(retail).not.toBe('/dashboard');
    expect(['', '/tarefas', '/clientes']).toContain(retail);
  });

  it('perfil sem NENHUM destino devolve "" (fluxo existente de onboarding decide)', () => {
    expect(landingPathFor({ role: 'VIEWER', ...CLINIC, permissions: permissionsFor('VIEWER') })).toBe('');
  });

  it('atendente sem permissão de agenda cai no primeiro destino acessível', () => {
    const perms = { ...permissionsFor('ATENDENTE'), agenda: false } as any;
    expect(landingPathFor({ role: 'ATENDENTE', ...CLINIC, permissions: perms })).not.toBe('/agenda');
  });
});
