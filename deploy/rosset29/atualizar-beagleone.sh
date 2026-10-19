#!/bin/bash
# Deploy do BeagleOne (ex-YpperConnect) no rosset29 (auth-teste).
#
# Instalar em /var/beagleone/atualizar-beagleone.sh. Mesmo formato dos
# /var/autenticador/atualizar*.sh que ja rodam nesta maquina.
# Se a maquina ainda tem /var/ypper (nome anterior a 2026-09-14):
#   mv /var/ypper /var/beagleone     -- leva .env e .deploy.env junto
#
# Diferenca proposital: o token do GitHub NAO fica dentro do script.
# Ele e lido de /var/.deploy.env, que fica com permissao 600.
#
#   cat > /var/.deploy.env <<'EOF'
#   GITHUB_TOKEN=ghp_xxxxxxxx
#   EOF
#   chmod 600 /var/.deploy.env
#
# Uso:  ./atualizar-beagleone.sh [branch]     (padrao: main)

# `set -eu` de proposito, sem `pipefail`: quem roda `sh atualizar-beagleone.sh`
# cai no dash, que ignora o shebang acima e nao conhece `pipefail` -- morreria
# aqui com "Illegal option -o pipefail". Nao ha pipeline neste script cujo
# erro precise ser capturado, entao a opcao nao faz falta.
set -eu

BASE_DIR=/var/beagleone
SRC_DIR="${BASE_DIR}/src"
BRANCH="${1:-main}"
TAG=latest
NOME=beagleone-app
IMAGEM="gruporosset/beagleone-app:${TAG}"
REPO=github.com/gruporosset/Rosset.Beagleone.git

# Porta publicada no host. E por ela que o OpenResty do rosset16 chega aqui
# (conf.d/comum/beagleone.conf, proxy_pass http://rosset29.rosset.grp:8083).
# Conferir que esta livre antes de trocar:  ss -ltnp | grep :8083
PORTA_HOST=8083

# Prefixo de URL. O OpenResty do rosset16 encaminha /beagleone sem remover o
# prefixo, entao o app precisa ter sido construido sabendo disso.
#
# E build-time (o Vite grava nos assets), nao variavel de runtime. Desde
# 2026-09-14 teste e producao usam o MESMO prefixo, diretorio, container e
# imagem -- este script e o espelho de deploy/rosset17/atualizar-beagleone.sh,
# trocando so os comentarios. Ate entao o teste publicava /ypper/ com o
# container ypper-app em /var/ypper; ver a secao "Renomeado" do deploy/README.md.
APP_BASE_PATH=/beagleone/

# Nome do container que existia ANTES da troca de nome (2026-09-14). Ele ocupa
# a mesma porta 8083: se continuar no ar, o `docker container create` abaixo
# falha com "port is already allocated". Removido uma vez, esta linha vira
# no-op. Apagar este bloco quando o rosset29 nao tiver mais nada com ypper.
NOME_ANTIGO=ypper-app

cd "${BASE_DIR}"

if [ ! -f /var/.deploy.env ]; then
  echo "ERRO: /var/.deploy.env nao existe (precisa conter GITHUB_TOKEN)."
  exit 1
fi
# shellcheck disable=SC1091
. /var/.deploy.env

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERRO: GITHUB_TOKEN vazio em /var/.deploy.env."
  exit 1
fi

# O token vai num CABECALHO Authorization, e nao na URL: o `git` descarta a
# credencial da URL ao seguir um redirecionamento do GitHub e para com
# "could not read Username" (Gerencial, 16/10/2026 -- ADR-003 no vault). O
# cabecalho e repetido em toda requisicao, com ou sem redirecionamento.
#
# Por variavel de ambiente, e nao `git -c`: `-c` poe o cabecalho nos argumentos
# do processo, visivel por `ps` a qualquer usuario. GIT_CONFIG_COUNT exige
# git >= 2.31. `printf` e builtin: o token tambem nao vira argumento ali.
#
# Por isso tambem o clone em ${SRC_DIR}: o `docker build <url-do-git>` de antes
# clonava pelo daemon do Docker, onde nao ha como passar o cabecalho.
GITHUB_AUTH="$(printf 'x-access-token:%s' "${GITHUB_TOKEN}" | base64 -w0)"
git_github() {
  GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader \
    GIT_CONFIG_VALUE_0="Authorization: Basic ${GITHUB_AUTH}" git "$@"
}

if [ ! -f "${BASE_DIR}/.env" ]; then
  echo "ERRO: ${BASE_DIR}/.env nao existe. Copiar de .env.example e preencher."
  exit 1
fi

# Variavel VITE_* e build-time: o --env-file abaixo chega tarde demais para
# ela. Le a linha do .env e repassa ao docker build. Vazia = formulario
# interno de chamado. Sem `pipefail` de proposito (ver comentario do set -eu):
# se a linha nao existir, o grep falha mas o cut devolve vazio, e segue.
VITE_URL_ABRIR_CHAMADO="$(grep -E '^VITE_URL_ABRIR_CHAMADO=' "${BASE_DIR}/.env" | tail -n 1 | cut -d= -f2-)"

echo "Atualizando o codigo (branch ${BRANCH})..."
# A URL fica sem token, e e ela que fica gravada no .git/config.
if [ -d "${SRC_DIR}/.git" ]; then
  git_github -C "${SRC_DIR}" fetch --prune origin
  git -C "${SRC_DIR}" checkout "${BRANCH}"
  git -C "${SRC_DIR}" reset --hard "origin/${BRANCH}"
else
  git_github clone --branch "${BRANCH}" "https://${REPO}" "${SRC_DIR}"
fi
echo "    commit: $(git -C "${SRC_DIR}" log --oneline -1)"

# O .dockerignore tira .git e .env do contexto, como o build pela URL fazia.
echo "Construindo a imagem (branch ${BRANCH}, base ${APP_BASE_PATH}, portal de chamados '${VITE_URL_ABRIR_CHAMADO}')..."
docker build \
  --build-arg "APP_BASE_PATH=${APP_BASE_PATH}" \
  --build-arg "VITE_URL_ABRIR_CHAMADO=${VITE_URL_ABRIR_CHAMADO}" \
  --tag "${IMAGEM}" \
  "${SRC_DIR}"

# So derruba o que esta no ar depois que a imagem nova existe.
# Se o build falhar, o `set -e` para aqui e a versao antiga continua servindo.
echo "Parando e removendo o container antigo..."
docker rm --force "${NOME}" 2>/dev/null || true
docker rm --force "${NOME_ANTIGO}" 2>/dev/null || true

echo "Montando o container..."
# O healthcheck ja vem na imagem e usa o mesmo APP_BASE_PATH do build.
docker container create \
  --env-file "${BASE_DIR}/.env" \
  --publish "${PORTA_HOST}:8080" \
  --network network-rosset \
  --restart unless-stopped \
  --name "${NOME}" \
  "${IMAGEM}"

echo "Subindo o servico..."
docker start "${NOME}"

echo "Limpando imagens orfas..."
docker image prune --force

echo "OK. Conferir:  docker ps --filter name=${NOME}"
echo "               curl -I http://localhost:${PORTA_HOST}${APP_BASE_PATH}"
exit 0
