// DS 2.0 · CP2 — contrato do rail recolhido (60px): alvo 44×44 centrado,
// sem separadores nem borda de rodapé. Fonte: Blueprint (rail 60px; item 44×44/radius10).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('src/app/globals.css', 'utf8');

describe('CP2 — rail recolhido', () => {
  const start = CSS.indexOf('DS 2.0 · CP2 — rail recolhido');
  const block = CSS.slice(start, CSS.indexOf('.workspace-foot__item {', start));
  it('item do rail recolhido é 44×44 centrado', () => {
    expect(block).toMatch(/\.workspace-sidebar:not\(\.is-expanded\) \.workspace-link \{\s*width: 44px; height: 44px;/);
    expect(block).toMatch(/margin: 0 auto;/);
  });
  it('sem traços entre grupos e sem borda no rodapé no modo recolhido', () => {
    expect(block).toMatch(/\.workspace-sidebar:not\(\.is-expanded\) \.workspace-section__rule \{ display: none; \}/);
    expect(block).toMatch(/\.workspace-sidebar:not\(\.is-expanded\) \.workspace-foot \{ border-top: 0; \}/);
  });
  it('rail expandido não é alterado pelo bloco (escopo :not(.is-expanded))', () => {
    const rules = block.split('\n').filter((l) => l.includes('.workspace-sidebar'));
    rules.forEach((l) => expect(l).toContain(':not(.is-expanded)'));
  });
});
