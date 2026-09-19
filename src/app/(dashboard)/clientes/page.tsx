'use client';
// ═══════════════════════════════════════════════════════════════
// CLIENTES (CRM) — A3.3
// ═══════════════════════════════════════════════════════════════
// UMA porta por conceito: aqui é a LISTA + a FICHA da pessoa. As
// oportunidades por etapa vivem em /funil (o link antigo
// /clientes?view=esteira continua chegando lá).
//
// Ao abrir uma pessoa, a ficha completa (carteirinha + dados cadastrais +
// histórico 360) vive em components/dashboard/ClientProfileDrawer — o mesmo
// componente para quem chega da lista, do agendamento ou da conversa.
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { BookingConfig, BusinessPipeline } from '@/lib/types';
import { money, waLink } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { formatPhoneBR } from '@/lib/contact-profile';
import {
  Avatar, Badge, Button, EmptyState, ListSkeleton, PageHeader, Tabs, type TabItem,
} from '@/components/ui';
import { Icon } from '@/components/icons';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { NewClientSheet } from '@/components/dashboard/NewClientSheet';
import { ImportClientsSheet } from '@/components/dashboard/ImportClientsSheet';
import { ClientProfileDrawer, type Person360 } from '@/components/dashboard/ClientProfileDrawer';
import { effectiveHorizonDays } from '@/lib/booking-ops';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { apiGet } from '@/lib/api-client';

type ListFilter = 'all' | 'access' | 'noaccess' | 'marketing' | 'attended';

const FILTER_PARAM: Record<ListFilter, string> = {
  all: '',
  access: 'access=active',
  noaccess: 'access=none',
  marketing: 'consent=yes',
  attended: 'attended=yes',
};

export default function ClientesPage() {
  const params = useSearchParams();
  const router = useRouter();
  const businessId = params.get('b') || '';
  const [people, setPeople] = useState<Person360[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  // Busca profunda: /clientes?b=…&q=telefone abre já filtrada (usado pelo
  // "Cliente e histórico" do detalhe do agendamento).
  const [q, setQ] = useState(params.get('q') || '');
  const [search, setSearch] = useState(params.get('q') || '');
  const [filter, setFilter] = useState<ListFilter>('all');
  // A1.2 · Bloco 1: a esteira tinha DUAS portas (a rota /esteira e esta visão
  // dentro de Clientes). Agora existe UMA: /funil.
  const legacyEsteira = params.get('view') === 'esteira';
  useEffect(() => {
    if (!legacyEsteira) return;
    router.replace(`/funil${businessId ? `?b=${businessId}` : ''}`);
  }, [legacyEsteira, businessId, router]);
  const [loaded, setLoaded] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [bookingFor, setBookingFor] = useState<Person360 | null>(null);
  const [newClientOpen, setNewClientOpen] = useState(false);
  // A3.4 · Bloco 7 — a base entra e sai em arquivo (CSV).
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingClientOpen, setPendingClientOpen] = useState('');
  const [services, setServices] = useState<any[]>([]);
  const [pros, setPros] = useState<any[]>([]);

  // 403 → aviso amigável (sessão preservada), nunca lista "carregando" para sempre.
  const { denied, report } = useAreaLoad('Clientes');
  // A1.2 · Bloco 2: a UI concorda com o guard — o atalho para o Funil só
  // aparece para quem tem a permissão 'leads' (a mesma que /funil exige).
  const { permissions, ready: permsReady } = usePanelPermissions();
  const canFunil = permsReady && permissions.leads === true;
  const [pipeline, setPipeline] = useState<BusinessPipeline | null>(null);

  /**
   * A3.4 · Bloco 7 — exporta a base em CSV.
   *
   * Baixa o arquivo que a própria importação entende (ida e volta). O download
   * é do NAVEGADOR (blob), e não um link direto para a rota, para que uma
   * sessão expirada não termine num arquivo JSON de erro salvo como .csv.
   */
  async function downloadExport() {
    setExporting(true);
    setError('');
    try {
      const res = await fetch(`/api/contacts/export?businessId=${encodeURIComponent(businessId)}`);
      if (!res.ok) { setError(res.status === 403 ? 'Seu acesso não permite exportar a base.' : 'Não foi possível exportar agora.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Não foi possível exportar agora.');
    } finally {
      setExporting(false);
    }
  }

  const load = useCallback(async () => {
    if (!businessId) return;
    const extra = FILTER_PARAM[filter] ? `&${FILTER_PARAM[filter]}` : '';
    const res = await apiGet<{ people?: Person360[]; total?: number; pages?: number }>(
      `/api/people360?businessId=${businessId}&q=${encodeURIComponent(search)}&page=${page}${extra}`,
      { scope: 'area', area: 'Clientes' },
    );
    if (!report(res)) { setLoaded(true); return; }
    const d = res.data || {};
    setPeople(d.people || []);
    setTotal(d.total || 0);
    setPages(d.pages || 1);
    setLoaded(true);
    // Busca esteira para renderizar etapa real (stageId) e ações contextuais
    try {
      const pRes = await apiGet<{ pipeline?: BusinessPipeline }>(`/api/pipeline?businessId=${businessId}`, { scope: 'area', area: 'Clientes' });
      if (pRes.ok && (pRes.data as any)?.pipeline) setPipeline((pRes.data as any).pipeline);
    } catch { /* funil indisponível não derruba a lista */ }
  }, [businessId, search, page, filter, report]);

  useEffect(() => { load(); }, [load]);

  // Depois do cadastro, a lista é recarregada pelo mesmo endpoint do Cliente
  // 360. Quando o contato aparece, abrimos sua ficha sem inventar uma pessoa
  // paralela nem depender de um reload manual.
  useEffect(() => {
    if (!pendingClientOpen) return;
    const person = people.find((item) => item.contactId === pendingClientOpen);
    if (!person) return;
    setOpenKey(person.key);
    setPendingClientOpen('');
  }, [people, pendingClientOpen]);

  // A2-B3 (F5): horizonte real do negócio para o "+ Novo agendamento".
  const [bookingCfg, setBookingCfg] = useState<BookingConfig | null>(null);
  // A2-B5 (F9): fuso do negócio para o sheet de agendamento.
  const [bizTz, setBizTz] = useState('');

  function openBooking(p: Person360) {
    setBookingFor(p);
    apiGet<{ services?: any[]; professionals?: any[]; business?: { booking?: BookingConfig; businessTimezone?: string } }>(
      `/api/catalog/get?businessId=${businessId}`, { scope: 'action', area: 'Clientes' },
    ).then((res) => {
      if (!res.ok) { setError(res.message); return; }
      if (res.data?.business?.booking) setBookingCfg(res.data.business.booking);
      setBizTz(res.data?.business?.businessTimezone || '');
      setServices(res.data?.services || []);
      setPros(res.data?.professionals || []);
    });
  }

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setSearch(q); }, 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [filter]);

  const opened = people.find((p) => p.key === openKey) || null;

  const tabItems: TabItem<ListFilter>[] = [
    { id: 'all', label: 'Todos', icon: 'users' },
    { id: 'attended', label: 'Já atendidos', icon: 'calendar' },
    { id: 'marketing', label: 'Aceitam promoções', icon: 'megaphone' },
    { id: 'access', label: 'Com acesso', icon: 'lock' },
    { id: 'noaccess', label: 'Sem acesso', icon: 'user' },
  ];

  return (
    <>
      <PageHeader
        icon="users"
        title="Clientes"
        hint={`Base única de pessoas: cadastro, histórico e relacionamento${canFunil ? '. As oportunidades por etapa estão no Funil' : ''}.`}
        action={
          <>
            {canFunil && (
              <Link href={`/funil?b=${businessId}`}
                className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md px-3 py-2 bg-[var(--lilac-bg)] text-[var(--lilac-fg)] border border-[var(--lilac-border)] hover:bg-[var(--lilac-bg-hover)]">
                <Icon n="funnel" size={14} /> Funil de oportunidades
              </Link>
            )}
            <Button variant="secondary" onClick={() => setImportOpen(true)} title="Trazer a base de outro sistema (CSV)">
              <Icon n="upload" size={15} /> Importar
            </Button>
            <Button variant="secondary" disabled={exporting} title="Baixar a base em CSV"
              onClick={() => { void downloadExport(); }}>
              <Icon n="download" size={15} /> {exporting ? 'Gerando…' : 'Exportar'}
            </Button>
            <Button variant="primary" onClick={() => setNewClientOpen(true)}>
              <Icon n="plus" size={15} strokeWidth={2.6} /> Novo cliente
            </Button>
          </>
        }
      />

      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold bg-[var(--danger)] text-white rounded-md px-3 py-2 shadow-sm">{error}</p>
      )}

      {legacyEsteira ? null : (
        <>
          {/* Busca + filtros: o filtro é aplicado NO SERVIDOR antes da
              paginação, então o total sempre reflete o que está na tela. */}
          <div className="ws-panel p-3 mb-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Icon n="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por nome, WhatsApp, e-mail ou CPF…"
                  aria-label="Buscar cliente"
                  className="w-full bg-[var(--surface-3)] border border-[var(--border)] rounded-md pl-9 pr-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:shadow-focus focus:border-[var(--brand)] focus:bg-white"
                />
              </div>
              <span className="text-xs font-semibold text-[var(--text-muted)] bg-[var(--surface-3)] border border-[var(--border)] rounded-pill px-3 py-1.5 tabular-nums">
                {total} {total === 1 ? 'pessoa' : 'pessoas'} · pág {page}/{pages}
              </span>
            </div>
            <Tabs items={tabItems} value={filter} onChange={(v) => setFilter(v)} ariaLabel="Filtrar clientes" size="sm" />
          </div>

          {denied ? <AccessDenied area="Clientes" /> : !loaded ? <ListSkeleton rows={5} /> : people.length === 0 ? (
            <div className="ws-panel">
              <EmptyState
                icon={search ? 'search' : 'users'}
                title={search || filter !== 'all' ? 'Ninguém encontrado' : 'Nenhum cliente ainda'}
                hint={search || filter !== 'all'
                  ? 'Tente outro termo ou volte para “Todos”. Agendamentos, cadastros na página e conversas criam o perfil automaticamente.'
                  : 'Assim que alguém agendar, se cadastrar na sua página ou conversar pelo WhatsApp, o perfil aparece aqui sozinho.'}
                action={<Button variant="primary" onClick={() => setNewClientOpen(true)}><Icon n="plus" size={15} strokeWidth={2.6} /> Cadastrar cliente</Button>}
              />
            </div>
          ) : (
            <div className="ws-panel divide-y divide-[var(--border-soft)]">
              {people.map((p) => {
                const minor = p.tags?.some((t) => t.id === 'menor');
                return (
                  <article key={p.key} className="group hover:bg-[var(--surface-hover)] transition-colors">
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setOpenKey(p.key)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:shadow-focus rounded-md"
                        aria-label={`Abrir perfil de ${p.name || 'cliente'}`}
                      >
                        <Avatar name={p.name} src={p.avatar || undefined} size={42} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-bold text-[var(--text)] truncate">{p.name || 'Sem nome'}</span>
                            {p.age !== null && p.age !== undefined && (
                              <span className="text-xs text-[var(--text-muted)] tabular-nums">{p.age} anos</span>
                            )}
                            {minor && <Badge tone="amber">Menor</Badge>}
                            <Badge tone={p.accountStatus === 'active' ? 'green' : 'zinc'} icon={p.accountStatus === 'active' ? 'lock' : undefined}>
                              {p.accountStatus === 'active' ? 'Acesso ativo' : 'Sem acesso'}
                            </Badge>
                            {p.marketingOptIn && <Badge tone="green" icon="megaphone">Aceita promoções</Badge>}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-[var(--text-muted)]">
                            <span className="inline-flex items-center gap-1"><Icon n="phone" size={11} /> {p.phone ? formatPhoneBR(p.phone) : 'sem telefone'}</span>
                            <span className="inline-flex items-center gap-1"><Icon n="history" size={11} /> {p.lastSeen ? humanDay(p.lastSeen.slice(0, 10)) : 'sem contato'}</span>
                            {p.bookings.length > 0 && (
                              <span className="inline-flex items-center gap-1"><Icon n="calendar" size={11} /> {p.bookings.length} agend.</span>
                            )}
                            {p.leads.length > 0 && (
                              <span className="inline-flex items-center gap-1"><Icon n="funnel" size={11} /> {p.leads.length} no funil</span>
                            )}
                            {p.orders > 0 && <span className="font-semibold text-[var(--text)] tabular-nums">{money(p.spent)}</span>}
                          </span>
                        </span>
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button size="sm" variant="primary" onClick={() => setOpenKey(p.key)}>
                          <Icon n="wallet" size={14} /> Ver perfil
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => openBooking(p)} title="Novo agendamento para esta pessoa">
                          <Icon n="calendarPlus" size={14} /> <span className="hidden md:inline">Agendar</span>
                        </Button>
                        {p.phone && (
                          <a href={waLink(p.phone, `Olá, ${(p.name || '').split(' ')[0]}!`)} target="_blank" rel="noreferrer"
                            className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-md px-2.5 py-1.5 bg-[var(--success-bg)] text-[var(--success-fg)] border border-[var(--success-border)] hover:bg-[var(--success-bg-hover)]"
                            title="Abrir WhatsApp">
                            <Icon n="whatsapp" size={14} />
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
              {pages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 bg-[var(--surface-2)] text-xs">
                  <Button size="sm" variant="secondary" onClick={() => setPage((x) => Math.max(1, x - 1))} disabled={page <= 1}>
                    <Icon n="chevL" size={13} /> Anterior
                  </Button>
                  <span className="text-[var(--text-muted)] font-semibold tabular-nums">{page} de {pages} · {total} pessoas</span>
                  <Button size="sm" variant="secondary" onClick={() => setPage((x) => Math.min(pages, x + 1))} disabled={page >= pages}>
                    Próxima <Icon n="chevR" size={13} />
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {opened && (
        <ClientProfileDrawer
          person={opened}
          businessId={businessId}
          pipeline={pipeline}
          canFunil={canFunil}
          onClose={() => setOpenKey(null)}
          onChanged={load}
          onNewBooking={(p) => { setOpenKey(null); openBooking(p); }}
        />
      )}

      {importOpen && (
        <ImportClientsSheet
          businessId={businessId}
          onClose={() => setImportOpen(false)}
          onImported={load}
        />
      )}

      {newClientOpen && (
        <NewClientSheet
          businessId={businessId}
          onClose={() => setNewClientOpen(false)}
          onSaved={(contactId) => {
            setPendingClientOpen(contactId);
            load();
          }}
          onView360={() => {
            // `pendingClientOpen` é resolvido quando a resposta do 360 chega;
            // o botão pode fechar a ficha sem perder o destino.
            setNewClientOpen(false);
          }}
        />
      )}

      {bookingFor && (
        <NewBookingSheet
          businessId={businessId}
          services={services}
          pros={pros}
          horizonDays={effectiveHorizonDays(bookingCfg)}
          timezone={bizTz}
          initial={{ contactId: bookingFor.contactId, name: bookingFor.name, phone: bookingFor.phone, email: bookingFor.email }}
          onClose={() => setBookingFor(null)}
          onCreated={load}
        />
      )}
    </>
  );
}
