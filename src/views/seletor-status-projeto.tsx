import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/models/itsm-types";
import { definirStatusProjetoFn } from "@/services/projetos.functions";
import { devolverAoBacklogFn } from "@/services/backlog.functions";
import { cn } from "@/lib/utils";

/**
 * Situação do projeto: o mesmo controle na lista e no detalhe.
 *
 * Nasceu dentro do card do portfólio. Quando o detalhe precisou da
 * mesma troca — quem está olhando o cronograma é justamente quem sabe
 * que o projeto paralisou —, copiar o bloco significaria duas cópias da
 * mutação, do toast e das chaves de invalidação para divergir na
 * primeira correção.
 *
 * As cores vivem aqui pelo mesmo motivo: o mapa estava escrito por
 * extenso nas duas telas.
 */
/**
 * Cor por situação, com um significado por cor.
 *
 * Verde é entrega — e só entrega. Azul é o trabalho acontecendo.
 * Laranja é o que parou. Neutro é o que ainda não começou e o que
 * acabou: nenhum dos dois pede nada de ninguém hoje.
 *
 * O amarelo saiu daqui de propósito. Ele é a cor de alerta em toda a
 * aplicação — sem acompanhamento, sem gerente, sem baseline, risco de
 * atraso — e usá-lo também para paralisado fazia o olho confundir "o
 * gerente decidiu parar" com "ninguém está olhando para isto".
 *
 * Cancelado deixou de ser vermelho pelo mesmo motivo: cancelar é uma
 * decisão legítima, não um erro, e vermelho ali competia com os
 * atrasos de verdade.
 */
export const PROJECT_STATUS_STYLE: Record<ProjectStatus, string> = {
  backlog: "bg-muted text-muted-foreground border-border",
  planejamento: "bg-secondary text-secondary-foreground border-border",
  execucao: "bg-info/12 text-info border-info/30",
  paralisado: "bg-paused/12 text-paused border-paused/30",
  cancelado: "bg-muted text-muted-foreground border-border",
  concluido: "bg-success/12 text-success border-success/30",
};

/**
 * Todas as situações, inclusive voltar ao backlog.
 *
 * `backlog` ficava de fora porque tem regra própria — recalcula a
 * posição na fila — e o `definirStatusProjeto` a recusa de propósito.
 * Mas estar ausente do seletor significava que despriorizar só era
 * possível depois de paralisar o projeto, passando por um estado que
 * não descrevia nada: ninguém paralisa para devolver, devolve porque
 * decidiu que aquilo não é mais prioridade.
 *
 * A escolha continua indo por outro caminho no código — é a função do
 * backlog que atende —, mas para quem usa é a mesma pergunta: em que
 * situação este projeto está?
 */
const STATUS_OFERECIDOS = Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[];

export function SeletorStatusProjeto({
  projetoId,
  status,
  editavel,
  className,
  title = "Alterar a situação do projeto",
}: {
  projetoId: string;
  status: ProjectStatus;
  /** Sem permissão, vira só um rótulo — mesmo desenho, sem a seta. */
  editavel: boolean;
  className?: string | undefined;
  title?: string | undefined;
}) {
  const qc = useQueryClient();

  const mudar = useMutation({
    /**
     * Voltar ao backlog não é uma troca de status qualquer.
     *
     * Ela recoloca o projeto no fim da fila de priorização, e esse
     * cálculo mora no repositório do backlog. O `definirStatusProjeto`
     * recusa `backlog` justamente para que ninguém chegue lá por um
     * caminho que esqueça a posição.
     */
    mutationFn: (novo: ProjectStatus) =>
      novo === "backlog"
        ? devolverAoBacklogFn({ data: { id: projetoId } })
        : definirStatusProjetoFn({ data: { id: projetoId, status: novo } }),
    onSuccess: (_r, novo) => {
      // As três telas que mostram situação: portfólio, detalhe e o
      // backlog, que lista a carteira inteira.
      qc.invalidateQueries({ queryKey: ["projetos"] });
      qc.invalidateQueries({ queryKey: ["projeto", projetoId] });
      qc.invalidateQueries({ queryKey: ["backlog"] });
      qc.invalidateQueries({ queryKey: ["resumo-portfolio"] });
      toast.success(
        novo === "backlog"
          ? "Projeto devolvido ao backlog"
          : `Situação alterada para ${PROJECT_STATUS_LABEL[novo]}`,
        novo === "backlog"
          ? { description: "O cronograma fica guardado e volta se ele for priorizado de novo." }
          : undefined,
      );
    },
    onError: (e: Error) =>
      toast.error("Não foi possível alterar a situação", { description: e.message }),
  });

  if (!editavel) {
    return (
      <span
        className={cn(
          "inline-block rounded-md border px-2 py-0.5 text-xs font-medium",
          PROJECT_STATUS_STYLE[status],
          className,
        )}
      >
        {PROJECT_STATUS_LABEL[status]}
      </span>
    );
  }

  return (
    <Select
      value={status}
      onValueChange={(v) => mudar.mutate(v as ProjectStatus)}
      disabled={mudar.isPending}
    >
      <SelectTrigger
        className={cn(
          "h-7 gap-1 border px-2 text-xs font-medium",
          PROJECT_STATUS_STYLE[status],
          className,
        )}
        title={title}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OFERECIDOS.map((s) => (
          <SelectItem key={s} value={s}>
            {PROJECT_STATUS_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
