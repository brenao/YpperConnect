import { consultar, consultarUm, emTransacao } from "@/integrations/oracle/client.server";
import { calcularPrazo } from "@/integrations/oracle/sla.server";
import { resolvePriority, slaFor } from "@/models/itsm-types";
import type { Impact, Priority, RecordType, TicketStatus, Urgency } from "@/models/itsm-types";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

export type OrigemChamado = "portal" | "ia" | "email" | "telefone";
export type TipoInteracao = "comentario" | "nota_interna" | "email";

export interface Chamado {
  id: string;
  numero: number;
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

const SELECT_BASE = `
  SELECT c.id, c.numero, c.titulo, c.descricao, c.tipo, c.categoria_id,
         c.servico_id, sv.nome AS servico_nome,
         c.sistema_id, si.nome AS sistema_nome,
         c.impacto, c.urgencia, c.prioridade, c.status,
         c.solicitante_id, us.nome AS solicitante_nome,
         c.responsavel_id, ur.nome AS responsavel_nome,
         c.equipe_id, eq.nome AS equipe_nome,
         c.origem, c.problema_vinculado_id, c.descricao_encerramento,
         c.criado_em, c.prazo_resposta, c.prazo_sla,
         c.respondido_em, c.resolvido_em, c.fechado_em
    FROM chamados c
    LEFT JOIN servicos sv ON sv.id = c.servico_id
    LEFT JOIN sistemas si ON si.id = c.sistema_id
    LEFT JOIN usuarios us ON us.id = c.solicitante_id
    LEFT JOIN usuarios ur ON ur.id = c.responsavel_id
    LEFT JOIN equipes  eq ON eq.id = c.equipe_id`;

/** Status a partir dos quais o chamado é considerado encerrado. */
const STATUS_ENCERRADOS: TicketStatus[] = ["resolvido", "fechado"];

/** UUID puro: 36 caracteres, exatamente o tamanho da coluna. */
function novoId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------- leitura

export interface FiltroChamados {
  status?: TicketStatus[];
  responsavelId?: string;
  solicitanteId?: string;
  equipeId?: string;
  prioridade?: Priority[];
  /** true = apenas os que já estouraram o prazo de solução */
  vencidos?: boolean;
  limite?: number;
}

export async function listarChamados(f: FiltroChamados = {}): Promise<Chamado[]> {
  const cond: string[] = [];
  const binds: Record<string, unknown> = {};

  // Listas viram :s0, :s1... porque Oracle não aceita array em IN.
  if (f.status?.length) {
    const chaves = f.status.map((s, i) => {
      binds[`s${i}`] = s;
      return `:s${i}`;
    });
    cond.push(`c.status IN (${chaves.join(",")})`);
  }
  if (f.prioridade?.length) {
    const chaves = f.prioridade.map((p, i) => {
      binds[`p${i}`] = p;
      return `:p${i}`;
    });
    cond.push(`c.prioridade IN (${chaves.join(",")})`);
  }
  if (f.responsavelId) {
    cond.push(`c.responsavel_id = :responsavelId`);
    binds.responsavelId = f.responsavelId;
  }
  if (f.solicitanteId) {
    cond.push(`c.solicitante_id = :solicitanteId`);
    binds.solicitanteId = f.solicitanteId;
  }
  if (f.equipeId) {
    cond.push(`c.equipe_id = :equipeId`);
    binds.equipeId = f.equipeId;
  }
  if (f.vencidos) {
    cond.push(`c.prazo_sla < SYSTIMESTAMP AND c.status NOT IN ('resolvido','fechado')`);
  }

  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const limite = f.limite ? `FETCH FIRST :limite ROWS ONLY` : "";
  if (f.limite) binds.limite = f.limite;

  return consultar<Chamado>(`${SELECT_BASE} ${where} ORDER BY c.criado_em DESC ${limite}`, binds);
}

export async function buscarChamado(id: string): Promise<Chamado | null> {
  return consultarUm<Chamado>(`${SELECT_BASE} WHERE c.id = :id`, { id });
}

export async function buscarChamadoPorNumero(numero: number): Promise<Chamado | null> {
  return consultarUm<Chamado>(`${SELECT_BASE} WHERE c.numero = :numero`, { numero });
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
  const filtroTipo = podeVerInterna ? "" : `AND i.tipo <> 'nota_interna'`;

  return consultar<Interacao>(
    `SELECT i.id, i.chamado_id, i.autor_id, u.nome AS autor_nome,
            i.tipo, i.corpo, i.criado_em
       FROM chamado_interacoes i
       LEFT JOIN usuarios u ON u.id = i.autor_id
      WHERE i.chamado_id = :chamadoId ${filtroTipo}
      ORDER BY i.criado_em`,
    { chamadoId },
  );
}

export async function listarHistorico(chamadoId: string): Promise<EventoHistorico[]> {
  return consultar<EventoHistorico>(
    `SELECT h.id, h.autor_id, u.nome AS autor_nome,
            h.campo, h.valor_anterior, h.valor_novo, h.criado_em
       FROM chamado_historico h
       LEFT JOIN usuarios u ON u.id = h.autor_id
      WHERE h.chamado_id = :chamadoId
      ORDER BY h.criado_em`,
    { chamadoId },
  );
}

// ------------------------------------------------------------------ escrita

export interface NovoChamado {
  titulo: string;
  descricao: string;
  tipo: RecordType;
  categoriaId?: string | null;
  servicoId?: string | null;
  sistemaId?: string | null;
  impacto: Impact;
  urgencia: Urgency;
  solicitanteId?: string;
  equipeId?: string | null;
  origem?: OrigemChamado;
}

/**
 * Abre um chamado. A prioridade NÃO vem da tela: é derivada da matriz
 * impacto × urgência, e o prazo sai de slaFor + calendário comercial.
 * Deixar a tela escolher permitiria burlar a política de SLA.
 */
export async function criarChamado(
  ctx: ContextoUsuario,
  dados: NovoChamado,
): Promise<{ id: string; numero: number }> {
  if (dados.tipo === "problema" && !ctx.admin && ctx.equipeId === null) {
    throw new ErroDominio("Usuários finais não podem abrir Problemas");
  }
  if (!dados.titulo.trim()) throw new ErroDominio("Título é obrigatório");
  if (!dados.descricao.trim()) throw new ErroDominio("Descrição é obrigatória");

  const prioridade = resolvePriority(dados.impacto, dados.urgencia);
  const meta = slaFor(dados.tipo, prioridade);
  const criadoEm = new Date();

  const [prazoResposta, prazoSla] = await Promise.all([
    calcularPrazo(criadoEm, meta.resposta),
    calcularPrazo(criadoEm, meta.solucao),
  ]);

  const id = novoId();
  const solicitanteId = dados.solicitanteId ?? ctx.id;

  const numero = await emTransacao(async (tx) => {
    await tx.executar(
      `INSERT INTO chamados
         (id, titulo, descricao, tipo, categoria_id, servico_id, sistema_id,
          impacto, urgencia, prioridade, status, solicitante_id, equipe_id,
          origem, criado_em, atualizado_em, prazo_resposta, prazo_sla)
       VALUES
         (:id, :titulo, :descricao, :tipo, :categoriaId, :servicoId, :sistemaId,
          :impacto, :urgencia, :prioridade, 'novo', :solicitanteId, :equipeId,
          :origem, :criadoEm, :criadoEm2, :prazoResposta, :prazoSla)`,
      {
        id,
        titulo: dados.titulo.trim(),
        descricao: dados.descricao.trim(),
        tipo: dados.tipo,
        categoriaId: dados.categoriaId ?? null,
        servicoId: dados.servicoId ?? null,
        sistemaId: dados.sistemaId ?? null,
        impacto: dados.impacto,
        urgencia: dados.urgencia,
        prioridade,
        solicitanteId,
        equipeId: dados.equipeId ?? null,
        origem: dados.origem ?? "portal",
        criadoEm,
        criadoEm2: criadoEm,
        prazoResposta,
        prazoSla,
      },
    );

    await tx.executar(
      `INSERT INTO chamado_historico
         (id, chamado_id, autor_id, campo, valor_anterior, valor_novo, criado_em)
       VALUES (:id, :chamadoId, :autorId, 'criacao', NULL, :valorNovo, :criadoEm)`,
      {
        id: novoId(),
        chamadoId: id,
        autorId: ctx.id,
        valorNovo: `${dados.tipo} · ${prioridade}`,
        criadoEm,
      },
    );

    // numero é IDENTITY: só existe depois do INSERT.
    const r = await tx.consultar<{ numero: number }>(`SELECT numero FROM chamados WHERE id = :id`, {
      id,
    });
    return r[0]!.numero;
  });

  return { id, numero };
}

export interface AlteracaoChamado {
  status?: TicketStatus;
  responsavelId?: string | null;
  equipeId?: string | null;
  impacto?: Impact;
  urgencia?: Urgency;
  categoriaId?: string | null;
  servicoId?: string | null;
  sistemaId?: string | null;
  problemaVinculadoId?: string | null;
  descricaoEncerramento?: string | null;
}

/**
 * Altera o chamado gravando uma linha de histórico por campo mudado.
 * Tudo em transação: chamado e auditoria não podem divergir.
 *
 * Alterar impacto ou urgência recalcula a prioridade, mas NÃO recalcula
 * prazo_sla — o prazo é um compromisso firmado na abertura. Mudá-lo
 * retroativamente inviabilizaria qualquer indicador.
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
  const sets: string[] = ["atualizado_em = :agoraUpd"];
  const binds: Record<string, unknown> = { id, agoraUpd: agora };
  const eventos: Array<{ campo: string; de: string | null; para: string | null }> = [];

  function aplicar(campo: string, coluna: string, valorNovo: unknown, valorAtual: unknown) {
    if (valorNovo === undefined) return;
    const de = valorAtual == null ? null : String(valorAtual);
    const para = valorNovo == null ? null : String(valorNovo);
    if (de === para) return;
    sets.push(`${coluna} = :${campo}`);
    binds[campo] = valorNovo;
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
      sets.push(`respondido_em = :respondidoEm`);
      binds.respondidoEm = agora;
    }
    if (mudancas.status === "resolvido" && !atual.resolvidoEm) {
      sets.push(`resolvido_em = :resolvidoEm`);
      binds.resolvidoEm = agora;
    }
    if (mudancas.status === "fechado") {
      sets.push(`fechado_em = :fechadoEm`);
      binds.fechadoEm = agora;
      if (!atual.resolvidoEm) {
        sets.push(`resolvido_em = :resolvidoEm2`);
        binds.resolvidoEm2 = agora;
      }
    }
  }

  if (eventos.length === 0) return;

  await emTransacao(async (tx) => {
    await tx.executar(`UPDATE chamados SET ${sets.join(", ")} WHERE id = :id`, binds);

    for (const ev of eventos) {
      await tx.executar(
        `INSERT INTO chamado_historico
           (id, chamado_id, autor_id, campo, valor_anterior, valor_novo, criado_em)
         VALUES (:id, :chamadoId, :autorId, :campo, :de, :para, :criadoEm)`,
        {
          id: novoId(),
          chamadoId: id,
          autorId: ctx.id,
          campo: ev.campo,
          de: ev.de,
          para: ev.para,
          criadoEm: agora,
        },
      );
    }
  });
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

  const existe = await consultarUm(`SELECT id FROM chamados WHERE id = :id`, { id: chamadoId });
  if (!existe) throw new ErroDominio(`Chamado ${chamadoId} não encontrado`);

  await emTransacao(async (tx) => {
    const agora = new Date();
    await tx.executar(
      `INSERT INTO chamado_interacoes (id, chamado_id, autor_id, tipo, corpo, criado_em)
       VALUES (:id, :chamadoId, :autorId, :tipo, :corpo, :criadoEm)`,
      { id: novoId(), chamadoId, autorId: ctx.id, tipo, corpo: corpo.trim(), criadoEm: agora },
    );

    // Primeira resposta pública marca o cumprimento do SLA de resposta.
    if (tipo === "comentario") {
      await tx.executar(
        `UPDATE chamados SET respondido_em = :agora
          WHERE id = :id AND respondido_em IS NULL`,
        { id: chamadoId, agora },
      );
    }
  });
}
