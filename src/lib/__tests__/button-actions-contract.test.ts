import { describe, it, expect } from 'vitest';
import { buttonCls } from '@/components/ui';

describe('Clinical action hierarchy contract', () => {
  // Secondary and ghost controls are actions, not links. The only accent in a
  // control row is the primary CTA (or a real `link` variant).
  it('secondary is neutral and contour-free at rest, with a neutral hover surface', () => {
    const cls = buttonCls('secondary', 'sm');
    expect(cls.split(' ')).toContain('bg-transparent');
    expect(cls).toContain('text-[var(--text)]');
    expect(cls).toContain('border-transparent');
    expect(cls).not.toContain('border-[var(--brand)]');
    expect(cls).not.toMatch(/brand-fg|brand-soft|accent/);
    expect(cls.split(' ')).toContain('hover:bg-[var(--surface-3)]');
    expect(cls.split(' ')).toContain('active:bg-[var(--surface-3)]');
    expect(cls).not.toContain('hover:border-');
  });

  it('primary remains accented, ghost remains neutral, and WhatsApp stays semantic', () => {
    expect(buttonCls('primary')).toContain('bg-[var(--accent)]');
    expect(buttonCls('ghost')).toContain('bg-transparent');
    expect(buttonCls('ghost')).toContain('text-[var(--text-muted)]');
    const wa = buttonCls('whatsapp');
    expect(wa).toContain('bg-emerald-50');
    expect(wa).toContain('border-emerald-300');
    expect(wa).toContain('text-emerald-800');
    expect(wa).not.toMatch(/brand|accent/);
  });
});
