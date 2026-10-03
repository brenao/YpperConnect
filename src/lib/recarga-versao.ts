/**
 * Recarrega a página quando o navegador pede um arquivo que o deploy
 * novo não tem mais.
 *
 * O problema: cada build gera nomes com hash — `diretoria-DsqUlIjU.js`.
 * Quem está com a aba aberta durante um deploy continua com o
 * `index.html` antigo em memória, e ao navegar pede um arquivo que já
 * foi substituído. O servidor devolve a página HTML no lugar, e a tela
 * quebra com "Failed to fetch dynamically imported module".
 *
 * Não é caso raro: acontece com todo usuário que estiver com o sistema
 * aberto no momento de cada publicação. E ninguém pensa em dar
 * Ctrl+Shift+R — as pessoas só dizem que "o sistema deu erro".
 *
 * A correção é recarregar: o `index.html` novo chega e aponta para os
 * arquivos certos. Vira um piscar de tela em vez de uma tela de erro.
 *
 * O GUARDA CONTRA LAÇO é a parte que não pode faltar. Se o erro tiver
 * outra causa — arquivo que o deploy realmente não copiou, rede caindo
 * —, recarregar não resolve, e sem o limite a página entraria em ciclo
 * infinito de recarga. Uma tentativa a cada dez segundos: o suficiente
 * para o caso do deploy, e pouco o bastante para o erro real aparecer
 * na tela em vez de ficar escondido atrás de recargas.
 *
 * Fica fora de qualquer componente de propósito: o erro acontece
 * durante o carregamento de um pedaço da aplicação, momento em que a
 * árvore do React pode não estar em condições de renderizar nada.
 */

const CHAVE = "beagleone.recarga-por-versao";
const INTERVALO_MS = 10_000;

/** Mensagens que o navegador usa para "esse arquivo não existe mais". */
const SINAIS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  // Safari e Firefox falam de MIME type: o servidor devolveu o HTML da
  // página no lugar do JavaScript que não existe mais.
  "expected a javascript",
  "mime type",
];

function pareceVersaoAntiga(mensagem: string): boolean {
  const m = mensagem.toLowerCase();
  return SINAIS.some((s) => m.includes(s));
}

/**
 * Recarrega, no máximo uma vez a cada dez segundos.
 *
 * `sessionStorage` e não `localStorage`: o limite vale para esta aba e
 * esta sessão. Abrir outra aba depois do deploy é um caso novo e merece
 * a sua própria tentativa.
 */
function recarregarUmaVez(): void {
  try {
    const ultima = Number(sessionStorage.getItem(CHAVE) ?? "0");
    if (Date.now() - ultima < INTERVALO_MS) return;
    sessionStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    // Sem sessionStorage não há como garantir o limite, e recarregar em
    // laço é pior do que o erro original: nesse caso, não recarrega.
    return;
  }

  // `reload()` sozinho pode reaproveitar o cache. Recarregar pela URL
  // atual força o navegador a buscar o documento de novo, que é o que
  // traz o `index.html` novo com os hashes certos.
  window.location.replace(window.location.href);
}

/**
 * Liga os ouvintes. Chamado uma vez, na entrada do cliente.
 *
 * São três caminhos porque o mesmo erro chega por vias diferentes
 * conforme o navegador e o momento: o Vite avisa quando falha o
 * pré-carregamento, o `error` pega o que estoura de forma síncrona, e o
 * `unhandledrejection` pega o `import()` que rejeitou sem quem o
 * tratasse.
 */
export function ativarRecargaEmVersaoNova(): void {
  // Durante o SSR não há navegador para recarregar.
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (evento) => {
    evento.preventDefault();
    recarregarUmaVez();
  });

  window.addEventListener("error", (evento) => {
    if (pareceVersaoAntiga(evento.message ?? "")) recarregarUmaVez();
  });

  window.addEventListener("unhandledrejection", (evento) => {
    const razao = evento.reason as { message?: string } | string | undefined;
    const mensagem = typeof razao === "string" ? razao : (razao?.message ?? "");
    if (pareceVersaoAntiga(mensagem)) recarregarUmaVez();
  });
}
