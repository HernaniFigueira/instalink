// ═══════════════════════════════════════════════════════════════
// DS 1.1 · §11 (prontuário é LEITURA) e §12 (alerta proporcional)
// ═══════════════════════════════════════════════════════════════
// Dois lados, como no resto do DS:
//   • RENDER — o primitivo tem o comportamento que promete (vazio declarado,
//     parágrafos preservados, divulgação real com aria-expanded/controls);
//   • FONTE  — as superfícies migradas USAM o primitivo e não voltaram a
//     inventar cor de página (o `amber-*`/`zinc-*` cru do Tailwind).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClinicalRecordSection, ReadOnlyField, Disclosure } from '../../components/ui';

const SRC = path.resolve(__dirname, '../../');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const UI = read('components/ui.tsx');
const DS_CSS = read('styles/godoutor-design-system.css');

describe('§11 · ReadOnlyField é LEITURA, não campo desabilitado', () => {
  it('ClinicalRecordSection é um bloco de documento com título e malha', () => {
    const html = renderToStaticMarkup(createElement(ClinicalRecordSection, { title: 'Registro do atendimento', children: undefined },
      createElement(ReadOnlyField, { label: 'Evolução clínica', value: 'Feito.' })));
    expect(html).toContain('gd-ro-section');
    expect(html).toContain('gd-ro-grid');
    expect(html).toContain('Registro do atendimento');
    expect(html).not.toContain('<input');
  });

  it('valor vazio é declarado ("Não informado"), nunca um branco ambíguo', () => {
    const html = renderToStaticMarkup(createElement(ReadOnlyField, { label: 'Evolução clínica', value: '   ' }));
    expect(html).toContain('Não informado');
    expect(html).toContain('gd-ro__empty');
  });

  it('preserva os parágrafos que o profissional escreveu (pre-wrap, sem textarea)', () => {
    const html = renderToStaticMarkup(createElement(ReadOnlyField, {
      label: 'Evolução clínica', value: 'Primeira linha.\n\nSegunda linha.', multiline: true,
    }));
    expect(html).toContain('gd-ro__value');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('disabled');
  });

  it('não vira controle: nenhum input/select/textarea sai daqui', () => {
    const html = renderToStaticMarkup(createElement(ReadOnlyField, { label: 'Queixa principal', value: 'Dor ao mastigar' }));
    for (const tag of ['<input', '<select', '<textarea']) expect(html).not.toContain(tag);
  });
});

describe('§11/§14 · Disclosure é divulgação REAL', () => {
  it('nasce fechado, com aria-expanded/aria-controls ligados ao painel', () => {
    const html = renderToStaticMarkup(createElement(Disclosure, { label: 'Nota interna', children: createElement('p', null, 'SENSÍVEL') }));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls=');
    // Fechado não despeja o conteúdo secundário na primeira leitura.
    expect(html).not.toContain('SENSÍVEL');
  });

  it('aberto entrega o painel numa região rotulada', () => {
    const html = renderToStaticMarkup(createElement(Disclosure, { label: 'Nota interna', defaultOpen: true, children: createElement('p', null, 'SENSÍVEL') }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="region"');
    expect(html).toContain('arialabel'.replace('arialabel', 'aria-label="Nota interna"'));
    expect(html).toContain('SENSÍVEL');
  });

  it('keepMounted mantém o conteúdo no DOM apenas quando explicitamente pedido', () => {
    const html = renderToStaticMarkup(createElement(Disclosure, { label: 'Histórico', keepMounted: true, children: createElement('p', null, 'ANTIGO') }));
    expect(html).toContain('ANTIGO');
    expect(html).toContain('hidden');
  });
});

describe('§11 · EncounterSheet: registro finalizado não é formulário cinza', () => {
  const sheet = read('components/dashboard/EncounterSheet.tsx');

  it('os três textos clínicos usam ReadOnlyField quando não há edição', () => {
    // Cada campo aparece DUAS vezes: no ramo editável e no ramo de leitura.
    const porLabel = (label: string) => sheet.split(`ENCOUNTER_LABELS.${label}`).length - 1;
    expect(porLabel('complaint')).toBeGreaterThanOrEqual(2);
    expect(porLabel('evolution')).toBeGreaterThanOrEqual(2);
    expect(porLabel('guidance')).toBeGreaterThanOrEqual(2);
    expect(sheet).toMatch(/<ReadOnlyField label=\{ENCOUNTER_LABELS\.evolution\}[^>]*multiline/);
  });

  it('a nota interna vira nota SECUNDÁRIA (Disclosure) na leitura', () => {
    expect(sheet).toContain('<Disclosure');
    // O rótulo do disclosure é o canônico da nota interna e a ajuda contextual
    // só aparece quando existe nota para ler.
    expect(sheet).toMatch(/label=\{ENCOUNTER_LABELS\.internalNote\}[\s\S]{0,160}?hint=/);
  });

  it('nenhuma regra clínica foi tocada: autoria, reabertura e autoridade continuam', () => {
    expect(sheet).toContain('canEditEncounter');
    expect(sheet).toContain('não entra na via do cliente');
    expect(sheet).toContain('reabertura fica registrada na auditoria');
    expect(sheet).toContain('encounterSignature(row)');
  });
});

describe('§12 · alertas proporcionais ao impacto', () => {
  it('aviso de permissão usa o Notice canônico, sem cor de página', () => {
    const acesso = read('components/dashboard/AccessNotice.tsx');
    expect(acesso).not.toMatch(/\bamber-\d{2,3}\b/);
    expect(acesso).not.toMatch(/\bzinc-\d{2,3}\b/);
    expect(acesso).toMatch(/<Notice tone="warning" icon="lock"/);
  });

  it('403 global usa a pilha de toast canônica (não um card artesanal)', () => {
    const acesso = read('components/dashboard/AccessNotice.tsx');
    expect(acesso).toContain('ToastViewport');
    expect(acesso).toContain('useToasts');
    expect(acesso).toContain('Você continua conectado.');
  });

  it('a confirmação da Agenda entra como Notice no fluxo (com dispensa)', () => {
    const agenda = read('app/(dashboard)/agenda/page.tsx');
    expect(agenda).toMatch(/<Notice\s/);
    expect(agenda).toMatch(/onDismiss=\{\(\) => setFlash\(null\)\}/);
    expect(agenda).not.toContain("'mb-3 border rounded-lg px-3 py-2.5 text-xs font-semibold");
  });

  it('o aviso de espera do balcão continua compacto e tokenizado', () => {
    const ui = read('components/ui.tsx');
    const strip = ui.slice(ui.indexOf('export function AttentionStrip'), ui.indexOf('export function EmptyState'));
    expect(strip).toContain('var(--warning-bg)');
    expect(strip).not.toMatch(/\bamber-\d{2,3}\b/);
  });
});

// ═══════════════════════════════════════════════════════════════
// §3/§4 — TIPOGRAFIA e CAMPO CANÔNICO: o que a homologação mediu
// ═══════════════════════════════════════════════════════════════
// Estes dois contratos nasceram de DEFEITOS reais achados na QA de browser:
//   • `body { font-family: var(--font-geist-sans) }` — a variável morreu quando
//     a Barlow entrou; com o `var()` inválido, o navegador caía no default
//     (Times New Roman) em tudo que não estivesse dentro do `.gd-app`;
//   • `Field` tratava `<Input>` (nosso primitive) como "controle desconhecido",
//     então o rótulo já nascia FORA da caixa — o campo vazio não tinha rótulo
//     dentro, que é justamente o comportamento exigido do outlined.
describe('§3 · uma fonte, um token (Geist não pode voltar como fonte do corpo)', () => {
  const css = read('app/globals.css');
  const layout = read('app/layout.tsx');
  const ds = read('styles/godoutor-design-system.css');

  it('o corpo usa o token canônico e NÃO aponta para variável inexistente', () => {
    expect(css).toMatch(/body\s*\{[^}]*font-family: var\(--gd-font-sans\)/);
    // `--font-geist-sans` deixou de existir com a Barlow: um `var()` pendurado
    // invalida a declaração e o navegador cai na fonte default da plataforma.
    expect(css).not.toMatch(/font-family: var\(--font-geist-sans\)/);
    expect(ds).toMatch(/--gd-font-sans: var\(--font-barlow\)/);
  });

  it('a Barlow é servida pelo build (self-host), sem requisição ao Google', () => {
    expect(layout).toContain("from 'next/font/local'");
    expect(layout).not.toContain("from 'next/font/google'");
    // Os arquivos são versionados no repositório: o build não depende de rede.
    for (const peso of ['400', '500', '600', '700']) {
      expect(fs.existsSync(path.join(SRC, `app/fonts/barlow/barlow-latin-${peso}-normal.woff2`))).toBe(true);
    }
    expect(fs.existsSync(path.join(SRC, 'app/fonts/barlow/OFL.txt'))).toBe(true);
  });
});

describe('§4 · o rótulo do campo mora DENTRO da caixa quando o campo está vazio', () => {
  it('o shell reconhece os PRIMITIVES do produto, não só o elemento nativo', () => {
    const ui = read('components/ui.tsx');
    const campo = ui.slice(ui.indexOf('export function Field'), ui.indexOf('export function ReadOnlyField'));
    // A classificação precisa citar Input/Textarea/Select (senão `<Input>` cai
    // em "outro" e o rótulo flutua desde o repouso).
    expect(campo).toMatch(/child\?\.type === Input/);
    expect(campo).toMatch(/child\?\.type === Textarea/);
    expect(campo).toMatch(/child\?\.type === Select/);
    // A sonda de vazio (`placeholder=" "`) só existe para campo de TEXTO.
    expect(campo).toMatch(/const isTextKind = kind === 'input' \|\| kind === 'textarea'/);
    expect(campo).toMatch(/kindsQueFlutuamSempre|alwaysFloat/);
  });

  it('select e campos desenhados pelo navegador flutuam sempre (não existe vazio)', () => {
    const ui = read('components/ui.tsx');
    const campo = ui.slice(ui.indexOf('export function Field'), ui.indexOf('export function ReadOnlyField'));
    expect(campo).toMatch(/const alwaysFloat = kind === 'select' \|\| selfDrawn \|\| kind === 'other'/);
    expect(campo).toMatch(/\['date', 'time', 'datetime-local', 'month', 'week', 'color', 'file'\]/);
  });

  it('o CSS tem os três estados do Material Outlined', () => {
    const ds = read('styles/godoutor-design-system.css');
    // rótulo dentro por padrão
    expect(ds).toMatch(/\.gd-field__label \{[^}]*top: 50%/);
    // foco OU valor OU sempre-flutuante → sobe e notcha
    expect(ds).toMatch(/\.gd-field__box:focus-within \.gd-field__label,/);
    expect(ds).toMatch(/:has\(input:not\(:placeholder-shown\)\)/);
    expect(ds).toMatch(/\.gd-field--float \.gd-field__label/);
    // placeholder só aparece com o rótulo já fora do caminho
    expect(ds).toMatch(/\.gd-field__box > input::placeholder,[\s\S]{0,120}color: transparent/);
    expect(ds).toMatch(/\.gd-field__box:focus-within > input::placeholder,[\s\S]{0,120}color: var\(--gd-text-faint\)/);
  });

  it('a ajuda continua no DOM quando há erro (aria-describedby não fica pendurado)', () => {
    const ui = read('components/ui.tsx');
    expect(ui).toMatch(/gd-field__hint--off/);
    const ds = read('styles/godoutor-design-system.css');
    expect(ds).toMatch(/\.gd-field__hint--off \{[\s\S]{0,200}clip-path: inset\(50%\)/);
  });
});

// ═══════════════════════════════════════════════════════════════
// §11 · PRONTUÁRIO EM LEITURA É DOCUMENTO (superfície VIVA do workspace)
// ═══════════════════════════════════════════════════════════════
// O contrato é de código-fonte porque o defeito era exatamente de ESTRUTURA:
// as seções do workspace canônico (/atendimento/<id>) renderizavam `disabled`
// em vez de leitura. Quem abre o atendimento pela Agenda cai AQUI — não na rota
// legada /registro. Estes testes travam o padrão nas seis seções.
describe('DS 1.1 · §11 — leitura do prontuário é documento, não formulário desabilitado', () => {
  const secoes = [
    'EncounterCoreSection',
    'EncounterVisitAnamnesisSection',
    'EncounterVeterinaryAssessmentSection',
    'EncounterClinicalProblemsSection',
    'EncounterCarePlanSection',
    'EncounterClinicalProceduresSection',
  ];

  it('cada seção do workspace tem ramo de leitura: bloco do DS, sem controle de formulário', () => {
    for (const nome of secoes) {
      const src = read(`components/dashboard/${nome}.tsx`);
      const idx = src.indexOf('data-readonly');
      expect(idx, `${nome}: marcador de leitura`).toBeGreaterThan(-1);
      // O ramo de leitura vai do marcador até o `return` do ramo editável: é
      // esse TRECHO que não pode conter campo de formulário nem `disabled`.
      const fim = src.indexOf('\n  return (', idx);
      const bloco = src.slice(src.lastIndexOf('if (', idx), fim > idx ? fim : src.length);
      expect(bloco, `${nome}: bloco de leitura`).toContain('ClinicalRecordSection');
      expect(bloco, `${nome}: valores em leitura`).toContain('ReadOnlyField');
      expect(bloco, `${nome}: nenhum campo desabilitado`).not.toMatch(/disabled=\{disabled\}/);
      expect(bloco, `${nome}: nenhum controle de formulário`).not.toMatch(/<Input|<Select|<Textarea/);
    }
  });

  it('o registro em leitura mostra os mesmos campos (texto), o resumo do plano e o motivo uma vez', () => {
    const core = read('components/dashboard/EncounterCoreSection.tsx');
    // Os campos do núcleo entram como ReadOnlyField (valor em texto).
    expect(core).toMatch(/<ReadOnlyField[\s\S]{0,220}?value=\{valor\(f\.capability\)\}/);
    // Nota interna continua secundária: sob divulgação, nunca como input.
    expect(core).toMatch(/<Disclosure label=\{notaInterna\.label\}/);
    // O motivo da leitura vem do workspace (finalizado/permissão), com fallback.
    expect(core).toContain('readOnlyHint');
    const body = read('components/dashboard/EncounterWorkspaceBody.tsx');
    expect(body).toMatch(/readOnlyHint=\{readOnlyHint\}/);
  });

  it('o primitivo do documento existe no DS com a malha de leitura', () => {
    expect(UI).toMatch(/export function ClinicalRecordSection/);
    expect(DS_CSS).toMatch(/\.gd-ro-section__title/);
    expect(DS_CSS).toMatch(/\.gd-ro-grid \{/);
    // Marca do documento: valor vazio é FRACO, nunca um vazio que pareça falha.
    expect(DS_CSS).toMatch(/\.gd-ro__empty/);
  });
});
