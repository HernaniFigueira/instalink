import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS, PERMISSION_IDS, ROLES, isValidPermission, isValidRole, permissionsFor, roleDef,
} from '../permissions';

// Permissões: o papel define um PADRÃO; overrides individuais ajustam.
// O proprietário nunca perde acesso. Papéis são validados em todo lugar.
describe('permissões e papéis', () => {
  it('catálogo não tem ids duplicados e cobre o esperado', () => {
    const ids = PERMISSIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of ['agenda', 'clientes', 'leads', 'whatsapp', 'pagina', 'equipe', 'config', 'financeiro', 'admin']) {
      expect(ids).toContain(required);
    }
  });

  it('proprietário tem acesso total, inclusive admin', () => {
    const p = permissionsFor('OWNER');
    for (const id of PERMISSION_IDS) expect(p[id]).toBe(true);
  });

  it('secretária opera agenda/clientes/leads/WhatsApp mas não configura nem vê financeiro', () => {
    const p = permissionsFor('SECRETARIA');
    expect(p.agenda).toBe(true);
    expect(p.clientes).toBe(true);
    expect(p.whatsapp).toBe(true);
    expect(p.config).toBe(false);
    expect(p.financeiro).toBe(false);
    expect(p.equipe).toBe(false);
    expect(p.admin).toBe(false);
  });

  it('vendedor fala com clientes/leads e campanhas, sem agenda nem página', () => {
    const p = permissionsFor('VENDEDOR');
    expect(p.clientes).toBe(true);
    expect(p.leads).toBe(true);
    expect(p.campanhas).toBe(true);
    expect(p.agenda).toBe(false);
    expect(p.pagina).toBe(false);
  });

  it('visualizador não tem nenhuma permissão de operação', () => {
    const p = permissionsFor('VIEWER');
    for (const id of PERMISSION_IDS) expect(p[id]).toBe(false);
  });

  it('override individual liga e desliga sobre o padrão do papel', () => {
    const plus = permissionsFor('ATENDENTE', { financeiro: true });
    expect(plus.financeiro).toBe(true);
    const minus = permissionsFor('ADMIN', { agenda: false });
    expect(minus.agenda).toBe(false);
    expect(minus.config).toBe(true);
  });

  it('override inconsistente não reduz o proprietário', () => {
    const p = permissionsFor('OWNER', { agenda: false, equipe: false });
    expect(p.agenda).toBe(true);
    expect(p.equipe).toBe(true);
  });

  it('validação defensiva de papel e permissão', () => {
    expect(isValidRole('SECRETARIA')).toBe(true);
    expect(isValidRole('MASTER')).toBe(false);
    expect(isValidRole(42)).toBe(false);
    expect(isValidPermission('agenda')).toBe(true);
    expect(isValidPermission('root')).toBe(false);
    expect(roleDef('VIEWER')?.label).toBe('Visualizador');
    expect(ROLES.map((r) => r.id)).toEqual(['OWNER', 'ADMIN', 'SECRETARIA', 'ATENDENTE', 'VENDEDOR', 'VIEWER']);
  });
});
