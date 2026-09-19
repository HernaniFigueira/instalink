// Fronteira síncrona das mutações. Nenhuma Promise/I/O externo pode aguardar
// dentro do lock do documento (nem no mutex local, nem na transação Postgres).
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DB } from './types';

const mutationContext = new AsyncLocalStorage<boolean>();
export type SyncMutation<T> = (db: DB) => T & (Extract<T, PromiseLike<unknown>> extends never ? unknown : never);

export function assertOutsideDBTransaction(): void {
  if (mutationContext.getStore()) throw new Error('I/O externo não é permitido dentro de uma mutação do banco. Grave a outbox e execute após o commit.');
}

export function runSyncMutation<T>(fn: (db: DB) => T, db: DB): T {
  // Falha ANTES de iniciar o corpo de um callback async (inclusive JS/any).
  if (fn.constructor.name === 'AsyncFunction') throw new Error('Callback do banco deve ser síncrono; execute I/O após o commit.');
  return mutationContext.run(true, () => {
    const result = fn(db);
    if (result && typeof (result as any).then === 'function') {
      // Não aguarda a Promise, não persiste mutações e não deixa rejection solta.
      void Promise.resolve(result).catch(() => {});
      throw new Error('Callback do banco retornou Promise; execute I/O após o commit.');
    }
    return result;
  });
}
