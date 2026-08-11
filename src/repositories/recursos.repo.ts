import { comoDataPura, checar, db, linhas } from "@/integrations/db/client.server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Recursos de projeto: quem executa tarefa e com quanta capacidade.
 *
 * Separado de `usuarios` de propósito: nem todo recurso tem conta no AD
 * (terceirizado, consultoria), e nem todo usuário participa de projeto.
 * O vínculo é opcional, via usuario_id.
 */

export interface Recurso {
  id: string;
  usuarioId: string | null;
  usuarioNome: string | null;
  nome: string;
  papel: string | null;
  equipeId: string | null;
  equipeNome: string | null;
  /** Jornada diária total. */
  horasDia: number;
  /** % da jornada dedicada a projetos (o resto vai para atendimento). */
  disponibilidadeProjetos: number;
  ativo: boolean;
}

/** Horas/dia efetivamente disponíveis para projeto. */
export function capacidadeProjeto(r: Recurso): number {
  return Math.round(((r.horasDia * r.disponibilidadeProjetos) / 100) * 100) / 100;
}

interface LinhaRecurso {
  id: string;
  usuario_id: string | null;
  nome: string;
  papel: string | null;
  equipe_id: string | null;
  horas_dia: number;
  disponibilidade_projetos: number;
  ativo: boolean;
  usuarios: { nome: string } | null;
  equipes: { nome: string } | null;
}

const SELECT_BASE = `
  id, usuario_id, nome, papel, equipe_id, horas_dia, disponibilidade_projetos, ativo,
  usuarios ( nome ),
  equipes ( nome )
`;

const mapear = (l: LinhaRecurso): Recurso => ({
  id: l.id,
  usuarioId: l.usuario_id,
  usuarioNome: l.usuarios?.nome ?? null,
  nome: l.nome,
  papel: l.papel,
  equipeId: l.equipe_id,
  equipeNome: l.equipes?.nome ?? null,
  horasDia: l.horas_dia,
  disponibilidadeProjetos: l.disponibilidade_projetos,
  ativo: l.ativo,
});

function exigirAdmin(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin && ctx.equipeId === null) {
    throw new ErroDominio(`Somente a equipe de TI pode ${acao}`);
  }
}

export async function listarRecursos(apenasAtivos = true): Promise<Recurso[]> {
  let query = db.from("recursos").select(SELECT_BASE).order("nome");
  if (apenasAtivos) query = query.eq("ativo", true);
  const l = linhas(await query);
  return (l as unknown as LinhaRecurso[]).map(mapear);
}

export async function buscarRecurso(id: string): Promise<Recurso | null> {
  const r = await db.from("recursos").select(SELECT_BASE).eq("id", id).maybeSingle();
  const l = checar(r);
  return l ? mapear(l as unknown as LinhaRecurso) : null;
}

export interface DadosRecurso {
  nome: string;
  usuarioId?: string | null | undefined;
  papel?: string | null | undefined;
  equipeId?: string | null | undefined;
  horasDia: number;
  disponibilidadeProjetos: number;
}

function validar(d: DadosRecurso): void {
  if (d.nome.trim().length < 3) throw new ErroDominio("Informe o nome do recurso");
  if (d.horasDia <= 0 || d.horasDia > 24) {
    throw new ErroDominio("Jornada deve estar entre 1 e 24 horas");
  }
  if (d.disponibilidadeProjetos < 0 || d.disponibilidadeProjetos > 100) {
    throw new ErroDominio("Disponibilidade deve estar entre 0 e 100%");
  }
}

export async function criarRecurso(ctx: ContextoUsuario, d: DadosRecurso): Promise<string> {
  exigirAdmin(ctx, "cadastrar recursos");
  validar(d);

  const id = crypto.randomUUID();
  checar(
    await db.from("recursos").insert({
      id,
      usuario_id: d.usuarioId ?? null,
      nome: d.nome.trim(),
      papel: d.papel?.trim() ?? null,
      equipe_id: d.equipeId ?? null,
      horas_dia: d.horasDia,
      disponibilidade_projetos: d.disponibilidadeProjetos,
      ativo: true,
    }),
  );
  return id;
}

export async function atualizarRecurso(
  ctx: ContextoUsuario,
  id: string,
  d: DadosRecurso,
): Promise<void> {
  exigirAdmin(ctx, "alterar recursos");
  validar(d);

  const atual = await buscarRecurso(id);
  if (!atual) throw new ErroDominio(`Recurso ${id} não encontrado`);

  checar(
    await db
      .from("recursos")
      .update({
        usuario_id: d.usuarioId ?? null,
        nome: d.nome.trim(),
        papel: d.papel?.trim() ?? null,
        equipe_id: d.equipeId ?? null,
        horas_dia: d.horasDia,
        disponibilidade_projetos: d.disponibilidadeProjetos,
      })
      .eq("id", id),
  );
}

/**
 * Desativa em vez de excluir: tarefas de projeto apontam para o recurso
 * por FK em tarefa_responsaveis. DELETE apagaria o histórico de quem
 * executou o quê.
 */
export async function definirRecursoAtivo(
  ctx: ContextoUsuario,
  id: string,
  ativo: boolean,
): Promise<void> {
  exigirAdmin(ctx, "alterar recursos");
  checar(await db.from("recursos").update({ ativo }).eq("id", id));
}

export interface CargaRecurso {
  recursoId: string;
  /** Horas/dia comprometidas em tarefas ativas de projeto. */
  horasComprometidas: number;
  projetosAtivos: number;
}

interface LinhaTarefaResponsavel {
  recurso_id: string;
  recursos: { horas_dia: number; disponibilidade_projetos: number } | null;
  projeto_tarefas: {
    id: string;
    quadro: string;
    inicio: string;
    fim: string;
    alocacao_pct: number | null;
    projeto_id: string;
    projetos: { status: string } | null;
  } | null;
}

/**
 * Carga por recurso, vinda das tarefas de projeto em andamento.
 *
 * O Oracle fazia isso com SUM/GROUP BY e
 * `TRUNC(SYSDATE) BETWEEN t.inicio AND t.fim` no SQL. O PostgREST não
 * agrega no banco: buscamos os responsáveis de tarefas em andamento
 * hoje (com tarefa, projeto e recurso via embeds) e calculamos a
 * alocação aqui em TypeScript.
 *
 * Enquanto a migração de projetos não acontece, a tabela está vazia e
 * todos aparecem com carga zero — número correto, não falha.
 */
export async function cargaPorRecurso(): Promise<CargaRecurso[]> {
  const hoje = comoDataPura(new Date());

  const l = linhas(
    await db
      .from("tarefa_responsaveis")
      .select(
        `recurso_id,
         recursos ( horas_dia, disponibilidade_projetos ),
         projeto_tarefas!inner (
           id, quadro, inicio, fim, alocacao_pct, projeto_id,
           projetos!inner ( status )
         )`,
      )
      .neq("projeto_tarefas.quadro", "done")
      .in("projeto_tarefas.projetos.status", ["planejamento", "execucao"])
      .lte("projeto_tarefas.inicio", hoje)
      .gte("projeto_tarefas.fim", hoje),
  );

  const mapa = new Map<string, { horas: number; projetos: Set<string> }>();
  for (const linha of l as unknown as LinhaTarefaResponsavel[]) {
    const tarefa = linha.projeto_tarefas;
    const recurso = linha.recursos;
    if (!tarefa || !recurso) continue;

    const alocacaoPct = tarefa.alocacao_pct ?? 100;
    const horas = (alocacaoPct / 100) * recurso.horas_dia * (recurso.disponibilidade_projetos / 100);

    const entrada = mapa.get(linha.recurso_id) ?? { horas: 0, projetos: new Set<string>() };
    entrada.horas += horas;
    entrada.projetos.add(tarefa.projeto_id);
    mapa.set(linha.recurso_id, entrada);
  }

  return Array.from(mapa.entries()).map(([recursoId, v]) => ({
    recursoId,
    horasComprometidas: v.horas,
    projetosAtivos: v.projetos.size,
  }));
}
