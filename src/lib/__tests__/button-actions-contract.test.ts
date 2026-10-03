import { describe,it,expect } from 'vitest';
import { buttonCls } from '@/components/ui';
import { contrastRatio, NAV_ACCENTS } from '../nav-accent';
describe('Clinical action hierarchy contract',()=>{
 it('secondary is filled and outlined before hover; hover keeps the border',()=>{
  const cls=buttonCls('secondary','sm');
  expect(cls).toContain('bg-[var(--brand-soft)]');expect(cls).toContain('border-[var(--brand)]');expect(cls).toContain('text-[var(--brand-fg)]');
  expect(cls).toContain('hover:bg-transparent');expect(cls).not.toContain('border-transparent');expect(cls).not.toContain('hover:border-');
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
