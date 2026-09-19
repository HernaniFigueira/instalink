import { describe, expect, it } from 'vitest';
import {
  BRAZILIAN_STATES, MAJOR_AGE, PROFILE_TAGS_MAX, ageFromBirthDate, applyContactProfile,
  clientTags, emptyProfile, formatCep, formatCpf, formatPhoneBR, hasProfileData, initialsOf,
  isMinor, isValidCpf, normalizeBirthDate, normalizeContactProfile, profileOf,
} from '../contact-profile';
import type { BusinessCustomer, ContactProfile } from '../types';

// ═══════════════════════════════════════════════════════════════
// A3.3 — CARTEIRINHA DO CLIENTE (dados cadastrais ricos)
// ═══════════════════════════════════════════════════════════════
// O que precisa valer:
//   • campo ADITIVO: contato antigo continua válido e sem perfil;
//   • idade é DERIVADA (nunca gravada) e nunca negativa;
//   • PATCH parcial não apaga o que já estava preenchido;
//   • etiquetas são DERIVADAS dos dados reais (nunca chutadas);
//   • CPF inválido é recusado, '' (não informado) é aceito.

const NOW = new Date('2026-09-19T12:00:00Z');

function contact(patch: Partial<BusinessCustomer> = {}): BusinessCustomer {
  return {
    id: 'c1', businessId: 'b1', customerId: '', name: 'Maria da Silva',
    phone: '11912345678', email: 'maria@ex.com', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', source: 'manual', lastInteraction: '2026-01-01T00:00:00Z',
    marketingOptIn: false, ...patch,
  } as BusinessCustomer;
}

describe('idade derivada da data de nascimento', () => {
  it('calcula a idade completa (faz/não faz aniversário no ano)', () => {
    expect(ageFromBirthDate('1990-09-19', NOW)).toBe(36); // aniversário HOJE
    expect(ageFromBirthDate('1990-09-20', NOW)).toBe(35); // ainda não fez
    expect(ageFromBirthDate('1990-01-05', NOW)).toBe(36);
  });

  it('rejeita data inexistente, futuro e formato errado — nunca gera idade negativa', () => {
    expect(normalizeBirthDate('2026-02-30', NOW)).toBe('');   // fevereiro não tem 30
    expect(normalizeBirthDate('2027-01-01', NOW)).toBe('');   // futuro
    expect(normalizeBirthDate('19/09/1990', NOW)).toBe('');   // formato BR
    expect(normalizeBirthDate('', NOW)).toBe('');
    expect(normalizeBirthDate(null, NOW)).toBe('');
    expect(ageFromBirthDate('2099-01-01', NOW)).toBeNull();
    expect(ageFromBirthDate('lixo', NOW)).toBeNull();
  });

  it('menor de idade vem da idade OU da declaração da equipe', () => {
    expect(isMinor({ birthDate: '2015-05-05', guardian: { isMinor: false, name: '', phone: '', cpf: '' } }, NOW)).toBe(true);
    expect(isMinor({ birthDate: '1990-05-05', guardian: { isMinor: false, name: '', phone: '', cpf: '' } }, NOW)).toBe(false);
    // declarado menor SEM data de nascimento continua menor
    expect(isMinor({ birthDate: '', guardian: { isMinor: true, name: 'Mãe', phone: '', cpf: '' } }, NOW)).toBe(true);
    expect(isMinor(undefined, NOW)).toBe(false);
    expect(MAJOR_AGE).toBe(18);
  });
});

describe('CPF e formatação brasileira', () => {
  it('valida dígitos verificadores e recusa repetição', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('529.982.247-24')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
    expect(isValidCpf('')).toBe(false); // não informado ≠ válido
  });

  it('formata CPF, telefone e CEP a partir de dígitos', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(formatCpf('52998')).toBe('529.98');
    expect(formatPhoneBR('11912345678')).toBe('(11) 91234-5678');
    expect(formatPhoneBR('1132345678')).toBe('(11) 3234-5678');
    expect(formatCep('01310100')).toBe('01310-100');
  });
});

describe('normalização aditiva (compatibilidade retroativa)', () => {
  it('contato antigo não tem perfil e a UI recebe um perfil vazio', () => {
    const c = contact();
    expect(c.profile).toBeUndefined();
    const p = profileOf(c);
    expect(p).toEqual(emptyProfile());
    expect(hasProfileData(p)).toBe(false);
  });

  it('PATCH parcial preserva o que já estava preenchido', () => {
    const c = contact();
    applyContactProfile(c, { birthDate: '1990-03-03', cpf: '52998224725', address: { city: 'São Paulo', state: 'sp' } });
    expect(c.profile?.birthDate).toBe('1990-03-03');
    expect(c.profile?.address.city).toBe('São Paulo');
    expect(c.profile?.address.state).toBe('SP'); // UF normalizada para maiúscula

    applyContactProfile(c, { adminNote: 'Prefere manhã' });
    // o patch novo NÃO apagou o que já existia
    expect(c.profile?.birthDate).toBe('1990-03-03');
    expect(c.profile?.cpf).toBe('52998224725');
    expect(c.profile?.adminNote).toBe('Prefere manhã');
  });

  it('limpa entradas inválidas em vez de gravar lixo', () => {
    const p = normalizeContactProfile({
      birthDate: '30/02/1990', cpf: 'abc123', gender: 'x'.repeat(300),
      address: { state: 'ZZ', cep: '01310-100 extra' },
      guardian: { isMinor: 'sim', phone: '(11) 91234-5678' },
      tags: ['vip', 'vip', '', 'a'.repeat(60), ...Array.from({ length: 20 }, (_, i) => `t${i}`)],
    });
    expect(p.birthDate).toBe('');
    expect(p.cpf).toBe('123');
    expect(p.gender.length).toBeLessThanOrEqual(120);
    expect(p.address.state).toBe('');           // UF inexistente é descartada
    expect(p.address.cep).toBe('01310100');
    expect(p.guardian.isMinor).toBe(false);      // só `true` explícito
    expect(p.guardian.phone).toBe('11912345678');
    expect(p.tags.length).toBeLessThanOrEqual(PROFILE_TAGS_MAX);
    expect(new Set(p.tags).size).toBe(p.tags.length); // sem duplicata
  });

  it('não aceita UF inventada e aceita as 27 reais', () => {
    expect(BRAZILIAN_STATES.length).toBe(27);
    expect(normalizeContactProfile({ address: { state: 'SP' } }).address.state).toBe('SP');
    expect(normalizeContactProfile({ address: { state: 'XX' } }).address.state).toBe('');
  });

  it('profileOf aceita o contato OU o perfil direto', () => {
    const profile: ContactProfile = { ...emptyProfile(), birthDate: '1988-12-25' };
    expect(profileOf({ profile }).birthDate).toBe('1988-12-25');
    expect(profileOf(profile).birthDate).toBe('1988-12-25');
    expect(profileOf(null)).toEqual(emptyProfile());
    // estrutura incompleta (documento antigo) é completada, não quebrada
    const partial = profileOf({ birthDate: '1988-12-25' } as unknown as ContactProfile);
    expect(partial.address).toEqual(emptyProfile().address);
    expect(partial.guardian).toEqual(emptyProfile().guardian);
    expect(partial.tags).toEqual([]);
  });
});

describe('etiquetas da carteirinha (derivadas, nunca chutadas)', () => {
  it('menor aparece com idade e cita o responsável quando existe', () => {
    const tags = clientTags({
      name: 'João', profile: { ...emptyProfile(), birthDate: '2016-01-01', guardian: { isMinor: false, name: 'Ana', phone: '', cpf: '' } },
    }, );
    const menor = tags.find((t) => t.id === 'menor');
    expect(menor?.label).toContain('Menor');
    expect(menor?.tone).toBe('amber');
    expect(menor?.hint).toContain('Ana');
  });

  it('cliente atendido + lead + acesso + consentimento convivem', () => {
    const tags = clientTags({
      name: 'Maria', accountStatus: 'active', marketingOptIn: true,
      bookingsCount: 3, attendedCount: 2, leadsCount: 1, profile: emptyProfile(),
    });
    expect(tags.map((t) => t.id)).toEqual(['paciente', 'lead', 'acesso', 'marketing']);
    // O hint distingue concluídos do total: 2 de 3.
    expect(tags.find((t) => t.id === 'paciente')?.hint).toContain('2 atendimento(s) concluído(s) de 3');
  });

  // ── Ponto 9: "atendido" é atendimento CONCLUÍDO, não "tem booking" ──
  it('agendamento sem nenhum concluído NÃO vira "Cliente atendido"', () => {
    const tags = clientTags({ name: 'João', bookingsCount: 3, profile: emptyProfile() });
    expect(tags.map((t) => t.id)).toEqual(['agendado']);
    expect(tags[0].label).toBe('Com agendamentos');
    expect(tags[0].hint).toContain('nenhum concluído');
  });

  it('um único atendimento concluído já autoriza a etiqueta', () => {
    const tags = clientTags({ name: 'João', bookingsCount: 1, attendedCount: 1, profile: emptyProfile() });
    expect(tags.map((t) => t.id)).toEqual(['paciente']);
  });

  it('sem dado nenhum, sem etiqueta (nada é inventado)', () => {
    expect(clientTags({ name: 'X', profile: emptyProfile() })).toEqual([]);
  });

  it('toda etiqueta tem rótulo E explicação (cor nunca é o único sinal)', () => {
    const tags = clientTags({
      name: 'Maria', accountStatus: 'active', marketingOptIn: true, bookingsCount: 1, leadsCount: 1,
      profile: { ...emptyProfile(), birthDate: '2015-01-01', tags: ['convênio'] },
    });
    expect(tags.length).toBeGreaterThanOrEqual(5);
    for (const t of tags) {
      expect(t.label.trim().length).toBeGreaterThan(1);
      expect(t.hint.trim().length).toBeGreaterThan(1);
    }
  });
});

describe('iniciais do avatar', () => {
  it('usa até duas iniciais e ignora partículas', () => {
    expect(initialsOf('Maria da Silva')).toBe('MS');
    expect(initialsOf('Ana')).toBe('A');
    expect(initialsOf('')).toBe('');
    expect(initialsOf('  joão   pedro  ')).toBe('JP');
  });
});
