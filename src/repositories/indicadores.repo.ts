import { consultar, consultarUm } from "@/integrations/postgres/client.server";
import { paraBool } from "./tipos";

/**
 * Indicadores agregados do painel.
 *
 * As contagens são feitas em SQL, não no cliente: puxar centenas de
 * chamados para contar no navegador desperdiça banda e fica lento
 * quando a base crescer.
 */

export interface ResumoPainel {
  totalChamados: number;
  abertos: number;
  criticos: number;
  vencidos: number;
  /** % de chamados abertos ainda dentro do prazo. */
  aderenciaSla: number;
  artigos: number;
  artigosPendentes: number;
  projetosEmExecucao: number;
  comProblemaVinculado: number;
}

export interface ContagemPrioridade {
  prioridade: string;
  total: number;
}

export interface ContagemTipo {
  tipo: string;
  total: number;
}

export interface VolumeDia {
  dia: string;
  incidentes: number;
  requisicoes: number;
  outros: number;
}

const ABERTOS = `c.status NOT IN ('resolvido','fechado')`;

/**
 * Projeto que já foi decidido.
 *
 * O backlog é fila de priorização: contá-lo como projeto infla todo
 * indicador de carteira com o que ninguém aprovou ainda, e a diretoria
 * lê "23 projetos" quando 15 são ideias. Onde a contagem quer dizer
 * "trabalho assumido", o backlog fica fora.
 */
const DECIDIDO = `status <> 'backlog'`;

export async function resumoPainel(): Promise<ResumoPainel> {
  const [chamados, conhecimento, projetos] = await Promise.all([
    consultarUm<{
      total: number;
      abertos: number;
      criticos: number;
      vencidos: number;
      comProblema: number;
    }>(
      `SELECT COUNT(*) AS total,
              COUNT(CASE WHEN ${ABERTOS} THEN 1 END) AS abertos,
              COUNT(CASE WHEN ${ABERTOS} AND c.prioridade = 'P1' THEN 1 END) AS criticos,
              COUNT(CASE WHEN ${ABERTOS} AND c.prazo_sla < LOCALTIMESTAMP THEN 1 END) AS vencidos,
              COUNT(CASE WHEN c.problema_vinculado_id IS NOT NULL THEN 1 END) AS com_problema
         FROM chamados c`,
    ),
    consultarUm<{ total: number; pendentes: number }>(
      `SELECT COUNT(*) AS total,
              COUNT(CASE WHEN status <> 'publicado' THEN 1 END) AS pendentes
         FROM artigos`,
    ),
    consultarUm<{ emExecucao: number }>(
      `SELECT COUNT(CASE WHEN status = 'execucao' THEN 1 END) AS em_execucao FROM projetos`,
    ),
  ]);

  const abertos = chamados?.abertos ?? 0;
  const vencidos = chamados?.vencidos ?? 0;

  return {
    totalChamados: chamados?.total ?? 0,
    abertos,
    criticos: chamados?.criticos ?? 0,
    vencidos,
    // Sem chamado aberto, a aderência é 100% por definição — não 0%.
    aderenciaSla: abertos === 0 ? 100 : Math.round(((abertos - vencidos) / abertos) * 100),
    artigos: conhecimento?.total ?? 0,
    artigosPendentes: conhecimento?.pendentes ?? 0,
    projetosEmExecucao: projetos?.emExecucao ?? 0,
    comProblemaVinculado: chamados?.comProblema ?? 0,
  };
}

/** Chamados abertos por prioridade. Prioridade sem nenhum não some. */
export async function abertosPorPrioridade(): Promise<ContagemPrioridade[]> {
  const linhas = await consultar<ContagemPrioridade>(
    `SELECT c.prioridade, COUNT(*) AS total
       FROM chamados c
      WHERE ${ABERTOS}
      GROUP BY c.prioridade`,
  );
  const mapa = new Map(linhas.map((l) => [l.prioridade, l.total]));
  return ["P1", "P2", "P3", "P4"].map((p) => ({ prioridade: p, total: mapa.get(p) ?? 0 }));
}

export async function totalPorTipo(): Promise<ContagemTipo[]> {
  return consultar<ContagemTipo>(
    `SELECT c.tipo, COUNT(*) AS total FROM chamados c GROUP BY c.tipo ORDER BY COUNT(*) DESC`,
  );
}

/**
 * Volume dos últimos 7 dias. A série de datas é gerada em SQL para que
 * dias sem chamado apareçam como zero — sem isso o gráfico "pula" dias e
 * dá impressão errada de continuidade.
 *
 * generate_series faz aqui o papel do CONNECT BY LEVEL do Oracle:
 * devolve uma linha por dia. CURRENT_DATE respeita o fuso da sessão
 * (America/Sao_Paulo), então "hoje" é hoje no Brasil.
 */
export async function volumeUltimos7Dias(): Promise<VolumeDia[]> {
  return consultar<VolumeDia>(
    `WITH dias AS (
       SELECT CURRENT_DATE - 6 + g AS d
         FROM generate_series(0, 6) AS g
     )
     SELECT TO_CHAR(dias.d, 'DD/MM') AS dia,
            COUNT(CASE WHEN c.tipo = 'incidente' THEN 1 END) AS incidentes,
            COUNT(CASE WHEN c.tipo = 'requisicao' THEN 1 END) AS requisicoes,
            COUNT(CASE WHEN c.tipo NOT IN ('incidente','requisicao') THEN 1 END) AS outros
       FROM dias
       LEFT JOIN chamados c ON c.criado_em::date = dias.d
      GROUP BY dias.d
      ORDER BY dias.d`,
  );
}

export interface ChamadoResumido {
  id: string;
  codigo: string;
  titulo: string;
  tipo: string;
  prioridade: string;
  status: string;
  prazoSla: Date;
  criadoEm: Date;
  responsavelNome: string | null;
}

/** Fila prioritária: os mais críticos e mais antigos primeiro. */
export async function filaPrioritaria(limite = 5): Promise<ChamadoResumido[]> {
  return consultar<ChamadoResumido>(
    `SELECT c.id, c.codigo, c.titulo, c.tipo, c.prioridade, c.status,
            c.prazo_sla, c.criado_em, u.nome AS responsavel_nome
       FROM chamados c
       LEFT JOIN usuarios u ON u.id = c.responsavel_id
      WHERE ${ABERTOS}
      ORDER BY c.prioridade, c.prazo_sla
      FETCH FIRST :limite ROWS ONLY`,
    { limite },
  );
}

export interface Recorrencia {
  sistemaNome: string;
  total: number;
}

/**
 * Sistemas com 3+ incidentes abertos — candidatos a análise de causa
 * raiz. Substituiu o texto fixo que citava um "PRB-018" inexistente.
 */
export async function sistemasRecorrentes(): Promise<Recorrencia[]> {
  return consultar<Recorrencia>(
    `SELECT s.nome AS sistema_nome, COUNT(*) AS total
       FROM chamados c
       JOIN sistemas s ON s.id = c.sistema_id
      WHERE c.tipo = 'incidente' AND ${ABERTOS}
      GROUP BY s.nome
     HAVING COUNT(*) >= 3
      ORDER BY COUNT(*) DESC`,
  );
}

// ------------------------------------------------------------- diretoria

export interface PeriodoFiltro {
  de?: Date | undefined;
  ate?: Date | undefined;
}

export interface MetricasChamados {
  criados: number;
  atendidos: number;
  backlog: number;
  vencidos: number;
  comPrimeiroRetorno: number;
  dentroSla: number;
  /** % dos atendidos que fecharam dentro do prazo. */
  aderencia: number;
  /** Tempo médio de solução, em horas de relógio. */
  tempoMedioSolucaoH: number;
}

export interface SerieDia {
  dia: string;
  criados: number;
  atendidos: number;
}

export interface ContagemChave {
  chave: string;
  total: number;
  atendidos: number;
}

/**
 * Recorte de período. Sem datas, considera tudo.
 *
 * O filtro incide sobre criado_em: "chamados do período" significa
 * abertos no período, não encerrados nele. Misturar os dois critérios
 * produz indicador que ninguém consegue reconciliar.
 */
function condPeriodo(p: PeriodoFiltro): { sql: string; binds: Record<string, unknown> } {
  const binds: Record<string, unknown> = {};
  const partes: string[] = [];
  if (p.de) {
    partes.push(`c.criado_em >= :de`);
    binds["de"] = p.de;
  }
  if (p.ate) {
    partes.push(`c.criado_em <= :ate`);
    binds["ate"] = p.ate;
  }
  return { sql: partes.length ? `AND ${partes.join(" AND ")}` : "", binds };
}

export async function metricasChamados(p: PeriodoFiltro = {}): Promise<MetricasChamados> {
  const { sql, binds } = condPeriodo(p);

  const r = await consultarUm<{
    criados: number;
    atendidos: number;
    backlog: number;
    vencidos: number;
    comRetorno: number;
    dentroSla: number;
    mediaHoras: number | null;
  }>(
    `SELECT COUNT(*) AS criados,
            COUNT(CASE WHEN c.status IN ('resolvido','fechado') THEN 1 END) AS atendidos,
            COUNT(CASE WHEN ${ABERTOS} THEN 1 END) AS backlog,
            COUNT(CASE WHEN ${ABERTOS} AND c.prazo_sla < LOCALTIMESTAMP THEN 1 END) AS vencidos,
            COUNT(CASE WHEN c.respondido_em IS NOT NULL THEN 1 END) AS com_retorno,
            COUNT(CASE WHEN c.resolvido_em IS NOT NULL
                        AND c.resolvido_em <= c.prazo_sla THEN 1 END) AS dentro_sla,
            -- No Oracle, DATE menos DATE dava dias com fracao, e o *24
            -- virava horas. No Postgres, date menos date da dias
            -- INTEIROS: todo chamado resolvido no mesmo dia entraria
            -- como 0 hora e a media desabaria, sem erro.
            -- timestamp menos timestamp da um interval; EXTRACT(EPOCH)
            -- transforma em segundos, e /3600 em horas com fracao.
            AVG(CASE WHEN c.resolvido_em IS NOT NULL
                     THEN EXTRACT(EPOCH FROM (c.resolvido_em - c.criado_em)) / 3600 END)
              AS media_horas
       FROM chamados c
      WHERE 1 = 1 ${sql}`,
    binds,
  );

  const atendidos = r?.atendidos ?? 0;
  const dentroSla = r?.dentroSla ?? 0;

  return {
    criados: r?.criados ?? 0,
    atendidos,
    backlog: r?.backlog ?? 0,
    vencidos: r?.vencidos ?? 0,
    comPrimeiroRetorno: r?.comRetorno ?? 0,
    dentroSla,
    aderencia: atendidos === 0 ? 100 : Math.round((dentroSla / atendidos) * 100),
    tempoMedioSolucaoH: Math.round((r?.mediaHoras ?? 0) * 10) / 10,
  };
}

/** Série diária de criados x atendidos no período (máx. 90 dias). */
export async function serieCriadosAtendidos(p: PeriodoFiltro = {}): Promise<SerieDia[]> {
  const de = p.de ?? new Date(Date.now() - 29 * 86_400_000);
  const ate = p.ate ?? new Date();
  const dias = Math.min(
    90,
    Math.max(1, Math.ceil((ate.getTime() - de.getTime()) / 86_400_000) + 1),
  );

  return consultar<SerieDia>(
    `WITH dias AS (
       SELECT :de::date + g AS d
         FROM generate_series(0, :qtd::int - 1) AS g
     )
     SELECT TO_CHAR(dias.d, 'DD/MM') AS dia,
            COUNT(cr.id) AS criados,
            COUNT(at.id) AS atendidos
       FROM dias
       LEFT JOIN chamados cr ON cr.criado_em::date = dias.d
       LEFT JOIN chamados at ON at.resolvido_em::date = dias.d
      GROUP BY dias.d
      ORDER BY dias.d`,
    { de, qtd: dias },
  );
}

/** Agrupa por uma coluna do chamado, com criados e atendidos. */
async function agrupar(colunaSql: string, p: PeriodoFiltro): Promise<ContagemChave[]> {
  const { sql, binds } = condPeriodo(p);
  return consultar<ContagemChave>(
    `SELECT ${colunaSql} AS chave,
            COUNT(*) AS total,
            COUNT(CASE WHEN c.status IN ('resolvido','fechado') THEN 1 END) AS atendidos
       FROM chamados c
       LEFT JOIN equipes eq ON eq.id = c.equipe_id
      WHERE 1 = 1 ${sql}
      GROUP BY ${colunaSql}
      ORDER BY COUNT(*) DESC`,
    binds,
  );
}

export const chamadosPorPrioridade = (p: PeriodoFiltro = {}) => agrupar("c.prioridade", p);
export const chamadosPorTipo = (p: PeriodoFiltro = {}) => agrupar("c.tipo", p);
export const chamadosPorStatus = (p: PeriodoFiltro = {}) => agrupar("c.status", p);
export const chamadosPorEquipe = (p: PeriodoFiltro = {}) =>
  agrupar("COALESCE(eq.nome, 'Sem equipe')", p);

export interface MetricasProjetos {
  /** Projetos decididos: não inclui o backlog. */
  total: number;
  emExecucao: number;
  planejamento: number;
  paralisados: number;
  cancelados: number;
  concluidos: number;
  atrasados: number;
  /** Fila de priorização. Contado à parte, nunca somado ao total. */
  backlog: number;
}

/**
 * Números do portfólio.
 *
 * `total` conta só o que foi decidido. O backlog vem numa chave própria
 * porque é outra pergunta — "quanto trabalho assumimos" e "quanto está
 * esperando decisão" são grandezas diferentes, e somá-las produzia um
 * número que a diretoria lia como compromisso.
 *
 * Cancelado saiu de "parados": paralisado é projeto que pode voltar,
 * cancelado é projeto que acabou. Agrupá-los escondia quanto da carteira
 * simplesmente morreu.
 */
export async function metricasProjetos(): Promise<MetricasProjetos> {
  const r = await consultarUm<MetricasProjetos>(
    `SELECT COUNT(CASE WHEN ${DECIDIDO} THEN 1 END) AS total,
            COUNT(CASE WHEN status = 'execucao' THEN 1 END) AS em_execucao,
            COUNT(CASE WHEN status = 'planejamento' THEN 1 END) AS planejamento,
            COUNT(CASE WHEN status = 'paralisado' THEN 1 END) AS paralisados,
            COUNT(CASE WHEN status = 'cancelado' THEN 1 END) AS cancelados,
            COUNT(CASE WHEN status = 'concluido' THEN 1 END) AS concluidos,
            COUNT(CASE WHEN status IN ('execucao','planejamento')
                        AND fim < CURRENT_DATE THEN 1 END) AS atrasados,
            COUNT(CASE WHEN status = 'backlog' THEN 1 END) AS backlog
       FROM projetos`,
  );
  return (
    r ?? {
      total: 0,
      emExecucao: 0,
      planejamento: 0,
      paralisados: 0,
      cancelados: 0,
      concluidos: 0,
      atrasados: 0,
      backlog: 0,
    }
  );
}

// -------------------------------------------------- carteira de projetos

export interface MesCarteira {
  /** MM/AA, pronto para o eixo do gráfico. */
  rotulo: string;
  /** true no mês corrente: separa realizado de previsto. */
  atual: boolean;
  /** Concluídos com término naquele mês. */
  entregues: number;
  /** Em planejamento ou execução com término previsto naquele mês. */
  previstos: number;
  /** Cancelados naquele mês. */
  cancelados: number;
}

/** Booleano é SMALLINT 0/1 no schema. */
interface LinhaMesCarteira extends Omit<MesCarteira, "atual"> {
  atual: number;
}

/**
 * Curva da carteira: o que saiu nos últimos meses e o que está previsto
 * para os próximos.
 *
 * Entregue e previsto saem os dois da data `fim` do projeto — é a data
 * que o gerente informou e é contra ela que a diretoria cobra. Usar
 * `atualizado_em` para o entregue faria o projeto pular de mês a cada
 * edição posterior.
 *
 * Projeto ativo com `fim` no passado é contado no mês corrente: ele não
 * foi entregue, então somar no passado inflaria a barra de entregas de
 * um mês que não teve entrega nenhuma.
 *
 * Backlog não entra em "previstos": a data dele é o dia do cadastro, não
 * uma promessa de entrega, e apareceria como um monte de entregas
 * previstas para este mês.
 *
 * Cancelado usa `atualizado_em` por falta de coluna própria — para um
 * projeto cancelado, a última alteração é quase sempre o cancelamento.
 */
export async function carteiraProjetos(mesesAtras = 3, mesesFrente = 6): Promise<MesCarteira[]> {
  const linhas = await consultar<LinhaMesCarteira>(
    `WITH meses AS (
       SELECT generate_series(
                date_trunc('month', CURRENT_DATE) - make_interval(months => :atras::int),
                date_trunc('month', CURRENT_DATE) + make_interval(months => :frente::int),
                INTERVAL '1 month'
              ) AS mes
     )
     SELECT TO_CHAR(m.mes, 'MM/YY') AS rotulo,
            CASE WHEN m.mes = date_trunc('month', CURRENT_DATE) THEN 1 ELSE 0 END AS atual,
            (SELECT COUNT(*) FROM projetos p
              WHERE p.status = 'concluido'
                AND date_trunc('month', p.fim) = m.mes) AS entregues,
            (SELECT COUNT(*) FROM projetos p
              WHERE p.status IN ('planejamento', 'execucao')
                AND GREATEST(
                      date_trunc('month', p.fim),
                      date_trunc('month', CURRENT_DATE)
                    ) = m.mes) AS previstos,
            (SELECT COUNT(*) FROM projetos p
              WHERE p.status = 'cancelado'
                AND date_trunc('month', p.atualizado_em) = m.mes) AS cancelados
       FROM meses m
      ORDER BY m.mes`,
    { atras: mesesAtras, frente: mesesFrente },
  );
  return linhas.map((l) => ({ ...l, atual: paraBool(l.atual) }));
}

export interface CargaGerente {
  gerenteId: string | null;
  gerenteNome: string;
  total: number;
  emExecucao: number;
  atrasados: number;
  /** Sem atualização há mais de 7 dias. */
  semAcompanhamento: number;
}

/**
 * Quantos projetos cada gerente carrega, e em que estado.
 *
 * Projeto sem gerente vira uma linha "Sem gerente" em vez de sumir: é
 * exatamente o caso que a diretoria precisa enxergar.
 *
 * Cancelado e backlog ficam de fora: a tabela responde "quanto cada um
 * está carregando agora", e nem o que morreu nem o que ainda não
 * começou pesam na agenda de ninguém.
 */
export async function projetosPorGerente(): Promise<CargaGerente[]> {
  return consultar<CargaGerente>(
    `SELECT p.gerente_id,
            COALESCE(u.nome, 'Sem gerente') AS gerente_nome,
            COUNT(*) AS total,
            COUNT(CASE WHEN p.status = 'execucao' THEN 1 END) AS em_execucao,
            COUNT(CASE WHEN p.status IN ('planejamento', 'execucao')
                        AND p.fim < CURRENT_DATE THEN 1 END) AS atrasados,
            COUNT(CASE WHEN p.status IN ('planejamento', 'execucao')
                        AND CURRENT_DATE - COALESCE(a.ultima, p.criado_em::date) > 7
                       THEN 1 END) AS sem_acompanhamento
       FROM projetos p
       LEFT JOIN usuarios u ON u.id = p.gerente_id
       LEFT JOIN (SELECT projeto_id, MAX(data_ref) AS ultima
                    FROM projeto_atualizacoes GROUP BY projeto_id) a
              ON a.projeto_id = p.id
      WHERE p.status NOT IN ('cancelado', 'backlog')
      GROUP BY p.gerente_id, u.nome
      ORDER BY COUNT(*) DESC`,
  );
}

export interface FiltroPortfolio {
  gerenteId?: string | undefined;
  nome?: string | undefined;
  status?: string | undefined;
}

export interface ProjetoPortfolio {
  id: string;
  nome: string;
  status: string;
  gerenteNome: string | null;
  inicio: Date;
  fim: Date;
  progresso: number;
  diasSemAtualizar: number | null;
  atrasado: boolean;
}

/** Booleano é SMALLINT 0/1 no schema. */
interface LinhaProjetoPortfolio extends Omit<ProjetoPortfolio, "atrasado"> {
  atrasado: number;
}

/**
 * Lista filtrável do portfólio, para a diretoria descer do número
 * agregado até o projeto que o explica.
 *
 * O backlog só aparece se pedido explicitamente pelo filtro de situação.
 * Fora isso, a lista precisa bater com o total dos indicadores acima —
 * uma tabela com mais linhas do que o número que ela detalha é o tipo de
 * incoerência que faz a diretoria desconfiar do painel inteiro.
 *
 * A ordem é a da atenção que cada situação merece, não a alfabética:
 * `ORDER BY p.status` colocava "cancelado" no topo.
 */
export async function portfolio(f: FiltroPortfolio = {}): Promise<ProjetoPortfolio[]> {
  const cond: string[] = [];
  const binds: Record<string, unknown> = {};

  if (f.gerenteId) {
    cond.push(`p.gerente_id = :gerenteId`);
    binds["gerenteId"] = f.gerenteId;
  }
  if (f.status) {
    cond.push(`p.status = :status`);
    binds["status"] = f.status;
  } else {
    cond.push(`p.${DECIDIDO}`);
  }
  if (f.nome) {
    // ILIKE: busca por nome não deve depender de maiúscula.
    cond.push(`p.nome ILIKE :nome`);
    binds["nome"] = `%${f.nome}%`;
  }

  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const linhas = await consultar<LinhaProjetoPortfolio>(
    `SELECT p.id, p.nome, p.status, u.nome AS gerente_nome, p.inicio, p.fim,
            COALESCE(ROUND(t.media), 0) AS progresso,
            CURRENT_DATE - COALESCE(a.ultima, p.criado_em::date) AS dias_sem_atualizar,
            CASE WHEN p.status IN ('planejamento', 'execucao') AND p.fim < CURRENT_DATE
                 THEN 1 ELSE 0 END AS atrasado
       FROM projetos p
       LEFT JOIN usuarios u ON u.id = p.gerente_id
       LEFT JOIN (SELECT projeto_id, AVG(progresso) AS media
                    FROM projeto_tarefas WHERE ativo = 1
                   GROUP BY projeto_id) t
              ON t.projeto_id = p.id
       LEFT JOIN (SELECT projeto_id, MAX(data_ref) AS ultima
                    FROM projeto_atualizacoes GROUP BY projeto_id) a
              ON a.projeto_id = p.id
       ${where}
      ORDER BY CASE p.status
                 WHEN 'execucao' THEN 1
                 WHEN 'planejamento' THEN 2
                 WHEN 'paralisado' THEN 3
                 WHEN 'backlog' THEN 4
                 WHEN 'concluido' THEN 5
                 WHEN 'cancelado' THEN 6
                 ELSE 7
               END,
               p.fim`,
    binds,
  );
  return linhas.map((l) => ({ ...l, atrasado: paraBool(l.atrasado) }));
}
