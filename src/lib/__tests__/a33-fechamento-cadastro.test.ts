// Fechamento A3.3 — regras puras do cadastro do cliente.
// Cobre: PATCH profundo em address/guardian, hierarquia de menor de idade,
// validação canônica de CPF (cliente E responsável) e o que conta como
// atendimento realizado.
import { describe, expect, it } from 'vitest';
import {
  ATTENDED_BOOKING_STATUS, countAttended, emptyAddress, emptyGuardian, emptyProfile,
  isAttendedBooking, isMinor, isValidCpf, normalizeContactProfile, profileCpfError,
} from '../contact-profile';
import type { ContactProfile } from '../types';

const CPF_VALIDO = '52998224725';
const CPF_VALIDO_2 = '11144477735';
const CPF_INVALIDO = '11111111111';

function profileWith(patch: Partial<ContactProfile>): ContactProfile {
  return { ...emptyProfile(), ...patch };
}

describe('Fechamento A3.3 — PATCH profundo nos objetos aninhados (ponto 5)', () => {
  const atual = profileWith({
    address: { ...emptyAddress(), cep: '20040020', street: 'Rua A', number: '100', complement: 'ap 12', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ' },
    guardian: { ...emptyGuardian(), isMinor: false, name: 'Ana Mãe', phone: '11977770000', cpf: CPF_VALIDO },
  });

  it('trocar só o número preserva cep, rua, complemento, bairro, cidade e UF', () => {
    const next = normalizeContactProfile({ address: { number: '200' } }, atual);
    expect(next.address.number).toBe('200');
    expect(next.address.cep).toBe('20040020');
    expect(next.address.street).toBe('Rua A');
    expect(next.address.complement).toBe('ap 12');
    expect(next.address.district).toBe('Centro');
    expect(next.address.city).toBe('Rio de Janeiro');
    expect(next.address.state).toBe('RJ');
  });

  it('trocar só a cidade preserva o resto do endereço', () => {
    const next = normalizeContactProfile({ address: { city: 'Niterói' } }, atual);
    expect(next.address.city).toBe('Niterói');
    expect(next.address.number).toBe('100');
    expect(next.address.street).toBe('Rua A');
    expect(next.address.cep).toBe('20040020');
  });

  it('string vazia enviada de propósito LIMPA o campo (não é "ausente")', () => {
    const next = normalizeContactProfile({ address: { complement: '' } }, atual);
    expect(next.address.complement).toBe('');
    expect(next.address.number).toBe('100');
  });

  it('guardian: trocar só o nome preserva telefone, CPF e a declaração', () => {
    const next = normalizeContactProfile({ guardian: { name: 'Carlos Pai' } }, atual);
    expect(next.guardian.name).toBe('Carlos Pai');
    expect(next.guardian.phone).toBe('11977770000');
    expect(next.guardian.cpf).toBe(CPF_VALIDO);
    expect(next.guardian.isMinor).toBe(false);
  });

  it('guardian: trocar só o telefone preserva nome e CPF', () => {
    const next = normalizeContactProfile({ guardian: { phone: '(21) 98888-0000' } }, atual);
    expect(next.guardian.phone).toBe('21988880000');
    expect(next.guardian.name).toBe('Ana Mãe');
    expect(next.guardian.cpf).toBe(CPF_VALIDO);
  });

  it('campos de vínculo futuro do responsável também sobrevivem ao patch parcial (ponto 7)', () => {
    const comVinculo = normalizeContactProfile(
      { guardian: { contactId: 'contacto-resp-1', relationship: 'Mãe' } },
      atual,
    );
    expect(comVinculo.guardian.contactId).toBe('contacto-resp-1');
    expect(comVinculo.guardian.relationship).toBe('Mãe');
    // Trocar o nome não pode apagar o vínculo.
    const depois = normalizeContactProfile({ guardian: { name: 'Ana M.' } }, comVinculo);
    expect(depois.guardian.contactId).toBe('contacto-resp-1');
    expect(depois.guardian.relationship).toBe('Mãe');
    expect(depois.guardian.name).toBe('Ana M.');
  });

  it('endereço e responsável mudam juntos sem se atropelar', () => {
    const next = normalizeContactProfile(
      { address: { state: 'sp' }, guardian: { isMinor: true } },
      atual,
    );
    expect(next.address.state).toBe('SP');
    expect(next.address.city).toBe('Rio de Janeiro');
    expect(next.guardian.isMinor).toBe(true);
    expect(next.guardian.name).toBe('Ana Mãe');
  });
});

describe('Fechamento A3.3 — menor de idade sem contradição (ponto 6)', () => {
  it('nascimento adulto + isMinor:true NÃO classifica como menor', () => {
    const p = profileWith({ birthDate: '1990-05-05', guardian: { ...emptyGuardian(), isMinor: true } });
    expect(isMinor(p)).toBe(false);
  });

  it('sem nascimento, isMinor:true vale como declaração manual', () => {
    const p = profileWith({ birthDate: '', guardian: { ...emptyGuardian(), isMinor: true } });
    expect(isMinor(p)).toBe(true);
  });

  it('nascimento de criança classifica como menor mesmo com isMinor:false', () => {
    const p = profileWith({ birthDate: '2018-03-03', guardian: { ...emptyGuardian(), isMinor: false } });
    expect(isMinor(p)).toBe(true);
  });

  it('nascimento inválido não é autoridade — cai na declaração', () => {
    const p = profileWith({ birthDate: '1990-13-45', guardian: { ...emptyGuardian(), isMinor: true } });
    expect(isMinor(p)).toBe(true);
  });

  it('sem nada, não é menor', () => {
    expect(isMinor(emptyProfile())).toBe(false);
    expect(isMinor(null)).toBe(false);
  });
});

describe('Fechamento A3.3 — CPF validado no servidor, cliente e responsável (ponto 4)', () => {
  it('aceita CPF válido do cliente', () => {
    expect(profileCpfError({ cpf: CPF_VALIDO })).toBe('');
  });

  it('vazio é "não informado", não erro', () => {
    expect(profileCpfError({ cpf: '' })).toBe('');
    expect(profileCpfError({})).toBe('');
    expect(profileCpfError(undefined)).toBe('');
  });

  it('CPF do cliente inválido tem mensagem própria', () => {
    expect(profileCpfError({ cpf: CPF_INVALIDO })).toBe('CPF inválido.');
    expect(profileCpfError({ cpf: '123' })).toBe('CPF inválido.');
  });

  it('CPF do responsável inválido tem mensagem própria', () => {
    expect(profileCpfError({ cpf: CPF_VALIDO, guardian: { cpf: CPF_INVALIDO } })).toBe('CPF do responsável inválido.');
  });

  it('o responsável também aceita vazio e válido', () => {
    expect(profileCpfError({ guardian: { cpf: '' } })).toBe('');
    expect(profileCpfError({ guardian: { cpf: CPF_VALIDO_2 } })).toBe('');
  });

  it('a máscara não interfere na validação', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(profileCpfError({ cpf: '529.982.247-25' })).toBe('');
  });
});

describe('Fechamento A3.3 — o que conta como atendimento realizado (ponto 9)', () => {
  it('só completed é atendimento', () => {
    expect(ATTENDED_BOOKING_STATUS).toBe('completed');
    expect(isAttendedBooking('completed')).toBe(true);
    for (const s of ['scheduled', 'pending', 'confirmed', 'cancelled', 'no_show', '', undefined]) {
      expect(isAttendedBooking(s)).toBe(false);
    }
  });

  it('conta só os concluídos de uma lista mista', () => {
    expect(countAttended([
      { status: 'scheduled' }, { status: 'completed' }, { status: 'cancelled' },
      { status: 'completed' }, { status: 'no_show' },
    ])).toBe(2);
  });

  it('lista vazia ou sem status não conta nada', () => {
    expect(countAttended([])).toBe(0);
    expect(countAttended([{}, null, undefined])).toBe(0);
  });
});
