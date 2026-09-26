// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 3 — DISPONIBILIDADE · AGENDA · NOVO AGENDAMENTO
// ═══════════════════════════════════════════════════════════════
// Regressões do que este bloco MUDA — e das travas que ele mantém:
//   • o horário é lido em CHIPS por dia (não mais numa frase corrida), e os
//     chips saem SEMPRE da tabela de horários real (lib/schedule.ts), nunca de
//     um resumo paralelo inventado na tela;
//   • "Hoje" fica SEMPRE entre as setas (antes ele aparecia/desaparecia);
//   • clicar num horário vago da grade abre o agendamento JÁ naquele dia/hora/
//     profissional — e o horário sugerido só vale se a grade real confirmar;
//   • o motor continua sendo o do servidor: nenhuma disponibilidade é
//     calculada no cliente (`mode=slots-admin` + POST /api/bookings).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { minuteFromOffsetY } from '../agenda-drag';
import { buildHoursChips } from '../hours-chips';
import { businessHoursTable, hoursTable, professionalHoursTable } from '../schedule';
import type { Availability, Professional } from '../types';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
/** Regra de horário como o motor a lê (só o que `hoursTable` consulta). */
const rule = (weekday: number, start: string, end: string, professionalId = ''): Availability =>
  ({ id: `a-${weekday}-${start}-${professionalId}`, businessId: 'b1', professionalId, serviceId: '', weekday, start, end, slotMin: 30 } as unknown as Availability);

const WEEK = (weekday: number, ...pairs: Array<[string, string]>): Availability[] =>
  pairs.map(([start, end]) => rule(weekday, start, end));

describe('A3.4 · Bloco 3 — horário em chips (Disponibilidade)', () => {
  it('um chip por dia, na ordem da semana brasileira (segunda primeiro)', () => {
    const rules = [...WEEK(0, ['09:00', '13:00']), ...WEEK(1, ['08:00', '20:00']), ...WEEK(2, ['08:00', '20:00']), ...WEEK(3, ['09:00', '18:00'])];
    const chips = buildHoursChips(businessHoursTable(rules));
    expect(chips.map((c) => c.label)).toEqual(['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM']);
    expect(chips.map((c) => c.closed)).toEqual([false, false, false, true, true, true, false]);
    expect(chips[0].text).toBe('SEG 08:00 → 20:00');
    expect(chips[2].text).toBe('QUA 09:00 → 18:00');
    expect(chips[6].text).toBe('DOM 09:00 → 13:00');
  });

  it('dia sem regra é fechado — nunca um horário inventado', () => {
    const chips = buildHoursChips(businessHoursTable(WEEK(1, ['09:00', '18:00'])));
    expect(chips.filter((c) => c.closed)).toHaveLength(6);
    expect(chips[6].text).toBe('DOM fechado');
    expect(chips.every((c) => c.closed || c.windows.length > 0)).toBe(true);
    expect(JSON.stringify(chips)).not.toContain('00:00');
  });

  it('o chip mostra TODAS as janelas do dia (turno duplo não vira meia-verdade)', () => {
    const chips = buildHoursChips(hoursTable(WEEK(1, ['09:00', '12:00'], ['14:00', '19:00'])));
    const seg = chips.find((c) => c.weekday === 1)!;
    expect(seg.windows.map((w) => `${w.start}-${w.end}`)).toEqual(['09:00-12:00', '14:00-19:00']);
    expect(seg.text).toBe('SEG 09:00 → 12:00 · 14:00 → 19:00');
  });

  it('horário do profissional usa a MESMA tabela do motor (follow vs personalizado)', () => {
    const rules: Availability[] = [...WEEK(1, ['08:00', '20:00']), rule(1, '10:00', '16:00', 'p1')];
    const follows = { id: 'p2', followBusinessHours: true } as Pick<Professional, 'id' | 'followBusinessHours'>;
    const custom = { id: 'p1', followBusinessHours: false } as Pick<Professional, 'id' | 'followBusinessHours'>;
    const followsChips = buildHoursChips(professionalHoursTable(follows, rules));
    const customChips = buildHoursChips(professionalHoursTable(custom, rules));
    // Quem segue a empresa herda 08:00–20:00; quem tem regra própria, 10:00–16:00.
    expect(followsChips.find((c) => c.weekday === 1)!.text).toBe('SEG 08:00 → 20:00');
    expect(customChips.find((c) => c.weekday === 1)!.text).toBe('SEG 10:00 → 16:00');
  });

  it('a Disponibilidade mostra os chips e não voltou para a linha corrida', () => {
    const src = stripComments(read('src/components/dashboard/BusinessHours.tsx'));
    expect(src).toContain('HoursChips');
    expect(src).toContain('businessHoursTable(');
    expect(src).toContain('professionalHoursTable(');
    // A antiga frase única não pode voltar como RESUMO da tela: ela só pode
    // sobrar dentro da frase explicativa do diálogo "seguir a empresa".
    const occurrences = src.split('hoursSummaryLine(general)').length - 1;
    expect(occurrences).toBe(1);
    expect(src).toContain('passa a atender no horário geral');
    expect(src).toContain('<HoursChips');
  });
});

describe('A3.4 · Bloco 3 — Agenda: "Hoje" sempre no lugar, clique cria', () => {
  const agenda = stripComments(read('src/app/(dashboard)/agenda/page.tsx'));

  it('as setas e o "Hoje" formam um grupo fixo, nesta ordem', () => {
    const group = agenda.slice(agenda.indexOf('inline-flex rounded-md border border-[var(--border-strong)]'), agenda.indexOf('Escolher outra data'));
    expect(group).toBeTruthy();
    const prev = group.indexOf('chevL');
    const today = group.indexOf('Hoje');
    const next = group.indexOf('chevR');
    expect(prev).toBeGreaterThan(-1);
    expect(today).toBeGreaterThan(prev);
    expect(next).toBeGreaterThan(today);
  });

  it('"Hoje" não desaparece quando já estamos em hoje (sem render condicional)', () => {
    expect(agenda).not.toMatch(/\{!isToday && \(/);
    expect(agenda).toContain('aria-pressed={isToday}');
    expect(agenda).toContain('setFocus(today)');
  });

  it('clicar num horário vago abre o agendamento com dia, hora e profissional', () => {
    expect(agenda).toContain('onEmptyPress');
    expect(agenda).toContain('minuteFromOffsetY(');
    expect(agenda).toContain('setCreating({ date: col.date, time, professionalId: col.professionalId || \'\' })');
    // O clique que sobra de um arraste nunca cria agendamento.
    expect(agenda).toContain('lastGridPressAt');
    expect(agenda).toContain("el.closest('button')");
  });

  it('o clique só sugere um horário — o motor de slots continua no servidor', () => {
    // A disponibilidade vem do servidor (URLs montadas por lib/agenda-drag);
    // a tela não recalcula slot nenhum.
    expect(agenda).toContain('dragSlotUrls(');
    expect(agenda).not.toMatch(/function computeSlots/);
    expect(agenda).not.toMatch(/const slots\s*=\s*useMemo\(\(\) => \[/);
  });

  it('minuto do clique: snap curto, dentro da grade, sem horário quebrado', () => {
    const g = { startMinute: 480, endMinute: 1200, pxPerHour: 52 };
    expect(minuteFromOffsetY(0, g)).toBe(480);            // topo = abertura
    expect(minuteFromOffsetY(52, g)).toBe(540);           // 1h depois
    expect(minuteFromOffsetY(30, g)).toBe(510);           // 30 min → snap 5
    expect(minuteFromOffsetY(3000, g)).toBe(1200);        // nunca passa do fim
    expect(minuteFromOffsetY(-500, g)).toBe(480);         // nem antes do início
    expect(minuteFromOffsetY(100, { ...g, pxPerHour: 0 })).toBe(580); // geom. degenerada não quebra
  });
});

describe('A3.4 · Bloco 3 — Novo agendamento no design system', () => {
  const sheet = stripComments(read('src/components/dashboard/NewBookingSheet.tsx'));

  it('usa os componentes compartilhados (não o visual antigo de 2024)', () => {
    for (const c of ['Button', 'Input', 'Select', 'Field', 'Checkbox', 'Notice', 'Card'.replace('Card', 'Badge'), 'Avatar']) {
      expect(sheet).toContain(c);
    }
    expect(sheet).toMatch(/from '@\/components\/ui'/);
    // Nada de classe local duplicando o campo do design system.
    expect(sheet).not.toContain('const input =');
    expect(sheet).not.toContain('border-zinc-300');
    expect(sheet).not.toContain('focus:ring-zinc-900');
  });

  it('mantém o fluxo cliente → serviço → data → horário (contrato com o servidor)', () => {
    expect(sheet).toContain('/api/contacts?businessId=');
    expect(sheet).toContain('mode=slots-admin');
    expect(sheet).toContain("fetch('/api/bookings', {");
    expect(sheet).toContain('BookingRecurrence');
    expect(sheet).toContain('data-booking-created="true"');
    expect(sheet).toContain('contactId: contactId || undefined');
  });

  it('aceita vir pré-preenchido pela agenda (dia, hora, profissional, serviço)', () => {
    expect(sheet).toContain("useState(initial?.date || '')");
    expect(sheet).toContain("useState(initial?.time || '')");
    expect(sheet).toContain("useState(initial?.professionalId || '')");
    expect(sheet).toContain("useState(initial?.serviceId || '')");
    // A primeira montagem não pode ser tratada como "troca de serviço", senão
    // o pré-preenchimento era apagado antes de aparecer.
    expect(sheet).toContain('firstService');
    // E o horário pedido de fora só sobrevive se a grade real o oferecer.
    expect(sheet).toContain('intendedTime');
    expect(sheet).toContain('want && list.includes(want) ? want : \'\'');
  });

  it('a agenda passa o pré-preenchimento ao abrir pelo clique', () => {
    const agenda = stripComments(read('src/app/(dashboard)/agenda/page.tsx'));
    expect(agenda).toContain('date: creating.date || focus');
    expect(agenda).toContain('time: creating.time');
    expect(agenda).toContain('professionalId: creating.professionalId');
  });
});
