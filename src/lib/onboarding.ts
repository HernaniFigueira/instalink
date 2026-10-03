// ═══════════════════════════════════════════════════════════════
// PRIMEIRA CONFIGURAÇÃO — "Como sua empresa atende?" (RAMO DE COMPATIBILIDADE)
// ═══════════════════════════════════════════════════════════════
// GODOUTOR_LEGACY_PAGES: este mapeamento SERVIÇOS/PRODUTOS/AMBOS é o ramo de
// COMPATIBILIDADE do fluxo "universal" antigo. No Clinical OS (flag OFF) a
// unidade nasce no padrão de atendimento e a pergunta comercial some da tela;
// o módulo existe intacto para não quebrar chamadas/chamadores antigos.
//
// CORREÇÃO FINAL DA CONVERGÊNCIA: com a flag OFF o onboarding NÃO faz a
// pergunta comercial e NÃO envia `modes` — a base services + bookings é a
// decisão canônica SERVER-SIDE (NEW_BUSINESS_DEFAULTS em lib/templates.ts);
// a UI clínica não governa a criação por `modes`. As funções puras daqui
// (clinicTypeOptions, showsServiceModelQuestion, startWithItems,
// businessCreationPayload) são o ponto único desse contrato, testado em
// src/lib/__tests__/convergence-final.test.ts.
//
// Uma pergunta curta, só para definir a BASE de módulos da empresa nova.
// Não é o antigo onboarding complexo: depois da criação, tudo continua
// ativável/desativável em Administração → Recursos. Nada é bloqueado.
//
// Mapeamento oficial (regra do produto — Produtos é independente):
//   Serviços e agendamento → Serviços ON, Agendamentos ON
//   Produtos               → Produtos ON
//   Serviços + produtos    → Serviços ON, Agendamentos ON, Produtos ON
//
// Puro (sem I/O): usado pela tela de criação e coberto por teste.
import type { BusinessMode } from './types';
import { CLINIC_PRESETS } from './clinic-presets';

export type ServiceModel = 'agenda' | 'produtos' | 'ambos';

export interface ServiceModelOption {
  id: ServiceModel;
  label: string;
  hint: string;
}

export const SERVICE_MODEL_OPTIONS: ServiceModelOption[] = [
  {
    id: 'agenda',
    label: 'Serviços e agendamento',
    hint: 'Clientes marcam horário com você (o padrão do GoDoutor).',
  },
  {
    id: 'produtos',
    label: 'Produtos',
    hint: 'Vitrine de produtos com CTA direto para o seu WhatsApp.',
  },
  {
    id: 'ambos',
    label: 'Serviços + produtos',
    hint: 'Agenda de atendimentos e vitrine de produtos na mesma página.',
  },
];

/** Módulos iniciais da empresa nova para o modelo escolhido. */
export function modesForServiceModel(model: ServiceModel | string | null | undefined): BusinessMode[] {
  switch (model) {
    case 'produtos': return ['products'];
    case 'ambos': return ['services', 'bookings', 'products'];
    case 'agenda':
    default: return ['services', 'bookings'];
  }
}

/** A escolha é válida? (qualquer outra coisa cai no padrão de atendimento) */
export function isServiceModel(v: unknown): v is ServiceModel {
  return v === 'agenda' || v === 'produtos' || v === 'ambos';
}

// ── CORREÇÃO FINAL — o onboarding clínico canônico (flag OFF) ─────────
// Tipos de clínica (preset). 'geral' NÃO é porta para "qualquer negócio":
// com a flag OFF a opção é clínica-geral, sem menção a salão/estúdio.
// O rótulo antigo ("Outro tipo de negócio" / "Não é clínica (salão,
// estúdio…)") sobrevive SOMENTE no ramo ON, para o fluxo de compat.
export interface ClinicTypeOption {
  id: 'medica' | 'odontologica' | 'veterinaria' | 'estetica' | 'geral';
  label: string;
  hint: string;
}

export function clinicTypeOptions(legacyPagesEnabled: boolean): ClinicTypeOption[] {
  return [
    { id: 'medica', label: CLINIC_PRESETS.medica.label, hint: 'Consultas e exames — paciente, consultas, profissionais de saúde.' },
    { id: 'odontologica', label: CLINIC_PRESETS.odontologica.label, hint: 'Procedimentos odontológicos — pacientes e dentistas.' },
    { id: 'veterinaria', label: CLINIC_PRESETS.veterinaria.label, hint: 'Tutores e pets — o pet é o paciente da agenda.' },
    { id: 'estetica', label: CLINIC_PRESETS.estetica.label, hint: 'Procedimentos estéticos — clientes e profissionais.' },
    legacyPagesEnabled
      ? { id: 'geral', label: 'Outro tipo de negócio', hint: 'Não é clínica (salão, estúdio, consultório único…) — tudo funciona igual.' }
      : { id: 'geral', label: 'Clínica geral / outro tipo de clínica', hint: 'Para clínicas e consultórios cuja especialidade ainda não possui preset específico.' },
  ];
}

/** A pergunta comercial ("Como sua empresa atende?") só existe no ramo ON. */
export function showsServiceModelQuestion(legacyPagesEnabled: boolean): boolean {
  return legacyPagesEnabled === true;
}

export interface StartWithItem { text: string; on: boolean }

/**
 * "Você começa com:" — OFF: lista fixa do padrão canônico (a base vem do
 * servidor, não da escolha do usuário). ON: reflexo do modelo escolhido.
 */
export function startWithItems(legacyPagesEnabled: boolean, model: ServiceModel | null): StartWithItem[] {
  if (!legacyPagesEnabled) {
    return [
      { text: 'Agenda de atendimentos ativa', on: true },
      { text: 'Catálogo de serviços com agendamento', on: true },
      { text: 'Painel pronto para uso', on: true },
    ];
  }
  const m = isServiceModel(model) ? model : 'agenda';
  const items: StartWithItem[] = [];
  if (m === 'agenda' || m === 'ambos') {
    items.push({ text: 'Agenda de atendimentos ativa', on: true });
    items.push({ text: 'Catálogo de serviços com agendamento', on: true });
  }
  if (m === 'produtos' || m === 'ambos') items.push({ text: 'Vitrine de produtos com CTA no WhatsApp', on: true });
  items.push({ text: 'Página pública pronta para publicar', on: true });
  if (m === 'agenda') items.push({ text: 'Vitrine de produtos (opcional — ative em Recursos)', on: false });
  if (m === 'produtos') items.push({ text: 'Agenda e serviços (opcionais — ative em Recursos)', on: false });
  return items;
}

/**
 * Corpo canônico de POST /api/businesses vindo do onboarding.
 * OFF: SEM `modes` — a base services + bookings é decisão server-side
 * (NEW_BUSINESS_DEFAULTS); a UI clínica não governa criação por modes.
 * ON (compatibilidade): a pergunta comercial escolhe a base.
 */
export function businessCreationPayload(input: {
  legacyPagesEnabled: boolean;
  name: string;
  whatsapp: string;
  slug: string;
  clinicType: string;
  model: ServiceModel | null;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: input.name,
    whatsapp: input.whatsapp,
    slug: input.slug,
    clinicType: input.clinicType,
  };
  if (input.legacyPagesEnabled) body.modes = modesForServiceModel(input.model);
  return body;
}
