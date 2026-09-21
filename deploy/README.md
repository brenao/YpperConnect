# Deploy — container (rosset29 / rosset17) + borda (rosset16 / rosset30)

O app roda em um container Docker e o OpenResty da borda o publica atrás do
login unificado. **Desde 2026-09-14 teste e produção são iguais em nome e
prefixo**; só mudam as máquinas e o banco:

| Ambiente | Borda    | Prefixo       | Container                   | Script                            |
| -------- | -------- | ------------- | --------------------------- | --------------------------------- |
| teste    | rosset16 | `/beagleone/` | `beagleone-app` no rosset29 | `rosset29/atualizar-beagleone.sh` |
| produção | rosset30 | `/beagleone/` | `beagleone-app` no rosset17 | `rosset17/atualizar-beagleone.sh` |

```
teste:    navegador → rosset16 (OpenResty, TLS + check-token.lua)
                        └─ location ^~ /beagleone/ → http://rosset29.rosset.grp:8083
                                                       └─ container beagleone-app (Node, SSR)
                                                             └─ Postgres 18 (rosset96, banco ypper)

produção: navegador → rosset30 (OpenResty, TLS + check-token.lua)
                        └─ location ^~ /beagleone/ → http://rosset17.rosset.grp:8083
                                                       └─ container beagleone-app (Node, SSR)
                                                             └─ Postgres 18 (rosset97, banco ypper)
```

### O prefixo tem de bater com a borda (2026-09-11)

Em produção o produto virou **BeagleOne** e a borda do rosset30 passou a publicar
sob `/beagleone/` (`comum/beagleone.conf`, aplicado no servidor e versionado em
`rosset30/comum/beagleone.conf`). O container do rosset17, porém, tinha sido
construído com `APP_BASE_PATH=/ypper/`. Não dá erro: o app sobe, a borda
encaminha `/beagleone/`, o router não reconhece o caminho e o navegador abre
`https://gerencial.rosset.com.br/ypper/beagleone`. A correção é reconstruir a
imagem com o prefixo certo, que é o que `rosset17/atualizar-beagleone.sh` faz.

### Renomeado em 2026-09-14: o teste deixou de ser `/ypper/`

Até então o teste publicava `/ypper/` com o container `ypper-app` em
`/var/ypper`, e produção já era `/beagleone/`. Dois nomes para a mesma coisa
era o que fez o rosset17 nascer com o prefixo errado. Agora o rosset29 é o
espelho do rosset17: `/var/beagleone`, `beagleone-app`, imagem
`gruporosset/beagleone-app`, prefixo `/beagleone/`, e a borda do rosset16 tem
o `comum/beagleone.conf` igual ao do rosset30, trocando só o upstream.

Passos únicos de migração, nesta ordem:

```bash
# rosset29
sudo mv /var/ypper /var/beagleone                  # leva .env e .deploy.env junto
sudo cp atualizar-beagleone.sh /var/beagleone/ && sudo chmod +x /var/beagleone/atualizar-beagleone.sh
sudo rm /var/beagleone/atualizar-ypper.sh
/var/beagleone/atualizar-beagleone.sh main         # o script já remove o ypper-app (mesma porta 8083)
docker rmi gruporosset/ypper-app:latest            # imagem antiga, só limpeza
curl -I http://localhost:8083/beagleone/           # esperado: 200

# rosset16 (borda): trocar o include nas TRÊS marcas, depois remover o conf antigo
#   include /etc/nginx/conf.d/comum/ypper.conf;  →  include /etc/nginx/conf.d/comum/beagleone.conf;
docker exec <openresty> nginx -t && docker exec <openresty> nginx -s reload
rm /var/nginx/data/conf.d/comum/ypper.conf
```

E no banco do rosset96, a URL que o `pg_cron` chama tem o prefixo dentro:
aplicar `db/postgres/12-rotinas-url-beagleone.sql` (idempotente, só mexe se o
valor ainda tiver `/ypper/`). Sem isso as rotinas diárias passam a bater em
`/ypper/api/rotinas`, que o app redireciona para `/beagleone/ypper/api/rotinas`
— 404 em vez de executar.

O banco migrou do Oracle para o PostgreSQL em 2026-08-13. Teste é o
**rosset96** (10.8.0.196); produção é o **rosset97**. Quem aponta para qual é
o `.env` de cada servidor — nada disso é build-time.

## Por que Node e não nginx na imagem

O app é TanStack Start com **SSR**: cada requisição é renderizada no servidor e
as _server functions_ falam com o banco. Não é site estático, então a imagem
final roda `node .output/server/index.mjs`. É diferente do `frontend-auth`, que
é build estático servido por nginx.

O driver `pg` é JavaScript puro, então a imagem **não** precisa de nenhuma
biblioteca de cliente do banco instalada.

## O prefixo é build-time

O Vite grava o prefixo dentro das URLs dos assets. Por isso ele entra como
`--build-arg APP_BASE_PATH=/beagleone/` nos dois scripts de deploy, não como
variável de runtime. Trocar o prefixo exige **rebuild**;
`docker restart` não adianta.
`src/router.tsx` lê o mesmo valor via `import.meta.env.BASE_URL`, para o
prefixo não ficar declarado em dois lugares.

Rodar sem prefixo (raiz) continua funcionando: é o padrão, `APP_BASE_PATH=/`.

### A URL do portal de chamados também é build-time (2026-09-14)

`VITE_URL_ABRIR_CHAMADO` (botão "Abrir chamado", menu "Chamados" e página
inicial) tem prefixo `VITE_`, e **toda** variável `VITE_*` é gravada dentro do
JavaScript no `npm run build`. Colocar a linha no `.env` do servidor e recriar
o container não muda nada: o `.env` fica fora do contexto de build
(`.dockerignore`) e o `--env-file` do `docker run` chega depois. Foi
exatamente isso que aconteceu no rosset29 em 2026-09-14.

O caminho é o mesmo do prefixo: o `Dockerfile` declara
`ARG VITE_URL_ABRIR_CHAMADO`, e os scripts `atualizar-*.sh` **leem a linha do
`.env` do servidor** e repassam como `--build-arg`. A URL continua morando só
no `.env`, mas trocar o valor exige rodar o script de novo (rebuild). Linha
ausente ou vazia = formulário interno, como antes.

## Passos no rosset29 (teste) — instalação do zero

Se a máquina já tem `/var/ypper`, use a seção "Renomeado" acima em vez desta.

```bash
sudo mkdir -p /var/beagleone
sudo cp atualizar-beagleone.sh /var/beagleone/ && sudo chmod +x /var/beagleone/atualizar-beagleone.sh

# Segredos — nenhum dos dois vai para dentro da imagem.
sudo cp .env.example /var/beagleone/.env  # preencher Postgres (rosset96), SMTP e IA
                                          # PG_USER=ypper (conta da aplicação,
                                          # nunca a conta pessoal do dev)
                                          # SEM ASPAS nos valores — ver abaixo
sudo chmod 600 /var/beagleone/.env
printf 'GITHUB_PAT=ghp_xxx\n' | sudo tee /var/beagleone/.deploy.env
sudo chmod 600 /var/beagleone/.deploy.env

# Antes de subir: confirmar que a 8083 está livre nesta máquina.
ss -ltnp | grep ':8083' && echo 'OCUPADA — escolher outra porta'

/var/beagleone/atualizar-beagleone.sh main
```

Verificação local, ainda no rosset29:

```bash
docker ps --filter name=beagleone-app
docker logs -n 50 beagleone-app
curl -I http://localhost:8083/beagleone/
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
docker exec beagleone-app sh -c 'printf %s "$PG_PASSWORD" | wc -c'
```

E, depois de corrigir o `.env`, **recrie o container**: `--env-file` só é lido
na criação, então `docker restart` mantém o valor velho.

## Passos no rosset17 (produção)

Igual ao rosset29, com `rosset17/atualizar-beagleone.sh`. O `.env` aponta para
o **rosset97**.

```bash
/var/beagleone/atualizar-beagleone.sh main
curl -I http://localhost:8083/beagleone/     # esperado: 200
curl -I http://localhost:8083/               # esperado: 307 para /beagleone/
```

## Passos no rosset30 (borda de produção)

`rosset30/comum/beagleone.conf` já está aplicado (2026-09-11), incluído nos
cinco arquivos de marca (`gerencialrosset`, `gerencialvalisere`, `gerencialfilo`,
`gerencialdoutex` e `set.rosset`). Conferido pelo MCP: as diretivas do arquivo
no servidor e as do repositório são iguais.

## Passos no rosset16 (borda de teste)

Copiar `rosset16/comum/beagleone.conf` para `/var/nginx/data/conf.d/comum/` e
acrescentar **uma linha** em cada um dos três arquivos de marca
(`set-teste.rosset.conf`, `teste.valisere.conf`, `testerosset.conf`):

```
include /etc/nginx/conf.d/comum/beagleone.conf;
```

Se a linha antiga (`comum/ypper.conf`) ainda estiver lá, **trocar**, não
somar: dois blocos apontando para o mesmo upstream com prefixos diferentes é
exatamente a confusão que esta troca de nome elimina.

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
  às _server functions_, que era o ponto de maior risco.
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

- **O `comum/beagleone.conf` do rosset16 não foi aplicado.** É cópia do que
  roda no rosset30 desde 2026-09-11 (trocando o upstream), mas não passou por
  `nginx -t` no rosset16. Até ser aplicado, a borda de teste continua em
  `/ypper/` e o container novo em `/beagleone/` — o navegador abrirá
  `/beagleone/ypper`.
- **Identidade do usuário.** O `check-token.lua` protege a rota e injeta
  `Authorization` e `X-Remote-User`, mas o app ainda não lê esses cabeçalhos —
  ele fica protegido sem saber quem está logado. Hoje a tela mostra um usuário
  fixo. Amarrar isso é passo separado.
- **`npm audit` acusa 1 vulnerabilidade alta** depois da regeneração do
  lockfile. Não foi investigada.
