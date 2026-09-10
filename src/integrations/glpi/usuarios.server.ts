import { request } from "node:https";
import { URL } from "node:url";
import { consultar, executar, emTransacao } from "@/integrations/postgres/client.server";

/**
 * Lista de usuários do GLPI. SOMENTE SERVIDOR.
 *
 * Porte do `sincronizarUsuariosGlpi.js` entregue pelo Grupo Rosset. A
 * lógica de timeout, nova tentativa e upsert idempotente é a mesma; o
 * que mudou é a forma:
 *
 *   - TypeScript e ESM, em vez de CommonJS.
 *   - Acesso ao banco pela camada do projeto (`client.server`), com
 *     binds nomeados. Um `pg.Pool` próprio criaria uma segunda pool de
 *     conexões e um segundo dialeto de SQL no mesmo sistema.
 *   - `TIMESTAMP` em vez de `timestamptz`, conforme a regra do
 *     `01-schema.sql`: o driver deslocava o SLA em 3 horas com tipo com
 *     fuso, e o mesmo cuidado vale aqui.
 *
 * O `X-Service-Secret` é credencial servidor-a-servidor. Este arquivo
 * termina em `.server.ts` e só é importado dentro de handlers, para o
 * segredo nunca alcançar o bundle do navegador.
 */

export interface UsuarioGlpi {
  id: number;
  login: string;
  nome: string;
}

const TIMEOUT_MS = 10_000;
const TENTATIVAS = 3;

/**
 * O endpoint de homologação responde em `https://10.0.0.33`, e
 * certificado emitido para um IP quase nunca valida. Desligar a
 * verificação é decisão de ambiente, não do código — daí a variável,
 * seguindo a convenção que o SMTP já usa.
 *
 * Em produção isto deve ficar em `true`.
 */
function verificarTls(): boolean {
  return process.env["GLPI_TLS_REJECT_UNAUTHORIZED"] !== "false";
}

interface RespostaHttp {
  status: number;
  corpo: string;
}

/**
 * Requisição via `node:https` em vez de `fetch`.
 *
 * O `fetch` global não expõe controle de TLS por chamada: desligar a
 * verificação exigiria mexer em `NODE_TLS_REJECT_UNAUTHORIZED`, que é
 * global do processo e afetaria também o SMTP e a API de IA. Aqui a
 * exceção fica contida nesta chamada.
 */
function chamar(url: string, segredo: string): Promise<RespostaHttp> {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url);

    const req = request(
      {
        hostname: alvo.hostname,
        port: alvo.port || 443,
        path: `${alvo.pathname}${alvo.search}`,
        method: "GET",
        headers: { "X-Service-Secret": segredo, Accept: "application/json" },
        rejectUnauthorized: verificarTls(),
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let corpo = "";
        res.setEncoding("utf8");
        res.on("data", (parte) => (corpo += parte));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo }));
      },
    );

    // `timeout` na opção só arma o relógio; abortar é responsabilidade
    // de quem escuta, senão a conexão fica pendurada até o TCP desistir.
    req.on("timeout", () => {
      req.destroy(new Error(`Tempo esgotado (${TIMEOUT_MS}ms) ao consultar o GLPI`));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Erro de configuração: repetir não resolve, e a mensagem tem de dizer isso. */
class ErroConfiguracaoGlpi extends Error {}

/**
 * Busca a lista de usuários ativos, com nova tentativa em falha
 * temporária.
 *
 * 401 falha na hora: segredo errado não se conserta esperando. 502 é o
 * GLPI momentaneamente fora do ar do outro lado — vale insistir, com
 * espera crescente para não somar carga a um servidor em dificuldade.
 */
export async function buscarUsuariosGlpi(): Promise<UsuarioGlpi[]> {
  const url = process.env["GLPI_USUARIOS_URL"];
  const segredo = process.env["GLPI_USUARIOS_SECRET"];

  if (!url || !segredo) {
    throw new ErroConfiguracaoGlpi(
      "GLPI_USUARIOS_URL e GLPI_USUARIOS_SECRET não estão configurados no ambiente.",
    );
  }

  let ultimoErro: unknown;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      const resp = await chamar(url, segredo);

      if (resp.status === 401) {
        throw new ErroConfiguracaoGlpi(
          "GLPI recusou a credencial (401). Confira o GLPI_USUARIOS_SECRET.",
        );
      }
      if (resp.status !== 200) {
        throw new Error(`GLPI respondeu HTTP ${resp.status}`);
      }

      const dados = JSON.parse(resp.corpo) as { usuarios?: unknown };
      if (!Array.isArray(dados.usuarios)) {
        throw new Error('Resposta do GLPI sem o campo "usuarios".');
      }

      // Filtra o que não serve em vez de confiar no formato: um registro
      // sem login viraria uma linha impossível de casar depois.
      return dados.usuarios.filter(
        (u): u is UsuarioGlpi =>
          typeof u === "object" &&
          u !== null &&
          typeof (u as UsuarioGlpi).id === "number" &&
          typeof (u as UsuarioGlpi).login === "string" &&
          (u as UsuarioGlpi).login.trim() !== "" &&
          typeof (u as UsuarioGlpi).nome === "string",
      );
    } catch (erro) {
      if (erro instanceof ErroConfiguracaoGlpi) throw erro;

      ultimoErro = erro;
      if (tentativa < TENTATIVAS) {
        const espera = 1000 * 2 ** (tentativa - 1);
        await new Promise((r) => setTimeout(r, espera));
      }
    }
  }

  const motivo = ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro);
  throw new Error(`Falha ao consultar o GLPI após ${TENTATIVAS} tentativas: ${motivo}`);
}

export interface ResultadoSincronizacao {
  recebidos: number;
  criados: number;
  atualizados: number;
  vinculados: number;
  desativados: number;
}

/**
 * Compara logins ignorando domínio, como o `current-user.server` faz.
 *
 * O GLPI manda `paulort`; a tabela pode ter `ROSSET\paulort`, herdado de
 * cadastro manual. Sem normalizar, a mesma pessoa entraria duas vezes —
 * uma com login do AD e outra do GLPI — e o seletor mostraria as duas.
 */
function normalizarLogin(login: string): string {
  const semDominio = login.includes("\\") ? (login.split("\\").pop() ?? login) : login;
  return semDominio.trim().toLowerCase();
}

/**
 * Traz a lista do GLPI para a tabela `usuarios`.
 *
 * A ordem de tentativa por pessoa não é acidental:
 *
 *   1. Já sincronizada antes (casa por `glpi_user_id`): atualiza nome e
 *      login, porque o GLPI é a fonte para quem veio dele.
 *   2. Existe localmente com o mesmo login (AD ou manual): apenas anexa
 *      o `glpi_user_id`. NÃO sobrescreve nome, e-mail, perfil nem
 *      equipe — esses são do cadastro local, e o GLPI não os conhece.
 *   3. Não existe: cria com origem 'glpi', sem perfil e sem e-mail.
 *
 * Quem sai da lista do GLPI é desativado, nunca apagado: `projetos` e
 * `recursos` apontam para essas linhas, e um DELETE quebraria o
 * histórico de quem foi gerente do quê.
 *
 * Tudo numa transação: uma falha no meio deixaria metade da empresa
 * sincronizada e a outra metade desativada.
 */
export async function sincronizarUsuariosGlpi(): Promise<ResultadoSincronizacao> {
  const usuarios = await buscarUsuariosGlpi();

  const resultado: ResultadoSincronizacao = {
    recebidos: usuarios.length,
    criados: 0,
    atualizados: 0,
    vinculados: 0,
    desativados: 0,
  };

  // Lista vazia é resposta suspeita, não instrução para desativar todo
  // mundo: sem esta guarda, uma falha do outro lado que devolvesse
  // `{"usuarios":[]}` apagaria a empresa do seletor.
  if (usuarios.length === 0) {
    throw new Error("O GLPI devolveu uma lista vazia. Sincronização abortada por segurança.");
  }

  await emTransacao(async (tx) => {
    for (const u of usuarios) {
      const nome = u.nome.trim() || u.login;
      const login = u.login.trim();

      // 1. Já conhecida pelo id do GLPI.
      const porId = await tx.executar(
        `UPDATE usuarios
            SET nome = :nome,
                login = :login,
                ativo = 1,
                sincronizado_em = LOCALTIMESTAMP,
                atualizado_em = LOCALTIMESTAMP
          WHERE glpi_user_id = :glpiId AND origem = 'glpi'`,
        { glpiId: u.id, nome, login },
      );
      if (porId > 0) {
        resultado.atualizados += 1;
        continue;
      }

      // 2. Existe localmente pelo login: só anexa a chave do GLPI.
      const porLogin = await tx.executar(
        `UPDATE usuarios
            SET glpi_user_id = :glpiId,
                sincronizado_em = LOCALTIMESTAMP,
                atualizado_em = LOCALTIMESTAMP
          WHERE LOWER(REGEXP_REPLACE(login, '^.*\\\\', '')) = :loginNormalizado
            AND glpi_user_id IS NULL`,
        { glpiId: u.id, loginNormalizado: normalizarLogin(login) },
      );
      if (porLogin > 0) {
        resultado.vinculados += 1;
        continue;
      }

      // 3. Nova. Sem perfil de acesso: existir para ser escolhida num
      // seletor não é o mesmo que poder entrar no sistema.
      await tx.executar(
        `INSERT INTO usuarios
           (id, glpi_user_id, nome, email, login, origem, admin, ativo,
            sincronizado_em, criado_em, atualizado_em)
         VALUES
           (:id, :glpiId, :nome, NULL, :login, 'glpi', 0, 1,
            LOCALTIMESTAMP, LOCALTIMESTAMP, LOCALTIMESTAMP)
         ON CONFLICT (login) DO UPDATE
            SET glpi_user_id = EXCLUDED.glpi_user_id,
                sincronizado_em = LOCALTIMESTAMP`,
        { id: crypto.randomUUID(), glpiId: u.id, nome, login },
      );
      resultado.criados += 1;
    }

    // Saiu da lista do GLPI: desativa, mantendo a linha pelas FKs.
    const desativados = await tx.executar(
      `UPDATE usuarios
          SET ativo = 0, atualizado_em = LOCALTIMESTAMP
        WHERE origem = 'glpi'
          AND ativo = 1
          AND NOT (glpi_user_id = ANY(:ids))`,
      { ids: usuarios.map((u) => u.id) },
    );
    resultado.desativados = desativados;
  });

  return resultado;
}

export interface StatusGlpi {
  configurado: boolean;
  /** Quantos usuários vieram do GLPI e estão ativos. */
  ativos: number;
  /** Última sincronização bem-sucedida, pela marca nas linhas. */
  ultimaSincronizacao: Date | null;
}

/** Para a tela de administração dizer se a integração está de pé. */
export async function statusGlpi(): Promise<StatusGlpi> {
  const r = await consultar<{ ativos: number; ultima: Date | null }>(
    `SELECT COUNT(*)::int AS ativos, MAX(sincronizado_em) AS ultima
       FROM usuarios WHERE origem = 'glpi' AND ativo = 1`,
  );

  return {
    configurado: Boolean(
      process.env["GLPI_USUARIOS_URL"] && process.env["GLPI_USUARIOS_SECRET"],
    ),
    ativos: r[0]?.ativos ?? 0,
    ultimaSincronizacao: r[0]?.ultima ?? null,
  };
}

/** Zera o vínculo de uma pessoa, para recuperar erro de casamento por login. */
export async function desvincularGlpi(usuarioId: string): Promise<void> {
  await executar(`UPDATE usuarios SET glpi_user_id = NULL WHERE id = :id`, { id: usuarioId });
}