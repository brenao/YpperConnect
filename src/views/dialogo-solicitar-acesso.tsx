import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { solicitarAcessoFn } from "@/services/acesso-projeto.functions";

/**
 * Pedido de acesso a um projeto que a pessoa vê, mas não abre.
 *
 * Arquivo próprio em vez de mais um diálogo em project-dialogs: aquele
 * arquivo já concentra o formulário de projeto, e um diálogo de fluxo de
 * aprovação não tem nada em comum com ele além da palavra "projeto".
 *
 * A justificativa é opcional de propósito. Exigir texto para pedir
 * acesso a algo que já está na lista transforma um clique em redação, e
 * o gerente costuma reconhecer quem pediu pelo nome e pelo
 * departamento.
 */
export function DialogoSolicitarAcesso({
  projetoId,
  projetoNome,
  trigger,
}: {
  projetoId: string;
  projetoNome: string;
  trigger: ReactNode;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [justificativa, setJustificativa] = useState("");

  const enviar = useMutation({
    mutationFn: () =>
      solicitarAcessoFn({
        data: { projetoId, justificativa: justificativa.trim() || undefined },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["minhas-solicitacoes"] });
      toast.success("Solicitação enviada", {
        description: "Quem responde pelo projeto foi avisado e decide a partir daqui.",
      });
      setOpen(false);
      setJustificativa("");
    },
    onError: (e: Error) => toast.error("Não foi possível solicitar", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10">
            <Lock className="size-5 text-primary" />
          </div>
          <DialogTitle className="text-xl">Solicitar acesso</DialogTitle>
          <DialogDescription>
            Você está pedindo acesso a{" "}
            <span className="font-medium text-foreground">{projetoNome}</span>. O gerente decide, e
            você recebe a resposta por e-mail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="acesso-just">
            Por que você precisa de acesso?{" "}
            <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id="acesso-just"
            rows={3}
            maxLength={1000}
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            placeholder="Ex.: vou assumir a integração com o ERP neste projeto."
          />
          <p className="text-xs text-muted-foreground">
            Uma linha de contexto costuma ser o que faz a aprovação sair no mesmo dia.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={enviar.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => enviar.mutate()} disabled={enviar.isPending}>
            {enviar.isPending ? "Enviando..." : "Enviar solicitação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
