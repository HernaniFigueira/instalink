import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Drawer, Field, IconButton, Input, Notice, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { PhoneBRInput } from '@/components/dashboard/PhoneBRInput';
import { SECTION_THEME } from '@/lib/panel';
import '@/app/globals.css';

function Fixture() {
  const [scoped, setScoped] = useState(true);
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [tab, setTab] = useState('agenda');
  const [name, setName] = useState('Pessoa sintética');
  const [phone, setPhone] = useState('21987654321');
  const [count, setCount] = useState(0);
  return <>
    <section data-testid="legacy" style={{ padding: 12 }}>
      <p>Harness de testes — dados sintéticos, sem API</p>
      <Button onClick={() => setScoped(!scoped)}>Alternar escopo</Button>
      <Button onClick={() => setCount(count + 1)}>Fundo {count}</Button>
      <div data-testid="public" className="il-page" style={{ '--il-primary': '#6937a6', '--il-text': '#211827', '--il-bg': '#fbf6ff' } as React.CSSProperties}>
        <button className="il-btn">Tema da clínica</button>
      </div>
    </section>
    <main className={scoped ? 'il-platform' : ''} data-testid="workspace" style={{ padding: 24, background: 'var(--bg)' }}>
      <PageHeader title="Base visual D1a" hint="Componentes reais; conteúdo de teste isolado." icon="calendar" />
      <nav aria-label="Menu sintético" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {Object.entries(SECTION_THEME).map(([key, theme]) => <a key={key} href={`#${key}`} data-nav-item={key}
          aria-current="page" style={{ padding: 12, backgroundColor: theme.activeBg, color: theme.activeFg }}>
          <span aria-hidden="true" style={{ color: theme.accent }}>●</span> {key}
        </a>)}
      </nav>
      <Tabs ariaLabel="Visualização" idPrefix="fixture" value={tab} onChange={setTab} items={[
        { id: 'agenda', label: 'Agenda', panelId: 'panel-agenda' },
        { id: 'off', label: 'Indisponível', disabled: true },
        { id: 'fila', label: 'Fila', panelId: 'panel-fila' },
      ]} />
      {['agenda', 'fila'].map(id => <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`fixture-tab-${id}`} hidden={tab !== id} style={{ padding: 12 }}>Exemplo: {id}</div>)}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '16px 0' }}>
        <Button onClick={() => setOpen(true)}>Abrir ficha</Button>
        <Button variant="success">Concluir</Button><Button variant="warning">Pendência</Button><Button variant="danger">Excluir</Button>
        <IconButton icon="plus" label="Adicionar" size="sm" />
      </div>
      <Field label="Cliente" hint="Nome de demonstração" required><Input value={name} onChange={e => setName(e.target.value)} /></Field>
      <div style={{ marginTop: 12 }}><Notice tone="warning">Nenhum dado clínico ou integração é usado aqui.</Notice></div>
      <Skeleton className="h-6 w-48" />
      <Drawer open={open} onClose={() => setOpen(false)} title="Ficha sintética" subtitle="Revisão de foco e teclado"
        footer={<Button onClick={() => setOpen(false)}>Fechar ficha</Button>}>
        <div style={{ padding: 16 }}>
          <Field label="Nome na ficha" hint="Não será salvo"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="WhatsApp" hint="Máscara existente"><PhoneBRInput value={phone} onChange={setPhone} /></Field>
          <Button onClick={() => setNested(true)}>Abrir segunda ficha</Button>
          <input aria-label="Consome Escape" onKeyDown={e => { if (e.key === 'Escape') e.preventDefault(); }} />
        </div>
      </Drawer>
      {/* Same sibling ordering as ClientProfileDrawer / EncounterSheet can use. */}
      <Drawer open={nested} onClose={() => setNested(false)} title="Segunda ficha">
        <Button onClick={() => setNested(false)}>Voltar à primeira</Button>
      </Drawer>
    </main>
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
