// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · MISSÃO 02 — cadastro de cliente como PÁGINA própria
// Fiação dos quatro pontos: página /clientes/novo, Clientes, Novo agendamento,
// Agenda (retomar) e Cliente 360 (continuar). Contratos de código, não de
// aparência: a jornada real é coberta no Chromium (ver relatório da missão).
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(rel, 'utf8');
const PAGE = read('src/app/(dashboard)/clientes/novo/page.tsx');
const CLIENTES = read('src/app/(dashboard)/clientes/page.tsx');
const BOOKING = read('src/components/dashboard/NewBookingSheet.tsx');
const AGENDA = read('src/app/(dashboard)/agenda/page.tsx');
const PERFIL = read('src/app/(dashboard)/clientes/[id]/page.tsx');
const FORM = read('src/components/dashboard/NewClientSheet.tsx');

describe('Missão 02 · página própria /clientes/novo', () => {
  it('o cadastro completo não usa overlay (Dialog, Drawer, Sheet)', () => {
    for (const src of [PAGE, FORM]) {
      expect(src).not.toMatch(/WorkspaceSheet|<Drawer|<Dialog|DetailSideModal/);
    }
  });

  it('a página só monta o formulário após resolver unidade, rascunho e tipo (estados explícitos)', () => {
    expect(PAGE).toContain("vet.status === 'loading'");
    expect(PAGE).toContain("vet.status === 'error'");
    expect(PAGE).toContain("apiGet<{ vet?: boolean }>(`/api/pets?businessId=");
    expect(PAGE).toContain('AreaLoadError');
  });

  it('acesso recortado (Professional) não vê o formulário: mesma régua do botão e do servidor', () => {
    expect(PAGE).toContain("const unitScope = !workspace.agendaScope || workspace.agendaScope === 'all';");
    expect(PAGE).toContain('if (!unitScope)');
  });

  it('salvar o cliente vindo da agenda injeta tutor/pet no rascunho; nada de agendamento é criado', () => {
    expect(PAGE).toContain('withRegisteredClient(draft');
    expect(PAGE).toContain('writeBookingReturn(next)');
    expect(PAGE).not.toMatch(/\/api\/bookings/);
  });

  it('a URL da página nunca carrega busca, nome ou telefone', () => {
    expect(PAGE).not.toMatch(/searchParams\.get\('(name|phone|q|query)'\)/);
  });
});

describe('Missão 02 · Clientes', () => {
  it('"Novo cliente" e o empty state abrem a rota, não um painel', () => {
    expect(CLIENTES).not.toContain('NewClientSheet');
    expect(CLIENTES).not.toContain('setNewClientOpen');
    expect(CLIENTES).toContain('newClientFromListHref(businessId)');
    expect(CLIENTES).toContain('rememberClientsListQuery(businessId, listStateQuery())');
  });

  it('?novo=1 (Quick Create global) segue para a mesma página', () => {
    expect(CLIENTES).toMatch(/router\.replace\(newClientFromListHref\(businessId\)\)/);
  });
});

describe('Missão 02 · Novo agendamento', () => {
  it('"+ Novo cliente" guarda o rascunho e navega; sem painel lateral aninhado', () => {
    expect(BOOKING).toContain('writeBookingReturn({');
    expect(BOOKING).toContain('router.push(newClientFromBookingHref(businessId))');
    expect(BOOKING).not.toMatch(/\bside=\{|sideTitle=|onSideClose|registerOpen/);
    expect(BOOKING).not.toContain('NewClientForm');
  });

  it('o gatilho segue a régua de escopo da unidade (RBAC)', () => {
    expect(BOOKING).toContain("const canRegisterClient = !workspace.agendaScope || workspace.agendaScope === 'all';");
    expect(BOOKING).toContain('{!picked && !unlinkedPrefill && canRegisterClient && (');
  });
});

describe('Missão 02 · Agenda e Cliente 360', () => {
  it('Agenda reabre o agendamento do rascunho uma vez e só consome o rascunho após criar', () => {
    expect(AGENDA).toContain("params.get('retomar') !== 'agendamento'");
    expect(AGENDA).toContain('readBookingReturn(businessId)');
    expect(AGENDA).toContain('clearBookingReturn(businessId)');
    expect(AGENDA).toContain('restoredBookingRef.current');
  });

  it('Cliente 360 mostra "Continuar agendamento" só com ?retorno=agendamento e rascunho válido', () => {
    expect(PERFIL).toContain("search.get('retorno') === 'agendamento'");
    expect(PERFIL).toContain('continueBookingHref(businessId)');
    expect(PERFIL).toContain('data-return-booking="true"');
  });
});
