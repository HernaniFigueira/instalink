// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 3 — DISPONIBILIDADE · AGENDA · NOVO AGENDAMENTO
// ═══════════════════════════════════════════════════════════════
// Regressões do que este bloco MUDA — e das travas que ele mantém:
//   • o horário é lido em CHIPS por dia (não mais numa frase corrida), e os
//     chips saem SEMPRE da tabela de horários real (lib/schedule.ts), nunca de
//     um resumo paralelo inventado na tela;
//   • navegação de data = TOOLBAR CANÔNICA `Hoje · ‹ data ›` do DS 1.0 (§5):
//     "Hoje" volta como AÇÃO de uma linha (não como estado da grade), as setas
//     andam um passo do modo atual e a data é o DatePicker canônico — o
//     `<input type="date">` nativo deixou de ser dependência da tela;
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

describe('A3.4 · Bloco 3 — Agenda: navegação [◀][▶] e clique cria', () => {
  const agenda = stripComments(read('src/app/(dashboard)/agenda/page.tsx'));

  it('a toolbar é `Hoje · ‹ data ›` nesta ordem, com DatePicker canônico', () => {
    // DS 1.0 · §5 — supersede a correção cirúrgica (que havia removido o
    // "Hoje"): agora ele é AÇÃO explícita de uma linha, ancorada em `today`
    // do FUSO DO NEGÓCIO, e o rótulo do período continua sendo a leitura.
    // `stripComments` remove as linhas de comentário: ancora no CÓDIGO.
    const todayBtn = agenda.indexOf('onClick={() => setFocus(today)}');
    expect(todayBtn).toBeGreaterThan(-1);
    const bar = agenda.slice(todayBtn, agenda.indexOf('Novo agendamento', todayBtn));
    const prev = bar.indexOf('chevL');
    const picker = bar.indexOf('<DatePicker');
    const next = bar.indexOf('chevR');
    expect(prev).toBeGreaterThan(-1);
    expect(picker).toBeGreaterThan(prev);
    expect(next).toBeGreaterThan(picker);
    // A data abre o popover do componente canônico (Popover + Calendar), não
    // o seletor nativo do navegador.
    expect(bar).toContain('formatValue={() => focusLabel}');
    expect(agenda).not.toContain('type="date"');
  });

  it('“Hoje” é ação de uma linha — não é estado persistido nem muda o modo', () => {
    // A ação existe (setFocus(today)) e é marcada por aria-pressed; o rótulo
    // diz que já está em hoje em vez de desabilitar o controle (desabilitar
    // esconderia o alvo de quem só quer reconfirmar o dia).
    expect(agenda).toContain('onClick={() => setFocus(today)}');
    expect(agenda).toContain('aria-pressed={focus === today}');
    expect(agenda).toContain("'Você já está em hoje'");
    // Nunca desabilitado e NUNCA mexendo no modo de visualização: "Hoje" é
    // navegação temporal, não troca de Dia/Semana/Lista.
    expect(agenda).not.toContain('disabled={focus === today}');
    const btn = agenda.slice(agenda.indexOf('<Button\n              variant="secondary"\n              size="sm"\n              onClick={() => setFocus(today)}'), agenda.indexOf('</Button>', agenda.indexOf('onClick={() => setFocus(today)}')));
    expect(btn).not.toContain('setView');
    expect(btn).not.toContain('endDrag');
  });

  it('clicar num horário vago abre o quick create com dia, hora e profissional', () => {
    expect(agenda).toContain('onEmptyPress');
    expect(agenda).toContain('minuteFromOffsetY(');
    // DS 1.0 · §5 — clique/arraste abrem o POPOVER canônico ancorado no ponto,
    // passando dia/hora/profissional da coluna; o fluxo completo (sheet)
    // continua existindo em "Mais opções" e no CTA.
    expect(agenda).toContain('setQuickCreate({ x: point.x, y: point.y, date: col.date, time, professionalId: col.professionalId })');
    expect(agenda).toContain('<QuickBookingPopover');
    expect(agenda).toContain('onMore={');
    expect(agenda).toContain('Novo agendamento');
    expect(agenda).toContain('Bloquear horário');
    // O clique que sobra de um arraste nunca cria agendamento.
    expect(agenda).toContain('lastGridPressAt');
    expect(agenda).toContain("el.closest('button')");
  });

  it('o clique só sugere um horário — o motor de slots continua no servidor', () => {
    // A disponibilidade vem do servidor (URLs montadas por lib/agenda-drag);
    // a tela não recalcula slot nenhum.
    expect(agenda).toContain('dragSlotUrl(');
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
    expect(minuteFromOffsetY(100, { ...g, pxPerHour: 0 })).toBe(585); // geom. degenerada não quebra
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
    // Serviço: o valor inicial vem do preset (escolha única do catálogo),
    // nunca de um palpite por nome/cargo.
    expect(sheet).toContain('useState(presetServiceId)');
    expect(sheet).toContain('uniqueEligibleServiceId');
    // Pré-F1: preserve the column/slot, but refuse saving incompatible intent.
    expect(sheet).toContain('const activeProId = proId');
    expect(sheet).toContain('incompatiblePro');
    expect(sheet).toContain('if (pastIssue || proIssue || (!opts.fitIn && slotIssue))');
    expect(sheet).not.toContain("setProId(''); setTime('')");

  });

  it('a agenda passa o pré-preenchimento ao abrir pelo clique', () => {
    const agenda = stripComments(read('src/app/(dashboard)/agenda/page.tsx'));
    expect(agenda).toContain('date: creating.date || focus');
    expect(agenda).toContain('time: creating.time');
    expect(agenda).toContain('professionalId: creating.professionalId');
  });
});
