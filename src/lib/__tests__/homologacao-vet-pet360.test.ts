import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { breedSuggestions, sanitizePet, validatePet, vetPetRequired, DOG_BREEDS, CAT_BREEDS } from '../pets';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · P0-3 vet · P0-4 pet form · P1 Pet 360 e raças
// ═══════════════════════════════════════════════════════════════

describe('P0-3 · veterinária exige pet quando o tutor já tem pets', () => {
  it('vetPetRequired: só veterinária + pets ativos', () => {
    expect(vetPetRequired({ clinicType: 'veterinaria', hasActivePets: true })).toBe(true);
    expect(vetPetRequired({ clinicType: 'veterinaria', hasActivePets: false })).toBe(false);
    expect(vetPetRequired({ clinicType: 'medica', hasActivePets: true })).toBe(false);
    expect(vetPetRequired({ clinicType: 'geral', hasActivePets: false })).toBe(false);
  });

  it('servidor recusa agendamento veterinário sem pet quando tutor tem pet', () => {
    const api = read('src/app/api/bookings/route.ts');
    expect(api).toContain("business.clinicType === 'veterinaria'");
    expect(api).toContain('selecione o pet');
    expect(api).toMatch(/x\.active !== false/);
    expect(api).toContain('!params.petId');
  });

  it('NewBookingSheet: pet obrigatório, sem "Sem vínculo", com cadastro inline', () => {
    const sheet = read('src/components/dashboard/NewBookingSheet.tsx');
    expect(sheet).not.toContain('Sem vínculo (só tutor)');
    expect(sheet).toContain('Selecione o pet…');
    expect(sheet).toContain('escolha o pet (paciente)');
    expect(sheet).toContain('Cadastrar pet');
    expect(sheet).toContain('Salvar e usar neste agendamento');
    expect(sheet).toContain('data-vet-pet-empty');
    // Após criar, seleciona o pet recém-criado
    expect(sheet).toMatch(/setPetId\(created\.id\)/);
  });

  it('agenda e atendimento apresentam PET primeiro com Tutor como contexto', () => {
    const agenda = read('src/app/(dashboard)/agenda/page.tsx');
    expect(agenda).toContain('b.petName || b.customerName');
    expect(agenda).toContain('Tutor:');
    const enc = read('src/app/api/encounters/route.ts');
    expect(enc).toContain('petName: pet?.name');
    const sheet = read('src/components/dashboard/EncounterSheet.tsx');
    expect(sheet).toContain('row.petName || row.customerName');
    expect(sheet).toContain('Tutor:');
  });
});

describe('P0-4 · campos do pet persistem sem troca de conteúdo', () => {
  it('roundtrip criar → salvar → editar → salvar mantém cada campo idêntico', () => {
    const created = sanitizePet({ id: 'p9', businessId: 'b1', tutorId: 'c1' }, {
      name: 'Greg', species: 'cachorro', breed: 'Bulldog', sex: 'M',
      birthDate: '2022-03-10', weightKg: 28.4, notes: 'Alergia a ração X', photo: '',
    });
    expect(created).toMatchObject({
      id: 'p9', name: 'Greg', species: 'cachorro', breed: 'Bulldog', sex: 'M',
      birthDate: '2022-03-10', weightKg: 28.4, notes: 'Alergia a ração X',
    });
    // edição: muda SÓ o peso — os demais campos não derivam um do outro
    const edited = sanitizePet({ id: 'p9', businessId: 'b1', tutorId: 'c1' }, {
      ...created, weightKg: 29,
    });
    expect(edited.name).toBe('Greg');
    expect(edited.species).toBe('cachorro');
    expect(edited.breed).toBe('Bulldog');
    expect(edited.sex).toBe('M');
    expect(edited.birthDate).toBe('2022-03-10');
    expect(edited.weightKg).toBe(29);
    expect(edited.notes).toBe('Alergia a ração X');
    expect(validatePet(edited)).toBe('');
  });

  it('PetsSection: cada campo tem id/label próprio e não compartilha state', () => {
    const section = read('src/components/dashboard/PetsSection.tsx');
    for (const id of ['pet-name', 'pet-species', 'pet-breed', 'pet-sex', 'pet-birth', 'pet-weight', 'pet-notes']) {
      expect(section).toContain(`id="${id}"`);
      expect(section).toContain(`htmlFor="${id}"`);
    }
    // edição clona o objeto do pet (sem referência compartilhada com a lista)
    expect(section).toMatch(/setEditing\(\{ \.\.\.p \}\)/);
    expect(section).toMatch(/setEditing\(\{ \.\.\.editing,/);
    // abrir novo zera o rascunho
    expect(section).toContain('EMPTY_PET');
  });
});

describe('P1 · raças em autocomplete (sempre digitar outra)', () => {
  it('sugestões por espécie; "outro" é livre', () => {
    expect(breedSuggestions('cachorro').length).toBeGreaterThan(20);
    expect(breedSuggestions('gato').length).toBeGreaterThan(10);
    expect(breedSuggestions('outro')).toEqual([]);
    expect(breedSuggestions('ave')).toEqual([]);
    expect(DOG_BREEDS).toContain('Pastor Alemão');
    expect(CAT_BREEDS).toContain('Persa');
  });

  it('PetsSection e NewBookingSheet usam datalist (não lista fechada)', () => {
    const section = read('src/components/dashboard/PetsSection.tsx');
    expect(section).toContain('list="pet-breeds-datalist"');
    expect(section).toContain('breedSuggestions');
    const nb = read('src/components/dashboard/NewBookingSheet.tsx');
    expect(nb).toContain('list="nb-pet-breeds"');
    expect(nb).toContain('breedSuggestions');
  });
});

describe('P1 · Pet 360 retorna só dados do pet', () => {
  it('componente existe e filtra encounters/bookings/responses por petId', () => {
    const c = read('src/components/dashboard/Pet360Sheet.tsx');
    expect(c).toContain('data-pet360');
    expect(c).toContain('e.petId === pet.id');
    expect(c).toContain('b.petId === pet.id');
    expect(c).toContain('Responsável financeiro');
    // não duplica financeiro do tutor no pet
    expect(c).not.toMatch(/\/api\/finance\?/);
    for (const section of ['Resumo', 'Atendimentos', 'Agenda', 'Anamnese', 'Arquivos', 'Observações']) {
      expect(c).toContain(section);
    }
  });

  it('detalhe do agendamento abre Pet 360 ao clicar no pet', () => {
    const detail = read('src/components/dashboard/BookingDetailSheet.tsx');
    expect(detail).toContain('Pet360Sheet');
    expect(detail).toContain('setPet360Open(true)');
    const drawer = read('src/components/dashboard/ClientProfileDrawer.tsx');
    expect(drawer).toContain('onOpenPet={setPet360}');
    expect(drawer).toContain('Pet360Sheet');
  });
});
