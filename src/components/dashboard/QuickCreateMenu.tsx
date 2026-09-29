'use client';
// ═══════════════════════════════════════════════════════════════
// QUICK CREATE GLOBAL (missão 6) — o “+” volta ao topo
// ═══════════════════════════════════════════════════════════════
// Ação global de criação rápida: um botão “+” premium na topbar abre um
// popover com atalhos úteis. É ATALHO de produto, não a ação principal da
// tela (essa continua vivendo na própria página). Só navega para deep links
// ?novo=1 que já existem — nenhuma lógica nova de negócio.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { ViewportPopover } from './ViewportPopover';

interface QuickItem {
  href: string;
  icon: 'calendar' | 'users' | 'paw' | 'tasks' | 'wallet';
  title: string;
  desc: string;
  /** Rota base exigida em `canCreate` para o item aparecer. */
  requires: string;
  /** Caminho do deep link (query string montada com b=…). */
  go: (b: string) => string;
}

const QUICK_ITEMS: QuickItem[] = [
  {
    href: '/agenda', requires: '/agenda', icon: 'calendar',
    title: 'Novo agendamento', desc: 'Reserva rápida na agenda',
    go: (b) => `/agenda?b=${b}&novo=1`,
  },
  {
    href: '/clientes', requires: '/clientes', icon: 'users',
    title: 'Novo cliente', desc: 'Cadastro de contato',
    go: (b) => `/clientes?b=${b}&novo=1`,
  },
  {
    href: '/clientes-pet', requires: '/clientes', icon: 'paw',
    title: 'Novo tutor e pet', desc: 'O pet entra como paciente',
    go: (b) => `/clientes?b=${b}&novo=1`,
    // Item de clínica veterinária: mesmo formulário (tutor + pet).
  },
  {
    href: '/tarefas', requires: '/tarefas', icon: 'tasks',
    title: 'Nova pendência', desc: 'Cobrança para a equipe',
    go: (b) => `/tarefas?b=${b}`,
  },
  {
    href: '/financeiro', requires: '/financeiro', icon: 'wallet',
    title: 'Novo recebimento', desc: 'Lançar entrada no caixa',
    go: (b) => `/financeiro?b=${b}&novo=1`,
  },
];

export function QuickCreateMenu({ canCreate, businessId, vet = false }: {
  /** Hrefs permitidos ao usuário (contrato existente do shell). */
  canCreate: string[];
  businessId: string;
  /** Clínica veterinária: oferece o atalho do pet. */
  vet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrap.current?.contains(target) && !popover.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items = QUICK_ITEMS.filter((i) =>
    canCreate.includes(i.requires) && (vet || i.icon !== 'paw'),
  );
  if (!items.length) return null;

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        className="ws-quickcreate-btn"
        aria-label="Criar rápido"
        title="Criar rápido"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="quick-create-btn"
        onClick={(event) => {
          if (open) setOpen(false);
          else { setAnchor(event.currentTarget); setOpen(true); }
        }}
      >
        <Icon n="plus" size={19} />
      </button>
      <ViewportPopover
        open={open}
        anchor={anchor}
        className="ws-pop ws-quickcreate-pop"
        role="menu"
        ariaLabel="Criar rápido"
        panelRef={popover}
      >
        <p className="ws-pop__label">Criar rápido</p>
        {items.map((i) => (
          <button
            key={i.href}
            type="button"
            role="menuitem"
            className="ws-quickcreate-item"
            data-testid="quick-create-item"
            onClick={() => {
              setOpen(false);
              router.push(i.go(businessId));
            }}
          >
            <span className="ws-quickcreate-item__icon" aria-hidden="true">
              <Icon n={i.icon} size={16} />
            </span>
            <span>
              <span className="ws-quickcreate-item__title">{i.title}</span>
              <span className="ws-quickcreate-item__desc">{i.desc}</span>
            </span>
          </button>
        ))}
      </ViewportPopover>
    </div>
  );
}
