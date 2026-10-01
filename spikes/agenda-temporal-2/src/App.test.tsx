// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('./adapters/ExistingGridAdapter', () => ({
  default: (props: { onSelectRange: (startAt: string, endAt: string, professionalId?: string) => void }) => (
    <section data-library="grid">
      <button type="button" data-testid="mock-select-range" onClick={() => props.onSelectRange(
        '2026-10-05T13:00:00.000Z',
        '2026-10-05T13:40:00.000Z',
        'pro-orlando',
      )}>Selecionar 10:00–10:40</button>
    </section>
  ),
}));
vi.mock('./adapters/ReactBigCalendarAdapter', () => ({ default: () => <section data-library="rbc" /> }));
vi.mock('./adapters/FullCalendarAdapter', () => ({ default: () => <section data-library="fullcalendar" /> }));
vi.mock('./adapters/ScheduleXAdapter', () => ({ default: () => <section data-library="schedule-x" /> }));

import App from './App';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
});

afterEach(() => cleanup());

describe('Agenda Temporal 2.0 — shell visual do spike', () => {
  it('abre em Lista a 390 px e mantém Dia/Semana disponíveis no toolbar próprio', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('view-list').getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(screen.getByTestId('view-week'));
    expect(screen.getByTestId('view-week').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('view-day'));
    expect(screen.getByTestId('view-day').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('calendar-toolbar')).toBeTruthy();
  });

  it('abre painel leve com seleção 10:00–10:40 e duração sugerida editável', async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('mock-select-range'));
    expect(await screen.findByText('10:00–10:40')).toBeTruthy();
    const duration = screen.getByLabelText('Duração sugerida · editável') as HTMLInputElement;
    expect(duration.value).toBe('40');
    expect(screen.getByTestId('detail-pane').querySelector('.sp-selected-window small')?.textContent).toBe('Dr. Orlando');
  });
});
