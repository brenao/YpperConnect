import { checar, db, linhas } from "@/integrations/db/client.server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

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

/**
 * Carrega perfis com módulos e funcionalidades em 3 queries, não N+1.
 * A tela de permissões lista todos de uma vez.
 */
export async function listarPerfis(): Promise<PerfilAcesso[]> {
  const [perfis, modulos, features] = await Promise.all([
    linhas(
      await db
        .from("perfis_acesso")
        .select("id, nome, descricao, sistema, ativo")
        .order("nome"),
    ),
    linhas(await db.from("perfil_modulos").select("perfil_id, modulo_key")),
    linhas(await db.from("perfil_features").select("perfil_id, feature_key")),
  ]);

  const porPerfilModulo = new Map<string, string[]>();
  for (const m of modulos) {
    const l = porPerfilModulo.get(m.perfil_id) ?? [];
    l.push(m.modulo_key);
    porPerfilModulo.set(m.perfil_id, l);
  }

  const porPerfilFeature = new Map<string, string[]>();
  for (const f of features) {
    const l = porPerfilFeature.get(f.perfil_id) ?? [];
    l.push(f.feature_key);
    porPerfilFeature.set(f.perfil_id, l);
  }

  return perfis.map((p) => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    sistema: p.sistema,
    ativo: p.ativo,
    modulos: porPerfilModulo.get(p.id) ?? [],
    funcionalidades: porPerfilFeature.get(p.id) ?? [],
  }));
}

/** Perfil novo nasce com acesso apenas ao painel inicial. */
export async function criarPerfil(
  ctx: ContextoUsuario,
  dados: { nome: string; descricao?: string | null | undefined },
): Promise<string> {
  exigirAdmin(ctx, "criar perfis");
  if (dados.nome.trim().length < 3) throw new ErroDominio("Informe o nome do perfil");

  const id = crypto.randomUUID();
  checar(
    await db.from("perfis_acesso").insert({
      id,
      nome: dados.nome.trim(),
      descricao: dados.descricao?.trim() ?? null,
      sistema: false,
      ativo: true,
    }),
  );
  checar(await db.from("perfil_modulos").insert({ perfil_id: id, modulo_key: "/" }));
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

  const atualizacao: { nome?: string; descricao: string | null; ativo?: boolean } = {
    descricao: d.descricao?.trim() ?? null,
  };
  if (d.nome !== undefined) atualizacao.nome = d.nome.trim();
  if (d.ativo !== undefined) atualizacao.ativo = d.ativo;

  const { data: atualizados, error } = await db
    .from("perfis_acesso")
    .update(atualizacao)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`Erro no banco: ${error.message}`);
  if (!atualizados || atualizados.length === 0) throw new ErroDominio(`Perfil ${id} não encontrado`);
}

/**
 * Desativa em vez de excluir. Usuários apontam para o perfil por FK, e
 * perfil de sistema nunca sai — é o que garante que sempre exista um
 * caminho de acesso administrativo.
 */
export async function desativarPerfil(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirAdmin(ctx, "desativar perfis");

  const { data: p, error: erroPerfil } = await db
    .from("perfis_acesso")
    .select("sistema")
    .eq("id", id)
    .maybeSingle();
  if (erroPerfil) throw new Error(`Erro no banco: ${erroPerfil.message}`);
  if (!p) throw new ErroDominio(`Perfil ${id} não encontrado`);
  if (p.sistema) {
    throw new ErroDominio("Perfis padrão do sistema não podem ser desativados");
  }

  const { count, error: erroUso } = await db
    .from("usuarios")
    .select("id", { count: "exact", head: true })
    .eq("perfil_id", id)
    .eq("ativo", true);
  if (erroUso) throw new Error(`Erro no banco: ${erroUso.message}`);
  if ((count ?? 0) > 0) {
    throw new ErroDominio(
      `Há ${count} usuário(s) ativo(s) com este perfil. Reatribua antes de desativar.`,
    );
  }

  checar(await db.from("perfis_acesso").update({ ativo: false }).eq("id", id));
}

/**
 * Substitui módulos e funcionalidades do perfil. Sequencial: delete das
 * duas tabelas seguido de insert dos novos valores.
 */
export async function salvarPermissoes(
  ctx: ContextoUsuario,
  perfilId: string,
  modulos: string[],
  funcionalidades: string[],
): Promise<void> {
  exigirAdmin(ctx, "alterar permissões");

  const { data: existe, error: erroExiste } = await db
    .from("perfis_acesso")
    .select("id")
    .eq("id", perfilId)
    .maybeSingle();
  if (erroExiste) throw new Error(`Erro no banco: ${erroExiste.message}`);
  if (!existe) throw new ErroDominio(`Perfil ${perfilId} não encontrado`);

  checar(await db.from("perfil_modulos").delete().eq("perfil_id", perfilId));
  checar(await db.from("perfil_features").delete().eq("perfil_id", perfilId));

  // "/" é sempre incluído: sem painel inicial o usuário não tem para
  // onde ir depois de entrar.
  const modulosUnicos = [...new Set(["/", ...modulos])];
  checar(
    await db
      .from("perfil_modulos")
      .insert(modulosUnicos.map((m) => ({ perfil_id: perfilId, modulo_key: m }))),
  );

  const featuresUnicas = [...new Set(funcionalidades)];
  if (featuresUnicas.length > 0) {
    checar(
      await db
        .from("perfil_features")
        .insert(featuresUnicas.map((f) => ({ perfil_id: perfilId, feature_key: f }))),
    );
  }
}
