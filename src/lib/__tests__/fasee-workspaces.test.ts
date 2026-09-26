// ═══════════════════════════════════════════════════════════════
// FASE E — AGENDA COMPACTA · CONVERSAS HONESTAS · CLIENTES→360 (P1.7)
// ═══════════════════════════════════════════════════════════════
// Contratos da fase (padrão do repositório: leitura de fonte para UI):
//   Agenda    — grade com scroll INTERNO (a página não cresce com a grade),
//               mobile começa em Lista, avatar com iniciais.
//   Conversas — filtros Não lidas/Aguardando/Falhas (espera da EQUIPE ≠
//               status open), mensagem que falhou tem "Tentar novamente",
//               canal desconectado mantém histórico + compositor desligado.
//   Clientes  — clique principal ABRE O 360 (rota), prévia é secundária, e o
//               "Voltar para clientes" devolve busca/filtro/página intactos.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('Agenda — workspace compacto com scroll interno', () => {
  const page = read('src/app/(dashboard)/agenda/page.tsx');

  it('a grade rola POR DENTRO (cap de altura da viewport), não na página', () => {
    expect(page).toMatch(/overflow-auto ws-scroll/);
    expect(page).toMatch(/railMaxH \? \{ maxHeight: railMaxH \} : undefined/);
  });

  it('mobile começa em Lista (grade de colunas não cabe em 390px)', () => {
    expect(page).toMatch(/window\.matchMedia\('\(max-width: 767px\)'\)\.matches\) setDefaultView\('list'\)/);
  });

  it('profissional tem foto com QUEDA para iniciais (Avatar)', () => {
    expect(page).toMatch(/<Avatar name=\{c\.label\} src=\{c\.photo\} size=\{22\} \/>/);
  });
});

describe('Conversas — filtros e falhas que dizem a verdade', () => {
  const view = read('src/components/dashboard/ConversationsView.tsx');
  const api = read('src/app/api/conversations/route.ts');

  it('filtros: Todas · Não lidas · Aguardando · Falhas', () => {
    expect(view).toMatch(/f === 'waiting' \? 'Aguardando' : 'Falhas'/);
    expect(view).toMatch(/f === 'unread' \? 'Não lidas'/);
  });

  it('Aguardando = espera da EQUIPE (modo humano ou pedindo equipe), não status open', () => {
    expect(view).toMatch(/filter === 'waiting' && !\(c\.mode === 'human' \|\| c\.agentState === 'waiting_team'\)/);
  });

  it('Falhas usa a contagem do SERVIDOR (failedMessages por conversa)', () => {
    expect(view).toMatch(/filter === 'failed' && \(c\.failedMessages \|\| 0\) <= 0/);
    expect(api).toMatch(/failedMessages: db\.messages\.filter\(\(m\) => m\.conversationId === c\.id && m\.status === 'failed' && m\.direction === 'out'\)\.length/);
  });

  it('mensagem que falhou tem "Tentar novamente" pelo MESMO caminho de envio', () => {
    expect(view).toMatch(/Tentar novamente/);
    expect(view).toMatch(/async function retryMessage/);
  });

  it('canal desconectado mantém histórico e desliga o compositor', () => {
    expect(view).toMatch(/channelOff\(active\.conversation\)/);
    expect(view).toMatch(/disabled=\{sending \|\| !draft\.trim\(\) \|\| channelOff\(active\.conversation\)\}/);
  });

  it('deep-link ?c= da busca global abre a conversa direto', () => {
    expect(view).toMatch(/params\.get\('c'\)/);
    expect(view).toMatch(/void openConversation\(deepLinkId\)/);
  });
});

describe('Clientes → Perfil 360 (P1.7)', () => {
  const list = read('src/app/(dashboard)/clientes/page.tsx');
  const profile = read('src/app/(dashboard)/clientes/[id]/page.tsx');

  it('clique principal ABRE O 360 (rota própria), não a gaveta', () => {
    expect(list).toMatch(/onClick=\{\(\) => openFullProfile\(p\.key\)\}/);
    expect(list).toMatch(/router\.push\(`\/clientes\/\$\{encodeURIComponent\(key\)\}\?\$\{listStateQuery\(\)\}`\)/);
  });

  it('prévia (gaveta) é AÇÃO SECUNDÁRIA', () => {
    expect(list).toMatch(/Prévia/);
    expect(list).toMatch(/onClick=\{\(\) => setOpenKey\(p\.key\)\}/);
  });

  it('o estado da lista (busca/filtro/página) viaja na URL para a ficha', () => {
    expect(list).toMatch(/qs\.set\('q', search\.trim\(\)\)/);
    expect(list).toMatch(/qs\.set\('filter', filter\)/);
    expect(list).toMatch(/qs\.set\('page', String\(page\)\)/);
  });

  it('"Voltar para clientes" devolve busca/filtro/página/aba intactos', () => {
    expect(profile).toMatch(/for \(const key of \['q', 'filter', 'page', 'tab'\]\)/);
    expect(profile).toMatch(/Voltar para clientes/);
  });

  it('a lista RELÊ o estado da URL ao voltar (nada de página 1 fantasma)', () => {
    expect(list).toMatch(/params\.get\('page'\) \|\| '1'/);
    expect(list).toMatch(/params\.get\('filter'\) \|\| ''/);
  });
});
