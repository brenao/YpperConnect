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
export const PROJECT_STATUS_STYLE: Record<ProjectStatus, string> = {
  backlog: "bg-muted text-muted-foreground border-border",
  planejamento: "bg-info/12 text-info border-info/30",
  execucao: "bg-primary/12 text-primary border-primary/30",
  paralisado: "bg-warning/12 text-warning border-warning/30",
  cancelado: "bg-muted text-muted-foreground border-border",
  concluido: "bg-success/12 text-success border-success/30",
};

/**
 * Situações oferecidas na troca.
 *
 * `backlog` fica de fora: voltar para a fila de priorização tem regra
 * própria — recusa projeto com cronograma e recalcula a posição — e o
 * repositório recusa a troca por aqui de propósito.
 */
const STATUS_OFERECIDOS = (Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).filter(
  (s) => s !== "backlog",
);

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
    mutationFn: (novo: ProjectStatus) =>
      definirStatusProjetoFn({ data: { id: projetoId, status: novo } }),
    onSuccess: (_r, novo) => {
      // As três telas que mostram situação: portfólio, detalhe e o
      // backlog, que lista a carteira inteira.
      qc.invalidateQueries({ queryKey: ["projetos"] });
      qc.invalidateQueries({ queryKey: ["projeto", projetoId] });
      qc.invalidateQueries({ queryKey: ["backlog"] });
      toast.success(`Situação alterada para ${PROJECT_STATUS_LABEL[novo]}`);
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
