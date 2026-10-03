# PR53 — auditoria de fechamento

Base examinada: `0c426be570e528569a27dc4f48e6f1afe59f3427` (PR52); HEAD anterior `b86d59a0c2e92d946d594aa4d74ba33c8c695068`. A revisão inclui o diff acumulado, não somente esta rodada. O SHA executado fica nos relatórios pós-commit e no comentário de fechamento da PR53.

## Copy — classificação

Busca AST de literais TS/TSX (não comentários), incluindo os termos página/página pública, captadas/interesses da página, link na bio/bio, loja, produto, pedido e promoções. Inventário por arquivo/linha: `PRE-F1-COPY-INVENTORY.tsv`. Identificadores de API, testes e documentos históricos são compatibilidade, não copy operacional; não foram apagados.

- **A, ativa corrigida:** Clientes (empty state), Campanhas (explicação, exemplo e placeholder), Configurações (descrição), permissões Catálogo/Oportunidades, descrição de evento de contato e QR Code, metadados globais. Fonte `public_page` deixa de ser oferecida com flag OFF. Histórico de origem recebe apresentação explicitamente legada, sem mudar valores armazenados; modo legado conserva rótulos originais.
- **B, preservada:** `/pagina`, `/produtos`, `/pedidos` bloqueados/condicionados à flag; renderer público, documentos legais, Master, IDs `Product/Order/instalink_doc`, enums e payloads. NewBookingSheet contém copy de página apenas no ramo legacy. Tags acesso/marketing da biblioteca não são renderizadas no Cliente360. Campos `accountStatus`, `marketingOptIn`, descrição e credenciais continuam nos modelos/APIs.
- **C, contextual:** “recarregar a página”, paginação, biografia e “padrão do produto” significam navegação ou software; não são oferta comercial. Histórico real e origens desconhecidas não são apagados nem inventados.
- Chromium: sete superfícies obrigatórias nos dois temas, mais Dashboard, Estrutura, Disponibilidade, Assistente, Pendências, Oportunidades, Campanhas, Automações, Follow-up, Canais/Fontes, Resultados, Financeiro, Recursos, Execuções, Aparência e busca vazia de Clientes. Regex é complemento à classificação, não prova isolada.

## Botões

Ações secundárias locais migradas em Clientes, Cliente360, Equipe, Configurações e ImageUpload. WhatsApp da lista e ficha usa variante verde semântica. Confirmação de descarte usa tokens do tema, sem importar `ui` no guard (evita ciclo). Primitive central mantém border no hover transparente; primary sólido.

Inventário dos controles não canônicos está no campo `rawButtons` do relatório Chromium. Exceções deliberadas: tabs/segmented, chips de disponibilidade, links de texto dentro de explicação, identidade clicável do cliente/pet, copiar telefone, voltar e menus da topbar. São navegação/terciários, não botões secundários; não houve redesign de tabs/chips.

## Diff acumulado e regressões

- Agenda: layout focaliza somente a coluna selecionada enquanto o drawer está aberto; mantém seleção real, resumo móvel e largura sem overflow. Sem nova engine temporal. Snap administrativo 15 e duração própria conservam autorização, UTC, cadência pública e validação de disponibilidade existentes.
- Equipe: retirados auto-seleção e estado touched obsoletos; nenhuma segunda verdade `Professional.serviceIds`. Serviço continua canônico. Drawer não modal é opt-in; demais drawers continuam modais. Navegação/sidebar/back usam guard; discard retoma uma vez, sem loop. Inset medido do shell não é sobrescrito.
- Biblioteca: listeners de pointer/focus têm cleanup; erro de criação de grupo não é silenciosamente ignorado. Controles de descrição, recursos e buffers preservados em disclosures.
- Cliente360: handlers inacessíveis de consentimento/credenciais removidos; storage/API e edição efetiva preservados. Sem alteração de auth/cookies, isolamento tenant, escopo profissional ou migração de dados.
- Testes atualizados somente por contrato explícito: snap15, Recepção sem leads, retenção de intenção, aparência e secondary/WhatsApp. Nenhum teste removido/skip/only/todo novo; nenhum baseline ampliado. Fixture tenant ambígua exige escolha, não fallback para primeira unidade.
- Harness antigo ajustado para clicar o backdrop real medido, não uma coordenada que agora pertence à sidebar. Testado no Chromium: backdrop/Continue/Escape/Discard. Novo harness usa cliques reais, save+F5+reabrir e normal/hover; não altera banco diretamente.

## Evidência vinculada ao commit

Os relatórios pós-commit devem estar em `/home/user/pre-f1-closing-<SHA>/`, com logs, screenshots, SHA e inventário de checks. Não versionar nova evidência após os testes, pois isso criaria outro HEAD. O comentário final da PR registra o mesmo SHA e deployment Vercel SUCCESS. Nenhuma homologação de produção, F1 ou merge está autorizada por este documento.
