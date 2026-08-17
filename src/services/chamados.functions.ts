import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server functions dos chamados. Só existem para expor os repositórios
 * ao cliente — sem regra de negócio aqui.
 *
 * Os repositórios são importados dinamicamente dentro do handler para
 * o driver do Postgres nunca entrar no bundle do navegador.
 *
 * Os tipos inferidos do Zod são exportados porque as telas precisam
 * tipar as mutations: Parameters<typeof fn>[0]["data"] não funciona,
 * já que o parâmetro da server function é opcional.
 */

const STATUS = ["novo", "triagem", "em_andamento", "aguardando", "resolvido", "fechado"] as const;
const TIPOS = ["incidente", "requisicao", "melhoria", "problema", "tarefa"] as const;
const IMPACTOS = ["alto", "medio", "baixo"] as const;
const URGENCIAS = ["alta", "media", "baixa"] as const;
const ORIGENS = ["portal", "ia", "email", "telefone"] as const;

const Filtro = z.object({
  status: z.array(z.enum(STATUS)).optional(),
  responsavelId: z.string().optional(),
  solicitanteId: z.string().optional(),
  equipeId: z.string().optional(),
  vencidos: z.boolean().optional(),
  limite: z.number().int().positive().max(500).optional(),
});

export type FiltroChamadosInput = z.infer<typeof Filtro>;

export const listarChamadosFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => Filtro.parse(d ?? {}))
  .handler(async ({ data }) => {
    const { listarChamados } = await import("@/repositories/chamados.repo");
    return listarChamados(data);
  });

export const buscarChamadoFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { buscarChamado, listarInteracoes, listarHistorico } =
      await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");

    const ctx = await getUsuarioAtual();
    const chamado = await buscarChamado(data.id);
    if (!chamado) return null;

    const [interacoes, historico] = await Promise.all([
      listarInteracoes(ctx, data.id),
      listarHistorico(data.id),
    ]);

    return { chamado, interacoes, historico };
  });

const Novo = z.object({
  titulo: z.string().min(3).max(300),
  descricao: z.string().min(5),
  tipo: z.enum(TIPOS),
  categoriaId: z.string().nullable().optional(),
  servicoId: z.string().nullable().optional(),
  sistemaId: z.string().nullable().optional(),
  impacto: z.enum(IMPACTOS),
  urgencia: z.enum(URGENCIAS),
  equipeId: z.string().nullable().optional(),
  origem: z.enum(ORIGENS).optional(),
});

export type NovoChamadoInput = z.infer<typeof Novo>;

export const criarChamadoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => Novo.parse(d))
  .handler(async ({ data }) => {
    const { criarChamado } = await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");
    const ctx = await getUsuarioAtual();
    const r = await criarChamado(ctx, data);

    // Fora da transação do chamado: um relay indisponível não pode
    // impedir a abertura. Falha aqui só deixa o chamado sem aviso.
    try {
      await avisar({
        tipo: "chamado_criado",
        destinatarios: [ctx.id, r.responsavelId],
        autorId: ctx.id,
        assunto: `[${r.codigo}] ${data.titulo}`,
        corpo:
          `O chamado ${r.codigo} — ${data.titulo} — foi registrado.\n\n${data.descricao}` +
          (r.responsavelId ? `\n\nAtribuído automaticamente pelo cadastro do sistema.` : ""),
        referenciaId: r.id,
      });
    } catch (e) {
      console.error("Falha ao enfileirar notificação de abertura", e);
    }

    return r;
  });

const Alteracao = z.object({
  id: z.string(),
  status: z.enum(STATUS).optional(),
  responsavelId: z.string().nullable().optional(),
  equipeId: z.string().nullable().optional(),
  impacto: z.enum(IMPACTOS).optional(),
  urgencia: z.enum(URGENCIAS).optional(),
  categoriaId: z.string().nullable().optional(),
  servicoId: z.string().nullable().optional(),
  sistemaId: z.string().nullable().optional(),
  problemaVinculadoId: z.string().nullable().optional(),
  descricaoEncerramento: z.string().nullable().optional(),
});

export type AlteracaoChamadoInput = z.infer<typeof Alteracao>;

export const atualizarChamadoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => Alteracao.parse(d))
  .handler(async ({ data }) => {
    const { atualizarChamado, buscarChamado } = await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");
    const { id, ...mudancas } = data;
    const ctx = await getUsuarioAtual();
    await atualizarChamado(ctx, id, mudancas);

    // Só mudança de status vira e-mail. Reatribuição interna não
    // interessa ao solicitante e geraria ruído.
    if (mudancas.status) {
      try {
        const chamado = await buscarChamado(id);
        if (chamado) {
          await avisar({
            tipo: "chamado_status",
            destinatarios: [chamado.solicitanteId, chamado.responsavelId],
            autorId: ctx.id,
            assunto: `[${chamado.codigo}] Status atualizado: ${mudancas.status}`,
            corpo:
              `O chamado ${chamado.codigo} — ${chamado.titulo} — passou para "${mudancas.status}".` +
              (chamado.descricaoEncerramento
                ? `\n\nEncerramento: ${chamado.descricaoEncerramento}`
                : ""),
            referenciaId: id,
          });
        }
      } catch (e) {
        console.error("Falha ao enfileirar notificação de status", e);
      }
    }

    return { ok: true };
  });

const Interacao = z.object({
  chamadoId: z.string(),
  tipo: z.enum(["comentario", "nota_interna", "email"]),
  corpo: z.string().min(1),
});

export type InteracaoInput = z.infer<typeof Interacao>;

export const adicionarInteracaoFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => Interacao.parse(d))
  .handler(async ({ data }) => {
    const { adicionarInteracao } = await import("@/repositories/chamados.repo");
    const { getUsuarioAtual } = await import("@/services/current-user.server");
    const ctx = await getUsuarioAtual();
    await adicionarInteracao(ctx, data.chamadoId, data.tipo, data.corpo);
    return { ok: true };
  });

/**
 * Enfileira o mesmo aviso para solicitante e responsável.
 *
 * Quem provocou a mudança fica de fora: receber e-mail da própria ação
 * é ruído, e é o caminho mais curto para o time criar regra de caixa de
 * entrada que descarta tudo do sistema.
 */
async function avisar(a: {
  tipo: "chamado_criado" | "chamado_status";
  destinatarios: (string | null | undefined)[];
  autorId: string;
  assunto: string;
  corpo: string;
  referenciaId: string;
}): Promise<void> {
  const ids = [...new Set(a.destinatarios.filter((d): d is string => !!d && d !== a.autorId))];
  if (ids.length === 0) return;

  const { enfileirar } = await import("@/repositories/notificacoes.repo");
  const { consultar } = await import("@/integrations/postgres/client.server");

  const binds: Record<string, unknown> = {};
  const chaves = ids.map((id, i) => {
    binds[`u${i}`] = id;
    return `:u${i}`;
  });

  const pessoas = await consultar<{ id: string; email: string }>(
    `SELECT id, email FROM usuarios WHERE ativo = 1 AND email IS NOT NULL
      AND id IN (${chaves.join(",")})`,
    binds,
  );

  for (const p of pessoas) {
    await enfileirar({
      tipo: a.tipo,
      destinatarioId: p.id,
      destinatarioEmail: p.email,
      assunto: a.assunto,
      corpo: a.corpo,
      referenciaTipo: "chamado",
      referenciaId: a.referenciaId,
    });
  }
}
