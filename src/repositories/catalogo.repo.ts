import { consultar } from "@/integrations/oracle/client.server";
import { paraBool } from "./tipos";
import type { RecordType } from "@/models/itsm-types";

/**
 * Leitura do catálogo de serviços e do inventário de sistemas.
 *
 * Só leitura por enquanto: a manutenção desses cadastros ainda está na
 * tela de Administração, que roda no store antigo. Quando ela migrar,
 * as funções de escrita entram aqui.
 */

export interface Servico {
  id: string;
  nome: string;
  categoriaId: string | null;
  categoriaNome: string | null;
  descricao: string | null;
  tipoPadrao: RecordType;
  slaHoras: number;
  /** Define o roteamento: chamado aberto neste serviço vai para esta equipe. */
  equipeId: string | null;
  equipeNome: string | null;
  ativo: boolean;
}

export interface Sistema {
  id: string;
  nome: string;
  categoriaId: string | null;
  categoriaNome: string | null;
  criticidade: "alta" | "media" | "baixa";
  equipeId: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  ativo: boolean;
}

interface LinhaServico extends Omit<Servico, "ativo"> {
  ativo: number;
}
interface LinhaSistema extends Omit<Sistema, "ativo"> {
  ativo: number;
}

export async function listarServicos(apenasAtivos = true): Promise<Servico[]> {
  const linhas = await consultar<LinhaServico>(
    `SELECT s.id, s.nome, s.categoria_id, ct.nome AS categoria_nome,
            s.descricao, s.tipo_padrao, s.sla_horas,
            s.equipe_id, eq.nome AS equipe_nome, s.ativo
       FROM servicos s
       LEFT JOIN categorias ct ON ct.id = s.categoria_id
       LEFT JOIN equipes eq ON eq.id = s.equipe_id
      ${apenasAtivos ? "WHERE s.ativo = 1" : ""}
      ORDER BY s.nome`,
  );
  return linhas.map((l) => ({ ...l, ativo: paraBool(l.ativo) }));
}

export async function listarSistemas(apenasAtivos = true): Promise<Sistema[]> {
  const linhas = await consultar<LinhaSistema>(
    `SELECT s.id, s.nome, s.categoria_id, ct.nome AS categoria_nome,
            s.criticidade, s.equipe_id,
            s.responsavel_id, u.nome AS responsavel_nome, s.ativo
       FROM sistemas s
       LEFT JOIN categorias ct ON ct.id = s.categoria_id
       LEFT JOIN usuarios u ON u.id = s.responsavel_id
      ${apenasAtivos ? "WHERE s.ativo = 1" : ""}
      ORDER BY s.nome`,
  );
  return linhas.map((l) => ({ ...l, ativo: paraBool(l.ativo) }));
}
