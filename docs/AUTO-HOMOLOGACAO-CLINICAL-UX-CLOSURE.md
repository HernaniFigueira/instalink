# Clinical UX Closure — pré-F1

## Base e limites

- 2026-10-03. Base confirmada: PR #52, `fix/active-clinic-context@0c426be570e528569a27dc4f48e6f1afe59f3427` (OPEN).
- A sessão permite somente `arena/01a101fb-instalink`: fast-forward local para a base confirmada, sem criar a branch alternativa solicitada. PR stacked contra `fix/active-clinic-context`; nenhum merge de PR.
- Nenhum QA de produção, banco remoto, migração, exclusão de dados reais, mudança em Encounter ou início de F1.

## Entrega

- Clique vago → Novo agendamento, data/hora/profissional da coluna. Arraste → mesmo sheet com duração selecionada; 09–13 = 240 min. Faixa azul fica até salvar/fechar/cancelar.
- Toolbar entra em modo bloqueio; range abre o drawer diretamente. Salvar faz eco local do bloco; cancelar encerra modo/seleção. Timezone efetivo central via `bookingTimezone`, inclusive clínica sem fuso explícito.
- Snap manual nearest 15, incluindo clique, arraste e consultas administrativas. Empate de 7,5 minutos arredonda para cima: 09:07→09:00; 09:08→09:15; 09:22→09:15; 09:22:30→09:30. Endpoint continua aceitando 5 por compatibilidade **somente autenticada**; o produto envia 15. Precisão UTC/duração congelada/público não alterados.
- Duração excepcional em details fechado; resumo início/fim/duração. Busca do CRM é search, autocomplete off, nome próprio (sem prometer controlar extensões/autofill arbitrários do navegador).
- Serviços: biblioteca visível ao focar, navegação por setas/Enter, texto livre, sugestões editáveis de nome/grupo/duração. Observação interna mantém `description`; informações adicionais e agenda/recursos fechados por padrão. Buffers/resources preservados.
- Profissional: “Atendimentos e procedimentos habilitados”, com explicação. Relação canônica `Service.professionalIds/professionalMode` permanece única.
- Aparência → Configurações, com a mesma preferência local persistida; Meu perfil sem seletor e sem faixa branca do ActionBar.
- Cliente 360: removidos badge/card/acesso/marketing e etiquetas derivadas `acesso`/`marketing`; storage/APIs preservados. Lista e cadastro rápido também deixam de oferecer esses controles.
- Ações secundárias suaves, WhatsApp verde suave, primária sólida. Header de contexto sticky no Cliente 360, abaixo da topbar. Encaixe usa tokens laranja próprios no cartão e nos sheets, sem substituir base do status.

## Ambiente reproduzível

```sh
npm ci
# DATABASE_URL deve estar AUSENTE; seed recusa ambiente remoto e arquivo existente.
env -u DATABASE_URL node scripts/seed-clinical-ux-qa.mjs
env -u DATABASE_URL npm run build
env -u DATABASE_URL GODOUTOR_DB_FILE="$PWD/.cache/clinical-ux/qa.json" npm start
# Outra janela: Chromium instalado pelo Playwright, ou QA_CHROMIUM_MODULE opcional.
node tests/clinical-ux/qa.mjs
```

Seed exclusivamente descartável: Andrioni Veterinária QA; Orlando, Michele, Hernani; consulta 30 min, vacinação 30 min, cirurgia 120 min; expediente 09–18; Ana Tutora QA + Thor QA; confirmado/cancelado/encaixe confirmado em **05/10/2026**. Sem senha real/produção: `owner.qa@godoutor.local`, `recepcao.qa@godoutor.local`, `orlando.qa@godoutor.local`, todos com `GodoutorQA2026!`.

Preview: https://3000-ixv792yxz15e0fjoi4qy2.e2b.app/login

Fixtures/resultados intermediários ficam em `.cache/clinical-ux` ignorada. Não sobrescrever banco existente; para repetir o harness com o mesmo banco, `QA_DATE=2026-10-15` (ou outra data livre dentro do horizonte). O browser cria dados sintéticos adicionais, não limpa histórico.

## Validação real

Next **production**, Chromium 153 headless. CDN padrão do Playwright/apt indisponíveis; binário obtido via pacote npm `@sparticuz/chromium`, com libs empacotadas e sem `--single-process`. Nenhuma dependência de runtime adicionada ao produto.

- Owner, 1440×1000: login, clique, range e persistência visual; gravação real de 240 min com pet (UTC 12:00–16:00); bloqueio 09–13 + F5; serviço e sugestões/advanced; Cliente 360 sem acesso/marketing; cor WhatsApp e sticky medidos em scroll; salvar perfil; alterar aparência + F5; encaixe com base verde e selo laranja.
- Recepção e Profissional, 1024×900: logins reais, agenda e cliente vinculado. Recepção vê três colunas; profissional vê somente Orlando. Guards não ampliados.
- Bloqueio solicitado em 05/10 foi salvo no primeiro QA; última rodada integral usa **14/10**, para não colidir com dados criados pelas rodadas anteriores.
- Rodada integral final: **19 checkpoints**, **0 console errors**, **0 respostas >=400 inesperadas**, **0 5xx**. `tests/clinical-ux/qa.mjs` contém asserções e guarda report. Screenshots e relatório: [clinical-ux-evidence](clinical-ux-evidence/).
- Os ajustes de seletores do harness durante desenvolvimento não foram tratados como homologação concluída; só a rodada integral passou.

## Gates e regressões

- `git diff --check`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- Focados (agenda, booking/temporal, catalog, client/profile, clinical UX, context, permissions): **365 PASS / 28 arquivos**.
- Full suite: **2989 PASS / 4 falhas baseline**, 2993 testes / 216 arquivos. Baseline intocada: 3× `a34-instagram`, 1× `automation-audit-p4`; nenhuma nova falha.
- Novos testes renderizam range 240, persistência/limpeza, block mode, duração recolhida, campo search e ServiceForm preservando description/buffers/resources. Testes de fronteiras nearest 15 e timezone vazio.
- Expectativas anteriores de aparência no perfil, snap 5, marketing/acesso e botões contornados foram atualizadas ao novo contrato. Duas expectativas antigas de fallback pelo primeiro tenant (panel/tenant-isolation) foram alinhadas à PR #52 — não reintroduzido fallback.

Estado: implementado e homologado localmente; revisão da PR pendente. Clinical Encounter F1 **não iniciado**. Merge **não realizado**.
