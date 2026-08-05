import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useItsm } from "@/controllers/itsm-store";
import type { Resource } from "@/models/itsm-types";

export function ResourceDialog({
  resource,
  trigger,
}: {
  resource?: Resource;
  trigger?: React.ReactNode;
}) {
  const { addResource, updateResource } = useItsm();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState(resource?.nome ?? "");
  const [papel, setPapel] = useState(resource?.papel ?? "");
  const [equipe, setEquipe] = useState(resource?.equipe ?? "");
  const [horasDia, setHorasDia] = useState(String(resource?.horasDia ?? 8));
  const [disp, setDisp] = useState(resource?.disponibilidadeProjetos ?? 50);

  function submit() {
    if (nome.trim().length < 3) {
      toast.error("Informe o nome do recurso.");
      return;
    }
    const horas = Number(horasDia);
    if (!Number.isFinite(horas) || horas <= 0 || horas > 12) {
      toast.error("Jornada diária inválida (1 a 12 horas).");
      return;
    }
    const payload = {
      nome: nome.trim().slice(0, 80),
      papel: papel.trim().slice(0, 80) || "A definir",
      equipe: equipe.trim().slice(0, 80) || "TI",
      horasDia: horas,
      disponibilidadeProjetos: Math.max(5, Math.min(100, disp)),
    };
    if (resource) updateResource(resource.id, payload);
    else addResource(payload);
    toast.success(resource ? "Recurso atualizado" : "Recurso cadastrado", {
      description: `${payload.nome} · ${payload.disponibilidadeProjetos}% do dia para projetos`,
    });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">Novo recurso</Button>}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{resource ? "Editar recurso" : "Cadastrar recurso"}</DialogTitle>
          <DialogDescription>
            O percentual de disponibilidade define quanto do dia da pessoa pode ser usado em
            projetos. O cronograma é recalculado com esse ritmo real.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="res-nome">Nome</Label>
            <Input id="res-nome" maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="res-papel">Papel</Label>
              <Input id="res-papel" maxLength={80} value={papel} onChange={(e) => setPapel(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="res-eq">Equipe</Label>
              <Input id="res-eq" maxLength={80} value={equipe} onChange={(e) => setEquipe(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="res-h">Jornada diária (h)</Label>
              <Input
                id="res-h"
                type="number"
                min={1}
                max={12}
                value={horasDia}
                onChange={(e) => setHorasDia(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>
              Disponibilidade para projetos: {disp}% ·{" "}
              {((Number(horasDia) || 0) * disp) / 100}h/dia
            </Label>
            <Slider
              value={[disp]}
              min={5}
              max={100}
              step={5}
              onValueChange={(v) => setDisp(v[0] ?? 50)}
            />
            <p className="text-xs text-muted-foreground">
              O restante do tempo permanece reservado para chamados e atividades de operação.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit}>{resource ? "Salvar" : "Cadastrar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
