import { describe,it,expect } from 'vitest';
import { buttonCls } from '@/components/ui';
import { contrastRatio, NAV_ACCENTS } from '../nav-accent';
describe('Clinical action hierarchy contract',()=>{
 // P1 · RODADA 2 — "drastically reduce border on secondary/ghost/icon buttons".
 // O contrato antigo (contorno na cor da marca em REPOUSO) virou o defeito: a
 // borda cheia competia com o CTA primário em toda toolbar. O novo contrato:
 // repouso SEM contorno visível (border transparente mantém a métrica da caixa)
 // e o ESTADO dá o contorno — preenchimento suave da família no hover/active.
 it('secondary is contour-free at rest and soft-filled on hover/active',()=>{
  const cls=buttonCls('secondary','sm');
  expect(cls.split(' ')).toContain('bg-transparent');
  expect(cls).toContain('text-[var(--brand-fg)]');
  expect(cls).toContain('border-transparent');
  expect(cls).not.toContain('border-[var(--brand)]');
  expect(cls.split(' ')).toContain('hover:bg-[var(--brand-soft)]');
  expect(cls.split(' ')).toContain('active:bg-[var(--brand-soft)]');
  expect(cls).not.toContain('hover:border-');
 });
 it('primary remains solid and WhatsApp does not inherit brand',()=>{
  expect(buttonCls('primary')).toContain('bg-[var(--accent)]');
  const wa=buttonCls('whatsapp');expect(wa).toContain('bg-emerald-50');expect(wa).toContain('border-emerald-300');expect(wa).toContain('text-emerald-800');expect(wa).not.toMatch(/brand|accent/);
  expect(buttonCls('ghost')).toContain('bg-transparent');
 });
 it.each(['azul-profundo','verde-equilibrado'])('AA on secondary soft background: %s',id=>{
  const t=NAV_ACCENTS.find(x=>x.id===id)!;
  expect(contrastRatio(t.vars['--accent-fg'],t.vars['--accent-soft'])).toBeGreaterThanOrEqual(4.5);
 });
});
