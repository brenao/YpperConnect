import { consultarUm, executar } from "@/integrations/postgres/client.server";
import { ErroDominio } from "./tipos";
import type { ContextoUsuario } from "@/services/current-user.server";

/**
 * Preferências de interface, por usuário.
 *
 * Guardam o que é escolha de quem usa e não tem efeito sobre dado de
 * negócio: largura de coluna, ordem da grade, o que fica visível. O
 * conteúdo é JSON livre — quem grava e quem lê acordam o formato —,
 * porque validar no banco a forma de cada preferência criaria uma
 * migration por ajuste de tela.
 *
 * Sempre do usuário do contexto. Não existe função para ler ou escrever
 * a preferência de outra pessoa: não há caso de uso, e a ausência do
 * parâmetro é o que garante que nunca vai haver por engano.
 */

/** Teto por preferência. Uma configuração de tela não chega perto disso. */
const TAMANHO_MAXIMO = 16_384;

/**
 * Valor gravado, ou `null` quando o usuário nunca ajustou.
 *
 * `null` é resposta legítima e significa "use o padrão" — diferente de
 * um objeto vazio, que significaria "ajustei e não sobrou nada".
 */
export async function lerPreferencia(ctx: ContextoUsuario, chave: string): Promise<string | null> {
  const r = await consultarUm<{ valor: string }>(
    // O ::text no SELECT é o que faz a preferência atravessar a
    // fronteira do servidor como texto. A serialização das server
    // functions exige tipo conhecido, e `unknown` — que é o que um
    // JSON livre é — não passa. Quem sabe o formato é a tela, e é lá
    // que o texto vira objeto.
    `SELECT valor::text AS valor FROM usuario_preferencias
      WHERE usuario_id = :usuarioId AND chave = :chave`,
    { usuarioId: ctx.id, chave },
  );
  return r?.valor ?? null;
}

/**
 * Grava, substituindo o que havia.
 *
 * `ON CONFLICT DO UPDATE` em vez de ler antes: a preferência é
 * sobrescrita inteira a cada ajuste, e verificar a existência primeiro
 * abriria uma janela entre a leitura e a escrita sem ganhar nada.
 */
export async function gravarPreferencia(
  ctx: ContextoUsuario,
  chave: string,
  /** JSON já serializado: quem conhece o formato é a tela. */
  json: string,
): Promise<void> {
  try {
    JSON.parse(json);
  } catch {
    throw new ErroDominio("Preferência em formato inválido.");
  }
  if (json.length > TAMANHO_MAXIMO) {
    throw new ErroDominio("Preferência grande demais para ser salva.");
  }

  await executar(
    `INSERT INTO usuario_preferencias (usuario_id, chave, valor, atualizado_em)
     VALUES (:usuarioId, :chave, CAST(:valor AS jsonb), LOCALTIMESTAMP)
     ON CONFLICT (usuario_id, chave)
     DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = LOCALTIMESTAMP`,
    { usuarioId: ctx.id, chave, valor: json },
  );
}

/**
 * Apaga a preferência: é o "restaurar o padrão".
 *
 * DELETE e não gravar um valor vazio, porque ausência de linha é
 * exatamente o que significa "nunca ajustou" — e é como o usuário novo
 * começa. Guardar um objeto vazio criaria um segundo jeito de dizer a
 * mesma coisa.
 */
export async function removerPreferencia(ctx: ContextoUsuario, chave: string): Promise<void> {
  await executar(
    `DELETE FROM usuario_preferencias WHERE usuario_id = :usuarioId AND chave = :chave`,
    { usuarioId: ctx.id, chave },
  );
}
