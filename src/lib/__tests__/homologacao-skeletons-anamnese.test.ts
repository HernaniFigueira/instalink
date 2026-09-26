import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { anamnesePresetFor, templateFromPreset } from '../clinic-presets';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

// ═══════════════════════════════════════════════════════════════
// HOMOLOGAÇÃO · Commit 4 — skeletons, anamnese clínica, hints
// ═══════════════════════════════════════════════════════════════

describe('P0-5 · skeletons com contraste real e shimmer', () => {
  it('tokens --skeleton-base/highlight presentes (não branco puro)', () => {
    const css = read('src/app/globals.css');
    expect(css).toMatch(/--skeleton-base:\s*#[0-9a-fA-F]{3,8}/);
    expect(css).toMatch(/--skeleton-highlight:\s*#[0-9a-fA-F]{3,8}/);
    expect(css).not.toMatch(/--skeleton-base:\s*#fff\b/i);
    expect(css).not.toMatch(/--skeleton-base:\s*#ffffff/i);
    expect(css).toContain('skeleton-shimmer');
    expect(css).toContain('animation: skeleton-shimmer');
  });

  it('skeletons específicos: Dashboard, Agenda, busca/lista, Financeiro, Página', () => {
    const ui = read('src/components/ui.tsx');
    expect(ui).toContain('export function DashboardSkeleton');
    expect(ui).toContain('export function KpiSkeleton');
    expect(ui).toContain('export function AgendaSkeleton');
    expect(ui).toContain('export function SearchListSkeleton');
    expect(ui).toContain('export function FinanceSkeleton');
    expect(ui).toContain('menu (esq.) + formulário + prévia');
    // Skeleton usa il-skeleton (classe com shimmer)
    expect(ui).toMatch(/export function Skeleton[\s\S]{0,200}il-skeleton/);
  });

  it('páginas usam o skeleton correspondente', () => {
    expect(read('src/app/(dashboard)/dashboard/page.tsx')).toContain('DashboardSkeleton');
    expect(read('src/app/(dashboard)/agenda/page.tsx')).toContain('AgendaSkeleton');
    expect(read('src/app/(dashboard)/clientes/page.tsx')).toContain('SearchListSkeleton');
    expect(read('src/app/(dashboard)/financeiro/page.tsx')).toContain('FinanceSkeleton');
    expect(read('src/app/(dashboard)/pagina/page.tsx')).toContain('PageSkeleton');
  });

  it('nenhum polling esconde lentidão (sem setInterval de reload nas páginas)', () => {
    for (const rel of [
      'src/app/(dashboard)/dashboard/page.tsx',
      'src/app/(dashboard)/agenda/page.tsx',
      'src/app/(dashboard)/clientes/page.tsx',
      'src/app/(dashboard)/financeiro/page.tsx',
    ]) {
      expect(read(rel)).not.toMatch(/setInterval\([^)]*load/);
    }
  });
});

describe('P1 · anamnese — preset vet com tipos clínicos (nada tudo-em-textarea)', () => {
  it('episódio usa select/boolean/text/textarea misturados', () => {
    const tpl = templateFromPreset('veterinaria', () => 'id1', '2026-09-23');
    const byId = Object.fromEntries(tpl.fields.map((f) => [f.id, f.type]));
    expect(byId.motivo).toBe('textarea');
    expect(byId.quando_comecou).toBe('select');
    expect(byId.apetite).toBe('select');
    expect(byId.agua).toBe('select');
    expect(byId.urina).toBe('select');
    expect(byId.fezes).toBe('select');
    expect(byId.vomitos).toBe('boolean');
    expect(byId.comportamento).toBe('select');
    expect(byId.alimentacao).toBe('text');
    expect(byId.medicacao_recente).toBe('text');
    expect(byId.vacinacao_em_dia).toBe('boolean');
    // não é só textarea
    const textareas = tpl.fields.filter((f) => f.type === 'textarea').length;
    expect(textareas).toBeLessThan(tpl.fields.length);
    expect(tpl.fields.length).toBeGreaterThanOrEqual(10);
  });

  it('preset continua reconhecível (ids estáveis, campos obrigatórios do motivo)', () => {
    const p = anamnesePresetFor('veterinaria');
    expect(p.preset).toBe('veterinaria');
    const motivo = p.fields.find((f) => f.id === 'motivo');
    expect(motivo?.required).toBe(true);
    const quando = p.fields.find((f) => f.id === 'quando_comecou');
    expect(quando?.options?.length).toBeGreaterThan(2);
  });
});

describe('P1 · anamnese — linguagem clínica e contexto do pet', () => {
  const filler = read('src/components/dashboard/AnamneseFiller.tsx');

  it('sheet usa linguagem clínica (ficha clínica, episódio atual)', () => {
    expect(filler).toContain('Ficha clínica');
    expect(filler).toContain('Episódio atual');
    expect(filler).toContain('Salvar ficha');
    expect(filler).not.toContain('questionário administrativo');
    expect(filler).not.toContain('INP');
  });

  it('dados permanentes do pet como CONTEXTO somente leitura', () => {
    expect(filler).toContain('data-testid="anamnese-pet-context"');
    expect(filler).toContain('Espécie:');
    expect(filler).toContain('Raça:');
    expect(filler).toContain('Sexo:');
    expect(filler).toContain('Peso:');
    expect(filler).toContain('Contexto do paciente');
    // o bloco de contexto não tem input editável
    const ctx = filler.slice(filler.indexOf('anamnese-pet-context'), filler.indexOf('anamnese-pet-context') + 900);
    expect(ctx).not.toMatch(/<input|<Textarea|onChange/);
  });

  it('histórico sob demanda: "Última ficha" + "Ver histórico" (sem cópia automática)', () => {
    expect(filler).toContain('Última ficha:');
    expect(filler).toContain('Ver histórico');
    expect(filler).toContain('setHistoryOpen');
    expect(filler).toContain('data-testid="anamnese-history"');
    // não pré-preenche answers a partir da última resposta
    expect(filler).not.toMatch(/setAnswers\(.*lastResponse/);
    expect(filler).not.toMatch(/setAnswers\(\{\s*\.\.\.lastResponse/);
  });

  it('Pet360: Última ficha + Ver histórico', () => {
    const p360 = read('src/components/dashboard/Pet360Sheet.tsx');
    expect(p360).toContain('Última ficha:');
    expect(p360).toContain('Ver histórico');
    expect(p360).toContain('setHistoryOpen');
  });
});

describe('P1 · arquivos no atendimento — hint e formatos inalterados', () => {
  it('hint "Exames, laudos, receitas, imagens ou documentos em PDF."', () => {
    const enc = read('src/components/dashboard/EncounterSheet.tsx');
    expect(enc).toContain('Exames, laudos, receitas, imagens ou documentos em PDF.');
    // formatos: NÃO ampliados
    expect(enc).toContain('image/jpeg,image/png,image/webp,image/gif,image/avif,application/pdf');
    expect(enc).not.toContain('.docx');
    expect(enc).not.toContain('.xlsx');
  });

  it('Pet360 files hint coerente', () => {
    expect(read('src/components/dashboard/Pet360Sheet.tsx'))
      .toContain('Exames, laudos, receitas, imagens ou documentos em PDF.');
  });
});
