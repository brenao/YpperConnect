import { checar, db, linhas } from "@/integrations/db/client.server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  login: string;
  departamento: string | null;
  equipeId: string | null;
  equipeNome: string | null;
  perfilId: string | null;
  origem: "ad" | "manual";
  admin: boolean;
  ativo: boolean;
}

interface LinhaUsuario {
  id: string;
  nome: string;
  email: string;
  login: string;
  departamento: string | null;
  equipe_id: string | null;
  perfil_id: string | null;
  origem: string;
  admin: boolean;
  ativo: boolean;
  equipes: { nome: string } | null;
}

const SELECT_BASE = `
  id, nome, email, login, departamento, equipe_id, perfil_id, origem, admin, ativo,
  equipes ( nome )
`;

const mapear = (l: LinhaUsuario): Usuario => ({
  id: l.id,
  nome: l.nome,
  email: l.email,
  login: l.login,
  departamento: l.departamento,
  equipeId: l.equipe_id,
  equipeNome: l.equipes?.nome ?? null,
  perfilId: l.perfil_id,
  origem: l.origem === "ad" ? "ad" : "manual",
  admin: l.admin,
  ativo: l.ativo,
});

export async function listarUsuarios(apenasAtivos = true): Promise<Usuario[]> {
  let query = db.from("usuarios").select(SELECT_BASE).order("nome");
  if (apenasAtivos) query = query.eq("ativo", true);
  const l = linhas(await query);
  return (l as unknown as LinhaUsuario[]).map(mapear);
}

export async function buscarUsuario(id: string): Promise<Usuario | null> {
  const r = await db.from("usuarios").select(SELECT_BASE).eq("id", id).maybeSingle();
  const l = checar(r);
  return l ? mapear(l as unknown as LinhaUsuario) : null;
}

/** Usado pela futura sincronização com o AD. */
export async function buscarUsuarioPorLogin(login: string): Promise<Usuario | null> {
  const r = await db.from("usuarios").select(SELECT_BASE).eq("login", login).maybeSingle();
  const l = checar(r);
  return l ? mapear(l as unknown as LinhaUsuario) : null;
}

export async function listarAtendentes(): Promise<Usuario[]> {
  const r = await db
    .from("usuarios")
    .select(SELECT_BASE)
    .eq("ativo", true)
    .not("equipe_id", "is", null)
    .order("nome");
  const l = linhas(r);
  return (l as unknown as LinhaUsuario[]).map(mapear);
}

export interface DadosUsuario {
  id: string;
  nome: string;
  email: string;
  login: string;
  departamento?: string | null | undefined;
  equipeId?: string | null | undefined;
  perfilId?: string | null | undefined;
  admin?: boolean | undefined;
}

/**
 * Campos alteráveis do usuário.
 *
 * Declarado à mão em vez de Partial<DadosUsuario> porque Partial<> gera
 * `prop?: T` e, sob exactOptionalPropertyTypes, isso recusa `undefined`
 * explícito — que é exatamente o que o objeto vindo do Zod produz.
 */
export interface AlteracaoUsuario {
  nome?: string | undefined;
  email?: string | undefined;
  login?: string | undefined;
  departamento?: string | null | undefined;
  equipeId?: string | null | undefined;
  perfilId?: string | null | undefined;
  admin?: boolean | undefined;
}

export async function criarUsuario(ctx: ContextoUsuario, d: DadosUsuario): Promise<void> {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem criar usuários");

  const agoraIso = new Date().toISOString();
  checar(
    await db.from("usuarios").insert({
      id: d.id,
      nome: d.nome,
      email: d.email,
      login: d.login,
      departamento: d.departamento ?? null,
      equipe_id: d.equipeId ?? null,
      perfil_id: d.perfilId ?? null,
      origem: "manual",
      admin: d.admin ?? false,
      ativo: true,
      criado_em: agoraIso,
      atualizado_em: agoraIso,
    }),
  );
}

export async function atualizarUsuario(
  ctx: ContextoUsuario,
  id: string,
  d: AlteracaoUsuario,
): Promise<void> {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar usuários");

  const atual = await buscarUsuario(id);
  if (!atual) throw new ErroDominio(`Usuário ${id} não encontrado`);

  checar(
    await db
      .from("usuarios")
      .update({
        nome: d.nome ?? atual.nome,
        email: d.email ?? atual.email,
        departamento: d.departamento ?? null,
        equipe_id: d.equipeId ?? null,
        perfil_id: d.perfilId ?? null,
        admin: d.admin ?? atual.admin,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", id),
  );
}

/**
 * Desativa em vez de excluir. Chamados históricos referenciam o usuário
 * por FK, e a trilha de auditoria não pode perder o autor.
 */
export async function definirUsuarioAtivo(ctx: ContextoUsuario, id: string, ativo: boolean) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar usuários");
  if (id === ctx.id && !ativo) throw new ErroDominio("Você não pode desativar a si mesmo");

  checar(
    await db
      .from("usuarios")
      .update({ ativo, atualizado_em: new Date().toISOString() })
      .eq("id", id),
  );
}
