import { db, linhas } from "./client.server";

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
    linhas(
      await db
        .from("expediente")
        .select("dia_semana, minuto_ini, minuto_fim")
        .eq("ativo", true)
        .order("dia_semana")
        .order("minuto_ini"),
    ),
    linhas(await db.from("feriados").select("data_feriado, recorrente").eq("ativo", true)),
  ]);

  const faixasPorDia = new Map<number, Faixa[]>();
  for (const e of expediente) {
    const lista = faixasPorDia.get(e.dia_semana) ?? [];
    lista.push({ ini: e.minuto_ini, fim: e.minuto_fim });
    faixasPorDia.set(e.dia_semana, lista);
  }

  const recorrentes = new Set<string>();
  const especificos = new Set<string>();
  for (const f of feriados) {
    // Coluna DATE volta como 'yyyy-mm-dd'; montar a data no fuso local
    // evita o feriado "andar" um dia por causa de UTC.
    const [ano, mes, dia] = f.data_feriado.slice(0, 10).split("-").map(Number);
    const d = new Date(ano ?? 1970, (mes ?? 1) - 1, dia ?? 1);
    if (f.recorrente) recorrentes.add(chaveMesDia(d));
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
