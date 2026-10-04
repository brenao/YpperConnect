import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface OpcaoBusca {
  value: string;
  label: string;
  /** Texto menor ao lado do nome (ex.: equipe, tipo). Também entra na busca. */
  detalhe?: string | null | undefined;
}

/** Busca sem diferenciar maiúsculas nem acentos: "servico" acha "Serviço". */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Lista de opções com campo digitável que filtra enquanto a pessoa escreve.
 *
 * Para listas que podem crescer muito (sistemas, serviços, pessoas): rolar
 * cem itens atrás de um nome é lento, digitar três letras não. Continua
 * sendo uma lista — clicar sem digitar mostra tudo.
 */
export function SeletorBusca({
  opcoes,
  value,
  onChange,
  placeholder = "Selecione",
  placeholderBusca = "Digite para filtrar...",
  vazio = "Nada encontrado.",
  id,
}: {
  opcoes: OpcaoBusca[];
  /** Valor selecionado; vazio = nada selecionado. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  placeholderBusca?: string;
  vazio?: string;
  id?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const selecionada = opcoes.find((o) => o.value === value);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", selecionada ? "" : "text-muted-foreground")}>
            {selecionada ? selecionada.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command
          filter={(itemValue, busca) => (normalizar(itemValue).includes(normalizar(busca)) ? 1 : 0)}
        >
          <CommandInput placeholder={placeholderBusca} />
          <CommandList>
            <CommandEmpty>{vazio}</CommandEmpty>
            <CommandGroup>
              {opcoes.map((o) => (
                <CommandItem
                  key={o.value}
                  // O que a busca enxerga: nome e detalhe juntos.
                  value={`${o.label} ${o.detalhe ?? ""} ${o.value}`}
                  onSelect={() => {
                    onChange(o.value);
                    setAberto(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 size-4", o.value === value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{o.label}</span>
                  {o.detalhe ? (
                    <span className="ml-auto pl-2 text-xs text-muted-foreground">{o.detalhe}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}