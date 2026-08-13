# Deploy — rosset29 (container) + rosset16 (borda)

O app roda em um container Docker no **rosset29** e o OpenResty do **rosset16**
o publica em `https://set-teste.rosset.com.br/ypper/`, atrás do login unificado.

```
navegador → rosset16 (OpenResty, TLS + check-token.lua)
              └─ location ^~ /ypper/ → http://rosset29.rosset.grp:8083
                                          └─ container ypper-app (Node, SSR)
                                                └─ Postgres 18 (rosset96, banco ypper)
```

O banco migrou do Oracle para o PostgreSQL em 2026-08-13. Teste é o
**rosset96** (10.8.0.196); produção é o **rosset97**. Quem aponta para qual é
o `.env` do rosset29 — nada disso é build-time.

## Por que Node e não nginx na imagem

O app é TanStack Start com **SSR**: cada requisição é renderizada no servidor e
as *server functions* falam com o banco. Não é site estático, então a imagem
final roda `node .output/server/index.mjs`. É diferente do `frontend-auth`, que
é build estático servido por nginx.

O driver `pg` é JavaScript puro, então a imagem **não** precisa de nenhuma
biblioteca de cliente do banco instalada.

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
sudo cp .env.example /var/ypper/.env      # preencher Postgres, SMTP e IA
                                          # PG_USER=ypper (conta da aplicação,
                                          # nunca a conta pessoal do dev)
                                          # SEM ASPAS nos valores — ver abaixo
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

### Aspas no `.env` quebram a conexão com o banco

O `docker --env-file` **não** remove aspas ao redor do valor: `PG_PASSWORD="x"`
vira a senha `"x"`, com as aspas dentro. O `node --env-file`, usado na máquina
do dev, **remove** — por isso o mesmo arquivo funciona no dev e falha no
container, e a mensagem que aparece é só `password authentication failed for
user "ypper"`.

Aconteceu no primeiro deploy com Postgres, em 2026-08-13. Para conferir sem
imprimir a senha (o esperado é o tamanho exato dela, sem os 2 caracteres a
mais):

```bash
docker exec ypper-app sh -c 'printf %s "$PG_PASSWORD" | wc -c'
```

E, depois de corrigir o `.env`, **recrie o container**: `--env-file` só é lido
na criação, então `docker restart` mantém o valor velho.

## Passos no rosset16

Copiar `rosset16/comum/ypper.conf` para `/var/nginx/data/conf.d/comum/` e
acrescentar **uma linha** em cada um dos três arquivos de marca
(`set-teste.rosset.conf`, `teste.valisere.conf`, `testerosset.conf`):

```
include /etc/nginx/conf.d/comum/ypper.conf;
```

O arquivo compartilhado segue o padrão do `comum/limite-login.conf` que já
existe ali. Uma cópia só, incluída três vezes: as marcas não podem divergir
com o tempo — o risco levantado no PRE-10.

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

> As duas seções "Provado" abaixo são de 2026-08-10, **antes da migração para
> o Postgres**. Ficam como estão: descrevem o que foi verificado naquela data,
> com o Oracle no lugar do banco. O que foi verificado depois da migração está
> na seção seguinte a elas.

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

## Provado no rosset29 em 2026-08-10

Build a partir da `develop` na própria máquina (x86_64, Docker 24.0.2),
container `ypper-app` publicando `8083:8080` na `network-rosset`:

- `docker inspect` → `healthy`.
- `/` → 307, `/ypper/` → 200, CSS sob `/ypper/assets/` → 200.
- Os quatro containers que já rodavam (`frontend` 8080, `backend` 3000,
  `frontend-auth` 8081, `backend-auth` 4000) não foram tocados.
- Oracle 10.8.0.2:1521 alcançável a partir do servidor.

## Provado em 2026-08-13 (migração para o Postgres, contra o rosset96)

Rodado da máquina do dev, com o app apontando para o Postgres 18.4 do rosset96:

- Schema, seeds e privilégios: 25 tabelas com dono `ypper`, acessíveis pela
  aplicação. A primeira tentativa aplicou o schema como `postgres` e a app
  levou `permission denied` em tudo — por isso o `01-schema.sql` agora começa
  com `SET ROLE ypper`.
- As 22 funções de leitura dos 11 repositórios executaram sem erro de SQL.
- Escrita: abertura de chamado gerou `INC-1000` (identity a partir de 1000 mais
  a coluna gerada `codigo`), com o histórico gravado na mesma transação.
- Alteração de impacto e urgência recalculou a prioridade (P3 → P1) e auditou
  as três mudanças; encerrar sem descrição continua sendo recusado.
- Projeto, tarefa e baseline v1 gravados; coluna `DATE` não escorregou de dia.
- Data gravada bate com o relógio local (sem os 3 h de desvio de fuso).
- `npm run build` gera `.output/server/_libs/pg.mjs` — o driver entra no
  pacote do servidor.

O que **não** foi provado ainda: o app rodando dentro do container no rosset29
contra o Postgres, e a navegação pelas telas no navegador.

## O que ainda não foi provado

- **O bloco do nginx não foi aplicado.** `comum/ypper.conf` está escrito e
  revisado, mas não passou por `nginx -t` em nenhuma máquina.
- **Identidade do usuário.** O `check-token.lua` protege a rota e injeta
  `Authorization` e `X-Remote-User`, mas o app ainda não lê esses cabeçalhos —
  ele fica protegido sem saber quem está logado. Hoje a tela mostra um usuário
  fixo. Amarrar isso é passo separado.
- **`npm audit` acusa 1 vulnerabilidade alta** depois da regeneração do
  lockfile. Não foi investigada.
