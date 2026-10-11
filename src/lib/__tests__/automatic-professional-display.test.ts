import { describe, expect, it } from 'vitest';
import { automaticProfessionalDisplay } from '@/lib/booking';
import type { Professional } from '@/lib/types';

const pros = [
  { id: 'ana', name: 'Dra. Ana', active: true },
  { id: 'bia', name: 'Dra. Bia', active: true },
  { id: 'caio', name: 'Dr. Caio', active: true },
  { id: 'off', name: 'Dra. Inativa', active: false },
] as unknown as Professional[];

describe('profissional automático — rótulo honesto sem mudar a política', () => {
  it('serviço com UM único profissional elegível mostra o nome real (não "Automático")', () => {
    const svc: { professionalMode: 'selected'; professionalIds: string[] } = { professionalMode: 'selected', professionalIds: ['bia'] };
    const d = automaticProfessionalDisplay(svc, pros);
    expect(d.count).toBe(1);
    expect(d.name).toBe('Dra. Bia');
    expect(d.label).toBe('Dra. Bia');
    expect(d.label).not.toContain('Automático');
  });

  it('serviço com 2 ou mais elegíveis mostra "Automático · N profissionais"', () => {
    const svc: { professionalMode: 'selected'; professionalIds: string[] } = { professionalMode: 'selected', professionalIds: ['ana', 'bia'] };
    const d = automaticProfessionalDisplay(svc, pros);
    expect(d.count).toBe(2);
    expect(d.label).toBe('Automático · 2 profissionais');
  });

  it('modo "todos" conta somente profissionais ativos', () => {
    const d = automaticProfessionalDisplay({ professionalMode: 'all', professionalIds: [] }, pros);
    expect(d.count).toBe(3);
    expect(d.label).toBe('Automático · 3 profissionais');
  });

  it('sem serviço escolhido conta a equipe ativa', () => {
    expect(automaticProfessionalDisplay(null, pros).label).toBe('Automático · 3 profissionais');
  });

  it('serviço exigindo profissional que está inativa ou ausente não vira "Automático"', () => {
    const d = automaticProfessionalDisplay({ professionalMode: 'selected', professionalIds: ['off'] }, pros);
    expect(d.count).toBe(0);
    expect(d.label).toBe('Sem profissional habilitado');
  });
});
