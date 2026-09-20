# Checklist de Configuração Externa e Homologação: Meta WhatsApp Cloud API

Este documento contém o roteiro passo a passo, preciso e auditado para Hernani configurar o aplicativo no painel do Meta for Developers, as variáveis de ambiente na Vercel e homologar a integração física de ponta a ponta com dois aparelhos celulares.

---

## 1. Variáveis de Ambiente no InstaLink (Vercel)

Configure na Vercel (aba **Settings → Environment Variables**) para o ambiente de Produção e Preview:

| Variável | Obrigatoriedade | Descrição | Onde obter / Como gerar |
| :--- | :--- | :--- | :--- |
| `META_APP_ID` | **Obrigatória** | Identificador público do App Meta | Painel Meta do App (topo da tela ou Configurações Básicas) |
| `META_CONFIG_ID` | **Obrigatória** | Identificador da Configuração do Facebook Login for Business | Painel Meta → Facebook Login for Business → Configurações |
| `META_APP_SECRET` | **Obrigatória** | Chave secreta do aplicativo Meta | Painel Meta → Configurações → Básica → Chave Secreta |
| `WHATSAPP_CREDENTIALS_KEY` | **Obrigatória** | Chave simétrica de 32 bytes (256-bit) para criptografia AES-256-GCM | Gerar no terminal: `openssl rand -hex 32` |
| `WHATSAPP_VERIFY_TOKEN` | **Obrigatória** | Token secreto para validação do handshake do Webhook | Gerar string segura (ex.: `ilk_webhook_live_` + `openssl rand -hex 16`) |
| `CRON_SECRET` | **Obrigatória** | Token de autenticação do worker de retentativas (`/api/cron/whatsapp`) | Gerar string segura (ex.: `ilk_cron_sec_` + `openssl rand -hex 16`) |
| `META_GRAPH_VERSION` | *Opcional* | Versão da Graph API (padrão do produto: `v26.0`) | Se omitido, o código adota `v26.0` (vigente e testada) |

> **Nota de Segurança:** Nenhum valor real deve ser comitado no Git ou compartilhado em chats públicos.

---

## 2. Passo a Passo no Painel Meta for Developers

### Passo 2.1 — Criação do Aplicativo Meta
1. Acesse [developers.facebook.com](https://developers.facebook.com/) logado na conta do Facebook do gestor ou administrador do Portfólio Empresarial.
2. Clique em **Criar Aplicativo**.
3. Selecione o caso de uso: **Outro** → Tipo de aplicativo: **Empresa** (Business App).
4. Nomeie o app (ex.: `InstaLink Atendimento Oficial`).
5. Vincule ao Gerenciador de Negócios (Business Portfolio) da empresa.

### Passo 2.2 — Adição e Configuração do Produto WhatsApp
1. No painel lateral esquerdo, clique em **Adicionar Produto** e selecione **WhatsApp**.
2. Vá em **WhatsApp → Configuração da API** (API Setup):
   - Note a WABA de teste e o número de teste fornecido pela Meta para testes iniciais de sandbox.
   - Para produção, adicione o número oficial da clínica e faça a verificação via código SMS/ligação.

### Passo 2.3 — Embedded Signup & Facebook Login for Business Configuration
1. No menu lateral, adicione/acesse **Facebook Login for Business** (Login do Facebook para Empresas).
2. Vá em **Configurações** (Configurations) e clique em **Criar Configuração** (ou use o Embedded Signup Builder):
   - Atribua um nome à configuração (ex.: `InstaLink Embedded Signup`).
   - Ativos solicitados: **Contas do WhatsApp Business (WABA)** e **Números de Telefone**.
   - Tipo de Token: **Token de Usuário do Sistema de Integração Empresarial (Business Integration System User token)** sem data de expiração.
   - Permissões obrigatórias selecionadas:
     - `whatsapp_business_management`
     - `whatsapp_business_messaging`
3. Salve a configuração e copie o **Configuration ID** gerado (preencher em `META_CONFIG_ID` na Vercel).

### Passo 2.4 — Domínios Permitidos e Redirecionamentos OAuth
1. Em **Configurações → Básica** do App Meta:
   - Adicione o domínio da aplicação em **Domínios do aplicativo** (App Domains): `app.instalink.app` (e o domínio de produção correspondente).
   - Preencha os links de **Política de Privacidade** e **Termos de Serviço**.
2. Em **Facebook Login for Business → Configurações**:
   - Ative **OAuth Web do cliente** (Client OAuth Login).
   - Em **URIs de redirecionamento do OAuth válidos**, adicione a URL da aplicação (ex.: `https://app.instalink.app/canais`, `https://app.instalink.app`).
   - Em **Domínios permitidos para o SDK do JavaScript**, adicione: `https://app.instalink.app`.

### Passo 2.5 — Configuração do Webhook Oficial
1. No menu do app, navegue até **WhatsApp → Configuração** (Configuration).
2. No bloco **Webhook**, clique em **Editar**:
   - **URL de Retorno de Chamada (Callback URL)**:
     `https://<seu-dominio-vercel>/api/whatsapp/webhook`
   - **Verificar Token (Verify Token)**:
     Insira exatamente o mesmo valor definido na variável `WHATSAPP_VERIFY_TOKEN`.
3. Clique em **Verificar e Salvar**. A Meta disparará uma requisição `GET` com o desafio (`hub.challenge`) que a rota `/api/whatsapp/webhook` valida e responde imediatamente.
4. Em **Campos do Webhook**, clique em **Gerenciar**:
   - Assine os seguintes campos:
     - `messages` (mensagens de texto, multimídia, entregas, confirmações de leitura e erros).
     - `smb_message_echoes` (necessário se utilizar o modo Coexistence para espelhar mensagens enviadas pelo app de celular).

### Passo 2.6 — Revisão do App e Modo de Produção
1. Enquanto em **Modo de Desenvolvimento**, apenas desenvolvedores/testadores do aplicativo e administradores do Business Manager podem enviar e receber mensagens pelo número de teste ou números adicionados à lista de destinatários permitidos.
2. Para liberar para qualquer número de cliente e permitir que clínicas façam o onboarding sem restrições:
   - Alterne o app da Meta de **Desenvolvimento** para **Ao Vivo** (Live / Produção).
   - Verifique a empresa (Business Verification) no Meta Business Suite.
   - Envie o aplicativo para Análise da Meta (App Review) solicitando as permissões `whatsapp_business_messaging` e `whatsapp_business_management` com gravação de tela simples demonstrando o uso no painel `/canais`.

---

## 3. Roteiro de Homologação com Dois Telefones Físicos

Para homologar a integração antes de liberar para clínicas reais, utilize dois aparelhos:
- **Aparelho 1 (Número da Clínica)**: Telefone oficial cadastrado na WABA e conectado ao InstaLink.
- **Aparelho 2 (Número do Cliente/Paciente)**: Telefone pessoal comum com WhatsApp Messenger.

### Cenário 1: Homologação Onboarding (Pelo Painel da Clínica)
1. Acesse o painel InstaLink na unidade de teste (`/canais?tab=canais`).
2. O card do WhatsApp deve exibir **WhatsApp não conectado** com o benefício claro e o botão **Conectar com a Meta**.
3. Clique em **Conectar com a Meta**:
   - O popup oficial da Meta abre.
   - Faça login com o Facebook do administrador da WABA.
   - Selecione a WABA e o número do Aparelho 1.
   - Se for Standard: informe o PIN de 6 dígitos de duas etapas quando solicitado.
   - Se for Coexistence: o sistema detecta `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` e dispensa PIN.
4. Conclusão:
   - O popup fecha. A requisição server-to-server conclui a troca do código por token, assina o webhook da WABA e criptografa a credencial.
   - O card atualiza para o estado verdadeiro **Conectado** (exibindo o número verificado e data de conexão).
   - Recarregue a página (F5): o estado permanece **Conectado** de forma consistente.

### Cenário 2: Homologação Inbound e Criação de Lead/Contato
1. No **Aparelho 2 (Cliente)**, envie uma mensagem para o número da clínica (Aparelho 1):
   `"Olá, gostaria de saber os horários disponíveis."`
2. No InstaLink:
   - Verifique em `/clientes`: o contato foi criado automaticamente com o nome do perfil e o número do cliente.
   - Verifique em `/funil`: um novo lead com origem `whatsapp` foi registrado na etapa `new`.
   - Verifique em `/conversas`: uma nova conversa aberta surgiu com a mensagem recebida.

### Cenário 3: Homologação do Agente e Agendamento com Confirmação
1. No **Aparelho 2 (Cliente)**, responda:
   `"Quero agendar uma Limpeza para segunda 10:00"`
2. O Concierge processa a intenção e disponibilidade real dos profissionais cadastrados:
   - O sistema **NÃO cria o agendamento de imediato**.
   - O agente responde solicitando confirmação explícita:
     `"Fechado assim: Limpeza Dental em segunda às 10:00. Confirma?"`
3. No **Aparelho 2 (Cliente)**, confirme:
   `"Sim, confirmo"`
4. Verificações no InstaLink:
   - O Booking oficial é criado atomicamente via `createBookingTx`.
   - O lead avança automaticamente para o estágio `scheduled` no CRM.
   - O agendamento aparece na **Agenda** (`/agenda`) com status e profissional associado.
   - O cliente recebe a confirmação imediata no WhatsApp:
     `"Agendado! Limpeza Dental em ... às 10:00 ..."`

### Cenário 4: Homologação de Proteção contra Double Booking
1. Imediatamente após o agendamento do Cenário 3, tente agendar o mesmo serviço e mesmo horário (segunda às 10:00) a partir de outro contato ou pelo painel público `/agendar`.
2. O sistema deve recusar o horário (409 Conflict) e oferecer apenas os horários livres remanescentes.

### Cenário 5: Homologação de Handoff Humano
1. No **Aparelho 2 (Cliente)**, envie:
   `"Quero falar com um atendente humano"`
2. O agente responde com a mensagem de transferência:
   `"Vou transferir seu atendimento para a nossa equipe. Um atendente já vai te responder por aqui!"`
3. O modo da conversa em `/conversas` muda de `automation` para `human`.
4. Envie novas mensagens pelo celular: o robô não responde mais.
5. Pelo painel do InstaLink em `/conversas`, o atendente da clínica digita uma resposta e envia:
   - A mensagem chega no celular do cliente com status `sent` e `delivered`.
6. O operador clica para retornar ao modo `automation` quando o atendimento manual for finalizado.

### Cenário 6: Homologação de Retentativas e Outbox
1. Acesse o endpoint de cron autenticado:
   ```bash
   curl -X POST https://<seu-dominio-vercel>/api/cron/whatsapp \
     -H "Authorization: Bearer <SEU_CRON_SECRET>"
   ```
2. Resposta esperada: `200 OK` com payload JSON contendo o resumo de retentativas (`messagesProcessed`, `messagesSent`, `ranAt`, `durationMs`).
3. Uma chamada sem o header ou com segredo inválido deve retornar `401 Unauthorized` ou `503 Service Unavailable`.
