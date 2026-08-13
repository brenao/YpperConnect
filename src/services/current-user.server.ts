import { consultarUm } from "@/integrations/postgres/client.server";

/**
 * Contexto de identidade da aplicação.
 *
 * IMPLEMENTAÇÃO PROVISÓRIA: devolve um usuário fixo do banco enquanto a
 * autenticação via AD não existe.
 *
 * A assinatura é definitiva de propósito. Todo repositório que grava
 * recebe o ContextoUsuario desde já, porque chamado_historico.autor_id
 * e chamado_interacoes.autor_id dependem dele. Quando o AD entrar, só
 * o corpo desta função muda — nenhum repositório precisa ser tocado.
 */

export interface ContextoUsuario {
  id: string;
  nome: string;
  email: string;
  admin: boolean;
  perfilId: string | null;
  equipeId: string | null;
}

/** Trocar por leitura de sessão quando a autenticação entrar. */
const LOGIN_PROVISORIO = "ROSSET\\breno";

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  admin: number;
  perfilId: string | null;
  equipeId: string | null;
}

export async function getUsuarioAtual(): Promise<ContextoUsuario> {
  const linha = await consultarUm<LinhaUsuario>(
    `SELECT id, nome, email, admin, perfil_id, equipe_id
       FROM usuarios
      WHERE login = :login AND ativo = 1`,
    { login: LOGIN_PROVISORIO },
  );

  if (!linha) {
    throw new Error(
      `Usuário provisório '${LOGIN_PROVISORIO}' não encontrado. Rode db/postgres/03-seed-inicial.sql.`,
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
