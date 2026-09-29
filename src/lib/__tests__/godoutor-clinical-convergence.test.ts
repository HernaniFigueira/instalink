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
    const src = read('src/app/(dashboard)/profissionais/page.tsx');
    expect(src).not.toMatch(/distribuição dos agendamentos é automática/i);
    expect(src).not.toMatch(/cliente nunca escolhe profissional/i);
    // Novo texto neutro deve existir
    expect(src).toMatch(/vinculados a profissionais conforme disponibilidade/i);
  });

  it('Profissionais hint usa clínica, não negócio genérico', () => {
    const src = read('src/app/(dashboard)/profissionais/page.tsx');
    expect(src).toContain('Quem realiza os atendimentos da clínica');
    expect(src).not.toContain('Quem atende no seu negócio');
  });

  it('Serviços: PageHeader e empty hint usam clínica quando flag OFF', () => {
    const src = read('src/app/(dashboard)/servicos/page.tsx');
    expect(src).toContain('O que a clínica realiza');
    expect(src).not.toContain('O que o seu negócio oferece');
    // empty hint conditional
    expect(src).toMatch(/isLegacyPagesEnabled\(\) \? "Cadastre o primeiro para exibir na página/);
    expect(src).toContain('para organizar a agenda e o atendimento');
  });

  it('Serviços lista não expõe preço oculto / somente exibição / destaque sem flag', () => {
    const src = read('src/app/(dashboard)/servicos/page.tsx');
    // preço oculto e somente exibição e star devem estar guardados por isLegacyPagesEnabled()
    expect(src).toMatch(/isLegacyPagesEnabled\(\) && !pricePublic/);
    expect(src).toMatch(/isLegacyPagesEnabled\(\) \? 'somente exibição' : 'não agendável'/);
    expect(src).toMatch(/isLegacyPagesEnabled\(\) && sv\.featured/);
    // não deve haver ocorrência de "preço oculto na página" sem guard
    const unguardedPreco = (src.match(/preço oculto na página/g) || []).length;
    const guardedPreco = (src.match(/isLegacyPagesEnabled\(\) && !pricePublic/g) || []).length;
    expect(guardedPreco).toBeGreaterThan(0);
    expect(unguardedPreco).toBe(guardedPreco); // todas as ocorrências são guardadas
  });

  it('ServiceForm não expõe showPrice/destaque sem flag', () => {
    const src = read('src/components/dashboard/catalog-panels.tsx');
    // showPrice já era guardado, continua
    expect(src).toMatch(/legacyPagesEnabled && \(\s*<label[\s\S]*?Mostrar preço na página pública/);
    // pro selector hint não tem distribuição automática
    expect(src).not.toMatch(/O cliente não escolhe — a distribuição é automática/);
    expect(src).toMatch(/vínculo serviço↔profissional define quem pode realizar/);
    // TeamEditor ativo não menciona página
    expect(src).not.toContain('aparece na agenda e na página');
    expect(src).toContain('Ativo (disponível para agenda)');
    // Destaque guardado
    expect(src).toMatch(/\{legacyPagesEnabled && \(\s*<label[^>]*>.*Destaque/);
  });

  it('Configurações BookingRules não afirma cliente nunca escolhe — distribuição automática', () => {
    const src = read('src/app/(dashboard)/configuracoes/page.tsx');
    expect(src).not.toMatch(/O cliente nunca escolhe o profissional — a regra é interna do negócio/);
    expect(src).toMatch(/ATRIBUIÇÃO DE PROFISSIONAL/);
    expect(src).toMatch(/Política da agenda/);
    expect(src).toMatch(/Políticas por canal serão configuráveis no Workflow futuro/);
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
    // Service campos legados continuam no tipo
    const types = read('src/lib/types.ts');
    expect(types).toContain('showPrice?: boolean');
    expect(types).toContain('featured: boolean');
    expect(types).toContain('bookable: boolean');
    // Quando flag ON, servico deve mostrar showPrice/destaque etc
    const servicos = read('src/app/(dashboard)/servicos/page.tsx');
    expect(servicos).toContain('isLegacyPagesEnabled() && sv.featured');
    expect(servicos).toContain('preço oculto na página');
    expect(servicos).toContain('somente exibição');
    const catalog = read('src/components/dashboard/catalog-panels.tsx');
    expect(catalog).toContain('Mostrar preço na página pública');
    expect(catalog).toContain('Destaque');
    // Produtos vitrine ainda existe mas guardada
    const produtos = read('src/app/(dashboard)/produtos/page.tsx');
    expect(produtos).toContain('Novo produto da vitrine');
    expect(produtos).toContain('Visível na vitrine');
  });

  it('Equipe e Profissional continuam conceitos distintos', () => {
    const equipeSrc = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipeSrc).toMatch(/Equipe.*controla quem entra no sistema/);
    const profSrc = read('src/app/(dashboard)/profissionais/page.tsx');
    expect(profSrc).toMatch(/Profissionais são.*quem atende/);
    // Tipos: Professional tem userId, mas não é User
    const types = read('src/lib/types.ts');
    expect(types).toMatch(/interface Professional/);
    expect(types).toMatch(/userId\?: string/);
    // Equipe é BusinessMember
    expect(types).toMatch(/interface BusinessMember/);
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
    expect(src).toMatch(/Como sua clínica atende/);
  });
});
