import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Paginação de listas já carregadas em memória.
 *
 * Existe porque a sincronização do GLPI trouxe mais de mil usuários, e
 * as telas montavam uma linha por pessoa — cada uma com diálogo ou
 * seletor próprio. O custo não estava na consulta, e sim em instanciar
 * mil componentes do Radix antes do primeiro quadro.
 *
 * Corta no cliente, não no banco: a lista inteira já vem numa
 * requisição só, e paginar no servidor exigiria refazer a busca a cada
 * página sem ganho perceptível nesse volume. Se a base crescer para
 * dezenas de milhares, aí sim o corte precisa descer para o SQL.
 */
export const POR_PAGINA_PADRAO = 25;

const OPCOES_POR_PAGINA = [10, 25, 50, 100] as const;

/**
 * Estado e fatia da lista, num gancho só.
 *
 * A tela que usa isto não deveria precisar declarar duas variáveis de
 * estado e lembrar de zerar a página a cada filtro — esquecer disso
 * produz a tabela vazia na página 7 de uma lista que agora tem 3 itens.
 *
 * `chave` é o que identifica o conjunto: quando ela muda, a paginação
 * volta ao começo. Costuma ser a concatenação dos filtros da tela.
 */
export function usePaginacao<T>(itens: T[], chave: string) {
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState<number>(POR_PAGINA_PADRAO);

  useEffect(() => {
    setPagina(1);
  }, [chave, porPagina]);

  const total = itens.length;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  // A lista pode encurtar entre renderizações — um filtro novo, um
  // registro desativado — e deixar a página atual além do fim.
  const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;

  return {
    visiveis: itens.slice(inicio, inicio + porPagina),
    controles: {
      pagina: paginaAtual,
      totalPaginas,
      total,
      porPagina,
      primeiro: total === 0 ? 0 : inicio + 1,
      ultimo: Math.min(inicio + porPagina, total),
      onMudar: setPagina,
      onMudarPorPagina: setPorPagina,
    },
  };
}

/**
 * Números a mostrar, com reticências no lugar do que foi omitido.
 *
 * Mostrar as 129 páginas de uma base de mil e trezentos usuários
 * inutilizaria a barra. A janela mantém primeira, última e a vizinhança
 * da atual, que é o que se usa para navegar de fato — o salto longo é
 * feito pelo campo de digitar.
 */
function janelaDePaginas(atual: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const paginas = new Set<number>([1, total, atual, atual - 1, atual + 1]);

  // Perto das pontas, estende a janela do lado que tem espaço: sem
  // isto, estar na página 2 mostraria "1 2 3 … 129" e o clique seguinte
  // teria só um destino novo.
  if (atual <= 3) [2, 3, 4].forEach((p) => paginas.add(p));
  if (atual >= total - 2) [total - 1, total - 2, total - 3].forEach((p) => paginas.add(p));

  const ordenadas = [...paginas].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const saida: (number | "...")[] = [];
  let anterior = 0;
  for (const p of ordenadas) {
    if (anterior && p - anterior > 1) saida.push("...");
    saida.push(p);
    anterior = p;
  }
  return saida;
}

export interface ControlesPaginacao {
  pagina: number;
  totalPaginas: number;
  total: number;
  porPagina: number;
  primeiro: number;
  ultimo: number;
  onMudar: (pagina: number) => void;
  onMudarPorPagina: (porPagina: number) => void;
}

export function Paginacao({
  pagina,
  totalPaginas,
  total,
  porPagina,
  primeiro,
  ultimo,
  rotulo,
  posicao = "rodape",
  onMudar,
  onMudarPorPagina,
}: ControlesPaginacao & {
  /** Nome do que está sendo listado, no plural. */
  rotulo: string;
  /**
   * Onde a barra está em relação à tabela. Muda só de que lado fica a
   * divisória, para a linha encostar na grade e não flutuar solta.
   *
   * A barra aparece nas duas pontas de propósito: com cem linhas por
   * página, quem termina de ler embaixo não deveria rolar de volta ao
   * topo para trocar de página, e quem chega no topo não deveria rolar
   * até o fim para descobrir onde está.
   */
  posicao?: "topo" | "rodape";
}) {
  // Rascunho do campo "ir para": o valor só é aplicado ao confirmar, e
  // não a cada tecla — senão digitar "12" saltaria para a página 1 no
  // caminho.
  const [destino, setDestino] = useState("");

  // Lista vazia não tem o que paginar, mas o seletor de tamanho some
  // junto e a pessoa perde a referência do que escolheu.
  if (total === 0) return null;

  function irParaDestino() {
    const n = Number(destino);
    if (Number.isInteger(n) && n >= 1 && n <= totalPaginas) onMudar(n);
    setDestino("");
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 ${
        posicao === "topo" ? "border-b border-border" : "border-t border-border"
      }`}
    >
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>
          {primeiro}–{ultimo} de {total} {rotulo}
        </span>
        <Select value={String(porPagina)} onValueChange={(v) => onMudarPorPagina(Number(v))}>
          <SelectTrigger className="h-7 w-[4.5rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPCOES_POR_PAGINA.map((n) => (
              <SelectItem key={n} value={String(n)} className="text-xs">
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>por página</span>
      </span>

      {totalPaginas > 1 ? (
        <span className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Página anterior"
            disabled={pagina <= 1}
            onClick={() => onMudar(pagina - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>

          {janelaDePaginas(pagina, totalPaginas).map((p, i) =>
            p === "..." ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === pagina ? "default" : "ghost"}
                size="icon"
                className="size-7 font-mono text-xs"
                aria-current={p === pagina ? "page" : undefined}
                onClick={() => onMudar(p)}
              >
                {p}
              </Button>
            ),
          )}

          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Próxima página"
            disabled={pagina >= totalPaginas}
            onClick={() => onMudar(pagina + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>

          {/* Salto direto: com dezenas de páginas, clicar de uma em uma
              para chegar ao fim é inviável, e a janela de números não
              tem como oferecer todos os destinos.

              O rótulo fica fora do campo: dentro dele, como placeholder,
              qualquer texto que explicasse a função não caberia na
              largura e apareceria cortado. */}
          <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            Ir para
            <Input
              value={destino}
              onChange={(e) => setDestino(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => {
                if (e.key === "Enter") irParaDestino();
              }}
              onBlur={irParaDestino}
              aria-label={`Ir para a página, de 1 a ${totalPaginas}`}
              className="h-7 w-14 text-center font-mono text-xs"
            />
          </label>
        </span>
      ) : null}
    </div>
  );
}
