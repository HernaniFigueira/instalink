'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureCustomer, onAuthOk, openSheet } from './sheet-bus';

// Lógica única de identidade para BookingIsland, CartDrawer e QuoteIsland.
// Regra absoluta: a conta SIMPLIFICA — se o sistema já sabe nome/telefone,
// usa automaticamente e NÃO pergunta de novo.
export interface CustomerForm {
  customer: { name: string; phone: string; email: string } | null;
  logged: boolean;
  loading: boolean;
  name: string;
  phone: string;
  setName: (v: string) => void;
  setPhone: (v: string) => void;
  // Garante login (+ telefone quando required). Abre o sheet certo e
  // retorna false para o chamador aguardar o login (via afterAuth).
  ensure: (opts?: { phone?: boolean }) => Promise<boolean>;
  // Agenda fn para rodar após o próximo login/cadastro/telefone.
  afterAuth: (fn: () => void) => void;
}

export function useCustomerForm(): CustomerForm {
  const [customer, setCustomer] = useState<CustomerForm['customer']>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const autoSent = useRef(false);

  const refresh = useCallback(() => {
    fetch('/api/customer/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const c = d?.customer;
        if (c) {
          setCustomer({ name: c.name || '', phone: c.phone || '', email: c.email || '' });
          setName((v) => v || c.name || '');
          setPhone((v) => v || c.phone || '');
        } else {
          setCustomer(null);
        }
      })
      .catch(() => setCustomer(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const off = onAuthOk(refresh);
    const changed = () => refresh();
    window.addEventListener('il:auth-changed', changed);
    return () => {
      off();
      window.removeEventListener('il:auth-changed', changed);
    };
  }, [refresh]);

  const afterAuth = useCallback((fn: () => void) => {
    if (autoSent.current) return;
    autoSent.current = true;
    const off = onAuthOk(() => {
      off();
      autoSent.current = false;
      fn();
    });
  }, []);

  const ensure = useCallback(async (opts?: { phone?: boolean }): Promise<boolean> => {
    if (!(await ensureCustomer())) {
      return false; // sheet de login aberto; chamador usa afterAuth
    }
    if (opts?.phone) {
      try {
        const r = await fetch('/api/customer/me');
        const d = r.ok ? await r.json() : null;
        const digits = String(d?.customer?.phone || '').replace(/\D/g, '');
        if (digits.length < 10) {
          openSheet('phone', {});
          return false; // sheet de telefone aberto; chamador usa afterAuth
        }
      } catch {
        return false;
      }
    }
    return true;
  }, []);

  return {
    customer, logged: !!customer, loading,
    name, phone, setName, setPhone, ensure, afterAuth,
  };
}
