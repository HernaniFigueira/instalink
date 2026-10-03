// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { Drawer } from '@/components/ui';
import { NewClientForm } from '@/components/dashboard/NewClientSheet';
import { WORKSPACE_NESTED_PANEL } from '@/lib/workspace-sheet-sizes';

// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · OVERLAY SYSTEM (§19–25)
//   1. dialog = ação focal; sheet = edição extensa; SEM backdrops empilhados;
//   2. Novo agendamento + "Cadastrar novo paciente" = MESMO overlay que
//      expande lateralmente (base ~680–760px → expandido ~1000–1120px);
//   3. lado recuado/atenuado; após salvar, o painel base volta com o
//      paciente selecionado e OS DADOS ANTERIORES PRESERVADOS;
//   4. header/ícone/fechar/padding/footer padronizados (Drawer).
// ═══════════════════════════════════════════════════════════════

// <dialog> nativo não existe por completo em jsdom (showModal/close).
beforeEach(() => {
  (HTMLDialogElement.prototype as any).showModal = function () { this.setAttribute('open', ''); };
  (HTMLDialogElement.prototype as any).close = function () { this.removeAttribute('open'); };
  document.body.innerHTML = '';
});
afterEach(cleanup);

function Harness({ withSide }: { withSide: boolean }) {
  const [side, setSide] = useState(withSide);
  return (
    <Drawer
      open
      onClose={() => {}}
      title="Novo agendamento"
      subtitle="Paciente → serviço → data e horário → confirmação"
      width="max-w-[720px]"
      side={side ? <button onClick={() => setSide(false)}>Salvar cliente</button> : undefined}
      sideTitle="Cadastrar novo paciente"
      sideWidth="max-w-[400px]"
      onSideClose={() => setSide(false)}
    >
      <input aria-label="serviço" defaultValue="Consulta veterinária" />
    </Drawer>
  );
}

describe('§19–25 · overlay único que expande', () => {
  it('base: um dialog, header padronizado, sem painel lateral', () => {
    render(<Harness withSide={false} />);
    const dialog = document.querySelector('dialog.il-drawer')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Novo agendamento')).toBeTruthy();
    expect(screen.getByLabelText('serviço')).toBeTruthy();
    expect(screen.queryByText('Cadastrar novo paciente')).toBeNull();
    expect(dialog.getAttribute('data-expanded')).toBeNull();
  });

  it('expandido: MESMO dialog, base recuada/atenuada, lado presente', () => {
    render(<Harness withSide={true} />);
    const dialog = document.querySelector('dialog.il-drawer')!;
    expect(dialog.getAttribute('data-expanded')).toBe('true');
    // base ainda visível (recuada), com o conteúdo anterior preservado
    const base = document.querySelector('.il-drawer__panel--base')!;
    expect(base.classList.contains('il-drawer__panel--recessed')).toBe(true);
    expect(screen.getByLabelText('serviço')).toBeTruthy();
    // lado com o título do cadastro
    expect(screen.getByText('Cadastrar novo paciente')).toBeTruthy();
    const side = document.querySelector('.il-drawer__panel--side')!;
    // Composição 50/50: base e lado usam o MESMO preset compartilhado (a
    // simetria é o contrato — nada de base esticado + auxiliar estreito).
    for (const cls of WORKSPACE_NESTED_PANEL.split(' ')) {
      expect(side.classList.contains(cls)).toBe(true);
      expect(base.classList.contains(cls)).toBe(true);
    }
    expect(side.classList.contains('max-w-[400px]')).toBe(false);
  });

  it('UM backdrop apenas (não há overlay empilhado)', () => {
    render(<Harness withSide={true} />);
    const dialogs = document.querySelectorAll('dialog');
    expect(dialogs).toHaveLength(1);
    // o backdrop é interno ao único dialog (não um dialog separado)
    expect(document.querySelectorAll('dialog dialog').length).toBe(0);
  });

  it('após salvar/voltar: o painel base volta com os dados anteriores PRESERVADOS', () => {
    render(<Harness withSide={true} />);
    // usuário digitou algo no fluxo do agendamento antes de cadastrar
    fireEvent.change(screen.getByLabelText('serviço'), { target: { value: 'Banho e tosa' } });
    // salva o cadastro (o form chama onSaved → o pai fecha o lado)
    fireEvent.click(screen.getByText('Salvar cliente'));
    // lado fechado; overlay de volta ao base
    expect(screen.queryByText('Cadastrar novo paciente')).toBeNull();
    const dialog = document.querySelector('dialog.il-drawer')!;
    expect(dialog.getAttribute('data-expanded')).toBeNull();
    // O DADO ANTERIOR DO AGENDAMENTO FOI PRESERVADO
    expect((screen.getByLabelText('serviço') as HTMLInputElement).value).toBe('Banho e tosa');
  });
});

describe('§19–25 · NewClientForm embedded (cadastro rápido no lado)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ ok: true, contact: { id: 'cont-1', name: 'Tereza' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as any;
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('traz o rodapé próprio com as strings travadas (tutor e pet)', () => {
    render(
      <NewClientForm
        embedded businessId="biz-1" vetMode
        initialName="Tereza" initialPhone="21912345678"
        onClose={() => {}} onSaved={() => {}}
      />,
    );
    // §21 — o rápido em veterinária NASCE com o pet rápido ligado
    expect(screen.getByText('Salvar tutor e pet')).toBeTruthy();
    expect(screen.getByText('Cancelar')).toBeTruthy();
    expect(screen.queryByText('Aceita receber promoções?')).toBeNull();
    // desliga o pet → vira cadastro só de tutor
    fireEvent.click(screen.getByLabelText('Adicionar pet'));
    expect(screen.getByText('Salvar cliente')).toBeTruthy();
  });

  it('salva e devolve o paciente selecionado (onSaved com contactId)', async () => {
    const onSaved = vi.fn();
    render(
      <NewClientForm
        embedded businessId="biz-1" vetMode={false}
        initialName="Tereza Alves" initialPhone="21912345678"
        onClose={() => {}} onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByText('Salvar cliente'));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith('cont-1', { contactId: 'cont-1' }));
  });

  it('valida o mínimo sem tocar na rede (nome/telefone)', async () => {
    const onSaved = vi.fn();
    render(
      <NewClientForm
        embedded businessId="biz-1"
        onClose={() => {}} onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByText('Salvar cliente'));
    expect(await screen.findByText('Informe o nome do cliente.')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
