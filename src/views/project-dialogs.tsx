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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/models/itsm-types";
import type { Projeto } from "@/repositories/projetos.repo";
import {
  criarProjetoFn,
  atualizarProjetoFn,
  type ProjetoInput,
  type ProjetoUpdateInput,
} from "@/services/projetos.functions";
import { listarUsuariosFn } from "@/services/cadastros.functions";

/** Radix não aceita SelectItem com value vazio. */
const SEM = "__nenhum__";

/** Date para o formato aceito pelo input[type=date]. */
function paraInput(d: Date | string): string {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Constrói a data no fuso local a partir de yyyy-mm-dd.
 *
 * `new Date("2026-08-10")` seria interpretado como UTC e viraria dia 9
 * no Brasil. Como as colunas de data são DATE puro, o dia precisa ser
 * exatamente o que o usuário escolheu.
 */
function doInput(v: string): Date {
  const [a, m, d] = v.split("-").map(Number);
  return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function hojeMais(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return paraInput(d);
}

interface Form {
  nome: string;
  objetivo: string;
  sponsorId: string;
  gerenteId: string;
  status: ProjectStatus;
  inicio: string;
  fim: string;
}

const vazio = (): Form => ({
  nome: "",
  objetivo: "",
  sponsorId: SEM,
  gerenteId: SEM,
  status: "planejamento",
  inicio: paraInput(new Date()),
  fim: hojeMais(90),
});

export function ProjectDialog({ project, trigger }: { project?: Projeto; trigger?: ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(vazio);

  const usuarios = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => listarUsuariosFn(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setForm(
      project
        ? {
            nome: project.nome,
            objetivo: project.objetivo ?? "",
            sponsorId: project.sponsorId ?? SEM,
            gerenteId: project.gerenteId ?? SEM,
            status: project.status,
            inicio: paraInput(project.inicio),
            fim: paraInput(project.fim),
          }
        : vazio(),
    );
  }, [open, project]);

  function sucesso() {
    qc.invalidateQueries({ queryKey: ["projetos"] });
    qc.invalidateQueries({ queryKey: ["projeto", project?.id] });
    toast.success(project ? "Projeto atualizado" : "Projeto criado");
    setOpen(false);
  }
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: ProjetoInput) => criarProjetoFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });
  const atualizar = useMutation({
    mutationFn: (v: ProjetoUpdateInput) => atualizarProjetoFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });

  const salvando = criar.isPending || atualizar.isPending;

  function salvar() {
    if (form.nome.trim().length < 3) {
      toast.error("Informe o nome do projeto.");
      return;
    }
    const inicio = doInput(form.inicio);
    const fim = doInput(form.fim);
    if (fim < inicio) {
      toast.error("A data de término não pode ser anterior ao início.");
      return;
    }

    const payload: ProjetoInput = {
      nome: form.nome.trim(),
      objetivo: form.objetivo.trim() || null,
      sponsorId: form.sponsorId === SEM ? null : form.sponsorId,
      gerenteId: form.gerenteId === SEM ? null : form.gerenteId,
      status: form.status,
      inicio,
      fim,
    };

    const idExistente = project?.id;
    if (idExistente) {
      atualizar.mutate({ id: idExistente, ...payload });
    } else {
      criar.mutate(payload);
    }
  }

  const ativos = (usuarios.data ?? []).filter((u) => u.ativo);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-2">
            <Plus className="size-4" /> Novo projeto
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? "Editar projeto" : "Novo projeto"}</DialogTitle>
          <DialogDescription>
            O cronograma e as tarefas são cadastrados depois, dentro do projeto.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="prj-nome">Nome do projeto</Label>
            <Input
              id="prj-nome"
              maxLength={300}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex.: Migração do parque de estações"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="prj-obj">Objetivo</Label>
            <Textarea
              id="prj-obj"
              rows={3}
              maxLength={4000}
              value={form.objetivo}
              onChange={(e) => setForm({ ...form, objetivo: e.target.value })}
              placeholder="Que resultado de negócio este projeto entrega"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Gerente do projeto</Label>
              <Select
                value={form.gerenteId}
                onValueChange={(v) => setForm({ ...form, gerenteId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Eu mesmo</SelectItem>
                  {ativos.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Patrocinador</Label>
              <Select
                value={form.sponsorId}
                onValueChange={(v) => setForm({ ...form, sponsorId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Não definido</SelectItem>
                  {ativos.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="prj-ini">Início</Label>
              <Input
                id="prj-ini"
                type="date"
                value={form.inicio}
                onChange={(e) => setForm({ ...form, inicio: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="prj-fim">Término previsto</Label>
              <Input
                id="prj-fim"
                type="date"
                value={form.fim}
                onChange={(e) => setForm({ ...form, fim: e.target.value })}
              />
            </div>
          </div>

          {project ? (
            <div className="grid gap-2">
              <Label>Situação</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as ProjectStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {PROJECT_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground">
              O projeto nasce em <strong>Planejamento</strong>. Mude para Execução quando o
              cronograma estiver definido.
            </p>
          )}
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
