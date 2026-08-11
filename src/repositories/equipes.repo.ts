import { checar, db, linhas } from "@/integrations/db/client.server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

export interface Equipe {
  id: string;
  nome: string;
  ativo: boolean;
}

export async function listarEquipes(apenasAtivas = true): Promise<Equipe[]> {
  let query = db.from("equipes").select("id, nome, ativo").order("nome");
  if (apenasAtivas) query = query.eq("ativo", true);
  return linhas(await query);
}

export async function buscarEquipe(id: string): Promise<Equipe | null> {
  const r = await db.from("equipes").select("id, nome, ativo").eq("id", id).maybeSingle();
  return checar(r);
}

export async function criarEquipe(ctx: ContextoUsuario, dados: { id: string; nome: string }) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem criar equipes");
  checar(await db.from("equipes").insert({ id: dados.id, nome: dados.nome, ativo: true }));
}

export async function renomearEquipe(ctx: ContextoUsuario, id: string, nome: string) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar equipes");
  const atual = await buscarEquipe(id);
  if (!atual) throw new ErroDominio(`Equipe ${id} não encontrada`);
  checar(await db.from("equipes").update({ nome }).eq("id", id));
}

/**
 * Desativa em vez de excluir: chamados e usuários históricos apontam
 * para a equipe por FK. DELETE quebraria o histórico.
 */
export async function definirEquipeAtiva(ctx: ContextoUsuario, id: string, ativo: boolean) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar equipes");
  checar(await db.from("equipes").update({ ativo }).eq("id", id));
}
