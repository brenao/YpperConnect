import { consultar, consultarUm, executar } from "@/integrations/oracle/client.server";
import { ErroDominio, deBool, paraBool } from "./tipos";
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

interface Linha {
  id: string;
  nome: string;
  email: string;
  login: string;
  departamento: string | null;
  equipeId: string | null;
  equipeNome: string | null;
  perfilId: string | null;
  origem: "ad" | "manual";
  admin: number;
  ativo: number;
}

const SELECT_BASE = `
  SELECT u.id, u.nome, u.email, u.login, u.departamento,
         u.equipe_id, e.nome AS equipe_nome,
         u.perfil_id, u.origem, u.admin, u.ativo
    FROM usuarios u
    LEFT JOIN equipes e ON e.id = u.equipe_id`;

const mapear = (l: Linha): Usuario => ({
  id: l.id,
  nome: l.nome,
  email: l.email,
  login: l.login,
  departamento: l.departamento,
  equipeId: l.equipeId,
  equipeNome: l.equipeNome,
  perfilId: l.perfilId,
  origem: l.origem,
  admin: paraBool(l.admin),
  ativo: paraBool(l.ativo),
});

export async function listarUsuarios(apenasAtivos = true): Promise<Usuario[]> {
  const sql = apenasAtivos
    ? `${SELECT_BASE} WHERE u.ativo = 1 ORDER BY u.nome`
    : `${SELECT_BASE} ORDER BY u.nome`;
  return (await consultar<Linha>(sql)).map(mapear);
}

export async function buscarUsuario(id: string): Promise<Usuario | null> {
  const l = await consultarUm<Linha>(`${SELECT_BASE} WHERE u.id = :id`, { id });
  return l ? mapear(l) : null;
}

/** Usado pela futura sincronização com o AD. */
export async function buscarUsuarioPorLogin(login: string): Promise<Usuario | null> {
  const l = await consultarUm<Linha>(`${SELECT_BASE} WHERE u.login = :login`, { login });
  return l ? mapear(l) : null;
}

export async function listarAtendentes(): Promise<Usuario[]> {
  const l = await consultar<Linha>(
    `${SELECT_BASE} WHERE u.ativo = 1 AND u.equipe_id IS NOT NULL ORDER BY u.nome`,
  );
  return l.map(mapear);
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

  await executar(
    `INSERT INTO usuarios
       (id, nome, email, login, departamento, equipe_id, perfil_id,
        origem, admin, ativo, criado_em, atualizado_em)
     VALUES
       (:id, :nome, :email, :login, :departamento, :equipeId, :perfilId,
        'manual', :admin, 1, SYSTIMESTAMP, SYSTIMESTAMP)`,
    {
      id: d.id,
      nome: d.nome,
      email: d.email,
      login: d.login,
      departamento: d.departamento ?? null,
      equipeId: d.equipeId ?? null,
      perfilId: d.perfilId ?? null,
      admin: deBool(d.admin),
    },
  );
}

export async function atualizarUsuario(
  ctx: ContextoUsuario,
  id: string,
  d: AlteracaoUsuario,
): Promise<void> {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar usuários");

  const n = await executar(
    `UPDATE usuarios
        SET nome = NVL(:nome, nome),
            email = NVL(:email, email),
            departamento = :departamento,
            equipe_id = :equipeId,
            perfil_id = :perfilId,
            admin = NVL(:admin, admin),
            atualizado_em = SYSTIMESTAMP
      WHERE id = :id`,
    {
      id,
      nome: d.nome ?? null,
      email: d.email ?? null,
      departamento: d.departamento ?? null,
      equipeId: d.equipeId ?? null,
      perfilId: d.perfilId ?? null,
      admin: d.admin === undefined ? null : deBool(d.admin),
    },
  );
  if (n === 0) throw new ErroDominio(`Usuário ${id} não encontrado`);
}

/**
 * Desativa em vez de excluir. Chamados históricos referenciam o usuário
 * por FK, e a trilha de auditoria não pode perder o autor.
 */
export async function definirUsuarioAtivo(ctx: ContextoUsuario, id: string, ativo: boolean) {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar usuários");
  if (id === ctx.id && !ativo) throw new ErroDominio("Você não pode desativar a si mesmo");

  await executar(
    `UPDATE usuarios SET ativo = :ativo, atualizado_em = SYSTIMESTAMP WHERE id = :id`,
    { id, ativo: deBool(ativo) },
  );
}
