/** Oracle não tem BOOLEAN: NUMBER(1) 0/1 nos dois sentidos. */
/**
 * 0/1 do legado ou booleano do Supabase: os dois chegam aqui durante a
 * migração, e a regra é a mesma — só "verdadeiro" é verdadeiro.
 */
export const paraBool = (n: number | boolean | null | undefined): boolean => n === 1 || n === true;
export const deBool = (b: boolean | undefined): number => (b ? 1 : 0);

/** Erro de domínio. Distingue "dado inválido" de falha técnica do banco. */
export class ErroDominio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDominio";
  }
}