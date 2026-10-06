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
//
// CLINICAL ACCESS: a ROTA continua /clientes (schema e URL não mudam), mas o
// rótulo é contextual. Para o Professional vinculado esta tela é a lista de
// PACIENTES da unidade — o read model clínico do /api/people360 entrega os
// pacientes do tenant (nome, telefone do tutor, carteirinha e agendamentos)
// SEM histórico comercial (conversas, oportunidades, gasto/pedidos e dados de
// conta). Não existe segunda tela: mesma rota, mesma ficha, outro recorte.
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { BookingConfig, BusinessPipeline } from '@/lib/types';
import { money, waLink } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { formatPhoneBR } from '@/lib/contact-profile';
import { SearchListSkeleton,
  Avatar, Badge, Button, EmptyState, ListSkeleton, PageHeader, Tabs, buttonCls, type TabItem,
} from '@/components/ui';
import { Icon } from '@/components/icons';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { NewClientSheet } from '@/components/dashboard/NewClientSheet';
import { ImportClientsSheet } from '@/components/dashboard/ImportClientsSheet';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { useWorkspace } from '@/components/dashboard/WorkspaceContext';
import { ClientProfileDrawer, type Person360 } from '@/components/dashboard/ClientProfileDrawer';
import { effectiveHorizonDays } from '@/lib/booking-ops';
import { buildClientListReturnQuery } from '@/lib/client-return';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
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
  // P1.7 — o estado volta pela URL quando a ficha 360 devolve o usuário
  // (busca/filtro/página exatamente como estavam).
  const [page, setPage] = useState(() => Math.max(1, parseInt(params.get('page') || '1', 10) || 1));
  // Busca profunda: /clientes?b=…&q=telefone abre já filtrada (usado pelo
  // "Cliente e histórico" do detalhe do agendamento).
  const [q, setQ] = useState(params.get('q') || '');
  const [search, setSearch] = useState(params.get('q') || '');
  const [filter, setFilter] = useState<ListFilter>(() => {
    const fromUrl = params.get('filter') || '';
    return (['access', 'noaccess', 'marketing', 'attended'].includes(fromUrl) ? fromUrl : 'all') as ListFilter;
  });
  // A1.2 · Bloco 1: a esteira tinha DUAS portas (a rota /esteira e esta visão
  // dentro de Clientes). Agora existe UMA: /funil.
  const legacyEsteira = params.get('view') === 'esteira';
  useEffect(() => {
    if (!legacyEsteira) return;
    router.replace(`/funil${businessId ? `?b=${businessId}` : ''}`);
  }, [legacyEsteira, businessId, router]);
  const [loaded, setLoaded] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // P1.7 — o clique principal ABRE O 360 (rota própria, endereço
  // compartilhável). A gaveta vira PRÉVIA (ação secundária). O estado da
  // lista (busca/filtro/página) viaja na URL para o "Voltar para clientes"
  // devolver a lista EXATAMENTE como estava.
  const listStateQuery = () => {
    // §16 — contrato único em lib/client-return.ts: a ficha reconstrói este
    // estado no "Voltar para clientes" (busca, filtro e página preservados).
    return buildClientListReturnQuery({ b: businessId, q: search, filter, page });
  };
  const openFullProfile = (key: string) => {
    router.push(`/clientes/${encodeURIComponent(key)}?${listStateQuery()}`);
  };
  const [error, setError] = useState('');
  const [bookingFor, setBookingFor] = useState<Person360 | null>(null);
  const [newClientOpen, setNewClientOpen] = useState(false);
  // FASE 2 · P9 — Quick Create global: ?novo=1 abre a criação de paciente.
  const [novoHandled, setNovoHandled] = useState(false);
  useEffect(() => {
    if (novoHandled || !businessId || params.get('novo') !== '1') return;
    setNovoHandled(true);
    setNewClientOpen(true);
  }, [novoHandled, businessId, params]);
  // A3.4 · Bloco 7 — a base entra e sai em arquivo (CSV).
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  // A saída COMPLETA (JSON) é de quem administra a unidade — a permissão
  // genérica de Clientes não despeja a base sensível inteira.
  const { role } = usePanelPermissions();
  const canExportFull = ['OWNER', 'ADMIN', 'MASTER'].includes(String(role || '').toUpperCase());
  // Workflow + Permissões: exportar/importar a base é capacidade própria e só
  // vale com escopo da unidade (a mesma regra que o servidor aplica).
  const workspace = useWorkspace();
  const unitScope = !workspace.agendaScope || workspace.agendaScope === 'all';
  // Quem atende vê a lista como "Pacientes" (linguagem de cuidado); quem opera
  // a unidade continua vendo "Clientes" (CRM).
  const clinicalView = workspace.agendaScope === 'own' || workspace.agendaScope === 'none';
  const [pendingClientOpen, setPendingClientOpen] = useState('');
  const [createdClientId, setCreatedClientId] = useState('');
  const [services, setServices] = useState<any[]>([]);
  const [pros, setPros] = useState<any[]>([]);

  // 403 → aviso amigável (sessão preservada), nunca lista "carregando" para sempre.
  const { denied, report } = useAreaLoad('Clientes');
  // A1.2 · Bloco 2: a UI concorda com o guard — o atalho para o Funil só
  // aparece para quem tem a permissão 'leads' (a mesma que /funil exige).
  const { permissions, ready: permsReady } = usePanelPermissions();
  const canFunil = permsReady && permissions.leads === true;
  // WhatsApp é módulo próprio: quem atende só ganha o atalho se tiver a
  // permissão (o acesso clínico NÃO concede Conversas).
  const canWhats = permsReady && permissions.whatsapp === true;
  const canExportBase = permsReady && unitScope && permissions.clientes_exportar === true;
  const canImportBase = permsReady && unitScope && permissions.clientes_importar === true;
  const [pipeline, setPipeline] = useState<BusinessPipeline | null>(null);

  /**
   * A3.4 · Bloco 7 — exporta a base em CSV.
   *
   * Baixa o arquivo que a própria importação entende (ida e volta). O download
   * é do NAVEGADOR (blob), e não um link direto para a rota, para que uma
   * sessão expirada não termine num arquivo JSON de erro salvo como .csv.
   */
  function saveFile(blob: Blob, name: string) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    a.click();
    URL.revokeObjectURL(objectUrl);
  }

  /** Nome do arquivo que o SERVIDOR escolheu (já com a parte, quando há partes). */
  function fileNameFrom(res: Response, fallback: string): string {
    const cd = res.headers.get('content-disposition') || '';
    return (cd.match(/filename="([^"]+)"/) || [])[1] || fallback;
  }

  /**
   * A base COMPLETA sai em partes (o servidor pagina e diz `hasMore`): aqui
   * baixamos TODAS, uma a uma, para o arquivo não chegar pela metade sem aviso.
   */
  async function downloadFull() {
    const stamp = new Date().toISOString().slice(0, 10);
    let cursor = '';
    let parts = 0;
    let total = 0;
    for (let i = 0; i < 500; i++) {
      const res = await fetch(`/api/contacts/export-full?businessId=${encodeURIComponent(businessId)}${cursor ? `&cursor=${cursor}` : ''}`);
      if (!res.ok) {
        if (parts === 0) {
          setError(res.status === 403 ? 'A saída completa é de quem administra a unidade.' : 'Não foi possível exportar agora.');
          return;
        }
        setError(`Baixei ${parts} parte(s) e a próxima falhou. Tente de novo para completar o arquivo.`);
        return;
      }
      const text = await res.text();
      let page: any = null;
      try { page = JSON.parse(text); } catch { page = null; }
      if (!page || page.complete === undefined || !page.pagination) {
        setError('A resposta da exportação veio incompleta — nenhum arquivo parcial foi salvo como se fosse a base inteira.');
        return;
      }
      parts += 1;
      total = page.pagination.totalContacts || total;
      saveFile(new Blob([text], { type: 'application/json;charset=utf-8' }), fileNameFrom(res, `base-completa-${stamp}.json`));
      if (!page.pagination.hasMore) {
        setExportNotice(total === 0
          ? 'Nenhum contato para exportar.'
          : `Base completa: ${total.toLocaleString('pt-BR')} contato(s) em ${parts} arquivo(s).`);
        return;
      }
      cursor = String(page.pagination.nextCursor || '');
      if (!cursor) { setError('A paginação parou antes do fim — arquivo incompleto, não use como base.'); return; }
    }
    setError('A exportação passou do número máximo de partes — fale com o suporte.');
  }

  async function downloadExport(kind: 'csv' | 'full' = 'csv') {
    setExporting(kind);
    setError('');
    setExportNotice('');
    try {
      if (kind === 'full') { await downloadFull(); return; }
      const res = await fetch(`/api/contacts/export?businessId=${encodeURIComponent(businessId)}`);
      if (!res.ok) {
        setError(res.status === 403 ? 'Seu acesso não permite exportar a base.' : 'Não foi possível exportar agora.');
        return;
      }
      const blob = await res.blob();
      const stamp = new Date().toISOString().slice(0, 10);
      saveFile(blob, fileNameFrom(res, `clientes-${stamp}.csv`));
    } catch {
      setError('Não foi possível exportar agora.');
    } finally {
      setExporting('');
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
  }, [businessId, search, page, filter, report]);

  useEffect(() => { load(); }, [load]);

  // Esteira (etapa real + ações contextuais) só para quem tem `leads`: sem a
  // permissão NÃO há chamada (o servidor exigiria `leads` e devolveria 403).
  // Fica fora do `load` de propósito: assim a lista não é recarregada quando
  // as permissões ficam prontas, e a esteira não é rebaixada a cada busca/página.
  useEffect(() => {
    if (!businessId || !canFunil) { setPipeline(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const pRes = await apiGet<{ pipeline?: BusinessPipeline }>(`/api/pipeline?businessId=${businessId}`, { scope: 'area', area: 'Clientes' });
        if (!cancelled && pRes.ok && (pRes.data as any)?.pipeline) setPipeline((pRes.data as any).pipeline);
      } catch { /* funil indisponível não derruba a lista */ }
    })();
    return () => { cancelled = true; };
  }, [businessId, canFunil]);

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
  ];

  return (
    <>
      <PageHeader
        icon="users"
        title={clinicalView ? 'Pacientes' : 'Clientes'}
        action={
          <>
            {/* OPORTUNIDADES (§6): o kanban deixou de ser a identidade do
                produto e virou uma ferramenta DENTRO de Clientes — aparece só
                quando a capacidade está ativa e o usuário tem a permissão. */}
            {canFunil && (
              <Link href={`/funil?b=${businessId}`} className={buttonCls('secondary', 'sm')}>
                <Icon n="funnel" size={14} /> Oportunidades
              </Link>
            )}
            {canImportBase && (
              <Button variant="secondary" onClick={() => setImportOpen(true)} title="Trazer a base de outro sistema (CSV)">
                <Icon n="upload" size={15} /> Importar
              </Button>
            )}
            {canExportBase && (
              <Button variant="secondary" disabled={!!exporting} title="Baixar a base em CSV (reimportável)"
                onClick={() => { void downloadExport('csv'); }}>
                <Icon n="download" size={15} /> {exporting === 'csv' ? 'Gerando…' : 'Exportar'}
              </Button>
            )}
            {canExportBase && canExportFull && (
              <Button variant="secondary" disabled={!!exporting}
                title="Histórico completo em JSON (cadastro, perfil, agendamentos, conversas, tarefas)"
                onClick={() => { void downloadExport('full'); }}>
                <Icon n="download" size={15} /> {exporting === 'full' ? 'Gerando…' : 'Exportar tudo (JSON)'}
              </Button>
            )}
            {unitScope && (
              <Button variant="primary" onClick={() => setNewClientOpen(true)}>
                <Icon n="plus" size={15} strokeWidth={2.6} /> Novo cliente
              </Button>
            )}
          </>
        }
      />

      {error && (
        <p role="alert" className="mb-3 text-sm font-semibold bg-[var(--danger)] text-white rounded-md px-3 py-2 shadow-sm">{error}</p>
      )}
      {exportNotice && (
        <p role="status" className="mb-3 text-sm font-semibold bg-[var(--success)] text-white rounded-md px-3 py-2 shadow-sm">{exportNotice}</p>
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
                  placeholder={clinicalView ? 'Buscar por nome ou telefone…' : 'Buscar por nome, telefone, e-mail ou CPF…'}
                  aria-label={clinicalView ? 'Buscar paciente' : 'Buscar cliente'}
                  className="il-field-control bg-[var(--surface-3)] pl-9 pr-3 focus:bg-white"
                />
              </div>
              <span className="text-xs font-semibold text-[var(--text-muted)] bg-[var(--surface-3)] border border-[var(--border)] rounded-pill px-3 py-1.5 tabular-nums">
                {total} {total === 1 ? (clinicalView ? 'paciente' : 'pessoa') : (clinicalView ? 'pacientes' : 'pessoas')} · pág {page}/{pages}
              </span>
            </div>
            <Tabs items={tabItems} value={filter} onChange={(v) => setFilter(v)} ariaLabel={clinicalView ? 'Filtrar pacientes' : 'Filtrar clientes'} size="sm" />
          </div>

          {denied ? <AccessDenied area="Clientes" /> : !loaded ? <SearchListSkeleton rows={5} /> : people.length === 0 ? (
            <div className="ws-panel">
              <EmptyState
                icon={search ? 'search' : 'users'}
                title={search || filter !== 'all' ? 'Ninguém encontrado' : (clinicalView ? 'Nenhum paciente ainda' : 'Nenhum cliente ainda')}
                hint={search || filter !== 'all'
                  ? clinicalView
                    ? 'Tente outro nome ou telefone ou volte para “Todos”.'
                    : 'Tente outro termo ou volte para “Todos”. Agendamentos, cadastros na clínica e conversas criam o perfil automaticamente.'
                  : clinicalView
                    ? 'Assim que um paciente for cadastrado ou agendado na clínica, ele aparece aqui — inclusive os atendidos por outro profissional.'
                    : 'Assim que alguém agendar, for cadastrado na clínica ou conversar pelo WhatsApp, o perfil aparece aqui.'}
                action={clinicalView ? undefined : <Button variant="primary" onClick={() => setNewClientOpen(true)}><Icon n="plus" size={15} strokeWidth={2.6} /> Cadastrar cliente</Button>}
              />
            </div>
          ) : (
            <div className="ws-panel divide-y divide-[var(--border-soft)]">
              {people.map((p) => {
                const minor = p.tags?.some((t) => t.id === 'menor');
                return (
                  <article key={p.key} className="group hover:bg-[var(--surface-hover)] transition-colors">
                    {/* 2.0 · §H (responsividade): em telas estreitas a linha vira
                        DUAS: identidade em cima (com espaço para o nome e os
                        selos) e as ações alinhadas à direita embaixo. Antes o
                        grupo de botões `shrink-0` comia o nome ("Marlen…") e
                        quebrava o telefone em várias linhas. */}
                    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                      <button
                        type="button"
                        onClick={() => openFullProfile(p.key)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:shadow-focus rounded-md"
                        aria-label={`Abrir perfil de ${p.name || (clinicalView ? 'paciente' : 'cliente')}`}
                      >
                        <Avatar name={p.name} src={p.avatar || undefined} size={42} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold text-[var(--text)] truncate">{p.name || 'Sem nome'}</span>
                            {p.age !== null && p.age !== undefined && (
                              <span className="text-xs text-[var(--text-muted)] tabular-nums">{p.age} anos</span>
                            )}
                            {minor && <Badge tone="amber">Menor</Badge>}

                          </span>
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-[var(--text-muted)]">
                            <span className="inline-flex items-center gap-1"><Icon n="phone" size={11} /> {p.phone ? formatPhoneBR(p.phone) : 'sem telefone'}</span>
                            {!clinicalView && <span className="inline-flex items-center gap-1"><Icon n="history" size={11} /> {p.lastSeen ? humanDay(p.lastSeen.slice(0, 10)) : 'sem contato'}</span>}
                            {p.bookings.length > 0 && (
                              <span className="inline-flex items-center gap-1"><Icon n="calendar" size={11} /> {p.bookings.length} agend.</span>
                            )}
                            {!clinicalView && (p.leads || []).length > 0 && (
                              <span className="inline-flex items-center gap-1"><Icon n="funnel" size={11} /> {(p.leads || []).length} em oportunidades</span>
                            )}
                            {!clinicalView && (p.orders || 0) > 0 && <span className="font-semibold text-[var(--text)] tabular-nums">{money(p.spent || 0)}</span>}
                          </span>
                        </span>
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                        <Button size="sm" variant="primary" onClick={() => openFullProfile(p.key)}>
                          <Icon n="userCircle" size={14} /> Ver perfil
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setOpenKey(p.key)} title="Prévia rápida sem sair da lista">
                          <Icon n="eye" size={14} /> <span className="hidden md:inline">Prévia</span>
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => openBooking(p)} title="Novo agendamento para esta pessoa">
                          <Icon n="calendarPlus" size={14} /> <span className="hidden md:inline">Agendar</span>
                        </Button>
                        {p.phone && canWhats && (
                          <a href={waLink(p.phone, `Olá, ${(p.name || '').split(' ')[0]}!`)} target="_blank" rel="noreferrer"
                            className={buttonCls('whatsapp', 'xs')}
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
                  <span className="text-[var(--text-muted)] font-semibold tabular-nums">{page} de {pages} · {total} {clinicalView ? 'pacientes' : 'pessoas'}</span>
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
            setCreatedClientId(contactId);
            load();
          }}
          onView360={() => {
            // Open only on the explicit action, never over the save confirmation.
            setPendingClientOpen(createdClientId);
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
