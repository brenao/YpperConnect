/**
 * Plano contratado: o que ele libera. Usado no servidor e no navegador.
 *
 * Cada rota paga pertence a um módulo comercial. Rotas sem módulo
 * (painel inicial, administração, plataforma, assinatura) são sempre
 * liberadas: sem elas não há como regularizar a conta.
 */

export type ModuloComercial = "itsm" | "projetos" | "ia";

export type AcessoPlano = "total" | "total_com_aviso" | "somente_leitura" | "bloqueado";

export interface SituacaoPlano {
  status: string;
  plano: string | null;
  nivel: "essencial" | "pro" | null;
  cortesia: boolean;
  modulos: ModuloComercial[];
  ia: boolean;
  acesso: AcessoPlano;
  usuariosContratados: number;
  usuariosPagantes: number;
  testeAte: string | null;
  periodoFim: string | null;
}

const ROTAS_POR_MODULO: Record<ModuloComercial, string[]> = {
  itsm: ["/chamados", "/catalogo", "/conhecimento", "/governanca"],
  projetos: ["/projetos", "/backlog", "/recursos", "/diretoria"],
  ia: ["/assistente"],
};

/** Módulo comercial de uma rota, ou null se a rota é sempre liberada. */
export function moduloDaRota(caminho: string): ModuloComercial | null {
  for (const [modulo, rotas] of Object.entries(ROTAS_POR_MODULO) as [ModuloComercial, string[]][]) {
    if (
      rotas.some((r) => caminho === r || caminho.startsWith(`${r}/`) || caminho.startsWith(`${r}_`))
    ) {
      return modulo;
    }
  }
  return null;
}

/** A rota está no plano? (IA conta como módulo: Pro ou add-on.) */
export function rotaNoPlano(caminho: string, plano: SituacaoPlano): boolean {
  const modulo = moduloDaRota(caminho);
  if (!modulo) return true;
  if (modulo === "ia") return plano.ia;
  return plano.modulos.includes(modulo);
}

export const SEM_PLANO: SituacaoPlano = {
  status: "sem_assinatura",
  plano: null,
  nivel: null,
  cortesia: false,
  modulos: [],
  ia: false,
  acesso: "bloqueado",
  usuariosContratados: 0,
  usuariosPagantes: 0,
  testeAte: null,
  periodoFim: null,
};

/** JSON de situacao_assinatura (banco) no formato do app. */
export function paraSituacaoPlano(j: Record<string, unknown> | null | undefined): SituacaoPlano {
  if (!j) return SEM_PLANO;
  return {
    status: String(j["status"] ?? "sem_assinatura"),
    plano: (j["plano"] as string | undefined) ?? null,
    nivel: (j["nivel"] as SituacaoPlano["nivel"] | undefined) ?? null,
    cortesia: j["cortesia"] === true,
    modulos: (j["modulos"] as ModuloComercial[] | undefined) ?? [],
    ia: j["ia"] === true,
    acesso: (j["acesso"] as AcessoPlano | undefined) ?? "bloqueado",
    usuariosContratados: Number(j["usuarios_contratados"] ?? 0),
    usuariosPagantes: Number(j["usuarios_pagantes"] ?? 0),
    testeAte: (j["teste_ate"] as string | null | undefined) ?? null,
    periodoFim: (j["periodo_fim"] as string | null | undefined) ?? null,
  };
}