import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Departamentos da empresa. Cadastro, e não texto livre, pelo mesmo
 * motivo dos fornecedores: "TI", "T.I." e "Tecnologia" virariam três
 * áreas na primeira semana.
 *
 * A marca `ti` é o que libera a equipe de TI para a pessoa e decide o
 * perfil do cargo. Excluir é lógico: quem estava no departamento
 * continua apontando para ele.
 */

export interface Departamento {
  id: string;
  nome: string;
  ti: boolean;
  ativo: boolean;
  /** Pessoas ativas no departamento. */
  pessoas: number;
}

function exigirAdmin(ctx: ContextoUsuario): void {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar departamentos");
}

function falha(erro: { code?: string; message: string }): never {
  if (erro.code === "23505") throw new ErroDominio("Já existe um departamento com este nome.");
  if (erro.code === "23514") throw new ErroDominio("O nome deve ter entre 2 e 80 caracteres.");
  if (erro.code === "42501")
    throw new ErroDominio("Somente administradores podem alterar departamentos");
  if (erro.code === "P0001") throw new ErroDominio(erro.message);
  throw new Error(erro.message);
}

export async function listarDepartamentos(ctx: ContextoUsuario): Promise<Departamento[]> {
  const sb = getSupabaseServerClient();
  const [deps, membros] = await Promise.all([
    sb.from("departamentos").select("id, nome, ti, ativo").eq("tenant_id", ctx.tenantId),
    sb
      .from("tenant_membros")
      .select("departamento_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("ativo", true)
      .not("departamento_id", "is", null),
  ]);
  if (deps.error) falha(deps.error);
  if (membros.error) falha(membros.error);

  const contagem = new Map<string, number>();
  for (const m of membros.data ?? []) {
    const id = m.departamento_id as string;
    contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }

  return (deps.data ?? [])
    .map((d) => ({
      id: d.id as string,
      nome: d.nome as string,
      ti: d.ti as boolean,
      ativo: d.ativo as boolean,
      pessoas: contagem.get(d.id as string) ?? 0,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function criarDepartamento(
  ctx: ContextoUsuario,
  d: { nome: string; ti: boolean },
): Promise<string> {
  exigirAdmin(ctx);
  const { data, error } = await getSupabaseServerClient()
    .from("departamentos")
    .insert({ tenant_id: ctx.tenantId, nome: d.nome.trim(), ti: d.ti })
    .select("id")
    .single();
  if (error) falha(error);
  return data.id as string;
}

export async function atualizarDepartamento(
  ctx: ContextoUsuario,
  id: string,
  d: { nome?: string | undefined; ti?: boolean | undefined },
): Promise<void> {
  exigirAdmin(ctx);
  const mudancas: Record<string, unknown> = {};
  if (d.nome !== undefined) mudancas["nome"] = d.nome.trim();
  if (d.ti !== undefined) mudancas["ti"] = d.ti;
  if (Object.keys(mudancas).length === 0) return;

  const { data, error } = await getSupabaseServerClient()
    .from("departamentos")
    .update(mudancas)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio("Departamento não encontrado.");
}

export async function definirDepartamentoAtivo(
  ctx: ContextoUsuario,
  id: string,
  ativo: boolean,
): Promise<void> {
  exigirAdmin(ctx);
  const { error } = await getSupabaseServerClient()
    .from("departamentos")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) falha(error);
}

/** Quantas pessoas ativas estão no departamento (mostrado antes de excluir). */
export async function vinculosDepartamento(ctx: ContextoUsuario, id: string): Promise<number> {
  exigirAdmin(ctx);
  const { data, error } = await getSupabaseServerClient().rpc("vinculos_departamento", {
    p_id: id,
  });
  if (error) falha(error);
  return Number(data ?? 0);
}

export async function excluirDepartamento(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirAdmin(ctx);
  const { error } = await getSupabaseServerClient().rpc("excluir_departamento", { p_id: id });
  if (error) falha(error);
}