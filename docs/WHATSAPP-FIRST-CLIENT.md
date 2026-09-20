# Passo a Passo: Conexão Oficial da Primeira Clínica ao WhatsApp (Meta Cloud API)

Este documento detalha o processo exato e seguro para conectar a primeira conta comercial do **WhatsApp Business Cloud API** ao InstaLink, garantindo conformidade com a Meta, isolamento multi-tenant, criptografia de tokens e integridade da esteira de CRM.

---

## 1. Pré-requisitos na Meta

1. **Conta no Meta for Developers**:
   - Acesse [developers.facebook.com](https://developers.facebook.com/) com a conta do Facebook do gestor ou da clínica.
2. **Gerenciador de Negócios (Meta Business Suite / Portfolio)**:
   - Empresa com razão social, CNPJ e documentação verificada (ou em verificação).
3. **Aplicativo do Tipo "Empresa" (Business App)**:
   - Criar um app no painel da Meta selecionando o caso de uso **Outro** → Tipo **Negócio** (Business).
   - No painel do app, adicionar o produto **WhatsApp**.

---

## 2. Seleção e Configuração da WABA (WhatsApp Business Account)

1. No menu do app, navegue até **WhatsApp → Configuração da API** (API Setup).
2. Vincule ou crie a **WABA** da clínica:
   - Nome comercial da clínica (ex.: `Clínica Odonto InstaLink`).
   - Fuso horário e moeda (`America/Sao_Paulo` / `BRL`).
3. Anote o **Identificador da conta do WhatsApp Business (WABA ID)**:
   - Exemplo: `108923485923847`.

---

## 3. Número de Telefone Oficial

Diferenciação mandatória entre os modos de operação da Meta:

1. **Standard (Exclusivo Cloud API)**:
   - Número exclusivo e dedicado registrado diretamente na Cloud API (não pode estar ativo no WhatsApp Messenger comum ou no WhatsApp Business App de celular).
   - Conclui a verificação por código SMS ou chamada de voz e registra via PIN de 2 etapas na Meta (`/register`).
2. **Coexistence (WhatsApp Business App Compartilhado)**:
   - Número já utilizado pela clínica no WhatsApp Business App no smartphone celular, conectado pelo fluxo oficial compatível (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`).
   - Não executa o registro com PIN na Cloud API (pula `/register` para não derrubar o aplicativo no celular) e exige confirmação server-to-server na Graph API (`is_on_biz_app === true && platform_type === 'CLOUD_API'`).

Após verificado, a Meta gera o **Identificador do número de telefone (Phone Number ID)**:
- Exemplo: `109283746152345`.
- Este identificador é público e único por número.

---

## 4. Credenciais de Acesso (Token Permanente de Sistema)

> **ATENÇÃO:** Nunca use o token temporário de 24 horas em produção. Crie um Usuário do Sistema.

1. Acesse o **Meta Business Suite → Configurações do Negócio → Usuários do Sistema** (System Users).
2. Adicione um usuário do sistema (ex.: `instalink-whatsapp-bot`) com função de **Administrador**.
3. Em **Recursos Atribuídos**, conceda controle total sobre:
   - O aplicativo criado.
   - A conta do WhatsApp Business (WABA).
4. Clique em **Gerar Novo Token**:
   - Selecione o aplicativo da clínica.
   - Validade: **Nunca expira** (Permanent).
   - Permissões obrigatórias:
     - `whatsapp_business_messaging`
     - `whatsapp_business_management`
5. Copie o token de acesso gerado.

---

## 5. Variáveis de Ambiente no InstaLink (Vercel / Produção)

No painel da Vercel (ou servidor de produção), configure as seguintes variáveis sensíveis:

| Variável | Descrição | Exemplo |
| :--- | :--- | :--- |
| `META_APP_ID` | Identificador público do App no Meta for Developers utilizado pelo Embedded Signup | `108923485923847` |
| `META_CONFIG_ID` | ID da configuração do Embedded Signup gerada no Meta for Developers | `982347102938471` |
| `META_APP_SECRET` | Chave secreta principal do aplicativo Meta (App Secret) utilizada no Embedded Signup para troca de código OAuth e cálculo de `appsecret_proof` | `8fbc923a10...` |
| `WHATSAPP_CREDENTIALS_KEY` | Chave de 32 bytes (64 caracteres hexadecimais) exclusiva para criptografia AES-256-GCM de tokens de clientes em repouso no banco | `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` |
| `WHATSAPP_VERIFY_TOKEN` | Token secreto definido por você para validação do handshake do webhook pela Meta | `ilk_webhook_sec_99347812` |
| `CRON_SECRET` | Segredo de autorização Bearer para execução segura da rota do cron worker (`/api/cron/whatsapp`) | `cron_secret_prod_993...` |
| `META_GRAPH_VERSION` | *(Opcional)* Versão da Graph API da Meta (se omitido, o sistema utiliza o padrão seguro conferido, atualmente `v26.0`) | `v26.0` |

> **Nota sobre segredos de assinatura:** `WHATSAPP_APP_SECRET` é apenas um alias legado aceito pelo servidor para validação da assinatura HMAC (`x-hub-signature-256`) do webhook. A variável principal utilizada pelo Embedded Signup oficial e exigida para troca de tokens e prova de app secret é `META_APP_SECRET`.

---

## 6. Configuração do Webhook da Meta

1. No Meta for Developers, vá em **WhatsApp → Configuração** (Configuration).
2. No bloco **Webhook**, clique em **Editar**:
   - **URL de Retorno de Chamada (Callback URL)**:
     `https://<seu-dominio-real-de-producao>/api/whatsapp/webhook`
   - **Verificar Token (Verify Token)**:
     Insira o mesmo valor definido em `WHATSAPP_VERIFY_TOKEN`.
3. Clique em **Verificar e Salvar**. A Meta fará uma chamada `GET` com o desafio (`hub.challenge`) que o InstaLink valida instantaneamente.
4. Em **Campos do Webhook**, clique em **Gerenciar**:
   - Inscreva o campo obrigatório: `messages` (cobre mensagens recebidas, entregas, confirmações de leitura e erros).

---

## 7. Associação da Clínica ↔ Phone Number ID

Há **dois caminhos**, e os dois terminam no mesmo lugar (token criptografado na
unidade, webhook assinado na WABA):

### Opção 0 — Popup oficial da Meta (Embedded Signup) — caminho normal (A3.4 · Bloco 8)

A própria clínica conecta a conta, sem ver token nenhum:

1. A plataforma configura **uma vez** (variáveis de ambiente):
   `META_APP_ID`, `META_CONFIG_ID`, `META_APP_SECRET`, `WHATSAPP_CREDENTIALS_KEY`,
   `WHATSAPP_VERIFY_TOKEN`, `CRON_SECRET`. No app da Meta, o domínio do painel precisa estar em
   **Allowed domains** e **Valid OAuth redirect URIs**.
2. No painel, a clínica abre **Canais → WhatsApp → “Conectar com a Meta”**.
3. O popup devolve WABA, número (pode faltar) e um **código que vale 30 segundos
   e só pode ser usado uma vez**.
4. O servidor troca o código pelo token (`GET /oauth/access_token`), descobre o
   que faltar (`debug_token`, `/{WABA}/phone_numbers`), **assina o webhook**
   (`POST /{WABA}/subscribed_apps`) e guarda o token com AES-256-GCM.
5. Se o número for Standard e ainda não estiver registrado, informe o **PIN de duas etapas** no
   próprio painel: o registro (`POST /{PHONE_NUMBER_ID}/register`) sai do nosso
   servidor direto para a Meta e o PIN não fica guardado. Se for Coexistence, o registro
   é ignorado e a confirmação é validada server-to-server.

Se o token expirar ou a conta for trocada, basta refazer o popup — nada é
digitado à mão. Quando a Meta recusa a assinatura do webhook, a unidade fica
**pendente** com o motivo escrito (nunca “conectado” sem conseguir receber).

### Opção A — Pela API Segura Master (caminho assistido)

Quando a plataforma ainda não tem o app da Meta configurado (ou a clínica prefere o caminho assistido), o Master da plataforma cadastra e valida as credenciais técnicas.

Faça uma requisição autenticada com sessão de Master da plataforma:

```http
POST /api/master/units/{BUSINESS_ID}/whatsapp
Authorization: Bearer <MASTER_SESSION_OR_COOKIE>
Content-Type: application/json

{
  "phoneNumberId": "109283746152345",
  "wabaId": "108923485923847",
  "accessToken": "EAA...",
  "displayPhone": "+55 11 99999-8888"
}
```

O servidor InstaLink:
1. Valida em tempo real o token e o `phoneNumberId` na Meta via Graph API.
2. Criptografa o `accessToken` com **AES-256-GCM** antes de salvar no banco.
3. **Não inventa `webhookSubscribedAt`** nem **`registeredAt`**.
4. **Não define `connectedAt`** prematuramente.
5. **Mantém a integração como `pending`** até que as etapas oficiais (assinatura de webhook na WABA e registro/coexistência da Meta) sejam efetivamente comprovadas.
6. Responde `200 OK` com status transparente (`pending`) sem expor o segredo no JSON.

---

## 8. Como Validar a Conexão no Painel da Clínica

1. Acesse o painel da clínica em `/canais?tab=canais`.
2. Se todas as etapas reais forem concluídas (credenciais válidas, webhook assinado e registro/coexistência comprovados), o card do WhatsApp exibirá o badge **Conectado** em verde. Caso contrário, exibirá **Pendente** ou **Não conectado** com o motivo exato.
3. Informações visíveis:
   - Número verificado (ex.: `+55 11 99999-8888`).
   - Identificadores mascarados (ex.: `••••••••2345`).
   - Data e hora de conexão real.
4. Clique no botão **Testar conexão**:
   - O InstaLink fará uma consulta em tempo real à Meta e confirmará a saúde do canal.

---

## 9. Enviando a Primeira Mensagem Real (Teste E2E Ponta a Ponta)

1. Pegue um smartphone de teste que não seja o número da clínica.
2. Abra o WhatsApp e envie:
   `"Oi, gostaria de fazer uma limpeza"`
3. No InstaLink:
   - O webhook oficial da Meta recebe o evento e valida a assinatura `x-hub-signature-256`.
   - O sistema detecta que é um novo contato, cria o `Contact` no CRM e cria o `Lead` via `ingestLead`.
   - Uma nova conversa aberta é criada em `/conversas`.
   - O Concierge operacional responde automaticamente via WhatsApp:
     `"Claro! Para qual data ou dia você gostaria de agendar Limpeza?"`
4. No celular, responda uma data (ex.: `"amanhã"` ou `"terça"`):
   - O agente consulta a disponibilidade em tempo real (`computeSlots`).
   - Responde com opções de horários livres reais cadastrados na clínica.
5. No celular, escolha o serviço, a data e o horário (ex.: `"14:00"`):
   - O sistema solicita confirmação explícita de agendamento (ex.: *"Você confirma o agendamento de Limpeza para terça-feira às 14:00 com Dr. Orlando?"*).
   - O lead permanece no funil em atendimento e **nenhum booking é gravado** até a confirmação do cliente.
6. No celular, responda explicitamente: `"Sim, confirmo"` (ou equivalente afirmativo):
   - Somente após a confirmação explícita, o sistema invoca atomicamente a transação `createBookingTx`.
   - Se houver colisão de horário no momento da gravação, o conflito continua protegido atomicamente pelo lock transacional do banco e uma mensagem de horário indisponível é enviada.
   - Com a transação concluída com sucesso, o `Lead` avança automaticamente para o estágio `scheduled`.
   - A confirmação com os detalhes da consulta é enviada no WhatsApp.
   - O agendamento aparece na **Agenda** (`/agenda`) e a jornada completa é visível no **Cliente 360** (`/clientes`).

---

## 10. Aviso de Honestidade e Homologação Física

> **AVISO DE HONESTIDADE TÉCNICA:**
> A suíte automatizada de testes do sistema utiliza mocks e respostas simuladas da Graph API da Meta para garantir a robustez de contratos, segurança de concorrência e isolamento multi-tenant.
>
> A integração real com a Meta em ambiente de produção **permanece pendente da configuração real do Meta App no Meta for Developers, da publicação do Webhook com URL pública HTTPS válida e da homologação física com dois telefones celulares reais** (um atuando como WhatsApp da clínica e outro atuando como cliente final).
>
> Nunca declare ou assuma o WhatsApp como "conectado" perante a diretoria ou cliente sem antes realizar este teste físico ponta a ponta com envio e recebimento de mensagens reais.

---

## 11. Onde Olhar Logs e Diagnosticar Falhas

1. **Painel Canais (`/canais?tab=canais`)**:
   - Exibe o status consolidado honesto, número conectado, último evento recebido e link direto para as Conversas.
2. **Histórico da Conversa (`/conversas`)**:
   - Se uma mensagem falhar, o status exibe `falhou` acompanhado do motivo retornado pela Meta (ex.: `131026: Message Undeliverable`).
3. **Auditoria Administrativa (`/admin/auditoria` e `/master/atividade`)**:
   - Registra eventos de configuração, auditoria de tokens criptografados e webhooks recebidos.
4. **Erros Comuns e Soluções**:
   - **403 Webhook**: Verifique se `WHATSAPP_VERIFY_TOKEN` e `META_APP_SECRET` / `WHATSAPP_APP_SECRET` batem exatamente com as configurações do painel Meta.
   - **131030 (Payment issue)**: A conta da WABA precisa ter uma forma de pagamento cadastrada no Gerenciador de Negócios da Meta.
   - **Template Required**: Mensagens ativas fora da janela de 24 horas exigem templates aprovados na Meta.

---

## 12. Processamento em Segundo Plano e Fila de Retentativas

Para garantir a entrega resiliente de mensagens e campanhas mesmo em caso de instabilidades transitórias da Meta Cloud API:
- **Endpoint**: `GET /api/cron/whatsapp` ou `POST /api/cron/whatsapp`
- **Cabeçalho**: `Authorization: Bearer <CRON_SECRET>`
- **Agendamento**: a cada 1 ou 2 minutos via Vercel Cron, GitHub Actions ou agendador externo.
- As mensagens falhadas com erros transitórios (rate limits, 5xx, erros 131016/131021 da Meta) são reprocessadas com recuo exponencial (30s, 120s) e claim atômico via CAS.
