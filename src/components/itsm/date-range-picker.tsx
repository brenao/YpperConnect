import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const fmt = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

export interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
}

const PRESETS: { label: string; dias: number }[] = [
  { label: "30 dias", dias: 30 },
  { label: "90 dias", dias: 90 },
  { label: "12 meses", dias: 365 },
];

/** Campo único de período (data início → fim), no estilo de busca de voos. */
export function DateRangePicker({
  value,
  onChange,
  placeholder = "Selecionar período",
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const preset = (dias: number) => {
    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setDate(hoje.getDate() - dias);
    onChange({ from: inicio, to: hoje });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-10 w-full justify-start gap-2 px-3 text-left font-normal",
            !value?.from && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
          <span className="truncate">
            {value?.from
              ? value.to
                ? `${fmt(value.from)} → ${fmt(value.to)}`
                : `${fmt(value.from)} → selecione a volta`
              : placeholder}
          </span>
          {value?.from ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar período"
              className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onChange(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange(undefined);
                }
              }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-wrap gap-2 border-b border-border/60 p-3">
          {PRESETS.map((p) => (
            <Button key={p.label} size="sm" variant="secondary" onClick={() => preset(p.dias)}>
              Últimos {p.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          locale={ptBR}
          numberOfMonths={2}
          defaultMonth={value?.from ?? new Date()}
          selected={value}
          onSelect={(range) => {
            onChange(range);
            if (range?.from && range.to) setOpen(false);
          }}
          className={cn("pointer-events-auto p-3")}
        />
      </PopoverContent>
    </Popover>
  );
}
