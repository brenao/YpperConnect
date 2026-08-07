/** Oracle não tem BOOLEAN: NUMBER(1) 0/1 nos dois sentidos. */
export const paraBool = (n: number | null | undefined): boolean => n === 1;
export const deBool = (b: boolean | undefined): number => (b ? 1 : 0);

/** Erro de domínio. Distingue "dado inválido" de falha técnica do banco. */
export class ErroDominio extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDominio";
  }
}
