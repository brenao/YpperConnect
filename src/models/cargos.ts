/**
 * Cargos que o administrador escolhe ao cadastrar alguém.
 *
 * O cargo sozinho não dá permissão: o departamento decide o perfil
 * (analista no departamento de TI é "Analista de TI"; em outro, "Usuário
 * final"). A combinação é resolvida no banco por `perfil_do_cargo`.
 *
 * "administrador" existe no banco (perfil Administrador de TI), mas não
 * é escolhido aqui: administrar é a chave "Administrador do sistema".
 */
export const CARGOS = [
  { valor: "analista", label: "Analista" },
  { valor: "gerente_projetos", label: "Gerente de projetos" },
  { valor: "diretoria", label: "Gestor / Diretoria" },
] as const;

export type Cargo = (typeof CARGOS)[number]["valor"];

export const VALORES_CARGO = CARGOS.map((c) => c.valor) as [Cargo, ...Cargo[]];

export function ehCargo(v: string | null | undefined): v is Cargo {
  return CARGOS.some((c) => c.valor === v);
}