'use client';

import { Suspense, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { onlyDigits, money, cn } from '@/lib/utils';
import { todayISO, addDaysISO, humanDay } from '@/lib/tz';

interface ServiceItem {
  id: string;
  name: string;
  description?: string;
  durationMin: number;
  price: number;
  bookable?: boolean;
  professionalIds?: string[];
}

interface ProfessionalItem {
  id: string;
  name: string;
  role?: string;
  bio?: string;
  avatar?: string;
}

interface BusinessInfo {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
}

export default function AgendarPage() {
  return (
    <Suspense fallback={
      <div className="min-h-[400px] flex items-center justify-center p-6 text-zinc-500 text-sm">
        <div className="animate-pulse flex flex-col items-center gap-2">
          <div className="w-8 h-8 rounded-full border-2 border-zinc-900 border-t-transparent animate-spin" />
          <p>Carregando agendamento…</p>
        </div>
      </div>
    }>
      <AgendarContent />
    </Suspense>
  );
}

function AgendarContent() {
  const searchParams = useSearchParams();
  const bParam = searchParams.get('businessId') || searchParams.get('b') || searchParams.get('slug') || '';
  const initialServiceId = searchParams.get('serviceId') || searchParams.get('s') || '';
  const initialProfessionalId = searchParams.get('professionalId') || searchParams.get('p') || '';
  const initialDate = searchParams.get('date') || '';
  const leadId = searchParams.get('leadId') || '';
  const isEmbed = searchParams.get('embed') === '1' || searchParams.get('embed') === 'true';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [professionals, setProfessionals] = useState<ProfessionalItem[]>([]);

  // Form state
  const [selectedServiceId, setSelectedServiceId] = useState(initialServiceId);
  const [selectedProfessionalId, setSelectedProfessionalId] = useState(initialProfessionalId);
  const [selectedDate, setSelectedDate] = useState(initialDate || todayISO());
  const [selectedTime, setSelectedTime] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // Customer info
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [note, setNote] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [successBooking, setSuccessBooking] = useState<any>(null);

  // 1. Carrega dados do negócio, serviços e profissionais
  useEffect(() => {
    if (!bParam) {
      setLoading(false);
      setError('Identificador do negócio não informado.');
      return;
    }

    async function loadData() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/checkout-info?slug=${encodeURIComponent(bParam)}`);
        const data = await res.json();
        if (!res.ok || !data.business) {
          throw new Error(data.error || 'Negócio não encontrado.');
        }

        setBusiness(data.business);
        const bookableServices = (data.services || []).filter((s: ServiceItem) => s.bookable !== false);
        setServices(bookableServices);
        setProfessionals(data.professionals || []);

        // Se serviceId veio na URL e é válido, mantém; senão escolhe o primeiro
        if (initialServiceId && bookableServices.some((s: ServiceItem) => s.id === initialServiceId)) {
          setSelectedServiceId(initialServiceId);
        } else if (bookableServices.length > 0) {
          setSelectedServiceId(bookableServices[0].id);
        }
      } catch (err: any) {
        setError(err.message || 'Não foi possível carregar as informações.');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [bParam, initialServiceId]);

  // Serviço selecionado
  const selectedService = useMemo(
    () => services.find((s) => s.id === selectedServiceId),
    [services, selectedServiceId],
  );

  // Profissionais elegíveis para o serviço selecionado
  const eligibleProfessionals = useMemo(() => {
    if (!selectedService) return professionals;
    if (!selectedService.professionalIds || selectedService.professionalIds.length === 0) {
      return professionals;
    }
    return professionals.filter((p) => selectedService.professionalIds!.includes(p.id));
  }, [selectedService, professionals]);

  // Se o profissional selecionado não é elegível para o novo serviço, reseta
  useEffect(() => {
    if (selectedProfessionalId && !eligibleProfessionals.some((p) => p.id === selectedProfessionalId)) {
      setSelectedProfessionalId('');
    }
  }, [selectedServiceId, eligibleProfessionals, selectedProfessionalId]);

  // 2. Busca horários disponíveis quando serviço, profissional ou data mudam
  useEffect(() => {
    if (!business?.id || !selectedServiceId || !selectedDate) return;

    let cancelled = false;
    async function loadSlots() {
      setSlotsLoading(true);
      setSelectedTime('');
      try {
        let url = `/api/bookings?businessId=${business!.id}&serviceId=${selectedServiceId}&date=${selectedDate}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!cancelled) {
          setSlots(Array.isArray(data.slots) ? data.slots : []);
        }
      } catch {
        if (!cancelled) setSlots([]);
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    }

    loadSlots();
    return () => { cancelled = true; };
  }, [business?.id, selectedServiceId, selectedDate, selectedProfessionalId]);

  // Próximos 14 dias disponíveis para escolha rápida
  const nextDays = useMemo(() => {
    const days: string[] = [];
    const base = todayISO();
    for (let i = 0; i < 14; i++) {
      days.push(addDaysISO(base, i));
    }
    return days;
  }, []);

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id || !selectedServiceId || !selectedDate || !selectedTime) {
      alert('Selecione serviço, dia e horário.');
      return;
    }
    const digits = onlyDigits(customerPhone);
    if (!customerName.trim() || digits.length < 10) {
      alert('Por favor informe seu nome e um WhatsApp válido.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: business.id,
          serviceId: selectedServiceId,
          professionalId: selectedProfessionalId || undefined,
          date: selectedDate,
          time: selectedTime,
          customerName: customerName.trim(),
          customerPhone: digits,
          customerEmail: customerEmail.trim() || undefined,
          note: note.trim() || undefined,
          marketingOptIn,
          leadId: leadId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Não foi possível confirmar o agendamento.');
      }

      setSuccessBooking({
        ...data,
        serviceName: selectedService?.name,
        date: selectedDate,
        time: selectedTime,
        professionalName: data.professionalName,
      });
    } catch (err: any) {
      setError(err.message || 'Falha ao agendar.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center p-6 text-zinc-500 text-sm">
        <div className="animate-pulse flex flex-col items-center gap-2">
          <div className="w-8 h-8 rounded-full border-2 border-zinc-900 border-t-transparent animate-spin" />
          <p>Carregando horários disponíveis…</p>
        </div>
      </div>
    );
  }

  if (error && !business) {
    return (
      <div className="min-h-[400px] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-6 rounded-xl border border-red-200 text-center">
          <p className="text-red-600 font-medium text-sm mb-2">{error}</p>
          <p className="text-xs text-zinc-500">Verifique o endereço ou entre em contato com o estabelecimento.</p>
        </div>
      </div>
    );
  }

  // Tela de Sucesso
  if (successBooking) {
    return (
      <div className={cn('max-w-lg mx-auto p-4 sm:p-6', !isEmbed && 'my-8')}>
        <div className="bg-white rounded-2xl border border-zinc-200 p-6 sm:p-8 text-center shadow-sm">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">
            ✓
          </div>
          <h2 className="text-xl font-bold text-zinc-900 mb-1">Agendamento Realizado!</h2>
          <p className="text-sm text-zinc-600 mb-6">
            Sua reserva para <strong>{business?.name}</strong> foi confirmada.
          </p>

          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-left text-sm space-y-2 mb-6">
            <div className="flex justify-between">
              <span className="text-zinc-500">Serviço:</span>
              <span className="font-semibold text-zinc-900">{successBooking.serviceName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Data e Hora:</span>
              <span className="font-semibold text-zinc-900">{humanDay(successBooking.date)} às {successBooking.time}</span>
            </div>
            {successBooking.professionalName && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Profissional:</span>
                <span className="font-semibold text-zinc-900">{successBooking.professionalName}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-zinc-500">Cliente:</span>
              <span className="font-semibold text-zinc-900">{customerName}</span>
            </div>
          </div>

          <p className="text-xs text-zinc-500 mb-6">
            Enviamos uma mensagem de confirmação para o seu WhatsApp.
          </p>

          <button
            onClick={() => {
              setSuccessBooking(null);
              setSelectedTime('');
            }}
            className="w-full bg-zinc-900 text-white font-medium py-2.5 rounded-lg text-sm hover:bg-zinc-800 transition"
          >
            Fazer outro agendamento
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('max-w-2xl mx-auto p-4 sm:p-6', !isEmbed && 'my-6')}>
      <div className={cn('bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden', isEmbed && 'border-none shadow-none')}>
        {/* Top Header */}
        <div className="p-5 border-b border-zinc-100 flex items-center gap-3.5 bg-zinc-50/50">
          {business?.logo ? (
            <img src={business.logo} alt={business.name} className="w-12 h-12 rounded-full object-cover border border-zinc-200" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-zinc-900 text-white flex items-center justify-center font-bold text-lg">
              {business?.name?.[0] || 'A'}
            </div>
          )}
          <div>
            <h1 className="text-base font-bold text-zinc-900 leading-snug">{business?.name}</h1>
            <p className="text-xs text-zinc-500">Agendamento online e confirmação instantânea</p>
          </div>
        </div>

        {error && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleBook} className="p-5 sm:p-6 space-y-6">
          {/* Passo 1: Serviço */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
              1. Escolha o serviço
            </label>
            <div className="grid gap-2">
              {services.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => setSelectedServiceId(svc.id)}
                  className={cn(
                    'w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between',
                    selectedServiceId === svc.id
                      ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm'
                      : 'border-zinc-200 hover:border-zinc-300 bg-white text-zinc-900',
                  )}
                >
                  <div>
                    <p className="font-semibold text-sm">{svc.name}</p>
                    <p className={cn('text-xs mt-0.5', selectedServiceId === svc.id ? 'text-zinc-300' : 'text-zinc-500')}>
                      {svc.durationMin} min {svc.description ? `· ${svc.description}` : ''}
                    </p>
                  </div>
                  <div className="text-right pl-3 font-semibold text-sm">
                    {svc.price > 0 ? money(svc.price) : 'A combinar'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Passo 2: Profissional (se houver mais de 1) */}
          {eligibleProfessionals.length > 1 && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
                2. Profissional de preferência
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedProfessionalId('')}
                  className={cn(
                    'px-3.5 py-2 rounded-lg text-xs font-semibold border transition',
                    !selectedProfessionalId
                      ? 'bg-zinc-900 border-zinc-900 text-white'
                      : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50',
                  )}
                >
                  Qualquer profissional
                </button>
                {eligibleProfessionals.map((pro) => (
                  <button
                    key={pro.id}
                    type="button"
                    onClick={() => setSelectedProfessionalId(pro.id)}
                    className={cn(
                      'px-3.5 py-2 rounded-lg text-xs font-semibold border transition flex items-center gap-2',
                      selectedProfessionalId === pro.id
                        ? 'bg-zinc-900 border-zinc-900 text-white'
                        : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50',
                    )}
                  >
                    {pro.avatar && <img src={pro.avatar} alt="" className="w-4 h-4 rounded-full object-cover" />}
                    <span>{pro.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Passo 3: Data */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
              3. Escolha o dia
            </label>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
              {nextDays.map((d) => {
                const isSelected = selectedDate === d;
                const [y, m, dayNum] = d.split('-');
                const dateObj = new Date(Number(y), Number(m) - 1, Number(dayNum));
                const weekday = dateObj.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
                const month = dateObj.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setSelectedDate(d)}
                    className={cn(
                      'flex-shrink-0 w-16 py-2.5 rounded-xl border text-center transition flex flex-col items-center justify-center',
                      isSelected
                        ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm'
                        : 'bg-white border-zinc-200 hover:border-zinc-300 text-zinc-800',
                    )}
                  >
                    <span className={cn('text-[10px] uppercase font-semibold', isSelected ? 'text-zinc-300' : 'text-zinc-400')}>
                      {weekday}
                    </span>
                    <span className="text-base font-bold leading-tight my-0.5">{dayNum}</span>
                    <span className={cn('text-[10px] uppercase', isSelected ? 'text-zinc-300' : 'text-zinc-500')}>
                      {month}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Passo 4: Horários */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">
              4. Escolha o horário
            </label>
            {slotsLoading ? (
              <p className="text-xs text-zinc-400 py-3">Consultando horários disponíveis…</p>
            ) : slots.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-3 rounded-lg">
                Nenhum horário livre nesta data. Por favor selecione outro dia.
              </p>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelectedTime(s)}
                    className={cn(
                      'py-2 px-1 text-center rounded-lg text-xs font-semibold border transition',
                      selectedTime === s
                        ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm'
                        : 'bg-white border-zinc-200 hover:border-zinc-300 text-zinc-800',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Passo 5: Seus Dados */}
          <div className="pt-2 border-t border-zinc-100 space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500">
              5. Seus dados de contato
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <span className="block text-xs text-zinc-600 mb-1">Seu nome *</span>
                <input
                  type="text"
                  required
                  placeholder="Ex: Carlos Alberto"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
              </div>
              <div>
                <span className="block text-xs text-zinc-600 mb-1">Seu WhatsApp *</span>
                <input
                  type="tel"
                  required
                  placeholder="(11) 99999-9999"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
              </div>
            </div>

            <div>
              <span className="block text-xs text-zinc-600 mb-1">E-mail (opcional)</span>
              <input
                type="email"
                placeholder="seu@email.com"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
              />
            </div>

            <div>
              <span className="block text-xs text-zinc-600 mb-1">Observações ou dúvidas (opcional)</span>
              <textarea
                rows={2}
                placeholder="Algum detalhe sobre seu atendimento?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900"
              />
            </div>

            <label className="flex items-start gap-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(e) => setMarketingOptIn(e.target.checked)}
                className="mt-0.5 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
              />
              <span className="text-xs text-zinc-600">
                Aceito receber lembretes e novidades deste estabelecimento pelo WhatsApp.
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting || !selectedTime || !customerName.trim() || onlyDigits(customerPhone).length < 10}
            className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition shadow-sm"
          >
            {submitting ? 'Confirmando agendamento…' : 'Confirmar Agendamento'}
          </button>
        </form>
      </div>
    </div>
  );
}
