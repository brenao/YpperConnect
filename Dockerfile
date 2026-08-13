# syntax=docker/dockerfile:1

# YpperConnect / Service Navigator — imagem de execucao.
#
# O app e TanStack Start com SSR: nao e site estatico, entao a imagem final
# roda um servidor Node (saida do Nitro em .output/), nao um nginx.
#
# O banco e PostgreSQL (ver src/integrations/postgres/client.server.ts). O
# driver `pg` e JavaScript puro: nao ha biblioteca de cliente para instalar
# na imagem.

ARG NODE_VERSION=22-bookworm-slim

# A imagem node:22 traz npm 10, e o package-lock.json deste projeto foi gerado
# pelo npm 11. As duas versoes resolvem peer dependency OPCIONAL de formas
# diferentes (caso concreto: lru-cache, peer opcional do unstorage via nitro),
# e o npm 10 rejeita o lock do 11 com "Missing: ... from lock file".
# Pinar aqui e o que garante build igual na maquina do dev e no rosset29.
ARG NPM_VERSION=11.12.1

# --------------------------------------------------------------------- base
FROM node:${NODE_VERSION} AS base
ARG NPM_VERSION
RUN npm install -g npm@${NPM_VERSION}
WORKDIR /app

# ---------------------------------------------------------------- dependencias
# Estagio separado so para o npm ci: a camada so invalida quando o
# package-lock.json muda, nao a cada alteracao de codigo.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------- build
FROM base AS build

# Prefixo de URL em que o app sera servido. "/" = raiz (padrao).
# Para publicar sob https://set-teste.rosset.com.br/ypper, passar "/ypper/".
# E build-time de proposito: o Vite grava esse prefixo nas URLs dos assets.
ARG APP_BASE_PATH=/
ENV APP_BASE_PATH=${APP_BASE_PATH}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# -------------------------------------------------------------------- runtime
# So o .output entra aqui. O Nitro ja rastreia para dentro dele as dependencias
# que o servidor usa em tempo de execucao — inclusive o `pg`, que o
# vite.config.ts marca como `ssr.external`. Por isso nao existe estagio de
# "npm ci --omit=dev" nem copia de node_modules.
#
# CONFERIR na primeira imagem construida apos a migracao:
#   docker run --rm --entrypoint ls IMAGEM .output/server/node_modules
# O `pg` precisa aparecer ai. Se nao aparecer, o container sobe e so quebra
# na primeira consulta.
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

# Fuso do container. Sem isto o Node roda em UTC e toda data renderizada no
# servidor (SSR) sai 3 horas adiantada. O PG_TIMEZONE do client.server.ts cobre
# a sessao do banco, nao o Date do JavaScript — e o driver `pg` usa o fuso do
# PROCESSO para converter Date em timestamp, entao esta linha tambem e o que
# faz a data gravada bater com a data digitada.
ENV TZ=America/Sao_Paulo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

COPY --from=build /app/.output ./.output

# Nao rodar como root. A imagem node ja traz o usuario "node" (uid 1000).
USER node

EXPOSE 8080

# O healthcheck precisa bater no mesmo prefixo em que o app foi construido.
# APP_BASE_PATH e reaproveitado aqui so para montar essa URL.
ARG APP_BASE_PATH=/
ENV APP_BASE_PATH=${APP_BASE_PATH}
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+(process.env.APP_BASE_PATH||'/')).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
