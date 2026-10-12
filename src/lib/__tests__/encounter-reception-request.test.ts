// Contrato D · "Pedir à recepção" a partir do registro finalizado.
// Um pedido ABERTO por atendimento: repetir não duplica; depois de concluído, um novo pedido é possível.
import { describe, it, expect } from 'vitest';
import { createTaskTx } from '../automation/tasks';

function db(): any {
  return {
    tasks: [],
    leads: [],
    bookings: [],
    contacts: [],
    encounters: [{ id: 'enc-1', businessId: 'biz-1' }, { id: 'enc-2', businessId: 'biz-1' }],
  };
}
const pedido = (encounterId = 'enc-1', extra: Record<string, unknown> = {}) => ({
  businessId: 'biz-1', title: 'Retorno · Thor (Bernardo)', note: 'Ligar em 30 dias', encounterId, createdBy: 'user-michele', ...extra,
});

describe('D · pedido à recepção: sem duplicar', () => {
  it('o segundo pedido para o mesmo atendimento devolve o aberto, sem criar outra tarefa', () => {
    const d = db();
    const a = createTaskTx(d, pedido());
    const b = createTaskTx(d, pedido());
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.task?.id).toBe(a.task?.id);
    expect(d.tasks.filter((t: any) => t.encounterId === 'enc-1')).toHaveLength(1);
  });
  it('depois de concluído, um novo pedido para o mesmo atendimento é criado', () => {
    const d = db();
    const a = createTaskTx(d, pedido());
    d.tasks.find((t: any) => t.id === a.task!.id).status = 'done';
    const c = createTaskTx(d, pedido());
    expect(c.created).toBe(true);
    expect(d.tasks).toHaveLength(2);
  });
  it('atendimentos diferentes geram pedidos diferentes', () => {
    const d = db();
    expect(createTaskTx(d, pedido('enc-1')).created).toBe(true);
    expect(createTaskTx(d, pedido('enc-2')).created).toBe(true);
    expect(d.tasks).toHaveLength(2);
  });
  it('o pedido guarda o atendimento e quem pediu', () => {
    const d = db();
    const a = createTaskTx(d, pedido());
    expect(a.task?.encounterId).toBe('enc-1');
    expect(a.task?.createdBy).toBe('user-michele');
  });
});
