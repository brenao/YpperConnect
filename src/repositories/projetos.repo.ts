import {
  consultar,
  consultarUm,
  executar,
  emTransacao,
} from "@/integrations/postgres/client.server";
import { ErroDominio, deBool, paraBool } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";
import type { ProjectStatus } from "@/models/itsm-types";

/**
 * Portfólio de projetos: cronograma, WBS, riscos e acompanhamento.
 *
 * A WBS é auto-referenciada por `pai_id`. Predecessoras e responsáveis
 * vivem em tabelas de junção porque no localStorage eram arrays — e
 * array não sobrevive a banco relacional sem virar linha.
 */

/**
 * O status vem de `itsm-types` e é reexportado aqui.
 *
 * Já esteve declarado nos dois lugares, e a cópia daqui ficava para
 * trás a cada valor novo — o `backlog` quebrou o build três vezes por
 * causa disso. Uma fonte só, reexportada para quem já importava do
 * repositório não precisar mudar.
 */
export type { ProjectStatus };

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
  /**
   * Cronograma em dias úteis (padrão) ou dias corridos.
   *
   * A exceção existe para projeto com gente trabalhando fim de semana —
   * virada de sistema, parada de fábrica. Fora disso, contar sábado e
   * domingo como dia de trabalho produz prazo que ninguém cumpre.
   */
  usaDiasUteis: boolean;
  /** Origem e priorização: preenchidos no backlog, mantidos depois. */
  areaDemandante: string | null;
  justificativa: string | null;
  valor: number | null;
  esforco: number | null;
  alcance: number | null;
  confianca: number | null;
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
         p.status, p.inicio, p.fim,
         (p.usa_dias_uteis = 1) AS usa_dias_uteis,
         p.area_demandante, p.justificativa,
         p.valor, p.esforco, p.alcance, p.confianca,
         p.criado_em, p.atualizado_em
    FROM projetos p
    LEFT JOIN usuarios us ON us.id = p.sponsor_id
    LEFT JOIN usuarios ug ON ug.id = p.gerente_id`;

function novoId(): string {
  return crypto.randomUUID();
}

/**
 * Quem executa o projeto: gerente, patrocinador ou quem tem tarefa
 * atribuída nele.
 *
 * É a única porta de escrita. Diretoria e gestor de portfólio ficam de
 * fora de propósito — eles acompanham a carteira, e plano editado por
 * quem não executa é plano que o time não reconhece.
 *
 * O vínculo por tarefa passa por `recursos`, porque responsável de
 * tarefa é recurso, não usuário: `recursos.usuario_id` é o que liga os
 * dois, e recurso de terceiro sem conta simplesmente não casa.
 */
const SQL_EXECUTA_PROJETO = `
  p.gerente_id = :usuarioId
  OR p.sponsor_id = :usuarioId
  OR EXISTS (SELECT 1
               FROM projeto_tarefas t
               JOIN tarefa_responsaveis tr ON tr.tarefa_id = t.id
               JOIN recursos r ON r.id = tr.recurso_id
              WHERE t.projeto_id = p.id AND t.ativo = 1 AND r.usuario_id = :usuarioId)`;

/**
 * Projetos do time do gestor de portfólio.
 *
 * "Do time" é qualquer projeto em que alguém da equipe apareça: como
 * gerente, como patrocinador ou executando tarefa. Olhar só o gerente
 * deixaria de fora o projeto de outra área em que a equipe inteira está
 * alocada — que é exatamente o que o gestor precisa acompanhar.
 */
const SQL_TIME_DO_GESTOR = `
  EXISTS (SELECT 1 FROM usuarios ue
           WHERE ue.equipe_id = :equipeId
             AND (ue.id = p.gerente_id OR ue.id = p.sponsor_id))
  OR EXISTS (SELECT 1
               FROM projeto_tarefas te
               JOIN tarefa_responsaveis tre ON tre.tarefa_id = te.id
               JOIN recursos re ON re.id = tre.recurso_id
               JOIN usuarios ur ON ur.id = re.usuario_id
              WHERE te.projeto_id = p.id AND te.ativo = 1 AND ur.equipe_id = :equipeId)`;

export interface FiltroVisibilidade {
  /** Predicado SQL sobre o alias `p` de `projetos`. */
  clausula: string;
  binds: Record<string, unknown>;
}

/**
 * O que este usuário pode enxergar do portfólio.
 *
 * Antes a leitura era aberta: todo mundo via todos os projetos. Ficou
 * assim porque o módulo nasceu aberto à empresa inteira, mas isso
 * significava que qualquer pessoa lia o cronograma e os pontos de
 * atenção de qualquer área.
 *
 * A restrição por equipe de TI que existia na escrita foi removida:
 * pertencer à TI diz respeito a chamado, não a projeto. Um analista de
 * infraestrutura não tem por que editar o cronograma de um projeto do
 * comercial só por estar numa equipe.
 */
export function filtroVisibilidadeProjetos(ctx: ContextoUsuario): FiltroVisibilidade {
  if (ctx.admin || ctx.visaoDiretoriaProjetos) {
    return { clausula: "TRUE", binds: {} };
  }

  const partes = [SQL_EXECUTA_PROJETO];
  const binds: Record<string, unknown> = { usuarioId: ctx.id };

  // Gestor sem equipe cadastrada cai na visão de colaborador. É cadastro
  // incompleto, não restrição intencional — e devolver o portfólio
  // inteiro nesse caso seria pior do que devolver de menos.
  if (ctx.gestorPortfolio && ctx.equipeId !== null) {
    partes.push(SQL_TIME_DO_GESTOR);
    binds["equipeId"] = ctx.equipeId;
  }

  return { clausula: partes.join("\n  OR "), binds };
}

/** Recusa leitura de projeto fora do alcance do usuário. */
async function exigirLeituraProjeto(ctx: ContextoUsuario, projetoId: string): Promise<void> {
  const f = filtroVisibilidadeProjetos(ctx);
  if (f.clausula === "TRUE") return;

  const p = await consultarUm<{ id: string }>(
    `SELECT p.id FROM projetos p WHERE p.id = :projetoId AND (${f.clausula})`,
    { ...f.binds, projetoId },
  );
  // Mesma mensagem de inexistente: dizer "sem permissão" confirmaria a
  // existência de um projeto que a pessoa não deveria nem saber que há.
  if (!p) throw new ErroDominio(`Projeto ${projetoId} não encontrado`);
}

/**
 * Quem pode mexer neste projeto.
 *
 * Projeto é o único módulo aberto a toda a empresa: qualquer pessoa
 * cadastra o seu. Como consequência, ela precisa conseguir montar o
 * cronograma dele — liberar a criação e travar as tarefas produziria um
 * projeto que ninguém consegue tocar.
 *
 * Escrita é de quem executa: gerente, patrocinador e responsáveis por
 * tarefa. Admin entra porque precisa destravar cadastro errado. Papéis
 * de acompanhamento — diretoria e portfólio — são leitura e ficam de
 * fora, mesmo enxergando o projeto na lista.
 */
async function exigirAcessoProjeto(
  ctx: ContextoUsuario,
  projetoId: string,
  acao: string,
): Promise<void> {
  if (ctx.admin) return;

  const p = await consultarUm<{ id: string; executa: boolean }>(
    `SELECT p.id, (${SQL_EXECUTA_PROJETO}) AS executa
       FROM projetos p WHERE p.id = :projetoId`,
    { projetoId, usuarioId: ctx.id },
  );
  if (!p) throw new ErroDominio(`Projeto ${projetoId} não encontrado`);

  if (!p.executa) {
    throw new ErroDominio(
      `Somente o gerente, o patrocinador ou os responsáveis pelas tarefas podem ${acao}`,
    );
  }
}

/** Mesma regra, quando só se tem a tarefa em mãos. */
async function exigirAcessoTarefa(
  ctx: ContextoUsuario,
  tarefaId: string,
  acao: string,
): Promise<void> {
  if (ctx.admin) return;

  const t = await consultarUm<{ projetoId: string }>(
    `SELECT projeto_id FROM projeto_tarefas WHERE id = :id`,
    { id: tarefaId },
  );
  if (!t) throw new ErroDominio(`Tarefa ${tarefaId} não encontrada`);
  await exigirAcessoProjeto(ctx, t.projetoId, acao);
}

/**
 * Mesma regra para os registros satélites (risco, atenção,
 * acompanhamento), que só sabem o próprio id.
 *
 * A tabela entra como literal montado aqui dentro, nunca vindo do
 * chamador externo: interpolar nome de tabela é o único jeito de
 * reaproveitar a consulta, e o valor precisa ser controlado.
 */
async function exigirAcessoRegistro(
  ctx: ContextoUsuario,
  tabela: "projeto_riscos" | "projeto_atencoes" | "projeto_atualizacoes",
  id: string,
  acao: string,
  rotulo: string,
): Promise<string> {
  const r = await consultarUm<{ projetoId: string }>(
    `SELECT projeto_id FROM ${tabela} WHERE id = :id`,
    { id },
  );
  if (!r) throw new ErroDominio(`${rotulo} ${id} não encontrado`);
  await exigirAcessoProjeto(ctx, r.projetoId, acao);
  return r.projetoId;
}

// ---------------------------------------------------------------- leitura

/**
 * Lista com progresso agregado, restrita ao que o usuário enxerga.
 *
 * O progresso vem da média das tarefas, calculada em SQL: carregar todas
 * as tarefas de todos os projetos para somar no cliente não escala.
 * Projeto sem tarefa fica com 0, não com "indefinido".
 *
 * O filtro entra no WHERE e não numa passada em memória: trazer o
 * portfólio inteiro para descartar depois vaza os nomes dos projetos
 * pela rede e desperdiça o trabalho dos agregados.
 *
 * Quem está no backlog fica de fora: aparece na tela própria, com a
 * ordem e a pontuação que só fazem sentido lá. Misturar os dois faria a
 * contagem de projetos crescer com o que ainda não foi decidido.
 *
 * A ordem é a da atenção que cada situação merece, não a alfabética:
 * em execução primeiro, encerrados por último. Ordenar pelo texto do
 * status colocava "cancelado" no topo, que é o oposto do que interessa
 * a quem abre a tela.
 */
export async function listarProjetos(ctx: ContextoUsuario): Promise<ProjetoComProgresso[]> {
  const f = filtroVisibilidadeProjetos(ctx);

  return consultar<ProjetoComProgresso>(
    `SELECT p.id, p.nome, p.objetivo,
            p.sponsor_id, us.nome AS sponsor_nome,
            p.gerente_id, ug.nome AS gerente_nome,
            p.status, p.inicio, p.fim,
            (p.usa_dias_uteis = 1) AS usa_dias_uteis,
            p.area_demandante, p.justificativa,
            p.valor, p.esforco, p.alcance, p.confianca,
            p.criado_em, p.atualizado_em,
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
      WHERE p.status <> 'backlog' AND (${f.clausula})
      ORDER BY CASE p.status
                 WHEN 'execucao' THEN 1
                 WHEN 'planejamento' THEN 2
                 WHEN 'paralisado' THEN 3
                 WHEN 'concluido' THEN 4
                 WHEN 'cancelado' THEN 5
                 ELSE 6
               END,
               p.fim`,
    f.binds,
  );
}

/**
 * Detalhe do projeto, se o usuário puder vê-lo.
 *
 * A checagem é aqui e não só na tela: a rota do projeto é uma URL, e
 * quem tiver o id de um projeto alheio poderia abri-lo à mão.
 */
export async function buscarProjeto(ctx: ContextoUsuario, id: string): Promise<Projeto | null> {
  await exigirLeituraProjeto(ctx, id);
  return consultarUm<Projeto>(`${SELECT_PROJETO} WHERE p.id = :id`, { id });
}

/**
 * Diz se o usuário pode editar este projeto, para a tela decidir o que
 * mostrar.
 *
 * A tela precisa saber antes de renderizar: diretoria e portfólio
 * enxergam o projeto, então sem isto veriam campos editáveis que o
 * servidor recusaria depois — pior experiência do que não ver o botão.
 */
export async function podeEditarProjeto(ctx: ContextoUsuario, projetoId: string): Promise<boolean> {
  if (ctx.admin) return true;

  const p = await consultarUm<{ executa: boolean }>(
    `SELECT (${SQL_EXECUTA_PROJETO}) AS executa FROM projetos p WHERE p.id = :projetoId`,
    { projetoId, usuarioId: ctx.id },
  );
  return p?.executa ?? false;
}

/** Linha crua da tarefa: `marco` é SMALLINT 0/1 no schema. */
interface LinhaTarefaBruta extends Omit<Tarefa, "marco"> {
  marco: number;
}

export async function listarTarefas(projetoId: string): Promise<Tarefa[]> {
  const linhas = await consultar<LinhaTarefaBruta>(
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

/**
 * Filtro do histórico de acompanhamento.
 *
 * O acompanhamento é semanal e não para de crescer: em um ano são
 * cinquenta registros por projeto, e mostrar tudo de uma vez transforma
 * a aba num paredão. A busca vai para o SQL, não para o cliente —
 * filtrar em memória só adia o problema até o volume dobrar.
 */
export interface FiltroAtualizacoes {
  /** Texto livre em descrição e entregas. */
  busca?: string | null | undefined;
  /** Recorte por período, para "o que foi dito no trimestre". */
  de?: Date | null | undefined;
  ate?: Date | null | undefined;
  /** Teto de linhas devolvidas. */
  limite?: number | undefined;
}

export async function listarAtualizacoes(
  projetoId: string,
  filtro: FiltroAtualizacoes = {},
): Promise<Atualizacao[]> {
  // ILIKE com % nas duas pontas não usa índice, mas o universo aqui é o
  // histórico de um projeto — algumas dezenas de linhas, não a tabela
  // inteira.
  const busca = filtro.busca?.trim();
  const temBusca = busca !== undefined && busca.length > 0;

  // Os filtros opcionais levam tipo explícito: um parâmetro que só
  // aparece dentro de `IS NULL` não tem coluna ao lado de onde o
  // Postgres possa inferir o tipo, e a consulta falha ao preparar com
  // "could not determine data type of parameter".
  //
  // CAST(...) em vez de `::` porque a camada de binds nomeados varre a
  // string atrás de `:nome`, e `:de::timestamp` a faria enxergar um
  // segundo bind chamado `timestamp`.
  return consultar<Atualizacao>(
    `SELECT a.id, a.projeto_id, a.autor_id, u.nome AS autor_nome, a.data_ref,
            a.descricao, a.ultimas_entregas, a.proximas_entregas, a.criado_em
       FROM projeto_atualizacoes a
       LEFT JOIN usuarios u ON u.id = a.autor_id
      WHERE a.projeto_id = :projetoId
        AND (CAST(:busca AS text) IS NULL
             OR a.descricao ILIKE CAST(:curinga AS text)
             OR a.ultimas_entregas ILIKE CAST(:curinga AS text)
             OR a.proximas_entregas ILIKE CAST(:curinga AS text)
             OR u.nome ILIKE CAST(:curinga AS text))
        AND (CAST(:de AS timestamp) IS NULL OR a.data_ref >= CAST(:de AS timestamp))
        AND (CAST(:ate AS timestamp) IS NULL OR a.data_ref <= CAST(:ate AS timestamp))
      ORDER BY a.data_ref DESC
      LIMIT CAST(:limite AS integer)`,
    {
      projetoId,
      busca: temBusca ? busca : null,
      curinga: temBusca ? `%${busca}%` : "%",
      de: filtro.de ?? null,
      ate: filtro.ate ?? null,
      limite: filtro.limite ?? 200,
    },
  );
}

/** Quantas atualizações existem ao todo, para a tela saber se truncou. */
export async function contarAtualizacoes(projetoId: string): Promise<number> {
  const r = await consultarUm<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM projeto_atualizacoes WHERE projeto_id = :projetoId`,
    { projetoId },
  );
  return r?.total ?? 0;
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

/**
 * Um projeto é o mesmo registro esteja ele no backlog ou em execução.
 *
 * Os campos são os mesmos nos dois estados de propósito: quem registra
 * uma ideia e quem abre um projeto preenchem a mesma coisa, e dois
 * formulários diferentes fariam a promoção perder dado ou pedir de novo
 * o que já tinha sido informado.
 *
 * A priorização é opcional em qualquer estado — projeto já aprovado não
 * precisa de score, e demanda recém-registrada ainda não tem.
 */
export interface DadosProjeto {
  nome: string;
  objetivo?: string | null | undefined;
  sponsorId?: string | null | undefined;
  gerenteId?: string | null | undefined;
  status?: ProjectStatus | undefined;
  usaDiasUteis?: boolean | undefined;
  areaDemandante?: string | null | undefined;
  justificativa?: string | null | undefined;
  valor?: number | null | undefined;
  esforco?: number | null | undefined;
  alcance?: number | null | undefined;
  confianca?: number | null | undefined;
}

function validarProjeto(d: DadosProjeto): void {
  if (d.nome.trim().length < 3) throw new ErroDominio("Informe o nome do projeto");
}

/**
 * Recalcula o período do projeto a partir das tarefas.
 *
 * O prazo do projeto não é digitado: ele É o intervalo do cronograma.
 * Deixar os dois campos editáveis criava a contradição de um projeto
 * que termina em março com tarefa entregando em maio — e nenhum dos
 * dois números estava errado, só discordavam.
 *
 * Projeto sem tarefa fica com o dia de hoje nas duas pontas: as
 * colunas são NOT NULL e a primeira tarefa corrige na hora.
 */
async function recalcularPeriodo(projetoId: string): Promise<void> {
  await executar(
    `UPDATE projetos p
        SET inicio = COALESCE(t.ini, CURRENT_DATE),
            fim = COALESCE(t.fim, CURRENT_DATE),
            atualizado_em = LOCALTIMESTAMP
       FROM (SELECT MIN(inicio) AS ini, MAX(fim) AS fim
               FROM projeto_tarefas
              WHERE projeto_id = :projetoId AND ativo = 1) t
      WHERE p.id = :projetoId`,
    { projetoId },
  );
}

/**
 * Propaga o cronograma e depois fecha o período do projeto, nesta
 * ordem.
 *
 * A ordem importa: `recalcularPeriodo` lê MIN/MAX das tarefas, e rodar
 * antes do reagendamento gravaria o período das datas velhas — que é
 * exatamente o sintoma de "mudei a tarefa e o cabeçalho não acompanhou".
 *
 * Toda mutação de cronograma passa por aqui. Deixar a propagação a cargo
 * de quem edita significa que uma rota nova esquece de chamar e as
 * sucessoras param de andar sem ninguém perceber.
 */
async function propagarCronograma(projetoId: string): Promise<void> {
  await reagendarProjeto(projetoId);
  await recalcularPeriodo(projetoId);
}

/** Mesma coisa, quando só se tem a tarefa em mãos. */
async function propagarCronogramaDaTarefa(tarefaId: string): Promise<void> {
  const t = await consultarUm<{ projetoId: string }>(
    `SELECT projeto_id FROM projeto_tarefas WHERE id = :id`,
    { id: tarefaId },
  );
  if (t) await propagarCronograma(t.projetoId);
}

/**
 * Cria projeto. Aberto a qualquer usuário ativo, por regra de negócio:
 * a gestão de projetos não é privilégio da TI.
 */
export async function criarProjeto(ctx: ContextoUsuario, d: DadosProjeto): Promise<string> {
  validarProjeto(d);

  const id = novoId();
  const status = d.status ?? "planejamento";

  // Nasce no fim da fila quando entra pelo backlog. A posição é
  // calculada no próprio INSERT para não abrir uma janela em que duas
  // criações simultâneas leiam o mesmo máximo.
  await executar(
    `INSERT INTO projetos
       (id, nome, objetivo, sponsor_id, gerente_id, status, inicio, fim,
        usa_dias_uteis, area_demandante, justificativa,
        valor, esforco, alcance, confianca, ordem_backlog,
        criado_em, atualizado_em)
     VALUES
       (:id, :nome, :objetivo, :sponsorId, :gerenteId, :status,
        CURRENT_DATE, CURRENT_DATE, :usaDiasUteis, :area, :justificativa,
        :valor, :esforco, :alcance, :confianca,
        CASE WHEN :status = 'backlog'
             THEN (SELECT COALESCE(MAX(ordem_backlog), 0) + 1
                     FROM projetos WHERE status = 'backlog')
             ELSE NULL END,
        LOCALTIMESTAMP, LOCALTIMESTAMP)`,
    {
      id,
      nome: d.nome.trim(),
      objetivo: d.objetivo?.trim() ?? null,
      sponsorId: d.sponsorId ?? null,
      // Sem gerente informado, assume quem criou: projeto órfão não tem
      // quem responda por ele na visão de diretoria.
      gerenteId: d.gerenteId ?? ctx.id,
      status,
      usaDiasUteis: deBool(d.usaDiasUteis ?? true),
      area: d.areaDemandante?.trim() ?? null,
      justificativa: d.justificativa?.trim() ?? null,
      valor: d.valor ?? null,
      esforco: d.esforco ?? null,
      alcance: d.alcance ?? null,
      confianca: d.confianca ?? null,
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
            usa_dias_uteis = COALESCE(:usaDiasUteis, usa_dias_uteis),
            area_demandante = :area, justificativa = :justificativa,
            valor = :valor, esforco = :esforco,
            alcance = :alcance, confianca = :confianca,
            atualizado_em = LOCALTIMESTAMP
      WHERE id = :id`,
    {
      id,
      nome: d.nome.trim(),
      objetivo: d.objetivo?.trim() ?? null,
      sponsorId: d.sponsorId ?? null,
      gerenteId: d.gerenteId ?? null,
      status: d.status ?? null,
      usaDiasUteis: d.usaDiasUteis === undefined ? null : deBool(d.usaDiasUteis),
      area: d.areaDemandante?.trim() ?? null,
      justificativa: d.justificativa?.trim() ?? null,
      valor: d.valor ?? null,
      esforco: d.esforco ?? null,
      alcance: d.alcance ?? null,
      confianca: d.confianca ?? null,
    },
  );
  if (n === 0) throw new ErroDominio(`Projeto ${id} não encontrado`);

  // Trocar o regime de dias muda a aritmética do cronograma inteiro: as
  // mesmas durações passam a cair em datas diferentes.
  if (d.usaDiasUteis !== undefined) await propagarCronograma(id);
}

/**
 * O que impede um projeto de ser apagado.
 *
 * Vazio é vazio: sem tarefa, risco, ponto de atenção, acompanhamento ou
 * baseline. Qualquer um desses é trabalho de alguém, e apagá-lo junto
 * seria destruir registro sem aviso.
 *
 * A tarefa entra mesmo desativada. `ativo = 0` significa que ela saiu do
 * cronograma, não que nunca existiu — e a baseline pode estar apontando
 * para ela.
 */
export interface ImpedimentosExclusao {
  tarefas: number;
  riscos: number;
  atencoes: number;
  atualizacoes: number;
  baselines: number;
}

export async function impedimentosDeExclusao(
  ctx: ContextoUsuario,
  projetoId: string,
): Promise<ImpedimentosExclusao> {
  await exigirLeituraProjeto(ctx, projetoId);

  const r = await consultarUm<ImpedimentosExclusao>(
    `SELECT (SELECT COUNT(*) FROM projeto_tarefas WHERE projeto_id = :id)::int AS tarefas,
            (SELECT COUNT(*) FROM projeto_riscos WHERE projeto_id = :id)::int AS riscos,
            (SELECT COUNT(*) FROM projeto_atencoes WHERE projeto_id = :id)::int AS atencoes,
            (SELECT COUNT(*) FROM projeto_atualizacoes WHERE projeto_id = :id)::int AS atualizacoes,
            (SELECT COUNT(*) FROM projeto_baselines WHERE projeto_id = :id)::int AS baselines`,
    { id: projetoId },
  );

  return r ?? { tarefas: 0, riscos: 0, atencoes: 0, atualizacoes: 0, baselines: 0 };
}

/**
 * Apaga o projeto, e só enquanto ele estiver vazio.
 *
 * Existe para o cadastro errado — nome trocado, duplicado por clique
 * duplo, projeto que nasceu por engano. É a janela em que ninguém
 * perdeu nada ao apagar.
 *
 * Assim que houver tarefa, risco, decisão ou acompanhamento, o caminho
 * passa a ser cancelar: aquilo é registro do que aconteceu, e um
 * projeto que sumiu do banco deixa quem procura sem resposta. Foi por
 * isso que `excluirTarefa` também nunca apagou de verdade.
 *
 * O DELETE é real, não desativação. Projeto vazio não tem histórico a
 * preservar, e mantê-lo como "inativo" só encheria a lista de fantasmas
 * que ninguém sabe por que estão ali.
 */
export async function excluirProjeto(ctx: ContextoUsuario, id: string): Promise<void> {
  await exigirAcessoProjeto(ctx, id, "excluir este projeto");

  const imp = await impedimentosDeExclusao(ctx, id);
  const total = imp.tarefas + imp.riscos + imp.atencoes + imp.atualizacoes + imp.baselines;

  if (total > 0) {
    // A mensagem diz o que impede, não só que impediu: sem isso a pessoa
    // fica procurando o que apagar sem saber onde.
    const partes = [
      imp.tarefas ? `${imp.tarefas} tarefa(s)` : "",
      imp.riscos ? `${imp.riscos} risco(s)` : "",
      imp.atencoes ? `${imp.atencoes} ponto(s) de atenção` : "",
      imp.atualizacoes ? `${imp.atualizacoes} acompanhamento(s)` : "",
      imp.baselines ? `${imp.baselines} baseline(s)` : "",
    ].filter(Boolean);

    throw new ErroDominio(
      `Este projeto já tem ${partes.join(", ")}. Projeto com histórico não é apagado: ` +
        `mude a situação para Cancelado.`,
    );
  }

  const n = await executar(`DELETE FROM projetos WHERE id = :id`, { id });
  if (n === 0) throw new ErroDominio(`Projeto ${id} não encontrado`);
}

/**
 * Muda só a situação do projeto.
 *
 * A situação é o campo que mais muda depois que o projeto existe —
 * entrou em execução, paralisou, encerrou —, e obrigar a abrir o
 * formulário inteiro para trocar um seletor fazia com que ninguém
 * mantivesse o status em dia. Sem status confiável, o semáforo do
 * portfólio mente.
 *
 * Voltar para `backlog` não passa por aqui: tem regra própria em
 * `devolverAoBacklog`, que recusa projeto com cronograma e recalcula a
 * posição na fila.
 */
export async function definirStatusProjeto(
  ctx: ContextoUsuario,
  id: string,
  status: ProjectStatus,
): Promise<void> {
  await exigirAcessoProjeto(ctx, id, "alterar a situação deste projeto");

  if (status === "backlog") {
    throw new ErroDominio(
      "Para devolver ao backlog, use a ação própria: ela recoloca o projeto na fila de priorização.",
    );
  }

  const n = await executar(
    `UPDATE projetos SET status = :status, atualizado_em = LOCALTIMESTAMP WHERE id = :id`,
    { id, status },
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

  await propagarCronograma(d.projetoId);
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

  await propagarCronogramaDaTarefa(id);
}

/**
 * Move a tarefa no kanban. Atalho para o arrastar-e-soltar.
 *
 * Entrar em "doing" leva o progresso a 10%: quem começou a trabalhar
 * não está mais em 0%, e deixar zerado fazia o percentual do projeto
 * ignorar tudo o que estava em andamento. O valor só é aplicado quando
 * a tarefa está zerada ou voltando de concluída — tarefa que já
 * registrava 60% não pode regredir por causa de um arrasto.
 */
export async function moverTarefa(
  ctx: ContextoUsuario,
  id: string,
  quadro: QuadroTarefa,
): Promise<void> {
  await exigirAcessoTarefa(ctx, id, "mover tarefas deste projeto");
  const concluida = quadro === "done";
  const emAndamento = quadro === "doing";

  await executar(
    `UPDATE projeto_tarefas
        SET quadro = :quadro,
            progresso = CASE
                          WHEN :concluida = 1 THEN 100
                          WHEN :emAndamento = 1 AND (progresso = 0 OR progresso = 100) THEN 10
                          ELSE progresso
                        END,
            concluido_em = CASE WHEN :concluida = 1
                                THEN COALESCE(concluido_em, LOCALTIMESTAMP) ELSE NULL END
      WHERE id = :id`,
    { id, quadro, concluida: deBool(concluida), emAndamento: deBool(emAndamento) },
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

  // O projeto precisa ser lido antes: depois da desativação a tarefa
  // continua existindo, mas propagar a partir dela vira busca inútil.
  const t = await consultarUm<{ projetoId: string }>(
    `SELECT projeto_id FROM projeto_tarefas WHERE id = :id`,
    { id },
  );
  if (!t) throw new ErroDominio(`Tarefa ${id} não encontrada`);

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

  // Sumir com a predecessora solta as sucessoras: elas podem voltar para
  // a própria âncora, e o cronograma encurta legitimamente.
  await propagarCronograma(t.projetoId);
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

/**
 * Edita um risco já cadastrado.
 *
 * Risco muda de leitura ao longo do projeto — a probabilidade cai
 * quando a mitigação começa a funcionar, o impacto sobe quando o
 * cronograma aperta. Sem edição, o jeito de corrigir era cadastrar
 * outro e conviver com os dois, o que inflava a contagem de riscos
 * abertos que a diretoria enxerga.
 */
export async function atualizarRisco(
  ctx: ContextoUsuario,
  id: string,
  d: Omit<DadosRisco, "projetoId">,
): Promise<void> {
  await exigirAcessoRegistro(ctx, "projeto_riscos", id, "alterar riscos deste projeto", "Risco");

  if (d.descricao.trim().length < 5) throw new ErroDominio("Descreva o risco");

  const n = await executar(
    `UPDATE projeto_riscos
        SET descricao = :descricao,
            probabilidade = :probabilidade,
            impacto = :impacto,
            mitigacao = :mitigacao,
            status = COALESCE(:status, status)
      WHERE id = :id`,
    {
      id,
      descricao: d.descricao.trim(),
      probabilidade: d.probabilidade,
      impacto: d.impacto,
      mitigacao: d.mitigacao?.trim() ?? null,
      status: d.status ?? null,
    },
  );
  if (n === 0) throw new ErroDominio(`Risco ${id} não encontrado`);
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

/**
 * Corrige um acompanhamento já publicado.
 *
 * O autor original não é alterado: quem escreveu continua respondendo
 * pelo que escreveu, mesmo que outra pessoa corrija uma data ou um
 * texto truncado depois.
 */
export async function atualizarAtualizacao(
  ctx: ContextoUsuario,
  id: string,
  d: Omit<DadosAtualizacao, "projetoId">,
): Promise<void> {
  await exigirAcessoRegistro(
    ctx,
    "projeto_atualizacoes",
    id,
    "alterar atualizações deste projeto",
    "Acompanhamento",
  );

  const n = await executar(
    `UPDATE projeto_atualizacoes
        SET data_ref = :dataRef,
            descricao = :descricao,
            ultimas_entregas = :ultimas,
            proximas_entregas = :proximas
      WHERE id = :id`,
    {
      id,
      dataRef: d.dataRef,
      descricao: d.descricao?.trim() ?? null,
      ultimas: d.ultimasEntregas?.trim() ?? null,
      proximas: d.proximasEntregas?.trim() ?? null,
    },
  );
  if (n === 0) throw new ErroDominio(`Acompanhamento ${id} não encontrado`);
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

/** Edita o ponto de atenção sem mexer no status: quem resolve é outro caminho. */
export async function atualizarAtencao(
  ctx: ContextoUsuario,
  id: string,
  d: Omit<DadosAtencao, "projetoId">,
): Promise<void> {
  await exigirAcessoRegistro(
    ctx,
    "projeto_atencoes",
    id,
    "alterar pontos de atenção deste projeto",
    "Ponto de atenção",
  );

  if (d.titulo.trim().length < 5) throw new ErroDominio("Informe o título do ponto de atenção");

  const n = await executar(
    `UPDATE projeto_atencoes
        SET titulo = :titulo,
            descricao = :descricao,
            decisao_necessaria = :decisao,
            responsavel_decisao_id = :responsavelId
      WHERE id = :id`,
    {
      id,
      titulo: d.titulo.trim(),
      descricao: d.descricao?.trim() ?? null,
      decisao: d.decisaoNecessaria?.trim() ?? null,
      responsavelId: d.responsavelDecisaoId ?? null,
    },
  );
  if (n === 0) throw new ErroDominio(`Ponto de atenção ${id} não encontrado`);
}

export async function resolverAtencao(ctx: ContextoUsuario, id: string): Promise<void> {
  await exigirAcessoRegistro(
    ctx,
    "projeto_atencoes",
    id,
    "resolver pontos de atenção deste projeto",
    "Ponto de atenção",
  );

  await executar(
    `UPDATE projeto_atencoes SET status = 'resolvido', resolvido_em = LOCALTIMESTAMP
      WHERE id = :id`,
    { id },
  );
}

/**
 * Reabre um ponto de atenção fechado por engano.
 *
 * Resolver era caminho de mão única: um clique errado apagava o item da
 * lista de pendências sem volta, e a única saída era cadastrar de novo,
 * perdendo a data de abertura original — que é justamente o número que
 * diz há quanto tempo a decisão está parada.
 *
 * `resolvido_em` volta a NULL porque a data de resolução de um item
 * reaberto não descreve mais nada.
 */
export async function reabrirAtencao(ctx: ContextoUsuario, id: string): Promise<void> {
  await exigirAcessoRegistro(
    ctx,
    "projeto_atencoes",
    id,
    "reabrir pontos de atenção deste projeto",
    "Ponto de atenção",
  );

  const n = await executar(
    `UPDATE projeto_atencoes SET status = 'aberto', resolvido_em = NULL WHERE id = :id`,
    { id },
  );
  if (n === 0) throw new ErroDominio(`Ponto de atenção ${id} não encontrado`);
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
  /**
   * Esforço em horas: o da própria tarefa se folha, a SOMA das filhas
   * se mãe.
   *
   * Não confundir com o intervalo entre `inicioEfetivo` e `fimEfetivo`.
   * Duas filhas de 8h no mesmo dia dão 16h de esforço num intervalo de
   * um dia só — os dois números medem coisas diferentes, e é o esforço
   * que responde "quanto trabalho tem aqui dentro".
   */
  esforcoHoras: number;
}

const DIA_MS = 86_400_000;

/** Jornada usada para converter horas em dias corridos de cronograma. */
export const HORAS_POR_DIA = 8;

/**
 * Esforço de uma folha, em horas.
 *
 * Prioriza o que o usuário digitou. Tarefa antiga, criada antes de a
 * duração existir, cai no calendário — cada dia corrido conta como uma
 * jornada, que é a melhor aproximação disponível.
 *
 * Alocação não entra aqui de propósito: 8h a 50% continuam sendo 8h de
 * trabalho, só espalhadas por dois dias. Quem mede esforço quer as
 * horas; quem monta a barra da grade quer os dias, e isso é
 * `duracaoParaDias`.
 */
function esforcoDaFolha(t: Tarefa): number {
  if (t.duracao !== null && t.duracao > 0) {
    return t.duracaoUnidade === "dias" ? t.duracao * HORAS_POR_DIA : t.duracao;
  }
  const inicio = new Date(t.inicio).setHours(0, 0, 0, 0);
  const fim = new Date(t.fim).setHours(0, 0, 0, 0);
  const dias = Math.max(1, Math.round((fim - inicio) / DIA_MS) + 1);
  return dias * HORAS_POR_DIA;
}

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
        esforcoHoras: esforcoDaFolha(t),
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
      esforcoHoras: calc.reduce((s, c) => s + c.esforcoHoras, 0),
    };
    cache.set(t.id, r);
    return r;
  }

  return tarefas.map(resolver);
}

// ------------------------------------------- predecessora de tarefa mãe

/**
 * Traduz um id qualquer para as folhas que ele representa.
 *
 * Depender de uma tarefa mãe é legítimo e é o que o MS Project chama de
 * dependência de tarefa de resumo: significa "só começo quando aquele
 * bloco inteiro terminar". Só que mãe não participa do grafo — as datas
 * dela são derivadas do rollup na leitura, e o reagendamento e o CPM só
 * trabalham com folhas.
 *
 * Antes, a aresta que apontava para uma mãe era simplesmente descartada,
 * e a dependência aparecia na tela sem produzir efeito nenhum: a
 * sucessora não andava e o CPM ainda anunciava folga onde não havia.
 * Expandir para as folhas descendentes preserva a intenção e mantém o
 * grafo correto.
 */
function expansorDeFolhas(
  ids: string[],
  paiDe: Map<string, string | null>,
  temFilhas: (id: string) => boolean,
): (id: string) => string[] {
  const filhasDe = new Map<string, string[]>();
  for (const id of ids) {
    const pai = paiDe.get(id);
    if (pai) filhasDe.set(pai, [...(filhasDe.get(pai) ?? []), id]);
  }

  const cache = new Map<string, string[]>();

  function resolver(id: string, emCurso: Set<string>): string[] {
    const pronto = cache.get(id);
    if (pronto) return pronto;
    // Ciclo em pai_id devolve a própria tarefa em vez de entrar em laço.
    if (emCurso.has(id)) return [id];
    if (!temFilhas(id)) return [id];

    emCurso.add(id);
    const folhas = (filhasDe.get(id) ?? []).flatMap((f) => resolver(f, emCurso));
    emCurso.delete(id);

    cache.set(id, folhas);
    return folhas;
  }

  return (id) => resolver(id, new Set());
}

// ------------------------------------------------------- edição inline

export type UnidadeDuracao = "horas" | "dias";

/**
 * Fator de alocação do recurso, como fração de uma jornada.
 *
 * Nulo, zero ou fora de 1–100 caem em 100%: alocação não informada
 * significa dedicação integral, que é o comportamento que o usuário
 * espera de uma tarefa recém-criada.
 */
function fatorAlocacao(alocacaoPct: number | null | undefined): number {
  if (alocacaoPct === null || alocacaoPct === undefined) return 1;
  if (!Number.isFinite(alocacaoPct) || alocacaoPct <= 0) return 1;
  return Math.min(alocacaoPct, 100) / 100;
}

/**
 * Duração informada pelo usuário para dias de calendário da tarefa.
 *
 * Dois fatores esticam o calendário sem mudar o esforço. A alocação diz
 * quanto da capacidade da pessoa vai para ESTA tarefa; a capacidade
 * diária diz quanto do dia dela sobra para projeto, depois da
 * sustentação. Quem está 50% em operação entrega 4h/dia, e uma tarefa
 * de 8h ocupa dois dias.
 *
 * Ignorar a capacidade fazia o cronograma prometer o dobro da
 * velocidade real de quem não é dedicado integral — e o erro só
 * aparecia quando a entrega atrasava.
 *
 * Arredonda para cima: 4h e 8h ocupam o mesmo dia na grade.
 */
export function duracaoParaDias(
  duracao: number,
  unidade: UnidadeDuracao,
  alocacaoPct?: number | null | undefined,
  /** Horas/dia que a pessoa tem para projeto. Sem valor, jornada cheia. */
  capacidadeDiaria?: number | null | undefined,
): number {
  const horas = unidade === "horas" ? duracao : duracao * HORAS_POR_DIA;
  const base = capacidadeDiaria && capacidadeDiaria > 0 ? capacidadeDiaria : HORAS_POR_DIA;
  return Math.max(1, Math.ceil(horas / (base * fatorAlocacao(alocacaoPct))));
}

/**
 * Caminho inverso, para exibir a duração de tarefa que só tem datas.
 * Usa a mesma capacidade, senão o valor exibido não volta a produzir as
 * mesmas datas quando o usuário reeditar o campo.
 */
export function diasParaDuracao(
  dias: number,
  unidade: UnidadeDuracao,
  alocacaoPct?: number | null | undefined,
  capacidadeDiaria?: number | null | undefined,
): number {
  const base = capacidadeDiaria && capacidadeDiaria > 0 ? capacidadeDiaria : HORAS_POR_DIA;
  const horas = dias * base * fatorAlocacao(alocacaoPct);
  if (unidade === "horas") return Math.round(horas);
  return Math.round((horas / HORAS_POR_DIA) * 100) / 100;
}

export interface CampoTarefa {
  progresso?: number | undefined;
  inicio?: Date | undefined;
  fim?: Date | undefined;
  nome?: string | undefined;
  /** Quando vem, recalcula `fim` a partir do início. */
  duracao?: number | undefined;
  duracaoUnidade?: UnidadeDuracao | undefined;
  /**
   * Manda gravar a data mesmo em conflito, cortando as dependências que
   * a impediam. É a segunda saída do diálogo de conflito.
   */
  forcarData?: boolean | undefined;
}

/** Predecessora que impede a data proposta, com o que a tela precisa mostrar. */
export interface PredecessoraEmConflito {
  id: string;
  nome: string;
  /** Término efetivo: o próprio, ou o da última folha se for tarefa mãe. */
  fim: Date;
  /** true quando é esta que empurra o mínimo para frente. */
  bloqueia: boolean;
}

export interface ConflitoData {
  /** Primeira data que respeita todas as dependências. */
  minimoPermitido: Date;
  /** Data que o usuário tentou gravar, ecoada para o texto do diálogo. */
  propostoEm: Date;
  predecessoras: PredecessoraEmConflito[];
}

/** Recurso que passou do próprio teto de projeto no período. Avisa, não impede. */
export interface AvisoAlocacao {
  recursoId: string;
  recursoNome: string;
  /** Soma das alocações no período, incluindo esta tarefa. */
  percentualTotal: number;
  /**
   * Teto da pessoa: o quanto da jornada dela é dedicado a projeto. Vem
   * junto porque "120%" só significa alguma coisa ao lado do limite que
   * foi ultrapassado — quem está 50% em sustentação estoura em 50.
   */
  tetoPct: number;
  /** Quantas outras tarefas concorrem com esta. */
  tarefasConcorrentes: number;
}

/**
 * Resposta da edição inline.
 *
 * Devolve os valores efetivamente gravados, e não um `ok` seco, porque
 * a grade precisa repintar início, fim e duração sem recarregar o
 * projeto inteiro a cada tecla — e porque em conflito nada foi gravado,
 * e a tela tem de saber disso para não mostrar um número que o banco
 * não tem.
 */
export interface ResultadoCampo {
  /** false quando houve conflito de data: nada foi gravado. */
  ok: boolean;
  conflito?: ConflitoData | undefined;
  inicio?: Date | undefined;
  fim?: Date | undefined;
  duracao?: number | undefined;
  duracaoUnidade?: UnidadeDuracao | undefined;
  /** Superalocação detectada. Não impede a gravação. */
  avisos?: AvisoAlocacao[] | undefined;
}

/** Aritmética de dias do projeto, resolvida uma vez por chamada. */
interface CalendarioProjeto {
  somar: (inicio: Date, dias: number) => Date;
  contar: (inicio: Date, fim: Date) => number;
  normalizar: (d: Date) => Date;
}

function meiaNoite(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/**
 * Carrega a aritmética de datas conforme o regime do projeto.
 *
 * Em dias corridos é conta de calendário; em dias úteis vem do mesmo
 * `expediente`/`feriados` que o SLA usa, carregado de uma vez para não
 * consultar o banco a cada par de datas.
 */
async function calendarioDoProjeto(usaDiasUteis: boolean): Promise<CalendarioProjeto> {
  if (!usaDiasUteis) {
    return {
      normalizar: meiaNoite,
      somar: (inicio, dias) => {
        const c = meiaNoite(inicio);
        c.setDate(c.getDate() + dias - 1);
        return c;
      },
      contar: (inicio, fim) =>
        Math.max(
          1,
          Math.round((meiaNoite(fim).getTime() - meiaNoite(inicio).getTime()) / DIA_MS) + 1,
        ),
    };
  }

  const sla = await import("@/integrations/postgres/sla.server");
  const [somar, contar, normalizar] = await Promise.all([
    sla.somadorDeDiasUteis(),
    sla.contadorDeDiasUteis(),
    sla.normalizadorDeDiaUtil(),
  ]);
  return { somar, contar, normalizar };
}

/** Linha lida antes de gravar a edição inline. */
interface LinhaCampoAtual {
  projetoId: string;
  inicio: Date;
  fim: Date;
  duracao: number | null;
  duracaoUnidade: string | null;
  alocacaoPct: number | null;
  usaDiasUteis: boolean;
}

/**
 * Atualiza campos isolados, sem tocar em vínculos. É o que a edição
 * inline do cronograma usa: salvar a tarefa inteira a cada saída de
 * campo apagaria responsáveis e predecessoras que não vieram no payload.
 *
 * Regra central: `inicio` e `duracao` são entrada, `fim` é sempre
 * derivado. Validar a data digitada contra o `fim` antigo era o que
 * produzia "término anterior ao início" ao empurrar uma tarefa para o
 * futuro — o término ainda não tinha sido recalculado.
 *
 * Recusa alteração em tarefa que tem filhas: os valores do pai são
 * derivados, e gravá-los criaria um número que o rollup contradiz.
 */
export async function atualizarCampoTarefa(
  ctx: ContextoUsuario,
  id: string,
  d: CampoTarefa,
): Promise<ResultadoCampo> {
  await exigirAcessoTarefa(ctx, id, "alterar tarefas deste projeto");

  const filhas = await consultarUm<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM projeto_tarefas WHERE pai_id = :id AND ativo = 1`,
    { id },
  );

  /**
   * Tarefa mãe tem datas e progresso derivados do rollup, mas o nome é
   * dela. Recusar a edição inteira obrigava a pessoa a excluir e
   * recriar o agrupador só para corrigir uma palavra — e a grade
   * deixava o campo editável, então o erro só aparecia depois de
   * digitar.
   */
  if ((filhas?.total ?? 0) > 0) {
    const mexeNoCronograma =
      d.inicio !== undefined ||
      d.fim !== undefined ||
      d.duracao !== undefined ||
      d.duracaoUnidade !== undefined ||
      d.progresso !== undefined;

    if (mexeNoCronograma) {
      throw new ErroDominio(
        "Tarefa com subtarefas tem datas e progresso calculados a partir delas.",
      );
    }

    if (d.nome === undefined) return { ok: true };

    const n = await executar(`UPDATE projeto_tarefas SET nome = :nome WHERE id = :id`, {
      id,
      nome: d.nome.trim(),
    });
    if (n === 0) throw new ErroDominio(`Tarefa ${id} não encontrada`);
    return { ok: true };
  }

  // O regime de dias vem do projeto, não da tarefa: um cronograma com
  // metade das tarefas em dia útil e metade em dia corrido não teria
  // como ser lido.
  const atual = await consultarUm<LinhaCampoAtual>(
    `SELECT t.projeto_id, t.inicio, t.fim, t.duracao, t.duracao_unidade, t.alocacao_pct,
            (p.usa_dias_uteis = 1) AS usa_dias_uteis
       FROM projeto_tarefas t
       JOIN projetos p ON p.id = t.projeto_id
      WHERE t.id = :id`,
    { id },
  );
  if (!atual) throw new ErroDominio(`Tarefa ${id} não encontrada`);

  const cal = await calendarioDoProjeto(atual.usaDiasUteis);

  // Capacidade real de quem executa: quem está parte do dia em
  // sustentação rende menos por dia, e é isso que decide quantos dias a
  // tarefa ocupa. Sem responsável, cai na jornada padrão.
  const { capacidadeDiariaDaTarefa } = await import("@/repositories/recursos.repo");
  const capacidade = await capacidadeDiariaDaTarefa(id);

  const inicioProposto = d.inicio ?? new Date(atual.inicio);

  // Conflito é checado antes de qualquer escrita. Gravar e deixar o
  // reagendamento corrigir depois apagaria a data em silêncio, e é
  // justamente o silêncio que o diálogo existe para evitar.
  if (d.inicio !== undefined) {
    const conflito = await conflitoDeData(id, inicioProposto);
    if (conflito) {
      if (!d.forcarData) return { ok: false, conflito };
      await removerPredecessoras(
        id,
        conflito.predecessoras.filter((p) => p.bloqueia).map((p) => p.id),
      );
    }
  }

  const inicio = cal.normalizar(inicioProposto);
  const alocacao = atual.alocacaoPct;
  const unidadeAnterior: UnidadeDuracao = atual.duracaoUnidade === "dias" ? "dias" : "horas";
  const unidade: UnidadeDuracao = d.duracaoUnidade ?? unidadeAnterior;

  let fim: Date;
  let duracao: number;

  if (d.duracao !== undefined) {
    // Duração manda no término: quem digita "16h" espera que o fim ande,
    // não que o sistema reclame de incoerência com a data antiga.
    if (!Number.isFinite(d.duracao) || d.duracao <= 0) {
      throw new ErroDominio("Duração deve ser maior que zero");
    }
    duracao = d.duracao;
    fim = cal.somar(inicio, duracaoParaDias(duracao, unidade, alocacao, capacidade));
  } else if (d.fim !== undefined) {
    // Término digitado à mão: é o único caminho em que o fim é entrada,
    // e aí é a duração que passa a ser derivada.
    fim = cal.normalizar(d.fim);
    if (fim < inicio) throw new ErroDominio("Data de término anterior ao início");
    duracao = diasParaDuracao(cal.contar(inicio, fim), unidade, alocacao, capacidade);
  } else {
    // Nenhuma das duas veio: o intervalo é preservado e reancorado no
    // novo início. É o caso do arrastar da barra e o da edição de nome
    // ou progresso, em que nada de cronograma deveria mudar.
    const dias =
      atual.duracao !== null && atual.duracao > 0
        ? duracaoParaDias(atual.duracao, unidadeAnterior, alocacao, capacidade)
        : Math.max(1, cal.contar(cal.normalizar(atual.inicio), meiaNoite(atual.fim)));

    fim = cal.somar(inicio, dias);
    duracao =
      atual.duracao !== null && atual.duracao > 0 && d.duracaoUnidade === undefined
        ? atual.duracao
        : diasParaDuracao(dias, unidade, alocacao, capacidade);
  }

  const avisos = await avisosDeAlocacao(id, inicio, fim, alocacao);

  // O quadro só se mexe quando o progresso veio no payload. Sem esta
  // guarda, renomear uma tarefa concluída a devolvia para "doing".
  const mexeuProgresso = d.progresso !== undefined;
  const concluida = d.progresso === 100;

  await executar(
    `UPDATE projeto_tarefas
        SET nome = COALESCE(:nome, nome),
            progresso = COALESCE(:progresso, progresso),
            inicio = :inicio,
            fim = :fim,
            duracao = :duracao,
            duracao_unidade = :unidade,
            quadro = CASE WHEN :mexeuProgresso = 0 THEN quadro
                          WHEN :concluida = 1 THEN 'done'
                          WHEN quadro = 'done' THEN 'doing'
                          ELSE quadro END,
            concluido_em = CASE WHEN :mexeuProgresso = 0 THEN concluido_em
                                WHEN :concluida = 1
                                THEN COALESCE(concluido_em, LOCALTIMESTAMP)
                                ELSE NULL END
      WHERE id = :id`,
    {
      id,
      nome: d.nome?.trim() ?? null,
      progresso: d.progresso ?? null,
      inicio,
      fim,
      duracao,
      unidade,
      mexeuProgresso: deBool(mexeuProgresso),
      concluida: deBool(concluida),
    },
  );

  // Empurra as sucessoras e fecha o período do projeto. Sem esta
  // chamada a data da tarefa muda e o resto do cronograma fica parado.
  await propagarCronograma(atual.projetoId);

  // Relê: a passada topológica pode ter empurrado esta mesma tarefa se
  // as predecessoras dela exigirem mais do que a âncora digitada.
  const gravada = await consultarUm<{ inicio: Date; fim: Date }>(
    `SELECT inicio, fim FROM projeto_tarefas WHERE id = :id`,
    { id },
  );

  return {
    ok: true,
    inicio: gravada ? new Date(gravada.inicio) : inicio,
    fim: gravada ? new Date(gravada.fim) : fim,
    duracao,
    duracaoUnidade: unidade,
    avisos: avisos.length > 0 ? avisos : undefined,
  };
}

/** Linha da checagem de superalocação. */
interface LinhaAlocacao {
  recursoId: string;
  recursoNome: string;
  /** Teto de projeto da pessoa, em pontos percentuais da jornada. */
  tetoPct: number;
  totalOutras: number;
  tarefasConcorrentes: number;
}

/**
 * Capacidade diária de projeto por tarefa, para o projeto inteiro.
 *
 * O reagendamento percorre todas as folhas; consultar por tarefa
 * transformaria a passada numa enxurrada de consultas. Vale o MENOR
 * entre os responsáveis: quem tem menos tempo determina o ritmo.
 */
async function capacidadesDoProjeto(projetoId: string): Promise<Map<string, number>> {
  const linhas = await consultar<{ tarefaId: string; horas: number }>(
    `SELECT tr.tarefa_id,
            MIN(r.horas_dia * r.disponibilidade_projetos::numeric / 100) AS horas
       FROM tarefa_responsaveis tr
       JOIN projeto_tarefas t ON t.id = tr.tarefa_id
       JOIN recursos r ON r.id = tr.recurso_id AND r.ativo = 1
      WHERE t.projeto_id = :projetoId AND t.ativo = 1
      GROUP BY tr.tarefa_id`,
    { projetoId },
  );

  const mapa = new Map<string, number>();
  for (const l of linhas) {
    // Disponibilidade zerada não é capacidade: dividir por ela deixaria
    // a tarefa sem fim possível.
    const horas = Number(l.horas);
    if (Number.isFinite(horas) && horas > 0) mapa.set(l.tarefaId, horas);
  }
  return mapa;
}

/**
 * Recursos que passam do próprio teto no período da tarefa.
 *
 * O teto é `disponibilidade_projetos`, não 100%: quem está metade do dia
 * em sustentação estoura com muito menos alocação de projeto, e comparar
 * todo mundo contra 100 escondia exatamente o caso que mais aperta.
 *
 * A janela é o intervalo inteiro, não dia a dia: duas tarefas que se
 * tocam em um único dia já disputam a mesma pessoa, e a precisão diária
 * custaria uma varredura de calendário por recurso sem mudar a decisão
 * de quem lê o aviso.
 *
 * Tarefa mãe fica de fora — quem executa são as filhas, e contá-la
 * dobraria a alocação de todo mundo.
 *
 * É aviso, não bloqueio: cronograma se monta estourando capacidade de
 * propósito, para depois negociar. Barrar aqui só ensinaria o usuário a
 * apagar o responsável para conseguir salvar.
 */
async function avisosDeAlocacao(
  tarefaId: string,
  inicio: Date,
  fim: Date,
  alocacaoPropria: number | null,
): Promise<AvisoAlocacao[]> {
  const linhas = await consultar<LinhaAlocacao>(
    `SELECT r.id AS recurso_id,
            r.nome AS recurso_nome,
            r.disponibilidade_projetos AS teto_pct,
            COALESCE(SUM(COALESCE(o.alocacao_pct, 100)), 0)::int AS total_outras,
            COUNT(o.id)::int AS tarefas_concorrentes
       FROM tarefa_responsaveis tr
       JOIN recursos r ON r.id = tr.recurso_id
       LEFT JOIN tarefa_responsaveis tro
              ON tro.recurso_id = tr.recurso_id AND tro.tarefa_id <> tr.tarefa_id
       LEFT JOIN projeto_tarefas o
              ON o.id = tro.tarefa_id
             AND o.ativo = 1
             AND o.quadro <> 'done'
             AND o.inicio <= :fim
             AND o.fim >= :inicio
             AND NOT EXISTS (SELECT 1 FROM projeto_tarefas f
                              WHERE f.pai_id = o.id AND f.ativo = 1)
      WHERE tr.tarefa_id = :id
      GROUP BY r.id, r.nome, r.disponibilidade_projetos`,
    { id: tarefaId, inicio, fim },
  );

  const propria = alocacaoPropria === null ? 100 : alocacaoPropria;

  return linhas
    .map((l) => ({
      recursoId: l.recursoId,
      recursoNome: l.recursoNome,
      percentualTotal: l.totalOutras + propria,
      tetoPct: l.tetoPct,
      tarefasConcorrentes: l.tarefasConcorrentes,
    }))
    .filter((a) => a.percentualTotal > a.tetoPct);
}

/** Corta vínculos específicos. Usado pela saída "manter a data" do diálogo. */
async function removerPredecessoras(tarefaId: string, predecessoraIds: string[]): Promise<void> {
  const unicas = [...new Set(predecessoraIds)];
  if (unicas.length === 0) return;

  const binds: Record<string, unknown> = { id: tarefaId };
  const chaves = unicas.map((p, i) => {
    binds[`p${i}`] = p;
    return `:p${i}`;
  });

  await executar(
    `DELETE FROM tarefa_predecessoras
      WHERE tarefa_id = :id AND predecessora_id IN (${chaves.join(",")})`,
    binds,
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
    // Nasce com duração explícita de uma jornada: tarefa sem duração
    // gravada obriga o reagendamento a inferir do intervalo, e o
    // primeiro arrasto da barra a deformaria.
    await tx.executar(
      `INSERT INTO projeto_tarefas
         (id, projeto_id, pai_id, nome, inicio, fim, progresso, quadro, marco,
          duracao, duracao_unidade, ordem)
       VALUES (:id, :projetoId, :paiId, 'Nova tarefa', :inicio, :fim, 0, 'backlog', 0,
               :duracao, 'horas', :ordem)`,
      {
        id,
        projetoId: ref.projetoId,
        paiId,
        inicio: ref.inicio,
        fim: ref.inicio,
        duracao: HORAS_POR_DIA,
        ordem: ref.ordem + 1,
      },
    );
  });

  await propagarCronograma(ref.projetoId);
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
      {
        id,
        projetoId,
        versao,
        descricao: descricao?.trim() ?? null,
        autorId: ctx.id,
      },
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
 * duração das filhas no cálculo. Dependência declarada sobre uma mãe é
 * expandida para as folhas dela — descartá-la anunciava folga onde a
 * tarefa na verdade estava presa.
 *
 * A duração vem das datas, não o contrário. Num CPM clássico a duração
 * dirige o cronograma; aqui as datas são definidas pelo usuário e o CPM
 * responde outra pergunta — quanto cada tarefa pode escorregar antes de
 * empurrar a entrega. É a informação que interessa a quem acompanha.
 */
export function calcularCpm(
  tarefas: TarefaCalculada[],
  predecessoras: Record<string, string[]>,
  /**
   * Como contar dias entre duas datas. O padrão é dias corridos; o
   * chamador passa a contagem em dias úteis quando o projeto trabalha
   * assim.
   *
   * Sem isso, uma folga de "3 dias" poderia incluir um fim de semana e
   * prometer uma margem que não existe.
   */
  contarDias: (inicio: Date, fim: Date) => number = duracaoEmDias,
): Map<string, DadosCpm> {
  const folhas = tarefas.filter((t) => !t.ehPai);
  const porId = new Map(folhas.map((t) => [t.id, t]));
  const saida = new Map<string, DadosCpm>();
  if (folhas.length === 0) return saida;

  const ehPaiPorId = new Map(tarefas.map((t) => [t.id, t.ehPai]));
  const paiDe = new Map(tarefas.map((t) => [t.id, t.paiId]));
  const emFolhas = expansorDeFolhas(
    tarefas.map((t) => t.id),
    paiDe,
    (id) => ehPaiPorId.get(id) ?? false,
  );

  // Predecessora que aponta para tarefa inexistente é descartada;
  // a que aponta para uma mãe vira o conjunto de folhas dela.
  const pred = new Map<string, string[]>();
  for (const t of folhas) {
    const expandidas = (predecessoras[t.id] ?? [])
      .flatMap((p) => emFolhas(p))
      .filter((p) => porId.has(p) && p !== t.id);
    pred.set(t.id, [...new Set(expandidas)]);
  }

  const suc = new Map<string, string[]>();
  for (const [id, ps] of pred) {
    for (const p of ps) suc.set(p, [...(suc.get(p) ?? []), id]);
  }

  const dur = new Map<string, number>();
  for (const t of folhas) dur.set(t.id, contarDias(t.inicioEfetivo, t.fimEfetivo));

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
      duracaoDias: contarDias(t.inicioEfetivo, t.fimEfetivo),
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
      `SELECT COUNT(*)::int AS total FROM projeto_tarefas WHERE pai_id = :id AND ativo = 1`,
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

  // Vincular uma predecessora sem propagar deixava a sucessora na data
  // antiga até alguém tocar em outra coisa.
  if (d.predecessoras) await propagarCronograma(tarefa.projetoId);
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
 *
 * Tarefa mãe é aceita: vale como "espero o bloco inteiro terminar", e o
 * grafo expande para as folhas dela na hora de calcular. O que se
 * recusa é a própria ancestralidade — depender da mãe de quem se é
 * filha significa esperar a si mesmo.
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

  // Ancestral como predecessora: a mãe só termina quando esta filha
  // terminar, então esperar por ela é esperar por si mesma.
  const ancestrais = await consultar<{ id: string }>(
    `WITH RECURSIVE subida AS (
       SELECT pai_id AS id FROM projeto_tarefas WHERE id = :id AND pai_id IS NOT NULL
       UNION ALL
       SELECT t.pai_id FROM projeto_tarefas t
        JOIN subida s ON t.id = s.id
       WHERE t.pai_id IS NOT NULL
     )
     SELECT id FROM subida`,
    { id },
  );
  const conjuntoAncestrais = new Set(ancestrais.map((a) => a.id));
  if (unicas.some((p) => conjuntoAncestrais.has(p))) {
    throw new ErroDominio(
      "Uma tarefa não pode depender da própria tarefa mãe: a mãe só termina quando ela terminar.",
    );
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

  const t = await consultarUm<{
    projetoId: string;
    paiId: string | null;
    ordem: number;
  }>(`SELECT projeto_id, pai_id, ordem FROM projeto_tarefas WHERE id = :id`, {
    id,
  });
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

    // A futura mãe não pode continuar dependendo desta tarefa, e esta
    // não pode depender da futura mãe: os dois casos viram espera
    // circular assim que o vínculo é expandido para as folhas.
    await executar(
      `DELETE FROM tarefa_predecessoras
        WHERE (tarefa_id = :filha AND predecessora_id = :mae)
           OR (tarefa_id = :mae AND predecessora_id = :filha)`,
      { filha: id, mae: anterior.id },
    );

    await executar(`UPDATE projeto_tarefas SET pai_id = :paiId WHERE id = :id`, {
      id,
      paiId: anterior.id,
    });

    // A antiga folha virou mãe: sai do reagendamento e do CPM, e o
    // período do projeto passa a somar por outro caminho.
    await propagarCronograma(t.projetoId);
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

  await propagarCronograma(t.projetoId);
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
 * ou cancelado é ruído que ensina o gerente a ignorar o aviso. Demanda
 * em backlog também fica de fora — ela ainda não foi priorizada, e
 * cobrar andamento do que ninguém começou é o mesmo ruído.
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

// -------------------------------------------------------- reagendamento

/** Linha usada pela passada topológica do reagendamento. */
interface LinhaReagendamento {
  id: string;
  paiId: string | null;
  inicio: Date;
  fim: Date;
  duracao: number | null;
  duracaoUnidade: string | null;
  alocacaoPct: number | null;
  temFilhas: number;
}

/**
 * Recalcula início e fim de todas as folhas a partir das predecessoras.
 *
 * A passada é sobre o projeto inteiro, não só sobre a tarefa mudada.
 * Propagação incremental — o que o MS Project faz — exigiria saber quem
 * mexeu no quê e parar na hora certa; a passada completa é
 * determinística, roda em milissegundos para centenas de tarefas e não
 * tem como deixar o cronograma meio atualizado.
 *
 * A data que o usuário digitou vira âncora de "não antes de", igual à
 * restrição que o Project cria: a tarefa nunca é puxada para trás, só
 * empurrada para frente pelas predecessoras. Conflito de verdade — data
 * anterior ao que a dependência permite — é barrado antes, na edição.
 *
 * Só folhas entram. Tarefa mãe tem datas derivadas do rollup na leitura;
 * gravá-las aqui criaria um número que o rollup contradiz. Dependência
 * declarada sobre uma mãe é expandida para as folhas dela — descartá-la
 * deixava a sucessora parada na data antiga.
 */
export async function reagendarProjeto(projetoId: string): Promise<void> {
  const [tarefas, arestas, projeto] = await Promise.all([
    consultar<LinhaReagendamento>(
      `SELECT t.id, t.pai_id, t.inicio, t.fim, t.duracao, t.duracao_unidade, t.alocacao_pct,
              (SELECT COUNT(*) FROM projeto_tarefas f
                WHERE f.pai_id = t.id AND f.ativo = 1)::int AS tem_filhas
         FROM projeto_tarefas t
        WHERE t.projeto_id = :projetoId AND t.ativo = 1
        ORDER BY t.ordem`,
      { projetoId },
    ),
    consultar<{ tarefaId: string; predecessoraId: string }>(
      `SELECT tp.tarefa_id, tp.predecessora_id
         FROM tarefa_predecessoras tp
         JOIN projeto_tarefas t ON t.id = tp.tarefa_id
        WHERE t.projeto_id = :projetoId AND t.ativo = 1`,
      { projetoId },
    ),
    consultarUm<{ usaDiasUteis: boolean }>(
      `SELECT (usa_dias_uteis = 1) AS usa_dias_uteis FROM projetos WHERE id = :id`,
      { id: projetoId },
    ),
  ]);

  const folhas: LinhaReagendamento[] = tarefas.filter((t) => t.temFilhas === 0);
  if (folhas.length === 0) return;

  const cal = await calendarioDoProjeto(projeto?.usaDiasUteis ?? true);

  // Capacidade de todas as folhas numa consulta só: uma ida ao banco
  // por tarefa transformaria a passada topológica em centenas de
  // consultas a cada tecla salva.
  const capacidadePorTarefa = await capacidadesDoProjeto(projetoId);

  const temFilhasPorId = new Map(tarefas.map((t) => [t.id, t.temFilhas > 0]));
  const paiDe = new Map(tarefas.map((t) => [t.id, t.paiId]));
  const emFolhas = expansorDeFolhas(
    tarefas.map((t) => t.id),
    paiDe,
    (id) => temFilhasPorId.get(id) ?? false,
  );

  const pred = new Map<string, string[]>();
  const porId = new Map<string, LinhaReagendamento>(folhas.map((t) => [t.id, t]));
  for (const t of folhas) pred.set(t.id, []);

  // As duas pontas são expandidas: vínculo declarado numa mãe vale para
  // as folhas dela, dos dois lados da seta.
  for (const a of arestas) {
    for (const alvo of emFolhas(a.tarefaId)) {
      if (!porId.has(alvo)) continue;
      for (const origem of emFolhas(a.predecessoraId)) {
        if (!porId.has(origem) || origem === alvo) continue;
        const lista = pred.get(alvo);
        if (lista && !lista.includes(origem)) lista.push(origem);
      }
    }
  }

  // Ordenação topológica. Ciclo é possível — a validação impede criar,
  // mas dado antigo pode ter — e a marca de visitado corta o laço em vez
  // de travar a tela inteira.
  const ordem: string[] = [];
  const estado = new Map<string, 0 | 1 | 2>();
  function visitar(id: string) {
    if ((estado.get(id) ?? 0) !== 0) return;
    estado.set(id, 1);
    for (const p of pred.get(id) ?? []) visitar(p);
    estado.set(id, 2);
    ordem.push(id);
  }
  for (const t of folhas) visitar(t.id);

  const agenda = new Map<string, { inicio: Date; fim: Date }>();
  for (const id of ordem) {
    const t = porId.get(id);
    if (!t) continue;

    let inicio = cal.normalizar(t.inicio);
    for (const p of pred.get(id) ?? []) {
      const anterior = agenda.get(p);
      if (!anterior) continue;
      // Sucessora começa no dia útil seguinte ao término: somar 2 dias
      // conta o próprio dia do fim como o primeiro.
      const seguinte = cal.somar(anterior.fim, 2);
      if (seguinte > inicio) inicio = seguinte;
    }

    const dias = duracaoDaTarefa(t, cal, capacidadePorTarefa.get(id) ?? null);
    agenda.set(id, { inicio, fim: cal.somar(inicio, dias) });
  }

  // Só grava o que mudou: um UPDATE por tarefa em cronograma de 300
  // linhas seria 300 idas ao banco a cada tecla salva.
  const mudancas = folhas.filter((t) => {
    const a = agenda.get(t.id);
    if (!a) return false;
    return (
      a.inicio.getTime() !== cal.normalizar(t.inicio).getTime() ||
      a.fim.getTime() !== meiaNoite(t.fim).getTime()
    );
  });
  if (mudancas.length === 0) return;

  await emTransacao(async (tx) => {
    for (const t of mudancas) {
      const a = agenda.get(t.id);
      if (!a) continue;
      await tx.executar(`UPDATE projeto_tarefas SET inicio = :inicio, fim = :fim WHERE id = :id`, {
        id: t.id,
        inicio: a.inicio,
        fim: a.fim,
      });
    }
  });
}

/**
 * Duração da tarefa em dias, para o reagendamento.
 *
 * Prefere o que o usuário digitou, com as mesmas correções de alocação
 * e de capacidade que a edição inline aplica — se as contas
 * divergissem, a passada topológica desfaria na gravação seguinte o fim
 * que a tela acabou de mostrar.
 *
 * Tarefa antiga sem duração gravada mantém o intervalo que já tinha,
 * para não encolher sozinha.
 */
function duracaoDaTarefa(
  t: {
    inicio: Date;
    fim: Date;
    duracao: number | null;
    duracaoUnidade: string | null;
    alocacaoPct: number | null;
  },
  cal: CalendarioProjeto,
  capacidadeDiaria: number | null,
): number {
  if (t.duracao !== null && t.duracao > 0) {
    return duracaoParaDias(
      t.duracao,
      t.duracaoUnidade === "dias" ? "dias" : "horas",
      t.alocacaoPct,
      capacidadeDiaria,
    );
  }
  return Math.max(1, cal.contar(cal.normalizar(t.inicio), meiaNoite(t.fim)));
}

/** Linha de predecessora usada na checagem de conflito. */
interface LinhaPredecessora {
  id: string;
  nome: string;
  fim: Date;
}

/**
 * Verifica se uma data proposta cabe nas dependências da tarefa.
 *
 * Devolve `null` quando cabe. Quando não cabe, devolve o mínimo
 * permitido e as predecessoras que mandam — com id, não só nome, porque
 * a tela precisa poder cortar exatamente o vínculo que atrapalha.
 *
 * Para predecessora que é tarefa mãe, o término considerado é o da
 * última folha dela, não a coluna `fim` da própria linha: as datas do
 * pai são derivadas do rollup na leitura e o valor gravado pode estar
 * defasado. É o mesmo motivo que faz o reagendamento expandir a aresta.
 *
 * Cada predecessora é avaliada individualmente e marcada em `bloqueia`.
 * Devolver só a mais tardia faria a saída "manter a data" cortar um
 * vínculo e esbarrar no seguinte, abrindo o mesmo diálogo em sequência.
 */
export async function conflitoDeData(
  tarefaId: string,
  inicioProposto: Date,
): Promise<ConflitoData | null> {
  // A recursão desce a árvore de cada predecessora e agrega pelo id da
  // raiz: uma linha por vínculo declarado, com o fim real do bloco.
  const linhas = await consultar<LinhaPredecessora>(
    `WITH RECURSIVE descendencia AS (
       SELECT pr.id AS raiz_id, pr.nome AS raiz_nome, pr.id AS no_id
         FROM tarefa_predecessoras tp
         JOIN projeto_tarefas pr ON pr.id = tp.predecessora_id AND pr.ativo = 1
        WHERE tp.tarefa_id = :id
       UNION ALL
       SELECT d.raiz_id, d.raiz_nome, f.id
         FROM descendencia d
         JOIN projeto_tarefas f ON f.pai_id = d.no_id AND f.ativo = 1
     )
     SELECT d.raiz_id AS id, d.raiz_nome AS nome, MAX(t.fim) AS fim
       FROM descendencia d
       JOIN projeto_tarefas t ON t.id = d.no_id
      GROUP BY d.raiz_id, d.raiz_nome`,
    { id: tarefaId },
  );
  if (linhas.length === 0) return null;

  const projeto = await consultarUm<{ usaDiasUteis: boolean }>(
    `SELECT (p.usa_dias_uteis = 1) AS usa_dias_uteis
       FROM projeto_tarefas t
       JOIN projetos p ON p.id = t.projeto_id
      WHERE t.id = :id`,
    { id: tarefaId },
  );

  const cal = await calendarioDoProjeto(projeto?.usaDiasUteis ?? true);
  const proposto = meiaNoite(inicioProposto);

  // Mínimo de cada predecessora: o dia seguinte ao término dela, na
  // contagem que o projeto usa.
  const avaliadas = linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    fim: new Date(l.fim),
    minimo: cal.somar(new Date(l.fim), 2),
  }));

  const primeira = avaliadas[0];
  if (!primeira) return null;

  const minimoPermitido = avaliadas.reduce(
    (maior, a) => (a.minimo > maior ? a.minimo : maior),
    primeira.minimo,
  );

  if (proposto >= minimoPermitido) return null;

  return {
    minimoPermitido,
    propostoEm: proposto,
    predecessoras: avaliadas.map((a) => ({
      id: a.id,
      nome: a.nome,
      fim: a.fim,
      bloqueia: a.minimo > proposto,
    })),
  };
}
