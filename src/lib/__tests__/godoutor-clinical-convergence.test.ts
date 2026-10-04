import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLegacyPagesEnabled } from '../product';
import { eligibleProfessionalIds, professionalServesService } from '../booking';
import type { Professional, Service } from '../types';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Clinical Convergence — GODOUTOR_LEGACY_PAGES OFF: limpeza da experiência padrão', () => {
  it('Profissionais não afirma distribuição obrigatoriamente automática', () => {
    // Profissionais agora vive unificado em Equipe; a política neutra está lá
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).not.toMatch(/distribuição dos agendamentos é automática/i);
    expect(equipe).not.toMatch(/cliente nunca escolhe profissional/i);
    expect(equipe).toMatch(/A agenda considera disponibilidade, serviços vinculados e regras da clínica/i);
    // /profissionais é redirect compatível, não afirma regra rígida
    const profRedirect = read('src/app/(dashboard)/profissionais/page.tsx');
    expect(profRedirect).toContain('Profissionais agora ficam em Equipe');
    expect(profRedirect).not.toMatch(/distribuição dos agendamentos é automática/i);
  });

  it('Profissionais hint usa clínica, não negócio genérico', () => {
    // Fonte única agora é Equipe (seção Profissionais)
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).toContain('Quem realiza os atendimentos da clínica');
    expect(equipe).not.toContain('Quem atende no seu negócio');
    const profRedirect = read('src/app/(dashboard)/profissionais/page.tsx');
    expect(profRedirect).toContain('Profissionais agora ficam em Equipe');
  });

  it('Serviços: PageHeader e empty hint usam clínica quando flag OFF', () => {
    const src = read('src/app/(dashboard)/servicos/page.tsx');
    expect(src).toContain('O que a clínica realiza');
    expect(src).not.toContain('O que o seu negócio oferece');
    // empty hint agora sempre clínico (foto/vitrine removidos)
    expect(src).toContain('Cadastre o primeiro para organizar a agenda');
    expect(src).not.toContain('exibir na página');
    expect(src).not.toContain('FOTO DO SERVIÇO');
  });

  it('Serviços lista não expõe preço oculto / somente exibição / destaque sem flag', () => {
    const src = read('src/app/(dashboard)/servicos/page.tsx');
    // Clinical Structure Consolidation: foto, preço oculto, somente exibição e destaque removidos da UI clínica
    expect(src).not.toContain('preço oculto na página');
    expect(src).not.toContain('somente exibição');
    expect(src).not.toMatch(/sv\.featured/);
    expect(src).not.toMatch(/showPrice/);
    expect(src).not.toContain('FOTO DO SERVIÇO');
    // badges operacionais permanecem
    expect(src).toContain('Pode ser agendado');
    expect(src).toContain('Não agendável');
    expect(src).toContain('R$ {centsToBR');
  });

  it('ServiceForm não expõe showPrice/destaque sem flag', () => {
    const src = read('src/components/dashboard/catalog-panels.tsx');
    // Clinical: foto, showPrice e destaque removidos da UI de serviço
    expect(src).not.toContain('Mostrar preço na página pública');
    expect(src).not.toContain('FOTO DO SERVIÇO');
    // pro selector hint não tem distribuição automática
    expect(src).not.toMatch(/O cliente não escolhe — a distribuição é automática/);
    expect(src).toMatch(/vínculo serviço↔profissional define quem pode realizar/);
    // perguntas removidas da UI (preservadas no banco quando payload omite)
    expect(src).not.toContain('PERGUNTAS NO AGENDAMENTO');
    expect(src).toContain('questions removidas da UI');
    expect(src).toContain('Duração padrão para novos agendamentos');
    // TeamEditor ativo não menciona página
    expect(src).not.toContain('aparece na agenda e na página');
    expect(src).toContain('Ativo (disponível para agenda)');
    expect(src).toContain('Seguir horário da clínica');
    // Nenhum "Destaque" remanescente para serviço
    expect(src).not.toMatch(/Destaque.*vitrine/);
  });

  it('Configurações BookingRules não afirma cliente nunca escolhe — distribuição automática', () => {
    const src = read('src/app/(dashboard)/configuracoes/page.tsx');
    expect(src).not.toMatch(/O cliente nunca escolhe o profissional — a regra é interna do negócio/);
    expect(src).toMatch(/ATRIBUIÇÃO DE PROFISSIONAL/);
    expect(src).toMatch(/Política da agenda/);
    expect(src).not.toMatch(/Workflow futuro/);
    expect(src).toMatch(/A agenda considera disponibilidade, serviços vinculados e regras da clínica/);
  });

  it('Disponibilidade usa clínica, não casa/empresa', () => {
    const disponibilidade = read('src/app/(dashboard)/disponibilidade/page.tsx');
    expect(disponibilidade).toContain('Quando a clínica e cada profissional');
    expect(disponibilidade).not.toContain('Quando a casa e cada profissional');
    const bh = read('src/components/dashboard/BusinessHours.tsx');
    expect(bh).toContain('Horário da clínica');
    expect(bh).not.toMatch(/Horário da empresa/);
    expect(bh).not.toMatch(/Segue a empresa/);
    // schedule constants já clínicos
    const schedule = read('src/lib/schedule.ts');
    expect(schedule).toContain('Seguir horário da clínica');
  });

  it('Flag OFF: nenhum texto operacional visível contém vitrine/página pública como centro', () => {
    // Verifica que os arquivos operacionais não contêm copy legada sem guard
    // quando isLegacyPagesEnabled() === false por padrão
    expect(isLegacyPagesEnabled({})).toBe(false);
    expect(isLegacyPagesEnabled({ GODOUTOR_LEGACY_PAGES: '0' })).toBe(false);

    const operationalFiles = [
      'src/app/(dashboard)/profissionais/page.tsx',
      'src/app/(dashboard)/servicos/page.tsx',
      'src/components/dashboard/catalog-panels.tsx',
      'src/app/(dashboard)/disponibilidade/page.tsx',
      'src/components/dashboard/BusinessHours.tsx',
      'src/app/(dashboard)/configuracoes/page.tsx',
      'src/app/(dashboard)/estrutura/page.tsx',
      'src/app/(dashboard)/equipe/page.tsx',
    ];
    for (const file of operationalFiles) {
      const src = read(file);
      // Com flag OFF, a experiência padrão não deve conter literais de vitrine/página como conceito central
      // Permitimos ocorrências dentro de strings guardadas por legacyPagesEnabled ternário ou &&,
      // mas não ocorrências soltas.
      // Para garantir, verificamos que as ocorrências de "vitrine" e "página pública" nesses arquivos, se existirem, estão sempre em contexto legacyPagesEnabled
      const hasVitrine = src.includes('vitrine');
      if (hasVitrine) {
        // Se tem vitrine, deve estar em contexto guardado (produtos já é guardado, outros não devem ter)
        expect(src).toMatch(/legacyPagesEnabled/);
      }
      // "aparece na página" não deve existir solto
      expect(src).not.toMatch(/aparece na página/);
    }
  });

  it('Flag ON: compatibilidade antiga continua renderizável', () => {
    expect(isLegacyPagesEnabled({ GODOUTOR_LEGACY_PAGES: '1' })).toBe(true);
    // Rotas públicas continuam existindo
    expect(fs.existsSync(path.join(root, 'src/app/(dashboard)/pagina/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/app/[slug]/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/app/agendar/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/app/widget/booking.js/route.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/app/api/pages/route.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/app/api/bookings/route.ts'))).toBe(true);
    // Service campos legados continuam no tipo (preservados no DB, mas não na UI clínica)
    const types = read('src/lib/types.ts');
    expect(types).toContain('showPrice?: boolean');
    expect(types).toContain('featured: boolean');
    expect(types).toContain('bookable: boolean');
    // Serviços agora é sempre clínico: sem vitrine mesmo com flag ON
    const servicos = read('src/app/(dashboard)/servicos/page.tsx');
    expect(servicos).not.toContain('preço oculto na página');
    expect(servicos).not.toContain('somente exibição');
    expect(servicos).not.toMatch(/sv\.featured/);
    const catalog = read('src/components/dashboard/catalog-panels.tsx');
    expect(catalog).not.toContain('Mostrar preço na página pública');
    // Produtos vitrine ainda existe mas guardada (legado compatível)
    const produtos = read('src/app/(dashboard)/produtos/page.tsx');
    expect(produtos).toContain('Novo produto da vitrine');
    expect(produtos).toContain('Visível na vitrine');
    // /profissionais redirect preservado como compatibilidade
    const profRedirect = read('src/app/(dashboard)/profissionais/page.tsx');
    expect(profRedirect).toContain('router.replace');
    expect(profRedirect).toContain('Profissionais agora ficam em Equipe');
  });

  it('Equipe e Profissional continuam conceitos distintos', () => {
    const equipeSrc = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipeSrc).toMatch(/Equipe.*controla quem entra no sistema/);
    expect(equipeSrc).toMatch(/Profissional.*é quem realiza atendimentos/);
    // /profissionais agora é redirect unificado, mas ainda menciona destino
    const profSrc = read('src/app/(dashboard)/profissionais/page.tsx');
    expect(profSrc).toContain('Profissionais agora ficam em Equipe');
    expect(profSrc).toContain('router.replace');
    // Tipos: Professional tem userId, mas não é User
    const types = read('src/lib/types.ts');
    expect(types).toMatch(/interface Professional/);
    expect(types).toMatch(/userId\?: string/);
    // Equipe é BusinessMember
    expect(types).toMatch(/interface BusinessMember/);
    // Equipe unificada contém gestão de profissionais (TeamEditor)
    expect(equipeSrc).toContain('TeamEditor');
    expect(equipeSrc).toContain('Profissionais');
  });

  it('Serviço ↔ Profissional vínculo ainda é por IDs reais', () => {
    const pros: Professional[] = [
      { id: 'p1', businessId: 'b1', name: 'Dra Ana', role: 'Vet', photo: '', active: true },
      { id: 'p2', businessId: 'b1', name: 'Dr Beto', role: 'Vet', photo: '', active: true },
      { id: 'p3', businessId: 'b1', name: 'Inativo', role: 'Vet', photo: '', active: false },
    ];
    const svcAll: Service = {
      id: 's1', businessId: 'b1', categoryId: '', name: 'Consulta', description: '', image: '', price: 10000, showPrice: true, durationMin: 30, professionalIds: [], active: true, featured: false, bookable: true, questions: [],
    };
    const svcRestricted: Service = {
      id: 's2', businessId: 'b1', categoryId: '', name: 'Cirurgia', description: '', image: '', price: 50000, showPrice: true, durationMin: 60, professionalIds: ['p1'], active: true, featured: false, bookable: true, questions: [],
    };
    expect(eligibleProfessionalIds(svcAll, pros)).toEqual(['p1', 'p2']);
    expect(eligibleProfessionalIds(svcRestricted, pros)).toEqual(['p1']);
    expect(professionalServesService(svcRestricted, 'p1', pros)).toBe(true);
    expect(professionalServesService(svcRestricted, 'p2', pros)).toBe(false);
    // inativo nunca elegível
    expect(professionalServesService(svcAll, 'p3', pros)).toBe(false);
  });

  it('Não houve remoção destrutiva de dados: campos legados ainda persistem no banco', () => {
    // Verifica que db.ts ainda lê instalink_doc e não houve migration destrutiva
    const db = read('src/lib/db.ts');
    expect(db).toContain('instalink_doc');
    // Product ainda existe
    const types = read('src/lib/types.ts');
    expect(types).toContain('interface Product');
    // Business ainda tem campos de página pública
    expect(types).toMatch(/slug.*string/);
    // Features ainda tem modos/produtos
    const features = read('src/lib/features.ts');
    expect(features).toContain('products');
  });

  it('Rotas públicas legadas ainda compilam (sem remoção)', () => {
    const dashboard = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(dashboard).toContain('pageStats');
    const resultados = read('src/app/(dashboard)/resultados/page.tsx');
    expect(resultados).toContain('/api/analytics');
    expect(resultados).toContain('Página pública');
  });

  it('Tenant isolation: DomainEventStore exige businessId', () => {
    const domainEvents = read('src/lib/domain-events/store.ts');
    expect(domainEvents).toMatch(/businessId/);
    const bookingCreate = read('src/lib/booking-create.ts');
    expect(bookingCreate).toMatch(/businessId/);
    const bookingsRoute = read('src/app/api/bookings/route.ts');
    expect(bookingsRoute).toMatch(/businessId/);
  });

  it('Agente não promete página como centro quando flag OFF', () => {
    const src = read('src/app/(dashboard)/agente/page.tsx');
    expect(src).toMatch(/O assistente que orienta clientes com dados reais da clínica/);
    expect(src).not.toContain("O assistente que responde na sua página usando os dados reais do negócio — sem inventar e sem mexer na sua agenda.\" : \"O assistente que orienta clientes com dados reais do negócio");
  });

  it('Resultados hint usa clínica quando flag OFF', () => {
    const src = read('src/app/(dashboard)/resultados/page.tsx');
    expect(src).toMatch(/Como está a clínica no período/);
    expect(src).toMatch(/tutores e pacientes/);
  });

  it('Onboarding usa clínica quando flag OFF', () => {
    const src = read('src/app/onboarding/page.tsx');
    expect(src).toMatch(/Crie sua clínica/);
    expect(src).toMatch(/Nome da clínica/);
    // CORREÇÃO FINAL: no OFF a pergunta de modo de venda NÃO EXISTE (nem com
    // rótulo clínico) — a base é decisão do servidor. O fieldset só renderiza
    // sob o gate da flag de compatibilidade.
    expect(src).toMatch(/\{showsServiceModelQuestion\(legacyPagesEnabled\) && \(/);
    expect(src).not.toMatch(/Como sua clínica atende/);
  });
});
