// ═══════════════════════════════════════════════════════════════
// PRIMEIRA CONFIGURAÇÃO — "Como sua empresa atende?"
// ═══════════════════════════════════════════════════════════════
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
    hint: 'Clientes marcam horário com você (o padrão do InstaLink).',
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
