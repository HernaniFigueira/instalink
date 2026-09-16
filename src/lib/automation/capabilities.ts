// ═══════════════════════════════════════════════════════════════
// P4.13 — CAPACIDADES (feature flag) — ÚNICO ponto de decisão
// ═══════════════════════════════════════════════════════════════
// Este módulo existe para que cobrança/planos (ainda não feitos) NÃO precise
// espalhar `if plan === ...` pelo código. Quem decide se um recurso está
// liberado chama `hasCapability`. Sempre.
//
// Fontes, na ordem de precedência (a mais específica vence):
//   1. `Business.capabilityFlags`  → override explícito da unidade;
//   2. `process.env.AUTOMATION_CAPS` → flag global do ambiente
//      (formato: "automation.advanced=1,channel.instagram=0");
//   3. padrão do produto (`DEFAULT_CAPABILITIES`).
//
// Padrão de hoje: nada é cobrado, então as capacidades operacionais do P4
// e a geração por IA do P5 vêm LIGADAS; as capacidades que ainda não existem
// (canais externos / P6) vêm desligadas porque o MOTOR delas não existe — não
// por cobrança. Quando um plano for criado, muda-se só este arquivo
// (+ override por unidade).
import type { Business } from '../types';

export type CapabilityId =
  | 'automation.basic'
  | 'automation.advanced'
  | 'automation.ai'
  | 'channel.whatsapp'
  | 'channel.instagram';

export interface CapabilityDef {
  id: CapabilityId;
  label: string;
  hint: string;
  /** Padrão do produto (sem ambiente e sem override). */
  default: boolean;
  /** false = ainda não existe motor (P5/P6); true = entrega atual. */
  available: boolean;
}

export const CAPABILITIES: CapabilityDef[] = [
  {
    id: 'automation.basic', label: 'Automações', available: true, default: true,
    hint: 'Criar automações simples: gatilho, condição, ação e espera.',
  },
  {
    id: 'automation.advanced', label: 'Automações avançadas', available: true, default: true,
    hint: 'Ramificações, ações sobre a agenda, esperas longas e webhooks de saída.',
  },
  {
    id: 'automation.ai', label: 'Automação por IA', available: true, default: true,
    hint: 'Descrever a automação em linguagem natural. A IA planeja; o P4 executa depois da aprovação.',
  },
  {
    id: 'channel.whatsapp', label: 'Canal WhatsApp', available: false, default: false,
    hint: 'Disparo direto pela API oficial (P6 — hoje a fila do WhatsApp é do P3).',
  },
  {
    id: 'channel.instagram', label: 'Canal Instagram', available: false, default: false,
    hint: 'Mensagens do Instagram (P6 — ainda não existe).',
  },
];

export const CAPABILITY_IDS: CapabilityId[] = CAPABILITIES.map((c) => c.id);

export function capabilityDef(id: string): CapabilityDef | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

export function isCapabilityId(id: unknown): id is CapabilityId {
  return typeof id === 'string' && CAPABILITY_IDS.includes(id as CapabilityId);
}

/** Tetos operacionais por capacidade (P4.4/P4.9) — nunca hardcoded no motor. */
export interface CapabilityLimits {
  maxAutomations: number;
  maxNodes: number;
  maxStepsPerRun: number;
  maxActionsPerRun: number;
  maxWaitMinutes: number;
  maxRunHistory: number;
  /** Dias máximos de vida de uma execução em espera antes de expirar. */
  maxRunAgeDays: number;
}

export const BASIC_LIMITS: CapabilityLimits = {
  maxAutomations: 12,
  maxNodes: 24,
  maxStepsPerRun: 40,
  maxActionsPerRun: 15,
  maxWaitMinutes: 7 * 1440,       // 1 semana
  maxRunHistory: 60,
  maxRunAgeDays: 30,
};

export const ADVANCED_LIMITS: CapabilityLimits = {
  maxAutomations: 100,
  maxNodes: 60,
  maxStepsPerRun: 120,
  maxActionsPerRun: 50,
  maxWaitMinutes: 180 * 1440,      // 6 meses (retomada continua limitada por passos)
  maxRunHistory: 200,
  maxRunAgeDays: 365,
};

function envFlags(env: NodeJS.ProcessEnv): Partial<Record<CapabilityId, boolean>> {
  const raw = String(env.AUTOMATION_CAPS || '').trim();
  if (!raw) return {};
  const out: Partial<Record<CapabilityId, boolean>> = {};
  for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
    const [k, v] = part.split('=');
    const id = String(k || '').trim();
    if (!isCapabilityId(id)) continue;
    out[id] = String(v ?? '1').trim() !== '0';
  }
  return out;
}

/** Estado efetivo de todas as capacidades de uma unidade (puro). */
export function capabilityStateFor(
  business: Pick<Business, 'capabilityFlags'> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<CapabilityId, boolean> {
  const fromEnv = envFlags(env);
  const overrides = (business && business.capabilityFlags) || {};
  const out = {} as Record<CapabilityId, boolean>;
  for (const def of CAPABILITIES) {
    const override = overrides[def.id];
    const fromEnvValue = fromEnv[def.id];
    if (typeof override === 'boolean') out[def.id] = override;
    else if (typeof fromEnvValue === 'boolean') out[def.id] = fromEnvValue;
    else out[def.id] = def.default;
  }
  // Capacidade sem motor não existe: ligar a flag não libera nada (falha segura).
  return out;
}

export function hasCapability(
  business: Pick<Business, 'capabilityFlags'> | null | undefined,
  id: CapabilityId,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const def = capabilityDef(id);
  if (!def || !def.available) return false;
  return capabilityStateFor(business, env)[id] === true;
}

/** Tetos da unidade (avançado amplia tudo; básico é o piso seguro). */
export function limitsFor(
  business: Pick<Business, 'capabilityFlags'> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CapabilityLimits {
  return hasCapability(business, 'automation.advanced', env) ? ADVANCED_LIMITS : BASIC_LIMITS;
}

/**
 * Ação liberada para esta unidade? O catálogo de ações declara a capacidade
 * exigida; o motor consulta SÓ aqui (nenhum `if plan` na execução).
 */
export function actionAllowed(
  business: Pick<Business, 'capabilityFlags'> | null | undefined,
  actionRequires: CapabilityId | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!actionRequires) return true;
  return hasCapability(business, actionRequires, env);
}

/** Override explícito por unidade (usado pela área master/admin). */
export function sanitizeCapabilityFlags(
  input: unknown,
): Record<string, boolean> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!isCapabilityId(k) || typeof v !== 'boolean') continue;
    out[k] = v;
  }
  return out;
}
