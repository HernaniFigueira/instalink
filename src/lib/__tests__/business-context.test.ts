import { describe, expect, it } from 'vitest';
import {
  businessIdFromRoute, businessIdInList, resolveActiveBusinessId,
} from '../business-context';

describe('businessIdFromRoute — a rota manda, a query só complementa', () => {
  it('usa o [id] do path', () => {
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

describe('resolveActiveBusinessId — contexto explícito, nunca pela ordem do banco', () => {
  const list = [{ id: 'biz-a' }, { id: 'biz-b' }];

  it('respeita o ?b= quando ele pertence à conta', () => {
    expect(resolveActiveBusinessId('biz-b', list, 'biz-a')).toBe('biz-b');
  });

  it('usa a última unidade válida quando falta ?b=', () => {
    expect(resolveActiveBusinessId(null, list, 'biz-b')).toBe('biz-b');
    expect(resolveActiveBusinessId('', list, 'biz-a')).toBe('biz-a');
  });

  it('ignora preferência que não existe mais na lista acessível', () => {
    expect(resolveActiveBusinessId(null, list, 'biz-antiga')).toBe('');
  });

  it('com uma única unidade entra direto sem exigir preferência', () => {
    expect(resolveActiveBusinessId(null, [{ id: 'andrioni' }])).toBe('andrioni');
  });

  it('com múltiplas unidades e sem escolha não usa o primeiro item', () => {
    expect(resolveActiveBusinessId(null, list)).toBe('');
    expect(resolveActiveBusinessId('biz-invalida', list)).toBe('');
  });

  it('vazio quando a conta não tem empresa', () => {
    expect(resolveActiveBusinessId(null, [])).toBe('');
    expect(businessIdInList('x', [])).toBe(false);
  });
});
