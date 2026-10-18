import { getSupabaseServerClient } from "@/integrations/supabase/server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Painel comercial da plataforma. SOMENTE SERVIDOR. Só operadores; o
 * banco confere de novo (funções e RLS da plataforma).
 */

export interface LinhaAssinatura {
  tenantId: string;
  empresa: string;
  slug: string;
  plano: string | null;
  nivel: string | null;
  ciclo: "mensal" | "anual" | null;
  status: string | null;
  cortesia: boolean;
  addonIa: boolean;
  usuariosContratados: number;
  usuariosPagantes: number;
  valorMensalCentavos: number;
  testeAte: string | null;
  periodoFim: string | null;
  afiliadoCodigo: string | null;
}

export interface Plano {
  codigo: string;
  nome: string;
}

export interface Afiliado {
  id: string;
  codigo: string;
  nome: string;
  email: string;
  tipo: "afiliado" | "parceiro";
  comissaoPct: number;
  /** Desconto do comprador que usar o cupom (é o número do código). */
  descontoPct: number;
  mesesRecorrencia: number;
  ativo: boolean;
}

export interface Comissao {
  id: string;
  afiliadoNome: string;
  empresa: string;
  valorCentavos: number;
  status: "prevista" | "liberada" | "paga" | "estornada";
  liberarEm: string | null;
  pagoEm: string | null;
}

function exigirOperador(ctx: ContextoUsuario): void {
  if (!ctx.adminPlataforma) throw new ErroDominio("Somente operadores da plataforma.");
}

function falha(erro: { code?: string; message: string }): never {
  if (erro.code === "42501") throw new ErroDominio("Somente operadores da plataforma.");
  if (erro.code === "P0001" || erro.code === "P0002") throw new ErroDominio(erro.message);
  if (erro.code === "23505") throw new ErroDominio("Já existe um afiliado com esse código.");
  if (erro.code === "23514") throw new ErroDominio("Valor fora do permitido (confira os campos).");
  throw new Error(erro.message);
}

export async function painelAssinaturas(ctx: ContextoUsuario): Promise<LinhaAssinatura[]> {
  exigirOperador(ctx);
  const { data, error } = await getSupabaseServerClient().rpc("painel_assinaturas");
  if (error) falha(error);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    tenantId: r["tenant_id"] as string,
    empresa: r["empresa"] as string,
    slug: r["slug"] as string,
    plano: (r["plano"] as string | null) ?? null,
    nivel: (r["nivel"] as string | null) ?? null,
    ciclo: (r["ciclo"] as LinhaAssinatura["ciclo"]) ?? null,
    status: (r["status"] as string | null) ?? null,
    cortesia: r["cortesia"] === true,
    addonIa: r["addon_ia"] === true,
    usuariosContratados: Number(r["usuarios_contratados"] ?? 0),
    usuariosPagantes: Number(r["usuarios_pagantes"] ?? 0),
    valorMensalCentavos: Number(r["valor_mensal_centavos"] ?? 0),
    testeAte: (r["teste_ate"] as string | null) ?? null,
    periodoFim: (r["periodo_fim"] as string | null) ?? null,
    afiliadoCodigo: (r["afiliado_codigo"] as string | null) ?? null,
  }));
}

export async function listarPlanos(ctx: ContextoUsuario): Promise<Plano[]> {
  exigirOperador(ctx);
  const { data, error } = await getSupabaseServerClient()
    .from("planos")
    .select("codigo, nome")
    .eq("ativo", true)
    .order("ordem");
  if (error) falha(error);
  return (data ?? []).map((p) => ({ codigo: p.codigo as string, nome: p.nome as string }));
}

export interface AjusteAssinatura {
  tenantId: string;
  plano: string;
  ciclo: "mensal" | "anual";
  usuarios: number;
  addonIa: boolean;
  status: string;
  cortesia: boolean;
  periodoFim: string | null;
  afiliadoCodigo: string | null;
}

export async function atualizarAssinatura(
  ctx: ContextoUsuario,
  d: AjusteAssinatura,
): Promise<void> {
  exigirOperador(ctx);
  if (d.usuarios < 3) throw new ErroDominio("O mínimo é de 3 usuários pagantes.");
  const { error } = await getSupabaseServerClient().rpc("atualizar_assinatura", {
    p_tenant: d.tenantId,
    p_plano: d.plano,
    p_ciclo: d.ciclo,
    p_usuarios: d.usuarios,
    p_addon_ia: d.addonIa,
    p_status: d.status,
    p_cortesia: d.cortesia,
    p_periodo_fim: d.periodoFim,
    p_afiliado_codigo: d.afiliadoCodigo,
  });
  if (error) falha(error);
}

export async function listarAfiliados(ctx: ContextoUsuario): Promise<Afiliado[]> {
  exigirOperador(ctx);
  const { data, error } = await getSupabaseServerClient()
    .from("afiliados")
    .select("id, codigo, nome, email, tipo, comissao_pct, desconto_pct, meses_recorrencia, ativo")
    .order("nome");
  if (error) falha(error);
  return (data ?? []).map((a) => ({
    id: a.id as string,
    codigo: a.codigo as string,
    nome: a.nome as string,
    email: a.email as string,
    tipo: a.tipo as Afiliado["tipo"],
    comissaoPct: Number(a.comissao_pct),
    descontoPct: Number(a.desconto_pct ?? 0),
    mesesRecorrencia: Number(a.meses_recorrencia),
    ativo: a.ativo as boolean,
  }));
}

export interface NovoAfiliado {
  codigo: string;
  nome: string;
  email: string;
  tipo: "afiliado" | "parceiro";
  /** 0 a 50. O código sugerido termina com ele (LUCIANA20 = 20%). */
  descontoPct: number;
}

/** Percentual de comissão por tipo (regra do backlog). */
export const COMISSAO_POR_TIPO = { afiliado: 20, parceiro: 30 } as const;

/** "Luciana Silva" -> ["LUCIANA", "SILVA"] (sem acento, só letras). */
function partesDoNome(nome: string): string[] {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
}

/**
 * Sugestões de código em ordem de preferência: PRIMEIRONOME+desconto,
 * depois com a inicial do sobrenome, com o sobrenome e, por fim,
 * numeradas. Sem desconto, o código é só o nome.
 */
export function candidatosDeCodigo(nome: string, descontoPct: number): string[] {
  const pct = descontoPct > 0 ? String(descontoPct) : "";
  const partes = partesDoNome(nome);
  const primeiro = (partes[0] ?? "AFILIADO").slice(0, 24);
  const ultimo = partes.length > 1 ? partes[partes.length - 1]! : "";
  const lista = [`${primeiro}${pct}`];
  if (ultimo) {
    lista.push(`${primeiro}${ultimo[0]}${pct}`);
    lista.push(`${primeiro}${ultimo}`.slice(0, 27) + pct);
  }
  for (let n = 2; n <= 30; n++) lista.push(`${primeiro}${pct}-${n}`);
  return [...new Set(lista)].filter((c) => /^[A-Z0-9-]{3,30}$/.test(c));
}

/** Quais destes códigos já existem (sem diferenciar maiúsculas). */
export async function codigosEmUso(ctx: ContextoUsuario, codigos: string[]): Promise<string[]> {
  exigirOperador(ctx);
  const { data, error } = await getSupabaseServerClient().rpc("codigos_afiliado_em_uso", {
    p_codigos: codigos.map((c) => c.trim().toUpperCase()),
  });
  if (error) falha(error);
  return (data ?? []) as string[];
}

/** Primeiro código livre para o nome e o desconto. */
export async function sugerirCodigo(
  ctx: ContextoUsuario,
  nome: string,
  descontoPct: number,
): Promise<string> {
  const candidatos = candidatosDeCodigo(nome, descontoPct);
  const usados = new Set(await codigosEmUso(ctx, candidatos));
  const livre = candidatos.find((c) => !usados.has(c));
  if (!livre) throw new ErroDominio("Não encontrei um código livre; digite um código.");
  return livre;
}

/** Regra do backlog: afiliado 20%, parceiro implantador 30%, por 12 meses. */
export async function criarAfiliado(
  ctx: ContextoUsuario,
  d: NovoAfiliado,
): Promise<{ link: string | null; emailEnviado: boolean }> {
  exigirOperador(ctx);
  const codigo = d.codigo.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,30}$/.test(codigo)) {
    throw new ErroDominio("Código: 3 a 30 caracteres, só letras, números e hífen.");
  }
  if ((await codigosEmUso(ctx, [codigo])).length) {
    throw new ErroDominio(`O código ${codigo} já está em uso. Gere ou digite outro.`);
  }
  const { error } = await getSupabaseServerClient().from("afiliados").insert({
    codigo,
    nome: d.nome.trim(),
    email: d.email.trim().toLowerCase(),
    tipo: d.tipo,
    comissao_pct: COMISSAO_POR_TIPO[d.tipo],
    desconto_pct: d.descontoPct,
    meses_recorrencia: 12,
  });
  if (error) falha(error);

  // Conta de login do afiliado (portal). O link vai para o operador
  // repassar; quem já tem conta entra com a dele.
  const { prepararConta } = await import("./usuarios.repo");
  const conta = await prepararConta(d.email, d.nome);
  const v = await getSupabaseServerClient().rpc("vincular_conta_afiliado", {
    p_codigo: codigo,
    p_usuario: conta.id,
  });
  if (v.error) falha(v.error);

  // Convite por e-mail (cupom + acesso ao portal). Se falhar, o
  // cadastro vale e o link aparece na tela para o operador repassar.
  let emailEnviado = false;
  try {
    const { enviarConviteAfiliado } = await import("@/services/convite.server");
    await enviarConviteAfiliado({
      nome: d.nome,
      email: d.email,
      codigo,
      descontoPct: d.descontoPct,
      link: conta.link,
    });
    emailEnviado = true;
  } catch (e) {
    console.error("Convite do afiliado não foi enviado:", e);
  }
  return { link: conta.link, emailEnviado };
}

export async function listarComissoes(ctx: ContextoUsuario): Promise<Comissao[]> {
  exigirOperador(ctx);
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("comissoes")
    .select("id, afiliado_id, assinatura_id, valor_centavos, status, liberar_em, pago_em")
    .order("criado_em", { ascending: false })
    .limit(200);
  if (error) falha(error);
  const linhas = data ?? [];

  const [afiliados, assinaturas] = await Promise.all([
    sb.from("afiliados").select("id, nome"),
    sb.from("assinaturas").select("id, tenant_id"),
  ]);
  const tenants = await sb.from("tenants").select("id, nome");
  const nomeAfiliado = new Map(
    (afiliados.data ?? []).map((a) => [a.id as string, a.nome as string]),
  );
  const tenantDaAssinatura = new Map(
    (assinaturas.data ?? []).map((a) => [a.id as string, a.tenant_id as string]),
  );
  const nomeEmpresa = new Map((tenants.data ?? []).map((t) => [t.id as string, t.nome as string]));

  return linhas.map((c) => ({
    id: c.id as string,
    afiliadoNome: nomeAfiliado.get(c.afiliado_id as string) ?? "—",
    empresa: nomeEmpresa.get(tenantDaAssinatura.get(c.assinatura_id as string) ?? "") ?? "—",
    valorCentavos: Number(c.valor_centavos),
    status: c.status as Comissao["status"],
    liberarEm: (c.liberar_em as string | null) ?? null,
    pagoEm: (c.pago_em as string | null) ?? null,
  }));
}

/** Só comissão liberada (carência de 30 dias cumprida) pode ser paga. */
export async function marcarComissaoPaga(ctx: ContextoUsuario, id: string): Promise<void> {
  exigirOperador(ctx);
  const { data, error } = await getSupabaseServerClient()
    .from("comissoes")
    .update({ status: "paga", pago_em: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "liberada")
    .select("id");
  if (error) falha(error);
  if (!data?.length) throw new ErroDominio("Só comissões liberadas podem ser marcadas como pagas.");
}