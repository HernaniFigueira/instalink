// ═══════════════════════════════════════════════════════════════
// A1.2 · BLOCO 3 — REGRESSÃO DOS DEFEITOS FUNCIONAIS CORRIGIDOS
// ═══════════════════════════════════════════════════════════════
// Estes testes impedem que os defeitos corrigidos no Bloco 3 voltem:
//   B3.1 composer de /conversas ligado à API existente (envio honesto);
//   B3.2 businessId nunca mais usado como destinatário/nome na mensagem;
//   B3.3 sem <select> falso de distribuição (controle que não salvava nada);
//   B3.4 navegação interna via Link/router (sem recarregar a aplicação);
//   B3.5 403 do Dashboard sem caminho hardcoded (usa o catálogo);
//   B3.7 coerência UI × permissionamento × tenant nos fluxos tocados.
//
// Padrão do repositório (panel.test.ts): para código de UI, o teste lê o
// código-fonte — é o mesmo contrato que mantém o shell honesto.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('B3.1 — composer de /conversas executa o envio de verdade', () => {
  const page = read('src/app/(dashboard)/conversas/page.tsx');

  it('usa a API EXISTENTE (POST /api/conversations) com o contrato do inbox', () => {
    expect(page).toMatch(/apiSend<\{ message\?: Message \}>\(\s*'\/api\/conversations', 'POST',/);
    // Tenant scoping: o businessId da unidade ativa vai no corpo…
    expect(page).toMatch(/\{ businessId, conversationId: active\.conversation\.id, body: text \}/);
    // …e o destinatário é a CONVERSA aberta (nunca o businessId).
    expect(page).toMatch(/conversationId: active\.conversation\.id/);
  });

  it('o botão Enviar nunca é decorativo: estado de envio + desabilitado sem texto', () => {
    expect(page).toMatch(/const \[sending, setSending\] = useState\(false\)/);
    expect(page).toMatch(/disabled=\{sending \|\| !draft\.trim\(\)\}/);
    expect(page).toMatch(/\{sending \? 'Enviando…' : 'Enviar'\}/);
  });

  it('erro é apresentado de forma honesta (e o texto digitado não se perde)', () => {
    expect(page).toMatch(/setSendError\(res\.message \|\| 'Não foi possível enviar a mensagem\.'\)/);
    expect(page).toMatch(/role="alert"/);
    // O rascunho só é limpo no SUCESSO (depois da resposta do servidor).
    const successIdx = page.indexOf("setActive((prev) => prev ? { conversation: { ...prev.conversation");
    const draftClear = page.indexOf("setDraft('');");
    expect(successIdx).toBeGreaterThan(-1);
    expect(draftClear).toBeGreaterThan(successIdx);
  });

  it('mensagem enviada entra no estado da UI (sem reload, sem inbox nova)', () => {
    expect(page).toMatch(/messages: \[\.\.\.prev\.messages, sent\]/);
    expect(page).not.toMatch(/router\.refresh|window\.location/);
  });
});

describe('B3.2 — businessId nunca é destinatário/nome de contato', () => {
  const esteira = read('src/components/dashboard/EsteiraView.tsx');

  it('a mensagem do Kanban usa o NOME do negócio vindo do servidor', () => {
    expect(esteira).toMatch(/businessName/);
    expect(esteira).toMatch(/Sou da equipe da \$\{businessName \|\| 'empresa'\}/);
    // O defeito original: `pipeline?.businessId` no texto da mensagem.
    expect(esteira).not.toMatch(/pipeline\?\.businessId/);
  });

  it('waLink sempre recebe telefone do lead (destinatário correto)', () => {
    const calls = [...esteira.matchAll(/waLink\(([^,]+),/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(0);
    for (const arg of calls) expect(arg).toMatch(/^lead\.phone$|^selectedLead\.phone$/);
  });

  it('a fonte do nome é a MESMA unidade do contexto (GET /api/leads)', () => {
    const leadsApi = read('src/app/api/leads/route.ts');
    expect(leadsApi).toMatch(/business: biz \? \{ id: biz\.id, name: biz\.name \} : null/);
    // A UI só aceita o nome se for da unidade pedida (defesa em profundidade).
    expect(esteira).toMatch(/res\.data\.business\?\.id === businessId/);
  });
});

describe('B3.3 — sem controle falso de distribuição', () => {
  const cfgPage = read('src/app/(dashboard)/configuracoes/page.tsx');

  it('nenhum <select> aparentando configurar o que não é persistido/consumido', () => {
    expect(cfgPage).not.toMatch(/<select value="balanced"/);
    expect(cfgPage).not.toMatch(/Em breve: outros modos de distribuição/);
  });

  it('a indicação é explicitamente NÃO interativa (e mantém o texto honesto)', () => {
    expect(cfgPage).toMatch(/aria-label="Distribuição dos agendamentos: automática \(fixa\)"/);
    expect(cfgPage).toMatch(/Automática — equilibra a equipe/);
    expect(cfgPage).toMatch(/Quem atende é resolvido automaticamente/);
    // A regra de distribuição em si NÃO mudou (nenhuma engine nova).
    expect(cfgPage).toMatch(/leadMin/);
    expect(cfgPage).toMatch(/horizonDays/);
  });
});

describe('B3.4 — navegação interna sem recarregar a aplicação', () => {
  it('página pública: banner de preview e rodapé usam Link', () => {
    const slug = read('src/app/[slug]/page.tsx');
    expect(slug).toMatch(/import Link from 'next\/link'/);
    expect(slug).not.toMatch(/<a href="\/pagina"/);
    expect(slug).not.toMatch(/<a href="\/"\s/);
    expect(slug).toMatch(/<Link href="\/pagina"/);
  });

  it('conta do consumidor: "Esqueci minha senha" usa Link', () => {
    const customer = read('src/components/public/customer.tsx');
    expect(customer).not.toMatch(/<a href="\/recuperar/);
    expect(customer).toMatch(/<Link href="\/recuperar\?kind=customer"/);
  });

  it('painel: campanhas, equipe e profissionais não têm <a> interno', () => {
    expect(read('src/app/(dashboard)/campanhas/page.tsx')).not.toMatch(/<a href=\{\`/);
    expect(read('src/app/(dashboard)/equipe/page.tsx')).not.toMatch(/<a href=\{\`\/(profissionais|equipe)/);
    expect(read('src/app/(dashboard)/profissionais/page.tsx')).not.toMatch(/<a href=\{\`\/equipe/);
  });

  it('organização: trocar organização e criar unidade navegam via router', () => {
    const org = read('src/app/(dashboard)/organizacao/page.tsx');
    expect(org).not.toMatch(/window\.location\.assign/);
    expect(org).toMatch(/router\.replace\(`\/organizacao\?organization=\$\{e\.target\.value\}`\)/);
    // A unidade nova precisa entrar no contexto do shell: o MESMO canal de
    // revalidação usado em Recursos (il:business-refresh) é disparado antes
    // do router.push — o `?b=` da unidade nova não cai no fallback.
    expect(org).toMatch(/dispatchEvent\(new Event\('il:business-refresh'\)\)/);
    expect(org).toMatch(/router\.push\(`\/dashboard\?b=\$\{res\.data\.businessId\}`\)/);
  });

  it('redirecionamentos de identidade continuam sendo recarga REAL (intencional)', () => {
    // logout e sessão expirada limpam todo o estado do navegador — aí o
    // reload é o comportamento correto e NÃO é o defeito corrigido aqui.
    const shell = read('src/components/DashboardShell.tsx');
    expect(shell).toMatch(/window\.location\.assign\('\/login'\)/); // logout
    expect(read('src/lib/client-auth.ts')).toMatch(/window\.location\.assign\(`\/login\?session=/);
  });
});

describe('B3.5/B3.7 — permissões e contexto nos fluxos tocados', () => {
  it('403 do Dashboard não manda para rota hardcoded (usa o catálogo do shell)', () => {
    const dash = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(dash).not.toMatch(/homeHref="\/agenda"/);
    expect(dash).not.toMatch(/homeHref=\{?["'`]\//);
    // A porta de volta vem do PanelHomeProvider (firstAllowedPath — panel.test.ts cobre).
  });

  it('composer e funil permanecem sob os guards existentes (nenhum atalho por fora)', () => {
    const guards = read('src/lib/panel.ts');
    // /api/conversations exige 'whatsapp' e /api/leads exige 'leads' — a UI
    // não criou caminho paralelo: continua dependendo dos mesmos guards.
    expect(guards).toMatch(/route: '\/api\/conversations'[\s\S]*?permission: 'whatsapp'/);
    expect(guards).toMatch(/route: '\/api\/leads'[\s\S]*?permission: 'leads'/);
  });
});
