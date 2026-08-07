import { consultar, consultarUm, executar } from "@/integrations/oracle/client.server";
import { ErroDominio, deBool, paraBool } from "./tipos";
import type { RecordType } from "@/models/itsm-types";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Catálogo de serviços, inventário de sistemas e categorias.
 *
 * Regra transversal: nada é excluído de verdade. Chamados históricos
 * apontam para serviço e sistema por chave estrangeira, e DELETE
 * quebraria o histórico. Tudo desativa com ativo = 0.
 */

export type Criticidade = "alta" | "media" | "baixa";
export type EscopoCategoria = "chamado" | "servico" | "artigo" | "sistema";

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
  geradoPorIa: boolean;
  ativo: boolean;
}

export interface Sistema {
  id: string;
  nome: string;
  descricao: string | null;
  categoriaId: string | null;
  categoriaNome: string | null;
  criticidade: Criticidade;
  equipeId: string | null;
  equipeNome: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  atribuicaoId: string | null;
  atribuicaoNome: string | null;
  ativo: boolean;
}

export interface Categoria {
  id: string;
  nome: string;
  escopo: EscopoCategoria;
  ativo: boolean;
}

function novoId(): string {
  return crypto.randomUUID();
}

function exigirAdmin(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin) throw new ErroDominio(`Somente administradores podem ${acao}`);
}

// ------------------------------------------------------------- categorias

export async function listarCategorias(escopo?: EscopoCategoria): Promise<Categoria[]> {
  const linhas = await consultar<{
    id: string;
    nome: string;
    escopo: EscopoCategoria;
    ativo: number;
  }>(
    `SELECT id, nome, escopo, ativo FROM categorias
      ${escopo ? "WHERE escopo = :escopo" : ""}
      ORDER BY escopo, nome`,
    escopo ? { escopo } : {},
  );
  return linhas.map((l) => ({ ...l, ativo: paraBool(l.ativo) }));
}

export async function criarCategoria(
  ctx: ContextoUsuario,
  dados: { nome: string; escopo: EscopoCategoria },
): Promise<string> {
  exigirAdmin(ctx, "criar categorias");
  if (dados.nome.trim().length < 2) throw new ErroDominio("Informe o nome da categoria");

  const id = novoId();
  await executar(
    `INSERT INTO categorias (id, nome, escopo, ativo) VALUES (:id, :nome, :escopo, 1)`,
    { id, nome: dados.nome.trim(), escopo: dados.escopo },
  );
  return id;
}

export async function renomearCategoria(ctx: ContextoUsuario, id: string, nome: string) {
  exigirAdmin(ctx, "alterar categorias");
  const n = await executar(`UPDATE categorias SET nome = :nome WHERE id = :id`, {
    id,
    nome: nome.trim(),
  });
  if (n === 0) throw new ErroDominio(`Categoria ${id} não encontrada`);
}

export async function definirCategoriaAtiva(ctx: ContextoUsuario, id: string, ativo: boolean) {
  exigirAdmin(ctx, "alterar categorias");
  await executar(`UPDATE categorias SET ativo = :ativo WHERE id = :id`, {
    id,
    ativo: deBool(ativo),
  });
}

// --------------------------------------------------------------- serviços

const SELECT_SERVICO = `
  SELECT s.id, s.nome, s.categoria_id, ct.nome AS categoria_nome,
         s.descricao, s.tipo_padrao, s.sla_horas,
         s.equipe_id, eq.nome AS equipe_nome, s.gerado_por_ia, s.ativo
    FROM servicos s
    LEFT JOIN categorias ct ON ct.id = s.categoria_id
    LEFT JOIN equipes eq ON eq.id = s.equipe_id`;

interface LinhaServico extends Omit<Servico, "ativo" | "geradoPorIa"> {
  ativo: number;
  geradoPorIa: number;
}

const mapServico = (l: LinhaServico): Servico => ({
  ...l,
  ativo: paraBool(l.ativo),
  geradoPorIa: paraBool(l.geradoPorIa),
});

export async function listarServicos(apenasAtivos = true): Promise<Servico[]> {
  const linhas = await consultar<LinhaServico>(
    `${SELECT_SERVICO} ${apenasAtivos ? "WHERE s.ativo = 1" : ""} ORDER BY s.nome`,
  );
  return linhas.map(mapServico);
}

export async function buscarServico(id: string): Promise<Servico | null> {
  const l = await consultarUm<LinhaServico>(`${SELECT_SERVICO} WHERE s.id = :id`, { id });
  return l ? mapServico(l) : null;
}

export interface DadosServico {
  nome: string;
  categoriaId?: string | null | undefined;
  descricao?: string | null | undefined;
  tipoPadrao: RecordType;
  slaHoras: number;
  equipeId?: string | null | undefined;
  geradoPorIa?: boolean | undefined;
}

function validarServico(d: DadosServico): void {
  if (d.nome.trim().length < 3) throw new ErroDominio("Informe o nome do serviço");
  if (!Number.isFinite(d.slaHoras) || d.slaHoras <= 0) {
    throw new ErroDominio("SLA deve ser maior que zero");
  }
}

export async function criarServico(ctx: ContextoUsuario, d: DadosServico): Promise<string> {
  exigirAdmin(ctx, "criar serviços");
  validarServico(d);

  const id = novoId();
  await executar(
    `INSERT INTO servicos
       (id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id,
        gerado_por_ia, ativo, criado_em, atualizado_em)
     VALUES
       (:id, :nome, :categoriaId, :descricao, :tipoPadrao, :slaHoras, :equipeId,
        :geradoPorIa, 1, SYSTIMESTAMP, SYSTIMESTAMP)`,
    {
      id,
      nome: d.nome.trim(),
      categoriaId: d.categoriaId ?? null,
      descricao: d.descricao?.trim() ?? null,
      tipoPadrao: d.tipoPadrao,
      slaHoras: d.slaHoras,
      equipeId: d.equipeId ?? null,
      geradoPorIa: deBool(d.geradoPorIa),
    },
  );
  return id;
}

export async function atualizarServico(
  ctx: ContextoUsuario,
  id: string,
  d: DadosServico,
): Promise<void> {
  exigirAdmin(ctx, "alterar serviços");
  validarServico(d);

  const n = await executar(
    `UPDATE servicos
        SET nome = :nome,
            categoria_id = :categoriaId,
            descricao = :descricao,
            tipo_padrao = :tipoPadrao,
            sla_horas = :slaHoras,
            equipe_id = :equipeId,
            atualizado_em = SYSTIMESTAMP
      WHERE id = :id`,
    {
      id,
      nome: d.nome.trim(),
      categoriaId: d.categoriaId ?? null,
      descricao: d.descricao?.trim() ?? null,
      tipoPadrao: d.tipoPadrao,
      slaHoras: d.slaHoras,
      equipeId: d.equipeId ?? null,
    },
  );
  if (n === 0) throw new ErroDominio(`Serviço ${id} não encontrado`);
}

/**
 * Desativa em vez de excluir: chamados históricos referenciam o serviço
 * por FK. Um serviço inativo some dos formulários mas continua legível
 * nos chamados antigos.
 */
export async function definirServicoAtivo(ctx: ContextoUsuario, id: string, ativo: boolean) {
  exigirAdmin(ctx, "alterar serviços");
  await executar(
    `UPDATE servicos SET ativo = :ativo, atualizado_em = SYSTIMESTAMP WHERE id = :id`,
    { id, ativo: deBool(ativo) },
  );
}

// --------------------------------------------------------------- sistemas

const SELECT_SISTEMA = `
  SELECT s.id, s.nome, s.descricao, s.categoria_id, ct.nome AS categoria_nome,
         s.criticidade, s.equipe_id, eq.nome AS equipe_nome,
         s.responsavel_id, ur.nome AS responsavel_nome,
         s.atribuicao_id, ua.nome AS atribuicao_nome, s.ativo
    FROM sistemas s
    LEFT JOIN categorias ct ON ct.id = s.categoria_id
    LEFT JOIN equipes eq ON eq.id = s.equipe_id
    LEFT JOIN usuarios ur ON ur.id = s.responsavel_id
    LEFT JOIN usuarios ua ON ua.id = s.atribuicao_id`;

interface LinhaSistema extends Omit<Sistema, "ativo"> {
  ativo: number;
}

const mapSistema = (l: LinhaSistema): Sistema => ({ ...l, ativo: paraBool(l.ativo) });

export async function listarSistemas(apenasAtivos = true): Promise<Sistema[]> {
  const linhas = await consultar<LinhaSistema>(
    `${SELECT_SISTEMA} ${apenasAtivos ? "WHERE s.ativo = 1" : ""} ORDER BY s.nome`,
  );
  return linhas.map(mapSistema);
}

export interface DadosSistema {
  nome: string;
  descricao?: string | null | undefined;
  categoriaId?: string | null | undefined;
  criticidade: Criticidade;
  equipeId?: string | null | undefined;
  responsavelId?: string | null | undefined;
  atribuicaoId?: string | null | undefined;
}

export async function criarSistema(ctx: ContextoUsuario, d: DadosSistema): Promise<string> {
  exigirAdmin(ctx, "criar sistemas");
  if (d.nome.trim().length < 2) throw new ErroDominio("Informe o nome do sistema");

  const id = novoId();
  await executar(
    `INSERT INTO sistemas
       (id, nome, descricao, categoria_id, responsavel_id, atribuicao_id,
        equipe_id, criticidade, ativo)
     VALUES
       (:id, :nome, :descricao, :categoriaId, :responsavelId, :atribuicaoId,
        :equipeId, :criticidade, 1)`,
    {
      id,
      nome: d.nome.trim(),
      descricao: d.descricao?.trim() ?? null,
      categoriaId: d.categoriaId ?? null,
      responsavelId: d.responsavelId ?? null,
      atribuicaoId: d.atribuicaoId ?? null,
      equipeId: d.equipeId ?? null,
      criticidade: d.criticidade,
    },
  );
  return id;
}

export async function atualizarSistema(
  ctx: ContextoUsuario,
  id: string,
  d: DadosSistema,
): Promise<void> {
  exigirAdmin(ctx, "alterar sistemas");
  if (d.nome.trim().length < 2) throw new ErroDominio("Informe o nome do sistema");

  const n = await executar(
    `UPDATE sistemas
        SET nome = :nome,
            descricao = :descricao,
            categoria_id = :categoriaId,
            responsavel_id = :responsavelId,
            atribuicao_id = :atribuicaoId,
            equipe_id = :equipeId,
            criticidade = :criticidade
      WHERE id = :id`,
    {
      id,
      nome: d.nome.trim(),
      descricao: d.descricao?.trim() ?? null,
      categoriaId: d.categoriaId ?? null,
      responsavelId: d.responsavelId ?? null,
      atribuicaoId: d.atribuicaoId ?? null,
      equipeId: d.equipeId ?? null,
      criticidade: d.criticidade,
    },
  );
  if (n === 0) throw new ErroDominio(`Sistema ${id} não encontrado`);
}

export async function definirSistemaAtivo(ctx: ContextoUsuario, id: string, ativo: boolean) {
  exigirAdmin(ctx, "alterar sistemas");
  await executar(`UPDATE sistemas SET ativo = :ativo WHERE id = :id`, {
    id,
    ativo: deBool(ativo),
  });
}
