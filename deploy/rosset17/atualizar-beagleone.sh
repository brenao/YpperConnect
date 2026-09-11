#!/bin/bash
# Deploy do BeagleOne (ex-YpperConnect) no rosset17 (auth-producao).
#
# Instalar em /var/beagleone/atualizar-beagleone.sh. Mesmo formato dos
# /var/autenticador/atualizar*.sh que ja rodam nesta maquina.
#
# Diferenca proposital: o token do GitHub NAO fica dentro do script.
# Ele e lido de /var/beagleone/.deploy.env, que fica com permissao 600.
#
#   cat > /var/beagleone/.deploy.env <<'EOF'
#   GITHUB_PAT=ghp_xxxxxxxx
#   EOF
#   chmod 600 /var/beagleone/.deploy.env
#
# Uso:  ./atualizar-beagleone.sh [branch]     (padrao: main)

# `set -eu` de proposito, sem `pipefail`: quem roda `sh atualizar-beagleone.sh`
# cai no dash, que ignora o shebang acima e nao conhece `pipefail` -- morreria
# aqui com "Illegal option -o pipefail". Nao ha pipeline neste script cujo
# erro precise ser capturado, entao a opcao nao faz falta.
set -eu

BASE_DIR=/var/beagleone
BRANCH="${1:-main}"
TAG=latest
NOME=beagleone-app
IMAGEM="gruporosset/beagleone-app:${TAG}"
REPO=github.com/gruporosset/Rosset.Ypper.Tool.git

# Porta publicada no host. E por ela que o OpenResty do rosset30 chega aqui
# (conf.d/comum/beagleone.conf, proxy_pass http://rosset17.rosset.grp:8083).
# Conferir que esta livre antes de trocar:  ss -ltnp | grep :8083
PORTA_HOST=8083

# Prefixo de URL. O OpenResty do rosset30 encaminha /beagleone sem remover o
# prefixo, entao o app precisa ter sido construido sabendo disso.
#
# E AQUI que o prefixo de producao e decidido: e build-time (o Vite grava nos
# assets), nao variavel de runtime. Em teste (rosset29) o prefixo continua
# /ypper/ -- ver deploy/rosset29/atualizar-ypper.sh. Construir com /ypper/ e
# publicar sob /beagleone/ faz o navegador abrir .../ypper/beagleone (2026-09-11).
APP_BASE_PATH=/beagleone/

cd "${BASE_DIR}"

if [ ! -f "${BASE_DIR}/.deploy.env" ]; then
  echo "ERRO: ${BASE_DIR}/.deploy.env nao existe (precisa conter GITHUB_PAT)."
  exit 1
fi
# shellcheck disable=SC1091
. "${BASE_DIR}/.deploy.env"

if [ ! -f "${BASE_DIR}/.env" ]; then
  echo "ERRO: ${BASE_DIR}/.env nao existe. Copiar de .env.example e preencher."
  exit 1
fi

echo "Construindo a imagem (branch ${BRANCH}, base ${APP_BASE_PATH})..."
docker build \
  --build-arg "APP_BASE_PATH=${APP_BASE_PATH}" \
  --tag "${IMAGEM}" \
  "https://${GITHUB_PAT}@${REPO}#${BRANCH}"

# So derruba o que esta no ar depois que a imagem nova existe.
# Se o build falhar, o `set -e` para aqui e a versao antiga continua servindo.
echo "Parando e removendo o container antigo..."
docker rm --force "${NOME}" 2>/dev/null || true

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
