#!/usr/bin/env bash
# =====================================================================
# Configura o ambiente de teste do BeagleOne (Supabase Auth + Asaas).
# Idempotente: pode rodar de novo; cria ou atualiza, nunca duplica.
#
# Uso (de qualquer pasta do projeto):
#   bash scripts/configurar-teste.sh
#   - pede o token do Supabase sem mostrar na tela (Enter pula a etapa);
#   - le os valores do Asaas do .env; nada e gravado em arquivo.
#
# Codigo de saida: 0 se tudo passou, 1 se alguma etapa falhou.
# =====================================================================
set -uo pipefail

APP_URL="https://beagleone.vercel.app"
SUPABASE_REF="pszstkczuktzxnpoymwv"
EMAIL_AVISOS="breno@bfadigital.com.br"
WEBHOOK_URL="$APP_URL/api/webhooks/asaas"
EVENTOS='["PAYMENT_CREATED","PAYMENT_CONFIRMED","PAYMENT_RECEIVED","PAYMENT_OVERDUE","PAYMENT_REFUNDED","SUBSCRIPTION_DELETED","SUBSCRIPTION_INACTIVATED"]'

# Roda a partir da raiz do repositorio, de onde quer que seja chamado.
cd "$(dirname "$0")/.." || exit 1
[ -f .env ] || { echo "Nao achei o .env na raiz do projeto."; exit 1; }
command -v node >/dev/null || { echo "Precisa do node no PATH."; exit 1; }

FALHAS=0
ok()   { printf '\033[32m✔\033[0m %s\n' "$1"; }
erro() { printf '\033[31m✘\033[0m %s\n' "$1"; FALHAS=$((FALHAS + 1)); }

# Le do .env sem "source" (valores com < > $ quebram o shell); tira
# aspas ao redor e o \r de arquivo salvo no Windows.
ler() {
  local v
  v="$(grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r')" || true
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

ASAAS_URL="$(ler ASAAS_URL)"
ASAAS_API_KEY="$(ler ASAAS_API_KEY)"
ASAAS_WEBHOOK_TOKEN="$(ler ASAAS_WEBHOOK_TOKEN)"
for v in ASAAS_URL ASAAS_API_KEY ASAAS_WEBHOOK_TOKEN; do
  [ -n "${!v}" ] || { echo "Falta $v no .env"; exit 1; }
done

# HTTP: devolve o corpo e, na ultima linha, o status (000 = sem conexao).
http() {
  curl -sS --max-time 30 -w '\n%{http_code}' "$@" 2>&1 || true
}
status() { printf '%s' "${1##*$'\n'}"; }
corpo()  { printf '%s' "${1%$'\n'*}"; }

# JSON montado pelo node: nada de aspas quebrando por causa de um valor.
json() { node -e "process.stdout.write(JSON.stringify($1))"; }

# ---------------------------------------------------------------------
# 1. Supabase Auth: Site URL, Redirect URLs e cadastro publico desligado
#    (o app cria usuarios pela API administrativa, entao nada quebra).
#    Token: Project admin (Read & write) + Auth Config (Read & write).
# ---------------------------------------------------------------------
echo "== Supabase Auth"
TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -t 0 ]; then
  read -rsp "Token do Supabase (sbp_..., Enter para pular): " TOKEN; echo
fi

if [ -z "$TOKEN" ]; then
  echo "  etapa pulada (sem token)"
else
  dados="$(APP_URL="$APP_URL" json '{
    site_url: process.env.APP_URL,
    uri_allow_list: process.env.APP_URL + "/**,http://localhost:8080/**",
    disable_signup: true
  }')"
  resp="$(http -X PATCH "https://api.supabase.com/v1/projects/$SUPABASE_REF/config/auth" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$dados")"
  if [ "$(status "$resp")" = "200" ]; then
    ok "Site URL, Redirect URLs e cadastro publico desligado"
  else
    erro "Supabase respondeu $(status "$resp"): $(corpo "$resp")"
  fi
fi
unset TOKEN SUPABASE_ACCESS_TOKEN

# ---------------------------------------------------------------------
# 2. Asaas: webhook. Cria se nao existir; se existir, atualiza (token,
#    eventos e envio), para o painel nunca ficar diferente do codigo.
# ---------------------------------------------------------------------
echo "== Asaas webhook"
asaas() {
  http "$@" -H "access_token: $ASAAS_API_KEY" \
    -H "Content-Type: application/json" -H "User-Agent: BeagleOne"
}

lista="$(asaas "$ASAAS_URL/webhooks?limit=100")"
if [ "$(status "$lista")" != "200" ]; then
  erro "Asaas recusou a listagem ($(status "$lista")): $(corpo "$lista")"
else
  id="$(corpo "$lista" | URL="$WEBHOOK_URL" node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const w = (JSON.parse(s).data || []).find(x => x.url === process.env.URL);
      process.stdout.write(w ? w.id : "");
    });')"

  dados="$(URL="$WEBHOOK_URL" EMAIL="$EMAIL_AVISOS" TK="$ASAAS_WEBHOOK_TOKEN" json "{
    name: 'BeagleOne',
    url: process.env.URL,
    email: process.env.EMAIL,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken: process.env.TK,
    sendType: 'SEQUENTIALLY',
    events: $EVENTOS
  }")"

  if [ -n "$id" ]; then
    resp="$(asaas -X PUT "$ASAAS_URL/webhooks/$id" -d "$dados")"
    acao="atualizado"
  else
    resp="$(asaas -X POST "$ASAAS_URL/webhooks" -d "$dados")"
    acao="criado"
  fi
  if [ "$(status "$resp")" = "200" ]; then
    ok "Webhook $acao: $WEBHOOK_URL"
  else
    erro "Asaas respondeu $(status "$resp") ao tentar o webhook: $(corpo "$resp")"
  fi
fi

# ---------------------------------------------------------------------
# 3. Endpoint publicado: token errado deve dar 401; certo, 200.
# ---------------------------------------------------------------------
echo "== Endpoint do webhook"
testar() {
  curl -sS --max-time 30 -o /dev/null -w '%{http_code}' -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" -H "asaas-access-token: $1" \
    -d '{"event":"PING"}' 2>/dev/null || true
}
falso="$(testar "token-invalido")"
certo="$(testar "$ASAAS_WEBHOOK_TOKEN")"
if [ "$falso" = "401" ]; then ok "Token errado recusado (401)"; else erro "Token errado deu $falso (esperado 401)"; fi
if [ "$certo" = "200" ]; then ok "Token certo aceito (200)"
else erro "Token certo deu $certo (esperado 200; confira ASAAS_WEBHOOK_TOKEN na Vercel)"; fi

# ---------------------------------------------------------------------
if [ "$FALHAS" -eq 0 ]; then
  echo "Pronto: tudo certo."
else
  echo "Terminou com $FALHAS falha(s)."
  exit 1
fi