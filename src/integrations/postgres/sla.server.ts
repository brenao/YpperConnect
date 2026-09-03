import { consultar } from "./client.server";

/**
 * Cálculo de prazo de SLA.
 *
 * Regras acordadas:
 *   - Incidentes P1: regime 24×7, horas corridas.
 *   - Demais prioridades: jornada seg-sex, 8h úteis/dia (`expediente`).
 *   - Feriados não contam (`feriados`), exceto em 24×7.
 *   - O status "aguardando" NÃO congela o relógio.
 *
 * O prazo é um retrato do momento da abertura: fica gravado em
 * chamados.prazo_sla. Cadastrar um feriado novo depois NÃO recalcula
 * chamados já abertos — isso é intencional.
 *
 * Não trata horário de verão. O Brasil não adota desde 2019; se voltar,
 * este cálculo precisa ser revisto.
 */

export interface OpcoesPrazo {
  /**
   * Regime 24×7: ignora expediente, fim de semana e feriado.
   *
   * Usado por incidentes P1, que têm plantão e ponte de crise. Contar
   * horário comercial num crítico aberto sexta às 20h daria prazo só na
   * segunda — incompatível com a política de atendimento.
   */
  vinteQuatroSete?: boolean | undefined;
}

interface Faixa {
  ini: number; // minutos desde a meia-noite
  fim: number;
}

interface Calendario {
  /** índice 1..7 = segunda..domingo (ISO 8601) */
  faixasPorDia: Map<number, Faixa[]>;
  /** "MM-DD" dos feriados que se repetem todo ano */
  recorrentes: Set<string>;
  /** "YYYY-MM-DD" dos feriados de data específica */
  especificos: Set<string>;
}

let cache: { dados: Calendario; expiraEm: number } | undefined;
const TTL_MS = 10 * 60 * 1000;

function chaveData(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

function chaveMesDia(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${m}-${dia}`;
}

async function carregarCalendario(): Promise<Calendario> {
  const agora = Date.now();
  if (cache && cache.expiraEm > agora) return cache.dados;

  const [expediente, feriados] = await Promise.all([
    consultar<{ diaSemana: number; minutoIni: number; minutoFim: number }>(
      `SELECT dia_semana, minuto_ini, minuto_fim
         FROM expediente
        WHERE ativo = 1
        ORDER BY dia_semana, minuto_ini`,
    ),
    consultar<{ dataFeriado: Date; recorrente: number }>(
      `SELECT data_feriado, recorrente FROM feriados WHERE ativo = 1`,
    ),
  ]);

  const faixasPorDia = new Map<number, Faixa[]>();
  for (const e of expediente) {
    const lista = faixasPorDia.get(e.diaSemana) ?? [];
    lista.push({ ini: e.minutoIni, fim: e.minutoFim });
    faixasPorDia.set(e.diaSemana, lista);
  }

  const recorrentes = new Set<string>();
  const especificos = new Set<string>();
  for (const f of feriados) {
    const d = new Date(f.dataFeriado);
    if (f.recorrente === 1) recorrentes.add(chaveMesDia(d));
    else especificos.add(chaveData(d));
  }

  const dados: Calendario = { faixasPorDia, recorrentes, especificos };
  cache = { dados, expiraEm: agora + TTL_MS };
  return dados;
}

/** Chamar após alterar expediente ou feriados pela tela de administração. */
export function invalidarCacheCalendario(): void {
  cache = undefined;
}

function ehFeriado(d: Date, cal: Calendario): boolean {
  return cal.especificos.has(chaveData(d)) || cal.recorrentes.has(chaveMesDia(d));
}

/** JS: 0=domingo..6=sábado. ISO: 1=segunda..7=domingo. */
function diaIso(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function faixasDoDia(d: Date, cal: Calendario): Faixa[] {
  if (ehFeriado(d, cal)) return [];
  return cal.faixasPorDia.get(diaIso(d)) ?? [];
}

function comMinuto(base: Date, minuto: number): Date {
  const d = new Date(base);
  d.setHours(Math.floor(minuto / 60), minuto % 60, 0, 0);
  return d;
}

function proximaMeiaNoite(base: Date): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Soma `horasUteis` de expediente a partir de `inicio`.
 * Se `inicio` cair fora do expediente, o relógio começa a contar na
 * próxima abertura.
 *
 * Com `vinteQuatroSete`, vira soma direta de horas corridas.
 */
export async function calcularPrazo(
  inicio: Date,
  horasUteis: number,
  opcoes: OpcoesPrazo = {},
): Promise<Date> {
  if (horasUteis <= 0) throw new Error("horasUteis deve ser maior que zero");

  if (opcoes.vinteQuatroSete) {
    return new Date(inicio.getTime() + horasUteis * 3_600_000);
  }

  const cal = await carregarCalendario();
  if (cal.faixasPorDia.size === 0) {
    throw new Error("Tabela `expediente` vazia: impossível calcular SLA");
  }

  let restante = Math.round(horasUteis * 60);
  let cursor = new Date(inicio);

  // Guarda contra laço infinito se o expediente for cadastrado errado
  // (ex.: só feriados, ou nenhuma faixa ativa).
  for (let dia = 0; dia < 3650; dia++) {
    const faixas = faixasDoDia(cursor, cal);
    let minuto = cursor.getHours() * 60 + cursor.getMinutes();

    for (const f of faixas) {
      const ini = Math.max(minuto, f.ini);
      if (ini >= f.fim) continue;

      const disponivel = f.fim - ini;
      if (restante <= disponivel) return comMinuto(cursor, ini + restante);

      restante -= disponivel;
      minuto = f.fim;
    }

    cursor = proximaMeiaNoite(cursor);
  }

  throw new Error("Cálculo de SLA excedeu 10 anos: verifique expediente e feriados");
}

/**
 * Minutos decorridos entre duas datas. Use para medir consumo real de
 * SLA nos relatórios, em vez de subtrair timestamps.
 */
export async function minutosUteisEntre(
  de: Date,
  ate: Date,
  opcoes: OpcoesPrazo = {},
): Promise<number> {
  if (ate <= de) return 0;

  // Em 24×7 o tempo decorrido é o tempo de relógio.
  if (opcoes.vinteQuatroSete) {
    return Math.round((ate.getTime() - de.getTime()) / 60000);
  }

  const cal = await carregarCalendario();
  let total = 0;
  let cursor = new Date(de);

  for (let dia = 0; dia < 3650; dia++) {
    if (cursor >= ate) break;

    const faixas = faixasDoDia(cursor, cal);
    let minuto = cursor.getHours() * 60 + cursor.getMinutes();

    for (const f of faixas) {
      const ini = Math.max(minuto, f.ini);
      if (ini >= f.fim) continue;

      const inicioFaixa = comMinuto(cursor, ini);
      const fimFaixa = comMinuto(cursor, f.fim);
      const fimReal = fimFaixa < ate ? fimFaixa : ate;
      if (fimReal > inicioFaixa) {
        total += Math.round((fimReal.getTime() - inicioFaixa.getTime()) / 60000);
      }
      minuto = f.fim;
    }

    cursor = proximaMeiaNoite(cursor);
  }

  return total;
}

// ------------------------------------------------------- dias úteis

/**
 * Camada de dias, para o cronograma de projetos.
 *
 * O SLA raciocina em minutos dentro das faixas de expediente; o
 * cronograma raciocina em dias inteiros. As duas leituras saem do mesmo
 * `expediente` e dos mesmos `feriados` de propósito: um calendário
 * paralelo acabaria discordando do outro sobre o mesmo feriado, e
 * ninguém saberia qual está certo.
 *
 * Um dia é útil quando tem ao menos uma faixa de expediente e não é
 * feriado. Sábado sem faixa cadastrada não é dia útil; sábado com faixa
 * é — quem manda é o cadastro, não o nome do dia.
 */

/** Versão pura, para poder ser testada sem banco. */
function ehDiaUtilNoCalendario(d: Date, cal: Calendario): boolean {
  return faixasDoDia(d, cal).length > 0;
}

function proximoDiaUtilNoCalendario(d: Date, cal: Calendario): Date {
  const cursor = new Date(d);
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i < 3650; i++) {
    if (ehDiaUtilNoCalendario(cursor, cal)) return cursor;
    cursor.setDate(cursor.getDate() + 1);
  }
  throw new Error("Nenhum dia útil nos próximos 10 anos: verifique expediente e feriados");
}

/**
 * Data de término de uma tarefa que começa em `inicio` e dura `dias`
 * dias úteis.
 *
 * O dia de início conta como o primeiro: tarefa de 1 dia começa e
 * termina no mesmo dia. É a convenção do MS Project e a que o usuário
 * espera ao digitar "8h" numa tarefa.
 *
 * Se `inicio` cair em dia não útil, escorrega para o próximo — não faz
 * sentido uma tarefa começar num domingo que ninguém trabalha.
 */
function somarDiasUteisNoCalendario(inicio: Date, dias: number, cal: Calendario): Date {
  if (dias < 1) throw new Error("Duração em dias úteis deve ser pelo menos 1");

  const cursor = proximoDiaUtilNoCalendario(inicio, cal);
  let restantes = dias - 1;

  for (let i = 0; i < 3650 && restantes > 0; i++) {
    cursor.setDate(cursor.getDate() + 1);
    if (ehDiaUtilNoCalendario(cursor, cal)) restantes--;
  }

  if (restantes > 0) {
    throw new Error("Cálculo de prazo excedeu 10 anos: verifique expediente e feriados");
  }
  return cursor;
}

/** Dias úteis entre duas datas, início e fim inclusive. */
function diasUteisEntreNoCalendario(inicio: Date, fim: Date, cal: Calendario): number {
  const cursor = new Date(inicio);
  cursor.setHours(0, 0, 0, 0);
  const limite = new Date(fim);
  limite.setHours(0, 0, 0, 0);

  let total = 0;
  for (let i = 0; i < 3650 && cursor <= limite; i++) {
    if (ehDiaUtilNoCalendario(cursor, cal)) total++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

export async function ehDiaUtil(d: Date): Promise<boolean> {
  return ehDiaUtilNoCalendario(d, await carregarCalendario());
}

export async function proximoDiaUtil(d: Date): Promise<Date> {
  return proximoDiaUtilNoCalendario(d, await carregarCalendario());
}

export async function somarDiasUteis(inicio: Date, dias: number): Promise<Date> {
  return somarDiasUteisNoCalendario(inicio, dias, await carregarCalendario());
}

export async function diasUteisEntre(inicio: Date, fim: Date): Promise<number> {
  return diasUteisEntreNoCalendario(inicio, fim, await carregarCalendario());
}

/** Exposto para teste: permite exercitar a aritmética sem banco. */
export const _internos = {
  ehDiaUtilNoCalendario,
  proximoDiaUtilNoCalendario,
  somarDiasUteisNoCalendario,
  diasUteisEntreNoCalendario,
};

/**
 * Contador de dias úteis com o calendário já carregado.
 *
 * O `calcularCpm` é síncrono e roda em laço sobre todas as tarefas —
 * não pode esperar uma consulta a cada par de datas. Esta função carrega
 * o calendário uma vez e devolve uma função pura que o usa.
 */
export async function contadorDeDiasUteis(): Promise<(inicio: Date, fim: Date) => number> {
  const cal = await carregarCalendario();
  return (inicio, fim) => diasUteisEntreNoCalendario(inicio, fim, cal);
}

/** Somador de dias úteis com o calendário já carregado. */
export async function somadorDeDiasUteis(): Promise<(inicio: Date, dias: number) => Date> {
  const cal = await carregarCalendario();
  return (inicio, dias) => somarDiasUteisNoCalendario(inicio, dias, cal);
}

/** Empurra para o próximo dia útil, com o calendário já carregado. */
export async function normalizadorDeDiaUtil(): Promise<(d: Date) => Date> {
  const cal = await carregarCalendario();
  return (d) => proximoDiaUtilNoCalendario(d, cal);
}
