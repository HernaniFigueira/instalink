'use client';

import { useEffect, useState } from 'react';
import {
  Badge, Button, IconButton, Input, Textarea, SelectMenu, Combobox, SearchField, DatePicker,
  Field, ReadOnlyField, StatusBadge, Tabs, OverflowTabs, Popover, DropdownMenu, Tooltip,
  DetailSideModal, Dialog, EmptyState, Notice, Card,
} from '@/components/ui';

export type LabFont = 'barlow' | 'inter' | 'geist';

const FONT_LABEL: Record<LabFont, string> = { barlow: 'Barlow (produção)', inter: 'Inter', geist: 'Geist' };

const TABS = [
  { id: 'resumo', label: 'Resumo', icon: 'userCircle' },
  { id: 'atendimentos', label: 'Atendimentos', icon: 'fileText', count: 3 },
  { id: 'agenda', label: 'Agenda', icon: 'calendar', count: 1 },
  { id: 'anamnese', label: 'Anamnese', icon: 'fileText', count: 0 },
  { id: 'arquivos', label: 'Arquivos', icon: 'upload', count: 2 },
  { id: 'financeiro', label: 'Financeiro', icon: 'wallet', count: 0 },
  { id: 'observacoes', label: 'Observações administrativas', icon: 'receipt', count: 1 },
];

const SERVICES = [
  { value: 'consulta', label: 'Consulta clínica · 30 min' },
  { value: 'vacina', label: 'Vacinação · 15 min' },
  { value: 'cirurgia', label: 'Cirurgia · 120 min' },
];

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} data-lab-section={id} className="space-y-4 border-t border-[var(--border)] pt-8">
      <header>
        <h2 className="gd-t-section text-[var(--text)]">{title}</h2>
        {hint && <p className="gd-t-helper text-[var(--text-muted)] mt-1">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-40 shrink-0 gd-t-metadata text-[var(--text-muted)]">{label}</span>
      {children}
    </div>
  );
}

export function UiLab({ font }: { font: LabFont }) {
  const [tab, setTab] = useState('resumo');
  const [overflowTab, setOverflowTab] = useState('observacoes');
  const [service, setService] = useState('consulta');
  const [pro, setPro] = useState('');
  const [date, setDate] = useState('2026-10-19');
  const [search, setSearch] = useState('');
  const [popover, setPopover] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);
  // Conteúdo só após a montagem: a lab mistura datas/locale locais que diferem
  // entre servidor e navegador (hidratação #418/#425). Página interna de conferência.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <div className="ui-lab-root min-h-screen bg-[var(--bg)]" aria-busy="true" />;

  return (
    <div className={`ui-lab-root ui-lab-font-${font} min-h-screen bg-[var(--bg)] text-[var(--text)]`} data-font={font}>
      <style>{`
        @font-face { font-family: 'GoDoutor Lab Inter'; src: url(/ui-lab/fonts/inter/inter-latin-400-normal.woff2) format('woff2'); font-weight: 400; font-display: swap; }
        @font-face { font-family: 'GoDoutor Lab Inter'; src: url(/ui-lab/fonts/inter/inter-latin-500-normal.woff2) format('woff2'); font-weight: 500; font-display: swap; }
        @font-face { font-family: 'GoDoutor Lab Inter'; src: url(/ui-lab/fonts/inter/inter-latin-600-normal.woff2) format('woff2'); font-weight: 600; font-display: swap; }
        @font-face { font-family: 'GoDoutor Lab Inter'; src: url(/ui-lab/fonts/inter/inter-latin-700-normal.woff2) format('woff2'); font-weight: 700; font-display: swap; }
        @font-face { font-family: 'GoDoutor Lab Geist'; src: url(/ui-lab/fonts/geist/Geist-Regular.woff2) format('woff2'); font-weight: 400; font-display: swap; }
        @font-face { font-family: 'GoDoutor Lab Geist'; src: url(/ui-lab/fonts/geist/Geist-Medium.woff2) format('woff2'); font-weight: 500; font-display: swap; }
        @font-face { font-family: 'GoDoutor Lab Geist'; src: url(/ui-lab/fonts/geist/Geist-SemiBold.woff2) format('woff2'); font-weight: 600; font-display: swap; }
        @font-face { font-family: 'GoDoutor Lab Geist'; src: url(/ui-lab/fonts/geist/Geist-Bold.woff2) format('woff2'); font-weight: 700; font-display: swap; }
        .ui-lab-font-inter, .ui-lab-font-inter * { font-family: 'GoDoutor Lab Inter', system-ui, sans-serif !important; }
        .ui-lab-font-geist, .ui-lab-font-geist * { font-family: 'GoDoutor Lab Geist', system-ui, sans-serif !important; }
      `}</style>

      <div className="mx-auto max-w-[1080px] px-6 py-8 space-y-8">
        <header className="space-y-3">
          <p className="gd-t-metadata text-[var(--text-muted)]">Interno · fora da navegação · {FONT_LABEL[font]}</p>
          <h1 className="gd-t-page-title">UI Lab — GoDoutor</h1>
          <p className="gd-t-body text-[var(--text-muted)]">
            Primitives reais de produção. Troca de fonte só nesta página (`?font=`); a fonte global não muda.
          </p>
          <nav aria-label="Fonte de comparação" className="flex gap-2">
            {(['barlow', 'inter', 'geist'] as LabFont[]).map((f) => (
              <a key={f} href={`?font=${f}`} data-font-option={f}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${f === font ? 'border-[var(--accent)] text-[var(--accent-fg)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
                {FONT_LABEL[f]}
              </a>
            ))}
          </nav>
        </header>

        <Section id="tipografia" title="Tipografia" hint="Escala: página 24–32, seção 20–24, grupo 16–24, micro 8–12.">
          <div className="space-y-2">
            <p className="gd-t-page-title">Page title · Agenda de quarta-feira</p>
            <p className="gd-t-section">Section title · Próximos atendimentos</p>
            <p className="text-[18px] font-semibold">Entity title · Luna · Golden Retriever</p>
            <p className="gd-t-label text-[var(--text)]">Label · Profissional</p>
            <p className="text-[15px] font-medium">Value · Dra. Michele Martins · 12:00–12:45</p>
            <p className="gd-t-helper text-[var(--text-muted)]">Helper · Opcional — em branco a agenda equilibra a equipe</p>
            <p className="gd-t-metadata text-[var(--text-faint)]">Muted / metadata · criado em 10/10/2026 às 09:12</p>
            <p className="text-[12px] font-semibold text-[var(--success-fg)]">Status · Confirmado</p>
            <p className="gd-t-button">Action · Salvar agendamento</p>
            <p className="tabular-nums text-[15px]">Números tabulares · 00:00 01:00 12:45 13:00 1.234,56 31.4 kg</p>
          </div>
        </Section>

        <Section id="acoes" title="Ações" hint="PRIMARY uma por grupo · SECONDARY com contorno em repouso · TERTIARY com cor de ação · DANGER só destrutiva.">
          <Row label="Primary"><Button>Salvar agendamento</Button><Button disabled>Salvar (desabilitado)</Button><Button loading>Salvando</Button></Row>
          <Row label="Secondary"><Button variant="secondary">Ver na agenda</Button><Button variant="secondary" size="sm">Editar dados</Button></Row>
          <Row label="Tertiary"><Button variant="ghost">Cancelar</Button><Button variant="ghost" size="sm">Ver detalhes</Button></Row>
          <Row label="Danger"><Button variant="destructive">Descartar</Button><Button variant="destructive-soft">Cancelar atendimento</Button></Row>
          <Row label="IconButton"><IconButton icon="x" label="Fechar" /><IconButton icon="edit" label="Editar" variant="secondary" /><IconButton icon="trash" label="Remover" variant="destructive-soft" /></Row>
          <Row label="Grupo de ações"><div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] p-3"><Button variant="secondary">Cancelar</Button><Button>Confirmar</Button></div></Row>
        </Section>

        <Section id="campos" title="Campos" hint="Erro aparece junto da causa; estados: normal, erro, desabilitado, somente leitura.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome do tutor" required hint="Busque no CRM para não duplicar cadastro"><Input placeholder="Buscar cliente…" /></Field>
            <Field label="Pet (paciente)" required error="Em clínica veterinária, escolha o pet (paciente) deste agendamento."><SelectMenu value="" onChange={() => {}} placeholder="Selecione o pet…" options={[{ value: 'luna', label: 'Luna' }, { value: 'thor', label: 'Thor' }]} /></Field>
            <Field label="Observação"><Textarea defaultValue="Prefere contato por WhatsApp no período da manhã." /></Field>
            <Field label="Desabilitado"><Input disabled defaultValue="Campo bloqueado" /></Field>
            <ReadOnlyField label="Somente leitura" value="Dermatite atópica em acompanhamento" />
            <Field label="Serviço" required><Combobox label="Serviço" value={service} onChange={(v) => setService(String(v))} options={SERVICES} /></Field>
            <Field label="Profissional"><Combobox label="Profissional" value={pro} onChange={(v) => setPro(String(v))} options={[{ value: '', label: 'Automático (equilibrar equipe)' }, { value: 'mi', label: 'Dra. Michele Martins' }]} /></Field>
            <Field label="Data" required><DatePicker label="Data" value={date} onChange={setDate} /></Field>
            <Field label="Buscar"><SearchField value={search} onChange={setSearch} placeholder="Buscar paciente, tutor, agendamento" /></Field>
          </div>
          <Row label="SelectMenu (seleção única)"><SelectMenu value="consulta" onChange={() => {}} options={SERVICES} /></Row>
        </Section>

        <Section id="estados" title="Status, avisos e vazio">
          <Row label="Badge"><Badge tone="zinc">Sem pagamento</Badge><Badge tone="green">Confirmado</Badge><Badge tone="amber">Pendente</Badge><Badge tone="red">Cancelado</Badge><Badge tone="blue">Retorno</Badge></Row>
          <Row label="StatusBadge"><StatusBadge tone="emerald">Em atendimento</StatusBadge><StatusBadge tone="amber">Aguardando</StatusBadge><StatusBadge tone="red">Falhou</StatusBadge><StatusBadge tone="purple">Retorno</StatusBadge></Row>
          <Notice tone="error" title="Não foi possível salvar">Escolha o pet (paciente) deste agendamento.</Notice>
          <Notice tone="warning">Este horário tem conflito com Thor às 12:00.</Notice>
          <Notice tone="success">Agendamento criado.</Notice>
          <Card><EmptyState title="Sem atendimentos hoje" hint="Novos agendamentos aparecem aqui." action={<Button variant="secondary" size="sm">Novo agendamento</Button>} /></Card>
        </Section>

        <Section id="abas" title="Abas e OverflowTabs" hint="Tabs: abas simples. OverflowTabs: as que cabem ficam visíveis, o resto vai para 'Mais N'. Sem rolagem escondida.">
          <Row label="Tabs"><Tabs items={TABS.slice(0, 4)} value={tab} onChange={setTab} ariaLabel="Seções (exemplo)" /></Row>
          <div className="space-y-2">
            <p className="gd-t-metadata text-[var(--text-muted)]">OverflowTabs · largura 520px</p>
            <div className="w-[520px] max-w-full"><OverflowTabs items={TABS} value={overflowTab} onChange={setOverflowTab} ariaLabel="Seções (overflow)" /></div>
          </div>
        </Section>

        <Section id="overlays" title="Popover, menu, tooltip, drawer e dialog" hint="Popover: ancorado, fade e deslocamento mínimo. Drawer: entra pela direita. Dialog: backdrop global, foco preso.">
          <Row label="Popover">
            <Popover open={popover} onClose={() => setPopover(false)} label="Exemplo de popover" trigger={<Button variant="secondary" onClick={() => setPopover((v) => !v)} aria-expanded={popover}>Abrir popover</Button>}>
              <div className="p-3 text-sm">Resumo rápido do agendamento.</div>
            </Popover>
            <DropdownMenu label="Mais ações" trigger={<Button variant="secondary">Mais ações</Button>} items={[{ id: 'a', label: 'Reagendar', onSelect: () => {} }, { id: 'b', label: 'Cancelar', onSelect: () => {}, danger: true }]} />
            <Tooltip label="Legenda e como usar a grade"><IconButton icon="info" label="Legenda" variant="ghost" /></Tooltip>
          </Row>
          <Row label="Drawer (detalhe)"><Button variant="secondary" onClick={() => setDrawer(true)}>Abrir drawer</Button></Row>
          <Row label="Dialog"><Button variant="secondary" onClick={() => setDialog(true)}>Abrir dialog</Button></Row>
          <DetailSideModal open={drawer} onClose={() => setDrawer(false)} title="Luna · Consulta clínica" subtitle="Dra. Michele Martins · 12:00–12:45">
            <div className="p-4 text-sm">Conteúdo de exemplo do drawer de detalhe.</div>
          </DetailSideModal>
          <Dialog open={dialog} onClose={() => setDialog(false)} title="Descartar novo agendamento?" subtitle="As informações preenchidas ainda não foram salvas." footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDialog(false)}>Continuar editando</Button><Button variant="destructive" onClick={() => setDialog(false)}>Descartar</Button></div>}>
            <p className="text-sm">Conteúdo de exemplo do dialog.</p>
          </Dialog>
        </Section>

        <Section id="espacamento" title="Espaçamento e movimento">
          <div className="flex items-end gap-3">
            {[4, 8, 12, 16, 24, 32].map((px) => (
              <div key={px} className="flex flex-col items-center gap-1">
                <div className="bg-[var(--accent)] rounded-sm" style={{ width: px, height: px }} />
                <span className="text-[11px] text-[var(--text-muted)]">{px}px</span>
              </div>
            ))}
          </div>
          <p className="gd-t-helper text-[var(--text-muted)]">Movimento: fast 140ms · base 160ms · dialog 180ms · saída do dialog 150ms. Respeita prefers-reduced-motion.</p>
        </Section>

        <p className="gd-t-helper text-[var(--text-faint)] pb-12">Fim do lab. Não é referência de produto: é conferência de primitives.</p>
      </div>
    </div>
  );
}
