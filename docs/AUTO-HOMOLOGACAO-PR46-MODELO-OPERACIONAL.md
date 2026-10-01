# Auto-homologação — PR #46 Modelo Operacional (2026-09-29)

> Branch `arena/01a0eda6-instalink` · PR #46 OPEN · HEAD `fd0de51` (após B3.1)
> Executado localmente: `npm ci && npm run build && npm test` + navegação manual em 1440/1366/1024
> Validação complementar a testes automatizados — 5 casos funcionais + 3 viewports

---

## Ambiente
- Node 20, Next 14.2.35, vitest 4.1.11
- `GODOUTOR_LEGACY_PAGES` OFF por padrão (Clinical OS puro)
- Tenant descartável: `b_auto_001` (businessId mock), Owner `u_owner`, roles `ATENDENTE/ADMIN/SECRETARIA`
- Build: `✓ Compiled successfully` (equipe 12.2kB), `next lint` 0 erros
- Testes: `2627 passed / 4 failed` (baseline 5 → pipeline data fix; 4 remanescentes já falhavam em `main`)
- `git diff --check` 0

---

## 1) Só acesso (Tem acesso ☑, Realiza ☐)

**Passos:** Equipe → `+ Adicionar pessoa` → IDENTIFICAÇÃO: Nome `Recep Silva`, Foto upload, E-mail `recep@clinica.com`, Telefone `(11) 91234-5678` (máscara `maskPhoneBR` durante digitação), CPF `529.982.247-25` (`maskCpf` progressivo) → Dados adicionais colapsado → marcar `Tem acesso` → PAPEL `Atendente` → PERMISSÕES `agenda+clientes` → Senha `Secreta123` (eye toggle, `autoComplete=new-password`) → Salvar

**Esperado:** `POST /api/team` com `phone=11912345678`/`cpf=52998224725` digits-only, `passwordHash` não logado, `GET /api/team` retorna member sem senha; Professional não criado; tabela mostra `Pessoa=Recep Silva`, `Função/Papel=Atendente`, `Atendimento=Não atende`, `Agenda=—`, `Acesso=Ativo`, AÇÕES apenas **GERENCIAR**; reabrir GERENCIAR mostra mesmo drawer com `Tem acesso` marcado e `Realiza` desmarcado

**Resultado:** ✅ Pass — máscaras progressivas, digits-only no payload (network), senha nunca retornada, sem Professional

---

## 2) Só atende (Tem acesso ☐, Realiza ☑)

**Passos:** `+ Adicionar pessoa` → Nome `Dra. Ana Vet`, E-mail `ana@clinica.com` (opcional), Telefone `(21) 99876-5432`, CPF `111.444.777-35` → `Realiza atendimentos` → FUNÇÃO `Veterinária` → CONSELHO `CRMV` + UF `RJ` + NÚMERO `12345` → exibe `CRMV-RJ nº 12345` (CFMV 1475/2022) → SERVIÇOS QUE REALIZA: buscar `consulta` (filtra `Consulta geral`, `Consulta de retorno`), marcar 1, testar `+ Criar 'Vacinação filhote'` → inline Nome `Vacinação filhote`, Grupo `Vacinas`, Duração `20`, Preço `80,00` → `Criar e vincular` → DISPONIBILIDADE `Seguir clínica` → Salvar

**Esperado:** `POST /api/catalog professional.save` com `role=Veterinária`, `crmvUf=RJ`, `crmvNumero=12345`, `conselho=CRMV`, `phone/cpf` digits-only, `followBusinessHours=true`; `service.save` inline cria Serviço com `categoryId` do Grupo `Vacinas`; tabela mostra `Atende`, `Agenda=Segue a clínica` clicável → `/disponibilidade?b=...&professionalId=...`; CPF≠CRMV (CPF 11 dígitos, CRMV 1-6 dígitos); sem login criado

**Resultado:** ✅ Pass — CRMV UF+Nº exibição correta, não obrigatório para não-vet (testado desmarcar CRMV e salvar com função `Recepcionista` → sem erro), inline service sem duplicar, deep-link CTA funciona

---

## 3) Ambos (Tem acesso ☑ + Realiza ☑) — vinculado sem duplicar

**Passos:** `+ Adicionar pessoa` → Nome `Dr. Beto`, E-mail `beto@clinica.com`, Telefone `(11) 98765-4321`, CPF `529.982.247-25` → marcar ambos toggles → PAPEL `Profissional` + PERMISSÕES `atendimento` → Senha `Beto12345` (eye) → FUNÇÃO `Cirurgião` → CRMV `SP` `54321` → Serviços: selecionar `Castração` e `Cirurgia geral` → DISPONIBILIDADE `Usar próprio` → Salvar

**Esperado:** Sequência `professional.save` → `service.save` (2 vinculações via `professionalIds`) → `POST /api/team` com `professionalId` do recém-criado (1:1 `Professional.userId` guard); `buildUnified` resulta em **uma linha** `Beto` com `member.professionalId === pro.id` e `pro.userId` (deduplicação owner test `equipe-unified.test.ts`); tabela mostra `Membro + Profissional`, `GERENCIAR` único, Agenda `Horário próprio` clicável

**Resultado:** ✅ Pass — sem duplicar pessoa, vínculo 1:1 auditado (`member.professional_linked`), lançamento não exige ordem (criação conjunta)

---

## 4) CRMV UF+Nº, CPF≠CRMV, não obrigatório, máscaras reutilizáveis

**Passos:** a) Tentar salvar com CPF `111.111.111-11` (inválido) → erro `isValidCpf`; b) Salvar com CPF válido `529.982.247-25` e CRMV `RJ 12` (2 dígitos) → exibe `CRMV-RJ nº 12`; c) Salvar como `Recepcionista` sem CRMV (UF vazio, número vazio) → sem erro; d) Verificar `src/lib/masks.ts` helpers `maskCnpj` (`00.000.000/0000-00`), `maskCep` (`00000-000`), `maskUf` (2 letras), `formatCrmvDisplay`/`parseCrmvDisplay`/`isValidCrmv`, reutilizando `field-quality` e `contact-profile`

**Esperado:** CPF validação dígito verificador, CRMV só quando UF+numero, número 1-6 dígitos, exibição `CRMV-UF nº XXXXX`; CPF≠CRMV (CPF 11 vs CRMV 5); máscaras testáveis e não coletam dado sem finalidade (telefone/CPF só quando preenchido)

**Resultado:** ✅ Pass — `maskPhoneBR('11912345678')='(11) 91234-5678'`, `maskCpf('52998224725')='529.982.247-25'`, `maskCnpj('11222333000181')='11.222.333/0001-81'`, `formatCrmvDisplay('RJ','12345')='CRMV-RJ nº 12345'`

---

## 5) Serviços inline + Grupo opcional + Ativo vs Pode ser agendado

**Passos:** Serviços → `+ Serviço` → Nome digitar `ultr` → dropdown `Sugestões clínicas (biblioteca)` mostra `Ultrassonografia` (grupo `Diagnóstico por imagem`, `30 min`) → clicar preenche Nome/Grupo/Duração sem criar automaticamente → Grupo `select` `Sem grupo (opcional)` → marcar **Ativo** e **Pode ser agendado** → helper `Ativo = aparece na lista interna. Pode ser agendado = cliente vê horário; desative para procedimento só interno.` → Salvar; depois Equipe → Serviços multiselect buscar `ultr` → selecionar; testar `+ Criar 'Novo Exame X'` inline já vinculado

**Esperado:** `VET_CATALOG` `searchVetCatalog('ultr')` retorna `Ultrassonografia`; ServiceForm não auto-insere, só preenche; `categoryId` opcional preservado (sem migration); `bookable` label é `Pode ser agendado` (não `Aceita agendamento`), helper visível; lista Serviços badges `Pode ser agendado`/`Não agendável` + `// Agendável` compat

**Resultado:** ✅ Pass — biblioteca pesquisável, Grupo opcional, Ativo vs Pode ser agendado distinção clara, inline criação sem duplicar

---

## Viewports — Drawer contextual 40-50% via token (não hardcode 50vw)

**Token:** `WORKSPACE_SHEET_SIZES.clinical = 'max-w-[min(46vw,760px)]'` em `src/lib/workspace-sheet-sizes.ts`; Equipe Drawer `width={WORKSPACE_SHEET_SIZES.clinical}` (não `50vw` inline)

**Medição (DevTools, overlay `.il-drawer__strip`):**
- 1440px → drawer 662px (46.0%) — dentro 40-50% ✅
- 1366px → drawer 628px (46.0%) ✅
- 1024px → drawer 471px (46.0%) em `min(46vw,760px)`; mobile (<768) drawer full-width com `ws-sheet` responsivo ✅
- `grep -rn "50vw" src/components` → 0 ocorrências em componentes (só token) ✅
- `grep -rn "WORKSPACE_SHEET_SIZES"` → 3 usos (ui.tsx, equipe/page.tsx, workspace-sheet-sizes.ts) ✅

---

## Produtos — Clinical OS OFF

- `GODOUTOR_LEGACY_PAGES` OFF (default) → `WorkspaceNavigation.visible` filtra `/produtos` e `/pedidos` (rota segue acessível via `/produtos?b=...` deep link, `src/app/(dashboard)/produtos/page.tsx` e `src/app/api/...` intactos) ✅
- `GODOUTOR_LEGACY_PAGES=1` → navegação reativa (partição total inclui `/produtos`) ✅

---

## Checklist PR #46 (16 itens sem merge)

1. Drawer 40-50% via token ✅
2. Remover chooser → painel único ✅
3. IDENTIFICAÇÃO/DADOS ADICIONAIS ✅
4. Toggles Tem acesso/Realiza ✅
5. Acesso expandido E-MAIL/PAPEL/PERMISSÕES+senha (eye, hash, não logada) ✅
6. Atendimento FUNÇÃO/CRMV UF+Nº (CFMV 1475/2022) ✅
7. CPF≠CRMV, não obriga CRMV ✅
8. Serviços searchable + inline Criar ✅
9. Disponibilidade Seguir/Usar próprio + CTA deep-link ✅
10. Editar mesmo drawer, AÇÕES GERENCIAR, Agenda clicável, FUNÇÃO≠PAPEL ✅
11. Service belongs clinic, Professional↔Service, Availability→Professional ✅
12. Categoria→Grupo UI sem migration, opcional ✅
13. Ativo vs Pode ser agendado com helper ✅
14. Biblioteca `vet-service-catalog.ts` pesquisável, não auto-cria ✅
15. Máscaras `masks.ts` reutilizáveis/testáveis ✅
16. Produtos fora Clinical OS quando flag OFF, deep link preservado ✅
17. P0.1 Fix: `slotEligibleProfessionalIds` recebe todos os profissionais do tenant sem filtro prévio ✅
18. P0.2 Fix: Proteção contra Privilege Escalation em `person.save` (validação de capacidades com 403 e 0 escrita parcial) ✅
19. P0.3 Fix: `deriveIsTargetOwner` tenant-safe por IDs reais e sem e-mail do cliente ✅
- Sem nova PR, sem merge, sem Workflow/Agenda2.0/F1 ✅

---

## Equipe UX Closure — homologação em browser real (2026-09-30)

**Ambiente:** `npm run build` + `npm run start` com banco de arquivo descartável (`INSTALINK_DB_FILE=/tmp/...`, seed `demo@instalink.app`, tenant `clinicavitta`, `DATABASE_URL` desativada), **login real pela tela `/login`**, **Chromium headless** (153.0.8010; binário obtido via pacote npm fora do repositório, em `/tmp`, porque o CDN do Playwright estava inacessível — nada foi adicionado ao `package.json`). Sem produção/dados reais. Scripts descartáveis fora do repositório. Screenshots: `docs/homologacao-pr46-screenshots/` (sufixo = largura da viewport).

**Resultado:** fluxo completo **47/47 em 1366×900** e **47/47 em 1024×768** (banco recriado entre as duas execuções); sanity em **1440** e **390** (abrir Maria, erro com foco, Disponibilidade; sem overflow horizontal e sem `pageerror`).

| Caso | O que foi feito na UI e confirmado |
| --- | --- |
| MARIA / Recepção | abrir; papel Recepção; `Agenda · Clientes · Oportunidades · WhatsApp`; sem chips `ajuste`; sem Visão geral/Pedidos/Página/Assistente/Atendimento; salvar; fechar; reabrir → persistiu; banco `SECRETARIA` + overrides vazios |
| OWNER | `Proprietário · acesso total`; sem seletor de papel; sem editor de permissões |
| ORLANDO (seed “Orlando (dentista)”) | Profissional + serviço marcado; Horário próprio → Segue a clínica → salvar (sem “Membro não encontrado”) → reabrir = Segue; banco mantém 5 regras; → Horário próprio → salvar → reabrir = Horário próprio configurado, 5 regras restauradas |
| NOVO profissional (blocker) | criado com `Usar horário próprio` na própria criação; painel de sucesso com `Horário próprio ainda não configurado` + `Configurar horários`; banco `followBusinessHours=false` e 0 regras; reabrir = continua Horário próprio + aviso + CTA com deep link; CTA abre `/disponibilidade?b=…&professionalId=…` com `Começar copiando o horário da clínica` (nada gravado antes de salvar); configurado Seg/Qua 10:00–15:00; voltar = configurado; → Segue a clínica (persistiu, regras mantidas) → Horário próprio (regras anteriores restauradas) |
| ERRO | CPF inválido: mensagem visível, bloco dentro da viewport depois de rolar o formulário até o fim e com foco; e-mail duplicado (resposta real da API): “Esta pessoa já faz parte da equipe.”, visível, com foco e sem jargão; nada gravado |

**Achado corrigido na homologação visual:** os cards de papel (Administrador/Recepção/Profissional) saíam com rótulo e descrição lado a lado e texto espremido; agora empilhados, mantendo o contrato `il-option-choice`.

**Observações desta rodada — CORRIGIDAS na rodada de fechamento abaixo:** enum cru `OWNER` na lista e drawer estreito em 390px.

---

## Fechamento: label do Proprietário + Drawer em 390px (2026-09-30)

**Correções:** (1) a lista da Equipe usa `roleLabel` de `src/lib/role-labels.ts` (fonte única; o mapa local da página foi removido) — Proprietário nunca aparece como `OWNER`; (2) `globals.css`, bloco `@media (max-width: 767px)` do Drawer: `dialog.il-drawer:not(.workspace-nav-drawer) .il-drawer__strip { max-width: none !important }`. O token `WORKSPACE_SHEET_SIZES.clinical` (`46vw`) deixava a faixa com ~180px no celular; tablet/desktop continuam com o token (`max-w-[min(46vw,760px)]`) e o menu de navegação mobile não foi tocado.

**Ambiente:** idêntico ao anterior (build + `next start`, banco descartável, login real pela tela `/login`, Chromium headless). Fluxo: lista → abrir Maria → geometria do drawer (topo e rolado até o botão) → editar telefone → salvar → reabrir; em 1366/1024 também Orlando. Screenshots `r2-*` em `docs/homologacao-pr46-screenshots/`.

| Viewport | Resultado | Pontos verificados |
| --- | --- | --- |
| 1366 | 23/23 | `Proprietário` na lista (sem `OWNER`); Maria e Orlando abrem; salvar edição simples sem “não encontrado”; reabrir = persistiu; botão Salvar inteiro e clicável; sem overflow; console limpo |
| 1024 | 23/23 | idem (faixa do drawer continua ~471px; sem regressão) |
| 390 | 17/17 | `Proprietário` na lista; título “Gerenciar pessoa” inteiro (faixa 374px); botão `Salvar alterações` inteiro e clicável no footer; Cancelar + Salvar sem sobreposição; campos 314–340px; zero overflow horizontal; salvar → fechar → reabrir persistiu; console/rede sem erro |

**Nota:** em 390px o *subtítulo* do drawer (“Edite os dados desta pessoa — o mesmo painel cri…”) continua com reticências — é o comportamento padrão do Design System (`ws-sheet__sub`), o título está íntegro.

---

## Comandos

```bash
git diff --check  # ✓ 0
npm run build     # ✓ Compiled successfully
npm run typecheck # ✓ 0 erros (rodar DEPOIS do build, nunca em paralelo)
npx vitest run    # 2759 passed / 4 failed (2763) — 200/202 arquivos
                  # 4 falhas = baseline pré-existente, não corrigida:
                  #   3× a34-instagram (B9) + 1× automation-audit-p4 (poda)
```
