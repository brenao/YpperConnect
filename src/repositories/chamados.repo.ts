import { db, checar, linhas, paraData, data as paraDataObrigatoria, agora as agoraIso } from "@/integrations/db/client.server";
import { calcularPrazo } from "@/integrations/db/sla.server";
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

/** Forma da linha vinda do PostgREST, com os embeds de FK já resolvidos. */
interface LinhaChamado {
  id: string;
  numero: number;
  codigo: string | null;
  titulo: string;
  descricao: string;
  tipo: string;
  categoria_id: string | null;
  servico_id: string | null;
  servicos: { nome: string } | null;
  sistema_id: string | null;
  sistemas: { nome: string } | null;
  impacto: string;
  urgencia: string;
  prioridade: string;
  status: string;
  solicitante_id: string;
  solicitante: { nome: string } | null;
  responsavel_id: string | null;
  responsavel: { nome: string } | null;
  equipe_id: string | null;
  equipes: { nome: string } | null;
  origem: string;
  problema_vinculado_id: string | null;
  descricao_encerramento: string | null;
  criado_em: string;
  prazo_resposta: string | null;
  prazo_sla: string;
  respondido_em: string | null;
  resolvido_em: string | null;
  fechado_em: string | null;
}

/** Seleção base com os embeds equivalentes aos LEFT JOINs do Oracle. */
const SELECT_BASE = `
  id, numero, codigo, titulo, descricao, tipo, categoria_id,
  servico_id, servicos(nome),
  sistema_id, sistemas(nome),
  impacto, urgencia, prioridade, status,
  solicitante_id, solicitante:usuarios!chamados_solicitante_id_fkey(nome),
  responsavel_id, responsavel:usuarios!chamados_responsavel_id_fkey(nome),
  equipe_id, equipes(nome),
  origem, problema_vinculado_id, descricao_encerramento,
  criado_em, prazo_resposta, prazo_sla,
  respondido_em, resolvido_em, fechado_em
`;

/** Status a partir dos quais o chamado é considerado encerrado. */
const STATUS_ENCERRADOS: TicketStatus[] = ["resolvido", "fechado"];

/** UUID puro: 36 caracteres, exatamente o tamanho da coluna. */
function novoId(): string {
  return crypto.randomUUID();
}

function mapChamado(row: LinhaChamado): Chamado {
  return {
    id: row.id,
    numero: row.numero,
    codigo: row.codigo ?? "",
    titulo: row.titulo,
    descricao: row.descricao,
    tipo: row.tipo as RecordType,
    categoriaId: row.categoria_id,
    servicoId: row.servico_id,
    servicoNome: row.servicos?.nome ?? null,
    sistemaId: row.sistema_id,
    sistemaNome: row.sistemas?.nome ?? null,
    impacto: row.impacto as Impact,
    urgencia: row.urgencia as Urgency,
    prioridade: row.prioridade as Priority,
    status: row.status as TicketStatus,
    solicitanteId: row.solicitante_id,
    solicitanteNome: row.solicitante?.nome ?? "",
    responsavelId: row.responsavel_id,
    responsavelNome: row.responsavel?.nome ?? null,
    equipeId: row.equipe_id,
    equipeNome: row.equipes?.nome ?? null,
    origem: row.origem as OrigemChamado,
    problemaVinculadoId: row.problema_vinculado_id,
    descricaoEncerramento: row.descricao_encerramento,
    criadoEm: paraDataObrigatoria(row.criado_em),
    prazoResposta: paraData(row.prazo_resposta),
    prazoSla: paraDataObrigatoria(row.prazo_sla),
    respondidoEm: paraData(row.respondido_em),
    resolvidoEm: paraData(row.resolvido_em),
    fechadoEm: paraData(row.fechado_em),
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
  let query = db.from("chamados").select(SELECT_BASE);

  if (f.status?.length) {
    query = query.in("status", f.status);
  }
  if (f.prioridade?.length) {
    query = query.in("prioridade", f.prioridade);
  }
  if (f.responsavelId) {
    query = query.eq("responsavel_id", f.responsavelId);
  }
  if (f.solicitanteId) {
    query = query.eq("solicitante_id", f.solicitanteId);
  }
  if (f.equipeId) {
    query = query.eq("equipe_id", f.equipeId);
  }
  if (f.vencidos) {
    query = query
      .lt("prazo_sla", agoraIso())
      .not("status", "in", `(${STATUS_ENCERRADOS.join(",")})`);
  }

  query = query.order("criado_em", { ascending: false });
  if (f.limite) {
    query = query.limit(f.limite);
  }

  const linhasChamados = linhas(await query) as unknown as LinhaChamado[];
  return linhasChamados.map(mapChamado);
}

export async function buscarChamado(id: string): Promise<Chamado | null> {
  const resp = await db.from("chamados").select(SELECT_BASE).eq("id", id).maybeSingle();
  const row = checar(resp) as unknown as LinhaChamado | null;
  return row ? mapChamado(row) : null;
}

export async function buscarChamadoPorCodigo(codigo: string): Promise<Chamado | null> {
  const resp = await db.from("chamados").select(SELECT_BASE).eq("codigo", codigo).maybeSingle();
  const row = checar(resp) as unknown as LinhaChamado | null;
  return row ? mapChamado(row) : null;
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

  let query = db
    .from("chamado_interacoes")
    .select("id, chamado_id, autor_id, tipo, corpo, criado_em, usuarios(nome)")
    .eq("chamado_id", chamadoId);

  if (!podeVerInterna) {
    query = query.neq("tipo", "nota_interna");
  }

  query = query.order("criado_em", { ascending: true });

  const linhasInteracoes = linhas(await query) as unknown as Array<{
    id: string;
    chamado_id: string;
    autor_id: string | null;
    tipo: string;
    corpo: string;
    criado_em: string;
    usuarios: { nome: string } | null;
  }>;

  return linhasInteracoes.map((i) => ({
    id: i.id,
    chamadoId: i.chamado_id,
    autorId: i.autor_id,
    autorNome: i.usuarios?.nome ?? null,
    tipo: i.tipo as TipoInteracao,
    corpo: i.corpo,
    criadoEm: paraDataObrigatoria(i.criado_em),
  }));
}

export async function listarHistorico(chamadoId: string): Promise<EventoHistorico[]> {
  const resp = await db
    .from("chamado_historico")
    .select("id, autor_id, campo, valor_anterior, valor_novo, criado_em, usuarios(nome)")
    .eq("chamado_id", chamadoId)
    .order("criado_em", { ascending: true });

  const linhasHistorico = linhas(resp) as unknown as Array<{
    id: string;
    autor_id: string | null;
    campo: string;
    valor_anterior: string | null;
    valor_novo: string | null;
    criado_em: string;
    usuarios: { nome: string } | null;
  }>;

  return linhasHistorico.map((h) => ({
    id: h.id,
    autorId: h.autor_id,
    autorNome: h.usuarios?.nome ?? null,
    campo: h.campo,
    valorAnterior: h.valor_anterior,
    valorNovo: h.valor_novo,
    criadoEm: paraDataObrigatoria(h.criado_em),
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
 * impacto × urgência, e o prazo sai de slaFor + calendário comercial.
 * Deixar a tela escolher permitiria burlar a política de SLA.
 *
 * O prefixo é gravado aqui e nunca mais alterado: o código já circulou
 * por e-mail e foi citado pelo solicitante. Reclassificar o tipo depois
 * não muda INC-1000 para REQ-1000.
 */
export async function criarChamado(
  ctx: ContextoUsuario,
  dados: NovoChamado,
): Promise<{ id: string; numero: number; codigo: string }> {
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

  const id = novoId();
  const solicitanteId = dados.solicitanteId ?? ctx.id;
  const criadoEmIso = criadoEm.toISOString();

  // Sem transações no PostgREST: as operações rodam em sequência.
  const insertResp = await db
    .from("chamados")
    .insert({
      id,
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
      status: "novo",
      solicitante_id: solicitanteId,
      equipe_id: dados.equipeId ?? null,
      origem: dados.origem ?? "portal",
      criado_em: criadoEmIso,
      atualizado_em: criadoEmIso,
      prazo_resposta: prazoResposta.toISOString(),
      prazo_sla: prazoSla.toISOString(),
    })
    .select("numero, codigo")
    .single();

  const inserido = checar(insertResp) as { numero: number; codigo: string | null };

  checar(
    await db.from("chamado_historico").insert({
      id: novoId(),
      chamado_id: id,
      autor_id: ctx.id,
      campo: "criacao",
      valor_anterior: null,
      valor_novo: `${dados.tipo} · ${prioridade}${regime.vinteQuatroSete ? " · 24x7" : ""}`,
      criado_em: criadoEmIso,
    }),
  );

  return { id, numero: inserido.numero, codigo: inserido.codigo ?? "" };
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

  const encerrando = mudancas.status !== undefined && STATUS_ENCERRADOS.includes(mudancas.status);
  if (encerrando) {
    const texto = mudancas.descricaoEncerramento ?? atual.descricaoEncerramento;
    if (!texto?.trim()) {
      throw new ErroDominio("Descrição de encerramento é obrigatória para resolver ou fechar");
    }
  }

  const agora = new Date();
  const agoraIsoLocal = agora.toISOString();
  const updates: Record<string, unknown> = { atualizado_em: agoraIsoLocal };
  const eventos: Array<{ campo: string; de: string | null; para: string | null }> = [];

  function aplicar(campo: string, coluna: string, valorNovo: unknown, valorAtual: unknown) {
    if (valorNovo === undefined) return;
    const de = valorAtual == null ? null : String(valorAtual);
    const para = valorNovo == null ? null : String(valorNovo);
    if (de === para) return;
    updates[coluna] = valorNovo;
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
  const novaPrioridade = resolvePriority(novoImpacto, novaUrgencia);
  aplicar("prioridade", "prioridade", novaPrioridade, atual.prioridade);

  // Marcos de tempo derivados da transição de status.
  if (mudancas.status && mudancas.status !== atual.status) {
    if (!atual.respondidoEm && mudancas.status !== "novo") {
      updates["respondido_em"] = agoraIsoLocal;
    }
    if (mudancas.status === "resolvido" && !atual.resolvidoEm) {
      updates["resolvido_em"] = agoraIsoLocal;
    }
    if (mudancas.status === "fechado") {
      updates["fechado_em"] = agoraIsoLocal;
      if (!atual.resolvidoEm) {
        updates["resolvido_em"] = agoraIsoLocal;
      }
    }
  }

  if (eventos.length === 0) return;

  // Sem transações no PostgREST: update primeiro, histórico em seguida.
  checar(await db.from("chamados").update(updates).eq("id", id));

  checar(
    await db.from("chamado_historico").insert(
      eventos.map((ev) => ({
        id: novoId(),
        chamado_id: id,
        autor_id: ctx.id,
        campo: ev.campo,
        valor_anterior: ev.de,
        valor_novo: ev.para,
        criado_em: agoraIsoLocal,
      })),
    ),
  );
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

  const existeResp = await db.from("chamados").select("id").eq("id", chamadoId).maybeSingle();
  const existe = checar(existeResp);
  if (!existe) throw new ErroDominio(`Chamado ${chamadoId} não encontrado`);

  const agora = new Date();
  const agoraIsoLocal = agora.toISOString();

  checar(
    await db.from("chamado_interacoes").insert({
      id: novoId(),
      chamado_id: chamadoId,
      autor_id: ctx.id,
      tipo,
      corpo: corpo.trim(),
      criado_em: agoraIsoLocal,
    }),
  );

  // Primeira resposta pública marca o cumprimento do SLA de resposta.
  if (tipo === "comentario") {
    checar(
      await db
        .from("chamados")
        .update({ respondido_em: agoraIsoLocal })
        .eq("id", chamadoId)
        .is("respondido_em", null),
    );
  }
}
