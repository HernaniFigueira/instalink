// @vitest-environment jsdom
// A3 — a projeção do painel precisa escolher a mesma unidade que o shell,
// inclusive quando há mais de uma unidade acessível.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lastBusinessStorageKey } from '@/lib/business-context';

const route = vi.hoisted(() => ({ search: '' }));
const session = vi.hoisted(() => ({ loadMe: vi.fn() }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(route.search),
}));
vi.mock('@/lib/session-me', () => ({ loadMe: session.loadMe }));

import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';

function Probe() {
  const state = usePanelPermissions();
  return <output data-testid="panel-state">{JSON.stringify(state)}</output>;
}

const businesses = [
  { id: 'unit-owner', role: 'OWNER', professionalId: '', professionalName: '', permissions: { agenda: true } },
  { id: 'unit-pro', role: 'PROFISSIONAL', professionalId: 'pro-ana', professionalName: 'Dra. Ana', permissions: { agenda: true } },
];

function state() {
  return JSON.parse(screen.getByTestId('panel-state').textContent || '{}');
}

beforeEach(() => {
  route.search = '';
  window.localStorage.clear();
  session.loadMe.mockReset();
});
afterEach(cleanup);

describe('usePanelPermissions — unidade ativa', () => {
  it('usa a unidade lembrada da mesma conta, em vez do primeiro item recebido', async () => {
    window.localStorage.setItem(lastBusinessStorageKey('user-a'), 'unit-pro');
    session.loadMe.mockResolvedValue({
      ok: true,
      data: { user: { id: 'user-a' }, businesses },
    });

    render(<Probe />);
    await waitFor(() => expect(state().ready).toBe(true));

    expect(state()).toMatchObject({
      businessId: 'unit-pro',
      role: 'PROFISSIONAL',
      professionalId: 'pro-ana',
      professionalName: 'Dra. Ana',
    });
  });

  it('não inventa a primeira unidade quando há ambiguidade sem escolha válida', async () => {
    session.loadMe.mockResolvedValue({
      ok: true,
      data: { user: { id: 'user-a' }, businesses },
    });

    render(<Probe />);
    await waitFor(() => expect(state().ready).toBe(true));

    expect(state()).toMatchObject({
      businessId: '',
      role: '',
      professionalId: '',
      professionalName: '',
      permissions: {},
    });
  });
});
