// P0.1 — dia fechado não abre Quick Create por clique comum (Agenda). O encaixe continua
// pelo fluxo explícito (Novo agendamento). Contrato de código: o bloqueio fica na origem
// (handlers de célula), não só no cabeçalho ou no CSS.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../..', p), 'utf8');

describe('P0.1 · Agenda: dia fechado não aceita clique comum', () => {
  const page = read('src/app/(dashboard)/agenda/page.tsx');

  it('mantém o mapa de fechamento por coluna lido pelos handlers estáveis', () => {
    expect(page).toMatch(/const closedRef = useRef<Map<string, \{ title: string; detail: string \} \| null>>/);
    expect(page).toMatch(/closedRef\.current = new Map\(columns\.map\(\(c\) => \[c\.key, closedFor\(c\)\]\)\);/);
  });

  it('onRangeSelect e onEmptyPress bloqueiam antes do Quick Create quando fora de bloqueio', () => {
    const guard = /if \(!blockMode\) \{\s*const closed = closedRef\.current\.get\(columnKey\);\s*if \(closed\) \{[^}]*setClosedHint\(/g;
    expect((page.match(guard) || []).length).toBe(2);
  });

  it('o aviso usa o Notice do DS (live = role=status), ancorado e com fechamento próprio', () => {
    expect(page).toMatch(/data-closed-hint/);
    expect(page).toMatch(/<Notice tone="warning" live title=/);
    expect(page).toMatch(/onDismiss=\{\(\) => setClosedHint\(null\)\}/);
    expect(page).toMatch(/setTimeout\(\(\) => setClosedHint\(null\), 4500\)/);
    expect(page).toContain('Não é possível agendar:');
  });

  it('o encaixe explícito continua disponível pelo fluxo de Novo agendamento', () => {
    const sheet = read('src/components/dashboard/NewBookingSheet.tsx');
    expect(sheet).toMatch(/bookingKind: 'fit_in'/);
  });

  it('o servidor distingue dia fechado de horário ocupado (mesma recusa, 409)', () => {
    const bc = read('src/lib/booking-create.ts');
    expect(bc).toMatch(/r\.closedReason === 'exception' \|\| r\.closedReason === 'no_windows'/);
    expect(bc).toContain('Este horário acabou de ser ocupado. Escolha outro.');
  });
});
