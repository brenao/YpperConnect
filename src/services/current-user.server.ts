import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { consultarUm } from "@/integrations/postgres/client.server";

/**
 * Contexto de identidade da aplicação. SOMENTE SERVIDOR.
 *
 * Quem autentica é o OpenResty do rosset16: o `check-token.lua` barra
 * quem não tem token válido e redireciona para o /vuelogin. Quando a
 * requisição chega aqui, ela já passou por essa porta.
 *
 * O papel desta função é outro: descobrir QUEM é a pessoa. O token
 * carrega só o `username`; nome, e-mail, perfil e equipe vêm da tabela
 * `usuarios`. Quem não estiver cadastrado lá não usa o sistema, mesmo
 * autenticando no /vuelogin — é a fronteira entre "entrou na rede" e
 * "tem acesso a este sistema".
 */

/**
 * Enxerga o portfólio inteiro, em leitura.
 *
 * É a visão de diretoria: responde pela carteira toda e precisa ver
 * projeto de qualquer área, inclusive o que ninguém indicou para ela.
 * Não dá direito de escrita — quem responde pelo projeto é quem o
 * executa, e diretoria que edita cronograma alheio produz plano que o
 * time não reconhece.
 */
export const FEATURE_PROJETOS_DIRETORIA = "projetos.visao_diretoria";

/**
 * Enxerga os projetos da própria equipe, em leitura.
 *
 * É o gestor de portfólio. O time vem de `usuarios.equipe_id`: são
 * "seus" os projetos em que alguém da equipe é gerente, patrocinador ou
 * responsável por tarefa. Sem equipe cadastrada, vê apenas os próprios —
 * e é sinal de cadastro incompleto, não de restrição intencional.
 */
export const FEATURE_PROJETOS_PORTFOLIO = "projetos.portfolio";

export interface ContextoUsuario {
  id: string;
  nome: string;
  email: string;
  admin: boolean;
  perfilId: string | null;
  equipeId: string | null;
  /** Chaves de `perfil_features` do perfil do usuário. */
  funcionalidades: string[];
  /** Atalhos dos papéis de projeto, para não espalhar string mágica. */
  visaoDiretoriaProjetos: boolean;
  gestorPortfolio: boolean;
}

/**
 * Usado só quando não há token: desenvolvimento local, fora do proxy.
 * Em produção a requisição nunca chega sem token, porque o Lua barra
 * antes.
 */
const LOGIN_DESENVOLVIMENTO = "breno";

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  admin: number;
  perfilId: string | null;
  equipeId: string | null;
  /** Chaves separadas por vírgula, agregadas no SQL. */
  funcionalidades: string | null;
}

/**
 * Extrai o `username` do JWT sem validar a assinatura.
 *
 * A validação é do proxy, e não dá para repeti-la aqui: o segredo de
 * assinatura é do /vuelogin e a aplicação não o conhece. A consequência
 * precisa estar clara — **a aplicação só pode ser exposta atrás do
 * OpenResty**. Publicar a porta do container direto na rede permitiria
 * a qualquer um forjar um token e entrar como quem quisesse.
 *
 * O `exp` também é conferido pelo Lua. Verificamos aqui de novo porque
 * é barato e evita que um token vencido, se escapar, vire sessão eterna.
 */
function usuarioDoToken(token: string): string | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;

  try {
    // JWT usa base64url: '-' e '_' no lugar de '+' e '/'.
    const payload = partes[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const dados = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as {
      username?: unknown;
      exp?: unknown;
    };

    if (typeof dados.exp === "number" && dados.exp * 1000 < Date.now()) return null;
    return typeof dados.username === "string" && dados.username ? dados.username : null;
  } catch {
    return null;
  }
}

/**
 * O token pode chegar por dois caminhos: o header `Authorization` que o
 * `ypper.conf` repassa, ou o cookie `Token` do domínio. O header vem
 * primeiro porque é o contrato explícito do proxy; o cookie é a rede de
 * segurança para o caso de a configuração mudar.
 */
function tokenDaRequisicao(): string | null {
  const auth = getRequestHeader("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const valor = auth.slice(7).trim();
    if (valor) return valor;
  }
  return getCookie("Token") ?? null;
}

/**
 * Compara logins ignorando o domínio.
 *
 * O token traz `breno`; a tabela pode ter `ROSSET\breno`, herdado do
 * cadastro manual. Normalizar aqui evita ter que higienizar a base
 * inteira e continua funcionando quando o AD entrar com o formato dele.
 */
function normalizarLogin(login: string): string {
  const semDominio = login.includes("\\") ? login.split("\\").pop()! : login;
  return semDominio.trim().toLowerCase();
}

export async function getUsuarioAtual(): Promise<ContextoUsuario> {
  const token = tokenDaRequisicao();
  const username = token ? usuarioDoToken(token) : null;
  const login = username ?? LOGIN_DESENVOLVIMENTO;

  // As funcionalidades vêm agregadas na mesma consulta: são lidas em
  // toda requisição, e uma segunda ida ao banco por causa de uma lista
  // de meia dúzia de chaves não se paga.
  const linha = await consultarUm<LinhaUsuario>(
    `SELECT u.id, u.nome, u.email, u.admin, u.perfil_id, u.equipe_id,
            f.chaves AS funcionalidades
       FROM usuarios u
       LEFT JOIN (SELECT perfil_id, STRING_AGG(feature_key, ',') AS chaves
                    FROM perfil_features
                   GROUP BY perfil_id) f
              ON f.perfil_id = u.perfil_id
      WHERE LOWER(REGEXP_REPLACE(u.login, '^.*\\\\', '')) = :login
        AND u.ativo = 1`,
    { login: normalizarLogin(login) },
  );

  if (!linha) {
    // Mensagem distingue os dois casos: sem token é ambiente mal
    // configurado; com token é pessoa que autenticou mas não tem
    // cadastro — e quem lê o log precisa saber qual dos dois.
    throw new Error(
      username
        ? `Usuário '${username}' autenticou mas não está cadastrado no YpperConnect. ` +
            `Peça a um administrador para cadastrá-lo em Administração > Usuários.`
        : `Requisição sem token de autenticação. Em produção isso não deveria acontecer: ` +
            `verifique se a aplicação está atrás do OpenResty.`,
    );
  }

  const funcionalidades = (linha.funcionalidades ?? "").split(",").filter(Boolean);

  return {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    admin: linha.admin === 1,
    perfilId: linha.perfilId,
    equipeId: linha.equipeId,
    funcionalidades,
    visaoDiretoriaProjetos: funcionalidades.includes(FEATURE_PROJETOS_DIRETORIA),
    gestorPortfolio: funcionalidades.includes(FEATURE_PROJETOS_PORTFOLIO),
  };
}
