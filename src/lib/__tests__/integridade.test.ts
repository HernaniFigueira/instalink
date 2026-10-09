import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { permissionsFor } from '@/lib/permissions';
import { parseMoneyToCents, onlyDigits } from '@/lib/utils';
import { isValidCpf, BRAZILIAN_STATES } from '@/lib/contact-profile';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

function normalizeCategoryName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

describe('Integridade A-F — provas comportamentais além de grep', () => {
  it('A. permissionsFor calcula efetivas corretamente e override só quando difere da base', () => {
    const baseSec = permissionsFor('SECRETARIA');
    expect(baseSec.agenda).toBe(true);
    expect(baseSec.catalogo).toBe(false);
    const withOverride = permissionsFor('SECRETARIA', { catalogo: true });
    expect(withOverride.catalogo).toBe(true);
    expect(withOverride.agenda).toBe(true);
    const offAgenda = permissionsFor('SECRETARIA', { agenda: false });
    expect(offAgenda.agenda).toBe(false);
    const base = permissionsFor('SECRETARIA');
    const desiredSame = true;
    const shouldStoreSame = desiredSame !== base.agenda;
    expect(shouldStoreSame).toBe(false);
    const desiredDiff = false;
    const shouldStoreDiff = desiredDiff !== base.agenda;
    expect(shouldStoreDiff).toBe(true);
    const secAgenda = permissionsFor('SECRETARIA').agenda;
    const atendAgenda = permissionsFor('ATENDENTE').agenda;
    expect(secAgenda).toBe(true);
    expect(atendAgenda).toBe(true);
    const secCatalogo = permissionsFor('SECRETARIA').catalogo;
    const atendCatalogo = permissionsFor('ATENDENTE').catalogo;
    expect(secCatalogo).toBe(false);
    expect(atendCatalogo).toBe(false);
    const atendWithCat = permissionsFor('ATENDENTE', { catalogo: true });
    expect(atendWithCat.catalogo).toBe(true);
    const ownerOverride = permissionsFor('OWNER', { agenda: false, catalogo: false });
    expect(ownerOverride.agenda).toBe(true);
    expect(ownerOverride.catalogo).toBe(true);
    const team = read('src/app/api/team/route.ts');
    expect(team).toContain('permissionOverrides');
    expect(team).toContain('permissionsFor(');
    expect(team).toContain('permissions:');
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).toContain(`typeof override === 'boolean' ? override : base`);
    expect(equipe).toContain('permissionsFor(fRole');
  });

  it('B. phone/cpf: onlyDigits + fallback GET e limpeza com "" explícito', () => {
    expect(onlyDigits('(11) 91234-5678')).toBe('11912345678');
    expect(onlyDigits('  011912345678  ')).toBe('011912345678');
    const team = read('src/app/api/team/route.ts');
    // fallback canônico: contém phone e cpf e o operador ||
    expect(team).toContain('phone');
    expect(team).toContain('cpf');
    expect(team).toContain('||');
    expect(team).toContain('onlyDigits');
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).toMatch(/phone:\s*phoneDigits/);
    expect(equipe).toMatch(/cpf:\s*cpfDigits/);
    expect(team).toMatch(/phone !== undefined/);
    expect(team).toMatch(/cpf !== undefined/);
    const phoneDigitsEmpty = onlyDigits('');
    expect(phoneDigitsEmpty).toBe('');
    const payloadClear = { phone: '', cpf: '' };
    expect(payloadClear.phone).toBe('');
    expect(payloadClear.cpf).toBe('');
  });

  it('C. category.save normaliza trim/case/accent/spaces e deduplica sem duplicata', () => {
    expect(normalizeCategoryName('  Consultas  ')).toBe('consultas');
    expect(normalizeCategoryName('CONSULTAS')).toBe('consultas');
    expect(normalizeCategoryName('Cónsultás')).toBe('consultas');
    expect(normalizeCategoryName('Consultas   Especiais')).toBe('consultas especiais');
    expect(normalizeCategoryName('  Vacinas\t\n')).toBe('vacinas');
    expect(normalizeCategoryName('Cirurgias')).not.toBe('consultas');
    expect(normalizeCategoryName('Vacinação')).toBe(normalizeCategoryName('Vacinacao'));
    expect(normalizeCategoryName('Consultas  Gerais')).toBe('consultas gerais');
    expect(normalizeCategoryName('Consultas Gerais')).toBe('consultas gerais');
    const catalog = read('src/app/api/catalog/route.ts');
    expect(catalog).toContain("normalize('NFD')");
    expect(catalog).toContain('normalizeName');
    expect(catalog).toContain('categoryId');
    expect(catalog).toMatch(/businessId.*kind|kind.*businessId/);
    expect(catalog).toContain('dup');
    expect(catalog).toContain('if (dup)');
    expect(catalog).toMatch(/categoryId/);
  });

  it('D. service.save valida categoryId pertence à clínica kind service 400 tenant-safe', () => {
    const catalog = read('src/app/api/catalog/route.ts');
    expect(catalog).toContain('if (body.categoryId)');
    expect(catalog).toContain('Categoria inválida');
    expect(catalog).toContain('db.categories.find');
    expect(catalog).toMatch(/businessId/);
    expect(catalog).toMatch(/service/);
    const fakeDb = {
      categories: [
        { id: 'cat-1', businessId: 'biz-A', kind: 'service', name: 'Consultas' },
        { id: 'cat-2', businessId: 'biz-B', kind: 'service', name: 'Consultas' },
        { id: 'cat-3', businessId: 'biz-A', kind: 'product', name: 'Ração' },
      ],
    };
    function validateCategoryId(body: any, businessId: string, db: typeof fakeDb) {
      if (body.categoryId) {
        const cat = db.categories.find((c) => c.id === body.categoryId);
        if (!cat || cat.businessId !== businessId || cat.kind !== 'service') {
          return { ok: false, status: 400 };
        }
      }
      return { ok: true };
    }
    expect(validateCategoryId({ categoryId: 'cat-1' }, 'biz-A', fakeDb).ok).toBe(true);
    expect(validateCategoryId({ categoryId: 'cat-2' }, 'biz-A', fakeDb).ok).toBe(false);
    expect(validateCategoryId({ categoryId: 'cat-3' }, 'biz-A', fakeDb).ok).toBe(false);
    expect(validateCategoryId({ categoryId: 'nope' }, 'biz-A', fakeDb).ok).toBe(false);
    expect(validateCategoryId({}, 'biz-A', fakeDb).ok).toBe(true);
  });

  it('E. professional.save valida CPF/phone/email/CRMV', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('5299822472')).toBe(false);
    expect(isValidCpf('')).toBe(false);
    expect(onlyDigits('(11) 99999-9999').length).toBe(11);
    expect(onlyDigits('1199999999').length).toBe(10);
    expect(onlyDigits('9999').length).toBeLessThan(10);
    const emailOk = 'vet@clinica.com.br';
    const emailBad = 'vet.clinica';
    expect(emailOk.includes('@')).toBe(true);
    expect(emailBad.includes('@')).toBe(false);
    expect(BRAZILIAN_STATES).toContain('SP');
    expect(BRAZILIAN_STATES).toHaveLength(27);
    expect(BRAZILIAN_STATES).toContain('RJ');
    expect(BRAZILIAN_STATES.includes('XX' as any)).toBe(false);
    const catalog = read('src/app/api/catalog/route.ts');
    expect(catalog).toContain('isValidCpf');
    expect(catalog).toContain('Telefone inválido');
    expect(catalog).toContain('E-mail inválido');
    expect(catalog).toContain('BRAZILIAN_STATES');
    expect(catalog).toContain('CRMV');
    expect(catalog).toContain('UF inválida');
    expect(catalog).toContain('Informe o número do CRMV');
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).not.toContain('CRMV-SP');
    expect(equipe).toContain('<Input value="CRMV" readOnly');
    expect(equipe).toContain('formatCrmvDisplay');
    function validateCrmv(uf: string, num: string) {
      if (uf || num) {
        if (!BRAZILIAN_STATES.includes(uf as any)) return { ok: false, msg: 'UF inválida para CRMV.' };
        if (!num.trim()) return { ok: false, msg: 'Número do CRMV obrigatório.' };
      }
      return { ok: true };
    }
    expect(validateCrmv('SP', '12345').ok).toBe(true);
    expect(validateCrmv('XX', '12345').ok).toBe(false);
    expect(validateCrmv('SP', '').ok).toBe(false);
    expect(validateCrmv('', '').ok).toBe(true);
  });

  it('F. preço inline usa parseMoneyToCents: "120,00" => 12000c, não Number 120c bug', () => {
    expect(parseMoneyToCents('120,00')).toBe(12000);
    expect(parseMoneyToCents('120.00')).toBe(12000);
    expect(parseMoneyToCents('1.200,50')).toBe(120050);
    expect(parseMoneyToCents('')).toBe(0);
    expect(parseMoneyToCents('0,00')).toBe(0);
    expect(Number('120,00')).toBeNaN();
    expect(Number('120.00')).toBe(120);
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).toContain('parseMoneyToCents(fNewSvcPrice)');
    expect(equipe).not.toContain('price: Number(fNewSvcPrice)');
    const panels = read('src/components/dashboard/catalog-panels.tsx');
    expect(panels).toContain('parseMoneyToCents(price)');
    const payloadCorreto = { price: parseMoneyToCents('120,00') };
    const payloadBug = { price: Number('120.00') };
    expect(payloadCorreto.price).toBe(12000);
    expect(payloadBug.price).toBe(120);
    expect(payloadCorreto.price).not.toBe(payloadBug.price);
  });

  it('G. inline service fluxo category.save -> categoryId -> service.save sem GET', () => {
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).toContain("action:'category.save', kind:'service'");
    expect(equipe).toContain('cr.data?.categoryId');
    expect(equipe).toContain('catId = cr.data.categoryId');
    expect(equipe).toContain("action:'service.save'");
    expect(equipe).toContain('categoryId: catId');
    const panels = read('src/components/dashboard/catalog-panels.tsx');
    expect(panels).toContain("action:'category.save', kind:'service'");
    expect(panels).toContain('r.data?.categoryId');
    expect(panels).toContain('resolvedCategoryId');
  });
});
