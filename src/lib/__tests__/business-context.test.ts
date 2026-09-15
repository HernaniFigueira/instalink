import { describe, expect, it } from 'vitest';
import {
  businessIdFromRoute, businessIdInList, resolveActiveBusinessId,
} from '../business-context';

// Contexto da empresa (auditoria §5): a URL da API diz QUAL empresa
// (path param); ?businessId= é apenas compatibilidade; no cliente, o ?b=
// nunca é fonte única — cai para a empresa ativa do /api/auth/me.

describe('businessIdFromRoute — a rota manda, a query só complementa', () => {
  it('usa o [id] do path (causa raiz do loop de Recursos corrigida)', () => {
    expect(businessIdFromRoute({ id: 'biz-1' }, null)).toBe('biz-1');
  });

  it('ignora a query quando o path já traz o id', () => {
    const req = { nextUrl: { searchParams: { get: () => 'biz-outro' } } };
    expect(businessIdFromRoute({ id: 'biz-1' }, req)).toBe('biz-1');
  });

  it('cai para ?businessId= apenas como compatibilidade', () => {
    const req = { nextUrl: { searchParams: { get: () => 'biz-2' } } };
    expect(businessIdFromRoute({ id: '' }, req)).toBe('biz-2');
    expect(businessIdFromRoute(undefined, req)).toBe('biz-2');
  });

  it('vazio quando nada informa a empresa', () => {
    expect(businessIdFromRoute(undefined, null)).toBe('');
    expect(businessIdFromRoute({ id: '  ' }, null)).toBe('');
  });
});

describe('resolveActiveBusinessId — ?b= explícito, mas nunca frágil', () => {
  const list = [{ id: 'biz-a' }, { id: 'biz-b' }];

  it('respeita o ?b= quando ele pertence à conta', () => {
    expect(resolveActiveBusinessId('biz-b', list)).toBe('biz-b');
  });

  it('cai para a empresa ativa (1ª) quando falta ?b=', () => {
    expect(resolveActiveBusinessId(null, list)).toBe('biz-a');
    expect(resolveActiveBusinessId('', list)).toBe('biz-a');
  });

  it('cai para a empresa ativa quando o ?b= não é da conta', () => {
    expect(resolveActiveBusinessId('biz-de-outra-pessoa', list)).toBe('biz-a');
  });

  it('vazio quando a conta não tem empresa (estado próprio na tela)', () => {
    expect(resolveActiveBusinessId(null, [])).toBe('');
    expect(businessIdInList('x', [])).toBe(false);
  });
});
