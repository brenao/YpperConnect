/**
 * Seleção múltipla em linha, para responsável e predecessora da grade.
 *
 * Não é campo de texto livre: digitar nome não garante que o recurso
 * exista, e o servidor recusaria a gravação depois do usuário já ter
 * saído da linha. Aqui só é possível escolher o que existe.
 */

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface OpcaoSeletor {
  id: string;
  rotulo: string;
  /** Texto menor à direita: índice da tarefa, papel do recurso. */
  detalhe?: string | undefined;
}

export function SeletorMultiplo({
  opcoes,
  selecionados,
  vazio,
  titulo,
  editavel,
  onMudar,
}: {
  opcoes: OpcaoSeletor[];
  selecionados: string[];
  /** Texto quando nada está escolhido. */
  vazio: string;
  titulo: string;
  editavel: boolean;
  onMudar: (ids: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");

  const escolhidas = opcoes.filter((o) => selecionados.includes(o.id));
  const texto = escolhidas.length ? escolhidas.map((o) => o.rotulo).join(", ") : vazio;

  if (!editavel) {
    return (
      <span
        className={cn("block truncate text-xs", escolhidas.length ? "" : "text-muted-foreground")}
        title={texto}
      >
        {texto}
      </span>
    );
  }

  const filtradas = busca.trim()
    ? opcoes.filter((o) => o.rotulo.toLowerCase().includes(busca.trim().toLowerCase()))
    : opcoes;

  function alternar(id: string) {
    onMudar(
      selecionados.includes(id) ? selecionados.filter((s) => s !== id) : [...selecionados, id],
    );
  }

  return (
    <Popover
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) setBusca("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={texto}
          className={cn(
            "flex h-7 w-full items-center gap-1 rounded-md border border-transparent px-1 text-left text-xs",
            "hover:border-border focus:border-primary focus:outline-none",
            escolhidas.length ? "" : "text-muted-foreground",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{texto}</span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border p-2">
          <p className="mb-1.5 text-xs font-medium">{titulo}</p>
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar..."
            className="h-7 text-xs"
          />
        </div>

        <div className="max-h-64 overflow-y-auto p-1">
          {filtradas.map((o) => {
            const marcado = selecionados.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => alternar(o.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-secondary"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border",
                    marcado ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {marcado ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
                {o.detalhe ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{o.detalhe}</span>
                ) : null}
              </button>
            );
          })}

          {filtradas.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Nada encontrado para “{busca}”.
            </p>
          ) : null}
        </div>

        {selecionados.length > 0 ? (
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => onMudar([])}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-secondary"
            >
              Limpar seleção
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
