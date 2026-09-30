import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('P0 FINALISSIMO - Integridade PR #46', () => {
  it('1. remove copy tecnica helpers src/lib', () => {
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).not.toContain('helpers reutilizáveis');
    expect(equipe).not.toContain('src/lib/masks.ts');
    expect(equipe).toContain('Os campos são formatados automaticamente durante a digitação.');
  });

  it('2. owner dados pessoais read-only com CTA Perfil', () => {
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).toContain("editEntry?.kind === 'owner'");
    expect(equipe).toContain('Editar no meu perfil');
    expect(equipe).toContain('/perfil?b=${businessId}');
    // deve ter resumo read-only para owner, não inputs editáveis diretos
    expect(equipe).toMatch(/Nome[\s\S]*\{fName\}[\s\S]*E-mail[\s\S]*\{fEmail\}/);
  });

  it('3. tem acesso nao mente - remocao explicita', () => {
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).toContain('Remover acesso');
    // não deve usar confirm() nativo - usa modal destrutivo
    expect(equipe).not.toContain("confirm('Remover acesso desta pessoa?");
    expect(equipe).not.toContain('window.confirm');
    expect(equipe).toContain('showRemoveConfirm');
    expect(equipe).toContain('Remover acesso de');
    expect(equipe).toContain("DELETE");
    expect(equipe).toContain("/api/team?businessId=${businessId}&id=${m.id}");
    // owner não tem remover
    expect(equipe).toContain("Ativo (permanente)");
    expect(equipe).toContain("Conceder acesso");
    // não deve ter toggle silencioso que apenas setFHasAccess sem delete
    expect(equipe).not.toContain("Remover acesso quando desmarcado (opcional");
  });

  it('4. disponibilidade novo professional nao usa id fake', () => {
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).not.toContain("professionalId=${editEntry?.professional?.id || 'novo'}");
    expect(equipe).toContain('Salve a pessoa para configurar os horários próprios.');
    expect(equipe).toContain('isNewPro ? true : fDispMode');
    // deve usar professionalId real
    expect(equipe).toContain('professionalId=${editEntry.professional.id}');
  });

  it('5. service.save retorna serviceId', () => {
    const catalog = read('src/app/api/catalog/route.ts');
    expect(catalog).toContain('return { ok: true, serviceId }');
    expect(catalog).toContain('let serviceId: string');
    expect(catalog).toMatch(/if \(existing\)[\s\S]*serviceId = existing\.id/);
  });

  it('6. catalog vet grupo name -> categoryId', () => {
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    // deve resolver nome de grupo para categoryId via category.save antes de service.save
    expect(equipe).toContain("action:'category.save', kind:'service'");
    expect(equipe).toContain('categoryId: catId');
    expect(equipe).toContain('parseMoneyToCents');
    expect(equipe).toMatch(/Será criado/i);
    // deve ter lógica de normalização/dedupe local (find por nome normalizado)
    expect(equipe).toMatch(/cats\.find\(c\s*=>/);
    // não deve enviar grupo nome direto como categoryId sem resolver
    expect(equipe).not.toMatch(/categoryId: fNewSvcGrupo \|\| undefined,.*service\.save.*name: fNewSvcName/);
  });

  it('7. CRMV simplificado - apenas CRMV fixo', () => {
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).not.toContain('CRMV-SP');
    expect(equipe).toContain('<div className="h-[38px] flex items-center px-3 rounded-sm border border-[var(--border-strong)] bg-[var(--surface-3)]');
    expect(equipe).toContain('>CRMV</div>');
    expect(equipe).toContain('formatCrmvDisplay(fUf, fCrmvNum)');
  });

  it('8. professional.services.set removido - autoridade unica', () => {
    const catalog = read('src/app/api/catalog/route.ts');
    expect(catalog).not.toContain("case 'professional.services.set'");
    expect(catalog).toContain('professional.services.set removido');
    expect(catalog).toContain('Service.professionalIds');
  });

  it('9. equipe page nao expoe path tecnico', () => {
    const files = [
      'src/app/(dashboard)/equipe/page.tsx',
      'src/app/(dashboard)/servicos/page.tsx',
      'src/components/dashboard/catalog-panels.tsx',
    ];
    for (const f of files) {
      const src = read(f);
      expect(src).not.toMatch(/src\/lib\//);
      expect(src).not.toMatch(/helper/i);
      // allow comment about file path in dev? but not in UI visible copy
      // we already checked equipe, others should not have
    }
  });
});
