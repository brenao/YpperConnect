import { consultar, consultarUm, executar, emTransacao } from "@/integrations/oracle/client.server";
import { ErroDominio, deBool, paraBool } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Portfólio de projetos: cronograma, WBS, riscos e acompanhamento.
 *
 * A WBS é auto-referenciada por `pai_id`. Predecessoras e responsáveis
 * vivem em tabelas de junção porque no localStorage eram arrays — e
 * array não sobrevive a banco relacional sem virar linha.
 */

export type ProjectStatus = "planejamento" | "execucao" | "paralisado" | "cancelado" | "concluido";

export type QuadroTarefa = "backlog" | "todo" | "doing" | "done";
export type NivelRisco = "alta" | "media" | "baixa";
export type NivelImpacto = "alto" | "medio" | "baixo";

export interface Projeto {
  id: string;
  nome: string;
  objetivo: string | null;
  sponsorId: string | null;
  sponsorNome: string | null;
  gerenteId: string | null;
  gerenteNome: string | null;
  status: ProjectStatus;
  inicio: Date;
  fim: Date;
  criadoEm: Date;
  atualizadoEm: Date;
}

export interface ProjetoComProgresso extends Projeto {
  totalTarefas: number;
  tarefasConcluidas: number;
  /** Média do progresso das tarefas, 0–100. */
  progresso: number;
  riscosAbertos: number;
  atencoesAbertas: number;
  ultimaAtualizacao: Date | null;
}

export interface Tarefa {
  id: string;
  projetoId: string;
  paiId: string | null;
  nome: string;
  atividade: string | null;
  inicio: Date;
  fim: Date;
  progresso: number;
  quadro: QuadroTarefa;
  marco: boolean;
  duracao: number | null;
  duracaoUnidade: string | null;
  alocacaoPct: number | null;
  ordem: number;
  concluidoEm: Date | null;
}

export interface Risco {
  id: string;
  projetoId: string;
  descricao: string;
  probabilidade: NivelRisco;
  impacto: NivelImpacto;
  mitigacao: string | null;
  status: "aberto" | "monitorado" | "mitigado";
  criadoEm: Date;
}

export interface Atualizacao {
  id: string;
  projetoId: string;
  autorId: string | null;
  autorNome: string | null;
  dataRef: Date;
  descricao: string | null;
  ultimasEntregas: string | null;
  proximasEntregas: string | null;
  criadoEm: Date;
}

export interface Atencao {
  id: string;
  projetoId: string;
  titulo: string;
  descricao: string | null;
  decisaoNecessaria: string | null;
  responsavelDecisaoId: string | null;
  responsavelDecisaoNome: string | null;
  status: "aberto" | "resolvido";
  criadoEm: Date;
  resolvidoEm: Date | null;
}

const SELECT_PROJETO = `
  SELECT p.id, p.nome, p.objetivo,
         p.sponsor_id, us.nome AS sponsor_nome,
         p.gerente_id, ug.nome AS gerente_nome,
         p.status, p.inicio, p.fim, p.criado_em, p.atualizado_em
    FROM projetos p
    LEFT JOIN usuarios us ON us.id = p.sponsor_id
    LEFT JOIN usuarios ug ON ug.id = p.gerente_id`;

function novoId(): string {
  return crypto.randomUUID();
}

function exigirTi(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin && ctx.equipeId === null) {
    throw new ErroDominio(`Somente a equipe de TI pode ${acao}`);
  }
}

// ---------------------------------------------------------------- leitura

/**
 * Lista com progresso agregado.
 *
 * O progresso vem da média das tarefas, calculada em SQL: carregar todas
 * as tarefas de todos os projetos para somar no cliente não escala.
 * Projeto sem tarefa fica com 0, não com "indefinido".
 */
export async function listarProjetos(): Promise<ProjetoComProgresso[]> {
  return consultar<ProjetoComProgresso>(
    `SELECT p.id, p.nome, p.objetivo,
            p.sponsor_id, us.nome AS sponsor_nome,
            p.gerente_id, ug.nome AS gerente_nome,
            p.status, p.inicio, p.fim, p.criado_em, p.atualizado_em,
            NVL(t.total, 0) AS total_tarefas,
            NVL(t.concluidas, 0) AS tarefas_concluidas,
            NVL(ROUND(t.media), 0) AS progresso,
            NVL(r.abertos, 0) AS riscos_abertos,
            NVL(a.abertas, 0) AS atencoes_abertas,
            u.ultima AS ultima_atualizacao
       FROM projetos p
       LEFT JOIN usuarios us ON us.id = p.sponsor_id
       LEFT JOIN usuarios ug ON ug.id = p.gerente_id
       LEFT JOIN (SELECT projeto_id,
                         COUNT(*) AS total,
                         COUNT(CASE WHEN quadro = 'done' THEN 1 END) AS concluidas,
                         AVG(progresso) AS media
                    FROM projeto_tarefas GROUP BY projeto_id) t
              ON t.projeto_id = p.id
       LEFT JOIN (SELECT projeto_id, COUNT(*) AS abertos
                    FROM projeto_riscos WHERE status <> 'mitigado'
                   GROUP BY projeto_id) r
              ON r.projeto_id = p.id
       LEFT JOIN (SELECT projeto_id, COUNT(*) AS abertas
                    FROM projeto_atencoes WHERE status = 'aberto'
                   GROUP BY projeto_id) a
              ON a.projeto_id = p.id
       LEFT JOIN (SELECT projeto_id, MAX(data_ref) AS ultima
                    FROM projeto_atualizacoes GROUP BY projeto_id) u
              ON u.projeto_id = p.id
      ORDER BY p.status, p.fim`,
  );
}

export async function buscarProjeto(id: string): Promise<Projeto | null> {
  return consultarUm<Projeto>(`${SELECT_PROJETO} WHERE p.id = :id`, { id });
}

export async function listarTarefas(projetoId: string): Promise<Tarefa[]> {
  const linhas = await consultar<Omit<Tarefa, "marco"> & { marco: number }>(
    `SELECT id, projeto_id, pai_id, nome, atividade, inicio, fim, progresso,
            quadro, marco, duracao, duracao_unidade, alocacao_pct, ordem, concluido_em
       FROM projeto_tarefas
      WHERE projeto_id = :projetoId
      ORDER BY ordem, inicio`,
    { projetoId },
  );
  return linhas.map((l) => ({ ...l, marco: paraBool(l.marco) }));
}

/** Predecessoras e responsáveis, indexados por tarefa. */
export async function listarVinculosTarefas(projetoId: string): Promise<{
  predecessoras: Record<string, string[]>;
  responsaveis: Record<string, string[]>;
}> {
  const [pred, resp] = await Promise.all([
    consultar<{ tarefaId: string; predecessoraId: string }>(
      `SELECT tp.tarefa_id, tp.predecessora_id
         FROM tarefa_predecessoras tp
         JOIN projeto_tarefas t ON t.id = tp.tarefa_id
        WHERE t.projeto_id = :projetoId`,
      { projetoId },
    ),
    consultar<{ tarefaId: string; recursoId: string }>(
      `SELECT tr.tarefa_id, tr.recurso_id
         FROM tarefa_responsaveis tr
         JOIN projeto_tarefas t ON t.id = tr.tarefa_id
        WHERE t.projeto_id = :projetoId`,
      { projetoId },
    ),
  ]);

  const predecessoras: Record<string, string[]> = {};
  for (const p of pred) {
    (predecessoras[p.tarefaId] ??= []).push(p.predecessoraId);
  }
  const responsaveis: Record<string, string[]> = {};
  for (const r of resp) {
    (responsaveis[r.tarefaId] ??= []).push(r.recursoId);
  }
  return { predecessoras, responsaveis };
}

export async function listarRiscos(projetoId: string): Promise<Risco[]> {
  return consultar<Risco>(
    `SELECT id, projeto_id, descricao, probabilidade, impacto, mitigacao, status, criado_em
       FROM projeto_riscos WHERE projeto_id = :projetoId ORDER BY criado_em DESC`,
    { projetoId },
  );
}

export async function listarAtualizacoes(projetoId: string): Promise<Atualizacao[]> {
  return consultar<Atualizacao>(
    `SELECT a.id, a.projeto_id, a.autor_id, u.nome AS autor_nome, a.data_ref,
            a.descricao, a.ultimas_entregas, a.proximas_entregas, a.criado_em
       FROM projeto_atualizacoes a
       LEFT JOIN usuarios u ON u.id = a.autor_id
      WHERE a.projeto_id = :projetoId
      ORDER BY a.data_ref DESC`,
    { projetoId },
  );
}

export async function listarAtencoes(projetoId: string): Promise<Atencao[]> {
  return consultar<Atencao>(
    `SELECT a.id, a.projeto_id, a.titulo, a.descricao, a.decisao_necessaria,
            a.responsavel_decisao_id, u.nome AS responsavel_decisao_nome,
            a.status, a.criado_em, a.resolvido_em
       FROM projeto_atencoes a
       LEFT JOIN usuarios u ON u.id = a.responsavel_decisao_id
      WHERE a.projeto_id = :projetoId
      ORDER BY a.status, a.criado_em DESC`,
    { projetoId },
  );
}

// ---------------------------------------------------------------- escrita

export interface DadosProjeto {
  nome: string;
  objetivo?: string | null | undefined;
  sponsorId?: string | null | undefined;
  gerenteId?: string | null | undefined;
  status?: ProjectStatus | undefined;
  inicio: Date;
  fim: Date;
}

function validarProjeto(d: DadosProjeto): void {
  if (d.nome.trim().length < 3) throw new ErroDominio("Informe o nome do projeto");
  if (d.fim < d.inicio) throw new ErroDominio("Data de término anterior ao início");
}

export async function criarProjeto(ctx: ContextoUsuario, d: DadosProjeto): Promise<string> {
  exigirTi(ctx, "criar projetos");
  validarProjeto(d);

  const id = novoId();
  await executar(
    `INSERT INTO projetos
       (id, nome, objetivo, sponsor_id, gerente_id, status, inicio, fim,
        criado_em, atualizado_em)
     VALUES
       (:id, :nome, :objetivo, :sponsorId, :gerenteId, :status, :inicio, :fim,
        SYSTIMESTAMP, SYSTIMESTAMP)`,
    {
      id,
      nome: d.nome.trim(),
      objetivo: d.objetivo?.trim() ?? null,
      sponsorId: d.sponsorId ?? null,
      // Sem gerente informado, assume quem criou: projeto órfão não tem
      // quem responda por ele na visão de diretoria.
      gerenteId: d.gerenteId ?? ctx.id,
      status: d.status ?? "planejamento",
      inicio: d.inicio,
      fim: d.fim,
    },
  );
  return id;
}

export async function atualizarProjeto(
  ctx: ContextoUsuario,
  id: string,
  d: DadosProjeto,
): Promise<void> {
  exigirTi(ctx, "alterar projetos");
  validarProjeto(d);

  const n = await executar(
    `UPDATE projetos
        SET nome = :nome, objetivo = :objetivo, sponsor_id = :sponsorId,
            gerente_id = :gerenteId, status = NVL(:status, status),
            inicio = :inicio, fim = :fim, atualizado_em = SYSTIMESTAMP
      WHERE id = :id`,
    {
      id,
      nome: d.nome.trim(),
      objetivo: d.objetivo?.trim() ?? null,
      sponsorId: d.sponsorId ?? null,
      gerenteId: d.gerenteId ?? null,
      status: d.status ?? null,
      inicio: d.inicio,
      fim: d.fim,
    },
  );
  if (n === 0) throw new ErroDominio(`Projeto ${id} não encontrado`);
}

export interface DadosTarefa {
  projetoId: string;
  paiId?: string | null | undefined;
  nome: string;
  atividade?: string | null | undefined;
  inicio: Date;
  fim: Date;
  progresso?: number | undefined;
  quadro?: QuadroTarefa | undefined;
  marco?: boolean | undefined;
  alocacaoPct?: number | null | undefined;
  ordem?: number | undefined;
  responsaveis?: string[] | undefined;
  predecessoras?: string[] | undefined;
}

/**
 * Cria tarefa com seus vínculos em transação: tarefa sem responsável
 * por falha parcial desmonta o cálculo de capacidade.
 */
export async function criarTarefa(ctx: ContextoUsuario, d: DadosTarefa): Promise<string> {
  exigirTi(ctx, "criar tarefas");
  if (d.nome.trim().length < 3) throw new ErroDominio("Informe o nome da tarefa");
  if (d.fim < d.inicio) throw new ErroDominio("Data de término anterior ao início");

  const id = novoId();

  await emTransacao(async (tx) => {
    await tx.executar(
      `INSERT INTO projeto_tarefas
         (id, projeto_id, pai_id, nome, atividade, inicio, fim, progresso,
          quadro, marco, alocacao_pct, ordem)
       VALUES
         (:id, :projetoId, :paiId, :nome, :atividade, :inicio, :fim, :progresso,
          :quadro, :marco, :alocacaoPct, :ordem)`,
      {
        id,
        projetoId: d.projetoId,
        paiId: d.paiId ?? null,
        nome: d.nome.trim(),
        atividade: d.atividade?.trim() ?? null,
        inicio: d.inicio,
        fim: d.fim,
        progresso: d.progresso ?? 0,
        quadro: d.quadro ?? "backlog",
        marco: deBool(d.marco),
        alocacaoPct: d.alocacaoPct ?? null,
        ordem: d.ordem ?? 0,
      },
    );

    for (const r of new Set(d.responsaveis ?? [])) {
      await tx.executar(`INSERT INTO tarefa_responsaveis (tarefa_id, recurso_id) VALUES (:t, :r)`, {
        t: id,
        r,
      });
    }
    for (const p of new Set(d.predecessoras ?? [])) {
      if (p === id) continue;
      await tx.executar(
        `INSERT INTO tarefa_predecessoras (tarefa_id, predecessora_id) VALUES (:t, :p)`,
        { t: id, p },
      );
    }
  });

  return id;
}

export async function atualizarTarefa(
  ctx: ContextoUsuario,
  id: string,
  d: Omit<DadosTarefa, "projetoId">,
): Promise<void> {
  exigirTi(ctx, "alterar tarefas");
  if (d.fim < d.inicio) throw new ErroDominio("Data de término anterior ao início");

  await emTransacao(async (tx) => {
    // quadro 'done' e progresso 100 andam juntos: deixar divergir
    // produz kanban que não bate com o percentual do cronograma.
    const concluida = d.quadro === "done" || d.progresso === 100;

    const n = await tx.executar(
      `UPDATE projeto_tarefas
          SET pai_id = :paiId, nome = NVL(:nome, nome), atividade = :atividade,
              inicio = :inicio, fim = :fim,
              progresso = :progresso, quadro = :quadro, marco = :marco,
              alocacao_pct = :alocacaoPct, ordem = NVL(:ordem, ordem),
              concluido_em = CASE WHEN :concluida = 1
                                  THEN NVL(concluido_em, SYSTIMESTAMP) ELSE NULL END
        WHERE id = :id`,
      {
        id,
        paiId: d.paiId ?? null,
        nome: d.nome?.trim() ?? null,
        atividade: d.atividade?.trim() ?? null,
        inicio: d.inicio,
        fim: d.fim,
        progresso: concluida ? 100 : (d.progresso ?? 0),
        quadro: concluida ? "done" : (d.quadro ?? "backlog"),
        marco: deBool(d.marco),
        alocacaoPct: d.alocacaoPct ?? null,
        ordem: d.ordem ?? null,
        concluida: deBool(concluida),
      },
    );
    if (n === 0) throw new ErroDominio(`Tarefa ${id} não encontrada`);

    if (d.responsaveis) {
      await tx.executar(`DELETE FROM tarefa_responsaveis WHERE tarefa_id = :id`, { id });
      for (const r of new Set(d.responsaveis)) {
        await tx.executar(
          `INSERT INTO tarefa_responsaveis (tarefa_id, recurso_id) VALUES (:t, :r)`,
          { t: id, r },
        );
      }
    }
    if (d.predecessoras) {
      await tx.executar(`DELETE FROM tarefa_predecessoras WHERE tarefa_id = :id`, { id });
      for (const p of new Set(d.predecessoras)) {
        if (p === id) continue;
        await tx.executar(
          `INSERT INTO tarefa_predecessoras (tarefa_id, predecessora_id) VALUES (:t, :p)`,
          { t: id, p },
        );
      }
    }
  });
}

/** Move a tarefa no kanban. Atalho para o arrastar-e-soltar. */
export async function moverTarefa(
  ctx: ContextoUsuario,
  id: string,
  quadro: QuadroTarefa,
): Promise<void> {
  exigirTi(ctx, "mover tarefas");
  const concluida = quadro === "done";
  await executar(
    `UPDATE projeto_tarefas
        SET quadro = :quadro,
            progresso = CASE WHEN :concluida = 1 THEN 100 ELSE progresso END,
            concluido_em = CASE WHEN :concluida = 1
                                THEN NVL(concluido_em, SYSTIMESTAMP) ELSE NULL END
      WHERE id = :id`,
    { id, quadro, concluida: deBool(concluida) },
  );
}

/** Exclusão em cascata na aplicação: o Oracle não faz cascade em auto-FK. */
export async function excluirTarefa(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirTi(ctx, "excluir tarefas");
  await emTransacao(async (tx) => {
    const filhas = await tx.consultar<{ id: string }>(
      `SELECT id FROM projeto_tarefas WHERE pai_id = :id`,
      { id },
    );
    for (const f of filhas) {
      await tx.executar(`DELETE FROM projeto_tarefas WHERE id = :id`, { id: f.id });
    }
    await tx.executar(`DELETE FROM tarefa_predecessoras WHERE predecessora_id = :id`, { id });
    await tx.executar(`DELETE FROM projeto_tarefas WHERE id = :id`, { id });
  });
}

/**
 * Declarado à mão em vez de Omit<Risco, ...>: o Omit herda
 * `mitigacao: string | null` e, sob exactOptionalPropertyTypes, recusa
 * o `undefined` que o objeto do Zod produz.
 */
export interface DadosRisco {
  projetoId: string;
  descricao: string;
  probabilidade: NivelRisco;
  impacto: NivelImpacto;
  mitigacao?: string | null | undefined;
  status?: "aberto" | "monitorado" | "mitigado" | undefined;
}

export async function criarRisco(ctx: ContextoUsuario, d: DadosRisco): Promise<string> {
  exigirTi(ctx, "registrar riscos");
  const id = novoId();
  await executar(
    `INSERT INTO projeto_riscos
       (id, projeto_id, descricao, probabilidade, impacto, mitigacao, status, criado_em)
     VALUES (:id, :projetoId, :descricao, :probabilidade, :impacto, :mitigacao,
             :status, SYSTIMESTAMP)`,
    {
      id,
      projetoId: d.projetoId,
      descricao: d.descricao.trim(),
      probabilidade: d.probabilidade,
      impacto: d.impacto,
      mitigacao: d.mitigacao?.trim() ?? null,
      status: d.status ?? "aberto",
    },
  );
  return id;
}

export interface DadosAtualizacao {
  projetoId: string;
  dataRef: Date;
  descricao?: string | null | undefined;
  ultimasEntregas?: string | null | undefined;
  proximasEntregas?: string | null | undefined;
}

export async function criarAtualizacao(ctx: ContextoUsuario, d: DadosAtualizacao): Promise<string> {
  exigirTi(ctx, "registrar atualizações");
  const id = novoId();
  await executar(
    `INSERT INTO projeto_atualizacoes
       (id, projeto_id, autor_id, data_ref, descricao, ultimas_entregas,
        proximas_entregas, criado_em)
     VALUES (:id, :projetoId, :autorId, :dataRef, :descricao, :ultimas,
             :proximas, SYSTIMESTAMP)`,
    {
      id,
      projetoId: d.projetoId,
      autorId: ctx.id,
      dataRef: d.dataRef,
      descricao: d.descricao?.trim() ?? null,
      ultimas: d.ultimasEntregas?.trim() ?? null,
      proximas: d.proximasEntregas?.trim() ?? null,
    },
  );
  return id;
}

export interface DadosAtencao {
  projetoId: string;
  titulo: string;
  descricao?: string | null | undefined;
  decisaoNecessaria?: string | null | undefined;
  responsavelDecisaoId?: string | null | undefined;
}

export async function criarAtencao(ctx: ContextoUsuario, d: DadosAtencao): Promise<string> {
  exigirTi(ctx, "registrar pontos de atenção");
  const id = novoId();
  await executar(
    `INSERT INTO projeto_atencoes
       (id, projeto_id, titulo, descricao, decisao_necessaria,
        responsavel_decisao_id, status, criado_em)
     VALUES (:id, :projetoId, :titulo, :descricao, :decisao, :responsavelId,
             'aberto', SYSTIMESTAMP)`,
    {
      id,
      projetoId: d.projetoId,
      titulo: d.titulo.trim(),
      descricao: d.descricao?.trim() ?? null,
      decisao: d.decisaoNecessaria?.trim() ?? null,
      responsavelId: d.responsavelDecisaoId ?? null,
    },
  );
  return id;
}

export async function resolverAtencao(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirTi(ctx, "resolver pontos de atenção");
  await executar(
    `UPDATE projeto_atencoes SET status = 'resolvido', resolvido_em = SYSTIMESTAMP
      WHERE id = :id`,
    { id },
  );
}
