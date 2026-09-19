'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { clearToken } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import { Avatar, PageSkeleton } from '@/components/ui';
import { AccessDenied, ForbiddenToasts, PanelHomeProvider } from '@/components/dashboard/AccessNotice';
import {
  activePanelPath, activePanelRoute, firstAllowedPath, panelAccess, panelNavigation,
  routeRequiresBusiness, sectionTheme, type PanelRouteDef, type PanelSection, type PanelSectionId,
  type SectionTheme,
} from '@/lib/panel';
import { isSessionExpired } from '@/lib/http';
import type { BusinessMode, FeatureId, PermissionId } from '@/lib/types';
import { requiresActiveBusiness } from '@/lib/business-context';
import { unitsInSameOrganization } from '@/lib/organization';
import { NavSearch } from '@/components/dashboard/NavSearch';
import { buildNavSearchItems } from '@/lib/nav-search';

interface Biz {
  id: string;
  slug: string;
  name: string;
  logo?: string;
  cover?: string;
  modes: BusinessMode[];
  features: Partial<Record<FeatureId, boolean>>;
  published: boolean;
  role?: string;
  isOwner?: boolean;
  permissions?: Record<PermissionId, boolean>;
  readOnly?: boolean;
  organizationId?: string;
  /** Escopo do profissional: preenchido ⇒ este login vê só a própria agenda. */
  professionalId?: string;
  professionalName?: string;
  /** 'own' = agenda recortada pelo vínculo · 'none' = papel de atendimento
   *  ainda sem vínculo (o backend não devolve agenda de terceiros). */
  agendaScope?: 'all' | 'own' | 'none';
}

interface SupportInfo {
  id: string;
  businessId: string;
  mode: 'view' | 'admin';
  reason: string;
  expiresAt: string;
}

// Glifos de marca (WhatsApp) existem apenas como forma sólida: com stroke
// ficam como contorno duplo ilegível (era o "ícone do WhatsApp ruim").
const FILL_ICONS = new Set(['whatsapp']);

function Svg({ size = 18, fill = false, className, children }: { size?: number; fill?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}>
      {children}
    </svg>
  );
}

const PATHS: Record<string, React.ReactNode> = {
  home: (<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></>),
  link: (<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),
  cart: (<><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></>),
  scissors: (<><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.12 15.88" /><path d="M14.47 14.48 20 20" /><path d="M8.12 8.12 12 12" /></>),
  // Ícone neutro de serviço/atendimento (nada de tesoura/salão).
  service: (<><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /><path d="M3 13h18" /></>),
  clock: (<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>),
  bag: (<><path d="M6 7h12l1 13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" /><path d="M9 10V6a3 3 0 0 1 6 0v4" /></>),
  calendar: (<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></>),
  receipt: (<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M8 7h8" /><path d="M8 11h8" /><path d="M8 15h5" /></>),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  // Profissionais (quem atende): crachá — distinto de Clientes (users).
  idcard: (<><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M5.5 16a2.5 2.5 0 0 1 5 0" /><path d="M14 9h4" /><path d="M14 13h4" /></>),
  chart: (<><path d="M3 3v18h18" /><path d="M8 17V9" /><path d="M13 17V5" /><path d="M18 17v-8" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.24.6.86 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.65 0-1.27.4-1.51 1Z" /></>),
  logout: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  // Ícone genérico de PAINEL LATERAL (SVG próprio do sistema): retângulo com
  // divisão vertical. Serve para recolher E expandir — o tooltip diz qual.
  panel: (<><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9.5 4v16" /></>),
  x: (<path d="M18 6 6 18M6 6l12 12" />),
  chevD: (<path d="m6 9 6 6 6-6" />),
  collapse: (<><path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" /></>),
  expand: (<><path d="m13 17 5-5-5-5" /><path d="m6 17 5-5-5-5" /></>),
  external: (<><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>),
  spark: (<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />),
  // Glifo oficial do WhatsApp (renderizado em FILL — ver FILL_ICONS).
  whatsapp: (<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />),
  megaphone: (<><path d="m3 11 18-6v14L3 13z" /><path d="M7 12v6a2 2 0 0 0 4 0" /></>),
  inbox: (<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  toggle: (<><rect x="1" y="7" width="22" height="10" rx="5" /><circle cx="16" cy="12" r="3" /></>),
  shield: (<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>),
  lock: (<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  // Automações (P4): raio = "acontece sozinho". traço fino, mesma linguagem do
  // restante da sidebar (sem glifo novo por tela).
  bolt: (<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />),
  // Funil: o caminho estreita — do contato à oportunidade ganha.
  funnel: (<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />),
  // Tarefas: lista com o que já foi feito.
  tasks: (<><path d="M11 6h10" /><path d="M11 12h10" /><path d="M11 18h10" /><path d="m3 6 1.5 1.5L7 5" /><path d="m3 12 1.5 1.5L7 11" /><path d="m3 18 1.5 1.5L7 17" /></>),
  // Canais & Integrações: plugue = "conecta com o que já existe".
  plugs: (<><path d="M9 2v6" /><path d="M15 2v6" /><path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" /><path d="M12 17v5" /></>),
  // Execuções: histórico (o que já aconteceu).
  history: (<><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></>),
  // Organização: as unidades da empresa.
  buildings: (<><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /><path d="M9 9v.01" /><path d="M9 12v.01" /><path d="M9 15v.01" /><path d="M9 18v.01" /></>),
  chevron: (<path d="m6 9 6 6 6-6" />),
};

function I({ n, size = 18, className }: { n: string; size?: number; className?: string }) {
  return <Svg size={size} fill={FILL_ICONS.has(n)} className={className}>{PATHS[n]}</Svg>;
}

// ═══════════════════════════════════════════════════════════════
// NAVEGAÇÃO = PROJEÇÃO DO CATÁLOGO (lib/panel.ts)
// ═══════════════════════════════════════════════════════════════
// O shell NÃO decide o que existe, em que ordem, com que rótulo ou em qual
// seção: tudo vem de `panelNavigation(ctx)` = permissão REAL ∩ módulos.
// Aqui só há apresentação e a guarda de rota no cliente:
//   • item só aparece com permissão e módulo ativos;
//   • acessar direto uma rota sem permissão mostra 403 AMIGÁVEL — nunca
//     logout (somente 401 inicia fluxo de login; ver lib/http.ts);
//   • estado ativo por ANCESTRALIDADE ('/clientes/123' mantém Clientes aceso);
//   • seções colapsáveis (preferência por navegador).
//
// A3.3 — UMA lista, um comportamento: todas as seções (inclusive
// Administração) ficam na mesma área rolável. O "Configurações preso no
// rodapé" gerava dois comportamentos diferentes na mesma barra; o rodapé
// agora só carrega quem está logado e a saída. O que resolveu o problema
// original (Administração abaixo da dobra em 1280×768) foi o menu mais
// compacto + o controle de recolher no topo.
const CLOSED_SECTIONS_KEY = 'il-nav-closed';

function readClosedSections(): Set<PanelSectionId> {
  try {
    const raw = localStorage.getItem(CLOSED_SECTIONS_KEY);
    if (!raw) return new Set();
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? (list as PanelSectionId[]) : []);
  } catch {
    return new Set();
  }
}

function writeClosedSections(closed: Set<PanelSectionId>) {
  try { localStorage.setItem(CLOSED_SECTIONS_KEY, JSON.stringify([...closed])); } catch { /* modo privado */ }
}

/** Href do destino: rotas de organização não carregam unidade no `?b=`. */
function hrefFor(item: PanelRouteDef, unitQuery: string): string {
  return item.requiresBusiness === false ? item.href : `${item.href}${unitQuery}`;
}

function NavItem({ item, active, collapsed, href, theme }: {
  item: PanelRouteDef; active: boolean; collapsed: boolean; href: string;
  /**
   * A3.4 — tema da SEÇÃO (cor de contexto + estado ativo), vindo de
   * `sectionTheme(sec.id)` em lib/panel.ts. Ativo e inativo usam a MESMA
   * família de cor: clicar em Clientes (teal) não vira azul, clicar em
   * Serviços (lilás) não vira azul. O azul da marca continua sendo a cor do
   * PRODUTO (ações, botões) — não a cor de toda seleção do menu.
   */
  theme: SectionTheme;
}) {
  return (
    <Link href={href} data-nav-item={item.href} data-nav-active={active || undefined}
      // A descrição do catálogo é o tooltip: responde "para que serve isto?"
      // sem exigir abrir a tela (e sem inventar uma segunda fonte de texto).
      title={collapsed ? `${item.label} — ${item.description}` : item.description}
      aria-current={active ? 'page' : undefined}
      // Fundo ativo = versão soft DA SEÇÃO. Valor de token declarado no
      // catálogo (não classe Tailwind): um mapa de classes por seção seria uma
      // segunda fonte de cor, exatamente o que este bloco elimina.
      style={active ? { backgroundColor: theme.activeBg, color: theme.activeFg } : undefined}
      className={cn(
        'relative flex items-center text-[13px] rounded-md h-10 transition-[background-color,color] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--il-nav)]',
        collapsed ? 'justify-center px-0 il-tip' : 'gap-2.5 px-2.5',
        active
          // Sem `--il-nav-active` azul fixo: quem manda é o tema da seção.
          ? 'font-semibold shadow-xs'
          : 'text-[var(--il-nav-fg)] font-medium hover:bg-[var(--il-nav-hover)]',
      )}
      {...(collapsed ? { 'data-tip': item.label } : {})}
    >
      {/* Marcador do item ativo: pequena ABA de 3px na cor DA SEÇÃO, com
          extremidades arredondadas — seleção visível sem borda grossa em
          volta do item e sem depender só do fundo. */}
      {active && (
        <span aria-hidden="true" data-nav-rail="true"
          className={cn('absolute rounded-pill w-[3px]',
            collapsed ? 'left-0.5 top-1/2 -translate-y-1/2 h-5' : 'left-0.5 top-1/2 -translate-y-1/2 h-6')}
          style={{ backgroundColor: theme.accent }} />
      )}
      {/* O ícone NUNCA troca de família: ativo ou não, usa o acento da seção. */}
      <span className="shrink-0 inline-flex" style={{ color: theme.accent }} aria-hidden="true">
        <I n={item.icon} size={18} />
      </span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function NavSection({ sec, activePath, collapsed, closed, onToggle, unitQuery }: {
  sec: PanelSection; activePath: string; collapsed: boolean; closed: Set<PanelSectionId>;
  onToggle: (id: PanelSectionId) => void; unitQuery: string;
}) {
  const isClosed = !collapsed && closed.has(sec.id);
  return (
    <div className={cn(collapsed ? 'mt-2' : 'mt-5 first:mt-2')}>
      {collapsed ? (
        <div className="h-px bg-[var(--il-nav-border)] mx-1 my-2" aria-hidden="true" />
      ) : (
        <button type="button" onClick={() => onToggle(sec.id)}
          aria-expanded={!isClosed} aria-controls={`nav-section-${sec.id}`}
          className="w-full flex items-center justify-between gap-2 px-2.5 mb-1.5 rounded-md group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">
          <span className="text-[10px] font-bold tracking-[0.1em] text-[var(--il-nav-muted)] uppercase group-hover:text-[var(--il-nav-fg)] transition-colors">
            {sec.label}
          </span>
          <span className={cn('text-[var(--il-nav-muted)] transition-transform duration-200', !isClosed && 'rotate-180')} aria-hidden="true">
            <I n="chevron" size={12} />
          </span>
        </button>
      )}
      {(collapsed || !isClosed) && (
        <div className="space-y-0.5" id={`nav-section-${sec.id}`} role="group" aria-label={sec.label}>
          {sec.items.map((item) => (
            <NavItem key={item.href} item={item} collapsed={collapsed}
              href={hrefFor(item, unitQuery)} active={activePath === item.href}
              theme={sectionTheme(sec.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email?: string; role?: string } | null>(null);
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [isMaster, setIsMaster] = useState(false);
  const [support, setSupport] = useState<SupportInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('il-side') === 'mini'; } catch { return false; }
  });
  // Seções FECHADAS (guardamos só as fechadas: uma seção nova nasce aberta).
  const [closed, setClosed] = useState<Set<PanelSectionId>>(new Set());
  // Mobile: painel "Mais" (todas as seções + destinos fora do menu).
  const [moreOpen, setMoreOpen] = useState(false);
  // Rodapé: popover do usuário (a linha é compacta; "Sair" mora dentro dele).
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const [pillFade, setPillFade] = useState(false);
  const pillsRef = useRef<HTMLDivElement | null>(null);
  const lastContextAt = useRef(0);

  useEffect(() => { setClosed(readClosedSections()); }, []);

  function toggleSection(id: PanelSectionId) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeClosedSections(next);
      return next;
    });
  }

  const loadContext = useCallback(() => {
    // SOMENTE 401 (sessão inexistente/expirada/inválida) inicia o fluxo de
    // login. Qualquer outro status mantém o usuário dentro do painel.
    fetch('/api/auth/me')
      .then(async (r) => {
        if (!r.ok) {
          if (isSessionExpired(r.status)) router.replace('/login?session=expired');
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        if (!d.user) { router.replace('/login?session=expired'); return; }
        setIsMaster(!!d.isMaster);
        setSupport(d.support || null);
        // Master da plataforma sem SupportSession ativo vai para /master
        // (área própria). Com suporte ativo, permanece no painel da unidade.
        if (d.isMaster && !d.support && !d.businesses?.length) {
          router.replace('/master');
          return;
        }
        if (!d.businesses?.length) { router.replace('/onboarding'); return; }
        setUser(d.user);
        setBusinesses(d.businesses);
        setReady(true);
        lastContextAt.current = Date.now();
      })
      .catch(() => { /* falha de rede não é sessão inválida: não desloga */ });
  }, [router]);

  useEffect(() => {
    // 401 (sessão inexistente/expirada/inválida) é o ÚNICO status que inicia
    // o fluxo de login; qualquer outro mantém o usuário dentro do painel.
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // REVALIDAÇÃO HONESTA DO CONTEXTO (auditoria §11): módulos e permissões
  // mudam em Recursos/Equipe sem recarregar a página. O cache antigo fazia a
  // GUARDA DO CLIENTE negrear acesso a áreas recém-ativadas (ex.: ligar
  // "Produtos" e /produtos responder "você não tem acesso"). Recarregamos o
  // contexto ao navegar, quando o cache tem >5s, e quando a tela dispara
  // `il:business-refresh` (toggle de módulo, mudança de equipe).
  useEffect(() => {
    if (!ready) return;
    if (Date.now() - lastContextAt.current > 5000) loadContext();
  }, [ready, pathname, loadContext]);
  useEffect(() => {
    const fn = () => loadContext();
    window.addEventListener('il:business-refresh', fn);
    return () => window.removeEventListener('il:business-refresh', fn);
  }, [loadContext]);

  // Unidade ativa: só rotas que PRECISAM de unidade (o catálogo diz quais)
  // recebem o `?b=`. Os demais parâmetros da URL são preservados — trocar de
  // unidade ou chegar sem `?b=` nunca derruba `?tab=`, `?organization=`, etc.
  useEffect(() => {
    if (!ready || businesses.length === 0) return;
    if (!requiresActiveBusiness(pathname)) return;
    const b = params.get('b');
    if (businesses.some((x) => x.id === b)) return;
    const qs = new URLSearchParams(params.toString());
    qs.set('b', businesses[0].id);
    router.replace(`${pathname}?${qs.toString()}`);
  }, [ready, businesses, params, pathname, router]);

  // A seção da tela atual abre sozinha: estar em '/clientes' com a seção
  // Pessoas fechada deixaria o usuário sem saber onde está.
  const activePath = activePanelPath(pathname);
  const activeRoute = activePanelRoute(pathname);
  useEffect(() => {
    const sec = activeRoute?.section;
    if (!sec) return;
    setClosed((prev) => {
      if (!prev.has(sec)) return prev;
      const next = new Set(prev);
      next.delete(sec);
      writeClosedSections(next);
      return next;
    });
  }, [activePath, activeRoute]);

  // Mobile: a pílula ativa entra na área visível (a fileira rola na horizontal).
  useEffect(() => {
    const el = pillsRef.current?.querySelector<HTMLElement>('[data-nav-active="true"]');
    if (!el) return;
    try { el.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch { /* navegadores antigos */ }
  }, [activePath, moreOpen]);

  // Mobile: o degradê de "tem mais" só aparece enquanto houver continuação à
  // direita da fileira de atalhos.
  //
  // ESTE HOOK FICA ANTES DO EARLY RETURN DE PROPÓSITO: o shell renderiza o
  // skeleton enquanto o contexto não chega e o painel completo depois. Se a
  // quantidade de hooks mudar entre esses dois renders, o React aborta com
  // "rendered more hooks than during the previous render" — que o Next traduz
  // para o usuário como "Application error: a client-side exception".
  const onPillsScroll = useCallback(() => {
    const el = pillsRef.current;
    if (!el) return;
    setPillFade(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);
  useEffect(() => {
    onPillsScroll();
    window.addEventListener('resize', onPillsScroll);
    return () => window.removeEventListener('resize', onPillsScroll);
  }, [onPillsScroll, ready, moreOpen, pathname, businesses.length]);

  // Rodapé: clique fora fecha o popover do usuário.
  useEffect(() => {
    if (!userMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [userMenuOpen]);

  function switchBiz(id: string) {
    if (id === '__overview') { router.push(`/organizacao?organization=${business?.organizationId || ''}`); return; }
    if (id === '__add') { router.push(`/organizacao?organization=${business?.organizationId || ''}&add=1`); return; }
    // Em rota que não é de unidade (ex.: /organizacao) a troca leva ao painel.
    const target = routeRequiresBusiness(pathname) ? pathname : '/dashboard';
    router.push(`${target}?b=${id}`);
  }
  function toggle() {
    setCollapsed((c) => {
      try { localStorage.setItem('il-side', c ? 'full' : 'mini'); } catch {}
      return !c;
    });
  }
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    clearToken();
    window.location.assign('/login');
  }

  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-[var(--bg)] lg:flex" aria-label="Carregando painel">
        <div className="hidden lg:flex w-[248px] shrink-0 flex-col bg-white border-r border-[var(--border)] p-3 gap-2">
          <div className="h-9 w-32 bg-zinc-100 animate-pulse mb-2" />
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-7 bg-zinc-100 animate-pulse" />)}
        </div>
        <div className="flex-1 min-w-0"><div className="px-6 lg:px-8 py-6"><PageSkeleton /></div></div>
      </div>
    );
  }

  const business = businesses.find((b) => b.id === params.get('b')) || businesses[0];
  const organizationUnits = unitsInSameOrganization(business, businesses);
  const otherBusinesses = businesses.filter((x) => x.organizationId !== business?.organizationId);
  const modes = business?.modes || [];
  const features = business?.features || {};
  const permissions: Partial<Record<PermissionId, boolean>> = business?.permissions || {};
  // Navegação e guarda de rota vêm da fonte única (lib/panel.ts).
  const panelCtx = { permissions, modes, features: features as Partial<Record<FeatureId, boolean>> };
  const nav = panelNavigation(panelCtx);
  const access = panelAccess(pathname, panelCtx);
  const q = business ? `?b=${business.id}` : '';
  // BUSCA DE NAVEGAÇÃO (ponto 2): a fonte é `nav.allowed` — o MESMO cálculo de
  // permissão que monta o menu. Nenhum destino extra entra aqui, então a busca
  // não tem como revelar (nem levar a) uma tela que o usuário não alcança.
  // A regra de busca fica em lib/nav-search.ts (pura e testada).
  const navSearchItems = buildNavSearchItems(nav, q);
  const ROLE_LABEL: Record<string, string> = {
    OWNER: 'Proprietário', ADMIN: 'Administrador', SECRETARIA: 'Secretária',
    ATENDENTE: 'Atendente', VENDEDOR: 'Vendedor', VIEWER: 'Visualizador', MASTER: 'Suporte da plataforma',
    PROFISSIONAL: 'Profissional',
  };

  // Dashboard fica sempre no topo, sem seção; demais itens agrupados.
  const dashboardItem = nav.primary;
  // A Agenda é o ambiente operacional: chrome mínimo para a grade ocupar a
  // viewport (menos padding, sem rodapé). As demais telas não mudam.
  const isAgenda = activePath === '/agenda';
  // Largura é política do CATÁLOGO (campo `width`), não uma lista à parte:
  // telas densas (grade, kanban, tabela, colunas) usam a largura toda;
  // formulários e listas de coluna única ficam em 960px de leitura.
  const isFullWidth = activeRoute?.width === 'full';
  // Sem permissão de dashboard (ex.: VIEWER com agenda liberada) o usuário
  // ainda precisa de um destino válido ao clicar em "Início" — e TODO 403
  // precisa de uma porta de volta (fornecida por contexto às telas).
  const fallbackHref = firstAllowedPath(panelCtx);
  const fallbackRoute = nav.allowed.find((r) => r.href === fallbackHref);
  const homeHref = fallbackHref ? hrefFor(fallbackRoute || { href: fallbackHref } as PanelRouteDef, q) : '';

  // Mobile: pills = menu; "Mais" = todas as seções + destinos fora do menu.
  const mobilePills = nav.sidebar;
  const mobileSections = [...nav.sections, ...nav.footerSections];

  return (
    // A3.3 CONVERGÊNCIA — o painel tem UM design system padrão: a aparência da
    // navegação vem dos tokens `--il-nav*` definidos em `globals.css` (:root),
    // e NÃO da cor da empresa.
    //
    // Aqui já existiu `style={navTokenStyle(business?.appearance?.navColor)}`,
    // que fazia uma unidade com `appearance.navColor` legado (salvo quando
    // Configurações tinha a aba "Aparência") tematizar a sidebar. Isso foi
    // removido de propósito: white label significa identificar a EMPRESA por
    // logo/nome, não pintar o painel administrativo com a cor dela.
    //
    // O dado antigo continua persistido (sem migração destrutiva) — só deixou
    // de ser APLICADO ao painel. A página pública segue com identidade própria
    // e independente (Page.theme).
    //
    // `PanelHomeProvider` entrega o destino de volta a qualquer 403 do painel
    // sem que cada tela precise calcular (ou chutar) o seu.
    <PanelHomeProvider home={homeHref}>
    <div className="min-h-screen bg-[var(--bg)] lg:flex">
      {/* ═══ SIDEBAR DESKTOP (A3.3) ═══════════════════════════════
          Três blocos, um comportamento só:
            TOPO   → marca/unidade + controle de recolher (sempre à vista);
            CENTRO → menu único e rolável (todas as seções, inclusive
                     Administração — nada de "parte fixa, parte rolável");
            RODAPÉ → quem está logado, em que papel, e a saída.
          Cores vêm dos tokens --il-nav* definidos em globals.css (:root) —
          padrão único do painel, independente da cor da empresa. */}
      <aside className={cn(
        'hidden lg:flex shrink-0 flex-col bg-[var(--il-nav)] text-[var(--il-nav-fg)] border-r border-[var(--il-nav-border)] sticky top-0 h-screen transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-[248px]',
      )}>
        {/* ── TOPO (white label, ponto 1 da convergência) ──
            O painel autenticado NÃO exibe marca do produto: quem opera é a
            empresa, então o topo é funcional (busca + recolher) e a identidade
            visível é a da UNIDADE, logo abaixo. Nada de "InstaLink Odonto
            Clínica": só o nome do negócio.
            O mesmo ícone de painel recolhe e expande — o tooltip diz qual. */}
        <div className={cn('shrink-0 border-b border-[var(--il-nav-border)]', collapsed ? 'px-2 py-3 space-y-2' : 'px-3 py-3 space-y-2.5')}>
          {collapsed ? (
            <>
              <NavSearch items={navSearchItems} collapsed activePath={activePath} />
              <button type="button" onClick={toggle} title="Expandir menu" aria-label="Expandir menu"
                aria-expanded={false}
                className="flex w-full h-8 items-center justify-center rounded-md text-[var(--il-nav-muted)] hover:text-[var(--il-nav-fg)] hover:bg-[var(--il-nav-hover)] transition-colors">
                <I n="panel" size={17} />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <NavSearch items={navSearchItems} collapsed={false} activePath={activePath} />
              <button type="button" onClick={toggle} title="Recolher menu" aria-label="Recolher menu"
                aria-expanded={!collapsed}
                className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-[var(--il-nav-muted)] hover:text-[var(--il-nav-fg)] hover:bg-[var(--il-nav-hover)] transition-colors">
                <I n="panel" size={17} />
              </button>
            </div>
          )}

          {/* ── IDENTIDADE DA EMPRESA: logo + nome + página pública ── */}
          {collapsed ? (
            <span title={`${business.name} — workspace atual`}
              className="flex h-9 w-full items-center justify-center overflow-hidden rounded-lg border border-[var(--il-nav-border)] bg-[var(--il-nav-hover)] text-[11px] font-bold text-[var(--il-nav-fg)]">
              {business.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={business.logo} alt="" className="h-full w-full rounded-lg object-cover" />
              ) : (business.name || '?').trim().slice(0, 1).toUpperCase()}
            </span>
          ) : (
            <div className="flex items-start gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--il-nav-border)] bg-[var(--il-nav-cta)] text-[var(--il-nav-cta-fg)] text-[12px] font-bold shadow-brand">
                {business.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={business.logo} alt="" className="h-full w-full object-cover" />
                ) : (business.name || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() || '').join('')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-bold leading-tight truncate text-[var(--il-nav-fg)]">{business.name}</p>
                <a href={`/${business.slug}`} target="_blank" rel="noreferrer"
                  className="text-[11px] font-semibold text-[var(--il-nav-muted)] hover:text-[var(--il-nav-cta)] inline-flex items-center gap-1 leading-none mt-1.5">
                  Ver página pública <I n="external" size={10} />
                </a>
              </div>
            </div>
          )}
          {!collapsed && businesses.length > 1 && (
            <div>
              <select value={business?.id || ''} onChange={(e) => switchBiz(e.target.value)} aria-label="Trocar de negócio"
                className="w-full bg-[var(--il-nav-hover)] text-[var(--il-nav-fg)] border border-[var(--il-nav-border)] text-[11px] font-semibold rounded-md px-1.5 py-1.5 [&>option]:bg-white [&>option]:text-zinc-900">
                <option value="__overview">Visão geral da organização</option>
                <optgroup label="Unidades desta organização">{organizationUnits.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
                {otherBusinesses.length > 0 && <optgroup label="Outras organizações">{otherBusinesses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
                <option value="__add">+ Adicionar unidade</option>
              </select>
            </div>
          )}
        </div>

        {isMaster && (
          <div className={cn('shrink-0 py-2 border-b border-[var(--il-nav-border)]', collapsed ? 'px-2' : 'px-3')}>
            <Link href="/master" title="Master da plataforma"
              className={cn('flex items-center text-xs font-bold rounded-md py-2 bg-[var(--warning-bg)] border border-[var(--warning-border)] text-[var(--warning-fg)] hover:bg-[var(--attention-bg-hover)]',
                collapsed ? 'justify-center px-0' : 'gap-2 px-2.5')}>
              <I n="shield" size={16} /> {!collapsed && 'Master'}
            </Link>
          </div>
        )}

        {/* ── CENTRO: menu único (tudo rola junto; Administração incluída) ── */}
        <nav className={cn('flex-1 overflow-y-auto py-3 ws-scroll', collapsed ? 'px-2 space-y-0.5' : 'px-2.5')} aria-label="Navegação do painel">
          {dashboardItem && (
            <NavItem item={dashboardItem} collapsed={collapsed}
              href={hrefFor(dashboardItem, q)} active={activePath === dashboardItem.href}
              theme={sectionTheme(dashboardItem.section)} />
          )}
          {nav.sections.map((sec) => (
            <NavSection key={sec.id} sec={sec} activePath={activePath} collapsed={collapsed} closed={closed}
              onToggle={toggleSection} unitQuery={q} />
          ))}
          {/* Seções marcadas como `footer` no catálogo (nenhuma hoje): o shell
              continua honrando a marca, sem que isso vire um segundo menu. */}
          {nav.footerSections.map((sec) => (
            <NavSection key={sec.id} sec={sec} activePath={activePath} collapsed={collapsed} closed={closed}
              onToggle={toggleSection} unitQuery={q} />
          ))}
          {/* A3.4: aqui existia o grupo "Outros destinos" (destinos com
              `sidebar: false`). Ele foi REMOVIDO: dois comportamentos na mesma
              barra confundiam mais do que ajudavam. Destino declarado sem linha
              de menu continua acessível por URL e por atalho contextual de quem
              o usa (ex.: "Ver histórico de execuções" dentro de Automações). */}

        </nav>

        {/* ── RODAPÉ: QUEM está logado, em UMA linha ──
            Avatar + nome + papel. "Sair" mora num popover, porque o rodapé não
            é lugar de ação primária e três linhas (usuário + botão gigante +
            marca) empurravam o menu para cima. A marca já está no topo. */}
        <div ref={userMenuRef} className={cn('relative shrink-0 border-t border-[var(--il-nav-border)]', collapsed ? 'p-2' : 'p-2')}>
          <button type="button" onClick={() => setUserMenuOpen((v) => !v)}
            aria-expanded={userMenuOpen} aria-haspopup="menu" aria-controls="nav-user-menu"
            title={collapsed ? `${user.name} — conta` : `${user.name} — conta`}
            className={cn('flex w-full items-center rounded-lg transition-colors hover:bg-[var(--il-nav-hover)]',
              collapsed ? 'h-9 justify-center' : 'gap-2.5 px-2 py-1.5')}>
            {/* A3.3 (ponto 9): o usuário logado usa o MESMO Avatar das demais
                listas de pessoas — sem um segundo avatar improvisado. */}
            <Avatar name={user.name || 'Equipe'} size={32} />
            {!collapsed && (
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-xs font-bold truncate text-[var(--il-nav-fg)]">{user.name}</span>
                <span className="block text-[11px] truncate text-[var(--il-nav-muted)]">
                  {ROLE_LABEL[business?.role || ''] || business?.role || 'Equipe'}
                </span>
              </span>
            )}
            {!collapsed && <I n="chevD" size={14} className={cn('shrink-0 text-[var(--il-nav-muted)] transition-transform', userMenuOpen && 'rotate-180')} />}
          </button>

          {userMenuOpen && (
            <div id="nav-user-menu" role="menu" aria-label="Conta"
              className={cn('absolute bottom-[calc(100%+6px)] z-50 w-[212px] rounded-xl border border-[var(--border)] bg-white p-1.5 text-[var(--text)] shadow-lg',
                collapsed ? 'left-2' : 'left-2 right-2 w-auto')}>
              <div className="px-2 py-1.5 border-b border-[var(--border-2)] mb-1">
                <p className="text-xs font-bold truncate">{user.name}</p>
                <p className="text-[11px] truncate text-[var(--text-muted)]">{user.email}</p>
                <p className="text-[11px] truncate text-[var(--text-muted)]">
                  {ROLE_LABEL[business?.role || ''] || business?.role || 'Equipe'}
                </p>
              </div>
              {/* Só o que existe de verdade: a conta é administrada em Equipe,
                  e não há preferência de usuário para inventar aqui. */}
              <button type="button" role="menuitem" onClick={logout}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-[var(--danger)] transition-colors hover:bg-[var(--danger-bg)]">
                <I n="logout" size={15} /> Sair da conta
              </button>
            </div>
          )}
        </div>
      </aside>


      {/* Mobile topbar */}
      <div className="lg:hidden sticky top-0 z-40 bg-white border-b border-[var(--border)] shadow-xs">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl overflow-hidden bg-[var(--il-nav-cta)] text-[var(--il-nav-cta-fg)] flex items-center justify-center font-bold text-sm shrink-0 shadow-brand">
              {business.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={business.logo} alt={business.name} className="w-full h-full object-cover" />
              ) : (business?.name || 'I').slice(0, 1).toUpperCase()}
            </span>
            {businesses.length > 1 ? (
              <select value={business?.id || ''} onChange={(e) => switchBiz(e.target.value)} aria-label="Trocar de negócio"
                className="bg-[var(--surface-3)] border border-[var(--border)] text-xs font-semibold rounded-md px-2 py-1.5 max-w-[160px] truncate">
                <option value="__overview">Visão geral da organização</option>
              <optgroup label="Unidades desta organização">{organizationUnits.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
              {otherBusinesses.length > 0 && <optgroup label="Outras organizações">{otherBusinesses.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
              <option value="__add">+ Adicionar unidade</option>
              </select>
            ) : (
              <span className="font-bold text-sm truncate text-[var(--text)]">{business?.name || 'Minha empresa'}</span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {business && <a href={`/${business.slug}`} target="_blank" className="text-xs font-semibold bg-[var(--il-nav-cta)] text-[var(--il-nav-cta-fg)] px-3 py-1.5 rounded-md shadow-brand">Ver site</a>}
            <button onClick={logout} className="bg-[var(--surface-3)] border border-[var(--border)] p-2 rounded-md hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]" aria-label="Sair"><I n="logout" size={14} /></button>
          </span>
        </div>

        {/* Fileira de atalhos + porta "Mais". Em 390px a fileira rola, mas:
            (1) o degradê avisa que existe continuação, (2) a pílula ativa é
            trazida para o centro sozinha, (3) "Mais" fica FORA da rolagem e
            abre tudo agrupado por seção — nada fica inalcançável. */}
        <div className="flex items-stretch gap-2 px-3 pb-2.5">
          <div className="relative flex-1 min-w-0">
            <div ref={pillsRef} onScroll={onPillsScroll}
              className="flex gap-1 overflow-x-auto no-scrollbar" aria-label="Atalhos do painel">
              {mobilePills.map((i) => (
                <Link key={i.href} href={hrefFor(i, q)} title={i.description} data-nav-item={i.href}
                  data-nav-active={activePath === i.href || undefined}
                  aria-current={activePath === i.href ? 'page' : undefined}
                  className={cn('shrink-0 text-xs font-semibold border rounded-pill px-3 py-1.5 inline-flex items-center gap-1.5 shadow-xs',
                    activePath === i.href
                      ? 'bg-[var(--il-nav-cta)] border-[var(--il-nav-cta)] text-[var(--il-nav-cta-fg)] shadow-brand'
                      : 'bg-white border-[var(--border-strong)] text-[var(--text-muted)]')}>
                  <I n={i.icon} size={14} /> {i.label}
                </Link>
              ))}
            </div>
            {pillFade && (
              <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent" aria-hidden="true" />
            )}
          </div>
          <button type="button" onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen} aria-controls="mobile-nav-more"
            className={cn('shrink-0 text-xs font-bold border rounded-pill px-3 inline-flex items-center gap-1 shadow-xs',
              moreOpen ? 'bg-[var(--brand)] border-[var(--brand)] text-white' : 'bg-white border-[var(--border-strong)] text-[var(--text)]')}>
            Mais
            <span className={cn('transition-transform duration-200', moreOpen && 'rotate-180')} aria-hidden="true"><I n="chevron" size={12} /></span>
          </button>
        </div>

        {moreOpen && (
          <div id="mobile-nav-more" className="px-3 pb-3">
            <div className="bg-white border border-[var(--border)] rounded-lg p-2 max-h-[60vh] overflow-y-auto shadow-lg">
              {mobileSections.map((sec) => (
                <div key={sec.id} className="mb-2 last:mb-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)] px-1 mb-1.5">{sec.label}</p>
                  <div className="grid grid-cols-2 gap-1">
                    {sec.items.map((i) => (
                      <Link key={i.href} href={hrefFor(i, q)} title={i.description} onClick={() => setMoreOpen(false)}
                        aria-current={activePath === i.href ? 'page' : undefined}
                        style={activePath === i.href
                          ? { backgroundColor: sectionTheme(sec.id).activeBg, color: sectionTheme(sec.id).activeFg, borderColor: 'transparent' }
                          : undefined}
                        className={cn('text-xs font-semibold border rounded-md px-2.5 py-2 inline-flex items-center gap-1.5 min-w-0',
                          activePath === i.href ? 'shadow-xs' : 'bg-white border-[var(--border)] text-[var(--text)]')}>
                        <I n={i.icon} size={14} className="shrink-0" /> <span className="truncate">{i.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <main className="flex-1 min-w-0 bg-[var(--bg)]">
        {support && (
          <div className={cn('px-4 lg:px-8 py-2.5 text-xs font-semibold flex flex-wrap items-center gap-x-3 gap-y-1 border-b',
            support.mode === 'view' ? 'bg-[var(--warning-bg)] text-[var(--warning-fg)] border-[var(--warning-border)]' : 'bg-[var(--danger)] text-white border-[var(--danger-strong)]')}>
            <span className="inline-flex items-center gap-1.5"><I n="shield" size={14} /> {support.mode === 'view' ? 'Modo suporte — somente leitura' : 'Modo administrativo'}</span>
            <span className="opacity-80">Empresa: {business?.name} · expira {new Date(support.expiresAt).toISOString().slice(11, 16)} UTC</span>
            <button onClick={async () => {
              await fetch('/api/master/support', { method: 'DELETE' }).catch(() => {});
              await fetch('/api/admin/support', { method: 'DELETE' }).catch(() => {});
              window.location.assign('/master');
            }} className="ml-auto underline underline-offset-2">Sair do modo suporte</button>
          </div>
        )}
        <div className={cn(isAgenda ? 'px-2 sm:px-3 lg:px-4 py-3' : 'px-4 lg:px-8 py-6', !isFullWidth && 'max-w-[960px]')}>
          {isMaster && !support && (
            <p className="mb-4 text-xs font-semibold text-[var(--warning-fg)] bg-[var(--warning-bg)] border border-[var(--warning-border)] rounded-md px-3 py-2 inline-flex items-center gap-2 shadow-xs">
              <I n="shield" size={14} /> Você é master — <Link href="/master" className="underline font-semibold">/master</Link>
            </p>
          )}
          {business && business.role && business.role !== 'OWNER' && (
            <p className="mb-4 text-xs text-[var(--text-muted)]">Você está como <strong className="text-[var(--text)]">{ROLE_LABEL[business.role] || business.role}</strong>{business.readOnly ? ' · somente leitura' : ''}</p>
          )}
          {business?.agendaScope === 'own' && (
            // Honestidade com quem atende: a agenda mostrada é SÓ a dele.
            // (A restrição é do servidor — aqui só avisamos.)
            <p className="mb-4 text-xs font-semibold text-[var(--text)] bg-white border border-[var(--border)] rounded-md px-3 py-2 inline-flex items-center gap-2 shadow-xs">
              <I n="idcard" size={14} />
              Você vê <strong>somente a sua agenda</strong>{business.professionalName ? ` (${business.professionalName})` : ''}. Os clientes da unidade continuam disponíveis em Clientes.
            </p>
          )}
          {business?.agendaScope === 'none' && (
            // Vínculo ainda não configurado: a agenda fica vazia por segurança
            // (nunca a de todo mundo). O caminho para resolver é o Equipe.
            <p className="mb-4 text-xs font-semibold text-[var(--warning-fg)] bg-[var(--warning-bg)] border border-[var(--warning-border)] rounded-md px-3 py-2 inline-flex flex-wrap items-center gap-2 shadow-xs" role="status">
              <I n="alert" size={14} />
              Seu acesso de atendimento ainda <strong>não está vinculado a um profissional</strong>, então a agenda aparece vazia.
              Peça ao administrador para vincular em Equipe → “Profissional vinculado”.
            </p>
          )}
          {access.state === 'denied' ? (
            // 403 AMIGÁVEL: o usuário continua logado e dentro do painel.
            // Nada aqui limpa token ou redireciona para /login.
            <AccessDenied
              area={access.area || access.route?.label}
              hint={access.reason === 'module'
                ? `O módulo “${access.route?.label}” não está ativo nesta empresa. Nada foi perdido: ao reativar em Recursos, a área volta com todo o conteúdo.`
                : undefined}
            />
          ) : children}
        </div>
        {!isAgenda && (
          <footer className="px-4 lg:px-8 py-4 border-t border-[var(--border)] mt-8">
            <p className="text-[11px] text-[var(--text-faint)] text-center">{business.name} · <a href={`/${business.slug}`} target="_blank" rel="noreferrer" className="underline font-semibold text-[var(--text-muted)]">página pública /{business.slug}</a></p>
          </footer>
        )}
      </main>

      {/* 403 de qualquer ação do painel → aviso amigável (sessão preservada). */}
      <ForbiddenToasts context={{ scope: 'action', area: access.area || activeRoute?.label }} />
    </div>
    </PanelHomeProvider>
  );
}
