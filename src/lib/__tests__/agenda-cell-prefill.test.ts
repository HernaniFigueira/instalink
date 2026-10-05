import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { newBookingSeedFromAgendaCell, serviceAcceptsProfessional, uniqueEligibleServiceId } from '../agenda-cell-prefill';

const root = process.cwd();

describe('Agenda cell → NewBookingSheet prefill', () => {
  it('passes the clicked cell date and exact time, without creating a booking', () => {
    expect(newBookingSeedFromAgendaCell({ date: '2026-10-03', professionalId: 'pro-1' }, '10:30'))
      .toEqual({ date: '2026-10-03', time: '10:30', professionalId: 'pro-1' });
    expect(newBookingSeedFromAgendaCell({ date: '2026-10-03' }, '10:30'))
      .toEqual({ date: '2026-10-03', time: '10:30', professionalId: '' });
  });

  it('wires cell click through the seed into the quick create and, dele, ao NewBookingSheet', () => {
    // DS 1.0 · §5 — o clique no slot deixou de abrir o sheet direto: passa a
    // abrir o quick create ANCORADO (Popover canônico) com data/hora/
    // profissional da coluna. O fluxo completo continua recebendo a MESMA
    // intenção por "Mais opções" (`initial`), e é ele quem grava.
    const agenda = fs.readFileSync(path.join(root, 'src/app/(dashboard)/agenda/page.tsx'), 'utf8');
    const sheet = fs.readFileSync(path.join(root, 'src/components/dashboard/NewBookingSheet.tsx'), 'utf8');
    expect(agenda).toContain('setQuickCreate({ x: point.x, y: point.y, date: col.date, time, professionalId: col.professionalId })');
    expect(agenda).toContain('<QuickBookingPopover');
    expect(agenda).toMatch(/onMore=\{\(seed\) => \{[\s\S]*?setCreating\(\{/);
    expect(agenda).toMatch(/initial=\{\{[\s\S]*?date: creating\.date[\s\S]*?time: creating\.time/);
    expect(sheet).toContain('const [date, setDate] = useState(initial?.date || \'\')');
    expect(sheet).toContain('const [time, setTime] = useState(initial?.time || \'\')');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// SERVIÇO DO CLIQUE — decisão pelos VÍNCULOS REAIS do catálogo
// ═════════════════════════════════════════════════════════════════════════
// Nunca por nome/cargo/especialidade: só `service.professionalIds`.
describe('elegibilidade de serviço por vínculo real do catálogo', () => {
  const svc = (id: string, professionalIds: string[], extra: Record<string, unknown> = {}) =>
    ({ id, active: true, bookable: true, professionalIds, ...extra });

  it('serviço sem lista própria aceita qualquer profissional; com lista, só os dela', () => {
    expect(serviceAcceptsProfessional(svc('s1', []), 'pro-x')).toBe(true);
    expect(serviceAcceptsProfessional(svc('s2', ['pro-x']), 'pro-x')).toBe(true);
    expect(serviceAcceptsProfessional(svc('s2', ['pro-x']), 'pro-y')).toBe(false);
    expect(serviceAcceptsProfessional(undefined, 'pro-x')).toBe(true);
  });

  it('sem profissional (Semana) nunca inventa vínculo: devolve vazio', () => {
    expect(uniqueEligibleServiceId([svc('s1', ['pro-x'])], '')).toBe('');
  });

  it('EXATAMENTE UM elegível → devolve esse serviço (conveniência)', () => {
    const services = [svc('a', ['pro-x']), svc('b', ['pro-y']), svc('c', ['pro-z'])];
    expect(uniqueEligibleServiceId(services, 'pro-y')).toBe('b');
  });

  it('DOIS ou mais elegíveis → não pré-seleciona nada', () => {
    const services = [svc('a', ['pro-x']), svc('b', ['pro-x']), svc('c', ['pro-y'])];
    expect(uniqueEligibleServiceId(services, 'pro-x')).toBe('');
  });

  it('ZERO elegíveis → não pré-seleciona nada', () => {
    expect(uniqueEligibleServiceId([svc('a', ['pro-outro'])], 'pro-x')).toBe('');
    expect(uniqueEligibleServiceId([], 'pro-x')).toBe('');
  });

  it('serviço inativo ou não agendável NÃO conta como elegível', () => {
    const services = [
      svc('ativo', ['pro-x']),
      svc('inativo', ['pro-x'], { active: false }),
      svc('nao-agendavel', ['pro-x'], { bookable: false }),
    ];
    expect(uniqueEligibleServiceId(services, 'pro-x')).toBe('ativo');
    // Se os dois "elegíveis" restantes fossem contados, haveria 3 e nada seria
    // escolhido — por isso este teste também protege a contagem.
    const soInativos = services.filter((s) => s.id !== 'ativo');
    expect(uniqueEligibleServiceId(soInativos, 'pro-x')).toBe('');
  });

  it('serviço sem vínculo conta como elegível (régua do catálogo e do servidor)', () => {
    // Único serviço, sem vínculo: elegível para qualquer coluna.
    expect(uniqueEligibleServiceId([svc('geral', [])], 'pro-x')).toBe('geral');
    // Com um serviço vinculado e outro livre, há DOIS elegíveis → nada.
    expect(uniqueEligibleServiceId([svc('geral', []), svc('x', ['pro-x'])], 'pro-x')).toBe('');
  });

  it('o NewBookingSheet usa o preset do serviço (não o initial cru) e não nasce sujo', () => {
    const booking = fs.readFileSync(path.join(root, 'src/components/dashboard/NewBookingSheet.tsx'), 'utf8');
    expect(booking).toContain('uniqueEligibleServiceId');
    expect(booking).toContain('const presetServiceId = initial?.serviceId || uniqueEligibleServiceId(bookable');
    expect(booking).toContain('const [serviceId, setServiceId] = useState(presetServiceId)');
    // Abrir pela grade não pode deixar o formulário sujo.
    expect(booking).toContain('serviceId: presetServiceId');
  });
});
