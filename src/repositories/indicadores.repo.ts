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

/**
 * Projeto que já foi decidido.
 *
 * O backlog é fila de priorização: contá-lo como projeto infla todo
 * indicador de carteira com o que ninguém aprovou ainda, e a diretoria
 * lê "23 projetos" quando 15 são ideias. Onde a contagem quer dizer
 * "trabalho assumido", o backlog fica fora.
 */
const DECIDIDO = `status <> 'backlog'`;

// ---------------------------------------------------------------------
// Chamados: no Supabase, por empresa. As contas são as mesmas do legado
// e moram em funções do banco (ind_*), que respeitam o RLS.
// ---------------------------------------------------------------------

async function tenantAtual(): Promise<string> {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return (await getUsuarioAtual()).tenantId;
}

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { getSupabaseServerClient } = await import("@/integrations/supabase/server");
  const { data, error } = await getSupabaseServerClient().rpc(nome, args);
  if (error) throw new Error(`Falha ao calcular indicador (${nome}): ${error.message}`);
  return data as T;
}

const n = (v: unknown): number => Number(v ?? 0);

export async function resumoPainel(): Promise<ResumoPainel> {
  const tenant = await tenantAtual();
  const [r, a] = await Promise.all([
    rpc<Record<string, unknown>>("ind_resumo_chamados", { p_tenant: tenant }),
    rpc<Record<string, unknown>>("ind_resumo_artigos", { p_tenant: tenant }),
  ]);

  const abertos = n(r["abertos"]);
  const vencidos = n(r["vencidos"]);

  return {
    totalChamados: n(r["total"]),
    abertos,
    criticos: n(r["criticos"]),
    vencidos,
    aderenciaSla: abertos === 0 ? 100 : Math.round(((abertos - vencidos) / abertos) * 100),
    artigos: n(a["total"]),
    artigosPendentes: n(a["pendentes"]),
    // Zero até Projetos migrar para o Supabase.
    projetosEmExecucao: 0,
    comProblemaVinculado: n(r["com_problema"]),
  };
}

/** Chamados abertos por prioridade. Prioridade sem nenhum não some. */
export async function abertosPorPrioridade(): Promise<ContagemPrioridade[]> {
  const linhas = await rpc<{ prioridade: string; total: number }[]>("ind_abertos_por_prioridade", {
    p_tenant: await tenantAtual(),
  });
  const mapa = new Map((linhas ?? []).map((l) => [l.prioridade, n(l.total)]));
  return ["P1", "P2", "P3", "P4"].map((p) => ({ prioridade: p, total: mapa.get(p) ?? 0 }));
}

export async function totalPorTipo(): Promise<ContagemTipo[]> {
  const linhas = await rpc<{ tipo: string; total: number }[]>("ind_total_por_tipo", {
    p_tenant: await tenantAtual(),
  });
  return (linhas ?? []).map((l) => ({ tipo: l.tipo, total: n(l.total) }));
}

/**
 * Volume dos últimos 7 dias. Dias sem chamado aparecem como zero — sem
 * isso o gráfico "pula" dias e dá impressão errada de continuidade.
 * "Hoje" é hoje no fuso da empresa.
 */
export async function volumeUltimos7Dias(): Promise<VolumeDia[]> {
  const linhas = await rpc<Record<string, unknown>[]>("ind_volume_7_dias", {
    p_tenant: await tenantAtual(),
  });
  return (linhas ?? []).map((l) => ({
    dia: l["dia"] as string,
    incidentes: n(l["incidentes"]),
    requisicoes: n(l["requisicoes"]),
    outros: n(l["outros"]),
  }));
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
  const { getSupabaseServerClient } = await import("@/integrations/supabase/server");
  const { data, error } = await getSupabaseServerClient()
    .from("chamados_v")
    .select("id, codigo, titulo, tipo, prioridade, status, prazo_sla, criado_em, responsavel_nome")
    .eq("tenant_id", await tenantAtual())
    .not("status", "in", "(resolvido,fechado)")
    .order("prioridade")
    .order("prazo_sla")
    .limit(limite);
  if (error) throw new Error(`Falha ao carregar a fila prioritária: ${error.message}`);

  return (data ?? []).map((c) => ({
    id: c.id as string,
    codigo: c.codigo as string,
    titulo: c.titulo as string,
    tipo: c.tipo as string,
    prioridade: c.prioridade as string,
    status: c.status as string,
    prazoSla: new Date(c.prazo_sla as string),
    criadoEm: new Date(c.criado_em as string),
    responsavelNome: (c.responsavel_nome as string | null) ?? null,
  }));
}

export interface Recorrencia {
  sistemaNome: string;
  total: number;
}

/** Sistemas com 3+ incidentes abertos — candidatos a análise de causa raiz. */
export async function sistemasRecorrentes(): Promise<Recorrencia[]> {
  const linhas = await rpc<{ sistema_nome: string; total: number }[]>("ind_sistemas_recorrentes", {
    p_tenant: await tenantAtual(),
  });
  return (linhas ?? []).map((l) => ({ sistemaNome: l.sistema_nome, total: n(l.total) }));
}

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
function argsPeriodo(p: PeriodoFiltro) {
  return { p_de: p.de?.toISOString() ?? null, p_ate: p.ate?.toISOString() ?? null };
}

export async function metricasChamados(p: PeriodoFiltro = {}): Promise<MetricasChamados> {
  const r = await rpc<Record<string, unknown>>("ind_metricas_chamados", {
    p_tenant: await tenantAtual(),
    ...argsPeriodo(p),
  });

  const atendidos = n(r["atendidos"]);
  const dentroSla = n(r["dentro_sla"]);

  return {
    criados: n(r["criados"]),
    atendidos,
    backlog: n(r["backlog"]),
    vencidos: n(r["vencidos"]),
    comPrimeiroRetorno: n(r["com_retorno"]),
    dentroSla,
    aderencia: atendidos === 0 ? 100 : Math.round((dentroSla / atendidos) * 100),
    tempoMedioSolucaoH: Math.round(n(r["media_horas"]) * 10) / 10,
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

  const linhas = await rpc<Record<string, unknown>[]>("ind_serie_criados_atendidos", {
    p_tenant: await tenantAtual(),
    p_de: de.toISOString().slice(0, 10),
    p_qtd: dias,
  });
  return (linhas ?? []).map((l) => ({
    dia: l["dia"] as string,
    criados: n(l["criados"]),
    atendidos: n(l["atendidos"]),
  }));
}

/** Agrupa por prioridade, tipo, status ou equipe, com criados e atendidos. */
async function agrupar(
  por: "prioridade" | "tipo" | "status" | "equipe",
  p: PeriodoFiltro,
): Promise<ContagemChave[]> {
  const linhas = await rpc<Record<string, unknown>[]>("ind_agrupar_chamados", {
    p_tenant: await tenantAtual(),
    p_por: por,
    ...argsPeriodo(p),
  });
  return (linhas ?? []).map((l) => ({
    chave: l["chave"] as string,
    total: n(l["total"]),
    atendidos: n(l["atendidos"]),
  }));
}

export const chamadosPorPrioridade = (p: PeriodoFiltro = {}) => agrupar("prioridade", p);
export const chamadosPorTipo = (p: PeriodoFiltro = {}) => agrupar("tipo", p);
export const chamadosPorStatus = (p: PeriodoFiltro = {}) => agrupar("status", p);
export const chamadosPorEquipe = (p: PeriodoFiltro = {}) => agrupar("equipe", p);

// ---------------------------------------------------------------------
// Projetos: ainda no banco legado; migram com o módulo de Projetos.
// ---------------------------------------------------------------------

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