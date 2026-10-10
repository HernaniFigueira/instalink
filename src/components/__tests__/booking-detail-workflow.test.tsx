// @vitest-environment jsdom
// A4 — "Chegou" é uma etapa do workflow, não um BookingStatus.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/components/icons', () => ({
  Icon: () => <span aria-hidden="true" />,
}));
vi.mock('@/components/dashboard/Pet360Sheet', () => ({ Pet360Sheet: () => null }));
vi.mock('@/components/dashboard/usePanelPermissions', () => ({
  // Se a tela ignorasse booking.workflow e calculasse por esta projeção, a
  // ação clínica não seria oferecida. O servidor é a fonte do cenário.
  usePanelPermissions: () => ({ permissions: { atendimento: false }, ready: true }),
}));
vi.mock('@/components/dashboard/OverlayDismissGuard', () => ({
  useOverlayDismissGuard: () => ({ requestClose: (_source: string, _state: unknown, close: () => void) => close(), dialog: null }),
}));
vi.mock('@/components/ui', () => ({
  StatusBadge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  buttonCls: () => 'button',
  DetailSideModal: ({ children }: any) => <section data-testid="detail-modal">{children}</section>,
}));

import { BookingDetailSheet } from '@/components/dashboard/BookingDetailSheet';

const booking = {
  id: 'booking-arrived', businessId: 'clinic-a', serviceId: 'service-a', professionalId: 'pro-a', customerId: 'customer-a',
  date: '2026-11-12', time: '10:00', customerName: 'Ana Tutor', customerPhone: '',
  status: 'confirmed', note: '', answers: [], history: [], createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-01T12:00:00.000Z',
  checkedInAt: '2026-11-12T13:00:00.000Z',
  workflow: { state: 'arrived', label: 'Chegou', allowed: ['start_care'] },
} as any;

afterEach(cleanup);

describe('BookingDetailSheet — status e workflow', () => {
  it('mantém Confirmado como status, mostra Chegou como etapa e destaca Iniciar atendimento', () => {
    render(
      <BookingDetailSheet
        booking={booking}
        service={{ id: 'service-a', name: 'Consulta', durationMin: 30 }}
        pro={{ id: 'pro-a', name: 'Dra. Ana' }}
        businessId="clinic-a"
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    const modal = screen.getByTestId('detail-modal');
    expect(within(modal).getByText('Agendamento').parentElement?.textContent).toContain('Confirmado');
    expect(within(modal).getByText('Etapa operacional').parentElement?.textContent).toContain('Chegou');
    expect(modal.querySelector('[data-workflow-state]')?.getAttribute('data-workflow-state')).toBe('arrived');
    expect(within(modal).getByText(/Próxima ação elegível/).textContent).toContain('Iniciar atendimento');
    expect(within(modal).getByRole('button', { name: 'Iniciar atendimento' })).toBeTruthy();
    expect(within(modal).queryByRole('button', { name: 'Registrar chegada' })).toBeNull();
  });
});
