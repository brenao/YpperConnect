import { consultar, consultarUm, executar } from "@/integrations/postgres/client.server";
import { ErroDominio, deBool, paraBool } from "./tipos";
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

// capacidadeProjeto vive em @/services/resource-utils: a tela de recursos
// precisa dela no navegador, e importar valor deste arquivo levaria o
// client.server.ts (credenciais do Oracle) para o bundle do cliente.

interface Linha extends Omit<Recurso, "ativo"> {
  ativo: number;
}

const SELECT_BASE = `
  SELECT r.id, r.usuario_id, u.nome AS usuario_nome, r.nome, r.papel,
         r.equipe_id, e.nome AS equipe_nome,
         r.horas_dia, r.disponibilidade_projetos, r.ativo
    FROM recursos r
    LEFT JOIN usuarios u ON u.id = r.usuario_id
    LEFT JOIN equipes e ON e.id = r.equipe_id`;

const mapear = (l: Linha): Recurso => ({ ...l, ativo: paraBool(l.ativo) });

function exigirAdmin(ctx: ContextoUsuario, acao: string): void {
  if (!ctx.admin && ctx.equipeId === null) {
    throw new ErroDominio(`Somente a equipe de TI pode ${acao}`);
  }
}

export async function listarRecursos(apenasAtivos = true): Promise<Recurso[]> {
  const linhas = await consultar<Linha>(
    `${SELECT_BASE} ${apenasAtivos ? "WHERE r.ativo = 1" : ""} ORDER BY r.nome`,
  );
  return linhas.map(mapear);
}

export async function buscarRecurso(id: string): Promise<Recurso | null> {
  const l = await consultarUm<Linha>(`${SELECT_BASE} WHERE r.id = :id`, { id });
  return l ? mapear(l) : null;
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
  await executar(
    `INSERT INTO recursos
       (id, usuario_id, nome, papel, equipe_id, horas_dia,
        disponibilidade_projetos, ativo)
     VALUES
       (:id, :usuarioId, :nome, :papel, :equipeId, :horasDia,
        :disponibilidade, 1)`,
    {
      id,
      usuarioId: d.usuarioId ?? null,
      nome: d.nome.trim(),
      papel: d.papel?.trim() ?? null,
      equipeId: d.equipeId ?? null,
      horasDia: d.horasDia,
      disponibilidade: d.disponibilidadeProjetos,
    },
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

  const n = await executar(
    `UPDATE recursos
        SET usuario_id = :usuarioId,
            nome = :nome,
            papel = :papel,
            equipe_id = :equipeId,
            horas_dia = :horasDia,
            disponibilidade_projetos = :disponibilidade
      WHERE id = :id`,
    {
      id,
      usuarioId: d.usuarioId ?? null,
      nome: d.nome.trim(),
      papel: d.papel?.trim() ?? null,
      equipeId: d.equipeId ?? null,
      horasDia: d.horasDia,
      disponibilidade: d.disponibilidadeProjetos,
    },
  );
  if (n === 0) throw new ErroDominio(`Recurso ${id} não encontrado`);
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
  await executar(`UPDATE recursos SET ativo = :ativo WHERE id = :id`, {
    id,
    ativo: deBool(ativo),
  });
}

export interface CargaRecurso {
  recursoId: string;
  /** Horas/dia comprometidas em tarefas ativas de projeto. */
  horasComprometidas: number;
  projetosAtivos: number;
}

/**
 * Carga por recurso, vinda das tarefas de projeto em andamento.
 *
 * Recurso sem tarefa no período aparece com carga zero — número
 * correto, não ausência de dado.
 */
export async function cargaPorRecurso(): Promise<CargaRecurso[]> {
  return consultar<CargaRecurso>(
    // Os ::numeric NAO sao decoracao. alocacao_pct e
    // disponibilidade_projetos sao inteiros, e no Postgres inteiro
    // dividido por inteiro e DIVISAO INTEIRA: 50/100 daria 0, e a carga
    // de todo mundo apareceria zerada sem erro nenhum. O Oracle nao tem
    // essa armadilha porque NUMBER e sempre decimal.
    `SELECT tr.recurso_id,
            SUM(COALESCE(t.alocacao_pct, 100)::numeric / 100 * r.horas_dia
                * r.disponibilidade_projetos::numeric / 100) AS horas_comprometidas,
            COUNT(DISTINCT t.projeto_id) AS projetos_ativos
       FROM tarefa_responsaveis tr
       JOIN projeto_tarefas t ON t.id = tr.tarefa_id
       JOIN projetos p ON p.id = t.projeto_id
       JOIN recursos r ON r.id = tr.recurso_id
      WHERE t.quadro <> 'done'
        AND t.ativo = 1
        AND p.status IN ('planejamento','execucao')
        AND CURRENT_DATE BETWEEN t.inicio AND t.fim
      GROUP BY tr.recurso_id`,
  );
}
