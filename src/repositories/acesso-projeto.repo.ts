import {
  consultar,
  consultarUm,
  executar,
  emTransacao,
} from "@/integrations/postgres/client.server";
import { ErroDominio, paraBool } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Acesso a projeto sigiloso.
 *
 * Duas perguntas diferentes, que antes eram uma só:
 *
 *   "posso ver que este projeto existe?"  -> SQL_PODE_VER_NOME
 *   "posso abrir este projeto?"           -> SQL_TEM_ACESSO
 *
 * O backlog passa a responder a primeira para todo mundo — é o que
 * evita duas pessoas cadastrarem a mesma demanda sem saber uma da
 * outra. Projeto sigiloso é a exceção: para quem não tem acesso, ele
 * não existe.
 *
 * `SQL_TEM_ACESSO` é irmão do `SQL_EXECUTA_PROJETO` de projetos.repo,
 * mas não é o mesmo: aquele decide escrita, este decide leitura, e
 * acesso concedido por solicitação entra aqui sem virar permissão de
 * editar cronograma alheio.
 *
 * Binds esperados em todos eles: `:usuarioId`, `:admin` (0/1) e
 * `:visaoDiretoria` (0/1). Vão com CAST porque repetem dentro da mesma
 * consulta — e CAST(... AS ...), nunca `::`, que a camada de binds
 * nomeados leria como um segundo bind.
 */

export type SituacaoSolicitacao = "pendente" | "aprovada" | "recusada" | "cancelada";

export interface SolicitacaoAcesso {
  id: string;
  projetoId: string;
  projetoNome: string;
  solicitanteId: string;
  solicitanteNome: string;
  solicitanteEmail: string | null;
  solicitanteDepartamento: string | null;
  justificativa: string | null;
  situacao: SituacaoSolicitacao;
  decididoPorId: string | null;
  decididoPorNome: string | null;
  decididoEm: Date | null;
  motivoRecusa: string | null;
  criadoEm: Date;
}

/** Acesso pleno: abrir o projeto e ler cronograma, riscos e atenções. */
export const SQL_TEM_ACESSO_PROJETO = `(
     CAST(:admin AS smallint) = 1
  OR CAST(:visaoDiretoria AS smallint) = 1
  OR p.gerente_id = CAST(:usuarioId AS varchar)
  OR p.sponsor_id = CAST(:usuarioId AS varchar)
  OR EXISTS (SELECT 1
               FROM projeto_acessos pa
              WHERE pa.projeto_id = p.id
                AND pa.usuario_id = CAST(:usuarioId AS varchar))
  OR EXISTS (SELECT 1
               FROM projeto_tarefas t
               JOIN tarefa_responsaveis tr ON tr.tarefa_id = t.id
               JOIN recursos r ON r.id = tr.recurso_id
              WHERE t.projeto_id = p.id
                AND t.ativo = 1
                AND r.usuario_id = CAST(:usuarioId AS varchar))
)`;

/** Ver o nome na carteira: todo projeto, menos o sigiloso alheio. */
export const SQL_PODE_VER_NOME_PROJETO = `(p.sigiloso = 0 OR ${SQL_TEM_ACESSO_PROJETO})`;

/** Binds que as duas cláusulas acima exigem. */
export function bindsDeAcesso(ctx: ContextoUsuario): Record<string, unknown> {
  return {
    usuarioId: ctx.id,
    admin: ctx.admin ? 1 : 0,
    visaoDiretoria: ctx.visaoDiretoriaProjetos ? 1 : 0,
  };
}

/**
 * A linha crua é idêntica ao tipo público: a camada de binds já entrega
 * as colunas em camelCase, e não há booleano SMALLINT nesta consulta
 * para converter. O alias existe só para o SELECT abaixo se declarar.
 */
type LinhaSolicitacao = SolicitacaoAcesso;

const SELECT_SOLICITACAO = `
  SELECT s.id,
         s.projeto_id,
         p.nome          AS projeto_nome,
         s.solicitante_id,
         us.nome         AS solicitante_nome,
         us.email        AS solicitante_email,
         us.departamento AS solicitante_departamento,
         s.justificativa,
         s.situacao,
         s.decidido_por_id,
         ud.nome         AS decidido_por_nome,
         s.decidido_em,
         s.motivo_recusa,
         s.criado_em
    FROM projeto_solicitacoes_acesso s
    JOIN projetos p  ON p.id  = s.projeto_id
    JOIN usuarios us ON us.id = s.solicitante_id
    LEFT JOIN usuarios ud ON ud.id = s.decidido_por_id`;

// --------------------------------------------------------------- consultas

export async function temAcessoAoProjeto(
  ctx: ContextoUsuario,
  projetoId: string,
): Promise<boolean> {
  const r = await consultarUm<{ ok: number }>(
    `SELECT CASE WHEN ${SQL_TEM_ACESSO_PROJETO} THEN 1 ELSE 0 END AS ok
       FROM projetos p
      WHERE p.id = :projetoId`,
    { ...bindsDeAcesso(ctx), projetoId },
  );
  return paraBool(r?.ok ?? 0);
}

/**
 * Ids que o usuário pode abrir.
 *
 * O backlog lista a carteira inteira e precisa decidir, por linha,
 * entre "abrir" e "solicitar acesso". Um Set carregado de uma vez
 * resolve isso sem uma consulta por linha.
 */
export async function idsComAcesso(ctx: ContextoUsuario): Promise<string[]> {
  const linhas = await consultar<{ id: string }>(
    `SELECT p.id FROM projetos p WHERE ${SQL_TEM_ACESSO_PROJETO}`,
    bindsDeAcesso(ctx),
  );
  return linhas.map((l) => l.id);
}

export async function listarMinhasSolicitacoes(ctx: ContextoUsuario): Promise<SolicitacaoAcesso[]> {
  return consultar<LinhaSolicitacao>(
    `${SELECT_SOLICITACAO}
      WHERE s.solicitante_id = :usuarioId
      ORDER BY s.criado_em DESC`,
    { usuarioId: ctx.id },
  );
}

/**
 * Fila de aprovação.
 *
 * Gerente e patrocinador veem os pedidos dos seus projetos. O
 * administrador vê todos, porque é quem destrava o caso do gerente que
 * saiu da empresa — sem isso o pedido ficaria pendente para sempre.
 */
export async function listarSolicitacoesParaAprovar(
  ctx: ContextoUsuario,
  incluirDecididas = false,
): Promise<SolicitacaoAcesso[]> {
  const situacao = incluirDecididas ? "" : `AND s.situacao = 'pendente'`;
  const meus = ctx.admin ? "" : `AND (p.gerente_id = :usuarioId OR p.sponsor_id = :usuarioId)`;

  return consultar<LinhaSolicitacao>(
    `${SELECT_SOLICITACAO}
      WHERE 1 = 1 ${situacao} ${meus}
      ORDER BY CASE WHEN s.situacao = 'pendente' THEN 0 ELSE 1 END,
               s.criado_em DESC`,
    ctx.admin ? {} : { usuarioId: ctx.id },
  );
}

export async function contarSolicitacoesPendentes(ctx: ContextoUsuario): Promise<number> {
  const meus = ctx.admin ? "" : `AND (p.gerente_id = :usuarioId OR p.sponsor_id = :usuarioId)`;
  const r = await consultarUm<{ total: number }>(
    `SELECT COUNT(*)::int AS total
       FROM projeto_solicitacoes_acesso s
       JOIN projetos p ON p.id = s.projeto_id
      WHERE s.situacao = 'pendente' ${meus}`,
    ctx.admin ? {} : { usuarioId: ctx.id },
  );
  return r?.total ?? 0;
}

// ------------------------------------------------------------------ escrita

/**
 * Abre um pedido de acesso.
 *
 * Pedir acesso a um sigiloso que a pessoa não enxerga devolve o mesmo
 * erro de projeto inexistente: aceitar o pedido já confirmaria que
 * aquele id existe, que é exatamente o que o sigilo esconde. É a mesma
 * escolha do `exigirLeituraProjeto` em projetos.repo.
 */
export async function solicitarAcesso(
  ctx: ContextoUsuario,
  projetoId: string,
  justificativa: string | null,
): Promise<string> {
  const projeto = await consultarUm<{ id: string; temAcesso: number }>(
    `SELECT p.id,
            CASE WHEN ${SQL_TEM_ACESSO_PROJETO} THEN 1 ELSE 0 END AS tem_acesso
       FROM projetos p
      WHERE p.id = :projetoId
        AND ${SQL_PODE_VER_NOME_PROJETO}`,
    { ...bindsDeAcesso(ctx), projetoId },
  );
  if (!projeto) throw new ErroDominio(`Projeto ${projetoId} não encontrado`);
  if (paraBool(projeto.temAcesso)) throw new ErroDominio("Você já tem acesso a este projeto");

  const pendente = await consultarUm<{ id: string }>(
    `SELECT id FROM projeto_solicitacoes_acesso
      WHERE projeto_id = :projetoId AND solicitante_id = :usuarioId AND situacao = 'pendente'`,
    { projetoId, usuarioId: ctx.id },
  );
  if (pendente) throw new ErroDominio("Já existe uma solicitação em análise para este projeto");

  const id = crypto.randomUUID();
  await executar(
    `INSERT INTO projeto_solicitacoes_acesso
       (id, projeto_id, solicitante_id, justificativa, situacao, criado_em, atualizado_em)
     VALUES
       (:id, :projetoId, :usuarioId, :justificativa, 'pendente', LOCALTIMESTAMP, LOCALTIMESTAMP)`,
    {
      id,
      projetoId,
      usuarioId: ctx.id,
      justificativa: justificativa?.trim() || null,
    },
  );
  return id;
}

/** O solicitante desiste, enquanto ninguém decidiu. */
export async function cancelarSolicitacao(ctx: ContextoUsuario, id: string): Promise<void> {
  const n = await executar(
    `UPDATE projeto_solicitacoes_acesso
        SET situacao = 'cancelada', atualizado_em = LOCALTIMESTAMP
      WHERE id = :id AND solicitante_id = :usuarioId AND situacao = 'pendente'`,
    { id, usuarioId: ctx.id },
  );
  if (n === 0) throw new ErroDominio("Solicitação não encontrada ou já decidida");
}

/**
 * Aprova ou recusa.
 *
 * Em transação porque aprovar tem dois efeitos — fechar o pedido e
 * conceder o acesso —, e metade disso deixaria a pessoa com um pedido
 * aprovado que não abre nada.
 */
export async function decidirSolicitacao(
  ctx: ContextoUsuario,
  id: string,
  aprovar: boolean,
  motivo?: string | null | undefined,
): Promise<void> {
  if (!aprovar && (motivo?.trim() ?? "") === "") {
    throw new ErroDominio("Informe o motivo da recusa");
  }

  await emTransacao(async (tx) => {
    const meus = ctx.admin ? "" : `AND (p.gerente_id = :usuarioId OR p.sponsor_id = :usuarioId)`;

    const linhas = await tx.consultar<{
      projetoId: string;
      solicitanteId: string;
    }>(
      `SELECT s.projeto_id, s.solicitante_id
         FROM projeto_solicitacoes_acesso s
         JOIN projetos p ON p.id = s.projeto_id
        WHERE s.id = :id AND s.situacao = 'pendente' ${meus}`,
      ctx.admin ? { id } : { id, usuarioId: ctx.id },
    );

    const s = linhas[0];
    if (!s) {
      throw new ErroDominio(
        "Solicitação não encontrada, já decidida, ou você não responde por este projeto",
      );
    }

    await tx.executar(
      `UPDATE projeto_solicitacoes_acesso
          SET situacao = :situacao,
              decidido_por_id = :decisorId,
              decidido_em = LOCALTIMESTAMP,
              motivo_recusa = :motivo,
              atualizado_em = LOCALTIMESTAMP
        WHERE id = :id`,
      {
        id,
        situacao: aprovar ? "aprovada" : "recusada",
        decisorId: ctx.id,
        motivo: aprovar ? null : (motivo?.trim() ?? null),
      },
    );

    if (aprovar) {
      await tx.executar(
        `INSERT INTO projeto_acessos
           (projeto_id, usuario_id, concedido_por_id, origem, criado_em)
         VALUES (:projetoId, :usuarioId, :decisorId, 'solicitacao', LOCALTIMESTAMP)
         ON CONFLICT (projeto_id, usuario_id) DO NOTHING`,
        {
          projetoId: s.projetoId,
          usuarioId: s.solicitanteId,
          decisorId: ctx.id,
        },
      );
    }
  });
}

// ------------------------------------------------------------ acesso direto

export interface AcessoProjeto {
  usuarioId: string;
  usuarioNome: string;
  usuarioEmail: string | null;
  origem: "solicitacao" | "manual";
  concedidoPorNome: string | null;
  criadoEm: Date;
}

export async function listarAcessos(
  ctx: ContextoUsuario,
  projetoId: string,
): Promise<AcessoProjeto[]> {
  if (!(await temAcessoAoProjeto(ctx, projetoId))) {
    throw new ErroDominio(`Projeto ${projetoId} não encontrado`);
  }
  return consultar<AcessoProjeto>(
    `SELECT pa.usuario_id, u.nome AS usuario_nome, u.email AS usuario_email,
            pa.origem, uc.nome AS concedido_por_nome, pa.criado_em
       FROM projeto_acessos pa
       JOIN usuarios u ON u.id = pa.usuario_id
       LEFT JOIN usuarios uc ON uc.id = pa.concedido_por_id
      WHERE pa.projeto_id = :projetoId
      ORDER BY u.nome`,
    { projetoId },
  );
}

/** Concessão sem pedido: o gerente já sabe quem precisa entrar. */
export async function concederAcesso(
  ctx: ContextoUsuario,
  projetoId: string,
  usuarioId: string,
): Promise<void> {
  await exigirGestaoDoProjeto(ctx, projetoId, "conceder acesso");
  await executar(
    `INSERT INTO projeto_acessos (projeto_id, usuario_id, concedido_por_id, origem, criado_em)
     VALUES (:projetoId, :usuarioId, :decisorId, 'manual', LOCALTIMESTAMP)
     ON CONFLICT (projeto_id, usuario_id) DO NOTHING`,
    { projetoId, usuarioId, decisorId: ctx.id },
  );
}

export async function revogarAcesso(
  ctx: ContextoUsuario,
  projetoId: string,
  usuarioId: string,
): Promise<void> {
  await exigirGestaoDoProjeto(ctx, projetoId, "revogar acesso");
  await executar(
    `DELETE FROM projeto_acessos WHERE projeto_id = :projetoId AND usuario_id = :usuarioId`,
    { projetoId, usuarioId },
  );
}

/**
 * Só gerente e patrocinador mexem na lista de acesso.
 *
 * Responsável por tarefa fica de fora de propósito: ele executa, mas
 * quem responde por quem entra no projeto sigiloso é quem responde pelo
 * projeto.
 */
async function exigirGestaoDoProjeto(
  ctx: ContextoUsuario,
  projetoId: string,
  acao: string,
): Promise<void> {
  if (ctx.admin) return;
  const r = await consultarUm<{ id: string }>(
    `SELECT id FROM projetos
      WHERE id = :projetoId
        AND (gerente_id = :usuarioId OR sponsor_id = :usuarioId)`,
    { projetoId, usuarioId: ctx.id },
  );
  if (!r) throw new ErroDominio(`Somente o gerente ou o patrocinador do projeto pode ${acao}`);
}

// ------------------------------------------------------------ notificação

/**
 * Tudo o que um aviso de solicitação precisa, numa consulta.
 *
 * Fica no repositório, como todo o resto do SQL. Quem envia o e-mail
 * monta o texto; quem conhece as colunas é aqui.
 *
 * O destinatário do aviso é o gerente, e o patrocinador entra como
 * reserva: projeto sem gerente cadastrado existe, e um pedido que não
 * avisa ninguém fica esperando para sempre.
 */
export interface DadosAviso {
  solicitacaoId: string;
  situacao: SituacaoSolicitacao;
  justificativa: string | null;
  motivoRecusa: string | null;
  projetoId: string;
  projetoNome: string;
  /** Quem decide: gerente, ou o patrocinador quando não há gerente. */
  decisorId: string | null;
  decisorEmail: string | null;
  decisorNome: string | null;
  solicitanteId: string;
  solicitanteNome: string;
  solicitanteEmail: string | null;
  solicitanteDepartamento: string | null;
  /** Quem de fato decidiu, preenchido depois da aprovação ou recusa. */
  decididoPorNome: string | null;
}

export async function dadosParaAviso(solicitacaoId: string): Promise<DadosAviso | null> {
  return consultarUm<DadosAviso>(
    `SELECT s.id                AS solicitacao_id,
            s.situacao,
            s.justificativa,
            s.motivo_recusa,
            p.id                AS projeto_id,
            p.nome              AS projeto_nome,
            COALESCE(p.gerente_id, p.sponsor_id)     AS decisor_id,
            COALESCE(ug.email, usp.email)            AS decisor_email,
            COALESCE(ug.nome, usp.nome)              AS decisor_nome,
            s.solicitante_id,
            us.nome             AS solicitante_nome,
            us.email            AS solicitante_email,
            us.departamento     AS solicitante_departamento,
            ud.nome             AS decidido_por_nome
       FROM projeto_solicitacoes_acesso s
       JOIN projetos p  ON p.id  = s.projeto_id
       JOIN usuarios us ON us.id = s.solicitante_id
       LEFT JOIN usuarios ug  ON ug.id  = p.gerente_id
       LEFT JOIN usuarios usp ON usp.id = p.sponsor_id
       LEFT JOIN usuarios ud  ON ud.id  = s.decidido_por_id
      WHERE s.id = :id`,
    { id: solicitacaoId },
  );
}
