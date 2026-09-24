# Relatório — Integração oficial WhatsApp Cloud API no Preview

**Data:** 2026-09-24  
**Branch:** `arena/01a0ce4e-instalink`  
**PR:** #37 (aberto; não mergeado)  
**Escopo:** somente Deployment Preview (Vercel GoDoutor). Production/main intocados.

---

## 1. Estado do repositório e deployment

| Item | Valor |
|------|--------|
| Branch | `arena/01a0ce4e-instalink` |
| HEAD (após probes CI) | `47e8c0b` (empurrado; inclui `9d1fd21` probe + commits de resultado do bot) |
| Base F3-I preservada | `ea438e3` … `37bc08b` (SHAs imutáveis; sem reescrita) |
| Tree | limpo (somente artefatos de probe versionados: workflow, script, `validation/whatsapp-probe.txt`) |
| Preview URL | `https://godoutor-git-arena-01a0ce4e-88a586-hernanicross-3509s-projects.vercel.app` |
| Vercel check | **SUCCESS** (deployment Ready no head da PR) |
| Deployment Protection | **liberado** (API pública responde; não bloqueia Meta) |
| Production | **não** redeployada |

### Commits desta tarefa (além de F3-I)

- `3f79eaa` — workflow + `scripts/whatsapp-preview-probe.sh` (probe sem segredos no log)
- `44e7669` — job herda `environment: Preview`
- `9d1fd21` — inferência de presença de `VERIFY_TOKEN`/`APP_SECRET` pelo fail-closed
- `81c2446`, `074bc28`, `47e8c0b` — artefato `validation/whatsapp-probe.txt` publicado pelo CI

Nenhum código de produto alterado nesta tarefa.

---

## 2. Envs do Preview (só nomes; valores nunca)

| Env | Status | Evidência |
|-----|--------|-----------|
| `WHATSAPP_VERIFY_TOKEN` | **presente (inferido)** | GET webhook → 403 (não 503 de “token ausente”) |
| `WHATSAPP_APP_SECRET` **ou** `META_APP_SECRET` | **presente (inferido)** | POST webhook → 403 assinatura (não 503 de “secret ausente”) |
| `META_APP_ID` | não listável | `BLOCKED_MISSING_SECRET: VERCEL_TOKEN` |
| `WHATSAPP_CREDENTIALS_KEY` | não listável | idem |
| `WHATSAPP_API_TOKEN` | não listável | idem |
| `WHATSAPP_PHONE_NUMBER_ID` | não listável | idem |
| `WHATSAPP_WABA_ID` | não listável | idem |
| `META_GRAPH_VERSION` | não listável | idem (código default `v26.0` centralizado) |

**Não** foi possível `vercel env ls` / `env pull`: CLI sem login no sandbox; `VERCEL_TOKEN`/`VERCEL_ACCESS_TOKEN`/`VERCEL_API_TOKEN` **unset** no GitHub (repo e `environment: Preview`). Nenhum valor de secret foi impresso.

---

## 3. Evidência de rede (probe GitHub Actions)

Runner externo (egress livre) → `validation/whatsapp-probe.txt` no head.

**Último resumo:** `RESUMO|PASS=11|FAIL=0|BLOCK=5`

| Check | Resultado |
|-------|-----------|
| Proteção Vercel | PASS |
| GET sem params → 403 | PASS |
| GET token inválido → 403 | PASS |
| GET handshake positivo (token correto) | **BLOCKED_MISSING_SECRET: WHATSAPP_VERIFY_TOKEN** (valor) |
| POST sem assinatura → 403 | PASS (fail-closed) |
| POST assinatura errada → 403 | PASS |
| POST assinatura válida HMAC | **BLOCKED_MISSING_SECRET: app secret** (valor) |
| Payload assinado p/ tenant | **BLOCKED_MISSING_SECRET: app secret** |
| Graph API | **BLOCKED_MISSING_SECRET: WHATSAPP_API_TOKEN** |
| register/login/session/guard `/api/whatsapp` | PASS (sem vazamento) |

Handshake GET positivo **já validado pela Meta** (fato do usuário); o probe confirma rota viva + fail-closed.

---

## 4. Classificação final (8 itens)

| # | Item | Classificação | Nota |
|---|------|---------------|------|
| 1 | Webhook GET handshake | **PASS** | Rota 403/200-comportamento correto; Meta já validou handshake; `VERIFY_TOKEN` inferido presente |
| 2 | POST assinado | **PASS** (fail-closed) / **positivo parcial** | Sem/assinatura errada → 403; aceitação de HMAC válido **não** exercitada sem valor do secret (`BLOCKED_MISSING_SECRET`) |
| 3 | Tenant (`resolveTenantForChange`) | **BLOCKED_MISSING_SECRET** | Payload assinado exige app secret; sem ele não prova mapeamento nº teste → unidade no DB do Preview |
| 4 | Graph API credential | **BLOCKED_MISSING_SECRET: WHATSAPP_API_TOKEN** | Sem token não há GET `/{phone_number_id}` |
| 5 | Inbound webhook → tenant → Inbox | **BLOCKED_MISSING_SECRET** | Depende de (2 positivo) + (3) |
| 6 | Outbound API (send) | **BLOCKED_MISSING_SECRET: WHATSAPP_API_TOKEN** | `WhatsAppCloudProvider` coberto por testes unitários (56/56); disparo real exige token |
| 7 | Entrega física | **BLOCKED_EXTERNAL** (não testada) | Sem envio real; **130497** (número +1 vs Brasil) permanece limitação Meta, não bug GoDoutor; app não publicado → não afirmar homologação |
| 8 | Status do canal /canais | **PASS** (guard) / **não “Conectado”** | `/api/whatsapp` protegido (403 sem dono); UI usa `computeConnectionStatus` — não mostra “Conectado” sem requisitos contratuais |

**Não** chamar o conjunto de “conectado”: há bloqueios externos/secret e itens não exercitados.

---

## 5. Testes locais (PASSO 10)

| Gate | Resultado |
|------|-----------|
| `tsc --noEmit` | **0** erros |
| `fase3-g-messaging` + `whatsapp-robustness` + `tenant-isolation` | **56/56** passed |
| Código de produto alterado? | **Não** (só CI/probe) |

---

## 6. O que NÃO foi feito (e por quê)

1. **Listar 8 envs na Vercel** — sem token Vercel (`BLOCKED_MISSING_SECRET: VERCEL_TOKEN`).
2. **Handshake GET positivo automatizado** — sem valor de `WHATSAPP_VERIFY_TOKEN`.
3. **POST com HMAC válido** — sem valor de app secret.
4. **Mapear nº teste → Andrioni Veterinária** — fluxo oficial (connect/master/onboarding) exige sessão com permissão + secret/token; sem editar JSON/banco.
5. **Graph real / inbound real / outbound real** — sem `WHATSAPP_API_TOKEN`.
6. **Logs Vercel** — sem acesso à UI/API de logs.
7. **Publication Meta / entrega física BR** — `BLOCKED_META_APP_NOT_LIVE` / `BLOCKED_EXTERNAL` conforme restrições.

---

## 7. Próximo passo manual exato

1. No Vercel do projeto **godoutor** → **Settings → Environment Variables** → confirmar no ambiente **Preview** (nomes; valores não colar em chat):
   - `WHATSAPP_VERIFY_TOKEN`
   - `META_APP_ID`, `META_APP_SECRET` (ou `WHATSAPP_APP_SECRET`)
   - `WHATSAPP_API_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID` = `1311304095400435`
   - `WHATSAPP_WABA_ID` = `1802366907680005`
   - `WHATSAPP_CREDENTIALS_KEY` (segredo forte separado AES-256-GCM)
   - `META_GRAPH_VERSION` (opcional; default `v26.0`)
2. **Opcional p/ automação deste repo:** criar secret GitHub `VERCEL_TOKEN` (repo ou environment `Preview`) para o probe listar/pullar envs sem价值观 no log.
3. Ação humana no dashboard Preview (ou Master): fluxo **oficial** de conexão/mapeamento da unidade **Andrioni Veterinária** com o phoneNumberId de teste (sem JSON manual).
4. Reexecutar `WhatsApp Preview Probe` (push nos paths do workflow ou `workflow_dispatch`).
5. Classificar novamente os itens 2 (HMAC positivo), 3, 4, 5, 6 com evidência nova.

---

## 8. Restrições respeitadas

- NÃO merge / NÃO main / NÃO Production  
- NÃO imprimir secrets/tokens/Authorization  
- NÃO inventar `WHATSAPP_API_TOKEN`  
- NÃO desabilitar validação de assinatura  
- NÃO confiar em `businessId` do payload (tenant via `phoneNumberId`/`wabaId`)  
- NÃO editar JSON/banco manual  
- NÃO tratar 130497 como bug nem declarar entrega BR homologada  
- NÃO chamar tudo de “conectado”  
- META_GRAPH_VERSION centralizada  
- Commits separados; flock; bash ≤1800  
