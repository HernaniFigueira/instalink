import { describe, expect, it } from 'vitest';
import {
  AREA_LABELS, areaLabel, decideAuthedResponse, deniedInfo, describeApiError,
  isPermissionDenied, isSessionExpired, sessionFlowFor, startsLoginFlow,
  GENERIC_ERROR_MESSAGE, NETWORK_MESSAGE, PERMISSION_MESSAGES, SESSION_EXPIRED_MESSAGE,
  STATUS_FORBIDDEN, STATUS_UNAUTHORIZED,
} from '../http';

// Regra definitiva do produto:
//   401 → sessão inválida/expirada → fluxo de login;
//   403 → usuário logado SEM permissão → mensagem amigável, sessão INTACTA.
describe('http — 401 ≠ 403', () => {
  it('somente 401 inicia o fluxo de login', () => {
    expect(sessionFlowFor(STATUS_UNAUTHORIZED)).toBe('login');
    expect(startsLoginFlow(STATUS_UNAUTHORIZED)).toBe(true);
    expect(isSessionExpired(STATUS_UNAUTHORIZED)).toBe(true);
  });

  it('403 nunca inicia fluxo de login nem encerra a sessão', () => {
    expect(sessionFlowFor(STATUS_FORBIDDEN)).toBe('stay');
    expect(startsLoginFlow(STATUS_FORBIDDEN)).toBe(false);
    expect(isSessionExpired(STATUS_FORBIDDEN)).toBe(false);
    expect(isPermissionDenied(STATUS_FORBIDDEN)).toBe(true);
  });

  it('nenhum outro status vira sessão expirada', () => {
    for (const status of [0, 200, 400, 404, 409, 422, 429, 500, 503]) {
      expect(sessionFlowFor(status)).toBe('stay');
      expect(startsLoginFlow(status)).toBe(false);
    }
  });
});

describe('http — mensagem de 403', () => {
  it('usa a mensagem canônica de ação e mantém a sessão', () => {
    const info = deniedInfo({ scope: 'action', area: 'Agenda' });
    expect(info.status).toBe(403);
    expect(info.keepsSession).toBe(true);
    expect(info.title).toBe(PERMISSION_MESSAGES.action);
    expect(info.hint).toContain('Agenda');
  });

  it('usa a mensagem canônica de área quando o 403 é da rota inteira', () => {
    const info = deniedInfo({ scope: 'area', area: 'Equipe' });
    expect(info.title).toBe(PERMISSION_MESSAGES.area);
    expect(info.title).not.toBe(PERMISSION_MESSAGES.action);
  });

  it('nunca mostra o erro cru do servidor como título (entra só como detalhe)', () => {
    const raw = 'Acesso negado: membro inativo';
    const info = deniedInfo({ scope: 'action', area: 'Agenda' }, raw);
    expect(info.title).toBe(PERMISSION_MESSAGES.action);
    expect(info.title).not.toContain('membro inativo');
    expect(info.hint).toContain(raw);
  });

  it('tem mensagem específica para somente-leitura e para ação de dono', () => {
    expect(deniedInfo({ scope: 'action', readOnly: true }).title).toBe(PERMISSION_MESSAGES.readOnly);
    expect(deniedInfo({ scope: 'action', adminOnly: true }).title).toBe(PERMISSION_MESSAGES.adminOnly);
  });
});

describe('http — describeApiError', () => {
  it('preserva a mensagem do servidor em erros de negócio', () => {
    expect(describeApiError(409, 'Este horário está ocupado. Escolha outro.')).toBe('Este horário está ocupado. Escolha outro.');
    expect(describeApiError(400, 'Escolha data e horário.')).toBe('Escolha data e horário.');
  });

  it('403 devolve a frase canônica (não o texto cru)', () => {
    expect(describeApiError(403, 'forbidden')).toBe(PERMISSION_MESSAGES.action);
  });

  it('401 devolve a frase de sessão expirada', () => {
    expect(describeApiError(401)).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it('falha de rede tem mensagem própria', () => {
    expect(describeApiError(0)).toBe(NETWORK_MESSAGE);
  });

  it('500 e 429 têm mensagens amigáveis quando o servidor não explica', () => {
    expect(describeApiError(500)).toContain('servidor');
    expect(describeApiError(429)).toContain('Muitas tentativas');
    expect(describeApiError(418)).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe('http — decideAuthedResponse (ponto único de decisão)', () => {
  it('200: ok, sem mensagem e sem denied', () => {
    const d = decideAuthedResponse(200);
    expect(d.ok).toBe(true);
    expect(d.message).toBe('');
    expect(d.denied).toBeNull();
    expect(d.flow).toBe('stay');
  });

  it('401: flow login, denied nulo (não é permissão)', () => {
    const d = decideAuthedResponse(401);
    expect(d.ok).toBe(false);
    expect(d.flow).toBe('login');
    expect(d.denied).toBeNull();
    expect(d.message).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it('403: flow stay + denied preenchido + keepsSession', () => {
    const d = decideAuthedResponse(403, 'Não autorizado.', { scope: 'area', area: 'Serviços' });
    expect(d.ok).toBe(false);
    expect(d.flow).toBe('stay');
    expect(d.denied?.keepsSession).toBe(true);
    expect(d.denied?.title).toBe(PERMISSION_MESSAGES.area);
    expect(d.message).toBe(PERMISSION_MESSAGES.area);
  });

  it('erro de negócio: flow stay, mensagem do servidor, sem denied', () => {
    const d = decideAuthedResponse(409, 'Este horário está ocupado. Escolha outro.');
    expect(d.flow).toBe('stay');
    expect(d.denied).toBeNull();
    expect(d.message).toBe('Este horário está ocupado. Escolha outro.');
  });
});

describe('http — áreas', () => {
  it('rotula as áreas conhecidas do painel', () => {
    expect(areaLabel('agenda')).toBe('Agenda');
    expect(areaLabel('equipe')).toBe('Equipe');
    expect(areaLabel('config')).toBe('Configurações');
    expect(AREA_LABELS.dashboard).toBe('Dashboard');
  });

  it('sem rótulo conhecido, devolve o que recebeu (e vazio quando não há área)', () => {
    expect(areaLabel('xyz')).toBe('xyz');
    expect(areaLabel()).toBe('');
  });
});
