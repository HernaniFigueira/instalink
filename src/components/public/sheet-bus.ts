'use client';
import { useEffect, useState } from 'react';

// ── Bottom-sheet global da página pública ────────────────────
// Pilha de sheets: o login pode abrir SOBRE o carrinho/agendamento
// sem destruir o formulário de baixo. Sem imports de outros
// componentes (evita ciclo: widgets ↔ customer).
export type SheetType = 'products' | 'booking' | 'quote' | 'auth' | 'account' | 'review' | 'phone';

export interface SheetState {
  type: SheetType;
  props: {
    title?: string;
    serviceId?: string;
    rescheduleId?: string;
    businessId?: string;
    businessName?: string;
    googleUrl?: string;
    kind?: 'order' | 'booking';
    refId?: string;
  };
}

type Listener = (stack: SheetState[]) => void;
type AuthListener = () => void;

let stack: SheetState[] = [];
const listeners = new Set<Listener>();
const authListeners = new Set<AuthListener>();

function emit() {
  for (const fn of listeners) fn([...stack]);
}

export function openSheet(type: SheetType, props: SheetState['props'] = {}) {
  const top = stack[stack.length - 1];
  if (top && top.type === type) {
    stack[stack.length - 1] = { type, props };
  } else {
    stack = [...stack, { type, props }].slice(-3);
  }
  emit();
}

export function closeSheet() {
  if (stack.length === 0) return;
  stack = stack.slice(0, -1);
  emit();
}

export function onSheetChange(fn: Listener): () => void {
  listeners.add(fn);
  fn([...stack]);
  return () => {
    listeners.delete(fn);
  };
}

/** Disparado após login/cadastro com sucesso (para retomar ações). */
export function notifyAuthOk() {
  for (const fn of authListeners) {
    try {
      fn();
    } catch {
      /* noop */
    }
  }
}

export function onAuthOk(fn: AuthListener): () => void {
  authListeners.add(fn);
  return () => {
    authListeners.delete(fn);
  };
}

/** Link "adicionar ao Google Agenda" (sem backend, horário local). */
export function gcalLink(opts: { title: string; date: string; time: string; durationMin: number; details?: string; location?: string }): string {
  const [h, m] = opts.time.split(':').map(Number);
  const endMin = h * 60 + m + Math.max(15, opts.durationMin || 30);
  const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  const day = opts.date.replace(/-/g, '');
  const dates = `${day}T${opts.time.replace(':', '')}00/${day}T${end.replace(':', '')}00`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: opts.title, dates });
  if (opts.details) params.set('details', opts.details);
  if (opts.location) params.set('location', opts.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Garante consumidor logado. Se não, abre o sheet de login e retorna false. */
export async function ensureCustomer(): Promise<boolean> {
  try {
    const res = await fetch('/api/customer/me');
    if (res.ok) return true;
  } catch {
    /* offline = trata como deslogado */
  }
  openSheet('auth', {});
  return false;
}

/** Pré-preenche nome/telefone de quem está logado (atualiza após login). */
export function useCustomerPrefill(): { name: string; phone: string } {
  const [data, setData] = useState({ name: '', phone: '' });

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      fetch('/api/customer/me')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d?.customer) setData({ name: d.customer.name || '', phone: d.customer.phone || '' });
        })
        .catch(() => {});
    };
    refresh();
    const off = onAuthOk(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return data;
}
