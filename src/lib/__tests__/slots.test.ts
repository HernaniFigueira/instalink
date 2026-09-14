import { describe, expect, it } from 'vitest';
import { computeSlots, type SlotQuery } from '../slots';

// Clínica: Orlando (odonto) e João (cardio), agendas individuais.
const pros = [
  { id: 'pro-orlando', businessId: 'b', name: 'Orlando', role: 'Dentista', photo: '', active: true },
  { id: 'pro-joao', businessId: 'b', name: 'João', role: 'Cardiologista', photo: '', active: true },
  { id: 'pro-ana', businessId: 'b', name: 'Ana', role: 'Fisio', photo: '', active: false },
] as any;
const services = [
  { id: 'svc-odonto', businessId: 'b', name: 'Consulta Odontológica', durationMin: 60, professionalIds: ['pro-orlando'] },
  { id: 'svc-cardio', businessId: 'b', name: 'Consulta Cardiológica', durationMin: 45, professionalIds: ['pro-joao'] },
] as any;
const rules = [
  { id: 'a1', businessId: 'b', weekday: 3, start: '09:00', end: '12:00', slotMin: 0, professionalId: 'pro-orlando', serviceId: '' },
  { id: 'a2', businessId: 'b', weekday: 3, start: '09:00', end: '12:00', slotMin: 0, professionalId: 'pro-joao', serviceId: '' },
] as any;

function query(serviceId: string, bookings: any[] = [], professionalId = ''): SlotQuery {
  const svc = services.find((s: any) => s.id === serviceId);
  return {
    rules, exceptions: [], bookings, services, professionals: pros,
    dateISO: '2026-09-09', weekday: 3, serviceId,
    durationMin: svc.durationMin, professionalId,
    eligibleProIds: svc.professionalIds, nowHM: '', leadMin: 0, bufferMin: 0,
  };
}

describe('grade pela duração do serviço', () => {
  it('60min → 09:00, 10:00, 11:00', () => {
    const r = computeSlots(query('svc-odonto'));
    expect(r.slots).toEqual(['09:00', '10:00', '11:00']);
  });
  it('45min → 09:00, 09:45, 10:30, 11:15', () => {
    const r = computeSlots(query('svc-cardio'));
    expect(r.slots).toEqual(['09:00', '09:45', '10:30', '11:15']);
  });
});

describe('serviço → elegíveis → disponibilidade deles', () => {
  it('odonto ocupado não afeta cardio (agendas não se misturam)', () => {
    const busy = [{ date: '2026-09-09', time: '09:00', status: 'confirmed', serviceId: 'svc-odonto', professionalId: 'pro-orlando' }];
    expect(computeSlots(query('svc-odonto', busy)).slots).toEqual(['10:00', '11:00']);
    expect(computeSlots(query('svc-cardio', busy)).slots).toEqual(['09:00', '09:45', '10:30', '11:15']);
  });
  it('profissional inativo não participa', () => {
    const r = computeSlots({ ...query('svc-cardio'), eligibleProIds: ['pro-joao', 'pro-ana'] });
    expect(r.slots).toEqual(['09:00', '09:45', '10:30', '11:15']);
    expect(Object.values(r.assign).every((id) => id !== 'pro-ana')).toBe(true);
  });
});

describe('ocupados visíveis', () => {
  it('horário ocupado sai de slots e entra em occupied', () => {
    const busy = [{ date: '2026-09-09', time: '10:00', status: 'confirmed', serviceId: 'svc-odonto', professionalId: 'pro-orlando' }];
    const r = computeSlots(query('svc-odonto', busy));
    expect(r.slots).not.toContain('10:00');
    expect(r.occupied).toContain('10:00');
  });
  it('cancelado libera o horário', () => {
    const cancelled = [{ date: '2026-09-09', time: '10:00', status: 'cancelled', serviceId: 'svc-odonto', professionalId: 'pro-orlando' }];
    const r = computeSlots(query('svc-odonto', cancelled));
    expect(r.slots).toContain('10:00');
    expect(r.occupied).not.toContain('10:00');
  });
});

// ── Herança do horário da empresa (lib/schedule + slots) ──
// Regra: quem SEGUE o horário da empresa usa as regras gerais; quem
// PERSONALIZOU usa somente as próprias. Nunca as duas juntas.
describe('herança do horário da empresa', () => {
  const svcGeral = { id: 'svc-geral', businessId: 'b', name: 'Avaliação', durationMin: 60, professionalIds: [] } as any;
  const geral = (start: string, end: string) =>
    ({ id: `g-${start}`, businessId: 'b', weekday: 3, start, end, slotMin: 0, professionalId: '', serviceId: '' }) as any;
  const propria = (proId: string, start: string, end: string) =>
    ({ id: `p-${proId}-${start}`, businessId: 'b', weekday: 3, start, end, slotMin: 0, professionalId: proId, serviceId: '' }) as any;
  const membro = (id: string, name: string, follow?: boolean) =>
    ({ id, businessId: 'b', name, role: '', photo: '', active: true, followBusinessHours: follow }) as any;

  function q(rules: any[], professionals: any[], professionalId = ''): SlotQuery {
    return {
      rules, exceptions: [], bookings: [], services: [svcGeral], professionals,
      dateISO: '2026-09-09', weekday: 3, serviceId: 'svc-geral', durationMin: 60,
      professionalId, eligibleProIds: [], nowHM: '', leadMin: 0, bufferMin: 0,
    };
  }

  const GERAL = [geral('14:00', '17:00')];
  const ORLANDO_OWN = propria('pro-orlando', '09:00', '11:00');
  const equipe = [membro('pro-orlando', 'Orlando', false), membro('pro-joao', 'João', true)];

  it('quem herda usa o horário geral', () => {
    const r = computeSlots(q([...GERAL], equipe, 'pro-joao'));
    expect(r.slots).toEqual(['14:00', '15:00', '16:00']);
  });

  it('quem personalizou usa somente o próprio horário', () => {
    const r = computeSlots(q([...GERAL, ORLANDO_OWN], equipe, 'pro-orlando'));
    expect(r.slots).toEqual(['09:00', '10:00']);
    expect(r.slots).not.toContain('14:00');
  });

  it('regras próprias residuais NÃO se somam ao horário geral (XOR)', () => {
    const segueComResiduo = [membro('pro-joao', 'João', true)];
    const r = computeSlots(q([...GERAL, propria('pro-joao', '08:00', '09:00')], segueComResiduo, 'pro-joao'));
    expect(r.slots).toEqual(['14:00', '15:00', '16:00']);
    expect(r.slots).not.toContain('08:00');
  });

  it('dado legado: com regras próprias = personalizado; sem = herda', () => {
    const legado = [membro('pro-orlando', 'Orlando'), membro('pro-joao', 'João')];
    expect(computeSlots(q([...GERAL, ORLANDO_OWN], legado, 'pro-orlando')).slots).toEqual(['09:00', '10:00']);
    expect(computeSlots(q([...GERAL, ORLANDO_OWN], legado, 'pro-joao')).slots).toEqual(['14:00', '15:00', '16:00']);
  });

  it('união da equipe para o cliente (sem escolher profissional)', () => {
    const r = computeSlots(q([...GERAL, ORLANDO_OWN], equipe));
    expect(r.slots).toEqual(['09:00', '10:00', '14:00', '15:00', '16:00']);
  });

  it('byProfessional expõe os livres de cada um (drag-and-drop destaca a coluna certa)', () => {
    const r = computeSlots(q([...GERAL, ORLANDO_OWN], equipe));
    expect(r.byProfessional['pro-orlando']).toEqual(['09:00', '10:00']);
    expect(r.byProfessional['pro-joao']).toEqual(['14:00', '15:00', '16:00']);
  });

  it('mudar o horário geral afeta só quem herda', () => {
    const novoGeral = [geral('15:00', '17:00')];
    const rules = [...novoGeral, ORLANDO_OWN];
    expect(computeSlots(q(rules, equipe, 'pro-joao')).slots).toEqual(['15:00', '16:00']);
    expect(computeSlots(q(rules, equipe, 'pro-orlando')).slots).toEqual(['09:00', '10:00']);
  });

  it('atendimento marcado tira o horário só daquele profissional', () => {
    const booking = { date: '2026-09-09', time: '09:00', status: 'confirmed', serviceId: 'svc-geral', professionalId: 'pro-orlando' } as any;
    const r = computeSlots({ ...q([...GERAL, ORLANDO_OWN], equipe), bookings: [booking] });
    expect(r.byProfessional['pro-orlando']).toEqual(['10:00']);
    expect(r.byProfessional['pro-joao']).toEqual(['14:00', '15:00', '16:00']);
    expect(r.slots).toEqual(['10:00', '14:00', '15:00', '16:00']);
    expect(r.occupied).toContain('09:00');
  });

  it('quando ninguém está livre naquele horário, ele sai da união e fica ocupado', () => {
    // Orlando (personalizado) só atende 09:00–11:00; João está ocupado às 15:00.
    const booking = { date: '2026-09-09', time: '15:00', status: 'confirmed', serviceId: 'svc-geral', professionalId: 'pro-joao' } as any;
    const r = computeSlots({ ...q([...GERAL, ORLANDO_OWN], equipe), bookings: [booking] });
    expect(r.slots).not.toContain('15:00');
    expect(r.occupied).toContain('15:00');
    expect(r.byProfessional['pro-joao']).toEqual(['14:00', '16:00']);
    // o auto-assign nunca entrega um horário a quem está ocupado
    expect(Object.values(r.assign)).not.toContain(undefined);
    for (const [time, pro] of Object.entries(r.assign)) {
      expect(r.byProfessional[pro]).toContain(time);
    }
  });

  it('sem equipe, vale o horário geral (modo solo, profissional \'\')', () => {
    const r = computeSlots(q([...GERAL], []));
    expect(r.slots).toEqual(['14:00', '15:00', '16:00']);
    expect(r.byProfessional).toEqual({ '': ['14:00', '15:00', '16:00'] });
    expect(r.assign).toEqual({});
  });
});
