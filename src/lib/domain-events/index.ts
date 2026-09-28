// GODOUTOR CLINICAL OS · F0 — Event Log (eventos de domínio / OAAS).
// Fonte única: contratos em ./types · emissor puro em ./emit ·
// persistência em ./store (Postgres normalizado em produção).
// ./pg-store fica fora do barrel de propósito (bundle do cliente limpo;
// a factory o importa dinamicamente quando há DATABASE_URL).
export * from './types';
export * from './emit';
export * from './store';
