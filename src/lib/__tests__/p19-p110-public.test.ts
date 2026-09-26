// ═══════════════════════════════════════════════════════════════
// P1.9 + P1.10 — PÁGINA PÚBLICA: preço escondido NUNCA vaza · barra só no mobile
// ═══════════════════════════════════════════════════════════════
// P1.9 — showPrice=false significa que o preço NÃO aparece em NENHUM passo
//        do fluxo público (escolha do serviço, resumo, widget de agendamento).
// P1.10 — a barra inferior de navegação é SÓ do mobile (some em ≥768px);
//        o respiro de rodapé acompanha (sem buraco no desktop).
//
// Os pontos certos (ClinicContent/agent-flow/concierge) já usam priceVisible;
// estes testes travam os que VAZAVAM (AgendarFlow · widgets2) e a regra nova.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { priceVisible, publicPriceLabel } from '../pricing';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('P1.9 — preço público só quando o serviço libera', () => {
  const flow = read('src/components/public/AgendarFlow.tsx');
  const widgets = read('src/components/public/widgets2.tsx');

  it('priceVisible: ausente/true libera; false NUNCA libera (legado preservado)', () => {
    expect(priceVisible(undefined)).toBe(true);
    expect(priceVisible(null)).toBe(true);
    expect(priceVisible({} as any)).toBe(true);
    expect(priceVisible({ showPrice: true } as any)).toBe(true);
    expect(priceVisible({ showPrice: false } as any)).toBe(false);
  });

  it('AgendarFlow: a escolha do serviço só mostra preço com priceVisible', () => {
    expect(flow).toMatch(/\{priceVisible\(svc\) && \(/);
    expect(flow).toMatch(/svc\.price > 0 \? money\(svc\.price\) : 'A combinar'/);
  });

  it('widgets2: escolha, detalhe e RESUMO do widget tudo gated', () => {
    // fallback de descrição não vira preço
    expect(widgets).toMatch(/publicServiceSecondary\(service\) \|\| \(priceVisible\(service\) \? publicPriceLabel\(service\.price\) : ''\)/);
    // lista de serviços
    expect(widgets).toMatch(/\{priceVisible\(s\) && <span className="font-extrabold text-sm">\{money\(s\.price\)\}<\/span>\}/);
    // resumo final "Confira seu atendimento"
    expect(widgets).toMatch(/\{priceVisible\(service\) && \(\s*<p className="font-extrabold il-accent/);
  });

  it('os pontos que JÁ estavam certos continuam gated (regressão)', () => {
    const clinic = read('src/components/public/ClinicContent.tsx');
    expect(clinic.match(/\{priceVisible\(sv\) &&/g)?.length).toBeGreaterThanOrEqual(2);
    expect(read('src/lib/agent-flow.ts')).toMatch(/priceVisible/);
    expect(read('src/lib/concierge.ts')).toMatch(/priceVisible/);
  });

  it('o rótulo de preço continua sendo UMA fonte (lib/pricing.ts)', () => {
    expect(publicPriceLabel(18000)).toContain('180');
  });
});

describe('P1.10 — barra inferior é SÓ do mobile', () => {
  const bar = read('src/components/public/BottomBar.tsx');
  const page = read('src/app/[slug]/page.tsx');

  it('a barra some a partir de 768px (md:hidden — 390 mostra, 768/1024/1440 não)', () => {
    // Tailwind md = 768px: abaixo a barra existe; em 768/1024/1440 ela some.
    expect(bar).toMatch(/className="fixed inset-x-0 bottom-0 z-40 border-t md:hidden"/);
  });

  it('o respiro de rodapé da página acompanha a barra (sem buraco no desktop)', () => {
    expect(page).toMatch(/max-md:pb-\[calc\(6\.5rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
    expect(page).not.toMatch(/paddingBottom: 'calc\(6\.5rem/);
  });
});
