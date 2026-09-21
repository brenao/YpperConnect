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
  /**
   * De onde a pessoa trabalha. Nulo herda a localidade padrão.
   *
   * É o que decide quais feriados valem para ela: municipal de Caxias
   * não tira o dia de quem está em São Paulo.
   */
  localidadeId: string | null;
  localidadeNome: string | null;
  /** Jornada diária total. */
  horasDia: number;
  /** % da jornada dedicada a projetos (o resto vai para atendimento). */
  disponibilidadeProjetos: number;
  ativo: boolean;
}

// capacidadeProjeto vive em @/services/resource-utils: a tela de recursos
// precisa dela no navegador, e importar valor deste arquivo levaria o
// client.server.ts (credenciais do banco) para o bundle do cliente.

interface Linha extends Omit<Recurso, "ativo"> {
  ativo: number;
}

const SELECT_BASE = `
  SELECT r.id, r.usuario_id, u.nome AS usuario_nome, r.nome, r.papel,
         r.equipe_id, e.nome AS equipe_nome,
         r.localidade_id, l.nome AS localidade_nome,
         r.horas_dia, r.disponibilidade_projetos, r.ativo
    FROM recursos r
    LEFT JOIN usuarios u ON u.id = r.usuario_id
    LEFT JOIN equipes e ON e.id = r.equipe_id
    LEFT JOIN localidades l ON l.id = r.localidade_id`;

const mapear = (l: Linha): Recurso => ({ ...l, ativo: paraBool(l.ativo) });

/**
 * Quem administra o cadastro de recursos.
 *
 * Antes bastava ter equipe — a mesma regra que dava à TI inteira poder
 * sobre projeto alheio, e que já saiu de `projetos.repo`. Pertencer a
 * uma equipe diz respeito a chamado; capacidade de projeto é outra
 * conversa.
 *
 * A permissão passa a ser a mesma que governa a tela: quem tem
 * `recurso.editar` no perfil, mais o administrador.
 */
const FEATURE_RECURSO_EDITAR = "recurso.editar";

function exigirGestaoRecursos(ctx: ContextoUsuario, acao: string): void {
  if (ctx.admin) return;
  if (ctx.funcionalidades.includes(FEATURE_RECURSO_EDITAR)) return;
  throw new ErroDominio(`Seu perfil não permite ${acao}`);
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

/** Usuário ativo que ainda não é recurso, para a criação em lote. */
export interface UsuarioSemRecurso {
  id: string;
  nome: string;
  email: string;
  departamento: string | null;
  equipeId: string | null;
  equipeNome: string | null;
}

/**
 * Usuários que ainda não têm recurso.
 *
 * Existe para acabar com o cadastro em dois lugares: em vez de
 * redigitar nome e equipe de quem já está no sistema, a tela oferece a
 * lista e cria em lote. Nome, equipe e vínculo vêm do usuário; só a
 * disponibilidade é decisão de quem cadastra.
 */
export async function usuariosSemRecurso(): Promise<UsuarioSemRecurso[]> {
  return consultar<UsuarioSemRecurso>(
    `SELECT u.id, u.nome, u.email, u.departamento,
            u.equipe_id, e.nome AS equipe_nome
       FROM usuarios u
       LEFT JOIN equipes e ON e.id = u.equipe_id
      WHERE u.ativo = 1
        AND NOT EXISTS (SELECT 1 FROM recursos r WHERE r.usuario_id = u.id)
      ORDER BY u.nome`,
  );
}

/** Jornada padrão. Todo mundo tem 8h; a coluna existe para a exceção. */
export const HORAS_DIA_PADRAO = 8;

/** Disponibilidade inicial de quem entra pela criação em lote. */
export const DISPONIBILIDADE_PADRAO = 50;

/**
 * Cria recursos a partir de usuários já cadastrados.
 *
 * Herda nome e equipe do usuário: redigitar o que o sistema já sabe é
 * onde nasce a divergência entre os dois cadastros — a pessoa muda de
 * equipe no AD e o recurso continua na antiga.
 */
export async function criarRecursosDeUsuarios(
  ctx: ContextoUsuario,
  usuarioIds: string[],
  disponibilidadeProjetos = DISPONIBILIDADE_PADRAO,
): Promise<number> {
  exigirGestaoRecursos(ctx, "cadastrar recursos");

  const unicos = [...new Set(usuarioIds)];
  if (unicos.length === 0) return 0;
  if (disponibilidadeProjetos < 0 || disponibilidadeProjetos > 100) {
    throw new ErroDominio("Disponibilidade deve estar entre 0 e 100%");
  }

  const binds: Record<string, unknown> = {
    disponibilidade: disponibilidadeProjetos,
    horasDia: HORAS_DIA_PADRAO,
  };
  const chaves = unicos.map((id, i) => {
    binds[`u${i}`] = id;
    return `:u${i}`;
  });

  // INSERT SELECT com gen_random_uuid(): um comando só, e o
  // NOT EXISTS protege contra clique duplo criando duplicata.
  //
  // A localidade fica nula: herda a padrão. Perguntar de onde cada uma
  // das cinquenta pessoas trabalha antes de cadastrar em lote é o
  // caminho mais curto para ninguém cadastrar nada.
  return executar(
    `INSERT INTO recursos
       (id, usuario_id, nome, papel, equipe_id, horas_dia,
        disponibilidade_projetos, ativo)
     SELECT gen_random_uuid()::text, u.id, u.nome, u.departamento, u.equipe_id,
            :horasDia, :disponibilidade, 1
       FROM usuarios u
      WHERE u.id IN (${chaves.join(",")})
        AND u.ativo = 1
        AND NOT EXISTS (SELECT 1 FROM recursos r WHERE r.usuario_id = u.id)`,
    binds,
  );
}

export interface DadosRecurso {
  nome: string;
  usuarioId?: string | null | undefined;
  papel?: string | null | undefined;
  equipeId?: string | null | undefined;
  /** Nulo herda a localidade padrão da instalação. */
  localidadeId?: string | null | undefined;
  /** Opcional: sem valor, assume a jornada padrão de 8h. */
  horasDia?: number | undefined;
  disponibilidadeProjetos: number;
}

function validar(d: DadosRecurso): void {
  if (d.nome.trim().length < 3) throw new ErroDominio("Informe o nome do recurso");
  const horas = d.horasDia ?? HORAS_DIA_PADRAO;
  if (horas <= 0 || horas > 24) {
    throw new ErroDominio("Jornada deve estar entre 1 e 24 horas");
  }
  if (d.disponibilidadeProjetos < 0 || d.disponibilidadeProjetos > 100) {
    throw new ErroDominio("Disponibilidade deve estar entre 0 e 100%");
  }
}

/**
 * Cadastro avulso. Depois da criação em lote a partir de usuários, este
 * caminho serve ao recurso externo — consultoria, terceiro — que não
 * tem conta e por isso não aparece naquela lista.
 */
export async function criarRecurso(ctx: ContextoUsuario, d: DadosRecurso): Promise<string> {
  exigirGestaoRecursos(ctx, "cadastrar recursos");
  validar(d);

  const id = crypto.randomUUID();
  await executar(
    `INSERT INTO recursos
       (id, usuario_id, nome, papel, equipe_id, localidade_id, horas_dia,
        disponibilidade_projetos, ativo)
     VALUES
       (:id, :usuarioId, :nome, :papel, :equipeId, :localidadeId, :horasDia,
        :disponibilidade, 1)`,
    {
      id,
      usuarioId: d.usuarioId ?? null,
      nome: d.nome.trim(),
      papel: d.papel?.trim() ?? null,
      equipeId: d.equipeId ?? null,
      localidadeId: d.localidadeId ?? null,
      horasDia: d.horasDia ?? HORAS_DIA_PADRAO,
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
  exigirGestaoRecursos(ctx, "alterar recursos");
  validar(d);

  const n = await executar(
    `UPDATE recursos
        SET usuario_id = :usuarioId,
            nome = :nome,
            papel = :papel,
            equipe_id = :equipeId,
            localidade_id = :localidadeId,
            horas_dia = :horasDia,
            disponibilidade_projetos = :disponibilidade
      WHERE id = :id`,
    {
      id,
      usuarioId: d.usuarioId ?? null,
      nome: d.nome.trim(),
      papel: d.papel?.trim() ?? null,
      equipeId: d.equipeId ?? null,
      localidadeId: d.localidadeId ?? null,
      horasDia: d.horasDia ?? HORAS_DIA_PADRAO,
      disponibilidade: d.disponibilidadeProjetos,
    },
  );
  if (n === 0) throw new ErroDominio(`Recurso ${id} não encontrado`);
}

/**
 * Altera só a disponibilidade.
 *
 * É a edição que a tela oferece no dia a dia: nome, equipe e vínculo
 * vêm do usuário, e reescrever a linha inteira para mexer num
 * percentual sobrescreveria o que o cadastro de usuários mantém.
 */
export async function definirDisponibilidade(
  ctx: ContextoUsuario,
  id: string,
  disponibilidadeProjetos: number,
): Promise<void> {
  exigirGestaoRecursos(ctx, "alterar recursos");
  if (disponibilidadeProjetos < 0 || disponibilidadeProjetos > 100) {
    throw new ErroDominio("Disponibilidade deve estar entre 0 e 100%");
  }

  const n = await executar(
    `UPDATE recursos SET disponibilidade_projetos = :disponibilidade WHERE id = :id`,
    { id, disponibilidade: disponibilidadeProjetos },
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
  exigirGestaoRecursos(ctx, "alterar recursos");
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
    // de todo mundo apareceria zerada sem erro nenhum.
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

/**
 * Capacidade diária de projeto dos responsáveis por uma tarefa, em
 * horas.
 *
 * É o que o cronograma precisa saber para converter esforço em dias:
 * quem está 50% em sustentação entrega 4h/dia, e uma tarefa de 8h ocupa
 * dois dias, não um. Sem isto o plano promete o dobro da velocidade real
 * — e o erro só aparece quando a entrega atrasa.
 *
 * Com mais de um responsável vale o MENOR: quem tem menos tempo é quem
 * determina o ritmo. Usar a média faria a tarefa terminar numa data que
 * o mais ocupado não alcança.
 *
 * Devolve `null` quando a tarefa não tem responsável — aí não há
 * capacidade a considerar e o cálculo cai na jornada padrão.
 */
export async function capacidadeDiariaDaTarefa(tarefaId: string): Promise<number | null> {
  const r = await consultarUm<{ horas: number | null }>(
    `SELECT MIN(r.horas_dia * r.disponibilidade_projetos::numeric / 100) AS horas
       FROM tarefa_responsaveis tr
       JOIN recursos r ON r.id = tr.recurso_id
      WHERE tr.tarefa_id = :id AND r.ativo = 1`,
    { id: tarefaId },
  );
  const horas = r?.horas ?? null;
  // Disponibilidade zerada não é capacidade: seria divisão por zero no
  // cálculo de duração, e a tarefa nunca terminaria.
  return horas !== null && horas > 0 ? Number(horas) : null;
}

// --------------------------------------------------------- ausências

export type TipoAusencia =
  "ferias" | "licenca_medica" | "licenca" | "treinamento" | "folga" | "outro";

// AUSENCIA_LABEL vive em @/services/resource-utils, pelo mesmo motivo de
// capacidadeProjeto: o mapa de disponibilidade usa no navegador.

export interface Ausencia {
  id: string;
  recursoId: string;
  recursoNome: string;
  tipo: TipoAusencia;
  inicio: Date;
  fim: Date;
  observacao: string | null;
  criadoPorNome: string | null;
  criadoEm: Date;
}

const SELECT_AUSENCIA = `
  SELECT a.id, a.recurso_id, r.nome AS recurso_nome, a.tipo,
         a.inicio, a.fim, a.observacao,
         u.nome AS criado_por_nome, a.criado_em
    FROM recurso_ausencias a
    JOIN recursos r ON r.id = a.recurso_id
    LEFT JOIN usuarios u ON u.id = a.criado_por_id`;

/**
 * Ausências que tocam um período.
 *
 * O filtro é de sobreposição, não de contenção: férias que começaram
 * mês passado e terminam semana que vem interessam a quem está olhando
 * esta semana. `a.inicio <= :ate AND a.fim >= :de` é o teste clássico, e
 * pega os quatro casos (começa antes, termina depois, contida, contém).
 */
export async function listarAusencias(filtro: {
  recursoId?: string | null | undefined;
  de?: Date | null | undefined;
  ate?: Date | null | undefined;
}): Promise<Ausencia[]> {
  return consultar<Ausencia>(
    `${SELECT_AUSENCIA}
      WHERE (CAST(:recursoId AS varchar) IS NULL
             OR a.recurso_id = CAST(:recursoId AS varchar))
        AND (CAST(:de AS date) IS NULL OR a.fim >= CAST(:de AS date))
        AND (CAST(:ate AS date) IS NULL OR a.inicio <= CAST(:ate AS date))
      ORDER BY a.inicio DESC, r.nome`,
    {
      recursoId: filtro.recursoId ?? null,
      de: filtro.de ?? null,
      ate: filtro.ate ?? null,
    },
  );
}

export interface DadosAusencia {
  recursoId: string;
  tipo: TipoAusencia;
  inicio: Date;
  fim: Date;
  observacao?: string | null | undefined;
}

/**
 * Registra uma ausência.
 *
 * Sem aprovação e sem saldo de dias: quem decide férias é o RH, em
 * outro sistema. O que importa aqui é o cronograma saber que a pessoa
 * não vai trabalhar naquele período.
 *
 * Períodos sobrepostos do mesmo recurso são recusados. Não é
 * preciosismo: duas linhas cobrindo o mesmo dia não mudam o cálculo,
 * mas fazem o mapa de disponibilidade contar o dobro de dias de férias
 * e ninguém entende de onde saiu o número.
 */
export async function criarAusencia(ctx: ContextoUsuario, d: DadosAusencia): Promise<string> {
  exigirGestaoRecursos(ctx, "registrar ausências");

  if (d.fim < d.inicio) throw new ErroDominio("Data final anterior à inicial");

  const conflito = await consultarUm<{ id: string; inicio: Date; fim: Date }>(
    `SELECT id, inicio, fim
       FROM recurso_ausencias
      WHERE recurso_id = :recursoId
        AND inicio <= :fim
        AND fim >= :inicio
      LIMIT 1`,
    { recursoId: d.recursoId, inicio: d.inicio, fim: d.fim },
  );
  if (conflito) {
    throw new ErroDominio(
      "Já existe uma ausência deste recurso no período. Edite a existente em vez de criar outra.",
    );
  }

  const id = crypto.randomUUID();
  await executar(
    `INSERT INTO recurso_ausencias
       (id, recurso_id, tipo, inicio, fim, observacao, criado_por_id,
        criado_em, atualizado_em)
     VALUES
       (:id, :recursoId, :tipo, :inicio, :fim, :observacao, :criadoPor,
        LOCALTIMESTAMP, LOCALTIMESTAMP)`,
    {
      id,
      recursoId: d.recursoId,
      tipo: d.tipo,
      inicio: d.inicio,
      fim: d.fim,
      observacao: d.observacao?.trim() ?? null,
      criadoPor: ctx.id,
    },
  );
  return id;
}

export async function atualizarAusencia(
  ctx: ContextoUsuario,
  id: string,
  d: Omit<DadosAusencia, "recursoId">,
): Promise<void> {
  exigirGestaoRecursos(ctx, "alterar ausências");
  if (d.fim < d.inicio) throw new ErroDominio("Data final anterior à inicial");

  const n = await executar(
    `UPDATE recurso_ausencias
        SET tipo = :tipo,
            inicio = :inicio,
            fim = :fim,
            observacao = :observacao,
            atualizado_em = LOCALTIMESTAMP
      WHERE id = :id`,
    {
      id,
      tipo: d.tipo,
      inicio: d.inicio,
      fim: d.fim,
      observacao: d.observacao?.trim() ?? null,
    },
  );
  if (n === 0) throw new ErroDominio(`Ausência ${id} não encontrada`);
}

/**
 * Apaga de verdade, diferente do resto do sistema.
 *
 * Ausência não é histórico de trabalho: é uma previsão de quem não
 * estará. Férias canceladas que continuassem no banco como "inativas"
 * seguiriam empurrando o cronograma ou exigiriam um filtro em toda
 * consulta — e o custo de errar é alguém aparecer como ausente no dia
 * em que está trabalhando.
 */
export async function excluirAusencia(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirGestaoRecursos(ctx, "excluir ausências");
  const n = await executar(`DELETE FROM recurso_ausencias WHERE id = :id`, { id });
  if (n === 0) throw new ErroDominio(`Ausência ${id} não encontrada`);
}

// ------------------------------------------- calendário do cronograma

/** Um responsável de tarefa, com a localidade que define o calendário dele. */
export interface ResponsavelDeTarefa {
  tarefaId: string;
  recursoId: string;
  localidadeId: string | null;
}

/**
 * Responsáveis de todas as tarefas de um projeto, numa consulta.
 *
 * O reagendamento precisa saber, por tarefa, quais calendários se
 * aplicam. Perguntar por tarefa transformaria a passada topológica numa
 * enxurrada de consultas — o mesmo motivo que fez `capacidadesDoProjeto`
 * nascer em lote.
 */
export async function responsaveisDoProjeto(projetoId: string): Promise<ResponsavelDeTarefa[]> {
  return consultar<ResponsavelDeTarefa>(
    `SELECT tr.tarefa_id, tr.recurso_id, r.localidade_id
       FROM tarefa_responsaveis tr
       JOIN projeto_tarefas t ON t.id = tr.tarefa_id
       JOIN recursos r ON r.id = tr.recurso_id AND r.ativo = 1
      WHERE t.projeto_id = :projetoId AND t.ativo = 1`,
    { projetoId },
  );
}

export interface PeriodoAusencia {
  recursoId: string;
  inicio: Date;
  fim: Date;
}

/**
 * Ausências dos recursos de um projeto, numa consulta.
 *
 * Sem recorte de período: o cronograma pode ser reagendado para
 * qualquer data futura, e filtrar por uma janela que o próprio cálculo
 * ainda vai descobrir é a receita para uma férias escapar justamente no
 * caso em que a tarefa escorregou para cima dela.
 *
 * O volume é pequeno — ausências de algumas dezenas de pessoas —, então
 * trazer tudo e expandir em memória custa menos que acertar a janela.
 */
export async function ausenciasDoProjeto(projetoId: string): Promise<PeriodoAusencia[]> {
  return consultar<PeriodoAusencia>(
    `SELECT DISTINCT a.recurso_id, a.inicio, a.fim
       FROM recurso_ausencias a
      WHERE EXISTS (SELECT 1
                      FROM tarefa_responsaveis tr
                      JOIN projeto_tarefas t ON t.id = tr.tarefa_id
                     WHERE tr.recurso_id = a.recurso_id
                       AND t.projeto_id = :projetoId
                       AND t.ativo = 1)
      ORDER BY a.inicio`,
    { projetoId },
  );
}
