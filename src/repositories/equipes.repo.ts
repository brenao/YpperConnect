import { consultar, consultarUm, executar } from "@/integrations/oracle/client.server";
import { ErroDominio, deBool, paraBool } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

export interface Equipe {
  id: string;
  nome: string;
  ativo: boolean;
}

interface Linha {
  id: string;
  nome: string;
  ativo: number;
}

const mapear = (l: Linha): Equipe => ({ id: l.id, nome: l.nome, ativo: paraBool(l.ativo) });

export async function listarEquipes(apenasAtivas = true): Promise<Equipe[]> {
  const sql = apenasAtivas
    ? `SELECT id, nome, ativo FROM equipes WHERE ativo = 1 ORDER BY nome`
    : `SELECT id, nome, ativo FROM equipes ORDER BY nome`;
  return (await consultar<Linha>(sql)).map(mapear);
}

export async function buscarEquipe(id: string): Promise<Equipe | null> {
  const l = await consultarUm<Linha>(`SELECT id, nome, ativo FROM equipes WHERE id = :id`, { id });
  return l ? mapear(l) : null;
}

export async function criarEquipe(ctx: ContextoUsuario, dados: { id: string; nome: string }) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem criar equipes");
  await executar(`INSERT INTO equipes (id, nome, ativo) VALUES (:id, :nome, 1)`, dados);
}

export async function renomearEquipe(ctx: ContextoUsuario, id: string, nome: string) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar equipes");
  const n = await executar(`UPDATE equipes SET nome = :nome WHERE id = :id`, { id, nome });
  if (n === 0) throw new ErroDominio(`Equipe ${id} não encontrada`);
}

/**
 * Desativa em vez de excluir: chamados e usuários históricos apontam
 * para a equipe por FK. DELETE quebraria o histórico.
 */
export async function definirEquipeAtiva(ctx: ContextoUsuario, id: string, ativo: boolean) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar equipes");
  await executar(`UPDATE equipes SET ativo = :ativo WHERE id = :id`, { id, ativo: deBool(ativo) });
}
