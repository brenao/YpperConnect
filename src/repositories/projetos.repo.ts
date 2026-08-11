import { db, checar, linhas, data, paraDataPura, comoDataPura, agora } from "@/integrations/db/client.server";
import { ErroDominio } from "./tipos";
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

/** Embed de projeto com sponsor e gerente, ambos apontando para `usuarios`. */
const SELECT_PROJETO = "*, sponsor:usuarios!projetos_sponsor_id_fkey(nome), gerente:usuarios!projetos_gerente_id_fkey(nome)";

interface LinhaProjeto {
  id: string;
  nome: string;
  objetivo: string | null;
  sponsor_id: string | null;
  sponsor: { nome: string } | null;
  gerente_id: string | null;
  gerente: { nome: string } | null;
  status: string;
  inicio: string;
  fim: string;
  criado_em: string;
  atualizado_em: string;
}

function mapearProjeto(l: LinhaProjeto): Projeto {
  return {
    id: l.id,
    nome: l.nome,
    objetivo: l.objetivo,
    sponsorId: l.sponsor_id,
    sponsorNome: l.sponsor?.nome ?? null,
    gerenteId: l.gerente_id,
    gerenteNome: l.gerente?.nome ?? null,
    status: l.status as ProjectStatus,
    inicio: paraDataPura(l.inicio)!,
    fim: paraDataPura(l.fim)!,
    criadoEm: data(l.criado_em),
    atualizadoEm: data(l.atualizado_em),
  };
}

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
 * O progresso vem da média das tarefas. Sem PostgREST para agregação em
 * SQL, busca-se só as colunas necessárias das tabelas relacionadas e
 * agrega-se em TypeScript — projeto sem tarefa fica com 0, não com
 * "indefinido".
 */
export async function listarProjetos(): Promise<ProjetoComProgresso[]> {
  const [projetosRes, tarefasRes, riscosRes, atencoesRes, atualizacoesRes] = await Promise.all([
    db.from("projetos").select(SELECT_PROJETO),
    db.from("projeto_tarefas").select("projeto_id, quadro, progresso"),
    db.from("projeto_riscos").select("projeto_id, status"),
    db.from("projeto_atencoes").select("projeto_id, status"),
    db.from("projeto_atualizacoes").select("projeto_id, data_ref"),
  ]);

  const projetos = linhas(projetosRes as never) as LinhaProjeto[];
  const tarefas = linhas(tarefasRes as never) as { projeto_id: string; quadro: string; progresso: number }[];
  const riscos = linhas(riscosRes as never) as { projeto_id: string; status: string }[];
  const atencoes = linhas(atencoesRes as never) as { projeto_id: string; status: string }[];
  const atualizacoes = linhas(atualizacoesRes as never) as { projeto_id: string; data_ref: string }[];

  const porProjetoTarefas = new Map<string, { total: number; concluidas: number; somaProgresso: number }>();
  for (const t of tarefas) {
    const agg = porProjetoTarefas.get(t.projeto_id) ?? { total: 0, concluidas: 0, somaProgresso: 0 };
    agg.total += 1;
    agg.somaProgresso += t.progresso;
    if (t.quadro === "done") agg.concluidas += 1;
    porProjetoTarefas.set(t.projeto_id, agg);
  }

  const riscosAbertosPorProjeto = new Map<string, number>();
  for (const r of riscos) {
    if (r.status === "mitigado") continue;
    riscosAbertosPorProjeto.set(r.projeto_id, (riscosAbertosPorProjeto.get(r.projeto_id) ?? 0) + 1);
  }

  const atencoesAbertasPorProjeto = new Map<string, number>();
  for (const a of atencoes) {
    if (a.status !== "aberto") continue;
    atencoesAbertasPorProjeto.set(a.projeto_id, (atencoesAbertasPorProjeto.get(a.projeto_id) ?? 0) + 1);
  }

  const ultimaAtualizacaoPorProjeto = new Map<string, string>();
  for (const a of atualizacoes) {
    const atual = ultimaAtualizacaoPorProjeto.get(a.projeto_id);
    if (!atual || a.data_ref > atual) ultimaAtualizacaoPorProjeto.set(a.projeto_id, a.data_ref);
  }

  const resultado = projetos.map((p): ProjetoComProgresso => {
    const agg = porProjetoTarefas.get(p.id);
    const ultima = ultimaAtualizacaoPorProjeto.get(p.id);
    return {
      ...mapearProjeto(p),
      totalTarefas: agg?.total ?? 0,
      tarefasConcluidas: agg?.concluidas ?? 0,
      progresso: agg && agg.total > 0 ? Math.round(agg.somaProgresso / agg.total) : 0,
      riscosAbertos: riscosAbertosPorProjeto.get(p.id) ?? 0,
      atencoesAbertas: atencoesAbertasPorProjeto.get(p.id) ?? 0,
      ultimaAtualizacao: ultima ? paraDataPura(ultima) : null,
    };
  });

  resultado.sort((a, b) => a.status.localeCompare(b.status) || a.fim.getTime() - b.fim.getTime());
  return resultado;
}

export async function buscarProjeto(id: string): Promise<Projeto | null> {
  const r = await db.from("projetos").select(SELECT_PROJETO).eq("id", id).maybeSingle();
  const l = checar(r as never) as LinhaProjeto | null;
  return l ? mapearProjeto(l) : null;
}

interface LinhaTarefa {
  id: string;
  projeto_id: string;
  pai_id: string | null;
  nome: string;
  atividade: string | null;
  inicio: string;
  fim: string;
  progresso: number;
  quadro: string;
  marco: boolean;
  duracao: number | null;
  duracao_unidade: string | null;
  alocacao_pct: number | null;
  ordem: number;
  concluido_em: string | null;
}

function mapearTarefa(l: LinhaTarefa): Tarefa {
  return {
    id: l.id,
    projetoId: l.projeto_id,
    paiId: l.pai_id,
    nome: l.nome,
    atividade: l.atividade,
    inicio: paraDataPura(l.inicio)!,
    fim: paraDataPura(l.fim)!,
    progresso: l.progresso,
    quadro: l.quadro as QuadroTarefa,
    marco: l.marco,
    duracao: l.duracao,
    duracaoUnidade: l.duracao_unidade,
    alocacaoPct: l.alocacao_pct,
    ordem: l.ordem,
    concluidoEm: paraDataPura(l.concluido_em),
  };
}

export async function listarTarefas(projetoId: string): Promise<Tarefa[]> {
  const r = await db
    .from("projeto_tarefas")
    .select("id, projeto_id, pai_id, nome, atividade, inicio, fim, progresso, quadro, marco, duracao, duracao_unidade, alocacao_pct, ordem, concluido_em")
    .eq("projeto_id", projetoId)
    .order("ordem", { ascending: true })
    .order("inicio", { ascending: true });
  return (linhas(r as never) as LinhaTarefa[]).map(mapearTarefa);
}

/** Predecessoras e responsáveis, indexados por tarefa. */
export async function listarVinculosTarefas(projetoId: string): Promise<{
  predecessoras: Record<string, string[]>;
  responsaveis: Record<string, string[]>;
}> {
  const tarefasIdsRes = await db.from("projeto_tarefas").select("id").eq("projeto_id", projetoId);
  const ids = (linhas(tarefasIdsRes as never) as { id: string }[]).map((t) => t.id);

  if (ids.length === 0) return { predecessoras: {}, responsaveis: {} };

  const [predRes, respRes] = await Promise.all([
    db.from("tarefa_predecessoras").select("tarefa_id, predecessora_id").in("tarefa_id", ids),
    db.from("tarefa_responsaveis").select("tarefa_id, recurso_id").in("tarefa_id", ids),
  ]);

  const pred = linhas(predRes as never) as { tarefa_id: string; predecessora_id: string }[];
  const resp = linhas(respRes as never) as { tarefa_id: string; recurso_id: string }[];

  const predecessoras: Record<string, string[]> = {};
  for (const p of pred) {
    (predecessoras[p.tarefa_id] ??= []).push(p.predecessora_id);
  }
  const responsaveis: Record<string, string[]> = {};
  for (const r of resp) {
    (responsaveis[r.tarefa_id] ??= []).push(r.recurso_id);
  }
  return { predecessoras, responsaveis };
}

export async function listarRiscos(projetoId: string): Promise<Risco[]> {
  const r = await db
    .from("projeto_riscos")
    .select("id, projeto_id, descricao, probabilidade, impacto, mitigacao, status, criado_em")
    .eq("projeto_id", projetoId)
    .order("criado_em", { ascending: false });
  return (
    linhas(r as never) as {
      id: string;
      projeto_id: string;
      descricao: string;
      probabilidade: string;
      impacto: string;
      mitigacao: string | null;
      status: string;
      criado_em: string;
    }[]
  ).map((l) => ({
    id: l.id,
    projetoId: l.projeto_id,
    descricao: l.descricao,
    probabilidade: l.probabilidade as NivelRisco,
    impacto: l.impacto as NivelImpacto,
    mitigacao: l.mitigacao,
    status: l.status as Risco["status"],
    criadoEm: data(l.criado_em),
  }));
}

export async function listarAtualizacoes(projetoId: string): Promise<Atualizacao[]> {
  const r = await db
    .from("projeto_atualizacoes")
    .select("id, projeto_id, autor_id, data_ref, descricao, ultimas_entregas, proximas_entregas, criado_em, autor:usuarios(nome)")
    .eq("projeto_id", projetoId)
    .order("data_ref", { ascending: false });
  return (
    linhas(r as never) as {
      id: string;
      projeto_id: string;
      autor_id: string | null;
      autor: { nome: string } | null;
      data_ref: string;
      descricao: string | null;
      ultimas_entregas: string | null;
      proximas_entregas: string | null;
      criado_em: string;
    }[]
  ).map((l) => ({
    id: l.id,
    projetoId: l.projeto_id,
    autorId: l.autor_id,
    autorNome: l.autor?.nome ?? null,
    dataRef: paraDataPura(l.data_ref)!,
    descricao: l.descricao,
    ultimasEntregas: l.ultimas_entregas,
    proximasEntregas: l.proximas_entregas,
    criadoEm: data(l.criado_em),
  }));
}

export async function listarAtencoes(projetoId: string): Promise<Atencao[]> {
  const r = await db
    .from("projeto_atencoes")
    .select(
      "id, projeto_id, titulo, descricao, decisao_necessaria, responsavel_decisao_id, status, criado_em, resolvido_em, responsavel:usuarios(nome)",
    )
    .eq("projeto_id", projetoId)
    .order("status", { ascending: true })
    .order("criado_em", { ascending: false });
  return (
    linhas(r as never) as {
      id: string;
      projeto_id: string;
      titulo: string;
      descricao: string | null;
      decisao_necessaria: string | null;
      responsavel_decisao_id: string | null;
      responsavel: { nome: string } | null;
      status: string;
      criado_em: string;
      resolvido_em: string | null;
    }[]
  ).map((l) => ({
    id: l.id,
    projetoId: l.projeto_id,
    titulo: l.titulo,
    descricao: l.descricao,
    decisaoNecessaria: l.decisao_necessaria,
    responsavelDecisaoId: l.responsavel_decisao_id,
    responsavelDecisaoNome: l.responsavel?.nome ?? null,
    status: l.status as Atencao["status"],
    criadoEm: data(l.criado_em),
    resolvidoEm: paraDataPura(l.resolvido_em),
  }));
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
  const agr = agora();
  checar(
    await db.from("projetos").insert({
      id,
      nome: d.nome.trim(),
      objetivo: d.objetivo?.trim() ?? null,
      sponsor_id: d.sponsorId ?? null,
      // Sem gerente informado, assume quem criou: projeto órfão não tem
      // quem responda por ele na visão de diretoria.
      gerente_id: d.gerenteId ?? ctx.id,
      status: d.status ?? "planejamento",
      inicio: comoDataPura(d.inicio),
      fim: comoDataPura(d.fim),
      criado_em: agr,
      atualizado_em: agr,
    } as never),
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

  const atual = await db.from("projetos").select("status").eq("id", id).maybeSingle();
  const atualLinha = checar(atual as never) as { status: string } | null;
  if (!atualLinha) throw new ErroDominio(`Projeto ${id} não encontrado`);

  checar(
    await db
      .from("projetos")
      .update({
        nome: d.nome.trim(),
        objetivo: d.objetivo?.trim() ?? null,
        sponsor_id: d.sponsorId ?? null,
        gerente_id: d.gerenteId ?? null,
        status: d.status ?? atualLinha.status,
        inicio: comoDataPura(d.inicio),
        fim: comoDataPura(d.fim),
        atualizado_em: agora(),
      } as never)
      .eq("id", id),
  );
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
 * Cria tarefa com seus vínculos em sequência: sem transação no
 * PostgREST, uma falha nos vínculos deixa a tarefa órfã de
 * responsável/predecessora — aceitável aqui porque a tela permite
 * reeditar os vínculos depois.
 */
export async function criarTarefa(ctx: ContextoUsuario, d: DadosTarefa): Promise<string> {
  exigirTi(ctx, "criar tarefas");
  if (d.nome.trim().length < 3) throw new ErroDominio("Informe o nome da tarefa");
  if (d.fim < d.inicio) throw new ErroDominio("Data de término anterior ao início");

  const id = novoId();

  checar(
    await db.from("projeto_tarefas").insert({
      id,
      projeto_id: d.projetoId,
      pai_id: d.paiId ?? null,
      nome: d.nome.trim(),
      atividade: d.atividade?.trim() ?? null,
      inicio: comoDataPura(d.inicio),
      fim: comoDataPura(d.fim),
      progresso: d.progresso ?? 0,
      quadro: d.quadro ?? "backlog",
      marco: d.marco ?? false,
      alocacao_pct: d.alocacaoPct ?? null,
      ordem: d.ordem ?? 0,
    } as never),
  );

  const responsaveis = [...new Set(d.responsaveis ?? [])];
  if (responsaveis.length) {
    checar(
      await db
        .from("tarefa_responsaveis")
        .insert(responsaveis.map((r) => ({ tarefa_id: id, recurso_id: r })) as never),
    );
  }
  const predecessoras = [...new Set(d.predecessoras ?? [])].filter((p) => p !== id);
  if (predecessoras.length) {
    checar(
      await db
        .from("tarefa_predecessoras")
        .insert(predecessoras.map((p) => ({ tarefa_id: id, predecessora_id: p })) as never),
    );
  }

  return id;
}

export async function atualizarTarefa(
  ctx: ContextoUsuario,
  id: string,
  d: Omit<DadosTarefa, "projetoId">,
): Promise<void> {
  exigirTi(ctx, "alterar tarefas");
  if (d.fim < d.inicio) throw new ErroDominio("Data de término anterior ao início");

  const atualRes = await db.from("projeto_tarefas").select("concluido_em").eq("id", id).maybeSingle();
  const atual = checar(atualRes as never) as { concluido_em: string | null } | null;
  if (!atual) throw new ErroDominio(`Tarefa ${id} não encontrada`);

  // quadro 'done' e progresso 100 andam juntos: deixar divergir
  // produz kanban que não bate com o percentual do cronograma.
  const concluida = d.quadro === "done" || d.progresso === 100;

  checar(
    await db
      .from("projeto_tarefas")
      .update({
        pai_id: d.paiId ?? null,
        nome: d.nome?.trim(),
        atividade: d.atividade?.trim() ?? null,
        inicio: comoDataPura(d.inicio),
        fim: comoDataPura(d.fim),
        progresso: concluida ? 100 : (d.progresso ?? 0),
        quadro: concluida ? "done" : (d.quadro ?? "backlog"),
        marco: d.marco ?? false,
        alocacao_pct: d.alocacaoPct ?? null,
        ordem: d.ordem,
        concluido_em: concluida ? (atual.concluido_em ?? agora()) : null,
      } as never)
      .eq("id", id),
  );

  if (d.responsaveis) {
    checar(await db.from("tarefa_responsaveis").delete().eq("tarefa_id", id));
    const responsaveis = [...new Set(d.responsaveis)];
    if (responsaveis.length) {
      checar(
        await db
          .from("tarefa_responsaveis")
          .insert(responsaveis.map((r) => ({ tarefa_id: id, recurso_id: r })) as never),
      );
    }
  }
  if (d.predecessoras) {
    checar(await db.from("tarefa_predecessoras").delete().eq("tarefa_id", id));
    const predecessoras = [...new Set(d.predecessoras)].filter((p) => p !== id);
    if (predecessoras.length) {
      checar(
        await db
          .from("tarefa_predecessoras")
          .insert(predecessoras.map((p) => ({ tarefa_id: id, predecessora_id: p })) as never),
      );
    }
  }
}

/** Move a tarefa no kanban. Atalho para o arrastar-e-soltar. */
export async function moverTarefa(
  ctx: ContextoUsuario,
  id: string,
  quadro: QuadroTarefa,
): Promise<void> {
  exigirTi(ctx, "mover tarefas");
  const concluida = quadro === "done";

  const atualRes = await db
    .from("projeto_tarefas")
    .select("progresso, concluido_em")
    .eq("id", id)
    .maybeSingle();
  const atual = checar(atualRes as never) as { progresso: number; concluido_em: string | null } | null;
  if (!atual) throw new ErroDominio(`Tarefa ${id} não encontrada`);

  checar(
    await db
      .from("projeto_tarefas")
      .update({
        quadro,
        progresso: concluida ? 100 : atual.progresso,
        concluido_em: concluida ? (atual.concluido_em ?? agora()) : null,
      } as never)
      .eq("id", id),
  );
}

/** Exclusão em cascata na aplicação: o banco não faz cascade em auto-FK. */
export async function excluirTarefa(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirTi(ctx, "excluir tarefas");

  const filhasRes = await db.from("projeto_tarefas").select("id").eq("pai_id", id);
  const filhas = linhas(filhasRes as never) as { id: string }[];
  for (const f of filhas) {
    checar(await db.from("projeto_tarefas").delete().eq("id", f.id));
  }
  checar(await db.from("tarefa_predecessoras").delete().eq("predecessora_id", id));
  checar(await db.from("projeto_tarefas").delete().eq("id", id));
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
  checar(
    await db.from("projeto_riscos").insert({
      id,
      projeto_id: d.projetoId,
      descricao: d.descricao.trim(),
      probabilidade: d.probabilidade,
      impacto: d.impacto,
      mitigacao: d.mitigacao?.trim() ?? null,
      status: d.status ?? "aberto",
      criado_em: agora(),
    } as never),
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
  checar(
    await db.from("projeto_atualizacoes").insert({
      id,
      projeto_id: d.projetoId,
      autor_id: ctx.id,
      data_ref: comoDataPura(d.dataRef),
      descricao: d.descricao?.trim() ?? null,
      ultimas_entregas: d.ultimasEntregas?.trim() ?? null,
      proximas_entregas: d.proximasEntregas?.trim() ?? null,
      criado_em: agora(),
    } as never),
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
  checar(
    await db.from("projeto_atencoes").insert({
      id,
      projeto_id: d.projetoId,
      titulo: d.titulo.trim(),
      descricao: d.descricao?.trim() ?? null,
      decisao_necessaria: d.decisaoNecessaria?.trim() ?? null,
      responsavel_decisao_id: d.responsavelDecisaoId ?? null,
      status: "aberto",
      criado_em: agora(),
    } as never),
  );
  return id;
}

export async function resolverAtencao(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirTi(ctx, "resolver pontos de atenção");
  checar(
    await db
      .from("projeto_atencoes")
      .update({ status: "resolvido", resolvido_em: agora() } as never)
      .eq("id", id),
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

export interface CampoTarefa {
  progresso?: number | undefined;
  inicio?: Date | undefined;
  fim?: Date | undefined;
  nome?: string | undefined;
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
  exigirTi(ctx, "alterar tarefas");

  const filhasRes = await db.from("projeto_tarefas").select("id", { count: "exact", head: true }).eq("pai_id", id);
  checar(filhasRes as never);
  if ((filhasRes.count ?? 0) > 0) {
    throw new ErroDominio("Tarefa com subtarefas tem datas e progresso calculados a partir delas.");
  }

  const atualRes = await db
    .from("projeto_tarefas")
    .select("inicio, fim, quadro, concluido_em")
    .eq("id", id)
    .maybeSingle();
  const atual = checar(atualRes as never) as
    | { inicio: string; fim: string; quadro: string; concluido_em: string | null }
    | null;
  if (!atual) throw new ErroDominio(`Tarefa ${id} não encontrada`);

  const inicio = d.inicio ?? paraDataPura(atual.inicio)!;
  const fim = d.fim ?? paraDataPura(atual.fim)!;
  if (fim < inicio) throw new ErroDominio("Data de término anterior ao início");

  const concluida = d.progresso === 100;

  checar(
    await db
      .from("projeto_tarefas")
      .update({
        nome: d.nome?.trim(),
        progresso: d.progresso,
        inicio: comoDataPura(inicio),
        fim: comoDataPura(fim),
        quadro: concluida ? "done" : atual.quadro === "done" ? "doing" : atual.quadro,
        concluido_em: concluida ? (atual.concluido_em ?? agora()) : null,
      } as never)
      .eq("id", id),
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
  exigirTi(ctx, "criar tarefas");

  const refRes = await db
    .from("projeto_tarefas")
    .select("projeto_id, pai_id, ordem, inicio, fim")
    .eq("id", referenciaId)
    .maybeSingle();
  const ref = checar(refRes as never) as
    | { projeto_id: string; pai_id: string | null; ordem: number; inicio: string; fim: string }
    | null;
  if (!ref) throw new ErroDominio("Tarefa de referência não encontrada");

  const id = novoId();
  const paiId = comoFilha ? referenciaId : ref.pai_id;

  // Abre espaço na ordenação: todas as tarefas do projeto com ordem
  // maior que a referência avançam uma posição.
  const posterioresRes = await db
    .from("projeto_tarefas")
    .select("id, ordem")
    .eq("projeto_id", ref.projeto_id)
    .gt("ordem", ref.ordem);
  const posteriores = linhas(posterioresRes as never) as { id: string; ordem: number }[];
  for (const p of posteriores) {
    checar(await db.from("projeto_tarefas").update({ ordem: p.ordem + 1 } as never).eq("id", p.id));
  }

  checar(
    await db.from("projeto_tarefas").insert({
      id,
      projeto_id: ref.projeto_id,
      pai_id: paiId,
      nome: "Nova tarefa",
      inicio: ref.inicio,
      fim: ref.fim,
      progresso: 0,
      quadro: "backlog",
      marco: false,
      ordem: ref.ordem + 1,
    } as never),
  );

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
  const r = await db
    .from("projeto_baselines")
    .select("id, projeto_id, versao, descricao, autor_id, criado_em, autor:usuarios(nome)")
    .eq("projeto_id", projetoId)
    .order("versao", { ascending: false });
  return (
    linhas(r as never) as {
      id: string;
      projeto_id: string;
      versao: number;
      descricao: string | null;
      autor_id: string | null;
      autor: { nome: string } | null;
      criado_em: string;
    }[]
  ).map((l) => ({
    id: l.id,
    projetoId: l.projeto_id,
    versao: l.versao,
    descricao: l.descricao,
    autorId: l.autor_id,
    autorNome: l.autor?.nome ?? null,
    criadoEm: data(l.criado_em),
  }));
}

/** Tarefas da baseline mais antiga: é contra o plano original que se mede. */
export async function baselineOriginal(projetoId: string): Promise<BaselineTarefa[]> {
  const baselinesRes = await db.from("projeto_baselines").select("id, versao").eq("projeto_id", projetoId);
  const baselines = linhas(baselinesRes as never) as { id: string; versao: number }[];
  if (baselines.length === 0) return [];

  const maisAntiga = baselines.reduce((min, b) => (b.versao < min.versao ? b : min));

  const r = await db
    .from("baseline_tarefas")
    .select("tarefa_id, nome, inicio, fim")
    .eq("baseline_id", maisAntiga.id);
  return (linhas(r as never) as { tarefa_id: string; nome: string; inicio: string; fim: string }[]).map((l) => ({
    tarefaId: l.tarefa_id,
    nome: l.nome,
    inicio: paraDataPura(l.inicio)!,
    fim: paraDataPura(l.fim)!,
  }));
}

export async function salvarBaseline(
  ctx: ContextoUsuario,
  projetoId: string,
  descricao?: string | null | undefined,
): Promise<string> {
  exigirTi(ctx, "salvar baseline");

  const id = novoId();

  const versoesRes = await db.from("projeto_baselines").select("versao").eq("projeto_id", projetoId);
  const versoes = linhas(versoesRes as never) as { versao: number }[];
  const versao = versoes.length ? Math.max(...versoes.map((v) => v.versao)) + 1 : 1;

  checar(
    await db.from("projeto_baselines").insert({
      id,
      projeto_id: projetoId,
      versao,
      descricao: descricao?.trim() ?? null,
      autor_id: ctx.id,
      criado_em: agora(),
    } as never),
  );

  // Copia o cronograma inteiro: sem INSERT SELECT no PostgREST, busca
  // as tarefas e regrava como linhas da baseline.
  const tarefasRes = await db.from("projeto_tarefas").select("id, nome, inicio, fim").eq("projeto_id", projetoId);
  const tarefas = linhas(tarefasRes as never) as { id: string; nome: string; inicio: string; fim: string }[];
  if (tarefas.length) {
    checar(
      await db.from("baseline_tarefas").insert(
        tarefas.map((t) => ({
          baseline_id: id,
          tarefa_id: t.id,
          nome: t.nome,
          inicio: t.inicio,
          fim: t.fim,
        })) as never,
      ),
    );
  }

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
