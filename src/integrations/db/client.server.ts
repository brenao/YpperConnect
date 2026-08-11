import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Camada de acesso ao banco (Lovable Cloud / Postgres). SOMENTE SERVIDOR.
 *
 * Substitui o antigo client Oracle. Todo acesso passa pelo cliente de
 * serviço: a aplicação já resolve identidade e autorização na camada de
 * repositório (ContextoUsuario), e o navegador nunca fala com o banco.
 */
export const db = supabaseAdmin;

export interface RespostaPostgrest<T> {
  data: T | null;
  error: { message: string } | null;
}

type Aguardavel<T> = RespostaPostgrest<T> | PromiseLike<RespostaPostgrest<T>>;

/**
 * Desembrulha a resposta do PostgREST, transformando erro em exceção.
 * Aceita tanto o builder do supabase-js (que é "thenable") quanto o
 * resultado já aguardado.
 */
export async function checar<T>(r: Aguardavel<T>): Promise<T> {
  const resposta = await r;
  if (resposta.error) throw new Error(`Erro no banco: ${resposta.error.message}`);
  return resposta.data as T;
}

/** Lista (nunca null). */
export async function linhas<T>(r: Aguardavel<T[]>): Promise<T[]> {
  return (await checar(r)) ?? [];
}

/** Timestamp do banco (ISO string) para Date. */
export function paraData(v: string | null | undefined): Date | null {
  return v ? new Date(v) : null;
}

/** Igual a paraData, mas para colunas NOT NULL. */
export function data(v: string): Date {
  return new Date(v);
}

/** Coluna DATE (yyyy-mm-dd) para Date local, sem deslocamento de fuso. */
export function paraDataPura(v: string | null | undefined): Date | null {
  if (!v) return null;
  const [a, m, d] = v.slice(0, 10).split("-").map(Number);
  return new Date(a!, (m ?? 1) - 1, d ?? 1);
}

/** Date para coluna DATE (yyyy-mm-dd) no fuso local. */
export function comoDataPura(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Formulário web manda ''; coluna opcional deve receber NULL. */
export function vazioParaNulo<T>(v: T | "" | null | undefined): T | null {
  return v === "" || v === undefined ? null : (v as T | null);
}

/** Agora, no formato aceito pelo Postgres. */
export function agora(): string {
  return new Date().toISOString();
}
