// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Field, Input, Select, Tabs, Textarea } from '../ui';
import { PhoneBRInput } from '../dashboard/PhoneBRInput';

afterEach(cleanup);

function Selection({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('agenda');
  return <>
    <button>Antes</button>
    <Tabs ariaLabel="Visualização" value={value} onChange={setValue} items={[
      { id: 'agenda', label: 'Agenda', disabled },
      { id: 'off', label: 'Indisponível', disabled: true },
      { id: 'fila', label: 'Fila', disabled },
      { id: 'lista', label: 'Lista', disabled },
    ]} />
    <button>Depois</button>
    <output>{value}</output>
  </>;
}

describe('Tabs — behavior, not CSS', () => {
  it('has one tab stop; arrows wrap, skip disabled and move focus with selection', async () => {
    const user = userEvent.setup();
    render(<Selection />);
    await user.tab(); await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Agenda' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Fila', selected: true }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Lista', selected: true }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Agenda', selected: true }));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Lista', selected: true }));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Agenda', selected: true }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Depois' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Agenda' }));
  });

  it('supports click/Enter/Space and does not submit the surrounding form', async () => {
    const user = userEvent.setup(); const submit = vi.fn((e) => e.preventDefault());
    render(<form onSubmit={submit}><Selection /></form>);
    await user.click(screen.getByRole('tab', { name: 'Lista' }));
    expect(screen.getByRole('tab', { name: 'Lista', selected: true })).toBeTruthy();
    await user.keyboard('{Enter} ');
    expect(submit).not.toHaveBeenCalled();
  });

  it('remains navigable with a stale/disabled value; all-disabled and empty are inert', async () => {
    const user = userEvent.setup(); const change = vi.fn();
    const { rerender } = render(<Tabs ariaLabel="Estados" value="gone" onChange={change} items={[
      { id: 'a', label: 'A', disabled: true }, { id: 'b', label: 'B' },
    ]} />);
    await user.tab(); expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'B' }));
    expect(change).not.toHaveBeenCalled();
    rerender(<Selection disabled />);
    await user.click(screen.getByRole('tab', { name: 'Fila' }));
    expect(screen.getByRole('status').textContent).toBe('agenda');
    rerender(<Tabs ariaLabel="Vazio" value="none" onChange={change} items={[]} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('uses stable unique IDs and opt-in real panel associations without dangling defaults', () => {
    const { rerender } = render(<><Selection /><Selection /></>);
    const tabs = screen.getAllByRole('tab');
    expect(new Set(tabs.map((t) => t.id)).size).toBe(tabs.length);
    expect(tabs.every((t) => !t.hasAttribute('aria-controls'))).toBe(true);
    const id = tabs[0].id;
    rerender(<><Selection /><Selection /></>);
    expect(screen.getAllByRole('tab')[0].id).toBe(id);
    rerender(<><Tabs ariaLabel="Seções" idPrefix="sections" value="a" onChange={() => {}}
      items={[{ id: 'a', label: 'Conteúdo', panelId: 'content-panel' }]} />
      <div id="content-panel" role="tabpanel" aria-labelledby="sections-tab-a">Conteúdo real</div></>);
    const tab = screen.getByRole('tab');
    expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBe(screen.getByRole('tabpanel'));
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab.id);
  });
});

describe('Field — accessible labeling through existing consumers', () => {
  it('associates label/help/error, preserves explicit IDs, required policy and caller descriptions', () => {
    render(<><p id="extra">Formato original</p>
      <Field label="Nome" hint="Nome completo" error="Revise o nome" required>
        <Input id="person-name" aria-describedby="extra" defaultValue="Sintético" />
      </Field></>);
    const input = screen.getByRole('textbox', { name: 'Nome' });
    expect((input as HTMLInputElement).labels?.[0].htmlFor).toBe(input.id);
    expect(input.id).toBe('person-name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.hasAttribute('required')).toBe(false); // no new form validation policy
    expect(input.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent))
      .toEqual(['Formato original', 'Nome completo', 'Revise o nome']);
  });

  it('works through PhoneBRInput without changing its mask/value contract', async () => {
    const user = userEvent.setup(); const change = vi.fn();
    render(<Field label="WhatsApp" hint="Opcional"><PhoneBRInput value="21987654321" onChange={change} /></Field>);
    const input = screen.getByRole('textbox', { name: 'WhatsApp' });
    expect((input as HTMLInputElement).value).toBe('(21) 98765-4321');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Opcional');
    await user.click(screen.getByText('WhatsApp'));
    expect(document.activeElement).toBe(input);
    await user.keyboard('{Backspace}'); expect(change).toHaveBeenCalled();
  });

  it('supports Select, Textarea, native controls and unique generated IDs', () => {
    render(<><Field label="Papel"><Select defaultValue="viewer"><option value="viewer">Visualizador</option></Select></Field>
      <Field label="Nota"><Textarea /></Field><Field label="Original"><input required /></Field></>);
    const controls = [screen.getByRole('combobox', { name: 'Papel' }), screen.getByRole('textbox', { name: 'Nota' }), screen.getByRole('textbox', { name: 'Original' })];
    expect(new Set(controls.map(c => c.id)).size).toBe(3);
    expect(controls.every(c => !!c.id)).toBe(true);
    expect(controls[2].hasAttribute('required')).toBe(true);
  });

  it('does not replace explicit accessible names/errors and removes stale descriptions on rerender', () => {
    const { rerender } = render(<Field label="Busca" hint="Ajuda"><Input aria-label="Busca de contatos" aria-invalid="grammar" /></Field>);
    expect(screen.getByRole('textbox', { name: 'Busca de contatos' }).getAttribute('aria-invalid')).toBe('grammar');
    rerender(<Field label="Busca"><Input aria-label="Busca de contatos" /></Field>);
    expect(screen.getByRole('textbox').hasAttribute('aria-describedby')).toBe(false);
    expect(screen.getByRole('textbox').hasAttribute('aria-invalid')).toBe(false);
  });
});
