'use client';
import { useEffect, useState } from 'react';
import { NAV_ACCENTS, CURATED_NAV_ACCENT_LABELS, contrastRatio, getNavAccent, setNavAccent, type NavAccentId } from '@/lib/nav-accent';

export function ShellAppearance() {
  const [accent, setAccent] = useState<NavAccentId>('azul-clinico');
  useEffect(() => { setAccent(getNavAccent()); }, []);
  const selected = NAV_ACCENTS.find((x) => x.id === accent) || NAV_ACCENTS[0];
  const navVars = selected.vars;
  // DS 1.0 §13 — a estrutura da navegação é BRANCA e fixa; o tema escolhe a
  // COR DE ACENTO. O contraste garantido é o do par que o acento realmente
  // pinta: texto do acento sobre o fundo suave do acento (item ativo).
  const aa = contrastRatio(navVars['--il-nav-active-fg'], navVars['--il-nav-active']);
  return (
    <section className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-4 space-y-3" data-testid="shell-appearance">
      <div>
        <h3 className="font-semibold text-sm text-[var(--text)]">Aparência da interface</h3>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Escolha a cor de acento das ações principais neste navegador.
          Esta preferência vale somente para você neste navegador e não altera a identidade visual da clínica para outros usuários.
        </p>
      </div>
      <div role="group" aria-label="Cor de acento" className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-[var(--text-muted)]">Cores de acento</p>
            <div className="flex flex-wrap gap-2.5">
              {NAV_ACCENTS.filter((a) => Object.hasOwn(CURATED_NAV_ACCENT_LABELS, a.id)).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={accent === a.id}
                  data-testid={`nav-accent-${a.id}`}
                  onClick={() => { setAccent(a.id); setNavAccent(a.id); }}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors"
                  style={{
                    borderColor: accent === a.id ? 'var(--brand)' : 'var(--border)',
                    boxShadow: accent === a.id ? '0 0 0 1px var(--brand)' : 'none',
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-5 w-5 rounded-full border border-black/10"
                    style={{ background: a.swatch }}
                  />
                  {CURATED_NAV_ACCENT_LABELS[a.id] || a.label}
                </button>
              ))}
            </div>
          </div>
      </div>
      <div
        data-testid="nav-accent-preview"
        className="flex h-28 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]"
        style={{ background: 'var(--bg)' }}
      >
        {/* Sidebar BRANCA e fixa (§13): o acento aparece só no ITEM ATIVO. */}
        <div
          className="w-28 p-2.5 flex flex-col gap-1.5"
          style={{ background: 'var(--gd-nav-bg)' }}
        >
          <div className="h-3 w-14 rounded" style={{ background: 'var(--gd-nav-fg)', opacity: 0.9 }} />
          <div className="h-4 rounded" style={{ background: navVars['--il-nav-active'] }} />
          <div className="mt-1 h-4 w-4/5 rounded" style={{ background: 'var(--gd-nav-muted)', opacity: 0.45 }} />
          <div className="h-4 w-3/5 rounded" style={{ background: 'var(--gd-nav-muted)', opacity: 0.3 }} />
        </div>
        <div className="flex-1">
          <div className="h-8 border-b border-[var(--border)]" style={{ background: 'var(--surface)' }} />
          <div className="space-y-2 p-2.5">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded" style={{ background: navVars['--accent-soft'], border: `1px solid ${navVars['--accent-border']}` }} />
              <div className="h-3 w-2/5 rounded" style={{ background: 'var(--text)' }} />
            </div>
            <div className="h-3 w-3/5 rounded bg-[var(--surface-3)]" />
            <div className="flex items-center gap-1.5 pt-0.5">
              <div
                className="h-5 w-16 rounded"
                style={{ background: navVars['--accent'], color: navVars['--accent-contrast'] }}
              />
              <div className="h-5 w-12 rounded border border-[var(--border)] bg-[var(--surface)]" />
            </div>
          </div>
        </div>
      </div>
      <p className="text-[11px] flex items-center gap-2 text-[var(--text-muted)]">
        <span className="inline-flex items-center rounded-full bg-[var(--success-bg)] border border-[var(--success-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success-fg)]">
          Contraste AA {aa.toFixed(1)}:1
        </span>
        {CURATED_NAV_ACCENT_LABELS[selected.id] || selected.label} · a escolha vale só para você neste navegador; as demais pessoas veem o padrão do produto.
      </p>
    </section>
  );
}
