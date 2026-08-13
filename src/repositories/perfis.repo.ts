import {
  consultar,
  consultarUm,
  executar,
  emTransacao,
} from "@/integrations/postgres/client.server";
import { ErroDominio, deBool, paraBool } from "./tipos";
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
    consultar<{
      id: string;
      nome: string;
      descricao: string | null;
      sistema: number;
      ativo: number;
    }>(`SELECT id, nome, descricao, sistema, ativo FROM perfis_acesso ORDER BY nome`),
    consultar<{ perfilId: string; moduloKey: string }>(
      `SELECT perfil_id, modulo_key FROM perfil_modulos`,
    ),
    consultar<{ perfilId: string; featureKey: string }>(
      `SELECT perfil_id, feature_key FROM perfil_features`,
    ),
  ]);

  const porPerfilModulo = new Map<string, string[]>();
  for (const m of modulos) {
    const l = porPerfilModulo.get(m.perfilId) ?? [];
    l.push(m.moduloKey);
    porPerfilModulo.set(m.perfilId, l);
  }

  const porPerfilFeature = new Map<string, string[]>();
  for (const f of features) {
    const l = porPerfilFeature.get(f.perfilId) ?? [];
    l.push(f.featureKey);
    porPerfilFeature.set(f.perfilId, l);
  }

  return perfis.map((p) => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    sistema: paraBool(p.sistema),
    ativo: paraBool(p.ativo),
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
  await emTransacao(async (tx) => {
    await tx.executar(
      `INSERT INTO perfis_acesso (id, nome, descricao, sistema, ativo)
       VALUES (:id, :nome, :descricao, 0, 1)`,
      { id, nome: dados.nome.trim(), descricao: dados.descricao?.trim() ?? null },
    );
    await tx.executar(`INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES (:id, '/')`, {
      id,
    });
  });
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

  const n = await executar(
    `UPDATE perfis_acesso
        SET nome = COALESCE(:nome, nome),
            descricao = :descricao,
            ativo = COALESCE(:ativo, ativo)
      WHERE id = :id`,
    {
      id,
      nome: d.nome?.trim() ?? null,
      descricao: d.descricao?.trim() ?? null,
      ativo: d.ativo === undefined ? null : deBool(d.ativo),
    },
  );
  if (n === 0) throw new ErroDominio(`Perfil ${id} não encontrado`);
}

/**
 * Desativa em vez de excluir. Usuários apontam para o perfil por FK, e
 * perfil de sistema nunca sai — é o que garante que sempre exista um
 * caminho de acesso administrativo.
 */
export async function desativarPerfil(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirAdmin(ctx, "desativar perfis");

  const p = await consultarUm<{ sistema: number }>(
    `SELECT sistema FROM perfis_acesso WHERE id = :id`,
    { id },
  );
  if (!p) throw new ErroDominio(`Perfil ${id} não encontrado`);
  if (paraBool(p.sistema)) {
    throw new ErroDominio("Perfis padrão do sistema não podem ser desativados");
  }

  const emUso = await consultarUm<{ total: number }>(
    `SELECT COUNT(*) AS total FROM usuarios WHERE perfil_id = :id AND ativo = 1`,
    { id },
  );
  if ((emUso?.total ?? 0) > 0) {
    throw new ErroDominio(
      `Há ${emUso?.total} usuário(s) ativo(s) com este perfil. Reatribua antes de desativar.`,
    );
  }

  await executar(`UPDATE perfis_acesso SET ativo = 0 WHERE id = :id`, { id });
}

/**
 * Substitui módulos e funcionalidades do perfil. Em transação: um perfil
 * sem módulos por falha parcial trancaria o usuário para fora do sistema.
 */
export async function salvarPermissoes(
  ctx: ContextoUsuario,
  perfilId: string,
  modulos: string[],
  funcionalidades: string[],
): Promise<void> {
  exigirAdmin(ctx, "alterar permissões");

  await emTransacao(async (tx) => {
    const existe = await tx.consultar(`SELECT id FROM perfis_acesso WHERE id = :id`, {
      id: perfilId,
    });
    if (existe.length === 0) throw new ErroDominio(`Perfil ${perfilId} não encontrado`);

    await tx.executar(`DELETE FROM perfil_modulos WHERE perfil_id = :id`, { id: perfilId });
    await tx.executar(`DELETE FROM perfil_features WHERE perfil_id = :id`, { id: perfilId });

    // "/" é sempre incluído: sem painel inicial o usuário não tem para
    // onde ir depois de entrar.
    for (const m of new Set(["/", ...modulos])) {
      await tx.executar(`INSERT INTO perfil_modulos (perfil_id, modulo_key) VALUES (:id, :chave)`, {
        id: perfilId,
        chave: m,
      });
    }
    for (const f of new Set(funcionalidades)) {
      await tx.executar(
        `INSERT INTO perfil_features (perfil_id, feature_key) VALUES (:id, :chave)`,
        { id: perfilId, chave: f },
      );
    }
  });
}
