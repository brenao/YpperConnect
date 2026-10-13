import * as React from "react";

import { cn } from "@/lib/utils";

/** Campos em que o navegador tem um seletor próprio a oferecer. */
const COM_SELETOR = new Set(["date", "datetime-local", "month", "time", "week"]);

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onClick, onFocus, ...props }, ref) => {
    /**
     * Abre o seletor nativo ao clicar em qualquer parte do campo.
     *
     * Por padrão o navegador só mostra o calendário quando a pessoa
     * acerta o ícone à direita — um alvo de uns 16px que, numa coluna
     * estreita de grade, fica cortado. Quem clica no campo esperando o
     * calendário encontra os segmentos de texto e acha que a tela não
     * respondeu.
     *
     * `showPicker` exige que a chamada venha de um gesto do usuário e
     * que o campo já esteja na tela; o try/catch cobre o navegador que
     * não a tem e o caso em que ela é recusada. Digitar continua
     * funcionando em qualquer um — este é um atalho, não o único
     * caminho.
     */
    const abrirSeletor = React.useCallback((el: HTMLInputElement | null) => {
      if (!el || !COM_SELETOR.has(el.type)) return;
      try {
        el.showPicker();
      } catch {
        /* sem suporte ou recusado: digitar ainda funciona */
      }
    }, []);

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onClick={(e) => {
          abrirSeletor(e.currentTarget);
          onClick?.(e);
        }}
        /**
         * O foco cobre o campo que já abre em edição — como o da grade
         * do cronograma, que troca o texto pelo input e usa `autoFocus`.
         * Ali não há clique no input: o clique foi no botão que o
         * substituiu.
         */
        onFocus={(e) => {
          abrirSeletor(e.currentTarget);
          onFocus?.(e);
        }}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
