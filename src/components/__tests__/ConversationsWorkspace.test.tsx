// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { apiGet, apiSend } from '@/lib/api-client';
import { loadMe } from '@/lib/session-me';
import { ConversationsView } from '../dashboard/ConversationsView';

const navigationState = vi.hoisted(() => ({ query: 'b=biz-1', replacements: [] as string[] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (href: string) => {
    navigationState.replacements.push(href);
    navigationState.query = href.split('?')[1] || '';
  } }),
  useSearchParams: () => new URLSearchParams(navigationState.query),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock('@/lib/session-me', () => ({ loadMe: vi.fn() }));
vi.mock('@/components/dashboard/QuickRegisterSheet', () => ({ QuickRegisterSheet: () => null }));
vi.mock('@/components/dashboard/WorkspaceSheet', () => ({
  WorkspaceSheet: ({ open, title, children }: any) => open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

const rows = [
  { id: 'alpha', name: 'Beatriz Lima', phone: '5521999001000', status: 'open', mode: 'automation', agentState: 'ai_active', unread: 2, lastMessageAt: '2026-09-28T15:00:00.000Z', lastMessagePreview: 'Oi, preciso de ajuda', registered: true, channel: 'whatsapp', failedMessages: 0 },
  { id: 'beta', name: 'Caio Souza', phone: '5521999002000', status: 'open', mode: 'human', agentState: 'waiting_team', unread: 0, lastMessageAt: '2026-09-28T14:00:00.000Z', lastMessagePreview: 'Pode confirmar?', registered: false, channel: 'instagram', channelUsername: 'caio.souza', failedMessages: 1 },
];
const waData = {
  label: { detail: 'Conecte um canal para começar.' }, inbox: { open: 2, unread: 2 },
  integration: { displayPhone: '5521999000000' }, linkFallback: 'https://wa.me/5521999000000',
} as any;
const sideContext = {
  tutor: { name: 'Beatriz Lima', phone: '5521999001000', registered: true },
  pets: [{ id: 'pet-1', name: 'Tico', species: 'cachorro' }], currentPatient: { id: 'pet-1', name: 'Tico' },
  phone: '5521999001000', nextAppointment: { date: '29/09/2026', time: '10:30', service: 'Consulta' },
  responsible: 'Dra. Maia', lead: { id: 'lead-1', stage: 'Contato feito' }, channel: 'whatsapp',
};
const messages = [
  { id: 'm-in', direction: 'in', body: 'Olá, tudo bem?', status: 'read', at: '2026-09-28T14:50:00.000Z' },
  { id: 'm-out', direction: 'out', body: 'Olá, Beatriz!', status: 'delivered', by: 'automation', at: '2026-09-28T14:51:00.000Z' },
] as any;

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({
    matches, media: '(max-width: 1199px)', onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) });
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.query = 'b=biz-1';
  navigationState.replacements = [];
  installMatchMedia(false);
  vi.mocked(loadMe).mockResolvedValue({ ok: true, data: { businesses: [{ id: 'biz-1', clinicType: 'veterinaria' }] } } as any);
  vi.mocked(apiGet).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/whatsapp')) return { ok: true, status: 200, data: waData } as any;
    if (url.includes('&id=')) {
      const id = new URL(url, 'https://test.invalid').searchParams.get('id')!;
      const conversation = rows.find((row) => row.id === id)!;
      return { ok: true, status: 200, data: { conversation, messages, sideContext, window: null } } as any;
    }
    return { ok: true, status: 200, data: { conversations: rows, channels: { whatsapp: true, instagram: true }, instagram: { connected: true, label: '', tone: 'ok', username: 'clinic' } } } as any;
  });
  vi.mocked(apiSend).mockImplementation(async (_url: string, _method: string, body: any) => ({
    ok: true, status: 200, data: { message: { id: 'm-sent', direction: 'out', body: body.body, status: 'sent', at: '2026-09-28T15:10:00.000Z' } },
  }) as any);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function renderWorkspace() {
  render(<ConversationsView />);
  await screen.findByRole('region', { name: 'Inbox de conversas' });
}

async function openConversation(id: string, name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
  await screen.findByRole('heading', { name, level: 2 });
  expect(navigationState.replacements.some((href) => new URL(href, 'https://test.invalid').searchParams.get('c') === id)).toBe(true);
}

describe('workspace operacional de Conversas', () => {
  it('estado sem seleção é equilibrado e mantém inbox/contexto; filtro de aguardando funciona', async () => {
    await renderWorkspace();
    expect(screen.getByRole('heading', { name: 'Escolha uma conversa' })).toBeTruthy();
    expect(screen.getByText(/contexto administrativo aparecerá aqui/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aguardando' }));
    expect(screen.getByRole('button', { name: /Caio Souza/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Beatriz Lima/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Não lidas' }));
    expect(screen.getByRole('button', { name: /Beatriz Lima/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Caio Souza/ })).toBeNull();
  });

  it('seleção, URL c=, status IA/equipe e contexto veterinário administrativo', async () => {
    await renderWorkspace();
    await openConversation('alpha', 'Beatriz Lima');
    expect(screen.getByRole('status').textContent).toContain('IA atendendo');
    expect(screen.getByText('Tutor')).toBeTruthy();
    expect(screen.getByText('Paciente atual')).toBeTruthy();
    expect(screen.getAllByText('Tico').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Próximo agendamento')).toBeTruthy();
    expect(screen.getByText('Dra. Maia')).toBeTruthy();
    expect(screen.queryByText('Último handoff')).toBeNull();
    expect(screen.queryByText(/prontuário/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pausar IA' }));
    await screen.findByRole('button', { name: 'Devolver para IA' });
    expect(apiSend).toHaveBeenCalledWith('/api/conversations', 'POST', expect.objectContaining({ conversationId: 'alpha', action: 'pause_ai', mode: 'human' }), expect.anything());
    expect(screen.getByRole('status').textContent).toContain('Equipe atendendo');
  });

  it('rascunho fica por conversa e envio manual otimista assume equipe, sem pausar ao digitar', async () => {
    await renderWorkspace();
    await openConversation('alpha', 'Beatriz Lima');
    const composer = screen.getByRole('textbox', { name: 'Mensagem' }) as HTMLInputElement;
    expect(composer.value).toBe('');
    expect(screen.getByRole('log', { name: /Mensagens com Beatriz/ })).toBeTruthy();
    expect(within(screen.getByRole('log')).getByText('Olá, tudo bem?')).toBeTruthy();
    fireEvent.change(composer, { target: { value: 'rascunho da Beatriz' } });
    expect(screen.getByText(/IA atendendo · ao enviar uma resposta, você assume a conversa/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('IA atendendo');
    expect(apiSend).not.toHaveBeenCalled();
    await openConversation('beta', 'Caio Souza');
    expect((screen.getByRole('textbox', { name: 'Mensagem' }) as HTMLInputElement).value).toBe('');
    await openConversation('alpha', 'Beatriz Lima');
    const restored = screen.getByRole('textbox', { name: 'Mensagem' }) as HTMLInputElement;
    expect(restored.value).toBe('rascunho da Beatriz');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(apiSend).toHaveBeenCalledWith('/api/conversations', 'POST', expect.objectContaining({ conversationId: 'alpha', body: 'rascunho da Beatriz' }), expect.anything()));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Equipe atendendo'));
    expect(screen.getByRole('button', { name: 'Devolver para IA' })).toBeTruthy();
    expect(screen.queryByText(/ao enviar uma resposta, você assume/)).toBeNull();
    expect(screen.queryByText('IA atendendo', { exact: true })).toBeNull();
  });

  it('não inventa paciente quando currentPatient não veio vinculado no contexto', async () => {
    vi.mocked(apiGet).mockImplementation(async (url: string) => {
      if (url.startsWith('/api/whatsapp')) return { ok: true, status: 200, data: waData } as any;
      if (url.includes('&id=')) {
        const id = new URL(url, 'https://test.invalid').searchParams.get('id')!;
        const conversation = rows.find((row) => row.id === id)!;
        return { ok: true, status: 200, data: { conversation, messages, sideContext: { ...sideContext, currentPatient: undefined }, window: null } } as any;
      }
      return { ok: true, status: 200, data: { conversations: rows, channels: { whatsapp: true, instagram: true }, instagram: { connected: true, label: '', tone: 'ok', username: 'clinic' } } } as any;
    });
    await renderWorkspace();
    await openConversation('alpha', 'Beatriz Lima');
    expect(screen.getByText('Tico')).toBeTruthy();
    expect(screen.queryByText('Paciente atual')).toBeNull();
    expect(screen.queryByText('Paciente atual não identificado.')).toBeNull();
  });

  it('contexto desktop recolhe e restaura sem perder a conversa selecionada', async () => {
    await renderWorkspace();
    await openConversation('alpha', 'Beatriz Lima');
    const view = document.querySelector('.conversation-view')!;
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contexto' }));
    expect(view.getAttribute('data-context-open')).toBe('false');
    expect(screen.getByRole('heading', { name: 'Beatriz Lima', level: 2 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contexto' }));
    expect(view.getAttribute('data-context-open')).toBe('true');
    expect(screen.getByText('Tutor')).toBeTruthy();
  });

  it('deep-link c abre a conversa após carregar a lista e conserva q/canal', async () => {
    navigationState.query = 'b=biz-1&q=caio&canal=instagram&c=beta';
    render(<ConversationsView />);
    await screen.findByRole('heading', { name: 'Caio Souza', level: 2 });
    expect(screen.getByRole('button', { name: 'Instagram' }).getAttribute('aria-pressed')).toBe('true');
    expect(navigationState.replacements.some((href) => {
      const query = new URL(href, 'https://test.invalid').searchParams;
      return query.get('c') === 'beta' && query.get('q') === 'caio' && query.get('canal') === 'instagram';
    })).toBe(true);
  });

  it('mobile seleciona chat full-screen, botão voltar retorna à lista e contexto abre em sheet', async () => {
    installMatchMedia(true);
    await renderWorkspace();
    const workspace = document.querySelector('.conversation-view')!;
    await openConversation('alpha', 'Beatriz Lima');
    expect(workspace.getAttribute('data-active')).toBe('true');
    expect(screen.getAllByRole('button', { name: 'Contexto' })).toHaveLength(1);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.inbox-context-trigger')!);
    expect(await screen.findByRole('dialog', { name: 'Tutor e paciente' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à lista de conversas' }));
    await waitFor(() => expect(workspace.getAttribute('data-active')).toBe('false'));
    expect(screen.getByRole('region', { name: 'Inbox de conversas' })).toBeTruthy();
  });

  it('abrir separado preserva unidade, deep-link e canal; modo foco é reversível sem Escape', async () => {
    navigationState.query = 'b=biz-1&c=alpha&q=beatriz&canal=whatsapp';
    await renderWorkspace();
    const open = vi.spyOn(globalThis.window, 'open').mockImplementation(() => null);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir separado' }));
    const openedUrl = new URL(open.mock.calls[0][0] as string, 'https://test.invalid');
    expect(open.mock.calls[0].slice(1)).toEqual(['_blank', 'noopener,noreferrer']);
    expect(openedUrl.pathname).toBe('/conversas');
    expect(Object.fromEntries(openedUrl.searchParams)).toEqual({ b: 'biz-1', c: 'alpha', q: 'beatriz', canal: 'whatsapp', focus: '1', standalone: '1' });
    const view = document.querySelector('.conversation-view')!;
    fireEvent.click(screen.getByRole('button', { name: 'Modo foco' }));
    expect(view.getAttribute('data-focus')).toBe('true');
    expect(view.getAttribute('data-context-open')).toBe('false');
    expect(new URLSearchParams(navigationState.query).get('focus')).toBe('1');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.getAttribute('data-focus')).toBe('true');
    fireEvent.click(document.querySelector<HTMLButtonElement>('.conversation-pagebar .conversation-focus-toggle')!);
    expect(view.getAttribute('data-focus')).toBe('false');
    expect(view.getAttribute('data-context-open')).toBe('true');
    expect(new URLSearchParams(navigationState.query).has('focus')).toBe(false);
  });
});
