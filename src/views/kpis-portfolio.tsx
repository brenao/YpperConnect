import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Inbox,
  PauseCircle,
  PlayCircle,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarValor } from "@/models/itsm-types";
import { resumoPortfolioFn } from "@/services/projetos.functions";

/**
 * Faixa de indicadores do portfólio.
 *
 * Não é um painel de contagem: é a pergunta "o que precisa de mim
 * agora?" respondida em números clicáveis. Cada card aplica um filtro
 * na lista logo abaixo — card que não filtra vira enfeite, e enfeite
 * ninguém olha depois da segunda semana.
 *
 * Por isso também não existe card de "total de projetos". Ele ocuparia
 * o primeiro lugar da leitura com o número que menos muda decisão, e já
 * está implícito na lista.
 *
 * As três telas escolhem cards diferentes de propósito. O backlog
 * pergunta "o que decidir"; a lista de projetos, "o que está pegando
 * fogo"; a diretoria, "como está a carteira". Repetir os mesmos quatro
 * nas três economizaria código e desperdiçaria o espaço mais nobre da
 * tela.
 */

export type ChaveKpi =
  | "backlog"
  | "execucao"
  | "planejamento"
  | "paralisado"
  | "concluido"
  | "prazoEstourado"
  | "semAcompanhamento"
  | "semGerente";

interface Definicao {
  rotulo: string;
  icone: LucideIcon;
  /** Uma linha dizendo o que o número significa, não repetindo o rótulo. */
  ajuda: string;
  /** Destaca só quando há o que ver: zero em vermelho ensina a ignorar a cor. */
  alerta?: boolean;
}

const DEFINICOES: Record<ChaveKpi, Definicao> = {
  backlog: {
    rotulo: "Na fila",
    icone: Inbox,
    ajuda: "Registrados, aguardando priorização",
  },
  execucao: {
    rotulo: "Em execução",
    icone: PlayCircle,
    ajuda: "Consomem capacidade hoje",
  },
  planejamento: {
    rotulo: "Em planejamento",
    icone: CalendarClock,
    ajuda: "Aprovados, ainda não começaram",
  },
  paralisado: {
    rotulo: "Paralisados",
    icone: PauseCircle,
    ajuda: "Sem movimento há 15 dias",
    alerta: true,
  },
  concluido: {
    rotulo: "Concluídos",
    icone: CheckCircle2,
    ajuda: "Entregues",
  },
  prazoEstourado: {
    rotulo: "Prazo vencido",
    icone: AlertTriangle,
    ajuda: "Término no passado, sem encerrar",
    alerta: true,
  },
  semAcompanhamento: {
    rotulo: "Sem notícia",
    icone: CalendarClock,
    ajuda: "Mais de uma semana sem atualização",
    alerta: true,
  },
  semGerente: {
    rotulo: "Sem gerente",
    icone: UserX,
    ajuda: "Ninguém responde por eles",
    alerta: true,
  },
};

interface Props {
  /** Quais indicadores esta tela mostra, na ordem. */
  cards: ChaveKpi[];
  /** Filtro aplicado agora. `null` é "sem filtro". */
  ativo?: ChaveKpi | null | undefined;
  /**
   * Clique no card. Clicar no que já está ativo desliga o filtro — é o
   * que a pessoa tenta fazer por instinto, e sem isso ela procura um
   * botão "limpar" que não existe.
   */
  onAlternar: (chave: ChaveKpi | null) => void;
  className?: string | undefined;
}

export function KpisPortfolio({ cards, ativo, onAlternar, className }: Props) {
  const q = useQuery({ queryKey: ["resumo-portfolio"], queryFn: () => resumoPortfolioFn() });
  const r = q.data;

  function valorDe(chave: ChaveKpi): number {
    if (!r) return 0;
    return r[chave];
  }

  /** Segunda linha: contexto que só faz sentido naquele indicador. */
  function detalheDe(chave: ChaveKpi): string | null {
    if (!r) return null;
    if (chave === "backlog" && r.backlog > 0) {
      const valor = formatarValor(r.investimentoNaFila, "BRL");
      const partes = [
        r.diasNaFila > 0 ? `mais antigo há ${r.diasNaFila} d` : null,
        r.investimentoNaFila > 0 && valor ? `${valor} previstos` : null,
      ].filter(Boolean);
      return partes.length > 0 ? partes.join(" · ") : null;
    }
    if (chave === "execucao" && r.planejamento > 0) {
      return `${r.planejamento} em planejamento`;
    }
    return null;
  }

  return (
    <section
      className={cn(
        "grid gap-3",
        cards.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3",
        className,
      )}
    >
      {cards.map((chave) => {
        const d = DEFINICOES[chave];
        const Icone = d.icone;
        const valor = valorDe(chave);
        const selecionado = ativo === chave;
        const detalhe = detalheDe(chave);

        // Indicador de alerta só ganha cor quando há o que resolver.
        const cor = d.alerta && valor > 0 ? "text-warning" : "text-foreground";

        return (
          <button
            key={chave}
            type="button"
            aria-pressed={selecionado}
            onClick={() => onAlternar(selecionado ? null : chave)}
            title={
              selecionado
                ? "Clique para remover o filtro"
                : `Filtrar a lista: ${d.ajuda.toLowerCase()}`
            }
            className={cn(
              "panel flex items-start gap-3 p-4 text-left transition-colors",
              "hover:border-primary/40 focus-visible:border-primary focus-visible:outline-none",
              selecionado ? "border-primary bg-hero" : "",
            )}
          >
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg",
                selecionado ? "bg-primary/15" : "bg-secondary/40",
              )}
            >
              <Icone className={cn("size-4", cor)} />
            </span>

            <span className="min-w-0">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                {d.rotulo}
              </span>
              <span className={cn("block font-mono text-2xl font-semibold leading-tight", cor)}>
                {q.isPending ? (
                  <CircleDashed className="size-5 animate-spin text-muted-foreground" />
                ) : (
                  valor
                )}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {detalhe ?? d.ajuda}
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}
