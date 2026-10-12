// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DateField } from '@/components/dashboard/DateField';

// Componente isolado do campo de data canônico (DD/MM/AAAA): máscara, validação real e persistência ISO.
describe('DateField (componente isolado)', () => {
  afterEach(cleanup);
  it('mascara a digitação e emite ISO só para data real', () => {
    const onChange = vi.fn();
    render(<DateField label="DATA DE NASCIMENTO" value="" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'DATA DE NASCIMENTO' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12031990' } });
    expect(input.value).toBe('12/03/1990');
    expect(onChange).toHaveBeenLastCalledWith('1990-03-12', '');
  });

  it('data inexistente emite vazio e mensagem de erro', () => {
    const onChange = vi.fn();
    render(<DateField label="DATA DE NASCIMENTO" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'DATA DE NASCIMENTO' }), { target: { value: '31021990' } });
    const [iso, error] = onChange.mock.calls.at(-1)!;
    expect(iso).toBe('');
    expect(error).toBe('Data inexistente. Confira dia e mês.');
  });

  it('valor ISO externo aparece em DD/MM/AAAA sem deslocar o dia (timezone)', () => {
    render(<DateField label="NASCIMENTO" value="2020-05-01" onChange={() => {}} />);
    expect((screen.getByRole('textbox', { name: 'NASCIMENTO' }) as HTMLInputElement).value).toBe('01/05/2020');
  });

  it('campo vazio é válido mesmo com forceError (nada obrigatório artificialmente)', () => {
    render(<DateField label="NASCIMENTO" value="" onChange={() => {}} forceError />);
    expect(screen.getByRole('textbox', { name: 'NASCIMENTO' }).getAttribute('aria-invalid')).not.toBe('true');
  });
});
