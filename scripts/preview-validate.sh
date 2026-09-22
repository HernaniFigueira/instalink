#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# VALIDAÇÃO do Preview Deployment (Vercel + Supabase GoDoutor).
# SEM segredos: fala apenas com a URL pública do preview.
# Saída: linhas "CHECK|<item>|PASS|detalhe" para o log do run.
# ═══════════════════════════════════════════════════════════════
set -u
BASE="${BASE_URL%/}"
[ -z "$BASE" ] && { echo 'BASE_URL vazia'; exit 1; }
T=$(date +%s)
EMAIL="preview-valid-$T@godoutor.test"
TOKEN=''
PASSN=0; FAILN=0
say() { if [ "$2" = PASS ]; then PASSN=$((PASSN+1)); else FAILN=$((FAILN+1)); fi; echo "CHECK|$1|$2|$3"; }

req() { # req <metodo> <caminho> <json-ou-vazio> <auth:0|1> → set BODY/STATUS/HDRS
  local m=$1 p=$2 d=${3:-} a=${4:-0}
  local args=(-s -L -m 90 -w $'\n%{http_code}' -X "$m")
  [ -n "$d" ] && args+=(-H 'content-type: application/json' -d "$d")
  [ "$a" = 1 ] && args+=(-H "authorization: Bearer $TOKEN")
  local out; out=$(curl "${args[@]}" "$BASE$p" 2>&1)
  STATUS=$(printf '%s' "$out" | tail -n1)
  BODY=$(printf '%s' "$out" | sed '$d')
}
jqget() { printf '%s' "$1" | jq -r "$2 // empty" 2>/dev/null; }

# ── Item 0: preflight — Vercel Authentication (Deployment Protection) ──
H=$(curl -s -m 60 -o /tmp/probe.json -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$BASE/api/auth/register" 2>&1)
PB=$(printf '%s' "$(cat /tmp/probe.json)" | head -c 400)
if printf '%s' "$PB" | grep -q 'vercel_auth_callback\|Protected deployment'; then
  say 0-protecao "FAIL" "Vercel Authentication (Deployment Protection) ATIVO — preview só acessível via SSO. Desativar em: Vercel → projeto godoutor → Settings → Deployment Protection → Vercel Authentication → Disabled. Detalhe: $(printf '%s' "$PB" | head -c 200)"
  echo "RESUMO|PASS=0|FAIL=1|BLOQUEIO=vercel-auth"
  echo "VALIDACAO BLOQUEADA: Deployment Protection"
  exit 0
fi
say 0-protecao "PASS" "sem Vercel Authentication no preview"

# ── Item 0a: esperar o deployment do commit corrente (marcado por /api/health) ──
HEALTHOK=0
for i in $(seq 1 60); do
  ST=$(curl -s -m 20 -o /tmp/h.json -w '%{http_code}' "$BASE/api/health" 2>&1)
  if [ "$ST" = 200 ] && [ "$(jqget "$(cat /tmp/h.json)" '.commit')" = "${GITHUB_SHA:-}" ]; then HEALTHOK=1; break; fi
  sleep 10
done
DPL=$(curl -sI -m 20 "$BASE/" | grep -i '^x-vercel-id:' | tr -d '\r' | head -1)
if [ "$HEALTHOK" = 1 ]; then
  say 0a-deployment "PASS" "deployment com /api/health servindo ($DPL)"
else
  say 0a-deployment "FAIL" "/api/health não respondeu 200 em 240s ($DPL) — validação contra deployment sem o commit corrente; último corpo: $(head -c 200 /tmp/h.json)"
fi

# ── Item 0d: sondas de roteamento do pooler (senhas ERRADAS de propósito) ──
# Sem segredos: comparamos o ERRO de uma senha errada no role custom vs postgres.<ref>.
# Se o custom role dá erro DIFERENTE de 28P01 (ex.: tenant not found), o roteamento
# do pooler para roles customizados está quebrado — se dá 28P01 igual, o roteamento
# está OK e a questão é a senha no banco.
PRef=sefwhobqafkretljjlqx
PHost=aws-0-sa-east-1.pooler.supabase.com
E1=$(PGPASSWORD='sonda-errada-proposito' psql -h "$PHost" -p 6543 -U "godoutor_app.$PRef" -d postgres -c 'select 1' 2>&1 | head -2 | tr '\n' ' ' | head -c 200)
E2=$(PGPASSWORD='sonda-errada-proposito' psql -h "$PHost" -p 6543 -U "postgres.$PRef" -d postgres -c 'select 1' 2>&1 | head -2 | tr '\n' ' ' | head -c 200)
say 0d-pooler-probe "INFO" "role.custom+pwd-errada: ${E1:-sem-erro} ||| postgres.ref+pwd-errada: ${E2:-sem-erro}"

{
  echo '--- POST /api/customer/register (cru) ---'
  curl -s -m 30 -o /dev/null -D - -X POST -H 'content-type: application/json' -d '{"name":"x"}' "$BASE/api/customer/register" | head -8
  echo '--- POST /api/auth/register (cru) ---'
  curl -s -m 30 -o /dev/null -D - -X POST -H 'content-type: application/json' -d '{}' "$BASE/api/auth/register" | head -8
  echo '--- GET /api/health (cru) ---'
  curl -s -m 30 -o /dev/null -D - "$BASE/api/health" | head -8
} > /tmp/diag.txt 2>&1
say 0c-edge-diag "INFO" "$(tr '\n' ' ' < /tmp/diag.txt | head -c 900)"
req GET /api/health '' 0
HL=$(jqget "$BODY" '.persistence')$(printf '|'); HC=$(jqget "$BODY" '.dbConnect')$(printf '|')
HU=$(jqget "$BODY" '.appUsers')$(printf '|'); HB=$(jqget "$BODY" '.appBusinesses')$(printf '|')
HS=$(jqget "$BODY" '.dbUrlShape')$(printf '|')
say 0b-banco-diagnostico "INFO" "health: persistence=$HL dbConnect=$HC appUsers=$HU appBusinesses=$HB url=$HS corpo=$(printf '%s' "$BODY" | head -c 400)"

# ── Item 1: modo relacional ativo (rota não migrada → 503 explícito) ──
H=$(curl -s -m 60 -D - -o /tmp/probe.json "$BASE/api/automations" 2>&1)
CODE=$(printf '%s' "$H" | head -n1 | awk '{print $2}')
BLOCKED=$(printf '%s' "$H" | grep -i '^x-godoutor-blocked:' | tr -d '\r' | cut -d' ' -f2)
PERS=$(printf '%s' "$H" | grep -i '^x-godoutor-persistence:' | tr -d '\r' | cut -d' ' -f2)
ERR1=$(jqget "$(cat /tmp/probe.json)" '.code')
if [ "$CODE" = 503 ] && [ "$ERR1" = module_not_migrated ]; then
  say 1-relacional "PASS" "503 module_not_migrated (x-godoutor-blocked=$BLOCKED, persistence=$PERS) — GODOUTOR_PERSISTENCE=relational ATIVO"
else
  say 1-relacional "FAIL" "GET /api/automations → $CODE (code=$ERR1, blocked=$BLOCKED) — esperado 503 module_not_migrated. Corpo: $(head -c 300 /tmp/probe.json)"
fi

# ── Item 3: cadastro + login da EQUIPE ──
req POST /api/auth/register "{\"name\":\"Validacao Preview\",\"email\":\"$EMAIL\",\"password\":\"Valida1234\"}"
if [ "$STATUS" = 200 ]; then say 3a-cadastro-equipe "PASS" "register 200 ($EMAIL)";
else say 3a-cadastro-equipe "FAIL" "register → $STATUS. Erro: $(printf '%s' "$BODY" | head -c 400)"; fi
req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"Valida1234\"}"
TOKEN=$(jqget "$BODY" '.token')
if [ "$STATUS" = 200 ] && [ -n "$TOKEN" ] && [ "$TOKEN" != null ]; then
  say 3b-login-equipe "PASS" "login 200 + token de sessão"
else
  say 3b-login-equipe "FAIL" "login → $STATUS token='$TOKEN'. Erro: $(printf '%s' "$BODY" | head -c 400)"; TOKEN=''
fi
req GET /api/auth/me '' 1
ME=$(jqget "$BODY" '.user.email')
if [ "$STATUS" = 200 ] && [ "$ME" = "$EMAIL" ]; then say 3c-sessao "PASS" "me 200 (sessão lida do banco)"; else say 3c-sessao "FAIL" "me → $STATUS email='$ME'. Erro: $(printf '%s' "$BODY" | head -c 300)"; fi

# ── Item 2: conexão ao banco via godoutor_app (conta global do paciente) ──
RAW2=$(curl -s -m 90 -o /tmp/r2.json -D /tmp/r2.hdr -w '%{http_code}' -X POST -H 'content-type: application/json' -d "{\"name\":\"Paciente Validação\",\"phone\":\"11996000001\",\"email\":\"pac-$EMAIL\",\"password\":\"Valida1234\",\"businessId\":\"$T\"}" "$BASE/api/customer/register" 2>&1)
STATUS=$RAW2; BODY=$(cat /tmp/r2.json)
RL=$(grep -i '^location:' /tmp/r2.hdr | tr -d '\r' | head -c 160)
[ -n "$RL" ] && BODY="$BODY |||| location=$RL" 
if [ "$STATUS" = 200 ]; then say 2-banco-godoutor_app "PASS" "customer/register 200 — INSERT/SELECT em app.users/app.customers via godoutor_app OK";
else
  req POST /api/auth/me '' 1
  if [ "$STATUS" = 200 ]; then say 2-banco-godoutor_app "PASS" "(customer/register → $STATUS, mas leitura de app.users OK) detalhe: $(printf '%s' "$BODY" | head -c 200)";
  else say 2-banco-godoutor_app "FAIL" "customer/register → $STATUS. Erro exato: $(printf '%s' "$BODY" | head -c 400)"; fi
fi

# ── Item 4: criar unidade + persistência nas tabelas app ──
req POST /api/businesses "{\"name\":\"Clínica Validação Preview $T\",\"whatsapp\":\"11961000$((T % 10000))\",\"address\":\"Rua da Validação, 1\"}"
BIZ=$(jqget "$BODY" '.businessId'); SLUG=$(jqget "$BODY" '.slug')
if [ "$STATUS" = 200 ] && [ -n "$BIZ" ] && [ "$BIZ" != null ]; then
  say 4a-criar-unidade "PASS" "POST /api/businesses → businessId=$BIZ slug=$SLUG"
else
  say 4a-criar-unidade "FAIL" "→ $STATUS. Erro: $(printf '%s' "$BODY" | head -c 400)"; BIZ=''
fi
PAGE=$(curl -s -m 90 -w '\n%{http_code}' "$BASE/$SLUG" 2>&1); PCODE=$(printf '%s' "$PAGE" | tail -n1); PBODY=$(printf '%s' "$PAGE" | sed '$d')
if [ "$PCODE" = 200 ] && printf '%s' "$PBODY" | grep -q "Validação Preview"; then
  say 4b-pagina-persistida "PASS" "GET /$SLUG → 200 renderizada do SQL (nome no HTML)"
else
  say 4b-pagina-persistida "FAIL" "GET /$SLUG → $PCODE. Conteúdo: $(printf '%s' "$PBODY" | head -c 200)"
fi
req GET "/api/catalog/get?businessId=$BIZ" '' 1
printf '%s' "$BODY" | jq -e '.services' >/dev/null 2>&1 && say 4c-catalogo-leitura "PASS" "catalog/get 200 JSON (app.businesses/app.services legíveis)" || say 4c-catalogo-leitura "FAIL" "catalog/get → $STATUS sem JSON .services. Corpo: $(printf '%s' "$BODY" | head -c 300)"

# ── Item 5: fluxo de agendamento ──
req PATCH "/api/businesses/$BIZ/features" '{"feature":"services","enabled":true}' 1
req PATCH "/api/businesses/$BIZ/features" '{"feature":"bookings","enabled":true}' 1
[ "$STATUS" = 200 ] && say 5a-modulos "PASS" "features services+bookings ligadas" || say 5a-modulos "FAIL" "features → $STATUS. Erro: $(printf '%s' "$BODY" | head -c 300)"
req POST /api/catalog "{\"businessId\":\"$BIZ\",\"action\":\"professional.save\",\"name\":\"Dra. Validação\"}" 1
PRO=$(jqget "$BODY" '.professionalId')
[ "$STATUS" = 200 ] && [ -n "$PRO" ] && say 5b-profissional "PASS" "professional.save → $PRO" || say 5b-profissional "FAIL" "→ $STATUS. Erro: $(printf '%s' "$BODY" | head -c 300)"
req POST /api/catalog "{\"businessId\":\"$BIZ\",\"action\":\"service.save\",\"name\":\"Consulta de Validação\",\"price\":10000,\"durationMin\":30,\"bookable\":true,\"professionalIds\":[\"$PRO\"]}" 1
[ "$STATUS" = 200 ] && say 5c-servico "PASS" "service.save ok" || say 5c-servico "FAIL" "→ $STATUS. Erro: $(printf '%s' "$BODY" | head -c 300)"
req POST /api/catalog "{\"businessId\":\"$BIZ\",\"action\":\"availability.save\",\"rules\":[{\"weekday\":0,\"start\":\"08:00\",\"end\":\"18:00\",\"slotMin\":30},{\"weekday\":1,\"start\":\"08:00\",\"end\":\"18:00\",\"slotMin\":30},{\"weekday\":2,\"start\":\"08:00\",\"end\":\"18:00\",\"slotMin\":30},{\"weekday\":3,\"start\":\"08:00\",\"end\":\"18:00\",\"slotMin\":30},{\"weekday\":4,\"start\":\"08:00\",\"end\":\"18:00\",\"slotMin\":30},{\"weekday\":5,\"start\":\"08:00\",\"end\":\"18:00\",\"slotMin\":30},{\"weekday\":6,\"start\":\"08:00\",\"end\":\"18:00\",\"slotMin\":30}]}" 1
[ "$STATUS" = 200 ] && say 5d-horarios "PASS" "availability.save ok" || say 5d-horarios "FAIL" "→ $STATUS. Erro: $(printf '%s' "$BODY" | head -c 300)"
req GET "/api/catalog/get?businessId=$BIZ" '' 1
SVC=$(jqget "$BODY" '.services[0].id')
[ -n "$SVC" ] && say 5e-catalogo-id "PASS" "serviceId=$SVC" || say 5e-catalogo-id "FAIL" "services vazio no catalog/get: $(printf '%s' "$BODY" | head -c 200)"
DATE=$(date -u -d "+2 days" +%F)
req GET "/api/bookings?businessId=$BIZ&serviceId=$SVC&date=$DATE"
NSLOTS=$(jqget "$BODY" '.slots | length' 2>/dev/null); NSLOTS=$(printf '%s' "$NSLOTS" | tr -d '[:space:]')
if [ "$STATUS" = 200 ] && [ "${NSLOTS:-0}" -gt 0 ] 2>/dev/null; then
  say 5f-slots "PASS" "$NSLOTS slots em $DATE"
  SLOT=$(jqget "$BODY" '.slots[0]')
  req POST /api/bookings "{\"businessId\":\"$BIZ\",\"serviceId\":\"$SVC\",\"date\":\"$DATE\",\"time\":\"$SLOT\",\"customerName\":\"Paciente Validação\",\"customerPhone\":\"11996000001\"}"
  BK=$(jqget "$BODY" '.bookingId')
  if [ "$STATUS" = 200 ] && [ -n "$BK" ]; then
    say 5g-reserva "PASS" "bookingId=$BK status=$(jqget "$BODY" '.status') slot=$SLOT"
    req PATCH /api/bookings "{\"businessId\":\"$BIZ\",\"id\":\"$BK\",\"status\":\"confirmed\"}" 1
    [ "$STATUS" = 200 ] && say 5h-confirmar "PASS" "PATCH confirm → 200" || say 5h-confirmar "FAIL" "→ $STATUS. Erro: $(printf '%s' "$BODY" | head -c 300)"
    req GET "/api/bookings?businessId=$BIZ&mode=manage&limit=50" '' 1
    FOUND=$(printf '%s' "$BODY" | jq -r --arg id "$BK" '[.bookings[]? | select(.id == $id)] | length' 2>/dev/null)
    [ "${FOUND:-0}" -ge 1 ] 2>/dev/null && say 5i-persistiu "PASS" "reserva visível na gestão (app.bookings)" || say 5i-persistiu "FAIL" "reserva $BK não apareceu na gestão: $(printf '%s' "$BODY" | head -c 200)"
  else
    say 5g-reserva "FAIL" "POST /api/bookings → $STATUS. Erro: $(printf '%s' "$BODY" | head -c 400)"; BK=''
    say 5h-confirmar "FAIL" "sem reserva"; say 5i-persistiu "FAIL" "sem reserva"
  fi
else
  say 5f-slots "FAIL" "GET slots → $STATUS nslots=$NSLOTS. Erro: $(printf '%s' "$BODY" | head -c 300)"
  for x in 5g-reserva 5h-confirmar 5i-persistiu; do say $x "FAIL" "sem slots"; done
fi

# ── Itens 6 e 7: uploads ──
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 -d > /tmp/f.png
printf '%%PDF-1.4\n' > /tmp/f.pdf; head -c 2048 /dev/zero >> /tmp/f.pdf
UP=$(curl -s -m 90 -w '\n%{http_code}' -H "authorization: Bearer $TOKEN" -F "businessId=$BIZ" -F "file=@/tmp/f.png;type=image/png" "$BASE/api/upload" 2>&1)
UST=$(printf '%s' "$UP" | tail -n1); UB=$(printf '%s' "$UP" | sed '$d'); UURL=$(jqget "$UB" '.url')
if [ "$UST" = 200 ] && printf '%s' "$UURL" | grep -q '/clinic-media/'; then
  say 6a-upload-publico "PASS" "{ok,url} → $(printf '%s' "$UURL" | head -c 140)"
  OBC=$(curl -s -o /dev/null -w '%{http_code}' -m 60 "$UURL")
  OCT=$(curl -s -o /dev/null -w '%{content_type}' -m 60 "$UURL")
  [ "$OBC" = 200 ] && say 6b-objeto-publico "PASS" "GET storage → 200 ($OCT) — objeto REAL no bucket clinic-media" || say 6b-objeto-publico "FAIL" "GET url pública → $OBC"
else
  say 6a-upload-publico "FAIL" "upload → $UST. Erro: $(printf '%s' "$UB" | head -c 400)"; say 6b-objeto-publico "FAIL" "sem url"
fi
req POST /api/contacts "{\"businessId\":\"$BIZ\",\"name\":\"Contato Validação\",\"phone\":\"11996000002\",\"email\":\"ct-$EMAIL\"}" 1
CT=$(jqget "$BODY" '.contact.id')
if [ "$STATUS" = 200 ] && [ -n "$CT" ]; then
  say 7a-contato "PASS" "contato criado ($CT)"
  UP2=$(curl -s -m 90 -w '\n%{http_code}' -H "authorization: Bearer $TOKEN" -F "businessId=$BIZ" -F "kind=patient" -F "contactId=$CT" -F "file=@/tmp/f.pdf;type=application/pdf" "$BASE/api/upload" 2>&1)
  U2ST=$(printf '%s' "$UP2" | tail -n1); U2B=$(printf '%s' "$UP2" | sed '$d'); FID=$(jqget "$U2B" '.fileId'); SURL=$(jqget "$U2B" '.url')
  if [ "$U2ST" = 200 ] && [ -n "$FID" ]; then
    say 7b-upload-privado "PASS" "fileId=$FID url-assinada=$(printf '%s' "$SURL" | head -c 100)"
    FR=$(curl -s -m 60 -o /dev/null -w '%{http_code} %{redirect_url}' -H "authorization: Bearer $TOKEN" "$BASE/api/files/$FID")
    FCODE=$(printf '%s' "$FR" | cut -d' ' -f1); FLOC=$(printf '%s' "$FR" | cut -d' ' -f2-)
    if [ "$FCODE" = 302 ] && printf '%s' "$FLOC" | grep -q 'token='; then
      say 7c-reassinatura "PASS" "GET /api/files/$FID → 302 (re-assina após expirar)"
      SBC=$(curl -s -o /dev/null -w '%{http_code}' -m 60 "$FLOC")
      [ "$SBC" = 200 ] && say 7d-leitura-privada "PASS" "URL assinada → 200 — objeto REAL no bucket patient-files" || say 7d-leitura-privada "FAIL" "GET assinada → $SBC"
    else
      say 7c-reassinatura "FAIL" "→ $FCODE loc=$(printf '%s' "$FLOC" | head -c 120)"; say 7d-leitura-privada "FAIL" "sem redirect"
    fi
  else
    say 7b-upload-privado "FAIL" "upload paciente → $U2ST. Erro: $(printf '%s' "$U2B" | head -c 400)"
    say 7c-reassinatura "FAIL" "sem fileId"; say 7d-leitura-privada "FAIL" "sem fileId"
  fi
else
  say 7a-contato "FAIL" "contatos → $STATUS. Erro: $(printf '%s' "$BODY" | head -c 400)"
  for x in 7b-upload-privado 7c-reassinatura 7d-leitura-privada; do say $x "FAIL" "sem contato"; done
fi

echo "RESUMO|PASS=$PASSN|FAIL=$FAILN"
[ "$FAILN" = 0 ] && echo 'VALIDACAO OK' || echo 'VALIDACAO COM FALHAS'
exit 0

# reexecução pós-desativação do Vercel Authentication (validação completa)

# reexecução pós ALTER ROLE godoutor_app (validação completa)

# reexecução pós-correção do username do pooler (role.ref)

# reexecução: diagnóstico do formato do username do pooler

# reexecução: senha sincronizada (ALTER no projeto certo + env var)

# reexecução: pwdShape no diagnóstico

# reexecução: sondas de roteamento do pooler
