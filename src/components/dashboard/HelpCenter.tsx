'use client';
// ═══════════════════════════════════════════════════════════════
// AJUDA E SUPORTE — GoDoutor 2.0 (§18)
// ═══════════════════════════════════════════════════════════════
// Uma central de ajuda HONESTA e pequena: nada de link morto nem de página
// vazia com cara de produto pronto. O que existe aqui:
//
//   • PRIMEIROS PASSOS  → os próximos passos REAIS da conta (checklist do
//                        /api/overview, o mesmo da Visão geral);
//   • CAMINHOS RÁPIDOS  → atalhos para as tarefas que mais geram dúvida
//                        (agenda, profissional, WhatsApp, página, equipe),
//                        filtrados pelo que ESTE usuário pode acessar;
//   • FALAR COM SUPORTE → abre a conversa com o time da plataforma pelo
//                        WhatsApp oficial (mesmo canal do suporte comercial).
//
// Cada item navega para uma tela que EXISTE (vinda do catálogo `nav.allowed`),
// então a ajuda nunca manda o usuário para um 403.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Drawer } from '@/components/ui';
import { apiGet } from '@/lib/api-client';
import type { panelNavigation } from '@/lib/panel';

type Nav = ReturnType<typeof panelNavigation>;

/** Suporte da plataforma (GoDoutor). Um só lugar decide o canal. */
export const SUPPORT_WHATSAPP = '5511999990000';

interface ChecklistItem { done: boolean; label: string; href: string }

const PATHS: Array<{ href: string; icon: string; title: string; hint: string }> = [
  { href: '/agenda', icon: 'calendar', title: 'Configurar a agenda', hint: 'Horários, duração e regras de reserva.' },
  { href: '/profissionais', icon: 'idcard', title: 'Adicionar profissional', hint: 'Quem atende, com quais serviços e agenda própria.' },
  { href: '/canais', icon: 'whatsapp', title: 'Conectar o WhatsApp', hint: 'Receber e responder pela plataforma.' },
  { href: '/pagina', icon: 'link', title: 'Configurar a página', hint: 'Serviços, fotos, avaliações e publicação.' },
  { href: '/equipe', icon: 'shield', title: 'Convidar a equipe', hint: 'Logins, papéis e permissões de cada pessoa.' },
  { href: '/financeiro', icon: 'wallet', title: 'Registrar recebimentos', hint: 'O que entrou, o que está pendente e o que sai.' },
];

export function HelpCenter({ open, onClose, query, nav, businessId }: {
  open: boolean;
  onClose: () => void;
  /** Query string com a unidade ativa (`?b=…`), para os atalhos não perderem contexto. */
  query: string;
  nav: Nav;
  businessId: string;
}) {
  const [q, setQ] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  useEffect(() => {
    if (!open || !businessId) return;
    let on = true;
    apiGet<{ checklist?: ChecklistItem[] }>(`/api/overview?businessId=${businessId}&period=7`)
      .then((r) => { if (on && r.ok) setChecklist((r.data?.checklist || []).filter((c) => !c.done)); })
      .catch(() => { /* ajuda não pode quebrar a tela */ });
    return () => { on = false; };
  }, [open, businessId]);

  // Só aparece caminho que o usuário ALCANÇA (fonte: o catálogo autorizado).
  const allowed = useMemo(() => new Set(nav.allowed.map((r) => r.href)), [nav.allowed]);
  const paths = useMemo(() => {
    const term = q.trim().toLowerCase();
    return PATHS
      .filter((p) => allowed.has(p.href))
      .filter((p) => !term || `${p.title} ${p.hint}`.toLowerCase().includes(term));
  }, [allowed, q]);

  const steps = useMemo(() => {
    const term = q.trim().toLowerCase();
    return checklist.filter((c) => !term || c.label.toLowerCase().includes(term));
  }, [checklist, q]);

  const href = (path: string) => `${path}${path.includes('?') ? '&' : '?'}b=${businessId}`;

  return (
    <Drawer open={open} onClose={onClose} title="Ajuda e suporte" subtitle="Primeiros passos e caminhos rápidos"
      width="max-w-[520px]">
      <div className="p-4 space-y-5">
        <div className="relative">
          <Icon n="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar ajuda…"
            aria-label="Buscar ajuda"
            className="w-full h-[var(--control-h)] pl-9 pr-3 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-white text-[13.5px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus-visible:border-[var(--brand)]"
          />
        </div>

        {steps.length > 0 && (
          <section aria-labelledby="ajuda-passos">
            <h3 id="ajuda-passos" className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              Primeiros passos
            </h3>
            <ul className="space-y-1.5">
              {steps.map((c) => (
                <li key={c.href + c.label}>
                  <Link href={href(c.href)} onClick={onClose}
                    className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand)]" aria-hidden="true" />
                    <span className="flex-1">{c.label}</span>
                    <Icon n="chevronRight" size={14} className="text-[var(--text-faint)]" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="ajuda-caminhos">
          <h3 id="ajuda-caminhos" className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Caminhos rápidos
          </h3>
          {paths.length === 0 ? (
            <p className="text-[13px] text-[var(--text-secondary)]">
              Nada encontrado para “{q}”. Fale com o suporte que a gente resolve junto.
            </p>
          ) : (
            <ul className="space-y-1">
              {paths.map((p) => (
                <li key={p.href}>
                  <Link href={href(p.href)} onClick={onClose}
                    className="flex items-start gap-3 rounded-[var(--radius-md)] px-3 py-2.5 hover:bg-[var(--surface-hover)]">
                    <Icon n={p.icon} size={17} className="mt-0.5 text-[var(--brand-fg)]" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-[var(--text-primary)]">{p.title}</span>
                      <span className="block text-[12px] text-[var(--text-secondary)]">{p.hint}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-subtle)] p-3.5">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Falar com o suporte</h3>
          <p className="text-[12px] text-[var(--text-secondary)] mt-1">
            Atendimento humano pelo WhatsApp, de segunda a sexta, 9h às 18h.
          </p>
          <a
            href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noreferrer"
            className="mt-2.5 inline-flex items-center gap-2 h-[var(--control-h-sm)] px-3 rounded-[var(--radius-sm)] bg-[var(--brand)] text-white text-[13px] font-semibold hover:bg-[var(--brand-strong)]"
          >
            <Icon n="whatsapp" size={15} /> Abrir conversa
          </a>
        </section>
      </div>
    </Drawer>
  );
}
