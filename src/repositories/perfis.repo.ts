import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Perfis de acesso da empresa. Mesma interface e regras do repositório
 * legado; por dentro, Supabase com a sessão de quem chamou.
 */

export interface PerfilAcesso {
  id: string;
  nome: string;
  descricao: string | null;
  modulos: string[];
  funcionalidades: string[];
  /** Perfil embutido na aplicação: pode ser ajustado, nunca excluído. */
  sistema: boolean;
  ativo: boolean;
}

function exigirAdmin(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin) throw new ErroDominio(`Somente administradores podem ${acao}`);
}

async function tenantAtual(): Promise<string> {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return (await getUsuarioAtual()).tenantId;
}

function falha(erro: { code?: string; message: string }): never {
  if (erro.code === "23505") throw new ErroDominio("Já existe um perfil com esse nome.");
  if (erro.code === "P0002") throw new ErroDominio(erro.message);
  throw new Error(erro.message);
}

/** Perfis com módulos e funcionalidades em 3 consultas, não N+1. */
export async function listarPerfis(): Promise<PerfilAcesso[]> {
  const tenantId = await tenantAtual();
  const sb = getSupabaseServerClient();

  const [perfis, modulos, features] = await Promise.all([
    sb
      .from("perfis_acesso")
      .select("id, nome, descricao, sistema, ativo")
      .eq("tenant_id", tenantId)
      .order("nome"),
    sb.from("perfil_modulos").select("perfil_id, modulo_key").eq("tenant_id", tenantId),
    sb.from("perfil_features").select("perfil_id, feature_key").eq("tenant_id", tenantId),
  ]);
  if (perfis.error) falha(perfis.error);
  if (modulos.error) falha(modulos.error);
  if (features.error) falha(features.error);

  const porPerfilModulo = new Map<string, string[]>();
  for (const m of modulos.data ?? []) {
    const l = porPerfilModulo.get(m.perfil_id as string) ?? [];
    l.push(m.modulo_key as string);
    porPerfilModulo.set(m.perfil_id as string, l);
  }

  const porPerfilFeature = new Map<string, string[]>();
  for (const f of features.data ?? []) {
    const l = porPerfilFeature.get(f.perfil_id as string) ?? [];
    l.push(f.feature_key as string);
    porPerfilFeature.set(f.perfil_id as string, l);
  }

  return (perfis.data ?? []).map((p) => ({
    id: p.id as string,
    nome: p.nome as string,
    descricao: (p.descricao as string | null) ?? null,
    sistema: p.sistema as boolean,
    ativo: p.ativo as boolean,
    modulos: porPerfilModulo.get(p.id as string) ?? [],
    funcionalidades: porPerfilFeature.get(p.id as string) ?? [],
  }));
}

/** Perfil novo nasce com acesso apenas ao painel inicial. */
export async function criarPerfil(
  ctx: ContextoUsuario,
  dados: { nome: string; descricao?: string | null | undefined },
): Promise<string> {
  exigirAdmin(ctx, "criar perfis");
  if (dados.nome.trim().length < 3) throw new ErroDominio("Informe o nome do perfil");

  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("perfis_acesso")
    .insert({
      tenant_id: ctx.tenantId,
      nome: dados.nome.trim(),
      descricao: dados.descricao?.trim() ?? null,
    })
    .select("id")
    .single();
  if (error) falha(error);

  const id = data.id as string;
  const inicial = await sb
    .from("perfil_modulos")
    .insert({ tenant_id: ctx.tenantId, perfil_id: id, modulo_key: "/" });
  if (inicial.error) falha(inicial.error);
  return id;
}

export interface AlteracaoPerfil {
  nome?: string | undefined;
  descricao?: string | null | undefined;
  ativo?: boolean | undefined;
}

export async function atualizarPerfil(
  ctx: ContextoUsuario,
  id: string,
  d: AlteracaoPerfil,
): Promise<void> {
  exigirAdmin(ctx, "alterar perfis");

  const mudancas: Record<string, unknown> = { descricao: d.descricao?.trim() ?? null };
  if (d.nome !== undefined) mudancas["nome"] = d.nome.trim();
  if (d.ativo !== undefined) mudancas["ativo"] = d.ativo;

  const { data, error } = await getSupabaseServerClient()
    .from("perfis_acesso")
    .update(mudancas)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Perfil ${id} não encontrado`);
}

/**
 * Desativa em vez de excluir. Usuários apontam para o perfil por FK, e
 * perfil de sistema nunca sai — é o que garante que sempre exista um
 * caminho de acesso administrativo.
 */
export async function desativarPerfil(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirAdmin(ctx, "desativar perfis");
  const sb = getSupabaseServerClient();

  const p = await sb
    .from("perfis_acesso")
    .select("sistema")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (p.error) falha(p.error);
  if (!p.data) throw new ErroDominio(`Perfil ${id} não encontrado`);
  if (p.data.sistema) {
    throw new ErroDominio("Perfis padrão do sistema não podem ser desativados");
  }

  const emUso = await sb
    .from("tenant_membros")
    .select("usuario_id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("perfil_id", id)
    .eq("ativo", true);
  if (emUso.error) falha(emUso.error);
  if ((emUso.count ?? 0) > 0) {
    throw new ErroDominio(
      `Há ${emUso.count} usuário(s) ativo(s) com este perfil. Reatribua antes de desativar.`,
    );
  }

  const { error } = await sb
    .from("perfis_acesso")
    .update({ ativo: false })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) falha(error);
}

/**
 * Substitui módulos e funcionalidades do perfil. Numa transação (função
 * do banco): um perfil sem módulos por falha parcial trancaria o usuário
 * para fora do sistema.
 */
export async function salvarPermissoes(
  ctx: ContextoUsuario,
  perfilId: string,
  modulos: string[],
  funcionalidades: string[],
): Promise<void> {
  exigirAdmin(ctx, "alterar permissões");
  const { error } = await getSupabaseServerClient().rpc("salvar_permissoes_perfil", {
    p_perfil: perfilId,
    p_modulos: [...new Set(modulos)],
    p_features: [...new Set(funcionalidades)],
  });
  if (error) falha(error);
}
