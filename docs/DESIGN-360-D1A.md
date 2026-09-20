# D1a — base visual e primitivas compartilhadas

**Data:** 2026-09-20 · **Estado:** implementado para revisão; não é homologação integral.
**Branch:** `arena/01a0bfbf-instalink` · **Base:** `ebc7130805057135eae36c71c07313cc0e5710e3`.

Esta entrega executa somente D1a após a aprovação de D0. Os documentos `DESIGN-360-AUDIT.md` e `DESIGN-360-PLAN.md` permanecem byte a byte iguais; os checklists históricos de D0 não foram reescritos. D1b (menu/logo), D2–D4 e revisão S continuam separados. Sem merge ou publicação em produção; PR #31 não foi reutilizada e #32 não foi alterada.

## 1. Alterações e decisões

| Arquivo | Mudança |
| --- | --- |
| `src/app/globals.css` | Camada adicional `.il-platform`: branco quente/cinza suave, grafite, azul moderado, estados semânticos, sombras/gradientes decorativos reduzidos, navegação existente neutralizada, foco visível, alvos móveis e reduced-motion. Geometria específica de `dialog.il-drawer`, sem reset global de dialogs. |
| `src/components/DashboardShell.tsx` | Apenas a classe de escopo no wrapper. Mesmos grupos, itens, ordem, links, gates, unidade, logo e largura. |
| `src/components/ui.tsx` | `Field` associa rótulo/controle/ajuda/erro, inclusive `PhoneBRInput`; `Tabs` implementa uma entrada de Tab, setas/Home/End e ignora desabilitadas; `Drawer` usa modal nativo, foco inicial no título, contenção, retorno, Escape e bloqueio de scroll coordenado entre camadas. |
| `src/components/__tests__/ui.test.tsx` | Oito testes DOM de comportamento/associações, não snapshots de classes. |
| `src/lib/__tests__/design-360-tokens.test.ts` | 32 testes de contraste WCAG calculado a partir das variáveis reais, com resolução de aliases: texto ≥4,5:1 e contornos/foco ≥3:1 nas combinações testadas. |
| `tests/d1a/*` | Harness Vite isolado e sete testes Playwright com componentes/CSS reais, sem backend, rota Next de teste, bypass de autenticação ou fixtures de produção. |
| `package*.json`, `vitest.config.ts`, `.gitignore` | Dependências exclusivamente de desenvolvimento, descoberta de TSX/JSX automático e exclusão dos artefatos locais de navegador. Nenhuma versão resolvida de dependência de produção foi alterada. |

- Tokens centrais: fundo `#f7f7f4`, superfície `#fffefa`, texto `#252a31`, texto secundário `#5c626b`, texto discreto `#626a73`, azul `#2459a6`. Os estados continuam semanticamente distintos; lilás/teal legados não foram remapeados indiscriminadamente.
- `:root`, `.il-page`, temas `--il-*` de clínicas e páginas de autenticação/landing não foram recoloridos. Reduced-motion no elemento raiz só se aplica quando existe `.il-platform`.
- Props anteriores preservadas. As novas associações de painel em `Tabs` são opcionais (`panelId`, `tabId`, `idPrefix`), sem fabricar referências a painéis inexistentes. Os consumidores antigos não foram migrados em massa.
- `Field.required` anuncia obrigatoriedade, mas **não** introduz bloqueio nativo de submissão onde antes havia apenas indicação visual. IDs/ARIA explícitos e descrições do chamador são preservados/combinados.
- O Drawer fica no próprio ancestral DOM, sem portal que perderia o tema. O modal nativo fornece inertness; o teste real mostrou que Tab poderia alcançar a interface do navegador, por isso há wrap explícito nos extremos, além da contenção nativa. Escape consumido por um controle interno é respeitado.
- Não houve mudança em APIs, banco, autorização, integrações, catálogo de navegação, regras da agenda/editor nem publicação. **Salvar continua atualizando o conteúdo publicado**; não foi criado rascunho/autosave. Nenhuma demo/funcionalidade foi removida.

## 2. Validação realmente executada

Ambiente: Node 22.22.3, Next 14.2.35, Chromium 153.0.8010.0. O Chromium alternativo foi obtido de pacote externo ao repositório após falhas de download do CDN. Foi iniciado com sandbox habilitado, **sem** `--no-sandbox`, desativação de TLS ou flags inseguras do pacote.

| Verificação | Resultado e limite |
| --- | --- |
| `npm run typecheck` | Passou, inclusive após o ajuste final de contenção do Drawer. |
| Vitest direcionado | **12 arquivos, 258 testes passaram**: UI 8, contraste 32, visual-convergence 39, workspace 4, panel 73, business-context 8, permissions 9, professional-access 13, tenant-isolation 23, agenda-workspace 9, a34-encounter 30, a34-team 10. |
| Rechecagem DOM final | Somente os **8 testes de UI** foram repetidos após o ajuste do Drawer; passaram. Não foi rodada a suíte inteira a cada ajuste. |
| Playwright/harness | **7/7 passaram**: foco inicial/limites/retorno, fundo realmente inerte, edições preservadas, Escape consumido, camadas sobrepostas/scroll, abas e painéis reais, isolamento de tema, foco/reduced-motion, limites e alvos em 390/1366px. |
| Build de fechamento | **Um build isolado passou**, 111 páginas estáticas. Banco JSON vazio descartável fora do repo, ambiente limpo, sem `DATABASE_URL`/credenciais. Avisos existentes de metadata `themeColor`; não é falha de build. |
| HTTP no app compilado | **20/20 verificações sintéticas passaram**, em outro banco JSON novo e isolado: recepção/agendamento/fila, profissional/registro, isolamento, papéis/unidades, reserva pública/SSR e redirect legado. Os achados S continuaram observáveis — política não foi afrouxada para passar. |
| Browser no app compilado | Login normal; perfil 360 em `/clientes`; aba Atendimentos e `EncounterSheet` sobreposto; Escape em ordem e retorno ao abridor; `MemberAccessSheet` com campo Nome associado; agenda com área principal de 1118px em viewport de 1366px; ausência de `.il-platform` em login/register/recuperar/landing/clínica. Nenhum `pageerror` nessa sessão. Sem criar membro pelo formulário. |
| Impressão | **Não homologada.** PDF vazio no atendimento; reprodução mínima com Drawer e CSS extraídos do commit-base também gerou PDF vazio. Detalhes abaixo. |
| Revisão de diff | `git diff --check` passou; produção restrita aos três arquivos de UI acima. Hashes D0 preservados. |

### Evidência visual real

Screenshots produzidos por Chromium, sem geração por IA, com nomes/dados sintéticos:

- [Dashboard, 1366px](evidence/d1a/dashboard-1366.png) — app compilado.
- [Agenda, 1366px](evidence/d1a/agenda-1366.png) — app compilado; layout/regras não refatorados.
- [Perfil do cliente, 390px](evidence/d1a/client-drawer-390.png) — app compilado.
- [Drawer do harness, 1366px](evidence/d1a/harness-drawer-1366.png) — componentes reais, sem API.

Essas imagens e testes não equivalem a aprovação visual humana ou a certificação AA de todas as telas. CSS próprio/cores inline de telas antigas (inclusive agenda/dashboard) não foi convertido integralmente. O logo e a identidade repetida existentes permanecem para D1b.

## 3. Ressalvas e gates mantidos

1. **Impressão preexistente:** `EncounterSheet` posiciona `.il-print-area` com `left: -10000` inline. A regra de impressão anterior define `left: 0` sem `!important`; portanto o inline prevalece. No app D1a a coordenada X foi −9254; na reprodução mínima com `ui.tsx` e `globals.css` extraídos de `ebc7130`, −9340. Ambos os PDFs tinham uma página e texto extraído vazio. A reprodução de base é um harness mínimo, não uma segunda build do produto. Não se alterou `EncounterSheet` nem o CSS de impressão anterior. Corrigir e validar paginação/ausência de nota interna exige revisão própria; não se infere segurança do PDF vazio.
2. **Revisão S não resolvida:** `pages` acessível à secretária sem `pagina` retorna objeto amplo do negócio; `organizations` inclui `predictedRevenue` mesmo sem `financeiro`; people360 de profissional inclui agendamento de outro profissional na mesma unidade. Este último é escopo CRM intratenant, não evidência de vazamento cross-tenant. Mantidos no D0 e nas observações HTTP; exigem decisão explícita antes de mudanças sensíveis.
3. **Acessibilidade parcial:** sem auditoria assistiva com leitor de tela, Safari/WebKit/Firefox, zoom 200% ou toda a matriz de rotas/estados. Dialog depende de navegadores modernos com `showModal`. A vinculação manual de painéis de consumidores como `/canais` não foi migrada. Sheets legados próprios da agenda não foram reescritos.
4. **Operação:** os testes de browser do app exercitaram consumidores selecionados, não todos os papéis em todas as telas; contexto/permissões foram também cobertos por testes direcionados e HTTP. Não houve teste de integrações reais, automações externas ou dados reais.
5. **Tooling:** Vite emite aviso não fatal sobre futuro `configLoader: native`. O harness novo requer Node moderno (validado com 22.22.3); não foi alegada compatibilidade do tooling com o mínimo histórico 18.17 declarado pelo projeto.

## 4. Como reproduzir/revisar com segurança

### Componentes (sem banco ou login)

Em checkout de desenvolvimento sem credenciais/arquivos `.env` de produção, usando Node 22.22.3+ compatível:

```sh
npm ci
npm run typecheck
npm test -- src/components/__tests__/ui.test.tsx \
  src/lib/__tests__/design-360-tokens.test.ts \
  src/lib/__tests__/visual-convergence.test.ts \
  src/lib/__tests__/workspace.test.ts src/lib/__tests__/panel.test.ts \
  src/lib/__tests__/business-context.test.ts src/lib/__tests__/permissions.test.ts \
  src/lib/__tests__/professional-access.test.ts src/lib/__tests__/tenant-isolation.test.ts \
  src/lib/__tests__/agenda-workspace.test.ts \
  src/lib/__tests__/a34-encounter.test.ts src/lib/__tests__/a34-team.test.ts
npx playwright install chromium
npm run test:d1a:serve
# Em outro terminal, mantendo o servidor:
npm run test:d1a:browser
```

No sandbox desta revisão o comando equivalente foi:

```sh
env -i PATH="$PATH" HOME="$HOME" \
  D1A_BROWSER_EXECUTABLE=/tmp/chromium LD_LIBRARY_PATH=/tmp/al2023/lib \
  npm run test:d1a:browser
```

O executável alternativo é efêmero e não foi incorporado ao projeto. Não contornar TLS/sandbox se o download padrão falhar. O harness escuta em `0.0.0.0:3100`, aceita o host de preview `.e2b.app`, não chama backend e não participa das rotas/build Next. Artefatos regeneráveis ficam em `.cache/d1a-browser/` (ignorados), não no Git.

### Roteiro humano no app isolado

O preview local de revisão usa build compilada na porta 3000, banco JSON separado e apenas dados sintéticos. Acesso pela autenticação normal; nenhuma sessão, senha, token ou banco foi incluído na PR. Não rodar fixtures contra preview remoto, produção ou `DATABASE_URL` real.

1. Em unidade sintética, visitar Dashboard e Agenda; comparar contraste e largura disponível sem reorganização do menu.
2. Clientes → abrir perfil → usar apenas Tab/Shift+Tab; verificar título inicial, campos, retorno ao abridor e ausência de interação com o fundo.
3. Atendimentos → abrir registro sobre o perfil → Escape fecha só o registro e depois o perfil. Conferir em 390px e desktop.
4. Equipe → Adicionar membro → conferir nomes acessíveis, foco e Escape, sem salvar acesso real.
5. Harness: setas/Home/End nas abas, aba desabilitada ignorada; ativar reduced-motion; alternar escopo e comparar amostras da clínica/não escopadas.
6. Conferir landing/login/recuperação/página pública com tema próprio, sem aplicar a paleta da plataforma.
7. Impressão: tratar como pendência conhecida, não como teste aprovado. Leitor de tela/outros motores/zoom e aprovação estética continuam revisão humana.

Build/HTTP usaram `/home/user/.cache/d1a/build-empty.db.json` e `/home/user/.cache/d1a/review.db.json`; logs/PDFs/scripts de sessão ficaram fora do repo. A fixture HTTP de D0 foi aplicada uma vez ao novo banco; é não idempotente e não deve ser repetida indiscriminadamente.

## 5. Reversibilidade e encerramento

A base visual pode ser desativada removendo apenas `.il-platform` do shell; as melhorias de comportamento são independentes. Para reversão completa, reverter o commit D1a sem tocar no commit documental D0. Não há migração de dados a desfazer.

**Parada:** entregar a PR para revisão. Nenhuma autorização implícita para D1b, D2–D4, correção S ou alteração do contrato de publicação.
