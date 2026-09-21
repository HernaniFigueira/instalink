'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { wrapDialogFocus } from '@/lib/dialog-focus';
import Link from 'next/link';
import type { Business, PublicBusiness, Professional, Service } from '@/lib/types';
import { saveCustomerToken, clearCustomerToken } from '@/lib/client-auth';
import { openSheet, closeSheet, onSheetChange, notifyAuthOk, scopeSheets, ensureCustomer, onAuthOk, gcalLink, type SheetState } from './sheet-bus';
import { BOOKING_STATUS, ORDER_STATUS } from '@/lib/status';
import { todayISO, humanDateTime, nowHM, effectiveTimezone } from '@/lib/tz';
import type { BookingStatus, OrderStatus } from '@/lib/types';
import { Icon } from '@/components/icons';
import { requestedCtaTarget, resolveCtaTarget } from '@/lib/cta';
import { allowedCtaTargets } from '@/lib/features';
import { money, waLink } from './widgets';
import { BookingIsland, QuoteIsland } from './widgets2';

// ── Sheet genérico (bottom sheet mobile-first) ───────────────
export function SheetShell({ title, onClose, zIndex, children }: { title: string; onClose: () => void; zIndex?: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal(); heading.current?.focus({ preventScroll: true });
    return () => { dialog.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return (
    <dialog ref={ref} className="il-customer-dialog fixed inset-0 flex items-end sm:items-center justify-center" style={{ zIndex: zIndex || 50 }} aria-modal="true" aria-labelledby={id}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onKeyDown={event => { wrapDialogFocus(event, event.currentTarget, heading.current); if (event.key === 'Escape') { event.stopPropagation(); if (!event.defaultPrevented) { event.preventDefault(); onClose(); } } }}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="il-page relative w-full sm:max-w-md max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden" style={{ background: 'var(--il-bg)' }}>
        <div className="pt-2.5 pb-1 flex justify-center shrink-0" aria-hidden="true">
          <span className="w-10 h-1.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--il-muted) 35%, transparent)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pb-3 shrink-0">
          <h3 id={id} ref={heading} tabIndex={-1} className="text-lg font-extrabold">{title}</h3>
          <button onClick={onClose} aria-label="Fechar" className="il-card w-9 h-9 font-bold shrink-0 flex items-center justify-center"><Icon n="x" size={16} /></button>
        </div>
        <div className="overflow-y-auto px-5 pb-6">{children}</div>
      </div>
    </dialog>
  );
}

// ── Host único: escuta openSheet e renderiza o conteúdo ──────
// CATÁLOGO/CARRINHO SAÍRAM DA EXPERIÊNCIA: o sheet 'products' legado agora
// apenas fecha e rola até a VITRINE inline (#produtos). Produtos convertem
// pelo WhatsApp do negócio (CTA "Tenho interesse") — nenhum pedido interno
// é criado a partir da vitrine. Componentes antigos de carrinho permanecem
// no código apenas como legado isolado (dados/páginas antigas não quebram).
export function SheetHost({ business, services, professionals }: {
  business: PublicBusiness;
  services: Service[];
  professionals: Professional[];
}) {
  const [stack, setStack] = useState<SheetState[]>([]);

  useEffect(() => { scopeSheets(business.id); return onSheetChange(setStack); }, [business.id]);
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get('conta') !== '1') return;
    let alive = true;
    const showAccount = () => { if (alive) { off(); openSheet('account'); } };
    const off = onAuthOk(showAccount);
    ensureCustomer().then(ok => { if (ok) showAccount(); });
    return () => { alive = false; off(); };
  }, [business.id]);


  useEffect(() => {
    document.body.style.overflow = stack.length > 0 ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [stack.length]);

  useEffect(() => {
    // 'products' legado → vitrine na própria página (sem sheet de carrinho).
    for (const s of stack) {
      if (s.type === 'products') {
        closeSheet();
        document.getElementById('produtos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [stack]);

  if (stack.length === 0) return null;

  return (
    <>
      {stack.map((sheet, i) => {
        const titles: Record<SheetState['type'], string> = {
          products: 'Vitrine',
          booking: sheet.props.title || (sheet.props.rescheduleId ? 'Remarcar consulta' : 'Agendar'),
          quote: sheet.props.title || 'Orçamento',
          auth: 'Entrar',
          account: 'Minha conta',
          review: 'Avaliar experiência',
          phone: 'Seu WhatsApp',
        };
        return (
          <SheetShell key={`${i}-${sheet.type}-${sheet.props.serviceId || ''}`} title={titles[sheet.type]} onClose={closeSheet} zIndex={50 + i}>
            {sheet.type === 'booking' && (
              <BookingIsland
                business={business} services={services} professionals={professionals}
                title="" initialServiceId={sheet.props.serviceId || ''} initialDate={sheet.props.initialDate} currentTime={sheet.props.currentTime} rescheduleId={sheet.props.rescheduleId} bare
              />
            )}
            {sheet.type === 'quote' && <QuoteIsland businessId={business.id} title="" bare />}
            {sheet.type === 'auth' && <CustomerAuthSheet business={business} />}
            {sheet.type === 'account' && <CustomerAccountSheet business={business} />}
            {sheet.type === 'phone' && <PhoneSheet />}
            {sheet.type === 'review' && sheet.props.businessId && sheet.props.kind && sheet.props.refId && (
              <ReviewSheet
                businessId={sheet.props.businessId}
                businessName={sheet.props.businessName || business.name}
                googleUrl={sheet.props.googleUrl || ''}
                kind={sheet.props.kind}
                refId={sheet.props.refId}
              />
            )}
          </SheetShell>
        );
      })}
    </>
  );
}

export function CustomerAuthSheet({ business }: { business: PublicBusiness }) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function done(token: string) {
    saveCustomerToken(token);
    notifyAuthOk();
    closeSheet();
  }

  async function submitLogin() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/customer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password, businessId: business.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      done(data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitRegister() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/customer/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, password, businessId: business.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'exists') {
          setTab('login');
          setLogin(phone || email);
          throw new Error(data.error);
        }
        throw new Error(data.error);
      }
      done(data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function googleLogin() {
    setError('');
    const popup = window.open(`/api/auth/google?slug=${business.slug}`, 'il-google', 'width=480,height=680');
    if (!popup) {
      setError('Permita popups para entrar com Google.');
      return;
    }
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as any;
      if (d?.type === 'il-google' && d.token) {
        window.removeEventListener('message', handler);
        done(d.token);
      }
    };
    window.addEventListener('message', handler);
  }

  const input = 'il-card w-full text-sm px-4 py-3 outline-none';

  return (
    <div>
      <p className="il-muted text-sm -mt-1 mb-4 flex items-center gap-2"><Icon n="shield" size={18} /> Acesso do paciente · {business.name}. Suas escolhas de agendamento serão mantidas.</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button onClick={() => { setTab('login'); setError(''); }}
          className={`font-bold text-sm py-2.5 border ${tab === 'login' ? 'il-chip-active border-transparent' : 'il-card'}`}
          style={{ borderRadius: 'var(--il-radius)' }}>
          Entrar
        </button>
        <button onClick={() => { setTab('register'); setError(''); }}
          className={`font-bold text-sm py-2.5 border ${tab === 'register' ? 'il-chip-active border-transparent' : 'il-card'}`}
          style={{ borderRadius: 'var(--il-radius)' }}>
          Criar conta
        </button>
      </div>

      {tab === 'login' ? (
        <div className="space-y-2.5">
          <input value={login} onChange={(e) => setLogin(e.target.value)} aria-label="WhatsApp ou e-mail" placeholder="WhatsApp ou e-mail" autoComplete="username" className={input} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" aria-label="Senha" placeholder="Senha" autoComplete="current-password"
            onKeyDown={(e) => { if (e.key === 'Enter') submitLogin(); }} className={input} />
          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          <button onClick={submitLogin} disabled={loading} className="il-btn w-full font-extrabold py-3.5 disabled:opacity-50">
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
          {/* A1.2 · Bloco 3: navegação interna via Link (sem recarregar a app). */}
          <Link href="/recuperar?kind=customer" className="block text-center text-sm font-bold il-muted hover:underline pt-1">Esqueci minha senha</Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Seu nome" placeholder="Seu nome *" autoComplete="name" className={input} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="WhatsApp" placeholder="WhatsApp *" inputMode="tel" autoComplete="tel" className={input} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail (opcional)" placeholder="E-mail (opcional)" inputMode="email" autoComplete="email" className={input} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" aria-label="Crie uma senha" placeholder="Crie uma senha *" autoComplete="new-password" className={input} />
          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          <button onClick={submitRegister} disabled={loading} className="il-btn w-full font-extrabold py-3.5 disabled:opacity-50">
            {loading ? 'Criando…' : 'Criar conta'}
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 my-4">
        <span className="flex-1 h-px" style={{ background: 'color-mix(in srgb, var(--il-muted) 30%, transparent)' }} />
        <span className="il-muted text-xs font-bold">OU</span>
        <span className="flex-1 h-px" style={{ background: 'color-mix(in srgb, var(--il-muted) 30%, transparent)' }} />
      </div>
      <button onClick={googleLogin} className="il-card w-full font-bold py-3 flex items-center justify-center gap-2 text-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.1.1 3.5 2.7.2.1c2.2-2 3.8-5 3.8-8.7z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.2 0-5.9-2.1-6.8-5l-.1.1-3.6 2.8v.1C3.5 21.3 7.5 24 12 24z" />
          <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-.1-.1-3.5-2.7-.1.1C.5 8.7 0 10.3 0 12s.5 3.3 1.5 4.8l3.7-2.4z" />
          <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.5 0 3.5 2.7 1.5 6.6l3.7 2.9c.9-2.9 3.6-4.8 6.8-4.8z" />
        </svg>
        Continuar com Google
      </button>
    </div>
  );
}

// ── Minha conta: pedidos + agendamentos ──────────────────────


export function CustomerAccountSheet({ business }: { business: PublicBusiness }) {
  // "Pedidos" só existe como LEGADO: empresas que ainda recebem pedidos pelo
  // módulo antigo. A vitrine de produtos nunca gera pedido — logo, produtos
  // sozinhos não abrem a aba de pedidos.
  const [tab, setTab] = useState<'orders' | 'bookings'>(
    business.modes.includes('orders') ? 'orders' : 'bookings',
  );
  const [bookingView, setBookingView] = useState<'upcoming' | 'history'>('upcoming');
  const [loadError, setLoadError] = useState('');
  const [orders, setOrders] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [reviewed, setReviewed] = useState<{ orderIds: string[]; bookingIds: string[] }>({ orderIds: [], bookingIds: [] });
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [cancelMin, setCancelMin] = useState(120);
  const [confirmCancel, setConfirmCancel] = useState('');
  const [actionError, setActionError] = useState('');

  function load() {
    setLoading(true); setLoadError('');
    Promise.all([
      fetch(`/api/customer/orders?businessId=${business.id}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Não foi possível carregar seus pedidos.')))),
      fetch(`/api/customer/bookings?businessId=${business.id}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Não foi possível carregar suas consultas.')))),
      fetch(`/api/reviews?businessId=${business.id}&mine=1`).then((r) => (r.ok ? r.json() : { orderIds: [], bookingIds: [] })),
    ])
      .then(([o, b, r]) => {
        setOrders(o.orders || []);
        setBookings(b.bookings || []);
        setCancelMin(typeof b.cancelUntilMin === 'number' ? b.cancelUntilMin : 120);
        setReviewed({ orderIds: r.orderIds || [], bookingIds: r.bookingIds || [] });
        try {
          const key = `il-rv-${business.id}`;
          if (!sessionStorage.getItem(key)) {
            const rO = new Set<string>(r.orderIds || []);
            const rB = new Set<string>(r.bookingIds || []);
            const t = new Date().toISOString().slice(0, 10);
            const pO = (o.orders || []).find((x: any) => ['ready', 'completed'].includes(x.status) && !rO.has(x.id));
            const pB = !pO && (b.bookings || []).find((x: any) => x.status !== 'cancelled' && (x.status === 'completed' || x.date < t) && !rB.has(x.id));
            if (pO || pB) {
              sessionStorage.setItem(key, '1');
              const kind = pO ? 'order' : 'booking';
              const refId = pO ? pO.id : pB.id;
              setTimeout(() => openSheet('review', {
                businessId: business.id, businessName: business.name,
                googleUrl: business.googleUrl || '', kind, refId,
              }), 600);
            }
          }
        } catch { /* sem storage: sem auto-convite */ }
      })
      .catch(e => setLoadError(e.message || 'Falha de conexão. Tente novamente.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const changed = () => load();
    const bookingsChanged = (e: Event) => { if ((e as CustomEvent).detail?.businessId === business.id) load(); };
    window.addEventListener('il:reviews-changed', changed);
    window.addEventListener('il:bookings-changed', bookingsChanged);
    return () => { window.removeEventListener('il:reviews-changed', changed); window.removeEventListener('il:bookings-changed', bookingsChanged); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id]);

  async function cancelBooking(id: string) {
    setActionError('');
    setActing(id);
    try {
      const res = await fetch('/api/customer/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfirmCancel('');
      load();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActing('');
    }
  }

  function reschedule(b: any) {
    openSheet('booking', { serviceId: b.serviceId, rescheduleId: b.id, initialDate:b.date, currentTime:b.time });
  }

  async function logout() {
    try {
      await fetch('/api/customer/logout', { method: 'POST' });
    } catch {
      /* sai localmente de qualquer forma */
    }
    clearCustomerToken();
    window.dispatchEvent(new CustomEvent('il:auth-changed'));
    closeSheet();
  }

  const showOrders = business.modes.includes('orders');
  const showBookings = business.modes.includes('bookings');
  const today = todayISO(new Date(), effectiveTimezone(business.businessTimezone));
  const upcoming = (b: any) => ['pending', 'confirmed'].includes(b.status) && (b.date > today || (b.date === today && b.time >= nowHM(new Date(), effectiveTimezone(business.businessTimezone))));
  const shownBookings = bookings.filter(b => bookingView === 'upcoming' ? upcoming(b) : !upcoming(b)).sort((a,b) => bookingView === 'upcoming' ? (a.date+a.time).localeCompare(b.date+b.time) : (b.date+b.time).localeCompare(a.date+a.time));
  const canReviewBooking = (b: any) =>
    b.status !== 'cancelled' && (b.status === 'completed' || b.date < today) && !reviewed.bookingIds.includes(b.id);
  const [hours, minutes] = nowHM(new Date(), effectiveTimezone(business.businessTimezone)).split(':').map(Number);
  const nowMin = hours * 60 + minutes;
  const canCancel = (b: any) =>
    ['pending', 'confirmed'].includes(b.status) && b.date >= today &&
    (b.date !== today || (Number(b.time.slice(0, 2)) * 60 + Number(b.time.slice(3, 5)) - nowMin) >= cancelMin);

  return (
    <div>
      {(showOrders && showBookings) && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button onClick={() => setTab('orders')}
            className={`font-bold text-sm py-2.5 border ${tab === 'orders' ? 'il-chip-active border-transparent' : 'il-card'}`}
            style={{ borderRadius: 'var(--il-radius)' }}>
            <span className="inline-flex items-center gap-1.5"><Icon n="receipt" size={15} /> Pedidos</span>
          </button>
          <button onClick={() => setTab('bookings')}
            className={`font-bold text-sm py-2.5 border ${tab === 'bookings' ? 'il-chip-active border-transparent' : 'il-card'}`}
            style={{ borderRadius: 'var(--il-radius)' }}>
            <span className="inline-flex items-center gap-1.5"><Icon n="calendar" size={15} /> Agendamentos</span>
          </button>
        </div>
      )}

      {showBookings && tab === 'bookings' && <div className="flex gap-2 mb-4" role="group" aria-label="Consultas"><button type="button" aria-pressed={bookingView === 'upcoming'} className="il-card px-3 py-2 text-sm" onClick={() => setBookingView('upcoming')}>Próximas consultas</button><button type="button" aria-pressed={bookingView === 'history'} className="il-card px-3 py-2 text-sm" onClick={() => setBookingView('history')}>Histórico</button></div>}
      <p className="il-muted text-xs mb-3">{business.name} · Apenas os registros da sua conta.</p>
      {actionError && <p className="text-sm font-semibold text-red-600 mb-3">{actionError}</p>}
      {loadError ? <div role="alert"><p>{loadError}</p><button className="il-btn px-4 py-3 mt-3" onClick={load}>Tentar novamente</button></div> : loading ? (
        <div className="space-y-2.5" aria-label="Carregando">
          {[0, 1, 2].map((i) => (
            <div key={i} className="il-card p-4 animate-pulse">
              <div className="h-4 rounded w-2/3" style={{ background: 'color-mix(in srgb, var(--il-muted) 25%, transparent)' }} />
              <div className="h-3 rounded w-1/3 mt-2" style={{ background: 'color-mix(in srgb, var(--il-muted) 20%, transparent)' }} />
            </div>
          ))}
        </div>
      ) : tab === 'orders' ? (
        orders.length === 0 ? (
          <div className="text-center py-8">
            <span className="inline-flex w-12 h-12 rounded-full items-center justify-center" style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}><Icon n="bag" size={22} /></span>
            <p className="il-muted text-sm mt-2">Você ainda não fez pedidos aqui.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {orders.map((o) => (
              <div key={o.id} className="il-card p-4">
                <div className="flex justify-between items-center gap-2">
                  <p className="font-extrabold">{o.code}</p>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full il-chip-active">{ORDER_STATUS[o.status as OrderStatus]?.consumer || o.status}</span>
                </div>
                <p className="il-muted text-xs mt-1">
                  {o.items.map((i: any) => `${i.qty}× ${i.name}`).join(' · ')}
                </p>
                <div className="flex justify-between items-center mt-1.5">
                  <span className="il-muted text-xs inline-flex items-center gap-1"><Icon n={o.type === 'delivery' ? 'truck' : 'bag'} size={14} /> {o.type === 'delivery' ? 'Entrega' : 'Retirada'}</span>
                  <span className="font-extrabold il-accent">{money(o.total)}</span>
                </div>
                {['ready', 'completed'].includes(o.status) && !reviewed.orderIds.includes(o.id) && (
                  <button
                    onClick={() => openSheet('review', { businessId: business.id, businessName: business.name, googleUrl: business.googleUrl || '', kind: 'order', refId: o.id })}
                    className="il-btn w-full font-bold py-2.5 mt-3 text-sm inline-flex items-center justify-center gap-1.5">
                    <Icon n="star" size={15} /> Avaliar pedido {o.code}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      ) : shownBookings.length === 0 ? (
        <div className="text-center py-8">
          <span className="inline-flex w-12 h-12 rounded-full items-center justify-center" style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}><Icon n="calendar" size={22} /></span>
          <p className="il-muted text-sm mt-2">{bookingView === 'upcoming' ? 'Nenhuma consulta futura nesta clínica.' : 'Nenhum atendimento no histórico desta clínica.'}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {shownBookings.map((b) => (
            <div key={b.id} data-booking-id={b.id} className="il-card p-4">
              <div className="flex justify-between items-center gap-2">
                <p className="font-extrabold text-sm">{b.service}</p>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full il-chip-active">{BOOKING_STATUS[b.status as BookingStatus]?.consumer || b.status}</span>
              </div>
              <p className="il-muted text-xs mt-1 flex items-center gap-1.5">
                <Icon n="calendar" size={14} className="shrink-0" />
                <span>{humanDateTime(b.date, b.time, today)}{b.professional ? ` · ${b.professional}` : ''}</span>
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {canCancel(b) && (
                  <>
                    <button onClick={() => reschedule(b)}
                      className="il-btn text-xs font-bold px-3.5 py-2">
                      Remarcar
                    </button>
                    <button onClick={() => {
                      if (confirmCancel === b.id) cancelBooking(b.id);
                      else { setConfirmCancel(b.id); setTimeout(() => setConfirmCancel((c) => (c === b.id ? '' : c)), 4000); }
                    }} disabled={acting === b.id}
                      className="il-card text-xs font-bold px-3.5 py-2 disabled:opacity-50">
                      {acting === b.id ? 'Aguarde…' : confirmCancel === b.id ? 'Toque para confirmar' : 'Cancelar'}
                    </button>
                    <a target="_blank" rel="noreferrer"
                      href={gcalLink({ title: `${b.service} — ${business.name}`, date: b.date, time: b.time, durationMin: b.durationMin || 30, location: business.address || undefined })}
                      className="il-card text-xs font-bold px-3.5 py-2 inline-flex items-center gap-1">
                      <Icon n="calendar" size={13} /> Agenda
                    </a>
                  </>
                )}
                {canReviewBooking(b) && (
                  <button
                    onClick={() => openSheet('review', { businessId: business.id, businessName: business.name, googleUrl: business.googleUrl || '', kind: 'booking', refId: b.id })}
                    className="il-btn text-xs font-bold px-3.5 py-2 inline-flex items-center gap-1">
                    <Icon n="star" size={13} /> Avaliar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={logout} className="il-card w-full font-bold py-3 mt-4 text-sm">
        Sair da conta
      </button>
    </div>
  );
}

// ── CTA principal: abre o fluxo do DESTINO do bloco ───────────
// Serviço → agendar → agenda. Produtos têm área própria e nunca
// são destino de um CTA de agendamento (ver lib/cta.ts).
// Rótulo de emergência quando o recurso pedido está DESLIGADO: o botão nunca
// pode anunciar algo que não existe (ex.: "Agendar" sem módulo de agendamento).
const CTA_FALLBACK_LABEL: Record<string, string> = {
  products: 'Ver produtos',
  booking: 'Agendar horário',
  quote: 'Pedir orçamento',
  whatsapp: 'Falar no WhatsApp',
};

export function CtaButton({ business, label, target }: { business: PublicBusiness; label: string; target?: string }) {
  const cls = 'il-btn block w-full text-center font-bold text-[17px] py-3.5 active:scale-[0.99] transition-transform';
  // MÓDULO MANDA: o destino pedido pela página só vale se o módulo estiver
  // ligado; caso contrário cai para o próximo recurso realmente disponível —
  // e o texto acompanha o destino real.
  const allowed = allowedCtaTargets(business);
  if (allowed.length === 0) return null;
  const wanted = resolveCtaTarget(business.modes, label, target);
  const t = allowed.includes(wanted) ? wanted : allowed[0];
  // Compara com o que o BOTÃO anuncia: se o módulo pedido está desligado,
  // o texto acompanha o destino real em vez de prometer o recurso ausente.
  const text = t === requestedCtaTarget(label, target) ? label : CTA_FALLBACK_LABEL[t] || label;

  if (t === 'products') {
    return <button onClick={() => openSheet('products', {})} className={cls}>{text}</button>;
  }
  if (t === 'booking') {
    return <button onClick={() => openSheet('booking', {})} className={cls}>{text}</button>;
  }
  if (t === 'quote') {
    return <button onClick={() => openSheet('quote', {})} className={cls}>{text}</button>;
  }
  if (business.whatsapp) {
    return (
      <a href={waLink(business.whatsapp, `Olá! Vim pelo site da ${business.name}.`)} target="_blank" rel="noreferrer" className={cls}>
        {text}
      </a>
    );
  }
  return null;
}

export function ServiceAgendarButton({ serviceId, serviceName }: { serviceId: string; serviceName: string }) {
  return (
    <button
      onClick={() => openSheet('booking', { serviceId })}
      className="il-btn text-xs font-extrabold px-3.5 py-2 shrink-0"
      aria-label={`Agendar ${serviceName}`}
    >
      Agendar
    </button>
  );
}

// ── Gatilhos de bloco (server-safe, client components) ────────
export function ProductsTrigger({ title, count, label }: { title: string; count: number; label: string }) {
  return (
    <button onClick={() => openSheet('products', {})} className="il-card w-full p-5 text-center active:scale-[0.99] transition-transform">
      <span className="inline-flex w-14 h-14 rounded-2xl items-center justify-center" style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}><Icon n="bag" size={28} /></span>
      <span className="block font-extrabold text-lg mt-2">{title}</span>
      <span className="il-muted text-sm block mt-0.5">{count} {count === 1 ? 'item' : 'itens'}</span>
      <span className="il-btn block font-extrabold py-3 mt-3">Ver {label}</span>
    </button>
  );
}

export function QuoteTrigger({ title }: { title: string }) {
  return (
    <button onClick={() => openSheet('quote', { title })} className="il-card w-full p-5 text-center active:scale-[0.99] transition-transform">
      <span className="inline-flex w-14 h-14 rounded-2xl items-center justify-center" style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}><Icon n="chat" size={28} /></span>
      <span className="block font-extrabold text-lg mt-2">{title || 'Solicite um orçamento'}</span>
      <span className="il-muted text-sm block mt-0.5">Resposta rapidinho, sem compromisso</span>
      <span className="il-btn block font-extrabold py-3 mt-3">Pedir orçamento</span>
    </button>
  );
}

// ── Estrelas (exibição) ──────────────────────────────────────
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
          fill={i <= Math.round(value) ? '#f59e0b' : 'none'}
          stroke={i <= Math.round(value) ? '#f59e0b' : 'currentColor'}
          strokeWidth={1.8} className={i <= Math.round(value) ? '' : 'opacity-30'}>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
        </svg>
      ))}
    </span>
  );
}

// ── Sheet de avaliação (pós-pedido / pós-agendamento) ─────────
export function ReviewSheet({ businessId, businessName, googleUrl, kind, refId }: {
  businessId: string;
  businessName: string;
  googleUrl: string;
  kind: 'order' | 'booking';
  refId: string;
}) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setError('');
    if (rating < 1) { setError('Toque nas estrelas para avaliar.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId, rating, text,
          orderId: kind === 'order' ? refId : '',
          bookingId: kind === 'booking' ? refId : '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDone(true);
      window.dispatchEvent(new CustomEvent('il:reviews-changed'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="text-center py-4">
        <span className="inline-flex w-16 h-16 rounded-full items-center justify-center" style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}>
          <Icon n="checkCircle" size={30} />
        </span>
        <h3 className="text-lg font-extrabold mt-3">Obrigado pela avaliação!</h3>
        <p className="il-muted text-sm mt-1">Sua opinião ajuda a {businessName} a melhorar.</p>
        <div className="mt-4 space-y-2">
          {googleUrl && (
            <a href={googleUrl} target="_blank" rel="noreferrer" className="il-card block font-bold py-3 text-sm">
              Avaliar também no Google
            </a>
          )}
          <button onClick={closeSheet} className="il-btn w-full font-extrabold py-3">
            Concluir
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="il-muted text-sm -mt-1 mb-4">
        Como foi sua experiência{kind === 'order' ? ' com o pedido' : ' no atendimento'}?
      </p>
      <div className="flex items-center justify-center gap-2" role="radiogroup" aria-label="Nota de 1 a 5">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} onClick={() => setRating(i)} aria-label={`${i} estrela${i > 1 ? 's' : ''}`}
            className="p-1 transition-transform active:scale-90">
            <svg width={36} height={36} viewBox="0 0 24 24"
              fill={i <= rating ? '#f59e0b' : 'none'}
              stroke={i <= rating ? '#f59e0b' : 'currentColor'}
              strokeWidth={1.6} className={i <= rating ? '' : 'opacity-30'}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
            </svg>
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500}
        placeholder="Conte um pouco (opcional)…"
        className="il-card w-full text-sm px-4 py-3 outline-none resize-none mt-4" />
      {error && <p className="text-sm font-semibold text-red-600 mt-2">{error}</p>}
      <button onClick={submit} disabled={loading} className="il-btn w-full font-extrabold py-3.5 mt-3 disabled:opacity-50">
        {loading ? 'Enviando…' : 'Enviar avaliação'}
      </button>
    </div>
  );
}

// ── Sheet de telefone (onboarding Google / completar conta) ────
export function PhoneSheet() {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError('');
    if (phone.replace(/\D/g, '').length < 10) { setError('Informe um WhatsApp válido.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/customer/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      notifyAuthOk();
      closeSheet();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="il-muted text-sm -mt-1 mb-4 flex items-center gap-2"><Icon n="phone" size={18} /> Para continuar, precisamos do seu WhatsApp. Pedimos uma única vez.</p>
      <label className="block"><span className="text-xs font-bold il-muted">WHATSAPP *</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" autoComplete="tel"
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          className="il-card w-full text-sm px-4 py-3 outline-none mt-1" /></label>
      {error && <p className="text-sm font-semibold text-red-600 mt-2">{error}</p>}
      <button onClick={submit} disabled={loading} className="il-btn w-full font-extrabold py-3.5 mt-3 disabled:opacity-50">
        {loading ? 'Salvando…' : 'Continuar'}
      </button>
    </div>
  );
}
