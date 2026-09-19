// Contrato do driver Postgres: não substitui um teste contra Postgres real.
// Prova que atualização, revalidação e rollback usam UMA conexão com bloqueio de linha.
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  poolQuery: vi.fn(), query: vi.fn(), release: vi.fn(), connect: vi.fn(),
}));
vi.mock('pg', () => ({ Pool: class {
  query = mock.poolQuery;
  connect = mock.connect;
} }));
import { emptyDB, updateDB } from '../db';

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://test-driver-only');
  mock.query.mockReset(); mock.poolQuery.mockReset(); mock.connect.mockReset(); mock.release.mockReset();
  mock.poolQuery.mockResolvedValue({ rows: [] });
  mock.connect.mockResolvedValue({ query: mock.query, release: mock.release });
  mock.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FOR UPDATE') ? [{ data: emptyDB() }] : [] }));
});
afterEach(() => vi.unstubAllEnvs());
it('BEGIN → SELECT FOR UPDATE → callback → UPDATE → COMMIT; libera conexão', async () => {
  const result = await updateDB(async (d) => {
    const queries = mock.query.mock.calls.map(([sql]) => sql);
    expect(queries[0]).toBe('BEGIN');
    expect(queries.at(-1)).toMatch(/SELECT.*FOR UPDATE/);
    expect(queries.some((q) => q.startsWith('UPDATE'))).toBe(false);
    d.bookings.push({ id: 'ocorrencia' } as any);
    return 'criado';
  });
  expect(result).toBe('criado');
  const statements = mock.query.mock.calls.map(([sql]) => sql);
  expect(statements.at(-2)).toMatch(/^UPDATE instalink_doc/);
  expect(statements.at(-1)).toBe('COMMIT');
  const written = mock.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'))!;
  expect(JSON.parse(written[1][0]).bookings[0].id).toBe('ocorrencia');
  expect(mock.release).toHaveBeenCalledOnce();
});
it('conflito no callback faz ROLLBACK, nunca escreve parcialmente', async () => {
  await expect(updateDB((d) => {
    d.bookings.push({ id: 'nao-persistir' } as any);
    throw new Error('Conflito');
  })).rejects.toThrow('Conflito');
  const statements = mock.query.mock.calls.map(([sql]) => sql);
  expect(statements.at(-1)).toBe('ROLLBACK');
  expect(statements.some((q) => q.startsWith('UPDATE') || q === 'COMMIT')).toBe(false);
  expect(mock.release).toHaveBeenCalledOnce();
});
it('erro de gravação faz rollback e a próxima operação continua funcionando', async () => {
  mock.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('UPDATE')) throw new Error('falha de escrita');
    return { rows: sql.includes('FOR UPDATE') ? [{ data: emptyDB() }] : [] };
  });
  await expect(updateDB(() => 'x')).rejects.toThrow('falha de escrita');
  expect(mock.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  mock.query.mockImplementation(async (sql: string) => ({ rows: sql.includes('FOR UPDATE') ? [{ data: emptyDB() }] : [] }));
  expect(await updateDB(() => 'recuperou')).toBe('recuperou');
  expect(mock.release).toHaveBeenCalledTimes(2);
});
