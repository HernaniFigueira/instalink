#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# PROBE WhatsApp Cloud API no PREVIEW — sem imprimir segredos.
# Saída: linhas "CHECK|<item>|PASS|FAIL|BLOCKED_*|INFO|detalhe"
# NUNCA echo de tokens, Authorization, App Secret, Verify Token.
# ═══════════════════════════════════════════════════════════════
set -u
BASE="${BASE_URL%/}"
[ -z "$BASE" ] && { echo 'BASE_URL vazia'; exit 1; }
PASSN=0; FAILN=0; BLOCKN=0
say() { # say <item> <PASS|FAIL|BLOCKED_*|INFO> <detalhe>
  case "$2" in
    PASS) PASSN=$((PASSN+1)) ;;
    FAIL) FAILN=$((FAILN+1)) ;;
    BLOCKED_*) BLOCKN=$((BLOCKN+1)) ;;
  esac
  echo "CHECK|$1|$2|$3"
}
jqget() { printf '%s' "$1" | jq -r "$2 // empty" 2>/dev/null; }
mask() {
  local v="${1:-}"
  [ -z "$v" ] && { echo ''; return; }
  local n=${#v}
  [ "$n" -le 4 ] && { echo '••••'; return; }
  echo "••••${v: -4}"
}

# ── Preflight: Deployment Protection ──
HCODE=$(curl -sS -m 30 -o /tmp/preflight.json -w '%{http_code}' \
  -X POST -H 'content-type: application/json' -d '{}' \
  "$BASE/api/auth/register" 2>/tmp/preflight.err || echo 000)
PB=$(head -c 300 /tmp/preflight.json 2>/dev/null || true)
if printf '%s' "$PB" | grep -qE 'vercel_auth_callback|Protected deployment'; then
  say 0-protecao FAIL "Vercel Authentication ativo no Preview — liberar para Meta (Deployment Protection)"
  echo "RESUMO|PASS=$PASSN|FAIL=$FAILN|BLOCK=$BLOCKN"
  exit 0
fi
say 0-protecao PASS "Deployment Protection liberado p/ acesso público (HTTP $HCODE)"

# ── Health / deployment ──
HEALTH=$(curl -sS -m 30 "$BASE/api/health" 2>/dev/null || echo '{}')
COMMIT=$(jqget "$HEALTH" '.commit')
PERS=$(jqget "$HEALTH" '.persistence')
say 0a-health INFO "commit=${COMMIT:-sem-campo} persistence=${PERS:-?} sha_run=${GITHUB_SHA:-local}"

# ── Env presence via Vercel (só NOMES; valores nunca no log) ──
ENV_FILE="/tmp/vercel-preview.env"
VERCEL_TOKEN="${VERCEL_TOKEN:-${VERCEL_ACCESS_TOKEN:-}}"
FOUND_LIST=""
API_KEYS=""
if [ -n "$VERCEL_TOKEN" ]; then
  # API de projeto: lista NOMES (sem valores)
  PROJ_JSON=$(curl -sS -m 30 -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v9/projects/godoutor/env" 2>/dev/null || echo '{}')
  if ! printf '%s' "$PROJ_JSON" | jq -e '.envs' >/dev/null 2>&1; then
    PROJ_JSON=$(curl -sS -m 30 -H "Authorization: Bearer $VERCEL_TOKEN" \
      "https://api.vercel.com/v9/projects/godoutor/env?teamId=hernanicross-3509s-projects" 2>/dev/null || echo '{}')
  fi
  API_KEYS=$(printf '%s' "$PROJ_JSON" | jq -r '.envs[]?.key' 2>/dev/null | sort -u)
  for k in WHATSAPP_VERIFY_TOKEN META_APP_ID META_APP_SECRET WHATSAPP_APP_SECRET \
           WHATSAPP_CREDENTIALS_KEY WHATSAPP_API_TOKEN WHATSAPP_PHONE_NUMBER_ID \
           WHATSAPP_WABA_ID META_GRAPH_VERSION; do
    if printf '%s\n' "$API_KEYS" | grep -qx "$k"; then
      say "1-env-$k" PASS "presente no projeto Vercel (nome listado; valor não exibido)"
      FOUND_LIST="$FOUND_LIST $k "
    fi
  done
  # pull valores em arquivo local p/ testes (nunca logar)
  npx --yes vercel env pull --environment=preview --yes --token="$VERCEL_TOKEN" \
    "$ENV_FILE" >/tmp/vercel-pull.log 2>&1 || true
  if [ -f "$ENV_FILE" ]; then
    for k in WHATSAPP_VERIFY_TOKEN META_APP_ID META_APP_SECRET WHATSAPP_APP_SECRET \
             WHATSAPP_CREDENTIALS_KEY WHATSAPP_API_TOKEN WHATSAPP_PHONE_NUMBER_ID \
             WHATSAPP_WABA_ID META_GRAPH_VERSION; do
      case "$FOUND_LIST" in
        *" $k "*) continue ;;
      esac
      if grep -qE "^${k}=" "$ENV_FILE" 2>/dev/null; then
        val=$(grep -E "^${k}=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r' | head -c 1)
        if [ -n "$val" ]; then say "1-env-$k" PASS "presente no Preview pull (valor não exibido)"
        else say "1-env-$k" FAIL "chave existe mas VAZIA no Preview"; fi
        FOUND_LIST="$FOUND_LIST $k "
      else
        say "1-env-$k" BLOCKED_MISSING_SECRET "$k ausente no Preview"
      fi
    done
    if grep -qE '^(WHATSAPP_APP_SECRET|META_APP_SECRET)=' "$ENV_FILE" 2>/dev/null; then
      say 1-env-app-secret PASS "APP secret disponível (WHATSAPP_APP_SECRET ou META_APP_SECRET)"
    else
      say 1-env-app-secret BLOCKED_MISSING_SECRET "WHATSAPP_APP_SECRET / META_APP_SECRET"
    fi
  else
    for k in WHATSAPP_VERIFY_TOKEN META_APP_ID META_APP_SECRET WHATSAPP_APP_SECRET \
             WHATSAPP_CREDENTIALS_KEY WHATSAPP_API_TOKEN WHATSAPP_PHONE_NUMBER_ID \
             WHATSAPP_WABA_ID META_GRAPH_VERSION; do
      case "$FOUND_LIST" in
        *" $k "*) continue ;;
      esac
      say "1-env-$k" BLOCKED_MISSING_SECRET "$k (API listou só: $(printf '%s' "$API_KEYS" | tr '\n' ' ' | head -c 180))"
    done
    say 1-vercel-pull BLOCKED_MISSING_SECRET "vercel env pull falhou (log=$(head -c 120 /tmp/vercel-pull.log 2>/dev/null))"
  fi
else
  say 1-vercel-env BLOCKED_MISSING_SECRET "VERCEL_TOKEN (sem acesso à lista de envs do Preview)"
fi

# Load envs from file WITHOUT echoing
V_TOKEN=''; V_PHONE=''; V_WABA=''; V_APPSEC=''; V_GRAPHV=''; V_APPID=''; V_CREDKEY=''; V_VERIFY=''
if [ -f "$ENV_FILE" ]; then
  getv() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" | tr -d '\r'; }
  V_TOKEN=$(getv WHATSAPP_API_TOKEN || true)
  V_PHONE=$(getv WHATSAPP_PHONE_NUMBER_ID || true)
  V_WABA=$(getv WHATSAPP_WABA_ID || true)
  V_APPSEC=$(getv WHATSAPP_APP_SECRET || true)
  [ -z "$V_APPSEC" ] && V_APPSEC=$(getv META_APP_SECRET || true)
  V_GRAPHV=$(getv META_GRAPH_VERSION || true)
  V_APPID=$(getv META_APP_ID || true)
  V_CREDKEY=$(getv WHATSAPP_CREDENTIALS_KEY || true)
  V_VERIFY=$(getv WHATSAPP_VERIFY_TOKEN || true)
fi
[ -z "$V_GRAPHV" ] && V_GRAPHV='v26.0'

# ── 1) Webhook GET handshake ──
G1=$(curl -sS -m 30 -o /tmp/wh_g1.json -w '%{http_code}' "$BASE/api/whatsapp/webhook" || echo 000)
G1B=$(head -c 250 /tmp/wh_g1.json 2>/dev/null || true)
if [ "$G1" = "403" ]; then
  say 4-get-rota PASS "GET sem params → 403 (rota pública; corpo=Verificação inválida)"
  # 403 (e não 503) ⇒ WHATSAPP_VERIFY_TOKEN presente no servidor (fail-closed do GET)
  say 1-env-infer-WHATSAPP_VERIFY_TOKEN PASS "inferido presente (GET não retornou 503 de token ausente)"
elif [ "$G1" = "503" ]; then
  say 4-get-rota FAIL "GET → 503 WHATSAPP_VERIFY_TOKEN ausente no servidor"
  say 1-env-infer-WHATSAPP_VERIFY_TOKEN BLOCKED_MISSING_SECRET "WHATSAPP_VERIFY_TOKEN"
else
  say 4-get-rota FAIL "GET sem params → $G1 corpo=$(printf '%s' "$G1B" | head -c 120)"
fi

G2=$(curl -sS -m 30 -o /tmp/wh_g2.json -w '%{http_code}' \
  "$BASE/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=probe-invalid-$$&hub.challenge=chprobe123" || echo 000)
if [ "$G2" = "403" ]; then
  say 4-get-token-errado PASS "GET token inválido → 403"
else
  say 4-get-token-errado FAIL "GET token inválido → $G2"
fi

if [ -n "$V_VERIFY" ]; then
  G3=$(curl -sS -m 30 -o /tmp/wh_g3.body -w '%{http_code}' \
    "$BASE/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${V_VERIFY}&hub.challenge=chprobeOK42" || echo 000)
  G3B=$(head -c 80 /tmp/wh_g3.body 2>/dev/null || true)
  if [ "$G3" = "200" ] && printf '%s' "$G3B" | grep -q 'chprobeOK42'; then
    say 4-get-handshake PASS "GET verify_token correto → 200 challenge text/plain (valor token não logado)"
  else
    say 4-get-handshake FAIL "GET verify_token correto → $G3 corpo=$(printf '%s' "$G3B" | head -c 80)"
  fi
else
  say 4-get-handshake BLOCKED_MISSING_SECRET "WHATSAPP_VERIFY_TOKEN (não obtido p/ handshake positivo)"
fi

# ── 2) Webhook POST assinatura ──
BODY='{"entry":[{"id":"probe-waba","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"5511999990000","phone_number_id":"probe-phone"},"statuses":[]}}]}]}'
P1=$(curl -sS -m 30 -o /tmp/wh_p1.json -w '%{http_code}' \
  -X POST -H 'content-type: application/json' -d "$BODY" \
  "$BASE/api/whatsapp/webhook" || echo 000)
P1B=$(head -c 250 /tmp/wh_p1.json 2>/dev/null || true)
if [ "$P1" = "403" ]; then
  say 4-post-sem-assinatura PASS "POST sem X-Hub-Signature-256 → 403 assinatura inválida (fail-closed)"
  # 403 (e não 503) ⇒ WHATSAPP_APP_SECRET ou META_APP_SECRET presente
  say 1-env-infer-APP_SECRET PASS "inferido presente (POST não retornou 503 de secret ausente)"
elif [ "$P1" = "503" ]; then
  say 4-post-sem-assinatura FAIL "POST → 503 APP secret ausente no servidor (fail-closed sem secret)"
  say 1-env-infer-APP_SECRET BLOCKED_MISSING_SECRET "WHATSAPP_APP_SECRET / META_APP_SECRET"
else
  say 4-post-sem-assinatura FAIL "POST sem assinatura → $P1 corpo=$(printf '%s' "$P1B" | head -c 140)"
fi

P2=$(curl -sS -m 30 -o /tmp/wh_p2.json -w '%{http_code}' \
  -X POST -H 'content-type: application/json' \
  -H 'X-Hub-Signature-256: sha256=0000000000000000000000000000000000000000000000000000000000000000' \
  -d "$BODY" \
  "$BASE/api/whatsapp/webhook" || echo 000)
P2B=$(head -c 250 /tmp/wh_p2.json 2>/dev/null || true)
if [ "$P2" = "403" ]; then
  say 4-post-assinatura-invalida PASS "POST assinatura errada → 403"
else
  say 4-post-assinatura-invalida FAIL "POST assinatura errada → $P2 corpo=$(printf '%s' "$P2B" | head -c 140)"
fi

if [ -n "$V_APPSEC" ]; then
  SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$V_APPSEC" -hex | awk '{print $NF}')
  P3=$(curl -sS -m 30 -o /tmp/wh_p3.json -w '%{http_code}' \
    -X POST -H 'content-type: application/json' \
    -H "X-Hub-Signature-256: sha256=$SIG" \
    -d "$BODY" \
    "$BASE/api/whatsapp/webhook" || echo 000)
  P3B=$(head -c 300 /tmp/wh_p3.json 2>/dev/null || true)
  if [ "$P3" = "200" ]; then
    say 4-post-assinatura-valida PASS "POST assinatura válida → 200 (corpo=$(printf '%s' "$P3B" | head -c 120))"
  else
    say 4-post-assinatura-valida FAIL "POST assinatura válida → $P3 corpo=$(printf '%s' "$P3B" | head -c 140)"
  fi
else
  say 4-post-assinatura-valida BLOCKED_MISSING_SECRET "APP secret para assinar POST (HMAC)"
fi

# ── 3) Payload assinado com phoneNumberId do teste → tenant ──
PHONE_ID="${TEST_PHONE_NUMBER_ID:-1311304095400435}"
WABA_ID="${TEST_WABA_ID:-1802366907680005}"
TS=$(date +%s)
INBOUND_ID="wamid.probe.${TS}"
TENANT_BODY=$(printf '%s' "{\"entry\":[{\"id\":\"${WABA_ID}\",\"changes\":[{\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"display_phone_number\":\"5511999990000\",\"phone_number_id\":\"${PHONE_ID}\"},\"contacts\":[{\"wa_id\":\"5511888887777\",\"profile\":{\"name\":\"Probe Tenant\"}}],\"messages\":[{\"from\":\"5511888887777\",\"id\":\"${INBOUND_ID}\",\"timestamp\":\"${TS}\",\"type\":\"text\",\"text\":{\"body\":\"probe-tenant-${TS}\"}}]}}]}]}")
if [ -n "$V_APPSEC" ]; then
  SIG=$(printf '%s' "$TENANT_BODY" | openssl dgst -sha256 -hmac "$V_APPSEC" -hex | awk '{print $NF}')
  P4=$(curl -sS -m 45 -o /tmp/wh_p4.json -w '%{http_code}' \
    -X POST -H 'content-type: application/json' \
    -H "X-Hub-Signature-256: sha256=$SIG" \
    -d "$TENANT_BODY" \
    "$BASE/api/whatsapp/webhook" || echo 000)
  P4B=$(head -c 300 /tmp/wh_p4.json 2>/dev/null || true)
  RECEIVED=$(jqget "$P4B" '.received')
  MAPPED=$(jqget "$P4B" '.mapped')
  if [ "$P4" != "200" ]; then
    say 3-tenant-payload FAIL "POST payload assinado → $P4 corpo=$(printf '%s' "$P4B" | head -c 140)"
  elif [ "$MAPPED" = "true" ] || [ "${RECEIVED:-0}" != "0" ]; then
    say 3-tenant-payload PASS "resolveTenantForChange UMA unidade (received=${RECEIVED}, mapped=${MAPPED}, phoneId=$(mask "$PHONE_ID"))"
  else
    say 3-tenant-payload FAIL "payload aceito mas TENANT NÃO MAPEADO (received=${RECEIVED:-0}, mapped=${MAPPED:-false}) — nº de teste sem unidade no DB do Preview"
  fi
else
  say 3-tenant-payload BLOCKED_MISSING_SECRET "APP secret para payload assinado de tenant"
fi

# ── 6) Graph API credential (sem logar Authorization) ──
if [ -n "$V_TOKEN" ]; then
  PID="${V_PHONE:-$PHONE_ID}"
  CODE=$(curl -sS -m 30 -o /tmp/graph.json -w '%{http_code}' \
    -H "Authorization: Bearer $V_TOKEN" \
    "https://graph.facebook.com/${V_GRAPHV}/${PID}?fields=verified_name,display_phone_number,quality_rating,code_verification_status" \
    || echo 000)
  if [ "$CODE" = "200" ]; then
    VN=$(jqget "$(cat /tmp/graph.json)" '.verified_name')
    DP=$(jqget "$(cat /tmp/graph.json)" '.display_phone_number')
    QR=$(jqget "$(cat /tmp/graph.json)" '.quality_rating')
    CV=$(jqget "$(cat /tmp/graph.json)" '.code_verification_status')
    say 6-graph-credential PASS "Graph 200 verified_name=${VN} display=${DP} quality=${QR} verification=${CV} (token não logado)"
  elif [ "$CODE" = "401" ]; then
    say 6-graph-credential FAIL "Graph 401 token inválido/expirado (Authorization não logado)"
  else
    say 6-graph-credential FAIL "Graph → $CODE corpo=$(head -c 160 /tmp/graph.json 2>/dev/null)"
  fi
else
  say 6-graph-credential BLOCKED_MISSING_SECRET "WHATSAPP_API_TOKEN e/ou WHATSAPP_PHONE_NUMBER_ID"
fi

# ── 9) Sessão sonda + guarda de rota ──
SEMAIL="wa-probe-$$-$TS@godoutor.test"
SPASS='Valida1234'
R1=$(curl -sS -m 45 -o /tmp/reg.json -w '%{http_code}' \
  -X POST -H 'content-type: application/json' \
  -d "{\"name\":\"WA Probe\",\"email\":\"$SEMAIL\",\"password\":\"$SPASS\"}" \
  "$BASE/api/auth/register" || echo 000)
R1B=$(head -c 200 /tmp/reg.json 2>/dev/null || true)
if [ "$R1" = "200" ]; then
  say 9a-register PASS "register sonda 200"
elif [ "$R1" = "429" ]; then
  say 9a-register INFO "register 429 anti-abuso (ok p/ probe)"
else
  say 9a-register FAIL "register → $R1 corpo=$(printf '%s' "$R1B" | head -c 120)"
fi
L1=$(curl -sS -m 45 -o /tmp/login.json -w '%{http_code}' \
  -X POST -H 'content-type: application/json' \
  -d "{\"email\":\"$SEMAIL\",\"password\":\"$SPASS\"}" \
  "$BASE/api/auth/login" || echo 000)
TOKEN=$(jqget "$(cat /tmp/login.json 2>/dev/null)" '.token')
if [ "$L1" = "200" ] && [ -n "$TOKEN" ]; then
  say 9b-login PASS "login sonda 200 (token não logado)"
else
  say 9b-login FAIL "login → $L1"
  TOKEN=''
fi

if [ -n "$TOKEN" ]; then
  ME=$(curl -sS -m 30 -o /tmp/me.json -w '%{http_code}' -H "authorization: Bearer $TOKEN" "$BASE/api/auth/me" || echo 000)
  [ "$ME" = "200" ] && say 9c-session PASS "auth/me 200" || say 9c-session FAIL "auth/me → $ME"
fi

if [ -n "$TOKEN" ]; then
  WQ=$(curl -sS -m 30 -o /tmp/wa.json -w '%{http_code}' \
    -H "authorization: Bearer $TOKEN" \
    "$BASE/api/whatsapp?businessId=probe-nonexistent" || echo 000)
  WQB=$(head -c 200 /tmp/wa.json 2>/dev/null || true)
  if [ "$WQ" = "401" ] || [ "$WQ" = "403" ] || [ "$WQ" = "404" ]; then
    say 9d-whatsapp-guard PASS "/api/whatsapp sem dono → $WQ (sem vazamento)"
  elif [ "$WQ" = "200" ]; then
    if printf '%s' "$WQB" | grep -qiE 'unauthorized|não autorizado|sessão|acesso|encontrada'; then
      say 9d-whatsapp-guard PASS "/api/whatsapp 200 com recusa explícita de acesso"
    else
      say 9d-whatsapp-guard FAIL "/api/whatsapp 200 inesperado corpo=$(printf '%s' "$WQB" | head -c 120)"
    fi
  else
    say 9d-whatsapp-guard FAIL "/api/whatsapp → $WQ"
  fi
fi

echo "RESUMO|PASS=$PASSN|FAIL=$FAILN|BLOCK=$BLOCKN"
exit 0
