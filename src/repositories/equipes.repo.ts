import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Equipes da empresa. Mesma interface do repositório legado; por dentro,
 * Supabase com a sessão de quem chamou (o RLS confere de novo).
 */

export interface Equipe {
  id: string;
  nome: string;
  ativo: boolean;
}

async function tenantAtual(): Promise<string> {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return (await getUsuarioAtual()).tenantId;
}

function falha(erro: { code?: string; message: string }): never {
  if (erro.code === "23505") throw new ErroDominio("Já existe uma equipe com esse nome.");
  throw new Error(erro.message);
}

export async function listarEquipes(apenasAtivas = true): Promise<Equipe[]> {
  let q = getSupabaseServerClient()
    .from("equipes")
    .select("id, nome, ativo")
    .eq("tenant_id", await tenantAtual());
  if (apenasAtivas) q = q.eq("ativo", true);
  const { data, error } = await q.order("nome");
  if (error) falha(error);
  return (data ?? []) as Equipe[];
}

export async function buscarEquipe(id: string): Promise<Equipe | null> {
  const { data, error } = await getSupabaseServerClient()
    .from("equipes")
    .select("id, nome, ativo")
    .eq("tenant_id", await tenantAtual())
    .eq("id", id)
    .maybeSingle();
  if (error) falha(error);
  return (data as Equipe | null) ?? null;
}

/** O `id` gerado pela server function é ignorado: o banco gera o UUID. */
export async function criarEquipe(ctx: ContextoUsuario, dados: { id: string; nome: string }) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem criar equipes");
  const { error } = await getSupabaseServerClient()
    .from("equipes")
    .insert({ tenant_id: ctx.tenantId, nome: dados.nome });
  if (error) falha(error);
}

export async function renomearEquipe(ctx: ContextoUsuario, id: string, nome: string) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar equipes");
  const { data, error } = await getSupabaseServerClient()
    .from("equipes")
    .update({ nome })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Equipe ${id} não encontrada`);
}

/**
 * Desativa em vez de excluir: chamados e usuários históricos apontam
 * para a equipe por FK. DELETE quebraria o histórico.
 */
export async function definirEquipeAtiva(ctx: ContextoUsuario, id: string, ativo: boolean) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar equipes");
  const { error } = await getSupabaseServerClient()
    .from("equipes")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) falha(error);
}
