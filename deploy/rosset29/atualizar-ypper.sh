#!/bin/bash
# Deploy do YpperConnect no rosset29 (auth-teste).
#
# Instalar em /var/ypper/atualizar-ypper.sh. Mesmo formato dos
# /var/autenticador/atualizar*.sh que ja rodam nesta maquina.
#
# Diferenca proposital: o token do GitHub NAO fica dentro do script.
# Ele e lido de /var/ypper/.deploy.env, que fica com permissao 600.
#
#   cat > /var/ypper/.deploy.env <<'EOF'
#   GITHUB_PAT=ghp_xxxxxxxx
#   EOF
#   chmod 600 /var/ypper/.deploy.env
#
# Uso:  ./atualizar-ypper.sh [branch]     (padrao: main)

set -euo pipefail

BASE_DIR=/var/ypper
BRANCH="${1:-main}"
TAG=latest
NOME=ypper-app
IMAGEM="gruporosset/ypper-app:${TAG}"
REPO=github.com/gruporosset/Rosset.Ypper.Tool.git

# Porta publicada no host. E por ela que o nginx do rosset16 chega aqui.
# Conferir que esta livre antes de trocar:  ss -ltnp | grep :8083
PORTA_HOST=8083

# Prefixo de URL. O nginx do rosset16 encaminha /ypper sem remover o prefixo,
# entao o app precisa ter sido construido sabendo disso.
APP_BASE_PATH=/ypper/

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
