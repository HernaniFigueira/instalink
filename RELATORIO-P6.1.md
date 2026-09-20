# P6.1 — WhatsApp demonstrável por QR Code

## 1. Auditoria pré-implementação (20/09/2026)

`git pull origin main`: **Already up to date**. HEAD base:
`b3cb6cc68196b9e47e8a13ba8774c1396bf8ede6`.
Branch exclusiva desta sessão: `arena/01a0bc51-instalink` (fixada pelo ambiente;
não foi criada uma segunda branch). A auditoria foi registrada neste relatório
no primeiro checkpoint, antes da implementação do provider.

Documentos de referência: `ARQUITETURA.md`, `RELATORIO-P4.md`, `RELATORIO-P5.md`,
`RELATORIO-A3.4.md`, `.env.example`. Superfícies auditadas: APIs WhatsApp,
`whatsapp*.ts`, `agent`, `agent-flow`, `concierge`, `pipeline`, `booking-create`,
`WhatsappChannelPanel`, `/canais`, `/conversas` e API de conversas.

### Peças existentes reutilizadas

| Peça | Responsabilidade mantida |
| --- | --- |
| Webhook Meta | HMAC fail-closed, resolução por phoneNumberId/WABA, status de entrega |
| `contacts`, `pipeline` | Identidade, upsert, dedupe e origem do CRM; `findLead`/`ingestLead` |
| `agentFor`/`agentActive`, `conciergeAnswer` → `agentFlowStep` | Um único agente e contexto persistido na conversa |
| `computeSlots`, `createBookingTx` | Agenda real: disponibilidade, exceções, duração, buffer, antecedência, timezone, profissional elegível, conflito e CRM |
| `deliverWhatsappMessage` | Outbox existente, CAS/lease, persistência de status e retry pelo cron existente |
| `/conversas` | Inbox unificado, unread, Automação/Humano, takeover e resposta manual |
| `/canais` | Embedded Signup e diagnóstico oficial preservados |
| P4/P5 | Eventos/serviços oficiais continuam sendo acionados; nenhum segundo motor |

Achados: o inbound estava dentro da rota Meta; não havia provider QR; opções de
serviço/dia existiam só como botões do chat web; handoff respondia mesmo com
agente desligado; o WhatsApp pulava a confirmação do horário; o claim da outbox
WhatsApp precisava excluir explicitamente mensagens de outros canais.

## 2. Problema resolvido e situação real

O InstaLink agora possui **dois transportes de WhatsApp**, com o mesmo CRM,
inbox, agente, contexto e Agenda. A conexão experimental cria/reutiliza uma
instância externa, solicita QR real e só marca conectado após consultar uma
sessão `open` na Evolution. Sem configuração, mostra:

> Provider experimental ainda não configurado no servidor.

**Validação física ainda pendente (`BLOCKED_EXTERNAL`):** não foram fornecidos
servidor Evolution, credenciais, domínio de webhook e telefones reais. Não foi
escaneado um QR de produção nesta entrega. Os testes exercitam HTTP mockado e
persistência real em banco isolado; não se apresenta isso como demonstração
real já realizada. O roteiro abaixo é o gate humano comercial restante.

## 3. Arquitetura final

```text
Meta → HMAC + phoneNumberId/WABA ─┐
                                ├→ NormalizedWhatsappInbound
Evolution → header + instância ─┘       ↓
                               processWhatsappInbound()
                                       ↓
                 Contact → Lead → Conversation → Message inbound
                                       ↓
                   agent.channels.whatsapp + conversation.mode
                                       ↓
                   concierge → agent-flow → computeSlots
                                       ↓
                            createBookingTx → Booking/CRM/P4
                                       ↓
                           Message outbound (outbox existente)
                                       ↓
                           deliverWhatsappMessage (claim CAS)
                                       ↓
                             sendWhatsappText (transporte)
                         ↙                         ↘
                 sender Meta existente       Evolution sendText
```

O nome/import legado `deliverWhatsappMessage` foi conservado para evitar
reescrever consumidores e testes; sua implementação permanece na outbox em
`whatsapp-cloud-api.ts`, mas delega transporte ao único roteador
`whatsapp-providers/send.ts`. Não foi criada outra fila/retry.
`whatsapp-server.ts` é a fachada de estado para consumidores como Conversas:
a operação do inbox não precisa importar nem chamar o vendor.

## 4. Inbound e regras do atendimento

- Normalização do vendor só na borda; o serviço compartilhado não recebe payload
  bruto da Evolution. Aceita texto de conversa/extendedText, ID, telefone e nome.
- Mesma transação para dedupe, contato, lead, conversa, mensagem, unread, contexto,
  reserva e resposta enfileirada. HTTP de envio sempre fora do lock.
- Pessoas novas seguem `upsertContact` → `ingestLead`; pessoas reconhecidas
  reutilizam contato/customer/lead conforme as regras anteriores. Agendamento
  mantém a criação/reutilização e movimentação de lead do `createBookingTx`.
- Modo Humano vence o agente. Pedido de humano muda o modo, limpa o fluxo e,
  **se automação estiver habilitada**, enfileira uma única confirmação de handoff.
  Com agente desligado, nenhuma confirmação automática é enviada.
- `agentActive` ganhou parâmetro opcional de canal (default `site`, compatível).
  Desligar o agente no site não desliga acidentalmente o WhatsApp. Não há nova flag.
- Opções de serviço/dia são projetadas em texto; horários continuam vindo do
  motor existente. Pergunta genérica de serviços usa o catálogo real. FAQ usa a
  mesma seleção de itens visíveis da configuração do agente.
- Escolher horário vai ao passo `confirm` existente. `sim` chama `createBookingTx`.
  Se o slot foi ocupado, não cria outro Booking e retoma `pick_slot`.
- Outbox não reivindica mensagens de Instagram/site. Respostas do agente ainda
  pendentes são interrompidas após desligar o canal ou assumir modo Humano
  (a confirmação única de handoff é identificada para poder sair).

## 5. Outbound e Meta oficial

`sendWhatsappText` decide pelo provider ativo da unidade. Meta continua usando
`sendMetaGraphMessage`, credenciais e contratos anteriores, inclusive templates.
Evolution suporta **texto**, não templates Meta (recusa explícita).
Inbox manual, agente, entrega pendente/cron e conector usam o mesmo roteamento.
Mensagens geradas pelo inbound carregam provider: uma resposta pendente não é
reenviada por outro provider depois de uma troca de conexão.

**O que mudou no oficial:** extração do inbound; namespace de idempotência;
confirmação de agendamento explícita; handoff respeita agente desligado;
seleção de canal independente do site; filtro de canal/humano no claim;
fachada de estado; bloqueio de configuração Meta enquanto experimental está
selecionado. Embedded Signup, troca de código, cofre, registro de número,
assinatura do webhook e cliente Graph **não foram refeitos**. Escritas oficiais
revalidam o provider dentro da transação para não sobrescrever um vínculo novo.

## 6. Evolution: contrato e ciclo de vida

Versão alvo: **Evolution API 2.3.7**, tag upstream, commit
`cd800f2976e1e5b682fbf86a01ee4d85ae61f370`.
Contrato conferido diretamente no código upstream pela GitHub API:

- https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/routes/instance.router.ts
- https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/controllers/instance.controller.ts
- https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/dto/instance.dto.ts
- https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/integrations/event/webhook/webhook.controller.ts

Client encapsula: `/instance/create`, `/instance/fetchInstances?instanceName=`,
`/instance/connect/:name`, `/instance/connectionState/:name`,
`/instance/logout/:name`, `/instance/delete/:name`, `/webhook/set/:name`,
`/message/sendText/:name`. Headers, autenticação, QR, número, erros sanitizados,
redirects proibidos e timeout (12s/chamada, orçamento agregado 45s/client).
Rotas experimentais têm `maxDuration=60`.

- `WHATSAPP-BAILEYS` vive **na Evolution externa**, nunca no Next/Vercel.
- Instância reservada no DB antes da chamada HTTP; recuperação por nome após
  falha parcial, sem criar outra instância a cada clique.
- Lease de ciclo de vida (120s) serializa conexão/status/logout/remoção entre
  requests/servidores. Nenhum HTTP dentro de `updateDB`.
- Webhook registra `MESSAGES_UPSERT` e `CONNECTION_UPDATE`, `byEvents=false`.
- `open` → conectado; criar instância/obter QR não significa conectado.
- Webhook de conexão consulta estado atual: evento `open` atrasado não desfaz
  logout. Primeiro inbound pode reconciliar estado ainda pendente de QR.
- Desconectar e remover são operações separadas, ambas preservam CRM e bookings.
  Para voltar à Meta, remover a conexão experimental primeiro.

## 7. Modelo aditivo e multi-tenant

Em `Business.whatsappIntegration`: `provider?`, `instanceName?`, lease e sua
expiração. Campos anteriores preservados. Estados adicionados:
`not_configured`, `qr_pending`, `connecting`, `disconnected` (além dos legados).
Número, connectedAt, lastWebhookAt, lastInboundAt, lastOutboundAt e lastError
continuam na estrutura existente. `Message.whatsappProvider?` dá namespace aos
IDs. Ausência de provider nos dados legados significa `meta_cloud`.

Nome determinístico não secreto: `il_` + primeiros 32 hex de SHA-256(businessId).
A autoridade para webhook é **o vínculo persistido e único**, não a fórmula
isolada, nem `businessId` enviado por terceiros. A e B têm instâncias diferentes;
colisão/vínculo duplicado é recusado. Instância desconhecida é ignorada com log
seguro, nunca associada por aproximação. O serviço revalida vínculo/provider na
transação. API autenticada não aceita instanceName arbitrário do navegador.

## 8. Segurança e ambiente

Variáveis novas (sem valor no Git):

| Variável | Uso |
| --- | --- |
| `EVOLUTION_API_URL` | URL base HTTPS do servidor externo |
| `EVOLUTION_API_KEY` | Chave global exclusivamente no servidor |
| `EVOLUTION_WEBHOOK_SECRET` | Segredo aleatório de pelo menos 32 caracteres |
| `EVOLUTION_WEBHOOK_URL` | URL pública fixa HTTPS terminando em `/api/whatsapp/providers/evolution/webhook` |

A URL de callback não é derivada de Host do request. Sem credenciais embutidas,
query ou fragmento. Produção exige HTTPS. Chave global não é persistida nem
retornada. Respostas de create/fetchInstances não são repassadas ao frontend.
QR é material transitório de pareamento: response `no-store`, não salvo em DB,
audit/log nem Git; imagem PNG validada/regerada do código retornado pelo provider.

Autenticação webhook: header `x-instalink-webhook-secret`, HMAC-SHA256 do nome da
instância com o segredo global; comparação timing-safe. Header de A não autentica
payload de B. Nunca usa `payload.apikey` como autenticação. Sem configuração →
503; header inválido → 403; JSON inválido → 400; limite 256 KB → 413. Payload
não é logado. Ignora echo/fromMe, grupos, broadcasts, status, mídia e LID sem
telefone resolvido (`remoteJidAlt` com PN é aceito).

GET/POST de gestão exigem `requireBusiness(..., 'whatsapp')`; controle do agente
usa a API real `/api/agent` e sua permissão própria. Sem permissão, não conecta,
não desconecta, não consulta outra instância. Guards Meta/Master impedem troca
implícita. Segredos do provider não passam por bundles client-side.

**Infra externa:** a Evolution necessariamente recebe e armazena a configuração
privada do seu webhook. Proteja a VPS, banco, backups e logs dela; desative logs
`WEBHOOKS`/payloads (o upstream inclui `apikey` em envelopes). Isso não é um campo
persistido no banco do InstaLink. Rotação do segredo exige reconfigurar o webhook
pela ação Conectar/Gerar QR da unidade.

## 9. Idempotência, falhas e observabilidade

- Dedupe por **businessId + provider + externalId inbound**, sob a transação real
  do DB (mutex no modo arquivo; `SELECT FOR UPDATE` no Postgres). Reentrega
  sequencial e concorrente não duplica contato/lead/mensagem/resposta/booking.
- Claim CAS e lease da outbox continuam únicos; cron existente
  `/api/cron/whatsapp`, protegido por `CRON_SECRET`, drena pendências.
- Evolution 429 pode ser reagendada na fila existente. Timeout/resposta sem ID
  ou resultado ambíguo **não ganha retry cego**, pois sendText não documenta chave
  idempotente. Falha fica visível para diagnóstico. Não prometemos exactly-once
  no transporte externo: crash após aceitação remota e antes do commit continua
  sendo uma janela operacional da outbox existente.
- Logs estruturados com provider, businessId, instance, direção, evento,
  externalId, status e timestamp; erro operacional em código fixo. Nada de corpo,
  telefone, segredo ou payload completo. Erros HTTP Evolution nunca ecoam body.
- Auditoria de criação, QR, conexão, desconexão, remoção e troca de provider;
  sem audit extra por mensagem experimental. UI mostra apenas estado, número,
  datas e erro sanitizado em diagnóstico recolhido.

## 10. Interface

Dois cards: **WhatsApp oficial / Recomendado**, com Embedded Signup preservado
em gerenciamento expansível; **Conexão por QR Code / Experimental**, com aviso
claro de tecnologia não oficial e risco de restrições. Modal nativo acessível,
QR grande, instrução `WhatsApp > Aparelhos conectados > Conectar aparelho`,
regeneração, Fechar/Escape, consulta sequencial a cada 5s por até 2min, sem
requests sobrepostos. Para em conectado, erro, timeout, fechar ou desmontar.
Conectado oferece Abrir Conversas. Toggle usa **agent.channels.whatsapp**.
Conversas já possuía badges e alternância Automação/Humano; não foi redesenhada.

## 11. Arquivos

### Novos
- `src/lib/whatsapp-inbound.ts`
- `src/lib/whatsapp-server.ts`
- `src/lib/whatsapp-log.ts`
- `src/lib/whatsapp-providers/{evolution,lifecycle,send}.ts`
- `src/app/api/whatsapp/providers/evolution/route.ts`
- `src/app/api/whatsapp/providers/evolution/webhook/route.ts`
- `src/components/dashboard/WhatsappExperimentalPanel.tsx`
- `src/lib/__tests__/whatsapp-qr-p61.test.ts`
- `RELATORIO-P6.1.md`

### Alterados
- `src/lib/{types,whatsapp,whatsapp-cloud-api,agent,agent-flow,concierge,panel}.ts`
- `src/app/api/whatsapp/{route.ts,onboarding/route.ts,webhook/route.ts}`
- `src/app/api/conversations/route.ts`
- `src/app/api/master/units/[id]/whatsapp/route.ts`
- `src/components/dashboard/WhatsappChannelPanel.tsx`
- `src/lib/__tests__/whatsapp-p61-e2e.test.ts` (fixture agora liga agente no teste de handoff)
- `.env.example`, `ARQUITETURA.md`

Sem alteração em Instagram, página pública, motor da Agenda, CRM, DB adapter,
P4/P5, dependências/lockfile ou desenho global da dashboard.

## 12. Testes e gates

Nova suíte: **45 testes** em `whatsapp-qr-p61.test.ts`. HTTP externo mockado;
client, rotas, autorização, banco temporário, concierge e Agenda reais. Cobre:
instâncias separadas, QR/status/logout/remoção/erro/timeout; zero segredos em
response/DB; autorização e isolamento; webhook inválido/desconhecido/cross-token;
replay concorrente; agente ligado/desligado/site desligado/humano; handoff em seis
frases; seleção e confirmação conversacional com Booking na API da Agenda;
slot ocupado; outbound Meta vs experimental; inbox manual; retry/cron e falha
ambígua; primeiro inbound antes do evento de conexão; rejeição de mídia/grupos;
JSON/limite de payload; catálogo real.

Resultados medidos (banco local isolado, `DATABASE_URL` vazio):

| Gate | Resultado |
| --- | --- |
| `npm test` | **92 arquivos, 1689 testes, 0 falhas** |
| `npm run typecheck` | **0 erros** |
| `npm run build` | **Sucesso**, 113/113 páginas geradas |
| `npm run smoke` | **67 ok, 0 falhas** |
| `npm run smoke:ux` | **87 ok, 0 falhas** |
| `npm run smoke:agendar` | **25 ok, 0 falhas** |
| `npm run smoke:p3` | **15 fluxos ok**, incluindo retry autenticado e execução adicional `SMOKE_P3_RETRY_FULL=1`: três tentativas/failed definitivo, sem quarta requisição |
| `npm run smoke:p4` | **18 verificações ok**, com cron autenticado |
| `npm run e2e-merchant` | **28 ok, 0 falhas** |

Falhas encontradas e corrigidas, não ignoradas: fixture antiga de handoff não
ligava agente; backdrop do modal não usava o token `--overlay`. P4 inicialmente
recusou o receptor loopback pela régua SSRF de produção: repetido com a opção
existente `ALLOW_PRIVATE_OUTBOUND_URLS=1` **só no servidor descartável de smoke**,
nunca recomendada para o deploy comercial. Sem mudança nessa proteção.
Na repetição final, reusar o mesmo seed já preenchido pelas execuções anteriores
esgotou slots dos smokes de Agenda. A causa foi confirmada recriando **somente o
banco descartável**: smoke 67/67, UX 87/87 e agendar 25/25 passaram no build final.
Esses scripts exigem seed limpo; nenhum teste foi removido ou afrouxado.

Warnings existentes: metadata `themeColor` do Next, warning do loader Vite.
`npm ci`/`npm audit` apontaram vulnerabilidades já presentes em **next (critical)**
e **postcss (high)**; lockfile não foi alterado nem se executou upgrade major
fora do escopo. Devem ser tratados em revisão de dependências antes de produção.
Não foi declarado teste visual automatizado em browser nem sessão real Evolution.

## 13. Roteiro manual obrigatório (gate comercial)

### Preparação
1. Provisionar Evolution **2.3.7** fora da Vercel, com armazenamento persistente
   de sessões e banco/Redis conforme documentação upstream. Fixar versão, HTTPS,
   firewall e autenticação global. Não usar endpoint público desprotegido.
2. Configurar as quatro envs acima no servidor do InstaLink (sem `NEXT_PUBLIC_`).
   `EVOLUTION_WEBHOOK_URL` deve ser alcançável pela VPS e não sofrer proteção de
   preview/login da hospedagem. Não remover a autenticação do webhook para isso.
3. Fazer deploy; confirmar persistência de produção no Postgres existente.
   Agendar `/api/cron/whatsapp` com `CRON_SECRET` pelo scheduler externo existente.
4. Acessar unidade demo com permissão WhatsApp e Agente. Cadastrar serviços reais,
   duração/preço público, profissional elegível, disponibilidade/exceções e fuso.
5. Ativar o recurso Agente e o agente da unidade. Usar número de demonstração e
   **outro telefone** para enviar mensagens (echo do próprio número é ignorado).

### Conexão
6. Entrar em **Canais > WhatsApp**. A Meta deve permanecer identificada como
   recomendada; QR como experimental.
7. Se houver conta oficial ativa, desconectá-la conscientemente antes de trocar.
8. Clicar **Conectar por QR Code**. Confirmar que há QR do provider, não link wa.me.
9. No telefone que será a conta da unidade: **WhatsApp > Aparelhos conectados >
   Conectar aparelho**, escanear. Se expirar, Gerar novo QR.
10. Confirmar **Conectado**, número e data. Fechar o modal se necessário e usar
    Atualizar estado. Clicar **Abrir Conversas**. Ativar Atendimento automático
    no card do WhatsApp (a configuração real `agent.channels.whatsapp`).

### Conversa, Agenda e CRM
11. Do outro telefone enviar `Oi`.
12. Confirmar entrada em `/conversas`, contato, lead e origem/canal WhatsApp.
13. Confirmar resposta automática **no telefone externo**, não só Message no DB.
14. Perguntar `Quais serviços vocês oferecem?` e o preço de um serviço; comparar
    nomes/preços com o catálogo desta unidade.
15. Enviar `quero agendar`; responder com o nome do serviço oferecido.
16. Pedir `amanhã` (ou dia disponível), escolher horário oferecido e responder
    `sim` à confirmação. Conferir resposta no telefone.
17. Abrir a **mesma Agenda** e confirmar Booking, data, profissional e cliente.
    Conferir lead em scheduled, vínculo/CRM e histórico em Conversas.

### Handoff e reativação
18. Enviar `quero falar com um atendente`.
19. Conferir uma única mensagem de transferência e modo **Humano** em Conversas.
20. Mandar outra mensagem. Conferir inbound/unread, **nenhuma resposta do bot**.
21. Responder pelo inbox como equipe; conferir a entrega no telefone externo.
    Reativar Automação explicitamente e mandar `Oi` para conferir retomada.

### Segurança e resiliência
22. Desligar Atendimento automático: `Oi` entra sem resposta. Religar.
23. Oferecer slot, ocupá-lo por outra operação na Agenda, confirmar no WhatsApp:
    receber conflito, sem double-booking; escolher outro horário.
24. Reentregar o mesmo evento autenticado no ambiente de homologação: contagens
    de inbound/outbound/lead/booking não aumentam. Nunca expor o header na tela.
25. Conectar uma segunda unidade em **outro número**: mensagem/contato/Booking
    de A não aparecem em B; usuário de B não consegue gerenciar A.
26. Desconectar; confirmar sessão encerrada na Evolution. Conversas/CRM/Agenda
    permanecem. Remover conexão experimental e conferir auditoria/preservação.
27. Testar Meta/Embedded Signup com credenciais válidas antes de liberar uma
    unidade oficial de produção; o teste físico Meta também depende do ambiente.

## 14. Limitações conhecidas e fora do escopo

- WhatsApp Web é **não oficial**, pode desconectar/sofrer restrições; Meta continua
  recomendada para produção. Não há garantia comercial até executar o roteiro real.
- Texto 1:1 apenas; sem áudio, imagem, grupo, broadcast, histórico ou importação de
  contatos. LID sem PN resolvido é ignorado, nunca vira telefone inventado.
- Um provider ativo por unidade; sem coexistência simultânea/roteamento por conversa
  entre duas contas. Troca preserva histórico, exige desconexão/remoção explícita.
- Só Evolution 2.3.7 foi alvo do contrato, não forks nem outras versões. Deploy
  deve verificar compatibilidade Baileys/WhatsApp e políticas da hospedagem.
- QR não é mantido em cache no DB: ao fechar/reabrir, solicitar/consultar novamente.
  Polling só enquanto modal aberto; status fora dele é último estado confirmado,
  atualizado por webhook/consulta explícita.
- Motor conversacional continua determinístico e limitado ao vocabulário existente.
  Não foi adicionado LLM. Não há agenda/CRM/agente paralelos.
- Não foram implementados editor de automação novo, eventos P4 novos de WhatsApp,
  mídia, campanhas QR/marketing em massa, Instagram, billing ou migração de DB.
- A deduplicação depende de preservar o histórico das mensagens, como no fluxo
  oficial. Apagar mensagens deliberadamente remove sua evidência de dedupe.
- Scheduler, secrets de produção, VPS e dois telefones são responsabilidade de
  implantação/homologação. **Nenhum merge automático.**
