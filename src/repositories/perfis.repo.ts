import { consultar, emTransacao } from "@/integrations/oracle/client.server";
import { ErroDominio, paraBool } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

export interface PerfilAcesso {
  id: string;
  nome: string;
  descricao: string | null;
  modulos: string[];
  funcionalidades: string[];
  sistema: boolean;
  ativo: boolean;
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
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar permissões");

  await emTransacao(async (tx) => {
    const existe = await tx.consultar(`SELECT id FROM perfis_acesso WHERE id = :id`, {
      id: perfilId,
    });
    if (existe.length === 0) throw new ErroDominio(`Perfil ${perfilId} não encontrado`);

    await tx.executar(`DELETE FROM perfil_modulos WHERE perfil_id = :id`, { id: perfilId });
    await tx.executar(`DELETE FROM perfil_features WHERE perfil_id = :id`, { id: perfilId });

    for (const m of new Set(modulos)) {
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
