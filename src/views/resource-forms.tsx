import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Recurso } from "@/repositories/recursos.repo";
import { listarEquipesFn, listarUsuariosFn } from "@/services/cadastros.functions";
import {
  criarRecursoFn,
  atualizarRecursoFn,
  type RecursoInput,
  type RecursoUpdateInput,
} from "@/services/recursos.functions";

/** Radix não aceita SelectItem com value vazio. */
const SEM = "__nenhum__";

interface Form {
  nome: string;
  usuarioId: string;
  papel: string;
  equipeId: string;
  horasDia: string;
  disponibilidade: number;
}

const vazio: Form = {
  nome: "",
  usuarioId: SEM,
  papel: "",
  equipeId: SEM,
  horasDia: "8",
  disponibilidade: 50,
};

export function ResourceDialog({ resource, trigger }: { resource?: Recurso; trigger?: ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const usuarios = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => listarUsuariosFn(),
    enabled: open,
  });
  const equipes = useQuery({
    queryKey: ["equipes"],
    queryFn: () => listarEquipesFn(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setForm(
      resource
        ? {
            nome: resource.nome,
            usuarioId: resource.usuarioId ?? SEM,
            papel: resource.papel ?? "",
            equipeId: resource.equipeId ?? SEM,
            horasDia: String(resource.horasDia),
            disponibilidade: resource.disponibilidadeProjetos,
          }
        : vazio,
    );
  }, [open, resource]);

  function sucesso() {
    qc.invalidateQueries({ queryKey: ["recursos"] });
    toast.success(resource ? "Recurso atualizado" : "Recurso cadastrado");
    setOpen(false);
  }
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: RecursoInput) => criarRecursoFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });
  const atualizar = useMutation({
    mutationFn: (v: RecursoUpdateInput) => atualizarRecursoFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });

  const salvando = criar.isPending || atualizar.isPending;
  const horas = Number(form.horasDia) || 0;
  const capacidade = Math.round(((horas * form.disponibilidade) / 100) * 10) / 10;

  function salvar() {
    if (form.nome.trim().length < 3) {
      toast.error("Informe o nome do recurso.");
      return;
    }
    if (horas <= 0 || horas > 24) {
      toast.error("Jornada deve estar entre 1 e 24 horas.");
      return;
    }

    const payload: RecursoInput = {
      nome: form.nome.trim(),
      usuarioId: form.usuarioId === SEM ? null : form.usuarioId,
      papel: form.papel.trim() || null,
      equipeId: form.equipeId === SEM ? null : form.equipeId,
      horasDia: horas,
      disponibilidadeProjetos: form.disponibilidade,
    };

    const idExistente = resource?.id;
    if (idExistente) {
      atualizar.mutate({ id: idExistente, ...payload });
    } else {
      criar.mutate(payload);
    }
  }

  /** Preencher o usuário sugere o nome, se ainda estiver vazio. */
  function aoEscolherUsuario(v: string) {
    const u = usuarios.data?.find((x) => x.id === v);
    setForm((f) => ({
      ...f,
      usuarioId: v,
      nome: f.nome.trim() === "" && u ? u.nome : f.nome,
      equipeId: f.equipeId === SEM && u?.equipeId ? u.equipeId : f.equipeId,
    }));
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-2">
            <Plus className="size-4" /> Novo recurso
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{resource ? "Editar recurso" : "Novo recurso"}</DialogTitle>
          <DialogDescription>
            Define quanto da jornada da pessoa fica disponível para projetos. O restante permanece
            no atendimento de chamados.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Vincular a um usuário</Label>
            <Select value={form.usuarioId} onValueChange={aoEscolherUsuario}>
              <SelectTrigger>
                <SelectValue placeholder="Opcional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem vínculo (terceiro, consultoria)</SelectItem>
                {(usuarios.data ?? [])
                  .filter((u) => u.ativo)
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="res-nome">Nome</Label>
            <Input
              id="res-nome"
              maxLength={200}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="res-papel">Papel</Label>
              <Input
                id="res-papel"
                maxLength={120}
                value={form.papel}
                onChange={(e) => setForm({ ...form, papel: e.target.value })}
                placeholder="Ex.: Analista de Infraestrutura"
              />
            </div>
            <div className="grid gap-2">
              <Label>Equipe</Label>
              <Select
                value={form.equipeId}
                onValueChange={(v) => setForm({ ...form, equipeId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Sem equipe</SelectItem>
                  {(equipes.data ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="res-horas">Jornada diária (horas)</Label>
            <Input
              id="res-horas"
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={form.horasDia}
              onChange={(e) => setForm({ ...form, horasDia: e.target.value })}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Disponibilidade para projetos</Label>
              <span className="font-mono text-sm">{form.disponibilidade}%</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[form.disponibilidade]}
              onValueChange={([v]) => setForm({ ...form, disponibilidade: v ?? 0 })}
            />
            <p className="text-xs text-muted-foreground">
              Capacidade para projetos: <strong>{capacidade}h/dia</strong>. O restante (
              {Math.round((horas - capacidade) * 10) / 10}h) fica para atendimento.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
