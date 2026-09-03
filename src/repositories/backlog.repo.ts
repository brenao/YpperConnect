import {
  consultar,
  consultarUm,
  executar,
  emTransacao,
} from "@/integrations/postgres/client.server";
import { ErroDominio } from "./tipos";
import { filtroVisibilidadeProjetos } from "./projetos.repo";
import { MODELO_PADRAO, type ModeloPriorizacao } from "@/services/priorizacao";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Backlog de demandas.
 *
 * Mora na mesma tabela `projetos`, com `status = 'backlog'`. Uma tabela
 * separada obrigaria a copiar a demanda inteira ao promovê-la, e o id
 * mudaria — quebrando qualquer referência que já existisse a ela. Aqui
 * promover é trocar o status: o histórico continua sendo do mesmo
 * registro.
 */

export interface ProjetoBacklog {
  id: string;
  nome: string;
  objetivo: string | null;
  areaDemandante: string | null;
  justificativa: string | null;
  /** Gerente indicado. No backlog costuma ser quem registrou. */
  gerenteId: string | null;
  gerenteNome: string | null;
  sponsorId: string | null;
  sponsorNome: string | null;
  usaDiasUteis: boolean;
  valor: number | null;
  esforco: number | null;
  alcance: number | null;
  confianca: number | null;
  ordemBacklog: number | null;
  /** Sempre 'backlog' aqui, mas presente para o formulário reusar o tipo. */
  status: string;
  inicio: Date;
  fim: Date;
  criadoEm: Date;
  atualizadoEm: Date;
}

const SELECT_BACKLOG = `
  SELECT p.id, p.nome, p.objetivo, p.area_demandante, p.justificativa,
         p.gerente_id, ug.nome AS gerente_nome,
         p.sponsor_id, us.nome AS sponsor_nome,
         (p.usa_dias_uteis = 1) AS usa_dias_uteis,
         p.valor, p.esforco, p.alcance, p.confianca, p.ordem_backlog,
         p.status, p.inicio, p.fim,
         p.criado_em, p.atualizado_em
    FROM projetos p
    LEFT JOIN usuarios ug ON ug.id = p.gerente_id
    LEFT JOIN usuarios us ON us.id = p.sponsor_id`;

// ------------------------------------------------------- configuração

/**
 * Modelo de pontuação da instalação.
 *
 * Chave em `configuracoes` em vez de constante: a escolha entre simples
 * e RICE é de cada empresa, e trocar exigiria deploy se estivesse em
 * código. Valor desconhecido cai no padrão — configuração digitada
 * errado não pode derrubar a tela.
 */
export async function modeloPriorizacao(): Promise<ModeloPriorizacao> {
  const c = await consultarUm<{ valor: string }>(
    `SELECT valor FROM configuracoes WHERE chave = 'priorizacao_modelo'`,
  );
  return c?.valor === "rice" ? "rice" : MODELO_PADRAO;
}

export async function definirModeloPriorizacao(
  ctx: ContextoUsuario,
  modelo: ModeloPriorizacao,
): Promise<void> {
  if (!ctx.admin) throw new ErroDominio("Somente administradores podem alterar a priorização");

  await executar(
    `INSERT INTO configuracoes (chave, valor, descricao, atualizado_em)
     VALUES ('priorizacao_modelo', :valor,
             'Modelo de pontuacao do backlog: simples (valor/esforco) ou rice.',
             LOCALTIMESTAMP)
     ON CONFLICT (chave) DO UPDATE
        SET valor = EXCLUDED.valor, atualizado_em = LOCALTIMESTAMP`,
    { valor: modelo },
  );
}

// ------------------------------------------------------------ leitura

/**
 * Backlog visível para este usuário, na ordem definida à mão.
 *
 * Sem ordem gravada a demanda vai para o fim: é o que acontece com a
 * recém-criada, e o topo da lista pertence a quem já foi priorizado.
 * O desempate é pela criação, para a ordem não dançar entre recargas.
 */
export async function listarBacklog(ctx: ContextoUsuario): Promise<ProjetoBacklog[]> {
  const f = filtroVisibilidadeProjetos(ctx);

  return consultar<ProjetoBacklog>(
    `${SELECT_BACKLOG}
      WHERE p.status = 'backlog' AND (${f.clausula})
      ORDER BY p.ordem_backlog NULLS LAST, p.criado_em`,
    f.binds,
  );
}

export async function buscarNoBacklog(
  ctx: ContextoUsuario,
  id: string,
): Promise<ProjetoBacklog | null> {
  const f = filtroVisibilidadeProjetos(ctx);
  return consultarUm<ProjetoBacklog>(`${SELECT_BACKLOG} WHERE p.id = :id AND (${f.clausula})`, {
    ...f.binds,
    id,
  });
}

// ------------------------------------------------------------ escrita

/** Quem mexe no item do backlog: quem registrou, ou quem responde pela carteira. */
async function exigirAcessoDemanda(ctx: ContextoUsuario, id: string): Promise<void> {
  if (ctx.admin || ctx.visaoDiretoriaProjetos || ctx.gestorPortfolio) return;

  const d = await consultarUm<{ gerenteId: string | null }>(
    `SELECT gerente_id FROM projetos WHERE id = :id`,
    { id },
  );
  if (!d) throw new ErroDominio(`Projeto ${id} não encontrado`);
  if (d.gerenteId !== ctx.id) {
    throw new ErroDominio(
      "Somente quem registrou o projeto ou a gestão do portfólio pode alterá-lo",
    );
  }
}

/**
 * Grava a ordem que o gestor arrastou.
 *
 * A ordem manual existe porque o score nunca decide sozinho: contrato
 * que vence, promessa feita à diretoria e dependência externa não cabem
 * em fórmula nenhuma. O número serve para abrir a conversa; a ordem
 * final é a decisão.
 *
 * Em transação e reescrevendo a lista inteira: gravar só o que mudou
 * exigiria saber a posição anterior de cada um, e um erro no meio
 * deixaria duas demandas na mesma posição.
 */
export async function reordenarBacklog(ctx: ContextoUsuario, ids: string[]): Promise<void> {
  if (!ctx.admin && !ctx.visaoDiretoriaProjetos && !ctx.gestorPortfolio) {
    throw new ErroDominio("Somente a gestão do portfólio pode reordenar o backlog");
  }

  await emTransacao(async (tx) => {
    for (const [i, id] of ids.entries()) {
      await tx.executar(
        `UPDATE projetos SET ordem_backlog = :ordem, atualizado_em = LOCALTIMESTAMP
          WHERE id = :id AND status = 'backlog'`,
        { id, ordem: i + 1 },
      );
    }
  });
}

/**
 * Promove a demanda a projeto em planejamento.
 *
 * É o único portão de saída do backlog, e é deliberadamente um ato
 * explícito: enquanto está aqui, a demanda não cobra acompanhamento nem
 * ocupa capacidade. Sair disso é decisão, não consequência de editar um
 * campo.
 *
 * A pontuação fica gravada. Serve para responder depois "por que este
 * entrou antes daquele" — que é a pergunta que aparece quando o projeto
 * atrasa.
 */
export async function promoverDemanda(ctx: ContextoUsuario, id: string): Promise<void> {
  await exigirAcessoDemanda(ctx, id);

  const n = await executar(
    `UPDATE projetos
        SET status = 'planejamento',
            ordem_backlog = NULL,
            inicio = CURRENT_DATE,
            fim = CURRENT_DATE,
            atualizado_em = LOCALTIMESTAMP
      WHERE id = :id AND status = 'backlog'`,
    { id },
  );
  if (n === 0) throw new ErroDominio("Demanda não encontrada ou já promovida");
}

/**
 * Devolve um projeto ao backlog.
 *
 * Existe para o caso de priorização revista — o projeto foi aprovado,
 * nunca começou, e volta para a fila. Recusa quem já tem cronograma:
 * mandar de volta uma tarefa com trabalho registrado esconderia o
 * histórico numa lista que ninguém acompanha.
 */
export async function devolverAoBacklog(ctx: ContextoUsuario, id: string): Promise<void> {
  await exigirAcessoDemanda(ctx, id);

  const t = await consultarUm<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM projeto_tarefas WHERE projeto_id = :id AND ativo = 1`,
    { id },
  );
  if ((t?.total ?? 0) > 0) {
    throw new ErroDominio(
      "Este projeto já tem cronograma. Cancele-o ou remova as tarefas antes de devolvê-lo ao backlog.",
    );
  }

  const n = await executar(
    `UPDATE projetos
        SET status = 'backlog',
            ordem_backlog = (SELECT COALESCE(MAX(ordem_backlog), 0) + 1
                               FROM projetos WHERE status = 'backlog'),
            atualizado_em = LOCALTIMESTAMP
      WHERE id = :id AND status IN ('planejamento','paralisado')`,
    { id },
  );
  if (n === 0) {
    throw new ErroDominio("Só projetos em planejamento ou paralisados voltam ao backlog");
  }
}

/** Descarta a demanda sem apagá-la: o que foi recusado também é resposta. */
export async function descartarDemanda(ctx: ContextoUsuario, id: string): Promise<void> {
  await exigirAcessoDemanda(ctx, id);

  const n = await executar(
    `UPDATE projetos
        SET status = 'cancelado', ordem_backlog = NULL, atualizado_em = LOCALTIMESTAMP
      WHERE id = :id AND status = 'backlog'`,
    { id },
  );
  if (n === 0) throw new ErroDominio("Demanda não encontrada");
}
