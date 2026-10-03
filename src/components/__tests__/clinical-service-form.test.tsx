// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ServiceForm } from '../dashboard/catalog-panels';
vi.mock('@/lib/api-client', () => ({ apiSend: vi.fn(async () => ({ok:true,data:{categoryId:'consultas'}})) }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open',''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);
const props = {businessId:'qa',cats:[{id:'consultas',name:'Consultas'}] as any,pros:[],resources:[],onClose:vi.fn()};
describe('Clinical service form', () => {
  it('offers library on focus without typing; keyboard chooses suggested name/duration/group; free text still allowed', async () => {
    render(<ServiceForm {...props} service={null} onSave={vi.fn()} />);
    const input = screen.getByRole('combobox', {name:'Serviço / procedimento'}) as HTMLInputElement;
    fireEvent.focus(input);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.keyDown(input, {key:'ArrowDown'});
    fireEvent.keyDown(input, {key:'Enter'});
    expect(input.value).not.toBe('');
    expect(Number((screen.getByLabelText('Duração padrão em minutos') as HTMLInputElement).value)).toBeGreaterThan(0);
    fireEvent.change(input,{target:{value:'Procedimento próprio QA'}});
    expect(input.value).toBe('Procedimento próprio QA');
  });
  it('preserves internal description, buffers and resource storage while advanced is initially closed', async () => {
    const save = vi.fn();
    render(<ServiceForm {...props} resources={[{id:'room',name:'Sala QA',kind:'room',active:true}] as any} service={{id:'svc',name:'Consulta',description:'Texto legado',durationMin:30,price:10000,professionalMode:'all',bufferBeforeMin:10,bufferAfterMin:15,resourceRequirements:[['room']]} as any} onSave={save} />);
    const note = screen.getByLabelText('Observação interna') as HTMLTextAreaElement;
    expect(note.value).toBe('Texto legado');
    expect(note.closest('details')?.open).toBe(false);
    const before = screen.getByLabelText('Preparação antes (min)') as HTMLInputElement;
    expect(before.value).toBe('10');
    expect(before.closest('details')?.open).toBe(false);
    fireEvent.submit(note.closest('form')!);
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({description:'Texto legado',bufferBeforeMin:10,bufferAfterMin:15,resourceRequirements:[['room']]})));
  });
});
