import { db, checar, linhas } from "@/integrations/db/client.server";

/**
 * Indicadores agregados do painel.
 *
 * As agregações eram feitas em SQL no Oracle; agora buscamos só as
 * colunas necessárias via PostgREST e calculamos contagens, séries e
 * médias em TypeScript.
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

function ehAberto(status: string): boolean {
  return status !== "resolvido" && status !== "fechado";
}

/** Formata uma data local no padrão dd/MM usado nas séries do painel. */
function formatarDiaMes(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

/** Início do dia (local) de uma data, para comparar por dia. */
function inicioDoDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export async function resumoPainel(): Promise<ResumoPainel> {
  const [chamadosResp, artigosResp, projetosResp] = await Promise.all([
    db
      .from("chamados")
      .select("status, prioridade, prazo_sla, problema_vinculado_id"),
    db.from("artigos").select("status"),
    db.from("projetos").select("status"),
  ]);

  const chamados = linhas(chamadosResp);
  const artigos = linhas(artigosResp);
  const projetos = linhas(projetosResp);

  const agora = Date.now();

  let abertos = 0;
  let criticos = 0;
  let vencidos = 0;
  let comProblema = 0;
  for (const c of chamados) {
    const aberto = ehAberto(c.status);
    if (aberto) {
      abertos++;
      if (c.prioridade === "P1") criticos++;
      if (new Date(c.prazo_sla).getTime() < agora) vencidos++;
    }
    if (c.problema_vinculado_id !== null) comProblema++;
  }

  const artigosPendentes = artigos.filter((a) => a.status !== "publicado").length;
  const projetosEmExecucao = projetos.filter((p) => p.status === "execucao").length;

  return {
    totalChamados: chamados.length,
    abertos,
    criticos,
    vencidos,
    // Sem chamado aberto, a aderência é 100% por definição — não 0%.
    aderenciaSla: abertos === 0 ? 100 : Math.round(((abertos - vencidos) / abertos) * 100),
    artigos: artigos.length,
    artigosPendentes,
    projetosEmExecucao,
    comProblemaVinculado: comProblema,
  };
}

/** Chamados abertos por prioridade. Prioridade sem nenhum não some. */
export async function abertosPorPrioridade(): Promise<ContagemPrioridade[]> {
  const chamados = linhas(await db.from("chamados").select("status, prioridade"));
  const mapa = new Map<string, number>();
  for (const c of chamados) {
    if (!ehAberto(c.status)) continue;
    mapa.set(c.prioridade, (mapa.get(c.prioridade) ?? 0) + 1);
  }
  return ["P1", "P2", "P3", "P4"].map((p) => ({ prioridade: p, total: mapa.get(p) ?? 0 }));
}

export async function totalPorTipo(): Promise<ContagemTipo[]> {
  const chamados = linhas(await db.from("chamados").select("tipo"));
  const mapa = new Map<string, number>();
  for (const c of chamados) {
    mapa.set(c.tipo, (mapa.get(c.tipo) ?? 0) + 1);
  }
  return [...mapa.entries()]
    .map(([tipo, total]) => ({ tipo, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Volume dos últimos 7 dias. Geramos a série de datas em TypeScript para
 * que dias sem chamado apareçam como zero — sem isso o gráfico "pula"
 * dias e dá impressão errada de continuidade.
 */
export async function volumeUltimos7Dias(): Promise<VolumeDia[]> {
  const chamados = linhas(await db.from("chamados").select("tipo, criado_em"));

  const hoje = new Date();
  const dias: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    dias.push(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - i));
  }

  return dias.map((d) => {
    const chave = inicioDoDia(d);
    const doDia = chamados.filter((c) => inicioDoDia(new Date(c.criado_em)) === chave);
    return {
      dia: formatarDiaMes(d),
      incidentes: doDia.filter((c) => c.tipo === "incidente").length,
      requisicoes: doDia.filter((c) => c.tipo === "requisicao").length,
      outros: doDia.filter((c) => c.tipo !== "incidente" && c.tipo !== "requisicao").length,
    };
  });
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
  const chamados = linhas(
    await db
      .from("chamados")
      .select(
        "id, codigo, titulo, tipo, prioridade, status, prazo_sla, criado_em, responsavel_id, usuarios:responsavel_id(nome)",
      ),
  );

  return chamados
    .filter((c) => ehAberto(c.status))
    .sort((a, b) => {
      if (a.prioridade !== b.prioridade) return a.prioridade < b.prioridade ? -1 : 1;
      return new Date(a.prazo_sla).getTime() - new Date(b.prazo_sla).getTime();
    })
    .slice(0, limite)
    .map((c) => ({
      id: c.id,
      codigo: c.codigo ?? "",
      titulo: c.titulo,
      tipo: c.tipo,
      prioridade: c.prioridade,
      status: c.status,
      prazoSla: new Date(c.prazo_sla),
      criadoEm: new Date(c.criado_em),
      responsavelNome: (c.usuarios as { nome: string } | null)?.nome ?? null,
    }));
}

export interface Recorrencia {
  sistemaNome: string;
  total: number;
}

/**
 * Sistemas com 3+ incidentes abertos — candidatos a análise de causa
 * raiz.
 */
export async function sistemasRecorrentes(): Promise<Recorrencia[]> {
  const chamados = linhas(
    await db
      .from("chamados")
      .select("tipo, status, sistema_id, sistemas:sistema_id(nome)")
      .eq("tipo", "incidente"),
  );

  const mapa = new Map<string, number>();
  for (const c of chamados) {
    if (!ehAberto(c.status) || !c.sistema_id) continue;
    const nome = (c.sistemas as { nome: string } | null)?.nome;
    if (!nome) continue;
    mapa.set(nome, (mapa.get(nome) ?? 0) + 1);
  }

  return [...mapa.entries()]
    .filter(([, total]) => total >= 3)
    .map(([sistemaNome, total]) => ({ sistemaNome, total }))
    .sort((a, b) => b.total - a.total);
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

interface ChamadoIndicador {
  id: string;
  status: string;
  prioridade: string;
  tipo: string;
  criado_em: string;
  prazo_sla: string;
  respondido_em: string | null;
  resolvido_em: string | null;
  equipe_id: string | null;
}

/**
 * Recorte de período. Sem datas, considera tudo.
 *
 * O filtro incide sobre criado_em: "chamados do período" significa
 * abertos no período, não encerrados nele. Misturar os dois critérios
 * produz indicador que ninguém consegue reconciliar.
 */
function aplicarPeriodo<T extends { criado_em: string }>(linhasList: T[], p: PeriodoFiltro): T[] {
  return linhasList.filter((l) => {
    const criado = new Date(l.criado_em).getTime();
    if (p.de && criado < p.de.getTime()) return false;
    if (p.ate && criado > p.ate.getTime()) return false;
    return true;
  });
}

async function buscarChamadosIndicador(): Promise<ChamadoIndicador[]> {
  return linhas(
    await db
      .from("chamados")
      .select(
        "id, status, prioridade, tipo, criado_em, prazo_sla, respondido_em, resolvido_em, equipe_id",
      ),
  );
}

function ehAtendido(status: string): boolean {
  return status === "resolvido" || status === "fechado";
}

export async function metricasChamados(p: PeriodoFiltro = {}): Promise<MetricasChamados> {
  const todos = aplicarPeriodo(await buscarChamadosIndicador(), p);

  const agoraMs = Date.now();
  let atendidos = 0;
  let backlog = 0;
  let vencidos = 0;
  let comRetorno = 0;
  let dentroSla = 0;
  let somaHoras = 0;
  let comHoras = 0;

  for (const c of todos) {
    if (ehAtendido(c.status)) atendidos++;
    if (ehAberto(c.status)) {
      backlog++;
      if (new Date(c.prazo_sla).getTime() < agoraMs) vencidos++;
    }
    if (c.respondido_em !== null) comRetorno++;
    if (c.resolvido_em !== null) {
      if (new Date(c.resolvido_em).getTime() <= new Date(c.prazo_sla).getTime()) dentroSla++;
      const horas =
        (new Date(c.resolvido_em).getTime() - new Date(c.criado_em).getTime()) / 3_600_000;
      somaHoras += horas;
      comHoras++;
    }
  }

  return {
    criados: todos.length,
    atendidos,
    backlog,
    vencidos,
    comPrimeiroRetorno: comRetorno,
    dentroSla,
    aderencia: atendidos === 0 ? 100 : Math.round((dentroSla / atendidos) * 100),
    tempoMedioSolucaoH: Math.round((comHoras === 0 ? 0 : somaHoras / comHoras) * 10) / 10,
  };
}

/** Série diária de criados x atendidos no período (máx. 90 dias). */
export async function serieCriadosAtendidos(p: PeriodoFiltro = {}): Promise<SerieDia[]> {
  const de = p.de ?? new Date(Date.now() - 29 * 86_400_000);
  const ate = p.ate ?? new Date();
  const qtdDias = Math.min(
    90,
    Math.max(1, Math.ceil((ate.getTime() - de.getTime()) / 86_400_000) + 1),
  );

  const chamados = linhas(await db.from("chamados").select("criado_em, resolvido_em"));

  const inicio = new Date(de.getFullYear(), de.getMonth(), de.getDate());
  const dias: Date[] = [];
  for (let i = 0; i < qtdDias; i++) {
    dias.push(new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i));
  }

  return dias.map((d) => {
    const chave = inicioDoDia(d);
    const criados = chamados.filter((c) => inicioDoDia(new Date(c.criado_em)) === chave).length;
    const atendidos = chamados.filter(
      (c) => c.resolvido_em !== null && inicioDoDia(new Date(c.resolvido_em)) === chave,
    ).length;
    return { dia: formatarDiaMes(d), criados, atendidos };
  });
}

/** Agrupa por uma chave derivada do chamado, com criados e atendidos. */
function agrupar(
  todos: ChamadoIndicador[],
  chaveDe: (c: ChamadoIndicador) => string,
): ContagemChave[] {
  const mapa = new Map<string, { total: number; atendidos: number }>();
  for (const c of todos) {
    const chave = chaveDe(c);
    const atual = mapa.get(chave) ?? { total: 0, atendidos: 0 };
    atual.total++;
    if (ehAtendido(c.status)) atual.atendidos++;
    mapa.set(chave, atual);
  }
  return [...mapa.entries()]
    .map(([chave, v]) => ({ chave, total: v.total, atendidos: v.atendidos }))
    .sort((a, b) => b.total - a.total);
}

export async function chamadosPorPrioridade(p: PeriodoFiltro = {}): Promise<ContagemChave[]> {
  const todos = aplicarPeriodo(await buscarChamadosIndicador(), p);
  return agrupar(todos, (c) => c.prioridade);
}

export async function chamadosPorTipo(p: PeriodoFiltro = {}): Promise<ContagemChave[]> {
  const todos = aplicarPeriodo(await buscarChamadosIndicador(), p);
  return agrupar(todos, (c) => c.tipo);
}

export async function chamadosPorStatus(p: PeriodoFiltro = {}): Promise<ContagemChave[]> {
  const todos = aplicarPeriodo(await buscarChamadosIndicador(), p);
  return agrupar(todos, (c) => c.status);
}

export async function chamadosPorEquipe(p: PeriodoFiltro = {}): Promise<ContagemChave[]> {
  const todos = aplicarPeriodo(await buscarChamadosIndicador(), p);
  const equipes = linhas(await db.from("equipes").select("id, nome"));
  const nomeDe = new Map(equipes.map((e) => [e.id, e.nome]));
  return agrupar(todos, (c) => (c.equipe_id ? (nomeDe.get(c.equipe_id) ?? "Sem equipe") : "Sem equipe"));
}

export interface MetricasProjetos {
  total: number;
  emExecucao: number;
  planejamento: number;
  parados: number;
  concluidos: number;
  atrasados: number;
}

export async function metricasProjetos(): Promise<MetricasProjetos> {
  const projetos = linhas(await db.from("projetos").select("status, fim"));

  const hoje = inicioDoDia(new Date());
  let emExecucao = 0;
  let planejamento = 0;
  let parados = 0;
  let concluidos = 0;
  let atrasados = 0;

  for (const p of projetos) {
    if (p.status === "execucao") emExecucao++;
    if (p.status === "planejamento") planejamento++;
    if (p.status === "paralisado" || p.status === "cancelado") parados++;
    if (p.status === "concluido") concluidos++;
    if (
      (p.status === "execucao" || p.status === "planejamento") &&
      inicioDoDia(new Date(p.fim)) < hoje
    ) {
      atrasados++;
    }
  }

  return {
    total: projetos.length,
    emExecucao,
    planejamento,
    parados,
    concluidos,
    atrasados,
  };
}
