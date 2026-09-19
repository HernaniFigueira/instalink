// Ícones minimalistas do sistema (traço 24px, currentColor).
// Sem 'use client': pode ser importado por server e client components.
//
// Revisão do conjunto (auditoria §17): todos os ícones são TRAÇO (stroke
// 1.8, extremidades arredondadas), EXCETO os glifos de marca que só existem
// como forma sólida — hoje, o WhatsApp. Renderizar o glifo oficial com
// stroke (o estado anterior) gerava um contorno duplo ilegível: era o
// "ícone do WhatsApp visualmente ruim". Glifos de marca usam FILL.
const FILL_ICONS = new Set(['whatsapp']);

const PATHS: Record<string, React.ReactNode> = {
  home: (<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>),
  grid: (<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  bag: (<><path d="M6 7h12l1 13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" /><path d="M9 10V6a3 3 0 0 1 6 0v4" /></>),
  truck: (<><path d="M14 17V5H2v12h3" /><path d="M14 8h4l4 4v5h-3" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></>),
  box: (<><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7 12 12l8.7-5" /><path d="M12 22V12" /></>),
  calendar: (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>),
  clock: (<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>),
  chat: (<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  send: (<><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>),
  user: (<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
  userCircle: (<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="10" r="3" /><path d="M8.5 19a4.5 4.5 0 0 1 7 0" /></>),
  pin: (<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></>),
  phone: (<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />),
  check: (<path d="M20 6 9 17l-5-5" />),
  checkCircle: (<><circle cx="12" cy="12" r="10" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>),
  shield: (<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>),
  x: (<path d="M18 6 6 18M6 6l12 12" />),
  plus: (<path d="M12 5v14M5 12h14" />),
  minus: (<path d="M5 12h14" />),
  chevD: (<path d="m6 9 6 6 6-6" />),
  chevU: (<path d="m18 15-6-6-6 6" />),
  chevL: (<path d="m15 18-6-6 6-6" />),
  chevR: (<path d="m9 18 6-6-6-6" />),
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>),
  star: (<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />),
  spark: (<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />),
  receipt: (<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M8 7h8" /><path d="M8 11h8" /><path d="M8 15h5" /></>),
  card: (<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>),
  store: (<><path d="M4 7l1-3h14l1 3" /><path d="M4 7v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7" /><path d="M4 7h16" /><path d="M9 20v-6h6v6" /></>),
  scissors: (<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.12 15.88" /><path d="M14.47 14.48 20 20" /><path d="M8.12 8.12 12 12" /></>),
  // Ícone NEUTRO de serviço/atendimento (substitui a tesoura — o produto não
  // é só salão/barbearia: clínica, consultório, estúdio, autônomo…).
  service: (<><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><path d="M3 13h18" /></>),
  handHeart: (<><path d="M11 14 2 9v10l9 3 9-3V6l-9 3" /><path d="M11 14 20 6" /><path d="M11 14 6 11" /></>),
  facebook: (<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />),
  youtube: (<><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" /><path d="m10 15 5-3-5-3z" /></>),
  linkedin: (<><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></>),
  music: (<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>),
  instagram: (<><rect x="2" y="2" width="20" height="20" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></>),
  external: (<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>),
  bolt: (<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />),
  alert: (<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>),
  lock: (<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  filter: (<path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  menu: (<><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>),
  image: (<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L6 23" /></>),
  upload: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 8l5-5 5 5" /><path d="M12 3v12" /></>),
  sync: (<><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.9-4.7" /><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.9 4.7" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" /></>),
  calendarPlus: (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /><path d="M12 13v6" /><path d="M9 16h6" /></>),
  expand: (<><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></>),
  shrink: (<><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></>),
  // ── A3.3 — glifos que faltavam para a nova linguagem do painel ──
  // Editar (lápis): ação de edição explícita, nunca só texto.
  pencil: (<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>),
  // Histórico / linha do tempo.
  history: (<><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></>),
  // Tarefas: lista com o que foi feito.
  tasks: (<><path d="M11 6h10" /><path d="M11 12h10" /><path d="M11 18h10" /><path d="m3 6 1.5 1.5L7 5" /><path d="m3 12 1.5 1.5L7 11" /><path d="m3 18 1.5 1.5L7 17" /></>),
  // Crachá (profissionais / quem atende) — distinto de `users` (clientes).
  idcard: (<><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M5.5 16a2.5 2.5 0 0 1 5 0" /><path d="M14 9h4" /><path d="M14 13h4" /></>),
  // Funil: o caminho estreita do contato à oportunidade.
  funnel: (<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />),
  // Caixa de entrada (conversas).
  inbox: (<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  // Campanhas / marketing.
  megaphone: (<><path d="m3 11 18-6v14L3 13z" /><path d="M7 12v6a2 2 0 0 0 4 0" /></>),
  // Unidades / organização.
  buildings: (<><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /><path d="M9 9v.01" /><path d="M9 12v.01" /><path d="M9 15v.01" /><path d="M9 18v.01" /></>),
  // Sair da conta.
  logout: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>),
  // Copiar.
  copy: (<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>),
  // Filtros (sliders).
  sliders: (<><path d="M4 21v-7" /><path d="M4 10V3" /><path d="M12 21v-9" /><path d="M12 8V3" /><path d="M20 21v-5" /><path d="M20 12V3" /><path d="M1 14h6" /><path d="M9 8h6" /><path d="M17 16h6" /></>),
  // Carteira / carteirinha do cliente.
  wallet: (<><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></>),
  whatsapp: (<><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" /></>),
};

export function Icon({ n, size = 20, className, strokeWidth }: {
  n: string;
  size?: number;
  className?: string;
  /** Sobrescreve o peso do traço (padrão 1.8) — ignorado em glifos fill. */
  strokeWidth?: number;
}) {
  const fillMode = FILL_ICONS.has(n);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fillMode ? 'currentColor' : 'none'} stroke={fillMode ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth ?? 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={className || 'shrink-0'}>
      {PATHS[n] || null}
    </svg>
  );
}
