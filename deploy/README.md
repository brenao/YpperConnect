# Deploy — rosset29 (container) + rosset16 (borda)

O app roda em um container Docker no **rosset29** e o OpenResty do **rosset16**
o publica em `https://set-teste.rosset.com.br/ypper/`, atrás do login unificado.

```
navegador → rosset16 (OpenResty, TLS + check-token.lua)
              └─ location ^~ /ypper/ → http://rosset29.rosset.grp:8083
                                          └─ container ypper-app (Node, SSR)
                                                └─ Oracle 10.8.0.2:1521/ROS11
```

## Por que Node e não nginx na imagem

O app é TanStack Start com **SSR**: cada requisição é renderizada no servidor e
as *server functions* falam com o Oracle. Não é site estático, então a imagem
final roda `node .output/server/index.mjs`. É diferente do `frontend-auth`, que
é build estático servido por nginx.

`node-oracledb` está em **modo thin** (JavaScript puro), então a imagem **não**
precisa do Oracle Instant Client.

## O prefixo `/ypper` é build-time

O Vite grava o prefixo dentro das URLs dos assets. Por isso ele entra como
`--build-arg APP_BASE_PATH=/ypper/`, não como variável de runtime.
`src/router.tsx` lê o mesmo valor via `import.meta.env.BASE_URL`, para o
prefixo não ficar declarado em dois lugares.

Rodar sem prefixo (raiz) continua funcionando: é o padrão, `APP_BASE_PATH=/`.

## Passos no rosset29

```bash
sudo mkdir -p /var/ypper
sudo cp atualizar-ypper.sh /var/ypper/ && sudo chmod +x /var/ypper/atualizar-ypper.sh

# Segredos — nenhum dos dois vai para dentro da imagem.
sudo cp .env.example /var/ypper/.env      # preencher Oracle, SMTP e IA
sudo chmod 600 /var/ypper/.env
printf 'GITHUB_PAT=ghp_xxx\n' | sudo tee /var/ypper/.deploy.env
sudo chmod 600 /var/ypper/.deploy.env

# Antes de subir: confirmar que a 8083 está livre nesta máquina.
ss -ltnp | grep ':8083' && echo 'OCUPADA — escolher outra porta'

/var/ypper/atualizar-ypper.sh main
```

Verificação local, ainda no rosset29:

```bash
docker ps --filter name=ypper-app
docker logs -n 50 ypper-app
curl -I http://localhost:8083/ypper/
```

## Passos no rosset16

Inserir `rosset16/ypper.location.conf` nos **três** arquivos de marca em
`/var/nginx/data/conf.d/`: `set-teste.rosset.conf`, `teste.valisere.conf` e
`testerosset.conf`. Aplicar em um só cria comportamento assimétrico entre
marcas — o mesmo risco levantado no PRE-10.

Backup, teste e recarga:

```bash
cp data/conf.d/set-teste.rosset.conf data/conf.d/bkp/set-teste.rosset.conf.$(date +%Y%m%d_%H%M)
docker exec <openresty> nginx -t && docker exec <openresty> nginx -s reload
```

## Portas do rosset29

Já apontadas pelo nginx do rosset16 ou publicadas pelos scripts de
`/var/autenticador`: **80, 81, 82, 3000, 4000, 8000, 8081**.
A 8083 foi escolhida por não aparecer em nenhuma configuração do rosset16 —
mas isso **não prova** que está livre no host. Confirmar com `ss -ltnp`.

## Provado em 2026-08-10 (container rodando na máquina do dev)

Imagem construída com `APP_BASE_PATH=/ypper/`, container em `8083:8080`,
navegador em `http://localhost:8083/ypper/`:

- Imagem de 255 MB; `.output` de 8 MB, com `oracledb` rastreado para dentro.
- `/` responde 307 para `/ypper/`; `/ypper/` responde 200 com HTML de SSR.
- Os 8 assets citados no HTML respondem 200 sob `/ypper/assets/...`.
- Três chamadas `GET /ypper/_serverFn/<id>` responderam 200 — o prefixo chega
  às *server functions*, que era o ponto de maior risco.
- Telas de Chamados, Recursos e Projetos renderizaram com dados vindos do
  Oracle. Nenhum erro no console do navegador.

Três defeitos apareceram no caminho e foram corrigidos: o lockfile fora de
sincronia, o vazamento de `client.server` para o bundle do cliente e o
`baseURL` que faltava no Nitro. Detalhe de cada um nos comentários do
`Dockerfile`, de `src/services/resource-utils.ts` e do `vite.config.ts`.

## O que ainda não foi provado

- **Nada rodou no rosset29.** O teste acima foi em macOS/arm64; o rosset29 é
  Linux/x86. O `docker build` lá parte do mesmo Dockerfile, mas o primeiro
  deploy ainda é o primeiro deploy.
- **O bloco do nginx não foi aplicado.** `ypper.location.conf` está escrito e
  revisado, mas não passou por `nginx -t` em nenhuma máquina.
- **Identidade do usuário.** O `check-token.lua` protege a rota e injeta
  `Authorization` e `X-Remote-User`, mas o app ainda não lê esses cabeçalhos —
  ele fica protegido sem saber quem está logado. Hoje a tela mostra um usuário
  fixo. Amarrar isso é passo separado.
- **`npm audit` acusa 1 vulnerabilidade alta** depois da regeneração do
  lockfile. Não foi investigada.
