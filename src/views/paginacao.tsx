import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

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

/** Fatia da lista correspondente à página, com a página já corrigida. */
export function paginar<T>(
  itens: T[],
  pagina: number,
  porPagina = POR_PAGINA_PADRAO,
): { visiveis: T[]; totalPaginas: number; paginaAtual: number; primeiro: number; ultimo: number } {
  const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina));

  // Filtrar pode encurtar a lista e deixar a página atual além do fim —
  // a pessoa veria uma tabela vazia com a paginação dizendo que há
  // resultados. Corrigir aqui evita espalhar essa guarda pelas telas.
  const paginaAtual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (paginaAtual - 1) * porPagina;

  return {
    visiveis: itens.slice(inicio, inicio + porPagina),
    totalPaginas,
    paginaAtual,
    primeiro: itens.length === 0 ? 0 : inicio + 1,
    ultimo: Math.min(inicio + porPagina, itens.length),
  };
}

export function Paginacao({
  pagina,
  totalPaginas,
  total,
  primeiro,
  ultimo,
  rotulo,
  onMudar,
}: {
  pagina: number;
  totalPaginas: number;
  total: number;
  primeiro: number;
  ultimo: number;
  /** Nome do que está sendo listado, no plural. */
  rotulo: string;
  onMudar: (pagina: number) => void;
}) {
  // Uma página só não é paginação: a barra vira ruído.
  if (total === 0 || totalPaginas <= 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
      <span className="text-xs text-muted-foreground">
        {primeiro}–{ultimo} de {total} {rotulo}
      </span>
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
        <span className="px-2 font-mono text-xs text-muted-foreground">
          {pagina} / {totalPaginas}
        </span>
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
      </span>
    </div>
  );
}
