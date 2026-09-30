// @vitest-environment jsdom
// PR #46 · Equipe UX closure — render real do drawer "Gerenciar pessoa" (jsdom).
// Não substitui homologação visual em browser: valida comportamento/estrutura.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { apiGet, apiSend } from '@/lib/api-client';
import EquipePage from '@/app/(dashboard)/equipe/page';

vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('b=biz-ux'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/equipe',
}));
vi.mock('@/components/dashboard/ImageUpload', () => ({ ImageUpload: () => null }));

const NOW = '2026-09-30T12:00:00.000Z';
const PERMS = [
  'dashboard', 'agenda', 'clientes', 'leads', 'pedidos', 'catalogo', 'pagina', 'agente', 'whatsapp',
  'campanhas', 'equipe', 'config', 'financeiro', 'admin', 'atendimento',
].map((id) => ({ id, label: { pedidos: 'Pedidos', pagina: 'Página', agente: 'Assistente', dashboard: 'Visão geral', agenda: 'Agenda', clientes: 'Clientes', leads: 'Oportunidades', catalogo: 'Catálogo', whatsapp: 'WhatsApp', campanhas: 'Campanhas', equipe: 'Equipe', config: 'Configuração', financeiro: 'Financeiro', admin: 'Administração', atendimento: 'Atendimento' }[id] as string, hint: `hint ${id}` }));
const ROLES_API = [
  { id: 'OWNER', label: 'Proprietário', hint: 'Acesso total', permissions: [] },
  { id: 'ADMIN', label: 'Administrador', hint: 'Acesso total exceto plataforma', permissions: [] },
  { id: 'SECRETARIA', label: 'Recepção', hint: 'Agenda, clientes, oportunidades e conversas', permissions: [] },
  { id: 'ATENDENTE', label: 'Atendente', hint: 'legado', permissions: [] },
  { id: 'VENDEDOR', label: 'Vendedor', hint: 'legado', permissions: [] },
  { id: 'VIEWER', label: 'Visualizador', hint: 'legado', permissions: [] },
  { id: 'PROFISSIONAL', label: 'Profissional', hint: 'Própria agenda e atendimento', permissions: [] },
];
const member = (id: string, name: string, role: string, overrides: Record<string, boolean> = {}, professionalId = '') => ({
  id, userId: `u-${id}`, name, email: `${id}@ux.com`, role, permissions: {}, permissionOverrides: overrides,
  phone: '', cpf: '', active: true, note: '', createdAt: NOW, lastLoginAt: '', professionalId, professionalName: '', professionalPhoto: '',
});
const pro = (id: string, name: string, userId: string, follow: boolean) => ({
  id, businessId: 'biz-ux', name, role: 'Cardiologia', photo: '', active: true, userId, followBusinessHours: follow, createdAt: NOW, updatedAt: NOW,
});

let ownRules: any[] = [];
function mockApi(opts: { teamMembers?: any[]; pros?: any[]; rules?: any[]; services?: any[] } = {}) {
  const members = opts.teamMembers || [
    member('maria', 'Maria Recepção', 'SECRETARIA', { agenda: true, dashboard: false, pedidos: false }), // legado redundante
    member('carla', 'Carla Ajuste', 'SECRETARIA', { financeiro: true }), // ajuste REAL
    member('orlando', 'Orlando Vet', 'PROFISSIONAL', {}, 'pro-orlando'),
  ];
  const pros = opts.pros || [pro('pro-orlando', 'Orlando Vet', 'u-orlando', false)];
  vi.mocked(apiGet).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/team')) {
      return { ok: true, status: 200, data: {
        roles: ROLES_API, permissions: PERMS,
        me: { userId: 'owner', role: 'OWNER', isOwner: true, permissions: {} },
        owner: { userId: 'owner', name: 'Dono da Clínica', email: 'dono@ux.com', role: 'OWNER' },
        members,
        professionals: pros.map((p) => ({ id: p.id, name: p.name, role: p.role, active: true, userId: p.userId, photo: '', linkedUserName: '' })),
      } } as any;
    }
    return { ok: true, status: 200, data: {
      professionals: pros, availability: opts.rules ?? ownRules, services: opts.services || [], categories: [],
      historyRefs: { services: [], professionals: [] },
    } } as any;
  });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  ownRules = [];
  vi.mocked(apiSend).mockReset();
});
afterEach(() => cleanup());

async function openPerson(name: string) {
  render(<EquipePage />);
  const row = (await screen.findByText(name)).closest('div.px-4') as HTMLElement;
  const btn = within(row).getAllByText(/gerenciar/i)[0];
  fireEvent.click(btn);
  return await screen.findByText('Gerenciar pessoa');
}
const dialog = () => document.querySelector('dialog') as HTMLElement;

describe('Equipe UX — papéis como presets (render)', () => {
  it('Maria — Recepção: preset automático, sem chips `ajuste`, sem Visão geral/Pedidos/Página/Assistente/Atendimento', async () => {
    mockApi();
    await openPerson('Maria Recepção');
    const d = within(dialog());
    expect(d.getByRole('button', { name: /Recepção/ }).getAttribute('aria-pressed')).toBe('true');
    const summary = d.getByTestId('preset-summary');
    expect(summary.textContent).toContain('Agenda · Clientes · Oportunidades · WhatsApp');
    expect(summary.textContent).not.toMatch(/Visão geral|Pedidos|Página|Assistente|Atendimento/);
    expect(dialog().textContent).not.toMatch(/\bajuste\b/);
    // personalização recolhida por padrão
    expect(d.queryByTestId('personalizar-acesso')).toBeNull();
    expect(d.getByText('Personalizar acesso').getAttribute('aria-expanded')).toBe('false');
    // papéis legados fora do fluxo padrão (dentro de "Outros papéis / avançado")
    expect(d.getByText('Outros papéis / avançado').closest('details')!.hasAttribute('open')).toBe(false);
  });

  it('Personalizar acesso abre o editor SEM Página/Pedidos (legado OFF) e com avançadas agrupadas', async () => {
    mockApi();
    await openPerson('Maria Recepção');
    fireEvent.click(within(dialog()).getByText('Personalizar acesso'));
    const panel = within(dialog()).getByTestId('personalizar-acesso');
    expect(panel.textContent).toContain('Agenda');
    expect(panel.textContent).not.toMatch(/\bPedidos\b|\bPágina\b/);
    const adv = within(panel).getByText('Capacidades avançadas').closest('details')!;
    expect(adv.hasAttribute('open')).toBe(false);
    expect(adv.textContent).toMatch(/Assistente/);
    expect(adv.textContent).toMatch(/Administração/);
    expect(dialog().textContent).not.toMatch(/\bajuste\b/);
  });

  it('Owner: mostra "Proprietário · acesso total" sem editor de papel/permissões', async () => {
    mockApi();
    await openPerson('Dono da Clínica');
    const d = within(dialog());
    expect(d.getByTestId('owner-access-summary').textContent).toContain('Proprietário · acesso total');
    expect(d.queryByRole('group', { name: 'Papel de acesso' })).toBeNull();
    expect(d.queryByText('Personalizar acesso')).toBeNull();
    expect(d.queryByTestId('preset-summary')).toBeNull();
    expect(dialog().querySelectorAll('input[type=checkbox]').length).toBeLessThanOrEqual(1); // só "Realiza atendimentos"
  });

  it('trocar papel com personalização REAL pede confirmação e aplica preset limpo (payload sem overrides antigos)', async () => {
    mockApi();
    vi.mocked(apiSend).mockResolvedValue({ ok: true, status: 200, data: { ok: true, memberId: 'carla' } } as any);
    await openPerson('Carla Ajuste');
    const d = within(dialog());
    expect(dialog().textContent).toMatch(/1 ajuste/); // diferença real
    fireEvent.click(d.getByRole('button', { name: /^Profissional/ }));
    expect(d.getByText(/descarta a personalização atual/)).toBeTruthy();
    expect(d.getByRole('button', { name: /^Recepção/ }).getAttribute('aria-pressed')).toBe('true'); // ainda não trocou
    fireEvent.click(d.getByText('Trocar e descartar ajustes'));
    expect(d.getByRole('button', { name: /^Profissional/ }).getAttribute('aria-pressed')).toBe('true');
    expect(dialog().textContent).not.toMatch(/\bajuste\b/);
    fireEvent.click(d.getByText('Salvar alterações'));
    await waitFor(() => expect(apiSend).toHaveBeenCalled());
    const payload = vi.mocked(apiSend).mock.calls[0][2] as any;
    expect(payload.role).toBe('PROFISSIONAL');
    expect(payload.permissionOverrides).toEqual({});
  });

  it('trocar papel SEM personalização real troca direto (sem confirmação)', async () => {
    mockApi();
    await openPerson('Maria Recepção');
    const d = within(dialog());
    fireEvent.click(d.getByRole('button', { name: /^Administrador/ }));
    expect(d.queryByText(/descarta a personalização/)).toBeNull();
    expect(d.getByRole('button', { name: /^Administrador/ }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Equipe UX — disponibilidade própria (render)', () => {
  it('Orlando: horário próprio sem regras → aviso + CTA com deep-link', async () => {
    mockApi();
    await openPerson('Orlando Vet');
    const d = within(dialog());
    const empty = d.getByTestId('own-hours-empty');
    expect(empty.textContent).toContain('Horário próprio ainda não configurado');
    const cta = within(empty).getByText(/Configurar horários/).closest('a')!;
    expect(cta.getAttribute('href')).toBe('/disponibilidade?b=biz-ux&professionalId=pro-orlando');
  });

  it('Orlando com regra própria: mostra configurado; ao seguir a clínica avisa que o horário próprio fica guardado', async () => {
    mockApi({ rules: [{ id: 'r1', businessId: 'biz-ux', professionalId: 'pro-orlando', serviceId: '', weekday: 1, start: '09:00', end: '12:00', slotMin: 30 }] });
    await openPerson('Orlando Vet');
    const d = within(dialog());
    expect(d.getByTestId('own-hours-configured')).toBeTruthy();
    fireEvent.click(d.getByLabelText('Seguir horário da clínica'));
    expect(d.getByTestId('own-hours-preserved').textContent).toMatch(/fica guardado/);
    fireEvent.click(d.getByLabelText('Usar horário próprio'));
    expect(d.getByTestId('own-hours-configured')).toBeTruthy();
  });
});

describe('Equipe UX — erros do formulário (render)', () => {
  it('erro de API no Salvar: mensagem humana no drawer + scrollIntoView + foco; sem Membro/ID', async () => {
    mockApi();
    const scroll = vi.fn();
    (Element.prototype as any).scrollIntoView = scroll;
    vi.mocked(apiSend).mockResolvedValue({ ok: false, status: 404, message: 'Membro não encontrado.' } as any);
    await openPerson('Maria Recepção');
    fireEvent.click(within(dialog()).getByText('Salvar alterações'));
    const block = await screen.findByTestId('person-form-error');
    expect(block.textContent).toContain('Não encontramos o acesso desta pessoa');
    expect(block.textContent).not.toMatch(/\bMembro\b|\bMember\b|[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(block.getAttribute('role')).toBe('alert');
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(document.activeElement).toBe(block);
    // mesmo erro de novo dispara scroll/foco de novo
    scroll.mockClear();
    fireEvent.click(within(dialog()).getByText('Salvar alterações'));
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });

  it('validação local (CPF inválido): mensagem, scroll/foco e campo marcado aria-invalid; não chama API', async () => {
    mockApi();
    const scroll = vi.fn();
    (Element.prototype as any).scrollIntoView = scroll;
    await openPerson('Maria Recepção');
    fireEvent.change(within(dialog()).getByPlaceholderText('000.000.000-00'), { target: { value: '111.111.111-11' } });
    fireEvent.click(within(dialog()).getByText('Salvar alterações'));
    const block = await screen.findByTestId('person-form-error');
    expect(block.textContent).toMatch(/CPF inválido/);
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(block);
    expect(dialog().querySelector('#pessoa-cpf')!.getAttribute('aria-invalid')).toBe('true');
    expect(apiSend).not.toHaveBeenCalled();
  });
});

describe('Equipe UX — serviço sugerido (render)', () => {
  it('cardiologista → "Consulta cardiológica" com duração SUGERIDA, editável antes de criar', async () => {
    mockApi();
    vi.mocked(apiSend).mockResolvedValue({ ok: true, status: 200, data: { ok: true, professionalId: 'pro-orlando' } } as any);
    await openPerson('Orlando Vet');
    const d = within(dialog());
    fireEvent.change(d.getByPlaceholderText(/Buscar serviço/), { target: { value: 'cardiologista' } });
    const sug = await d.findByText('Consulta cardiológica');
    expect(sug.closest('button')!.textContent).toContain('Duração sugerida · 40 min');
    expect(sug.closest('button')!.textContent).not.toMatch(/\b40min\b/);
    fireEvent.click(sug.closest('button')!);
    const dur = dialog().querySelector('#novo-servico-duracao') as HTMLInputElement;
    expect(dur.value).toBe('40');
    expect(dialog().textContent).toContain('Duração sugerida · 40 min — ajuste conforme a rotina da clínica.');
    fireEvent.change(dur, { target: { value: '50' } });
    fireEvent.click(d.getByText('Criar e vincular'));
    expect(dialog().textContent).toContain('Consulta cardiológica');
    expect(dialog().textContent).toContain('50min');
    fireEvent.click(d.getByText('Salvar alterações'));
    await waitFor(() => expect(apiSend).toHaveBeenCalled());
    const payload = vi.mocked(apiSend).mock.calls[0][2] as any;
    expect(payload.pendingServices).toHaveLength(1);
    expect(payload.pendingServices[0]).toMatchObject({ name: 'Consulta cardiológica', durationMin: 50 });
  });

  it('serviço manual: duração começa vazia (nenhum número escondido) e é obrigatória', async () => {
    mockApi();
    const scroll = vi.fn();
    (Element.prototype as any).scrollIntoView = scroll;
    await openPerson('Orlando Vet');
    const d = within(dialog());
    fireEvent.change(d.getByPlaceholderText(/Buscar serviço/), { target: { value: 'Zzz serviço novo' } });
    fireEvent.click(await d.findByText(/Criar 'Zzz serviço novo'/));
    const dur = dialog().querySelector('#novo-servico-duracao') as HTMLInputElement;
    expect(dur.value).toBe('');
    fireEvent.click(d.getByText('Criar e vincular'));
    const block = await screen.findByTestId('person-form-error');
    expect(block.textContent).toMatch(/duração/i);
  });

  it('sugestão que já existe como Service não é oferecida de novo (sem duplicar)', async () => {
    mockApi({ services: [{ id: 's1', businessId: 'biz-ux', name: 'Consulta cardiológica', durationMin: 50, price: 0, active: true, bookable: true, professionalIds: [], categoryId: '' }] });
    await openPerson('Orlando Vet');
    const d = within(dialog());
    fireEvent.change(d.getByPlaceholderText(/Buscar serviço/), { target: { value: 'cardiologista' } });
    expect(d.queryByText(/Duração sugerida · 40 min/)).toBeNull();
  });
});
