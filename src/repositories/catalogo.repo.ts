import { checar, db, linhas } from "@/integrations/db/client.server";
import { ErroDominio } from "./tipos";
import type { RecordType } from "@/models/itsm-types";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Catálogo de serviços, inventário de sistemas e categorias.
 *
 * Regra transversal: nada é excluído de verdade. Chamados históricos
 * apontam para serviço e sistema por chave estrangeira, e DELETE
 * quebraria o histórico. Tudo desativa com ativo = false.
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
  let consulta = db.from("categorias").select("id, nome, escopo, ativo").order("escopo").order("nome");
  if (escopo) consulta = consulta.eq("escopo", escopo);
  const dados = linhas(await consulta);
  return dados.map((l) => ({
    id: l.id,
    nome: l.nome,
    escopo: l.escopo as EscopoCategoria,
    ativo: l.ativo,
  }));
}

export async function criarCategoria(
  ctx: ContextoUsuario,
  dados: { nome: string; escopo: EscopoCategoria },
): Promise<string> {
  exigirAdmin(ctx, "criar categorias");
  if (dados.nome.trim().length < 2) throw new ErroDominio("Informe o nome da categoria");

  const id = novoId();
  checar(
    await db.from("categorias").insert({
      id,
      nome: dados.nome.trim(),
      escopo: dados.escopo,
      ativo: true,
    }),
  );
  return id;
}

export async function renomearCategoria(ctx: ContextoUsuario, id: string, nome: string) {
  exigirAdmin(ctx, "alterar categorias");
  const { data: atualizadas, error } = await db
    .from("categorias")
    .update({ nome: nome.trim() })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`Erro no banco: ${error.message}`);
  if (!atualizadas || atualizadas.length === 0) throw new ErroDominio(`Categoria ${id} não encontrada`);
}

export async function definirCategoriaAtiva(ctx: ContextoUsuario, id: string, ativo: boolean) {
  exigirAdmin(ctx, "alterar categorias");
  checar(await db.from("categorias").update({ ativo }).eq("id", id));
}

// --------------------------------------------------------------- serviços

const SELECT_SERVICO =
  "id, nome, categoria_id, descricao, tipo_padrao, sla_horas, equipe_id, gerado_por_ia, ativo, categorias(nome), equipes(nome)";

interface LinhaServico {
  id: string;
  nome: string;
  categoria_id: string | null;
  descricao: string | null;
  tipo_padrao: string;
  sla_horas: number;
  equipe_id: string | null;
  gerado_por_ia: boolean;
  ativo: boolean;
  categorias: { nome: string } | null;
  equipes: { nome: string } | null;
}

const mapServico = (l: LinhaServico): Servico => ({
  id: l.id,
  nome: l.nome,
  categoriaId: l.categoria_id,
  categoriaNome: l.categorias?.nome ?? null,
  descricao: l.descricao,
  tipoPadrao: l.tipo_padrao as RecordType,
  slaHoras: l.sla_horas,
  equipeId: l.equipe_id,
  equipeNome: l.equipes?.nome ?? null,
  geradoPorIa: l.gerado_por_ia,
  ativo: l.ativo,
});

export async function listarServicos(apenasAtivos = true): Promise<Servico[]> {
  let consulta = db.from("servicos").select(SELECT_SERVICO).order("nome");
  if (apenasAtivos) consulta = consulta.eq("ativo", true);
  const dados = linhas(await consulta);
  return (dados as unknown as LinhaServico[]).map(mapServico);
}

export async function buscarServico(id: string): Promise<Servico | null> {
  const { data, error } = await db.from("servicos").select(SELECT_SERVICO).eq("id", id).maybeSingle();
  if (error) throw new Error(`Erro no banco: ${error.message}`);
  return data ? mapServico(data as unknown as LinhaServico) : null;
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
  const agoraIso = new Date().toISOString();
  checar(
    await db.from("servicos").insert({
      id,
      nome: d.nome.trim(),
      categoria_id: d.categoriaId ?? null,
      descricao: d.descricao?.trim() ?? null,
      tipo_padrao: d.tipoPadrao,
      sla_horas: d.slaHoras,
      equipe_id: d.equipeId ?? null,
      gerado_por_ia: d.geradoPorIa ?? false,
      ativo: true,
      criado_em: agoraIso,
      atualizado_em: agoraIso,
    }),
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

  const { data: atualizados, error } = await db
    .from("servicos")
    .update({
      nome: d.nome.trim(),
      categoria_id: d.categoriaId ?? null,
      descricao: d.descricao?.trim() ?? null,
      tipo_padrao: d.tipoPadrao,
      sla_horas: d.slaHoras,
      equipe_id: d.equipeId ?? null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`Erro no banco: ${error.message}`);
  if (!atualizados || atualizados.length === 0) throw new ErroDominio(`Serviço ${id} não encontrado`);
}

/**
 * Desativa em vez de excluir: chamados históricos referenciam o serviço
 * por FK. Um serviço inativo some dos formulários mas continua legível
 * nos chamados antigos.
 */
export async function definirServicoAtivo(ctx: ContextoUsuario, id: string, ativo: boolean) {
  exigirAdmin(ctx, "alterar serviços");
  checar(
    await db
      .from("servicos")
      .update({ ativo, atualizado_em: new Date().toISOString() })
      .eq("id", id),
  );
}

// --------------------------------------------------------------- sistemas

const SELECT_SISTEMA =
  "id, nome, descricao, categoria_id, criticidade, equipe_id, responsavel_id, atribuicao_id, ativo, categorias(nome), equipes(nome), responsavel:usuarios!sistemas_responsavel_id_fkey(nome), atribuicao:usuarios!sistemas_atribuicao_id_fkey(nome)";

interface LinhaSistema {
  id: string;
  nome: string;
  descricao: string | null;
  categoria_id: string | null;
  criticidade: string;
  equipe_id: string | null;
  responsavel_id: string | null;
  atribuicao_id: string | null;
  ativo: boolean;
  categorias: { nome: string } | null;
  equipes: { nome: string } | null;
  responsavel: { nome: string } | null;
  atribuicao: { nome: string } | null;
}

const mapSistema = (l: LinhaSistema): Sistema => ({
  id: l.id,
  nome: l.nome,
  descricao: l.descricao,
  categoriaId: l.categoria_id,
  categoriaNome: l.categorias?.nome ?? null,
  criticidade: l.criticidade as Criticidade,
  equipeId: l.equipe_id,
  equipeNome: l.equipes?.nome ?? null,
  responsavelId: l.responsavel_id,
  responsavelNome: l.responsavel?.nome ?? null,
  atribuicaoId: l.atribuicao_id,
  atribuicaoNome: l.atribuicao?.nome ?? null,
  ativo: l.ativo,
});

export async function listarSistemas(apenasAtivos = true): Promise<Sistema[]> {
  let consulta = db.from("sistemas").select(SELECT_SISTEMA).order("nome");
  if (apenasAtivos) consulta = consulta.eq("ativo", true);
  const dados = linhas(await consulta);
  return (dados as unknown as LinhaSistema[]).map(mapSistema);
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
  checar(
    await db.from("sistemas").insert({
      id,
      nome: d.nome.trim(),
      descricao: d.descricao?.trim() ?? null,
      categoria_id: d.categoriaId ?? null,
      responsavel_id: d.responsavelId ?? null,
      atribuicao_id: d.atribuicaoId ?? null,
      equipe_id: d.equipeId ?? null,
      criticidade: d.criticidade,
      ativo: true,
    }),
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

  const { data: atualizados, error } = await db
    .from("sistemas")
    .update({
      nome: d.nome.trim(),
      descricao: d.descricao?.trim() ?? null,
      categoria_id: d.categoriaId ?? null,
      responsavel_id: d.responsavelId ?? null,
      atribuicao_id: d.atribuicaoId ?? null,
      equipe_id: d.equipeId ?? null,
      criticidade: d.criticidade,
    })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`Erro no banco: ${error.message}`);
  if (!atualizados || atualizados.length === 0) throw new ErroDominio(`Sistema ${id} não encontrado`);
}

export async function definirSistemaAtivo(ctx: ContextoUsuario, id: string, ativo: boolean) {
  exigirAdmin(ctx, "alterar sistemas");
  checar(await db.from("sistemas").update({ ativo }).eq("id", id));
}
