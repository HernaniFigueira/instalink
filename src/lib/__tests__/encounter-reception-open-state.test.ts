// R9 · D · Estado coerente do "Pedir à recepção": o botão deve refletir, ao
// recarregar, se JÁ existe pedido ABERTO para o atendimento (derivado da tarefa,
// fonte da verdade). Concluído, de outra unidade ou de outro atendimento não conta.
import { describe, expect, it } from 'vitest';
import { encounterView, hasOpenReceptionTask } from '@/lib/encounters';

const BIZ = 'biz-1';
const ENC = 'enc-1';

function encounter(over: Record<string, any> = {}) {
  return {
    id: ENC, businessId: BIZ, professionalId: 'pro-1', serviceId: '', bookingId: '', queueId: '',
    contactId: '', petId: '', status: 'finalized', version: 1, evolution: 'ok', complaint: '', guidance: '',
    followUpMode: 'none', createdAt: '', updatedAt: '', ...over,
  } as any;
}

function db(tasks: any[]) {
  return {
    professionals: [{ id: 'pro-1', name: 'Dra. Michele' }], services: [], bookings: [], queue: [],
    contacts: [], pets: [], businesses: [], encounters: [encounter()], tasks,
  } as any;
}

const task = (over: Record<string, any> = {}) => ({
  id: 't-1', businessId: BIZ, title: 'Agendar retorno', status: 'open', encounterId: ENC, ...over,
});

describe('Pedir à recepção · estado derivado da tarefa aberta', () => {
  it('tarefa aberta do mesmo atendimento e unidade → pedido em aberto', () => {
    expect(hasOpenReceptionTask(db([task()]), encounter())).toBe(true);
  });

  it('sem tarefa → nenhum pedido em aberto', () => {
    expect(hasOpenReceptionTask(db([]), encounter())).toBe(false);
  });

  it('tarefa concluída não conta: o pedido pode ser refeito', () => {
    expect(hasOpenReceptionTask(db([task({ status: 'done' })]), encounter())).toBe(false);
  });

  it('tarefa de outra unidade não conta (tenant)', () => {
    expect(hasOpenReceptionTask(db([task({ businessId: 'biz-2' })]), encounter())).toBe(false);
  });

  it('tarefa de outro atendimento não conta', () => {
    expect(hasOpenReceptionTask(db([task({ encounterId: 'enc-outro' })]), encounter())).toBe(false);
  });

  it('a leitura do atendimento expõe receptionTaskOpen para a tela', () => {
    const e = encounter();
    expect(encounterView(e, db([task()]), null).receptionTaskOpen).toBe(true);
    expect(encounterView(e, db([]), null).receptionTaskOpen).toBe(false);
  });
});
