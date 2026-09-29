import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { newBookingSeedFromAgendaCell } from '../agenda-cell-prefill';

const root = process.cwd();

describe('Agenda cell → NewBookingSheet prefill', () => {
  it('passes the clicked cell date and exact time, without creating a booking', () => {
    expect(newBookingSeedFromAgendaCell({ date: '2026-10-03', professionalId: 'pro-1' }, '10:30'))
      .toEqual({ date: '2026-10-03', time: '10:30', professionalId: 'pro-1' });
    expect(newBookingSeedFromAgendaCell({ date: '2026-10-03' }, '10:30'))
      .toEqual({ date: '2026-10-03', time: '10:30', professionalId: '' });
  });

  it('wires cell click through the seed into NewBookingSheet initial date and time', () => {
    const agenda = fs.readFileSync(path.join(root, 'src/app/(dashboard)/agenda/page.tsx'), 'utf8');
    const sheet = fs.readFileSync(path.join(root, 'src/components/dashboard/NewBookingSheet.tsx'), 'utf8');
    expect(agenda).toContain('setCreating(newBookingSeedFromAgendaCell(col, time))');
    expect(agenda).toMatch(/initial=\{\{[\s\S]*?date: creating\.date[\s\S]*?time: creating\.time/);
    expect(sheet).toContain('const [date, setDate] = useState(initial?.date || \'\')');
    expect(sheet).toContain('const [time, setTime] = useState(initial?.time || \'\')');
  });
});
