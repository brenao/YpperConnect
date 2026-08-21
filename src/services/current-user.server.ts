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

export interface ContextoUsuario {
  id: string;
  nome: string;
  email: string;
  admin: boolean;
  perfilId: string | null;
  equipeId: string | null;
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

  const linha = await consultarUm<LinhaUsuario>(
    `SELECT id, nome, email, admin, perfil_id, equipe_id
       FROM usuarios
      WHERE LOWER(REGEXP_REPLACE(login, '^.*\\\\', '')) = :login
        AND ativo = 1`,
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

  return {
    id: linha.id,
    nome: linha.nome,
    email: linha.email,
    admin: linha.admin === 1,
    perfilId: linha.perfilId,
    equipeId: linha.equipeId,
  };
}
