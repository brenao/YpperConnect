import { consultar, consultarUm } from "@/integrations/postgres/client.server";
import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Recursos de projeto: quem executa tarefa e com quanta capacidade.
 *
 * Separado de `usuarios` de propósito: nem todo recurso tem conta
 * (terceirizado, consultoria), e nem todo usuário participa de projeto.
 * O vínculo é opcional, via usuario_id.
 *
 * Cadastro, ausências e fornecedores: Supabase, por empresa, com a
 * sessão de quem chamou (o RLS confere de novo).
 *
 * Cálculo sobre projetos (carga, capacidade por tarefa, responsáveis e
 * ausências do cronograma): ainda no banco legado, porque lê as tabelas
 * de projetos. Migra junto com o módulo de Projetos.
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
  /**
   * Fornecedor, quando o recurso é terceiro. Nulo significa interno.
   *
   * O nome vem junto porque quase toda tela que lista recurso quer
   * mostrar de quem ele é, e buscar isso depois transformaria uma lista
   * de cinquenta linhas em cinquenta consultas.
   */
  fornecedorId: string | null;
  fornecedorNome: string | null;
  /**
   * Custo por hora. Opcional, e sem relatório em cima dele ainda: a
   * coluna existe para o dado começar a ser coletado, porque relatório
   * de custo sem histórico só serve um ano depois.
   */
  custoHora: number | null;
  /** Jornada diária total. */
  horasDia: number;
  /** % da jornada dedicada a projetos (o resto vai para atendimento). */
  disponibilidadeProjetos: number;
  ativo: boolean;
}

// capacidadeProjeto vive em @/services/resource-utils: a tela de recursos
// precisa dela no navegador, e importar valor deste arquivo levaria o
// cliente do banco para o bundle do navegador.

/**
 * Quem administra o cadastro de recursos: quem tem `recurso.editar` no
 * perfil, mais o administrador. Pertencer a uma equipe diz respeito a
 * chamado; capacidade de projeto é outra conversa.
 */
const FEATURE_RECURSO_EDITAR = "recurso.editar";

function exigirGestaoRecursos(ctx: ContextoUsuario, acao: string): void {
  if (ctx.admin) return;
  if (ctx.funcionalidades.includes(FEATURE_RECURSO_EDITAR)) return;
  throw new ErroDominio(`Seu perfil não permite ${acao}`);
}

async function tenantAtual(): Promise<string> {
  const { getUsuarioAtual } = await import("@/services/current-user.server");
  return (await getUsuarioAtual()).tenantId;
}

function falha(erro: { code?: string; message: string }): never {
  if (erro.code === "42501") throw new ErroDominio("Seu perfil não permite esta ação");
  if (erro.code === "23503") {
    throw new ErroDominio("Um dos itens selecionados não pertence a esta empresa.");
  }
  if (erro.code === "23505") {
    if (erro.message.includes("ux_fornecedores_nome")) {
      throw new ErroDominio("Já existe um fornecedor com esse nome.");
    }
    if (erro.message.includes("ux_fornecedores_cnpj")) {
      throw new ErroDominio("Já existe um fornecedor com esse CNPJ.");
    }
    if (erro.message.includes("uq_recursos_usuario")) {
      throw new ErroDominio("Este usuário já é um recurso.");
    }
  }
  throw new Error(erro.message);
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function paraRecurso(r: Record<string, unknown>): Recurso {
  return {
    id: r["id"] as string,
    usuarioId: (r["usuario_id"] as string | null) ?? null,
    usuarioNome: (r["usuario_nome"] as string | null) ?? null,
    nome: r["nome"] as string,
    papel: (r["papel"] as string | null) ?? null,
    equipeId: (r["equipe_id"] as string | null) ?? null,
    equipeNome: (r["equipe_nome"] as string | null) ?? null,
    localidadeId: (r["localidade_id"] as string | null) ?? null,
    localidadeNome: (r["localidade_nome"] as string | null) ?? null,
    fornecedorId: (r["fornecedor_id"] as string | null) ?? null,
    fornecedorNome: (r["fornecedor_nome"] as string | null) ?? null,
    custoHora: num(r["custo_hora"]),
    horasDia: Number(r["horas_dia"]),
    disponibilidadeProjetos: Number(r["disponibilidade_projetos"]),
    ativo: r["ativo"] as boolean,
  };
}

export async function listarRecursos(apenasAtivos = true): Promise<Recurso[]> {
  let q = getSupabaseServerClient()
    .from("recursos_v")
    .select("*")
    .eq("tenant_id", await tenantAtual());
  if (apenasAtivos) q = q.eq("ativo", true);
  const { data, error } = await q.order("nome");
  if (error) falha(error);
  return (data ?? []).map(paraRecurso);
}

export async function buscarRecurso(id: string): Promise<Recurso | null> {
  const { data, error } = await getSupabaseServerClient()
    .from("recursos_v")
    .select("*")
    .eq("tenant_id", await tenantAtual())
    .eq("id", id)
    .maybeSingle();
  if (error) falha(error);
  return data ? paraRecurso(data) : null;
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
 * lista e cria em lote.
 */
export async function usuariosSemRecurso(): Promise<UsuarioSemRecurso[]> {
  const { listarUsuarios } = await import("./usuarios.repo");
  const [usuarios, recursos] = await Promise.all([
    listarUsuarios(true),
    getSupabaseServerClient()
      .from("recursos")
      .select("usuario_id")
      .eq("tenant_id", await tenantAtual())
      .not("usuario_id", "is", null),
  ]);
  if (recursos.error) falha(recursos.error);
  const jaSao = new Set((recursos.data ?? []).map((r) => r.usuario_id as string));
  return usuarios
    .filter((u) => !jaSao.has(u.id))
    .map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email,
      departamento: u.departamento,
      equipeId: u.equipeId,
      equipeNome: u.equipeNome,
    }));
}

/** Jornada padrão. Todo mundo tem 8h; a coluna existe para a exceção. */
export const HORAS_DIA_PADRAO = 8;

/** Disponibilidade inicial de quem entra pela criação em lote. */
export const DISPONIBILIDADE_PADRAO = 50;

/**
 * Cria recursos a partir de usuários já cadastrados. Herda nome,
 * departamento e equipe; quem já é recurso é ignorado (clique duplo não
 * duplica). A localidade fica nula: herda a padrão.
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
  const { data, error } = await getSupabaseServerClient().rpc("criar_recursos_de_usuarios", {
    p_tenant: ctx.tenantId,
    p_usuarios: unicos,
    p_disponibilidade: disponibilidadeProjetos,
    p_horas_dia: HORAS_DIA_PADRAO,
  });
  if (error) falha(error);
  return Number(data ?? 0);
}

export interface DadosRecurso {
  nome: string;
  usuarioId?: string | null | undefined;
  papel?: string | null | undefined;
  equipeId?: string | null | undefined;
  /** Nulo herda a localidade padrão da empresa. */
  localidadeId?: string | null | undefined;
  /**
   * Fornecedor do terceiro. Nulo é interno, que é o padrão. Pessoa que
   * troca de empresa vira outro recurso: o histórico precisa do vínculo
   * de quando as tarefas foram feitas.
   */
  fornecedorId?: string | null | undefined;
  custoHora?: number | null | undefined;
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
  if (d.custoHora !== null && d.custoHora !== undefined && d.custoHora < 0) {
    throw new ErroDominio("O custo por hora não pode ser negativo");
  }
}

function linhaRecurso(d: DadosRecurso) {
  return {
    usuario_id: d.usuarioId ?? null,
    nome: d.nome.trim(),
    papel: d.papel?.trim() ?? null,
    equipe_id: d.equipeId ?? null,
    localidade_id: d.localidadeId ?? null,
    fornecedor_id: d.fornecedorId ?? null,
    custo_hora: d.custoHora ?? null,
    horas_dia: d.horasDia ?? HORAS_DIA_PADRAO,
    disponibilidade_projetos: d.disponibilidadeProjetos,
  };
}

/**
 * Cadastro avulso. Serve ao recurso externo — consultoria, terceiro —
 * que não tem conta e por isso não aparece na criação em lote.
 */
export async function criarRecurso(ctx: ContextoUsuario, d: DadosRecurso): Promise<string> {
  exigirGestaoRecursos(ctx, "cadastrar recursos");
  validar(d);
  const { data, error } = await getSupabaseServerClient()
    .from("recursos")
    .insert({ tenant_id: ctx.tenantId, ...linhaRecurso(d) })
    .select("id")
    .single();
  if (error) falha(error);
  return data.id as string;
}

export async function atualizarRecurso(
  ctx: ContextoUsuario,
  id: string,
  d: DadosRecurso,
): Promise<void> {
  exigirGestaoRecursos(ctx, "alterar recursos");
  validar(d);
  const { data, error } = await getSupabaseServerClient()
    .from("recursos")
    .update(linhaRecurso(d))
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Recurso ${id} não encontrado`);
}

/**
 * Altera só a disponibilidade: é a edição do dia a dia, e reescrever a
 * linha inteira sobrescreveria o que o cadastro de usuários mantém.
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
  const { data, error } = await getSupabaseServerClient()
    .from("recursos")
    .update({ disponibilidade_projetos: disponibilidadeProjetos })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Recurso ${id} não encontrado`);
}

/**
 * Desativa em vez de excluir: tarefas de projeto apontam para o recurso,
 * e apagar perderia o histórico de quem executou o quê.
 */
export async function definirRecursoAtivo(
  ctx: ContextoUsuario,
  id: string,
  ativo: boolean,
): Promise<void> {
  exigirGestaoRecursos(ctx, "alterar recursos");
  const { error } = await getSupabaseServerClient()
    .from("recursos")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) falha(error);
}

// ------------------------------------------------- cálculo sobre projetos
// Ainda no banco legado: lê as tabelas de projetos. Migra com Projetos.

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

/** "YYYY-MM-DD" a partir dos componentes locais, sem passar pelo fuso. */
function paraTextoData(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

const deTextoData = (s: string): Date => new Date(`${s.slice(0, 10)}T00:00:00`);

export async function listarAusencias(filtro: {
  recursoId?: string | null | undefined;
  de?: Date | null | undefined;
  ate?: Date | null | undefined;
}): Promise<Ausencia[]> {
  let q = getSupabaseServerClient()
    .from("recurso_ausencias_v")
    .select("*")
    .eq("tenant_id", await tenantAtual());
  if (filtro.recursoId) q = q.eq("recurso_id", filtro.recursoId);
  if (filtro.de) q = q.gte("fim", paraTextoData(filtro.de));
  if (filtro.ate) q = q.lte("inicio", paraTextoData(filtro.ate));

  const { data, error } = await q.order("inicio", { ascending: false });
  if (error) falha(error);
  return (data ?? []).map((a) => ({
    id: a.id as string,
    recursoId: a.recurso_id as string,
    recursoNome: a.recurso_nome as string,
    tipo: a.tipo as TipoAusencia,
    inicio: deTextoData(a.inicio as string),
    fim: deTextoData(a.fim as string),
    observacao: (a.observacao as string | null) ?? null,
    criadoPorNome: (a.criado_por_nome as string | null) ?? null,
    criadoEm: new Date(a.criado_em as string),
  }));
}

export interface DadosAusencia {
  recursoId: string;
  tipo: TipoAusencia;
  inicio: Date;
  fim: Date;
  observacao?: string | null | undefined;
}

/** Duas ausências do mesmo recurso não se sobrepõem: edita-se a existente. */
async function exigirSemConflito(recursoId: string, inicio: Date, fim: Date, ignorar?: string) {
  let q = getSupabaseServerClient()
    .from("recurso_ausencias_v")
    .select("id")
    .eq("tenant_id", await tenantAtual())
    .eq("recurso_id", recursoId)
    .lte("inicio", paraTextoData(fim))
    .gte("fim", paraTextoData(inicio));
  if (ignorar) q = q.neq("id", ignorar);
  const { data, error } = await q.limit(1);
  if (error) falha(error);
  if (data?.length) {
    throw new ErroDominio(
      "Já existe uma ausência deste recurso no período. Edite a existente em vez de criar outra.",
    );
  }
}

export async function criarAusencia(ctx: ContextoUsuario, d: DadosAusencia): Promise<string> {
  exigirGestaoRecursos(ctx, "registrar ausências");
  if (d.fim < d.inicio) throw new ErroDominio("Data final anterior à inicial");
  await exigirSemConflito(d.recursoId, d.inicio, d.fim);

  const { data, error } = await getSupabaseServerClient()
    .from("recurso_ausencias")
    .insert({
      tenant_id: ctx.tenantId,
      recurso_id: d.recursoId,
      tipo: d.tipo,
      inicio: paraTextoData(d.inicio),
      fim: paraTextoData(d.fim),
      observacao: d.observacao?.trim() ?? null,
      criado_por_id: ctx.id,
    })
    .select("id")
    .single();
  if (error) falha(error);
  return data.id as string;
}

export async function atualizarAusencia(
  ctx: ContextoUsuario,
  id: string,
  d: Omit<DadosAusencia, "recursoId">,
): Promise<void> {
  exigirGestaoRecursos(ctx, "alterar ausências");
  if (d.fim < d.inicio) throw new ErroDominio("Data final anterior à inicial");

  const atual = await getSupabaseServerClient()
    .from("recurso_ausencias_v")
    .select("recurso_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (atual.error) falha(atual.error);
  if (!atual.data) throw new ErroDominio(`Ausência ${id} não encontrada`);
  await exigirSemConflito(atual.data.recurso_id as string, d.inicio, d.fim, id);

  const { error } = await getSupabaseServerClient()
    .from("recurso_ausencias")
    .update({
      tipo: d.tipo,
      inicio: paraTextoData(d.inicio),
      fim: paraTextoData(d.fim),
      observacao: d.observacao?.trim() ?? null,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) falha(error);
}

/** Exclusão lógica: a ausência sai da lista e do cronograma, e fica no histórico. */
export async function excluirAusencia(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirGestaoRecursos(ctx, "excluir ausências");
  const { data, error } = await getSupabaseServerClient()
    .from("recurso_ausencias")
    .update({ excluido_em: new Date().toISOString(), excluido_por: ctx.id })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .is("excluido_em", null)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Ausência ${id} não encontrada`);
}

// ------------------------------------------- calendário do cronograma
// Ainda no banco legado: lê as tabelas de projetos. Migra com Projetos.

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

// ------------------------------------------------------- fornecedores

export interface Fornecedor {
  id: string;
  nome: string;
  cnpj: string | null;
  contatoNome: string | null;
  contatoEmail: string | null;
  contatoTelefone: string | null;
  custoHoraPadrao: number | null;
  observacao: string | null;
  ativo: boolean;
  /** Recursos ativos ligados ao fornecedor. */
  recursos: number;
}

export async function listarFornecedores(apenasAtivos = false): Promise<Fornecedor[]> {
  let q = getSupabaseServerClient()
    .from("fornecedores_v")
    .select("*")
    .eq("tenant_id", await tenantAtual());
  if (apenasAtivos) q = q.eq("ativo", true);
  const { data, error } = await q.order("nome");
  if (error) falha(error);
  return (data ?? []).map((f) => ({
    id: f.id as string,
    nome: f.nome as string,
    cnpj: (f.cnpj as string | null) ?? null,
    contatoNome: (f.contato_nome as string | null) ?? null,
    contatoEmail: (f.contato_email as string | null) ?? null,
    contatoTelefone: (f.contato_telefone as string | null) ?? null,
    custoHoraPadrao: num(f.custo_hora_padrao),
    observacao: (f.observacao as string | null) ?? null,
    ativo: f.ativo as boolean,
    recursos: Number(f.recursos ?? 0),
  }));
}

export interface DadosFornecedor {
  nome: string;
  cnpj?: string | null | undefined;
  contatoNome?: string | null | undefined;
  contatoEmail?: string | null | undefined;
  contatoTelefone?: string | null | undefined;
  custoHoraPadrao?: number | null | undefined;
  observacao?: string | null | undefined;
}

/** Só os dígitos; vazio vira nulo; precisa ter 14. */
function limparCnpj(v: string | null | undefined): string | null {
  const digitos = (v ?? "").replace(/\D/g, "");
  if (digitos === "") return null;
  if (digitos.length !== 14) throw new ErroDominio("O CNPJ deve ter 14 dígitos");
  return digitos;
}

function validarFornecedor(d: DadosFornecedor): void {
  if (d.nome.trim().length < 2) throw new ErroDominio("Informe o nome do fornecedor");
  if (d.custoHoraPadrao !== null && d.custoHoraPadrao !== undefined && d.custoHoraPadrao < 0) {
    throw new ErroDominio("O custo por hora não pode ser negativo");
  }
}

function linhaFornecedor(d: DadosFornecedor) {
  return {
    nome: d.nome.trim(),
    cnpj: limparCnpj(d.cnpj),
    contato_nome: d.contatoNome?.trim() ?? null,
    contato_email: d.contatoEmail?.trim() ?? null,
    contato_telefone: d.contatoTelefone?.trim() ?? null,
    custo_hora_padrao: d.custoHoraPadrao ?? null,
    observacao: d.observacao?.trim() ?? null,
  };
}

export async function criarFornecedor(ctx: ContextoUsuario, d: DadosFornecedor): Promise<string> {
  exigirGestaoRecursos(ctx, "cadastrar fornecedores");
  validarFornecedor(d);
  const { data, error } = await getSupabaseServerClient()
    .from("fornecedores")
    .insert({ tenant_id: ctx.tenantId, ...linhaFornecedor(d) })
    .select("id")
    .single();
  if (error) falha(error);
  return data.id as string;
}

export async function atualizarFornecedor(
  ctx: ContextoUsuario,
  id: string,
  d: DadosFornecedor,
): Promise<void> {
  exigirGestaoRecursos(ctx, "alterar fornecedores");
  validarFornecedor(d);
  const { data, error } = await getSupabaseServerClient()
    .from("fornecedores")
    .update(linhaFornecedor(d))
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Fornecedor ${id} não encontrado`);
}

export async function definirFornecedorAtivo(
  ctx: ContextoUsuario,
  id: string,
  ativo: boolean,
): Promise<void> {
  exigirGestaoRecursos(ctx, "alterar fornecedores");
  const { data, error } = await getSupabaseServerClient()
    .from("fornecedores")
    .update({ ativo })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio(`Fornecedor ${id} não encontrado`);
}