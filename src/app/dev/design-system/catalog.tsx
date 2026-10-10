'use client';
// ═══════════════════════════════════════════════════════════════
// CATÁLOGO VIVO DO DESIGN SYSTEM 1.0 — /dev/design-system?dev=1
// ═══════════════════════════════════════════════════════════════
// Cada componente canônico aparece aqui com TODOS os estados (repouso, hover,
// focus, selecionado, disabled, erro, vazio, carregando). Este arquivo é a
// referência visual do sistema — e o lugar de olhar antes de inventar algo.
import { useState } from 'react';
import {
  A, ActionSection, Avatar, Badge, Button, Calendar, Checkbox, CloseButton, Combobox, DatePicker,
  Dialog, Drawer, DropdownMenu, EmptyState, Field, FilterPill, HoverCard, HoursChips, IconButton,
  Input, Kpi, ListSkeleton, Notice, PageActionBar, Pagination, Popover, Radio, SearchField,
  Segmented, Select, Skeleton, Stat, StatusBadge, Switch, Table, TableBody, TableCell, TableHead,
  TableRow, Tabs, Textarea, ToastViewport, Tooltip, useToasts,
} from '@/components/ui';

function Section({ id, title, rule, children }: { id: string; title: string; rule: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10">
      <header className="mb-4 border-b border-[var(--gd-border)] pb-2">
        <h2 className="text-[var(--gd-font-size-section)] font-semibold text-[var(--gd-text)]">{title}</h2>
        <p className="mt-0.5 text-[var(--gd-font-size-secondary)] text-[var(--gd-text-muted)]">{rule}</p>
      </header>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-[var(--gd-font-size-caption)] font-semibold uppercase tracking-wide text-[var(--gd-text-muted)]">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

const SWATCHES: Array<[string, string]> = [
  ['--gd-bg-app', 'fundo do app'], ['--gd-bg-surface', 'superfície'], ['--gd-bg-subtle', 'sutil'],
  ['--gd-bg-inset', 'inset'], ['--gd-border', 'borda'], ['--gd-border-soft', 'borda sutil'],
  ['--gd-text', 'texto'], ['--gd-text-muted', 'texto de apoio'], ['--gd-accent', 'acento'],
  ['--gd-accent-soft', 'acento suave'], ['--gd-success', 'sucesso'], ['--gd-warning', 'atenção'],
  ['--gd-danger', 'perigo'], ['--gd-info', 'informação'], ['--gd-nav-bg', 'navegação'],
];

export function DesignSystemCatalog() {
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [select, setSelect] = useState('consulta');
  const [combo, setCombo] = useState<string | string[]>(['svc-2']);
  const [checked, setChecked] = useState(true);
  const [switched, setSwitched] = useState(false);
  const [radio, setRadio] = useState('dia');
  const [segment, setSegment] = useState<'dia' | 'semana' | 'lista'>('dia');
  const [tab, setTab] = useState<'hoje' | 'semana' | 'mes'>('hoje');
  const [pill, setPill] = useState(true);
  const [date, setDate] = useState('2026-10-05');
  const [page, setPage] = useState(2);
  const [popover, setPopover] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const options = [
    { value: 'svc-1', label: 'Consulta clínica', hint: '30 min · R$ 120' },
    { value: 'svc-2', label: 'Vacinação', hint: '30 min · R$ 80' },
    { value: 'svc-3', label: 'Cirurgia', hint: '120 min · R$ 500', disabled: true },
  ];

  return (
    <div className="gd-app min-h-screen bg-[var(--gd-bg-app)] px-[var(--gd-page-pad-x)] py-[var(--gd-page-pad-y)] text-[var(--gd-text)]">
      <div className="mx-auto max-w-[1100px]">
        <header className="mb-8">
          <p className="text-[var(--gd-font-size-caption)] font-semibold uppercase tracking-wide text-[var(--gd-text-muted)]">GoDoutor Design System 1.0</p>
          <h1 className="mt-1 text-[var(--gd-font-size-page-title)] font-semibold text-[var(--gd-text-strong)]">Catálogo canônico de componentes</h1>
          <p className="mt-1 max-w-[70ch] text-[var(--gd-font-size-body)] text-[var(--gd-text-muted)]">
            Uma página não tem design próprio: ela escolhe componentes semânticos. Todos os estados estão aqui
            (repouso, hover, focus, selecionado, disabled, erro, vazio e carregando). Fonte única de tokens:
            <code className="ml-1 rounded bg-[var(--gd-bg-inset)] px-1">src/styles/godoutor-design-system.css</code>.
          </p>
        </header>

        <Section id="tokens" title="Tokens" rule="Cor, tipografia, espaçamento, raio e elevação — nunca um valor literal na página.">
          <Row label="Cores semânticas (resolvidas do CSS)">
            {SWATCHES.map(([token, name]) => (
              <div key={token} className="w-[132px]">
                <div className="h-12 rounded-[var(--gd-radius-sm)] border border-[var(--gd-border)]" style={{ background: `var(${token})` }} />
                <p className="mt-1 text-[var(--gd-font-size-caption)] font-semibold text-[var(--gd-text)]">{name}</p>
                <p className="text-[11px] text-[var(--gd-text-muted)]">{token}</p>
              </div>
            ))}
          </Row>
          <Row label="Escala de texto (peso 400/500/600; 700 só em título)">
            <p className="text-[20px] font-semibold">Título de página · 20</p>
            <p className="text-[15px] font-semibold">Seção · 15</p>
            <p className="text-[13.5px]">Corpo · 13.5</p>
            <p className="text-[12.5px]">Apoio · 12.5</p>
            <p className="text-[12px] text-[var(--gd-text-muted)]">Metadado · 12</p>
            <p className="text-[11px] text-[var(--gd-text-muted)]">Legenda · 11</p>
            <p className="tabular-nums font-medium">09:30 · 14:00 · R$ 1.280,00</p>
          </Row>
          <Row label="Elevação (só overlay real)">
            {['--gd-shadow-xs', '--gd-shadow-sm', '--gd-shadow-md', '--gd-shadow-lg'].map((s) => (
              <div key={s} className="h-16 w-40 rounded-[var(--gd-radius-md)] border border-[var(--gd-border)] bg-[var(--gd-bg-surface)] text-[11px] text-[var(--gd-text-muted)] flex items-center justify-center" style={{ boxShadow: `var(${s})` }}>{s.replace('--gd-shadow-', '')}</div>
            ))}
          </Row>
        </Section>

        <Section id="botoes" title="Button · IconButton · CloseButton" rule="PRIMARY: uma por superfície. DANGER: em repouso é SOFT (destructive-soft); SOLID só na confirmação destrutiva final.">
          <Row label="Variantes">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="warning">Warning soft · Não compareceu</Button>
            <Button variant="destructive-soft">Danger soft · em repouso</Button>
            <Button variant="destructive">Danger solid (confirmar)</Button>
            <Button variant="success">Success</Button>
            <Button variant="link">Link</Button>
          </Row>
          <Row label="Tamanhos + estados">
            <Button size="xs">xs</Button>
            <Button size="sm">sm</Button>
            <Button size="md">md</Button>
            <Button size="lg">lg</Button>
            <Button disabled>disabled</Button>
            <Button variant="secondary" disabled>disabled</Button>
            <IconButton icon="settings" label="Configurações" />
            <IconButton icon="x" label="Remover" variant="ghost" size="sm" />
            <CloseButton onClick={() => {}} />
          </Row>
          <Row label="Foco (Tab) e link">
            <A href="#botoes" variant="secondary">Âncora com contrato de botão</A>
            <span className="text-[var(--gd-font-size-secondary)] text-[var(--gd-text-muted)]">Use Tab para ver o anel de foco único.</span>
          </Row>
        </Section>

        <Section id="campos" title="Campos" rule="Altura, raio, borda, foco e ajuda iguais em todo o sistema (Select nativo proibido fora de exceção).">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Nome do tutor" hint="Como aparece na agenda" required>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ana Tutora" />
            </Field>
            <Field label="Erro de validação" error="Informe pelo menos 3 caracteres">
              <Input defaultValue="An" />
            </Field>
            <Field label="Observações">
              <Textarea placeholder="Sem quebra de linha especial…" />
            </Field>
            <Field label="Serviço (Select canônico)">
              <Select value={select} onChange={(e) => setSelect(e.target.value)}>
                <option value="consulta">Consulta clínica</option>
                <option value="vacina">Vacinação</option>
              </Select>
            </Field>
            <Field label="Serviços (MultiSelect)">
              <Combobox mode="multiple" label="Serviços" options={options} value={combo} onChange={setCombo} />
            </Field>
            <Field label="Profissional (Combobox com busca)">
              <Combobox label="Profissional" options={[
                { value: 'p1', label: 'Dra. Michele', hint: 'Clínica geral' },
                { value: 'p2', label: 'Dr. Orlando', hint: 'Veterinário' },
              ]} value={'p1'} onChange={() => {}} />
            </Field>
            <Field label="Cidade (Autocomplete)">
              <Combobox mode="autocomplete" label="Cidade" placeholder="Digite para sugerir…" options={[
                { value: 'rio', label: 'Rio de Janeiro', hint: 'RJ' },
                { value: 'niteroi', label: 'Niterói', hint: 'RJ' },
              ]} value={''} onChange={() => {}} emptyLabel="Nenhuma cidade encontrada" />
            </Field>
            <Field label="Busca (SearchField)">
              <SearchField value={search} onChange={setSearch} placeholder="Buscar paciente, serviço…" kbd="⌘K" />
            </Field>
            <Field label="Data (DatePicker canônico — sem input date nativo)">
              <DatePicker value={date} onChange={setDate} label="Data do agendamento" />
            </Field>
            <div className="space-y-3">
              <Checkbox label="Enviar lembrete" hint="24h antes do horário" checked={checked} onChange={setChecked} />
              <Checkbox label="Desabilitado" checked={false} onChange={() => {}} disabled />
              <Switch label="Confirmar automaticamente" checked={switched} onChange={setSwitched} />
              <div className="flex flex-col gap-2">
                <Radio name="visao" value="dia" label="Dia" checked={radio === 'dia'} onChange={setRadio} />
                <Radio name="visao" value="semana" label="Semana" hint="Grade de 7 dias" checked={radio === 'semana'} onChange={setRadio} />
              </div>
            </div>
          </div>
        </Section>

        <Section id="overlays" title="Overlays" rule="Tooltip (curto) · HoverCard (rico, 180ms) · Popover (controlado) · Menu · Dialog · Drawer/Sheet. Um CloseButton neutro.">
          <Row label="Tooltip · HoverCard · DropdownMenu">
            <Tooltip label="Recolher navegação"><Button variant="secondary" size="sm">Hover/foco → Tooltip</Button></Tooltip>
            <HoverCard content={<div><p className="font-semibold">Thor QA · Ana Tutora</p><p className="text-[var(--gd-text-muted)]">Consulta clínica · 14:00 · Dra. Michele</p></div>}>
              <Button variant="secondary" size="sm">Hover/foco → HoverCard</Button>
            </HoverCard>
            <DropdownMenu
              label="Ações do agendamento"
              trigger={<Button variant="secondary" size="sm">Ações ▾</Button>}
              items={[
                { id: 'arrive', label: 'Registrar chegada', icon: 'check' },
                { id: 'resched', label: 'Reagendar', icon: 'calendar' },
                { id: 'noshow', label: 'Não compareceu', icon: 'alert' },
                { id: 'cancel', label: 'Cancelar', icon: 'x', danger: true, separatorBefore: true },
                { id: 'soon', label: 'Indisponível (disabled)', disabled: true },
              ]}
            />
          </Row>
          <Row label="Popover · Dialog · Drawer/Sheet">
            <Popover
              open={popover}
              onClose={() => setPopover(false)}
              label="Criar rápido"
              trigger={<Button size="sm" onClick={() => setPopover((v) => !v)}>Popover ancorado</Button>}
            >
              <p className="gd-layer__label">Criar rápido</p>
              <div className="space-y-3">
                <Field label="Paciente"><Input placeholder="Buscar…" /></Field>
                <Field label="Data"><DatePicker value={date} onChange={setDate} /></Field>
                <Button size="sm" className="w-full">Criar agendamento</Button>
              </div>
            </Popover>
            <Button variant="secondary" size="sm" onClick={() => setDialog(true)}>Dialog</Button>
            <Button variant="secondary" size="sm" onClick={() => setDrawer(true)}>Drawer / Sheet</Button>
            <Button variant="ghost" size="sm" onClick={() => push({ title: 'Agendamento criado', message: 'Hoje às 14:00 com Dra. Michele', tone: 'success' })}>Toast</Button>
          </Row>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="Confirmar cancelamento"
            subtitle="O horário volta para a agenda."
            footer={<><Button variant="secondary" onClick={() => setDialog(false)}>Voltar</Button><Button variant="destructive">Cancelar agendamento</Button></>}
          >
            <p className="text-[var(--gd-font-size-body)] text-[var(--gd-text-muted)]">Esta ação avisa o paciente e libera o horário. Nada mais é alterado.</p>
          </Dialog>
          <Drawer open={drawer} onClose={() => setDrawer(false)} title="Detalhe do agendamento" subtitle="Hoje · 14:00" width="max-w-[520px]">
            <div className="space-y-4 p-1">
              <StatusBadge tone="blue">Confirmado</StatusBadge>
              <p className="text-[var(--gd-font-size-body)]">Thor QA · Ana Tutora · Consulta clínica</p>
              <ActionSection title="Registrar chegada" hint="O paciente está na recepção.">
                <Button size="sm">Registrar chegada</Button>
              </ActionSection>
              <ActionSection title="Não compareceu" hint="Marca falta sem cancelar o histórico.">
                <Button variant="warning" size="sm">Não compareceu</Button>
              </ActionSection>
            </div>
          </Drawer>
        </Section>

        <Section id="dados" title="Dados e listas" rule="Tabela canônica, paginação, estados vazios e carregamento.">
          <div className="mb-6 overflow-hidden rounded-[var(--gd-radius-md)] border border-[var(--gd-border)] bg-[var(--gd-bg-surface)]">
            <Table>
              <TableHead>
                <TableRow>
                  <th>Paciente</th><th>Serviço</th><th>Profissional</th><th className="gd-table__num">Valor</th>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow><TableCell>Thor QA</TableCell><TableCell>Consulta clínica</TableCell><TableCell>Dra. Michele</TableCell><TableCell numeric>R$ 120,00</TableCell></TableRow>
                <TableRow><TableCell>Luna QA</TableCell><TableCell>Vacinação</TableCell><TableCell>Dr. Orlando</TableCell><TableCell numeric>R$ 80,00</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
          <Row label="Paginação">
            <Pagination page={page} pageCount={7} onPage={setPage} total={132} perPage={20} />
          </Row>
          <Row label="Badges e status">
            <Badge tone="zinc">Neutro</Badge>
            <Badge tone="blue">Informação</Badge>
            <StatusBadge tone="emerald">Concluído</StatusBadge>
            <StatusBadge tone="amber">Aguardando</StatusBadge>
            <StatusBadge tone="red">Não compareceu</StatusBadge>
          </Row>
          <Row label="Avisos (Notice) e faixa de atenção">
            <div className="w-full max-w-[520px] space-y-3">
              <Notice tone="info" title="Informação">Bloqueio criado às 12:00.</Notice>
              <Notice tone="warning" title="Atenção">Dois agendamentos sem confirmação.</Notice>
              <Notice tone="error" title="Erro ao salvar">Tente novamente em instantes.</Notice>
            </div>
          </Row>
          <Row label="Vazio e carregando">
            <div className="w-full max-w-[420px] rounded-[var(--gd-radius-md)] border border-[var(--gd-border)] bg-[var(--gd-bg-surface)] p-4">
              <EmptyState title="Nenhum agendamento" hint="Quando alguém marcar, aparece aqui." action={<Button size="sm">Criar agendamento</Button>} />
            </div>
            <div className="w-full max-w-[420px] space-y-3 rounded-[var(--gd-radius-md)] border border-[var(--gd-border)] bg-[var(--gd-bg-surface)] p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <ListSkeleton rows={2} />
            </div>
          </Row>
        </Section>

        <Section id="navegacao" title="Navegação interna e métricas" rule="Segmented, Tabs, chips de filtro, métricas e identidade.">
          <Row label="Segmented (Dia | Semana | Lista) e Tabs">
            <Segmented
              ariaLabel="Visão da agenda"
              value={segment}
              onChange={setSegment}
              items={[{ id: 'dia', label: 'Dia' }, { id: 'semana', label: 'Semana' }, { id: 'lista', label: 'Lista' }]}
            />
            <Tabs
              ariaLabel="Períodos"
              value={tab}
              onChange={setTab}
              items={[{ id: 'hoje', label: 'Hoje' }, { id: 'semana', label: 'Semana' }, { id: 'mes', label: 'Mês', disabled: true }]}
            />
          </Row>
          <Row label="Chips de filtro">
            <FilterPill active={pill} onClick={() => setPill((v) => !v)}>Somente confirmados</FilterPill>
            <FilterPill active={!pill} onClick={() => setPill((v) => !v)}>Todos</FilterPill>
          </Row>
          <Row label="Métricas e identidade">
            <Kpi label="Atendimentos hoje" value="18" hint="+3 vs. ontem" tone="brand" icon="calendar" />
            <Stat label="Taxa de retorno" value="62%" tone="success" icon="trend" />
            <Avatar name="Ana Tutora QA" size={44} />
            <HoursChips days={[{ weekday: 1, windows: [{ start: '09:00', end: '18:00' }] }, { weekday: 2, windows: [{ start: '09:00', end: '18:00' }] }, { weekday: 0, windows: [] }]} />
          </Row>
          <Row label="Calendário (isolado, com min/max)">
            <div className="rounded-[var(--gd-radius-md)] border border-[var(--gd-border)] bg-[var(--gd-bg-surface)] p-3">
              <Calendar value={date} onSelect={setDate} min="2026-10-01" max="2026-10-31" />
            </div>
          </Row>
        </Section>

        <Section id="acoes" title="Ações de página" rule="Texto à esquerda, ação à direita, com respiro. Uma PRIMARY por superfície.">
          <div className="rounded-[var(--gd-radius-md)] border border-[var(--gd-border)] bg-[var(--gd-bg-surface)] px-4">
            <ActionSection title="Revisar e finalizar" hint="Confere o fechamento clínico antes de concluir.">
              <Button variant="secondary" size="sm">Salvar rascunho</Button>
              <Button size="sm">Revisar e finalizar</Button>
            </ActionSection>
            <ActionSection title="Histórico" hint="Revisões, adendos e reaberturas ficam registrados.">
              <Button variant="ghost" size="sm">Ver histórico</Button>
            </ActionSection>
          </div>
          <div className="mt-4 overflow-hidden rounded-[var(--gd-radius-md)] border border-[var(--gd-border)]">
            <PageActionBar hint="As alterações valem só para esta unidade.">
              <Button variant="ghost" size="sm">Descartar</Button>
              <Button size="sm">Salvar alterações</Button>
            </PageActionBar>
          </div>
        </Section>

        <ToastViewport toasts={toasts} onDismiss={dismiss} />
      </div>
    </div>
  );
}
