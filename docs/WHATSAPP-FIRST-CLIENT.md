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

1. Na seção **Números de Telefone**:
   - Utilize um número exclusivo (que não esteja ativo no WhatsApp Messenger comum ou WhatsApp Business App de celular).
   - Conclua a verificação por código SMS ou chamada de voz.
2. Após verificado, a Meta gera o **Identificador do número de telefone (Phone Number ID)**:
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
| `WHATSAPP_VERIFY_TOKEN` | Token secreto definido por você para validação do webhook pela Meta | `ilk_webhook_sec_99347812` |
| `WHATSAPP_APP_SECRET` | Chave secreta do aplicativo Meta (App Secret) para conferência de assinatura `x-hub-signature-256` | `8fbc923a10...` |
| `WHATSAPP_CREDENTIALS_KEY` | Chave de 32 bytes para criptografia AES-256-GCM de tokens individuais de clientes no DB | `55f8c32...` |
| `META_GRAPH_VERSION` | Versão oficial da Graph API da Meta (opcional, padrão `v21.0`) | `v21.0` |

---

## 6. Configuração do Webhook da Meta

1. No Meta for Developers, vá em **WhatsApp → Configuração** (Configuration).
2. No bloco **Webhook**, clique em **Editar**:
   - **URL de Retorno de Chamada (Callback URL)**:
     `https://app.instalink.app/api/whatsapp/webhook`
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
   `WHATSAPP_VERIFY_TOKEN`. No app da Meta, o domínio do painel precisa estar em
   **Allowed domains** e **Valid OAuth redirect URIs**.
2. No painel, a clínica abre **Canais → WhatsApp → “Conectar com a Meta”**.
3. O popup devolve WABA, número (pode faltar) e um **código que vale 30 segundos
   e só pode ser usado uma vez**.
4. O servidor troca o código pelo token (`GET /oauth/access_token`), descobre o
   que faltar (`debug_token`, `/{WABA}/phone_numbers`), **assina o webhook**
   (`POST /{WABA}/subscribed_apps`) e guarda o token com AES-256-GCM.
5. Se o número ainda não estiver registrado, informe o **PIN de duas etapas** no
   próprio painel: o registro (`POST /{PHONE_NUMBER_ID}/register`) sai do nosso
   servidor direto para a Meta e o PIN não fica guardado.

Se o token expirar ou a conta for trocada, basta refazer o popup — nada é
digitado à mão. Quando a Meta recusa a assinatura do webhook, a unidade fica
**pendente** com o motivo escrito (nunca “conectado” sem conseguir receber).

### Opção A — Pela API Segura Master (caminho assistido)

Quando a plataforma ainda não tem o app da Meta configurado (ou a clínica prefere o caminho assistido), o Master da plataforma executa a configuração validada — e a conexão fica marcada com origem `master`.

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
1. Testa imediatamente o token e o `phoneNumberId` na Meta via Graph API.
2. Criptografa o `accessToken` com **AES-256-GCM** antes de salvar no banco.
3. Define o status como `connected` e preenche `connectedAt` e `verifiedName`.
4. Responde `200 OK` sem expor o segredo no JSON.

---

## 8. Como Validar a Conexão no Painel da Clínica

1. Acesse o painel da clínica em `/canais?tab=canais`.
2. O card do WhatsApp exibirá o badge **Conectado** em verde.
3. Informações visíveis:
   - Número verificado (ex.: `+55 11 99999-8888`).
   - Identificadores mascarados (ex.: `••••••••2345`).
   - Data e hora de conexão.
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
   - Responde com horários livres reais cadastrados na clínica.
5. No celular, escolha o horário (ex.: `"14:00"`):
   - O slot é revalidado atomicamente.
   - O agendamento real é criado via `createBookingTx`.
   - O `Lead` avança automaticamente para o estágio `scheduled`.
   - A confirmação é disparada no WhatsApp.
   - O agendamento aparece na **Agenda** (`/agenda`) e a jornada completa é visível no **Cliente 360** (`/clientes`).

---

## 10. Onde Olhar Logs e Diagnosticar Falhas

1. **Painel Canais (`/canais?tab=canais`)**:
   - Exibe o último evento recebido, última mensagem enviada e diagnósticos técnicos.
2. **Histórico da Conversa (`/conversas`)**:
   - Se uma mensagem falhar, o status exibe `falhou` acompanhado do motivo retornado pela Meta (ex.: `131026: Message Undeliverable`).
3. **Auditoria Administrativa (`/master/atividade`)**:
   - Registra eventos de conexão, desconexão e recebimento de webhooks.
4. **Erros Comuns e Soluções**:
   - **403 Webhook**: Verifique se `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET` batem exatamente com as configurações do painel Meta.
   - **131030 (Payment issue)**: A conta da WABA precisa ter uma forma de pagamento cadastrada no Gerenciador de Negócios da Meta.
   - **Template Required**: Mensagens ativas fora da janela de 24 horas exigem templates aprovados na Meta.

---

## 11. Processamento em Segundo Plano e Fila de Retentativas

Para garantir a entrega resiliente de mensagens e campanhas mesmo em caso de instabilidades transitórias da Meta Cloud API:
- **Endpoint**: `GET /api/cron/whatsapp` ou `POST /api/cron/whatsapp`
- **Cabeçalho**: `Authorization: Bearer <CRON_SECRET>`
- **Agendamento**: a cada 1 ou 2 minutos via Vercel Cron, GitHub Actions ou agendador externo.
- As mensagens falhadas com erros transitórios (rate limits, 5xx, erros 131016/131021 da Meta) são reprocessadas com recuo exponencial (30s, 120s) e claim atômico via CAS.
