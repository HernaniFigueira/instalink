// ═══════════════════════════════════════════════════════════════
// BARRA INFERIOR DA PÁGINA PÚBLICA — estrutura conceitual única
// ═══════════════════════════════════════════════════════════════
// Itens (nesta ordem): Conta · WhatsApp · Menu · Agendar.
// Cada item é ÍCONE EM CIMA + TEXTO EMBAIXO (mobile-first), em barra
// full-width fixa, sem cápsula externa e sem cantos arredondados externos.
// Agendar é SEMPRE a ação principal (preenchida); WhatsApp é secundário.
// Puro (sem I/O/DOM): o componente renderiza exatamente o que esta função
// devolve — e os testes congelam a estrutura.
export interface BottomBarItem {
  id: 'conta' | 'whatsapp' | 'menu' | 'agendar';
  label: string;
  icon: string;
  /** true = ação principal (Agendar) — único item preenchido. */
  primary: boolean;
}

export interface BottomBarInput {
  /** Agenda pública disponível agora? (módulo + serviço agendável) */
  canBook: boolean;
  /** WhatsApp visível publicamente? (módulo ligado + número) */
  whatsapp: boolean;
  /** Nome do visitante logado ('' = visitante anônimo → item "Entrar"). */
  customerName?: string;
}

export function bottomBarItems(input: BottomBarInput): BottomBarItem[] {
  const first = (input.customerName || '').trim().split(/\s+/)[0] || '';
  const out: BottomBarItem[] = [
    { id: 'conta', label: first || 'Entrar', icon: first ? 'userCircle' : 'user', primary: false },
  ];
  if (input.whatsapp) out.push({ id: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp', primary: false });
  out.push({ id: 'menu', label: 'Menu', icon: 'menu', primary: false });
  if (input.canBook) out.push({ id: 'agendar', label: 'Agendar', icon: 'calendar', primary: true });
  return out;
}
