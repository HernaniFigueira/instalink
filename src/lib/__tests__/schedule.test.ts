import { describe, expect, it } from 'vitest';
import {
  APPLY_TO_ALL_CONFIRMATION, applyToAllResultMessage, businessHoursChangeImpact,
  businessHoursTable, businessRules, customRulesFor, describeDay, describeHours,
  followTogglePatch, followsBusinessHours, hasOwnRules, hoursOrigin, hoursTable,
  initialCustomHours, isValidWindow, planApplyBusinessHoursToAll, professionalDaysOff,
  professionalHoursSummary, professionalHoursTable, rulesForProfessional, sanitizeWindows,
} from '../schedule';
import type { Availability, Professional } from '../types';

function pro(id: string, name: string, follow?: boolean, active = true): Professional {
  return { id, businessId: 'b1', name, role: '', photo: '', active, followBusinessHours: follow };
}

/** Regra de disponibilidade. professionalId '' = horário geral da empresa. */
function rule(professionalId: string, weekday: number, start: string, end: string, slotMin = 0): Availability {
  return { id: `${professionalId || 'geral'}-${weekday}-${start}`, businessId: 'b1', professionalId, serviceId: '', weekday, start, end, slotMin };
}

// Seg–Sex 09:00–18:00 para a empresa.
const GENERAL: Availability[] = [1, 2, 3, 4, 5].map((w) => rule('', w, '09:00', '18:00'));
// Ana atende só sábado de manhã (horário próprio).
const ANA_OWN: Availability[] = [rule('ana', 6, '08:00', '12:00')];
const RULES = [...GENERAL, ...ANA_OWN];

describe('schedule — herança do horário da empresa', () => {
  it('profissional sem regras próprias herda (padrão do produto)', () => {
    expect(followsBusinessHours(pro('bruno', 'Bruno'), RULES)).toBe(true);
    expect(hoursOrigin(pro('bruno', 'Bruno'), RULES)).toBe('inherited');
  });

  it('followBusinessHours explícito vence a derivação', () => {
    // Declarou que NÃO segue, mesmo sem regras próprias gravadas.
    expect(followsBusinessHours(pro('ana', 'Ana', false), RULES)).toBe(false);
    // Declarou que segue, mesmo tendo regras próprias antigas.
    expect(followsBusinessHours(pro('ana', 'Ana', true), RULES)).toBe(true);
  });

  it('dado legado: quem já tinha regras próprias continua personalizado', () => {
    expect(hasOwnRules('ana', RULES)).toBe(true);
    expect(followsBusinessHours({ id: 'ana' } as Professional, RULES)).toBe(false);
    expect(followsBusinessHours({ id: 'bruno' } as Professional, RULES)).toBe(true);
  });

  it('sem equipe, a agenda é o horário geral', () => {
    expect(followsBusinessHours(null, RULES)).toBe(true);
    expect(rulesForProfessional(null, RULES)).toHaveLength(GENERAL.length);
  });

  it('regras efetivas: herda OU personaliza, nunca as duas juntas', () => {
    const herda = rulesForProfessional(pro('bruno', 'Bruno'), RULES);
    expect(herda.every((r) => r.professionalId === '')).toBe(true);
    expect(herda).toHaveLength(5);

    const propria = rulesForProfessional(pro('ana', 'Ana', false), RULES);
    expect(propria.every((r) => r.professionalId === 'ana')).toBe(true);
    expect(propria).toHaveLength(1);
    // O horário geral NÃO vaza para quem personalizou.
    expect(propria.some((r) => r.professionalId === '')).toBe(false);
  });

  it('alterar o horário geral atualiza automaticamente quem herda (é por referência)', () => {
    const novoGeral = [1, 2, 3, 4, 5].map((w) => rule('', w, '08:00', '17:00'));
    const rules2 = [...novoGeral, ...ANA_OWN];
    const bruno = rulesForProfessional(pro('bruno', 'Bruno'), rules2);
    expect(bruno.map((r) => r.start)).toEqual(['08:00', '08:00', '08:00', '08:00', '08:00']);
    // Ana (personalizada) não foi afetada pela mudança geral.
    const ana = rulesForProfessional(pro('ana', 'Ana', false), rules2);
    expect(ana).toEqual(ANA_OWN);
  });
});

describe('schedule — leitura humana', () => {
  it('tabela por dia da semana com dias fechados marcados', () => {
    const t = businessHoursTable(RULES);
    expect(t).toHaveLength(7);
    expect(t[0].closed).toBe(true);           // domingo
    expect(t[1].label).toBe('Segunda');
    expect(t[1].windows[0]).toMatchObject({ start: '09:00', end: '18:00' });
    expect(describeDay(t[1])).toBe('Segunda 09:00 — 18:00');
    expect(describeDay(t[0])).toBe('Domingo Fechado');
  });

  it('múltiplos períodos no mesmo dia aparecem ordenados', () => {
    const rules = [rule('', 1, '14:00', '18:00'), rule('', 1, '08:00', '12:00')];
    const day = hoursTable(rules)[1];
    expect(day.windows.map((w) => w.start)).toEqual(['08:00', '14:00']);
    expect(describeDay(day)).toBe('Segunda 08:00 — 12:00, 14:00 — 18:00');
  });

  it('describeHours resume a semana inteira', () => {
    const txt = describeHours(GENERAL);
    expect(txt.split('\n')).toHaveLength(7);
    expect(txt).toContain('Domingo Fechado');
    expect(txt).toContain('Sexta 09:00 — 18:00');
  });

  it('folga = dia em que a empresa abre e o profissional não atende', () => {
    const off = professionalDaysOff(pro('ana', 'Ana', false), RULES);
    expect(off).toEqual([1, 2, 3, 4, 5]);
    expect(professionalDaysOff(pro('bruno', 'Bruno'), RULES)).toEqual([]);
  });

  it('resumo do profissional na lista (herdado × personalizado)', () => {
    const s = professionalHoursSummary(pro('ana', 'Ana', false), RULES);
    expect(s.origin).toBe('custom');
    expect(s.shortLabel).toBe('personalizado');
    expect(s.summary).toContain('Sáb 08:00 — 12:00');
    expect(s.actionLabel).toBe('Editar horário');

    const b = professionalHoursSummary(pro('bruno', 'Bruno'), RULES);
    expect(b.origin).toBe('inherited');
    expect(b.shortLabel).toBe('herdado da clínica');
    expect(b.actionLabel).toBe('Personalizar');
  });

  it('sem horário definido não inventa resumo', () => {
    const s = professionalHoursSummary(pro('x', 'X', false), GENERAL);
    expect(s.summary).toBe('Sem horário definido');
  });
});

describe('schedule — personalizar / voltar a seguir', () => {
  it('ao personalizar, começa com uma CÓPIA do horário geral (nunca agenda vazia)', () => {
    const patch = followTogglePatch({ follow: false, rules: RULES, professionalId: 'bruno' });
    expect(patch.followBusinessHours).toBe(false);
    expect(patch.rules).toHaveLength(5);
    expect(patch.rules[0]).toMatchObject({ weekday: 1, start: '09:00', end: '18:00' });
    expect(initialCustomHours(RULES)).toHaveLength(5);
  });

  it('quem já tem horário próprio mantém o próprio ao editar', () => {
    const patch = followTogglePatch({ follow: false, rules: RULES, professionalId: 'ana' });
    expect(patch.rules).toEqual([{ weekday: 6, start: '08:00', end: '12:00', slotMin: 0 }]);
  });

  it('voltar a seguir não copia nada (herança é por referência)', () => {
    const patch = followTogglePatch({ follow: true, rules: RULES, professionalId: 'ana' });
    expect(patch.followBusinessHours).toBe(true);
    expect(patch.rules).toEqual([]);
  });

  it('customRulesFor e businessRules separam os escopos', () => {
    expect(businessRules(RULES)).toHaveLength(5);
    expect(customRulesFor('ana', RULES)).toHaveLength(1);
    expect(customRulesFor('', RULES)).toEqual([]);
  });
});

describe('schedule — impacto e "aplicar a todos"', () => {
  const team = [pro('ana', 'Ana', false), pro('bruno', 'Bruno'), pro('carla', 'Carla'), pro('off', 'Inativo', undefined, false)];

  it('impacto separa quem segue de quem personalizou (inativos ficam fora)', () => {
    const impact = businessHoursChangeImpact(team, RULES);
    expect(impact.followingNames).toEqual(['Bruno', 'Carla']);
    expect(impact.customNames).toEqual(['Ana']);
    expect(impact.following).not.toContain('off');
  });

  it('o plano toca SOMENTE em quem segue a empresa', () => {
    const plan = planApplyBusinessHoursToAll(team, RULES);
    expect(plan.updateNames).toEqual(['Bruno', 'Carla']);
    expect(plan.skipNames).toEqual(['Ana']);
    expect(plan.confirmation).toBe(APPLY_TO_ALL_CONFIRMATION);
    expect(plan.confirmation).toContain('seguem o horário da clínica');
  });

  it('mensagem de resultado é honesta sobre quem não mudou', () => {
    const msg = applyToAllResultMessage(planApplyBusinessHoursToAll(team, RULES));
    expect(msg).toContain('2 profissionais seguem o horário da clínica');
    expect(msg).toContain('1 com horário personalizado não foram alterados');
    expect(msg).toContain('Ana');
  });

  it('sem personalizados, não inventa ressalva', () => {
    const msg = applyToAllResultMessage(planApplyBusinessHoursToAll([pro('b', 'Bruno')], RULES));
    expect(msg).toContain('1 profissional segue o horário da clínica e foi atualizado.');
    expect(msg).not.toContain('personalizado');
  });
});

describe('schedule — validação de janelas', () => {
  it('fim precisa ser depois do início, no formato HH:MM', () => {
    expect(isValidWindow('09:00', '18:00')).toBe(true);
    expect(isValidWindow('18:00', '09:00')).toBe(false);
    expect(isValidWindow('09:00', '09:00')).toBe(false);
    expect(isValidWindow('9:00', '18:00')).toBe(false);
    expect(isValidWindow('', '18:00')).toBe(false);
  });

  it('sanitizeWindows descarta inválidas e mantém o resto', () => {
    const out = sanitizeWindows([
      { weekday: 1, start: '09:00', end: '18:00' },
      { weekday: 2, start: '18:00', end: '09:00' },  // inválida
      { weekday: 9, start: '09:00', end: '18:00' },  // dia inexistente
      { weekday: 3, start: '09:00', end: '12:00', slotMin: 30 },
      null,
    ]);
    expect(out).toEqual([
      { weekday: 1, start: '09:00', end: '18:00', slotMin: 0 },
      { weekday: 3, start: '09:00', end: '12:00', slotMin: 30 },
    ]);
  });

  it('sanitizeWindows não quebra com entrada inesperada', () => {
    expect(sanitizeWindows(undefined)).toEqual([]);
    expect(sanitizeWindows('x')).toEqual([]);
  });

  it('tabela efetiva do profissional usa o escopo certo', () => {
    expect(professionalHoursTable(pro('ana', 'Ana', false), RULES)[6].closed).toBe(false);
    expect(professionalHoursTable(pro('ana', 'Ana', false), RULES)[1].closed).toBe(true);
    expect(professionalHoursTable(pro('bruno', 'Bruno'), RULES)[1].closed).toBe(false);
  });
});
