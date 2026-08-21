import {
  consultar,
  consultarUm,
  executar,
  emTransacao,
} from "@/integrations/postgres/client.server";
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

/**
 * Quem pode mexer neste projeto.
 *
 * Projeto é o único módulo aberto a toda a empresa: qualquer pessoa
 * cadastra o seu. Como consequência, ela precisa conseguir montar o
 * cronograma dele — liberar a criação e travar as tarefas produziria um
 * projeto que ninguém consegue tocar.
 *
 * O acesso é por projeto, não por papel global: gerente e sponsor
 * mandam no que é deles, e TI e admin mandam em tudo, porque respondem
 * pela carteira inteira na visão de diretoria.
 */
async function exigirAcessoProjeto(
  ctx: ContextoUsuario,
  projetoId: string,
  acao: string,
): Promise<void> {
  if (ctx.admin || ctx.equipeId !== null) return;

  const p = await consultarUm<{ gerenteId: string | null; sponsorId: string | null }>(
    `SELECT gerente_id, sponsor_id FROM projetos WHERE id = :id`,
    { id: projetoId },
  );
  if (!p) throw new ErroDominio(`Projeto ${projetoId} não encontrado`);

  if (p.gerenteId !== ctx.id && p.sponsorId !== ctx.id) {
    throw new ErroDominio(`Somente o gerente do projeto ou a equipe de TI pode ${acao}`);
  }
}

/** Mesma regra, quando só se tem a tarefa em mãos. */
async function exigirAcessoTarefa(
  ctx: ContextoUsuario,
  tarefaId: string,
  acao: string,
): Promise<void> {
  if (ctx.admin || ctx.equipeId !== null) return;

  const t = await consultarUm<{ projetoId: string }>(
    `SELECT projeto_id FROM projeto_tarefas WHERE id = :id`,
    { id: tarefaId },
  );
  if (!t) throw new ErroDominio(`Tarefa ${tarefaId} não encontrada`);
  await exigirAcessoProjeto(ctx, t.projetoId, acao);
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
            COALESCE(t.total, 0) AS total_tarefas,
            COALESCE(t.concluidas, 0) AS tarefas_concluidas,
            COALESCE(ROUND(t.media), 0) AS progresso,
            COALESCE(r.abertos, 0) AS riscos_abertos,
            COALESCE(a.abertas, 0) AS atencoes_abertas,
            u.ultima AS ultima_atualizacao
       FROM projetos p
       LEFT JOIN usuarios us ON us.id = p.sponsor_id
       LEFT JOIN usuarios ug ON ug.id = p.gerente_id
       LEFT JOIN (SELECT projeto_id,
                         COUNT(*) AS total,
                         COUNT(CASE WHEN quadro = 'done' THEN 1 END) AS concluidas,
                         AVG(progresso) AS media
                    FROM projeto_tarefas WHERE ativo = 1
                   GROUP BY projeto_id) t
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
      WHERE projeto_id = :projetoId AND ativo = 1
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
        WHERE t.projeto_id = :projetoId AND t.ativo = 1`,
      { projetoId },
    ),
    consultar<{ tarefaId: string; recursoId: string }>(
      `SELECT tr.tarefa_id, tr.recurso_id
         FROM tarefa_responsaveis tr
         JOIN projeto_tarefas t ON t.id = tr.tarefa_id
        WHERE t.projeto_id = :projetoId AND t.ativo = 1`,
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

/**
 * Cria projeto. Aberto a qualquer usuário ativo, por regra de negócio:
 * a gestão de projetos não é privilégio da TI.
 */
export async function criarProjeto(ctx: ContextoUsuario, d: DadosProjeto): Promise<string> {
  validarProjeto(d);

  const id = novoId();
  await executar(
    `INSERT INTO projetos
       (id, nome, objetivo, sponsor_id, gerente_id, status, inicio, fim,
        criado_em, atualizado_em)
     VALUES
       (:id, :nome, :objetivo, :sponsorId, :gerenteId, :status, :inicio, :fim,
        LOCALTIMESTAMP, LOCALTIMESTAMP)`,
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
  await exigirAcessoProjeto(ctx, id, "alterar este projeto");
  validarProjeto(d);

  const n = await executar(
    `UPDATE projetos
        SET nome = :nome, objetivo = :objetivo, sponsor_id = :sponsorId,
            gerente_id = :gerenteId, status = COALESCE(:status, status),
            inicio = :inicio, fim = :fim, atualizado_em = LOCALTIMESTAMP
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
  await exigirAcessoProjeto(ctx, d.projetoId, "criar tarefas neste projeto");
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
  await exigirAcessoTarefa(ctx, id, "alterar tarefas deste projeto");
  if (d.fim < d.inicio) throw new ErroDominio("Data de término anterior ao início");

  await emTransacao(async (tx) => {
    // quadro 'done' e progresso 100 andam juntos: deixar divergir
    // produz kanban que não bate com o percentual do cronograma.
    const concluida = d.quadro === "done" || d.progresso === 100;

    const n = await tx.executar(
      `UPDATE projeto_tarefas
          SET pai_id = :paiId, nome = COALESCE(:nome, nome), atividade = :atividade,
              inicio = :inicio, fim = :fim,
              progresso = :progresso, quadro = :quadro, marco = :marco,
              alocacao_pct = :alocacaoPct, ordem = COALESCE(:ordem, ordem),
              concluido_em = CASE WHEN :concluida = 1
                                  THEN COALESCE(concluido_em, LOCALTIMESTAMP) ELSE NULL END
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
  await exigirAcessoTarefa(ctx, id, "mover tarefas deste projeto");
  const concluida = quadro === "done";
  await executar(
    `UPDATE projeto_tarefas
        SET quadro = :quadro,
            progresso = CASE WHEN :concluida = 1 THEN 100 ELSE progresso END,
            concluido_em = CASE WHEN :concluida = 1
                                THEN COALESCE(concluido_em, LOCALTIMESTAMP) ELSE NULL END
      WHERE id = :id`,
    { id, quadro, concluida: deBool(concluida) },
  );
}

/**
 * Desativa a tarefa e toda a sua descendência.
 *
 * Não é DELETE: a tarefa sai do cronograma, para de contar no rollup e
 * no CPM, mas continua no banco. É o que mantém o histórico de
 * baselines íntegro — `baseline_tarefas` guarda o `tarefa_id` sem
 * chave estrangeira, e apagar a linha deixaria a foto do plano
 * apontando para algo que não existe mais.
 *
 * Os vínculos de predecessora ficam onde estão. Quem depende de uma
 * tarefa desativada simplesmente deixa de vê-la: o CPM descarta
 * predecessora que não está na lista de tarefas vivas.
 *
 * A recursão desce a árvore inteira num comando só — desativar a mãe e
 * deixar as filhas visíveis produziria órfãs soltas na grade.
 */
export async function excluirTarefa(ctx: ContextoUsuario, id: string): Promise<void> {
  await exigirAcessoTarefa(ctx, id, "excluir tarefas deste projeto");
  const n = await executar(
    `WITH RECURSIVE arvore AS (
       SELECT id FROM projeto_tarefas WHERE id = :id
       UNION ALL
       SELECT t.id FROM projeto_tarefas t JOIN arvore a ON t.pai_id = a.id
     )
     UPDATE projeto_tarefas SET ativo = 0
      WHERE id IN (SELECT id FROM arvore)`,
    { id },
  );
  if (n === 0) throw new ErroDominio(`Tarefa ${id} não encontrada`);
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
  await exigirAcessoProjeto(ctx, d.projetoId, "registrar riscos neste projeto");
  const id = novoId();
  await executar(
    `INSERT INTO projeto_riscos
       (id, projeto_id, descricao, probabilidade, impacto, mitigacao, status, criado_em)
     VALUES (:id, :projetoId, :descricao, :probabilidade, :impacto, :mitigacao,
             :status, LOCALTIMESTAMP)`,
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
  await exigirAcessoProjeto(ctx, d.projetoId, "registrar atualizações neste projeto");
  const id = novoId();
  await executar(
    `INSERT INTO projeto_atualizacoes
       (id, projeto_id, autor_id, data_ref, descricao, ultimas_entregas,
        proximas_entregas, criado_em)
     VALUES (:id, :projetoId, :autorId, :dataRef, :descricao, :ultimas,
             :proximas, LOCALTIMESTAMP)`,
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
  await exigirAcessoProjeto(ctx, d.projetoId, "registrar pontos de atenção neste projeto");
  const id = novoId();
  await executar(
    `INSERT INTO projeto_atencoes
       (id, projeto_id, titulo, descricao, decisao_necessaria,
        responsavel_decisao_id, status, criado_em)
     VALUES (:id, :projetoId, :titulo, :descricao, :decisao, :responsavelId,
             'aberto', LOCALTIMESTAMP)`,
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
  // O acesso é por projeto, e o ponto de atenção só sabe o próprio id:
  // precisa descobrir a que projeto pertence antes de decidir.
  const a = await consultarUm<{ projetoId: string }>(
    `SELECT projeto_id FROM projeto_atencoes WHERE id = :id`,
    { id },
  );
  if (!a) throw new ErroDominio(`Ponto de atenção ${id} não encontrado`);
  await exigirAcessoProjeto(ctx, a.projetoId, "resolver pontos de atenção deste projeto");

  await executar(
    `UPDATE projeto_atencoes SET status = 'resolvido', resolvido_em = LOCALTIMESTAMP
      WHERE id = :id`,
    { id },
  );
}

// ---------------------------------------------------------------- rollup

export interface TarefaCalculada extends Tarefa {
  /** true quando tem filhas: valores vêm do rollup e não são editáveis. */
  ehPai: boolean;
  /** Progresso efetivo: próprio se folha, ponderado pelas filhas se pai. */
  progressoEfetivo: number;
  /** Datas efetivas: próprias se folha, min/max das filhas se pai. */
  inicioEfetivo: Date;
  fimEfetivo: Date;
  /** Quantidade de folhas sob esta tarefa. */
  totalFolhas: number;
}

const DIA_MS = 86_400_000;

/**
 * Calcula o rollup das tarefas mãe a partir das folhas.
 *
 * Feito na leitura, não gravado: pai com valor próprio dessincroniza
 * assim que alguém edita uma filha, e aí a tela mostra um número que o
 * banco contradiz.
 *
 * A ponderação é por duração — tarefa de 20 dias pesa mais que uma de 2.
 * Média simples faria uma subtarefa trivial concluída puxar o pai para
 * cima como se fosse metade do trabalho.
 */
export function calcularRollup(tarefas: Tarefa[]): TarefaCalculada[] {
  const filhasDe = new Map<string, Tarefa[]>();
  for (const t of tarefas) {
    if (t.paiId) filhasDe.set(t.paiId, [...(filhasDe.get(t.paiId) ?? []), t]);
  }

  const cache = new Map<string, TarefaCalculada>();
  // Guarda contra ciclo em pai_id, que o banco só impede no self.
  const emCurso = new Set<string>();

  function resolver(t: Tarefa): TarefaCalculada {
    const pronto = cache.get(t.id);
    if (pronto) return pronto;

    const filhas = filhasDe.get(t.id) ?? [];
    const folha = filhas.length === 0 || emCurso.has(t.id);

    if (folha) {
      const r: TarefaCalculada = {
        ...t,
        ehPai: false,
        progressoEfetivo: t.progresso,
        inicioEfetivo: new Date(t.inicio),
        fimEfetivo: new Date(t.fim),
        totalFolhas: 1,
      };
      cache.set(t.id, r);
      return r;
    }

    emCurso.add(t.id);
    const calc = filhas.map(resolver);
    emCurso.delete(t.id);

    const pesos = calc.map((c) =>
      Math.max(1, Math.round((c.fimEfetivo.getTime() - c.inicioEfetivo.getTime()) / DIA_MS) + 1),
    );
    const total = pesos.reduce((s, p) => s + p, 0);
    const somaPonderada = calc.reduce((s, c, i) => s + c.progressoEfetivo * (pesos[i] ?? 1), 0);

    const r: TarefaCalculada = {
      ...t,
      ehPai: true,
      progressoEfetivo: total ? Math.round(somaPonderada / total) : 0,
      inicioEfetivo: new Date(Math.min(...calc.map((c) => c.inicioEfetivo.getTime()))),
      fimEfetivo: new Date(Math.max(...calc.map((c) => c.fimEfetivo.getTime()))),
      totalFolhas: calc.reduce((s, c) => s + c.totalFolhas, 0),
    };
    cache.set(t.id, r);
    return r;
  }

  return tarefas.map(resolver);
}

// ------------------------------------------------------- edição inline

export type UnidadeDuracao = "horas" | "dias";

/** Jornada usada para converter horas em dias corridos de cronograma. */
export const HORAS_POR_DIA = 8;

/**
 * Duração informada pelo usuário para dias de calendário da tarefa.
 * Arredonda para cima: 4h e 8h ocupam o mesmo dia na grade.
 */
export function duracaoParaDias(duracao: number, unidade: UnidadeDuracao): number {
  const dias = unidade === "horas" ? duracao / HORAS_POR_DIA : duracao;
  return Math.max(1, Math.ceil(dias));
}

/** Caminho inverso, para exibir a duração de tarefa que só tem datas. */
export function diasParaDuracao(dias: number, unidade: UnidadeDuracao): number {
  return unidade === "horas" ? dias * HORAS_POR_DIA : dias;
}

export interface CampoTarefa {
  progresso?: number | undefined;
  inicio?: Date | undefined;
  fim?: Date | undefined;
  nome?: string | undefined;
  /** Quando vem, recalcula `fim` a partir do início. */
  duracao?: number | undefined;
  duracaoUnidade?: UnidadeDuracao | undefined;
}

/**
 * Atualiza campos isolados, sem tocar em vínculos. É o que a edição
 * inline do cronograma usa: salvar a tarefa inteira a cada saída de
 * campo apagaria responsáveis e predecessoras que não vieram no payload.
 *
 * Recusa alteração em tarefa que tem filhas: os valores do pai são
 * derivados, e gravá-los criaria um número que o rollup contradiz.
 */
export async function atualizarCampoTarefa(
  ctx: ContextoUsuario,
  id: string,
  d: CampoTarefa,
): Promise<void> {
  await exigirAcessoTarefa(ctx, id, "alterar tarefas deste projeto");

  const filhas = await consultarUm<{ total: number }>(
    `SELECT COUNT(*) AS total FROM projeto_tarefas WHERE pai_id = :id AND ativo = 1`,
    { id },
  );
  if ((filhas?.total ?? 0) > 0) {
    throw new ErroDominio("Tarefa com subtarefas tem datas e progresso calculados a partir delas.");
  }

  const atual = await consultarUm<{ inicio: Date; fim: Date; duracaoUnidade: string | null }>(
    `SELECT inicio, fim, duracao_unidade FROM projeto_tarefas WHERE id = :id`,
    { id },
  );
  if (!atual) throw new ErroDominio(`Tarefa ${id} não encontrada`);

  const inicio = d.inicio ?? new Date(atual.inicio);

  // Duração manda no término: quem digita "16h" espera que o fim ande,
  // não que o sistema reclame de incoerência com a data antiga.
  let fim = d.fim ?? new Date(atual.fim);
  let duracao: number | null = null;
  let unidade: UnidadeDuracao | null = null;

  if (d.duracao !== undefined) {
    if (!Number.isFinite(d.duracao) || d.duracao <= 0) {
      throw new ErroDominio("Duração deve ser maior que zero");
    }
    const anterior = atual.duracaoUnidade === "dias" ? "dias" : "horas";
    unidade = d.duracaoUnidade ?? anterior;
    duracao = d.duracao;

    fim = new Date(inicio);
    fim.setDate(fim.getDate() + duracaoParaDias(d.duracao, unidade) - 1);
  } else if (d.duracaoUnidade !== undefined) {
    // Só trocou a unidade de exibição: converte o valor guardado.
    unidade = d.duracaoUnidade;
    const diasAtuais =
      Math.round(
        (new Date(fim).setHours(0, 0, 0, 0) - new Date(inicio).setHours(0, 0, 0, 0)) / 86_400_000,
      ) + 1;
    duracao = diasParaDuracao(Math.max(1, diasAtuais), d.duracaoUnidade);
  }

  if (fim < inicio) throw new ErroDominio("Data de término anterior ao início");

  const concluida = d.progresso === 100;

  await executar(
    `UPDATE projeto_tarefas
        SET nome = COALESCE(:nome, nome),
            progresso = COALESCE(:progresso, progresso),
            inicio = :inicio,
            fim = :fim,
            duracao = COALESCE(:duracao, duracao),
            duracao_unidade = COALESCE(:unidade, duracao_unidade),
            quadro = CASE WHEN :concluida = 1 THEN 'done'
                          WHEN quadro = 'done' THEN 'doing' ELSE quadro END,
            concluido_em = CASE WHEN :concluida = 1
                                THEN COALESCE(concluido_em, LOCALTIMESTAMP) ELSE NULL END
      WHERE id = :id`,
    {
      id,
      nome: d.nome?.trim() ?? null,
      progresso: d.progresso ?? null,
      inicio,
      fim,
      duracao,
      unidade,
      concluida: deBool(concluida),
    },
  );
}

/**
 * Insere uma tarefa logo abaixo da referência, herdando o mesmo pai.
 * Abre espaço na ordenação para a nova linha entrar no lugar certo.
 */
export async function inserirAbaixo(
  ctx: ContextoUsuario,
  referenciaId: string,
  comoFilha: boolean,
): Promise<string> {
  await exigirAcessoTarefa(ctx, referenciaId, "criar tarefas neste projeto");

  const ref = await consultarUm<{
    projetoId: string;
    paiId: string | null;
    ordem: number;
    inicio: Date;
    fim: Date;
  }>(`SELECT projeto_id, pai_id, ordem, inicio, fim FROM projeto_tarefas WHERE id = :id`, {
    id: referenciaId,
  });
  if (!ref) throw new ErroDominio("Tarefa de referência não encontrada");

  const id = novoId();
  const paiId = comoFilha ? referenciaId : ref.paiId;

  await emTransacao(async (tx) => {
    await tx.executar(
      `UPDATE projeto_tarefas SET ordem = ordem + 1
        WHERE projeto_id = :projetoId AND ordem > :ordem`,
      { projetoId: ref.projetoId, ordem: ref.ordem },
    );
    await tx.executar(
      `INSERT INTO projeto_tarefas
         (id, projeto_id, pai_id, nome, inicio, fim, progresso, quadro, marco, ordem)
       VALUES (:id, :projetoId, :paiId, 'Nova tarefa', :inicio, :fim, 0, 'backlog', 0, :ordem)`,
      {
        id,
        projetoId: ref.projetoId,
        paiId,
        inicio: ref.inicio,
        fim: ref.fim,
        ordem: ref.ordem + 1,
      },
    );
  });

  return id;
}

// ---------------------------------------------------------------- baseline

export interface Baseline {
  id: string;
  projetoId: string;
  versao: number;
  descricao: string | null;
  autorId: string | null;
  autorNome: string | null;
  criadoEm: Date;
}

export interface BaselineTarefa {
  tarefaId: string;
  nome: string;
  inicio: Date;
  fim: Date;
}

export async function listarBaselines(projetoId: string): Promise<Baseline[]> {
  return consultar<Baseline>(
    `SELECT b.id, b.projeto_id, b.versao, b.descricao, b.autor_id,
            u.nome AS autor_nome, b.criado_em
       FROM projeto_baselines b
       LEFT JOIN usuarios u ON u.id = b.autor_id
      WHERE b.projeto_id = :projetoId
      ORDER BY b.versao DESC`,
    { projetoId },
  );
}

/** Tarefas da baseline mais antiga: é contra o plano original que se mede. */
export async function baselineOriginal(projetoId: string): Promise<BaselineTarefa[]> {
  return consultar<BaselineTarefa>(
    `SELECT bt.tarefa_id, bt.nome, bt.inicio, bt.fim
       FROM baseline_tarefas bt
       JOIN projeto_baselines b ON b.id = bt.baseline_id
      WHERE b.projeto_id = :projetoId
        AND b.versao = (SELECT MIN(versao) FROM projeto_baselines WHERE projeto_id = :projetoId)`,
    { projetoId },
  );
}

export async function salvarBaseline(
  ctx: ContextoUsuario,
  projetoId: string,
  descricao?: string | null | undefined,
): Promise<string> {
  await exigirAcessoProjeto(ctx, projetoId, "salvar baseline deste projeto");

  const id = novoId();
  await emTransacao(async (tx) => {
    const v = await tx.consultar<{ prox: number }>(
      `SELECT COALESCE(MAX(versao), 0) + 1 AS prox FROM projeto_baselines WHERE projeto_id = :p`,
      { p: projetoId },
    );
    const versao = v[0]?.prox ?? 1;

    await tx.executar(
      `INSERT INTO projeto_baselines (id, projeto_id, versao, descricao, autor_id, criado_em)
       VALUES (:id, :projetoId, :versao, :descricao, :autorId, LOCALTIMESTAMP)`,
      { id, projetoId, versao, descricao: descricao?.trim() ?? null, autorId: ctx.id },
    );

    // INSERT SELECT: copia o cronograma inteiro numa ida só.
    await tx.executar(
      `INSERT INTO baseline_tarefas (baseline_id, tarefa_id, nome, inicio, fim)
              SELECT :id, id, nome, inicio, fim
         FROM projeto_tarefas WHERE projeto_id = :projetoId AND ativo = 1`,
      { id, projetoId },
    );
  });

  return id;
}

// ------------------------------------------------------------------- CPM

export interface DadosCpm {
  /** Duração em dias corridos, início e fim inclusive. */
  duracaoDias: number;
  /** Quanto a tarefa pode atrasar sem empurrar o fim do projeto. */
  folgaDias: number;
  /** Folga zero: atraso aqui atrasa o projeto inteiro. */
  critica: boolean;
}

const UM_DIA = 86_400_000;

function duracaoEmDias(inicio: Date, fim: Date): number {
  const a = new Date(inicio).setHours(0, 0, 0, 0);
  const b = new Date(fim).setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((b - a) / UM_DIA) + 1);
}

/**
 * Caminho crítico pelo método CPM.
 *
 * Só folhas participam: tarefa mãe é resumo, e incluí-la duplicaria a
 * duração das filhas no cálculo.
 *
 * A duração vem das datas, não o contrário. Num CPM clássico a duração
 * dirige o cronograma; aqui as datas são definidas pelo usuário e o CPM
 * responde outra pergunta — quanto cada tarefa pode escorregar antes de
 * empurrar a entrega. É a informação que interessa a quem acompanha.
 */
export function calcularCpm(
  tarefas: TarefaCalculada[],
  predecessoras: Record<string, string[]>,
): Map<string, DadosCpm> {
  const folhas = tarefas.filter((t) => !t.ehPai);
  const porId = new Map(folhas.map((t) => [t.id, t]));
  const saida = new Map<string, DadosCpm>();
  if (folhas.length === 0) return saida;

  // Predecessoras que apontam para tarefa inexistente ou para um pai são
  // descartadas: manteriam o grafo preso num nó que nunca resolve.
  const pred = new Map<string, string[]>();
  for (const t of folhas) {
    pred.set(
      t.id,
      (predecessoras[t.id] ?? []).filter((p) => porId.has(p) && p !== t.id),
    );
  }

  const suc = new Map<string, string[]>();
  for (const [id, ps] of pred) {
    for (const p of ps) suc.set(p, [...(suc.get(p) ?? []), id]);
  }

  const dur = new Map<string, number>();
  for (const t of folhas) dur.set(t.id, duracaoEmDias(t.inicioEfetivo, t.fimEfetivo));

  // Ordenação topológica. Ciclo em predecessora é possível — o banco só
  // impede a auto-referência —, então a marca de visitado corta o laço e
  // as tarefas envolvidas ficam sem folga calculada em vez de travar.
  const ordem: string[] = [];
  const estado = new Map<string, 0 | 1 | 2>();

  function visitar(id: string) {
    const e = estado.get(id) ?? 0;
    if (e === 2) return;
    if (e === 1) return; // ciclo: interrompe
    estado.set(id, 1);
    for (const p of pred.get(id) ?? []) visitar(p);
    estado.set(id, 2);
    ordem.push(id);
  }
  for (const t of folhas) visitar(t.id);

  // Passada para frente: início e fim mais cedo possíveis.
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of ordem) {
    const ps = pred.get(id) ?? [];
    const inicio = ps.length ? Math.max(...ps.map((p) => ef.get(p) ?? 0)) : 0;
    es.set(id, inicio);
    ef.set(id, inicio + (dur.get(id) ?? 1));
  }

  const fimProjeto = Math.max(...[...ef.values()], 0);

  // Passada para trás: início e fim mais tarde sem atrasar o projeto.
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...ordem].reverse()) {
    const ss = suc.get(id) ?? [];
    const fim = ss.length ? Math.min(...ss.map((s) => ls.get(s) ?? fimProjeto)) : fimProjeto;
    lf.set(id, fim);
    ls.set(id, fim - (dur.get(id) ?? 1));
  }

  for (const t of folhas) {
    const folga = (ls.get(t.id) ?? 0) - (es.get(t.id) ?? 0);
    saida.set(t.id, {
      duracaoDias: dur.get(t.id) ?? 1,
      folgaDias: folga,
      critica: folga <= 0,
    });
  }

  // Tarefa mãe herda: duração pelo próprio intervalo, crítica se
  // qualquer filha for.
  for (const t of tarefas) {
    if (!t.ehPai) continue;
    const filhas = tarefas.filter((x) => x.paiId === t.id);
    saida.set(t.id, {
      duracaoDias: duracaoEmDias(t.inicioEfetivo, t.fimEfetivo),
      folgaDias: 0,
      critica: filhas.some((f) => saida.get(f.id)?.critica ?? false),
    });
  }

  return saida;
}

// ----------------------------------------------------- vínculos em linha

export interface VinculosTarefa {
  responsaveis?: string[] | undefined;
  predecessoras?: string[] | undefined;
}

/**
 * Grava só os vínculos da tarefa.
 *
 * Existe separada de `atualizarTarefa` porque aquela reescreve a linha
 * inteira — chamá-la com payload parcial apagaria atividade, marco e
 * alocação. A grade de tarefas edita responsável e predecessora em
 * linha e manda apenas o que mudou.
 */
export async function atualizarVinculosTarefa(
  ctx: ContextoUsuario,
  id: string,
  d: VinculosTarefa,
): Promise<void> {
  await exigirAcessoTarefa(ctx, id, "alterar tarefas deste projeto");

  const tarefa = await consultarUm<{ projetoId: string }>(
    `SELECT projeto_id FROM projeto_tarefas WHERE id = :id`,
    { id },
  );
  if (!tarefa) throw new ErroDominio(`Tarefa ${id} não encontrada`);

  if (d.responsaveis && d.responsaveis.length > 0) {
    const filhas = await consultarUm<{ total: number }>(
      `SELECT COUNT(*) AS total FROM projeto_tarefas WHERE pai_id = :id AND ativo = 1`,
      { id },
    );
    if ((filhas?.total ?? 0) > 0) {
      throw new ErroDominio(
        "Tarefa com subtarefas não tem responsável próprio: quem executa são as filhas.",
      );
    }
    await validarRecursos(d.responsaveis);
  }

  if (d.predecessoras && d.predecessoras.length > 0) {
    await validarPredecessoras(id, tarefa.projetoId, d.predecessoras);
  }

  await emTransacao(async (tx) => {
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

/** Recusa recurso inexistente ou desativado antes de gravar o vínculo. */
async function validarRecursos(ids: string[]): Promise<void> {
  const unicos = [...new Set(ids)];
  const binds: Record<string, unknown> = {};
  const chaves = unicos.map((id, i) => {
    binds[`r${i}`] = id;
    return `:r${i}`;
  });

  const achados = await consultar<{ id: string }>(
    `SELECT id FROM recursos WHERE ativo = 1 AND id IN (${chaves.join(",")})`,
    binds,
  );
  if (achados.length !== unicos.length) {
    throw new ErroDominio("Responsável não encontrado ou desativado em Recursos.");
  }
}

/**
 * Predecessora precisa ser do mesmo projeto e não pode fechar ciclo —
 * o CPM entraria em laço e o cronograma perderia o sentido.
 */
async function validarPredecessoras(id: string, projetoId: string, novas: string[]): Promise<void> {
  if (novas.includes(id)) throw new ErroDominio("Uma tarefa não pode depender de si mesma.");

  const unicas = [...new Set(novas)];
  const binds: Record<string, unknown> = { projetoId };
  const chaves = unicas.map((p, i) => {
    binds[`p${i}`] = p;
    return `:p${i}`;
  });

  const mesmas = await consultar<{ id: string }>(
    `SELECT id FROM projeto_tarefas
      WHERE projeto_id = :projetoId AND ativo = 1 AND id IN (${chaves.join(",")})`,
    binds,
  );
  if (mesmas.length !== unicas.length) {
    throw new ErroDominio("Predecessora precisa ser uma tarefa do mesmo projeto.");
  }

  // Grafo atual do projeto, com as arestas propostas no lugar das antigas.
  const arestas = await consultar<{ tarefaId: string; predecessoraId: string }>(
    `SELECT tp.tarefa_id, tp.predecessora_id
       FROM tarefa_predecessoras tp
              JOIN projeto_tarefas t ON t.id = tp.tarefa_id
      WHERE t.projeto_id = :projetoId AND t.ativo = 1`,
    { projetoId },
  );

  const grafo = new Map<string, string[]>();
  for (const a of arestas) {
    if (a.tarefaId === id) continue;
    grafo.set(a.tarefaId, [...(grafo.get(a.tarefaId) ?? []), a.predecessoraId]);
  }
  grafo.set(id, unicas);

  // Subindo pelas predecessoras: se voltar em `id`, há ciclo.
  const visitados = new Set<string>();
  const pilha = [...unicas];
  while (pilha.length > 0) {
    const atual = pilha.pop();
    if (!atual) continue;
    if (atual === id) throw new ErroDominio("Essa dependência criaria um ciclo no cronograma.");
    if (visitados.has(atual)) continue;
    visitados.add(atual);
    pilha.push(...(grafo.get(atual) ?? []));
  }
}

/**
 * Tarefas da baseline mais recente. É contra ela que se mede "o
 * cronograma mudou desde a última foto?" — diferente de
 * `baselineOriginal`, que mede o desvio acumulado do plano inicial.
 */
export async function baselineAtual(projetoId: string): Promise<BaselineTarefa[]> {
  return consultar<BaselineTarefa>(
    `SELECT bt.tarefa_id, bt.nome, bt.inicio, bt.fim
       FROM baseline_tarefas bt
       JOIN projeto_baselines b ON b.id = bt.baseline_id
      WHERE b.projeto_id = :projetoId
        AND b.versao = (SELECT MAX(versao) FROM projeto_baselines WHERE projeto_id = :projetoId)`,
    { projetoId },
  );
}

/** Tarefas de uma baseline específica, para o histórico de versões. */
export async function tarefasDaBaseline(baselineId: string): Promise<BaselineTarefa[]> {
  return consultar<BaselineTarefa>(
    `SELECT tarefa_id, nome, inicio, fim
       FROM baseline_tarefas
      WHERE baseline_id = :baselineId
      ORDER BY inicio`,
    { baselineId },
  );
}

// ------------------------------------------------------- nível na WBS

/**
 * Endenta ou desendenta a tarefa, mudando só o pai e a ordem.
 *
 * Separada de `atualizarTarefa` pelo mesmo motivo dos vínculos: aquela
 * reescreve a linha inteira. Aqui o teclado troca o nível da tarefa sem
 * tocar em nada que o usuário digitou.
 *
 * "dentro" adota a irmã imediatamente acima como mãe — é o único destino
 * que preserva a leitura da WBS. "fora" sobe um nível e se posiciona logo
 * depois da antiga mãe.
 */
export async function aninharTarefa(
  ctx: ContextoUsuario,
  id: string,
  direcao: "dentro" | "fora",
): Promise<void> {
  await exigirAcessoTarefa(ctx, id, "alterar tarefas deste projeto");

  const t = await consultarUm<{ projetoId: string; paiId: string | null; ordem: number }>(
    `SELECT projeto_id, pai_id, ordem FROM projeto_tarefas WHERE id = :id`,
    { id },
  );
  if (!t) throw new ErroDominio(`Tarefa ${id} não encontrada`);

  if (direcao === "dentro") {
    // A nova mãe é a irmã de cima. Sem irmã acima não há onde endentar:
    // a tarefa já é a primeira do seu nível.
    //
    // IS NOT DISTINCT FROM compara NULL com NULL como igual, o que
    // resolve a tarefa de primeiro nível sem sentinela.
    const anterior = await consultarUm<{ id: string }>(
      `SELECT id FROM projeto_tarefas
        WHERE projeto_id = :projetoId
          AND ativo = 1
          AND pai_id IS NOT DISTINCT FROM :paiId
          AND ordem < :ordem
        ORDER BY ordem DESC
        LIMIT 1`,
      { projetoId: t.projetoId, paiId: t.paiId, ordem: t.ordem },
    );
    if (!anterior) {
      throw new ErroDominio("Não há tarefa acima no mesmo nível para receber esta como subtarefa.");
    }

    await executar(`UPDATE projeto_tarefas SET pai_id = :paiId WHERE id = :id`, {
      id,
      paiId: anterior.id,
    });
    return;
  }

  if (t.paiId === null) {
    throw new ErroDominio("A tarefa já está no nível mais alto.");
  }

  const mae = await consultarUm<{ paiId: string | null; ordem: number }>(
    `SELECT pai_id, ordem FROM projeto_tarefas WHERE id = :id`,
    { id: t.paiId },
  );
  if (!mae) throw new ErroDominio("Tarefa mãe não encontrada");

  // Sobe um nível e se coloca logo abaixo da antiga mãe, senão a linha
  // saltaria para o fim do grupo e o usuário perderia a tarefa de vista.
  await emTransacao(async (tx) => {
    await tx.executar(
      `UPDATE projeto_tarefas SET ordem = ordem + 1
        WHERE projeto_id = :projetoId AND ordem > :ordem`,
      { projetoId: t.projetoId, ordem: mae.ordem },
    );
    await tx.executar(`UPDATE projeto_tarefas SET pai_id = :paiId, ordem = :ordem WHERE id = :id`, {
      id,
      paiId: mae.paiId,
      ordem: mae.ordem + 1,
    });
  });
}

// ------------------------------------------------------------ lembretes

export interface ProjetoSemAtualizacao {
  id: string;
  nome: string;
  gerenteId: string | null;
  gerenteEmail: string | null;
  gerenteNome: string | null;
  /** Dias desde a última atualização, ou desde a criação se nunca houve. */
  diasSemAtualizar: number;
  /** true quando já saiu lembrete deste projeto hoje. */
  avisadoHoje: boolean;
}

/** Booleano é SMALLINT 0/1 no schema: avisado_hoje volta como número. */
interface LinhaProjetoSemAtualizacao extends Omit<ProjetoSemAtualizacao, "avisadoHoje"> {
  avisadoHoje: number;
}

/**
 * Projetos que passaram do prazo de acompanhamento semanal.
 *
 * Só entram os que estão vivos: cobrar atualização de projeto concluído
 * ou cancelado é ruído que ensina o gerente a ignorar o aviso.
 *
 * O `avisado_hoje` sai da própria fila de notificações — assim o
 * lembrete diário não depende de coluna nova nem de estado em memória,
 * e rodar a rotina duas vezes no mesmo dia não duplica e-mail.
 */
export async function projetosSemAtualizacao(
  diasMinimos: number,
): Promise<ProjetoSemAtualizacao[]> {
  const linhas = await consultar<LinhaProjetoSemAtualizacao>(
    `SELECT p.id, p.nome, p.gerente_id, u.email AS gerente_email, u.nome AS gerente_nome,
            CURRENT_DATE - COALESCE(a.ultima, p.criado_em::date) AS dias_sem_atualizar,
            CASE WHEN n.enviados > 0 THEN 1 ELSE 0 END AS avisado_hoje
       FROM projetos p
       LEFT JOIN usuarios u ON u.id = p.gerente_id
       LEFT JOIN (SELECT projeto_id, MAX(data_ref) AS ultima
                    FROM projeto_atualizacoes GROUP BY projeto_id) a
              ON a.projeto_id = p.id
       LEFT JOIN (SELECT referencia_id, COUNT(*) AS enviados
                    FROM notificacoes
                   WHERE tipo = 'projeto_lembrete'
                     AND criado_em >= CURRENT_DATE
                   GROUP BY referencia_id) n
              ON n.referencia_id = p.id
      WHERE p.status IN ('planejamento', 'execucao', 'paralisado')
        AND CURRENT_DATE - COALESCE(a.ultima, p.criado_em::date) >= :diasMinimos
      ORDER BY dias_sem_atualizar DESC`,
    { diasMinimos },
  );
  return linhas.map((l) => ({ ...l, avisadoHoje: paraBool(l.avisadoHoje) }));
}
