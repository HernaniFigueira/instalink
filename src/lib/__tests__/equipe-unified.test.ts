import { describe, it, expect } from 'vitest';
import { buildUnified } from '@/lib/equipe-unified';
import type { Professional } from '@/lib/types';
import fs from 'node:fs';
import path from 'node:path';

function pro(overrides: Partial<Professional> & { id: string; name: string }): Professional {
  return {
    businessId: 'b1',
    role: 'Vet',
    photo: '',
    active: true,
    ...overrides,
  } as Professional;
}

describe('Equipe unified — owner + professional sem duplicação (blocker 2)', () => {
  it('owner sem professional = uma linha owner sem atende', () => {
    const unified = buildUnified({ userId: 'u_owner', name: 'Dra Owner', email: 'owner@a.com', role: 'OWNER' }, [], []);
    expect(unified).toHaveLength(1);
    expect(unified[0].kind).toBe('owner');
    if (unified[0].kind === 'owner') {
      expect(unified[0].professional).toBeNull();
      expect(unified[0].name).toBe('Dra Owner');
    }
  });

  it('owner + professional com mesmo userId = UMA linha com atende', () => {
    const owner = { userId: 'u_owner', name: 'Dra Owner', email: 'owner@a.com', role: 'OWNER' };
    const pros = [pro({ id: 'p1', name: 'Dra Owner', userId: 'u_owner', role: 'Vet' })];
    const unified = buildUnified(owner, [], pros);
    expect(unified).toHaveLength(1);
    expect(unified[0].kind).toBe('owner');
    if (unified[0].kind === 'owner') {
      expect(unified[0].professional).not.toBeNull();
      expect(unified[0].professional!.id).toBe('p1');
    }
  });

  it('owner + professional mesmo userId não duplica como professional solo', () => {
    const owner = { userId: 'u1', name: 'Owner', email: 'o@a.com', role: 'OWNER' };
    const pros = [
      pro({ id: 'p1', name: 'Owner Vet', userId: 'u1' }),
      pro({ id: 'p2', name: 'Outro Vet', userId: '' }), // solo
    ];
    const unified = buildUnified(owner, [], pros);
    // Deve ter 2 linhas: owner (com p1) + p2 solo
    expect(unified).toHaveLength(2);
    expect(unified.map((u) => u.kind)).toEqual(['owner', 'professional']);
    expect(unified.filter((u) => u.kind === 'professional')).toHaveLength(1);
  });

  it('member + professional vinculado = uma linha', () => {
    const owner = { userId: 'u_owner', name: 'Owner', email: 'o@a.com', role: 'OWNER' };
    const members = [{ id: 'm1', userId: 'u2', name: 'Ana', email: 'ana@a.com', role: 'SECRETARIA', professionalId: 'p1' } as any];
    const pros = [pro({ id: 'p1', name: 'Ana Vet', userId: 'u2' })];
    const unified = buildUnified(owner, members, pros);
    // owner + member com pro (uma linha) = 2
    expect(unified).toHaveLength(2);
    expect(unified[1].kind).toBe('member');
    if (unified[1].kind === 'member') {
      expect(unified[1].professional!.id).toBe('p1');
    }
  });

  it('professional sem login = uma linha solo', () => {
    const owner = { userId: 'u_owner', name: 'Owner', email: 'o@a.com', role: 'OWNER' };
    const pros = [pro({ id: 'p1', name: 'Vet Solo', userId: '' })];
    const unified = buildUnified(owner, [], pros);
    expect(unified).toHaveLength(2);
    expect(unified[1].kind).toBe('professional');
  });

  it('member administrativo sem professional = uma linha não atende', () => {
    const owner = { userId: 'u_owner', name: 'Owner', email: 'o@a.com', role: 'OWNER' };
    const members = [{ id: 'm1', userId: 'u2', name: 'Recep', email: 'r@a.com', role: 'ATENDENTE' } as any];
    const unified = buildUnified(owner, members, []);
    expect(unified).toHaveLength(2);
    expect(unified[1].kind).toBe('member');
    if (unified[1].kind === 'member') expect(unified[1].professional).toBeNull();
  });

  it('cenário completo: owner+pro, member admin, member+pro, solo pro = 4 linhas', () => {
    const owner = { userId: 'u_owner', name: 'Owner', email: 'o@a.com', role: 'OWNER' };
    const members = [
      { id: 'm1', userId: 'u2', name: 'Ana', email: 'ana@a.com', role: 'SECRETARIA' } as any, // admin sem pro
      { id: 'm2', userId: 'u3', name: 'Beto', email: 'beto@a.com', role: 'PROFISSIONAL', professionalId: 'p2' } as any,
    ];
    const pros = [
      pro({ id: 'p_owner', name: 'Owner Vet', userId: 'u_owner' }),
      pro({ id: 'p2', name: 'Beto Vet', userId: 'u3' }),
      pro({ id: 'p3', name: 'Solo Vet', userId: '' }),
    ];
    const unified = buildUnified(owner, members, pros);
    expect(unified).toHaveLength(4);
    expect(unified[0].kind).toBe('owner');
    expect(unified[1].kind).toBe('member'); // Ana admin
    expect(unified[2].kind).toBe('member'); // Beto + p2
    expect(unified[3].kind).toBe('professional'); // p3 solo
  });

  it('arquivo Equipe usa buildUnified e mostra Proprietário/Atende/Agenda na mesma linha', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/(dashboard)/equipe/page.tsx'), 'utf8');
    const helper = fs.readFileSync(path.join(process.cwd(), 'src/lib/equipe-unified.ts'), 'utf8');
    expect(src).toContain('buildUnified');
    expect(helper).toContain('ownerPro');
    expect(src).toContain('Proprietário');
    // Não deve ter segunda porta visual "Profissionais" como seção separada com botão
    // Após B3, deve ter hideTrigger e chooser único
    expect(src).toContain('hideTrigger');
    expect(src).toContain('Adicionar pessoa');
    expect(src).not.toContain('<section id="profissionais"');
  });
});
