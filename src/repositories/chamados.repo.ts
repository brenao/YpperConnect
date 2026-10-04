import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { calcularPrazo } from "@/integrations/postgres/sla.server";
import { resolvePriority, slaFor } from "@/models/itsm-types";
import type { Impact, Priority, RecordType, TicketStatus, Urgency } from "@/models/itsm-types";
import { PREFIXO_TIPO } from "@/models/chamado-codigo";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

export type OrigemChamado = "portal" | "ia" | "email" | "telefone";
export type TipoInteracao = "comentario" | "nota_interna" | "email";

export interface Chamado {
  id: string;
  numero: number;
  /** Código legível e imutável: INC-1000, REQ-1001... Coluna gerada no banco. */
  codigo: string;
  titulo: string;
  descricao: string;
  tipo: RecordType;
  categoriaId: string | null;
  servicoId: string | null;
  servicoNome: string | null;
  sistemaId: string | null;
  sistemaNome: string | null;
  impacto: Impact;
  urgencia: Urgency;
  prioridade: Priority;
  status: TicketStatus;
  solicitanteId: string;
  solicitanteNome: string;
  responsavelId: string | null;
  responsavelNome: string | null;
  equipeId: string | null;
  equipeNome: string | null;
  origem: OrigemChamado;
  problemaVinculadoId: string | null;
  descricaoEncerramento: string | null;
  criadoEm: Date;
  prazoResposta: Date | null;
  prazoSla: Date;
  respondidoEm: Date | null;
  resolvidoEm: Date | null;
  fechadoEm: Date | null;
}

export interface Interacao {
  id: string;
  chamadoId: string;
  autorId: string | null;
  autorNome: string | null;
  tipo: TipoInteracao;
  corpo: string;
  criadoEm: Date;
}

export interface EventoHistorico {
  id: string;
  autorId: string | null;
  autorNome: string | null;
  campo: string;
  valorAnterior: string | null;
  valorNovo: string | null;
  criadoEm: Date;
}

/** Status a partir dos quais o chamado é considerado encerrado. */
const STATUS_ENCERRADOS: TicketStatus[] = ["resolvido", "fechado"];

// ---------------------------------------------------------------- apoio

async function tenantAtual(): Promise<string> {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return (await getUsuarioAtual()).tenantId;
}

function falha(erro: { code?: string; message: string }): never {
  if (erro.code === "P0002") throw new ErroDominio("Chamado não encontrado");
  if (erro.code === "23503") {
    throw new ErroDominio("Um dos itens selecionados não pertence a esta empresa.");
  }
  if (erro.code === "42501") throw new ErroDominio("Você não tem permissão para esta ação.");
  throw new Error(erro.message);
}

const data = (v: unknown): Date | null => (v ? new Date(v as string) : null);

/** Linha de `chamados_v` (snake_case do banco) no formato do legado. */
function paraChamado(r: Record<string, unknown>): Chamado {
  return {
    id: r["id"] as string,
    numero: Number(r["numero"]),
    codigo: r["codigo"] as string,
    titulo: r["titulo"] as string,
    descricao: r["descricao"] as string,
    tipo: r["tipo"] as RecordType,
    categoriaId: (r["categoria_id"] as string | null) ?? null,
    servicoId: (r["servico_id"] as string | null) ?? null,
    servicoNome: (r["servico_nome"] as string | null) ?? null,
    sistemaId: (r["sistema_id"] as string | null) ?? null,
    sistemaNome: (r["sistema_nome"] as string | null) ?? null,
    impacto: r["impacto"] as Impact,
    urgencia: r["urgencia"] as Urgency,
    prioridade: r["prioridade"] as Priority,
    status: r["status"] as TicketStatus,
    solicitanteId: r["solicitante_id"] as string,
    solicitanteNome: (r["solicitante_nome"] as string | null) ?? "",
    responsavelId: (r["responsavel_id"] as string | null) ?? null,
    responsavelNome: (r["responsavel_nome"] as string | null) ?? null,
    equipeId: (r["equipe_id"] as string | null) ?? null,
    equipeNome: (r["equipe_nome"] as string | null) ?? null,
    origem: r["origem"] as OrigemChamado,
    problemaVinculadoId: (r["problema_vinculado_id"] as string | null) ?? null,
    descricaoEncerramento: (r["descricao_encerramento"] as string | null) ?? null,
    criadoEm: new Date(r["criado_em"] as string),
    prazoResposta: data(r["prazo_resposta"]),
    prazoSla: new Date(r["prazo_sla"] as string),
    respondidoEm: data(r["respondido_em"]),
    resolvidoEm: data(r["resolvido_em"]),
    fechadoEm: data(r["fechado_em"]),
  };
}

// ---------------------------------------------------------------- leitura

/**
 * Campos opcionais declaram `| undefined` explícito por causa de
 * exactOptionalPropertyTypes no tsconfig: sem isso, o objeto vindo do
 * Zod (que produz `prop?: T | undefined`) não é atribuível aqui.
 */
export interface FiltroChamados {
  status?: TicketStatus[] | undefined;
  responsavelId?: string | undefined;
  solicitanteId?: string | undefined;
  equipeId?: string | undefined;
  prioridade?: Priority[] | undefined;
  /** true = apenas os que já estouraram o prazo de solução */
  vencidos?: boolean | undefined;
  limite?: number | undefined;
}

export async function listarChamados(f: FiltroChamados = {}): Promise<Chamado[]> {
  let q = getSupabaseServerClient()
    .from("chamados_v")
    .select("*")
    .eq("tenant_id", await tenantAtual());

  if (f.status?.length) q = q.in("status", f.status);
  if (f.prioridade?.length) q = q.in("prioridade", f.prioridade);
  if (f.responsavelId) q = q.eq("responsavel_id", f.responsavelId);
  if (f.solicitanteId) q = q.eq("solicitante_id", f.solicitanteId);
  if (f.equipeId) q = q.eq("equipe_id", f.equipeId);
  if (f.vencidos) {
    q = q.lt("prazo_sla", new Date().toISOString()).not("status", "in", "(resolvido,fechado)");
  }

  q = q.order("criado_em", { ascending: false });
  if (f.limite) q = q.limit(f.limite);

  const { data: linhas, error } = await q;
  if (error) falha(error);
  return (linhas ?? []).map(paraChamado);
}

export async function buscarChamado(id: string): Promise<Chamado | null> {
  const { data: linha, error } = await getSupabaseServerClient()
    .from("chamados_v")
    .select("*")
    .eq("tenant_id", await tenantAtual())
    .eq("id", id)
    .maybeSingle();
  if (error) falha(error);
  return linha ? paraChamado(linha) : null;
}

/** Código é único por empresa (INC-1000 existe em cada uma). */
export async function buscarChamadoPorCodigo(codigo: string): Promise<Chamado | null> {
  const { data: linha, error } = await getSupabaseServerClient()
    .from("chamados_v")
    .select("*")
    .eq("tenant_id", await tenantAtual())
    .eq("codigo", codigo)
    .maybeSingle();
  if (error) falha(error);
  return linha ? paraChamado(linha) : null;
}

/**
 * Interações visíveis ao solicitante. Notas internas só aparecem para
 * quem tem equipe — a regra fica aqui, não na tela, para não vazar por
 * uma tela nova que esqueça de filtrar.
 */
export async function listarInteracoes(
  ctx: ContextoUsuario,
  chamadoId: string,
): Promise<Interacao[]> {
  const podeVerInterna = ctx.admin || ctx.equipeId !== null;

  let q = getSupabaseServerClient()
    .from("chamado_interacoes_v")
    .select("id, chamado_id, autor_id, autor_nome, tipo, corpo, criado_em")
    .eq("tenant_id", ctx.tenantId)
    .eq("chamado_id", chamadoId);
  if (!podeVerInterna) q = q.neq("tipo", "nota_interna");

  const { data: linhas, error } = await q.order("criado_em");
  if (error) falha(error);
  return (linhas ?? []).map((i) => ({
    id: i.id as string,
    chamadoId: i.chamado_id as string,
    autorId: (i.autor_id as string | null) ?? null,
    autorNome: (i.autor_nome as string | null) ?? null,
    tipo: i.tipo as TipoInteracao,
    corpo: i.corpo as string,
    criadoEm: new Date(i.criado_em as string),
  }));
}

export async function listarHistorico(chamadoId: string): Promise<EventoHistorico[]> {
  const { data: linhas, error } = await getSupabaseServerClient()
    .from("chamado_historico_v")
    .select("id, autor_id, autor_nome, campo, valor_anterior, valor_novo, criado_em")
    .eq("tenant_id", await tenantAtual())
    .eq("chamado_id", chamadoId)
    .order("criado_em");
  if (error) falha(error);
  return (linhas ?? []).map((h) => ({
    id: h.id as string,
    autorId: (h.autor_id as string | null) ?? null,
    autorNome: (h.autor_nome as string | null) ?? null,
    campo: h.campo as string,
    valorAnterior: (h.valor_anterior as string | null) ?? null,
    valorNovo: (h.valor_novo as string | null) ?? null,
    criadoEm: new Date(h.criado_em as string),
  }));
}

// ------------------------------------------------------------------ escrita

export interface NovoChamado {
  titulo: string;
  descricao: string;
  tipo: RecordType;
  categoriaId?: string | null | undefined;
  servicoId?: string | null | undefined;
  sistemaId?: string | null | undefined;
  impacto: Impact;
  urgencia: Urgency;
  solicitanteId?: string | undefined;
  equipeId?: string | null | undefined;
  origem?: OrigemChamado | undefined;
}

/**
 * Abre um chamado. A prioridade NÃO vem da tela: é derivada da matriz
 * impacto × urgência, e o prazo sai de slaFor + calendário da empresa.
 * Deixar a tela escolher permitiria burlar a política de SLA.
 *
 * O prefixo é gravado aqui e nunca mais alterado: o código já circulou
 * por e-mail e foi citado pelo solicitante. Reclassificar o tipo depois
 * não muda INC-1000 para REQ-1000.
 *
 * Chamado e histórico são gravados juntos (função `abrir_chamado`).
 */
export async function criarChamado(
  ctx: ContextoUsuario,
  dados: NovoChamado,
): Promise<{ id: string; numero: number; codigo: string; responsavelId: string | null }> {
  if (dados.tipo === "problema" && !ctx.admin && ctx.equipeId === null) {
    throw new ErroDominio("Usuários finais não podem abrir Problemas");
  }
  if (!dados.titulo.trim()) throw new ErroDominio("Título é obrigatório");
  if (!dados.descricao.trim()) throw new ErroDominio("Descrição é obrigatória");

  const prioridade = resolvePriority(dados.impacto, dados.urgencia);
  const meta = slaFor(dados.tipo, prioridade);
  const criadoEm = new Date();

  // P1 é 24×7: crítico não espera abertura do expediente.
  const regime = { vinteQuatroSete: prioridade === "P1" };

  const [prazoResposta, prazoSla] = await Promise.all([
    calcularPrazo(criadoEm, meta.resposta, regime),
    calcularPrazo(criadoEm, meta.solucao, regime),
  ]);

  // Roteamento automático. O cadastro do sistema diz quem atende, e é
  // essa a razão de existir o campo: chamado que nasce sem dono espera
  // alguém garimpar a fila. Serviço entra como segunda opção porque
  // define a equipe, não a pessoa.
  const roteamento = await resolverRoteamento(ctx.tenantId, dados.sistemaId, dados.servicoId);
  const responsavelId = roteamento.responsavelId;
  const equipeId = dados.equipeId ?? roteamento.equipeId;

  const { data: r, error } = await getSupabaseServerClient().rpc("abrir_chamado", {
    p: {
      tenant_id: ctx.tenantId,
      prefixo: PREFIXO_TIPO[dados.tipo],
      titulo: dados.titulo.trim(),
      descricao: dados.descricao.trim(),
      tipo: dados.tipo,
      categoria_id: dados.categoriaId ?? null,
      servico_id: dados.servicoId ?? null,
      sistema_id: dados.sistemaId ?? null,
      impacto: dados.impacto,
      urgencia: dados.urgencia,
      prioridade,
      solicitante_id: dados.solicitanteId ?? ctx.id,
      responsavel_id: responsavelId,
      equipe_id: equipeId,
      origem: dados.origem ?? "portal",
      criado_em: criadoEm.toISOString(),
      prazo_resposta: prazoResposta.toISOString(),
      prazo_sla: prazoSla.toISOString(),
      resumo_criacao: `${dados.tipo} · ${prioridade}${regime.vinteQuatroSete ? " · 24x7" : ""}`,
    },
  });
  if (error) falha(error);

  const criado = r as { id: string; numero: number; codigo: string };
  return { id: criado.id, numero: Number(criado.numero), codigo: criado.codigo, responsavelId };
}

/**
 * Quem atende e por qual equipe, a partir do cadastro.
 *
 * `sistemas.atribuicao_id` é a pessoa que recebe o chamado;
 * `sistemas.responsavel_id` é o dono técnico do sistema e não entra
 * aqui — ele responde pelo sistema, não pela fila de atendimento.
 */
async function resolverRoteamento(
  tenantId: string,
  sistemaId: string | null | undefined,
  servicoId: string | null | undefined,
): Promise<{ responsavelId: string | null; equipeId: string | null }> {
  const sb = getSupabaseServerClient();
  let responsavelId: string | null = null;
  let equipeId: string | null = null;

  if (sistemaId) {
    const { data: s } = await sb
      .from("sistemas")
      .select("atribuicao_id, equipe_id")
      .eq("tenant_id", tenantId)
      .eq("id", sistemaId)
      .eq("ativo", true)
      .maybeSingle();
    responsavelId = (s?.atribuicao_id as string | null) ?? null;
    equipeId = (s?.equipe_id as string | null) ?? null;
  }

  if (!equipeId && servicoId) {
    const { data: sv } = await sb
      .from("servicos")
      .select("equipe_id")
      .eq("tenant_id", tenantId)
      .eq("id", servicoId)
      .eq("ativo", true)
      .maybeSingle();
    equipeId = (sv?.equipe_id as string | null) ?? null;
  }

  return { responsavelId, equipeId };
}

export interface AlteracaoChamado {
  status?: TicketStatus | undefined;
  responsavelId?: string | null | undefined;
  equipeId?: string | null | undefined;
  impacto?: Impact | undefined;
  urgencia?: Urgency | undefined;
  categoriaId?: string | null | undefined;
  servicoId?: string | null | undefined;
  sistemaId?: string | null | undefined;
  problemaVinculadoId?: string | null | undefined;
  descricaoEncerramento?: string | null | undefined;
}

/**
 * Alterar impacto ou urgência recalcula a prioridade, mas NÃO recalcula
 * prazo_sla — o prazo é um compromisso firmado na abertura. Isso inclui
 * a subida para P1: um chamado que vira crítico depois mantém o prazo
 * calculado em horário comercial. Recalcular retroativamente
 * inviabilizaria qualquer indicador de SLA.
 *
 * Campos e histórico são gravados juntos (função `alterar_chamado`).
 */
export async function atualizarChamado(
  ctx: ContextoUsuario,
  id: string,
  mudancas: AlteracaoChamado,
): Promise<void> {
  if (!ctx.admin && ctx.equipeId === null) {
    throw new ErroDominio("Somente a equipe de TI pode alterar chamados");
  }

  const atual = await buscarChamado(id);
  if (!atual) throw new ErroDominio(`Chamado ${id} não encontrado`);

  // A TI resolve; quem fecha é o solicitante (ou o fechamento automático
  // em 3 dias úteis). Fechar direto pularia a confirmação de quem pediu.
  if (mudancas.status === "fechado" && atual.status !== "fechado") {
    throw new ErroDominio(
      "O fechamento é feito pelo solicitante, ao confirmar a solução, ou automaticamente após 3 dias úteis. Marque como Resolvido.",
    );
  }

  const encerrando = mudancas.status !== undefined && STATUS_ENCERRADOS.includes(mudancas.status);
  if (encerrando) {
    const texto = mudancas.descricaoEncerramento ?? atual.descricaoEncerramento;
    if (!texto?.trim()) {
      throw new ErroDominio("Descrição de encerramento é obrigatória para resolver ou fechar");
    }
  }

  const agora = new Date().toISOString();
  const campos: Record<string, unknown> = {};
  const eventos: Array<{ campo: string; de: string | null; para: string | null }> = [];

  // O nome do evento no histórico é o do legado (camelCase), para a tela
  // de histórico continuar mostrando os rótulos certos.
  function aplicar(campo: string, coluna: string, valorNovo: unknown, valorAtual: unknown) {
    if (valorNovo === undefined) return;
    const de = valorAtual == null ? null : String(valorAtual);
    const para = valorNovo == null ? null : String(valorNovo);
    if (de === para) return;
    campos[coluna] = valorNovo;
    eventos.push({ campo, de, para });
  }

  aplicar("status", "status", mudancas.status, atual.status);
  aplicar("responsavelId", "responsavel_id", mudancas.responsavelId, atual.responsavelId);
  aplicar("equipeId", "equipe_id", mudancas.equipeId, atual.equipeId);
  aplicar("impacto", "impacto", mudancas.impacto, atual.impacto);
  aplicar("urgencia", "urgencia", mudancas.urgencia, atual.urgencia);
  aplicar("categoriaId", "categoria_id", mudancas.categoriaId, atual.categoriaId);
  aplicar("servicoId", "servico_id", mudancas.servicoId, atual.servicoId);
  aplicar("sistemaId", "sistema_id", mudancas.sistemaId, atual.sistemaId);
  aplicar(
    "problemaVinculadoId",
    "problema_vinculado_id",
    mudancas.problemaVinculadoId,
    atual.problemaVinculadoId,
  );
  aplicar(
    "descricaoEncerramento",
    "descricao_encerramento",
    mudancas.descricaoEncerramento,
    atual.descricaoEncerramento,
  );

  // Prioridade é derivada: recalcula se impacto ou urgência mudaram.
  const novoImpacto = mudancas.impacto ?? atual.impacto;
  const novaUrgencia = mudancas.urgencia ?? atual.urgencia;
  aplicar("prioridade", "prioridade", resolvePriority(novoImpacto, novaUrgencia), atual.prioridade);

  if (eventos.length === 0) return;

  // Marcos de tempo derivados da transição de status.
  if (mudancas.status && mudancas.status !== atual.status) {
    if (!atual.respondidoEm && mudancas.status !== "novo") campos["respondido_em"] = agora;
    if (mudancas.status === "resolvido" && !atual.resolvidoEm) campos["resolvido_em"] = agora;
    if (mudancas.status === "fechado") {
      campos["fechado_em"] = agora;
      if (!atual.resolvidoEm) campos["resolvido_em"] = agora;
    }
  }

  const { error } = await getSupabaseServerClient().rpc("alterar_chamado", {
    p_id: id,
    p_campos: campos,
    p_eventos: eventos,
  });
  if (error) falha(error);
}

export async function adicionarInteracao(
  ctx: ContextoUsuario,
  chamadoId: string,
  tipo: TipoInteracao,
  corpo: string,
): Promise<void> {
  if (!corpo.trim()) throw new ErroDominio("O comentário não pode estar vazio");
  if (tipo === "nota_interna" && !ctx.admin && ctx.equipeId === null) {
    throw new ErroDominio("Somente a equipe de TI pode registrar notas internas");
  }

  // Interação e marco de resposta gravados juntos (função `registrar_interacao`).
  const { error } = await getSupabaseServerClient().rpc("registrar_interacao", {
    p_chamado: chamadoId,
    p_tipo: tipo,
    p_corpo: corpo.trim(),
  });
  if (error) falha(error);
}

/**
 * O solicitante confirma a solução (fecha) ou reabre o chamado (com
 * motivo). Só quem abriu, e só com o chamado resolvido — o banco confere.
 */
export async function confirmarSolucao(
  _ctx: ContextoUsuario,
  id: string,
  aceita: boolean,
  motivo: string | null,
): Promise<void> {
  if (!aceita && !motivo?.trim()) throw new ErroDominio("Informe o motivo da reabertura.");
  const { error } = await getSupabaseServerClient().rpc("confirmar_solucao", {
    p_id: id,
    p_aceita: aceita,
    p_motivo: motivo,
  });
  if (error) {
    if (error.message.includes("Somente quem abriu")) {
      throw new ErroDominio("Somente quem abriu o chamado pode confirmar a solução.");
    }
    if (error.message.includes("aguardando confirmacao")) {
      throw new ErroDominio("O chamado não está aguardando confirmação.");
    }
    if (error.message.includes("motivo")) throw new ErroDominio("Informe o motivo da reabertura.");
    falha(error);
  }
}