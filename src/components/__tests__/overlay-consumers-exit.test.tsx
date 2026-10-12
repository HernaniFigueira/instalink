// @vitest-environment jsdom
// Consumidores migrados para a presença única (useOverlayPresence): nenhum desmonta
// a superfície no mesmo quadro em que o pai fecha. Cobre: fechamento pelo pai,
// X/Escape, reabertura (formulário novo), retorno de foco, movimento reduzido e a
// guarda de salvamento (Escape durante gravação não anima a saída).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { useFrozenWhileClosed } from '@/components/ui';
import { BookingEditDialog } from '@/components/dashboard/BookingEditDialog';
import { DeleteEntityDialog, type DeleteTarget } from '@/components/dashboard/DeleteEntityDialog';
import { DeleteSheet } from '@/components/dashboard/catalog-panels';
import { apiGet, apiRequest } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn(), apiRequest: vi.fn(), apiSend: vi.fn() }));

// jsdom não roda CSS animations: o fim da saída é disparado manualmente (animationend real).
function endAnimation(el: Element | null, animationName: string) {
  if (!el) throw new Error('superfície de saída ausente');
  const ev = new Event('animationend', { bubbles: true });
  Object.defineProperty(ev, 'animationName', { value: animationName });
  act(() => { el.dispatchEvent(ev); });
}

function cancel(el: Element) {
  // Escape nativo do <dialog>: o Drawer/Dialog intercepta em onCancel.
  act(() => { el.dispatchEvent(new Event('cancel', { cancelable: true })); });
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.show) {
    HTMLDialogElement.prototype.show = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
  setReducedMotion(false);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ slots: ['10:00', '10:30'] }) })));
  vi.mocked(apiGet).mockReset();
  vi.mocked(apiRequest).mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setReducedMotion(false);
});

// ───────────────────────── Editor de agendamento (Dialog central) ─────────────────────────
const SERVICE = { id: 's1', name: 'Consulta', durationMinutes: 30, active: true } as any;
const BOOKING_A = { id: 'bk-a', serviceId: 's1', date: '2026-10-20', time: '10:00', professionalId: '', status: 'pending', customerName: 'Ana Souza', petName: 'Luna', note: '' } as any;
const BOOKING_B = { id: 'bk-b', serviceId: 's1', date: '2026-10-21', time: '11:00', professionalId: '', status: 'pending', customerName: 'Bruno Lima', petName: 'Thor', note: '' } as any;

function EditHost({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [editing, setEditing] = useState<any>(null);
  const frozen = useFrozenWhileClosed(!!editing, editing);
  return (
    <>
      <button type="button" onClick={() => setEditing(BOOKING_A)}>abrir A</button>
      <button type="button" onClick={() => setEditing(BOOKING_B)}>abrir B</button>
      {frozen && (
        <BookingEditDialog open={!!editing} booking={frozen} businessId="biz" services={[SERVICE]} pros={[]}
          onClose={() => { onClose(); setEditing(null); }} onChanged={() => {}} />
      )}
    </>
  );
}

describe('Editor de agendamento · saída animada e formulário novo a cada abertura', () => {
  it('"Voltar" (fechamento pelo pai) mantém o diálogo com data-closing até o animationend', () => {
    render(<EditHost />);
    fireEvent.click(screen.getByRole('button', { name: 'abrir A' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar agendamento' });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('dialog', { name: 'Editar agendamento' }).getAttribute('data-closing')).not.toBeNull();
    expect(screen.getByText(/Luna · tutor Ana Souza/)).toBeTruthy(); // conteúdo congelado durante a saída
    endAnimation(dialog, 'gd-dialog-out');
    expect(screen.queryByRole('dialog', { name: 'Editar agendamento' })).toBeNull();
  });

  it('Escape anima a saída e chama onClose uma única vez, depois da animação', () => {
    const onClose = vi.fn();
    render(<EditHost onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'abrir A' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar agendamento' });
    // Escape do Dialog: listener de teclado (captura) em window, com pilha de overlays.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.getAttribute('data-closing')).not.toBeNull();
    endAnimation(dialog, 'gd-dialog-out');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Editar agendamento' })).toBeNull();
  });

  it('reabrir durante a saída cancela a saída e mostra o agendamento novo', () => {
    render(<EditHost />);
    fireEvent.click(screen.getByRole('button', { name: 'abrir A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('button', { name: 'abrir B' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar agendamento' });
    expect(dialog.getAttribute('data-closing')).toBeNull();
    expect(screen.getByText(/Bruno Lima/)).toBeTruthy();
    expect(screen.queryByText(/Ana Souza/)).toBeNull();
  });

  it('movimento reduzido: desmonta na hora, sem estado de saída', () => {
    setReducedMotion(true);
    render(<EditHost />);
    fireEvent.click(screen.getByRole('button', { name: 'abrir A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('dialog', { name: 'Editar agendamento' })).toBeNull();
  });

  it('retorna o foco ao gatilho depois da saída', () => {
    render(<EditHost />);
    const trigger = screen.getByRole('button', { name: 'abrir A' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Editar agendamento' });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    endAnimation(dialog, 'gd-dialog-out');
    expect(document.activeElement).toBe(trigger);
  });
});

// ───────────────────────── Exclusão de entidade (Drawer, Organização) ─────────────────────────
const DELETE_TARGET: DeleteTarget = { kind: 'business', id: 'biz-1', organizationId: 'org-1', name: 'Filial Norte' };
const IMPACT = { allowed: true, name: 'Filial Norte', kind: 'business', removes: [], blockers: [], retained: 'Nada é arquivado.' } as any;

function DeleteHost({ onDeleted = vi.fn() }: { onDeleted?: () => void }) {
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const frozen = useFrozenWhileClosed(!!deleting, deleting);
  return (
    <>
      <button type="button" onClick={() => setDeleting(DELETE_TARGET)}>excluir filial</button>
      {frozen && <DeleteEntityDialog open={!!deleting} target={frozen} onClose={() => setDeleting(null)} onDeleted={onDeleted} />}
    </>
  );
}

describe('Exclusão de entidade · Drawer com saída animada', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockResolvedValue({ ok: true, data: IMPACT, message: '', status: 200 } as any);
  });

  it('Escape fecha animado; reabrir começa com nome e senha zerados', async () => {
    render(<DeleteHost />);
    fireEvent.click(screen.getByRole('button', { name: 'excluir filial' }));
    const drawer = screen.getByRole('dialog', { name: /Excluir filial: Filial Norte/ });
    const nameInput = await screen.findByLabelText(/Digite o nome exato: Filial Norte/);
    fireEvent.change(nameInput, { target: { value: 'Filial Norte' } });
    expect((nameInput as HTMLInputElement).value).toBe('Filial Norte');
    cancel(drawer);
    expect(drawer.getAttribute('data-closing')).not.toBeNull();
    endAnimation(drawer.querySelector('.il-drawer__strip'), 'gd-drawer-strip-out');
    expect(screen.queryByRole('dialog', { name: /Excluir filial/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'excluir filial' }));
    const again = await screen.findByLabelText(/Digite o nome exato: Filial Norte/);
    expect((again as HTMLInputElement).value).toBe('');
  });

  it('Escape durante a gravação não anima a saída: mostra a guarda "Salvando informações"', async () => {
    vi.mocked(apiRequest).mockImplementation(() => new Promise(() => {})); // gravação em andamento
    render(<DeleteHost />);
    fireEvent.click(screen.getByRole('button', { name: 'excluir filial' }));
    const drawer = screen.getByRole('dialog', { name: /Excluir filial: Filial Norte/ });
    fireEvent.change(await screen.findByLabelText(/Digite o nome exato: Filial Norte/), { target: { value: 'Filial Norte' } });
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir filial definitivamente' }));
    await screen.findByText('Verificando e excluindo…');
    cancel(drawer);
    expect(drawer.getAttribute('data-closing')).toBeNull();
    expect(screen.getByText('Salvando informações')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: /Excluir filial: Filial Norte/ })).toBeTruthy();
  });
});

// ───────────────────────── Confirmação de exclusão (DeleteSheet, Serviços e Equipe) ─────────────────────────
function SheetHost({ onConfirm = vi.fn() }: { onConfirm?: () => void }) {
  const [ask, setAsk] = useState<{ name: string; blocked: boolean } | null>(null);
  const frozen = useFrozenWhileClosed(!!ask, ask);
  return (
    <>
      <button type="button" onClick={() => setAsk({ name: 'Ana', blocked: false })}>pedir exclusão</button>
      {frozen && (
        <DeleteSheet open={!!ask} name={frozen.name} kindLabel="profissional" blocked={frozen.blocked}
          onDeactivate={() => {}} onConfirm={onConfirm} onClose={() => setAsk(null)} />
      )}
    </>
  );
}

describe('Confirmação de exclusão · DeleteSheet com saída animada', () => {
  it('"Cancelar" anima a saída mantendo o conteúdo; desmonta só no animationend', () => {
    render(<SheetHost />);
    fireEvent.click(screen.getByRole('button', { name: 'pedir exclusão' }));
    const sheet = screen.getByRole('dialog', { name: 'Excluir profissional' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    const during = screen.getByRole('dialog', { name: 'Excluir profissional' });
    expect(during.getAttribute('data-closing')).not.toBeNull();
    expect(screen.getByText(/Excluir profissional “Ana”\?/)).toBeTruthy();
    endAnimation(sheet.querySelector('.il-drawer__strip'), 'gd-drawer-strip-out');
    expect(screen.queryByRole('dialog', { name: 'Excluir profissional' })).toBeNull();
  });

  it('retorna o foco ao gatilho depois da saída', () => {
    render(<SheetHost />);
    const trigger = screen.getByRole('button', { name: 'pedir exclusão' });
    trigger.focus();
    fireEvent.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Excluir profissional' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    endAnimation(sheet.querySelector('.il-drawer__strip'), 'gd-drawer-strip-out');
    expect(document.activeElement).toBe(trigger);
  });

  it('movimento reduzido: desmonta na hora', () => {
    setReducedMotion(true);
    render(<SheetHost />);
    fireEvent.click(screen.getByRole('button', { name: 'pedir exclusão' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Excluir profissional' })).toBeNull();
  });
});

// ───────────────────────── Contrato de montagem nos pontos corrigidos ─────────────────────────
// Montagem condicional (`{x && <Overlay open …>}`) desmonta no mesmo quadro em que o pai
// fecha e corta a saída. Os pontos abaixo devem manter o pai como dono de `open`.
describe('Contrato de montagem · overlays controlados pelo pai', () => {
  const read = async (path: string) => (await import('node:fs')).readFileSync(path, 'utf8');

  it('Agenda: confirmações de redimensionar/arrastar e editor são controlados, sem montagem condicional', async () => {
    const agenda = await read('src/app/(dashboard)/agenda/page.tsx');
    expect(agenda).toContain('<Drawer open={!!resizeAsk} variant="dialog" dialogWidth="460px"');
    expect(agenda).toContain('<Drawer open={!!dropAsk} variant="dialog" dialogWidth="520px"');
    expect(agenda).toContain('open={!!editBooking}');
    expect(agenda).not.toContain('{resizeAsk && <Drawer');
    expect(agenda).not.toContain('{dropAsk && (');
    expect(agenda).not.toContain('{editBooking && (');
    // Confirmação não confirma duas vezes: a guarda vale mesmo com o conteúdo congelado.
    expect(agenda).toContain('if (!resizeAsk || saving) return;');
  });

  it('Organização, Equipe e Serviços: exclusão e grupos com saída animada', async () => {
    const org = await read('src/app/(dashboard)/organizacao/page.tsx');
    expect(org).toContain('{deletingFrozen&&<DeleteEntityDialog open={!!deleting}');
    expect(org).not.toContain('{deleting&&<DeleteEntityDialog');
    const equipe = await read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).toContain('open={!!askDelete}');
    expect(equipe).not.toContain('{askDelete && (');
    const servicos = await read('src/app/(dashboard)/servicos/page.tsx');
    expect(servicos).toContain('<Drawer open={showCat}');
    expect(servicos).not.toContain('{showCat && (');
    expect(servicos).toContain('open={!!askDelete}');
    expect(servicos).not.toContain('{askDelete && (');
  });

  it('CSS: superfície em saída (data-closing) é inerte — nenhum clique dispara ação durante a animação', async () => {
    const css = await read('src/styles/godoutor-design-system.css');
    expect(css).toMatch(/\.gd-dialog\[data-closing\],\s*\.gd-detail\[data-closing\],\s*\.il-drawer\[data-closing\]\s*\{\s*pointer-events:\s*none;?\s*\}/);
  });
});
