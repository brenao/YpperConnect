import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Slider } from "@/components/ui/slider";
import type { QuadroTarefa, Tarefa } from "@/repositories/projetos.repo";
import type { Recurso } from "@/repositories/recursos.repo";
import {
  criarTarefaFn,
  atualizarTarefaFn,
  excluirTarefaFn,
  type TarefaInput,
  type TarefaUpdateInput,
} from "@/services/projetos.functions";
import { QUADROS } from "./project-kanban";

const SEM = "__nenhum__";

/** Esforço de uma tarefa recém-criada: uma jornada. */
const ESFORCO_PADRAO = 8;

type Unidade = "horas" | "dias";

function paraInput(d: Date | string): string {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Constrói no fuso local: parsing ISO puro viraria o dia anterior. */
function doInput(v: string): Date {
  const [a, m, d] = v.split("-").map(Number);
  return new Date(a ?? 1970, (m ?? 1) - 1, d ?? 1);
}

interface Form {
  nome: string;
  atividade: string;
  paiId: string;
  inicio: string;
  duracao: string;
  duracaoUnidade: Unidade;
  progresso: number;
  quadro: QuadroTarefa;
  marco: boolean;
  alocacao: number;
  responsaveis: string[];
  predecessoras: string[];
}

export function TaskDialog({
  projetoId,
  tarefa,
  tarefas,
  recursos,
  responsaveisAtuais,
  predecessorasAtuais,
  trigger,
  open,
  onOpenChange,
}: {
  projetoId: string;
  tarefa?: Tarefa | undefined;
  tarefas: Tarefa[];
  recursos: Recurso[];
  responsaveisAtuais?: string[] | undefined;
  predecessorasAtuais?: string[] | undefined;
  trigger?: ReactNode | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((v: boolean) => void) | undefined;
}) {
  const qc = useQueryClient();
  const [interno, setInterno] = useState(false);
  const aberto = open ?? interno;
  const setAberto = onOpenChange ?? setInterno;

  const vazio = (): Form => ({
    nome: "",
    atividade: "",
    paiId: SEM,
    inicio: paraInput(new Date()),
    duracao: String(ESFORCO_PADRAO),
    duracaoUnidade: "horas",
    progresso: 0,
    quadro: "backlog",
    marco: false,
    alocacao: 100,
    responsaveis: [],
    predecessoras: [],
  });

  const [form, setForm] = useState<Form>(vazio);

  useEffect(() => {
    if (!aberto) return;
    setForm(
      tarefa
        ? {
            nome: tarefa.nome,
            atividade: tarefa.atividade ?? "",
            paiId: tarefa.paiId ?? SEM,
            inicio: paraInput(tarefa.inicio),
            // Tarefa antiga, criada antes de o esforço existir, cai na
            // jornada padrão: melhor um valor editável do que um campo
            // vazio que o servidor recusaria ao salvar.
            duracao: String(tarefa.duracao ?? ESFORCO_PADRAO),
            duracaoUnidade: tarefa.duracaoUnidade === "dias" ? "dias" : "horas",
            progresso: tarefa.progresso,
            quadro: tarefa.quadro,
            marco: tarefa.marco,
            alocacao: tarefa.alocacaoPct ?? 100,
            responsaveis: responsaveisAtuais ?? [],
            predecessoras: predecessorasAtuais ?? [],
          }
        : vazio(),
    );
  }, [aberto, tarefa, responsaveisAtuais, predecessorasAtuais]);

  function sucesso(msg: string) {
    qc.invalidateQueries({ queryKey: ["projeto", projetoId] });
    qc.invalidateQueries({ queryKey: ["projetos"] });
    qc.invalidateQueries({ queryKey: ["recursos"] });
    toast.success(msg);
    setAberto(false);
  }
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: TarefaInput) => criarTarefaFn({ data: v }),
    onSuccess: () => sucesso("Tarefa criada"),
    onError: erro,
  });
  const atualizar = useMutation({
    mutationFn: (v: TarefaUpdateInput) => atualizarTarefaFn({ data: v }),
    onSuccess: () => sucesso("Tarefa atualizada"),
    onError: erro,
  });
  const excluir = useMutation({
    mutationFn: (id: string) => excluirTarefaFn({ data: { id } }),
    onSuccess: () => sucesso("Tarefa excluída"),
    onError: erro,
  });

  const salvando = criar.isPending || atualizar.isPending || excluir.isPending;

  /** Candidatas a pai ou predecessora: nunca a própria tarefa. */
  const outras = tarefas.filter((t) => t.id !== tarefa?.id);

  function alternar(lista: string[], id: string) {
    return lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];
  }

  function salvar() {
    if (form.nome.trim().length < 3) {
      toast.error("Informe o nome da tarefa.");
      return;
    }

    const duracao = Number(form.duracao.replace(",", "."));
    if (!Number.isFinite(duracao) || duracao <= 0) {
      toast.error("Informe um esforço maior que zero.");
      return;
    }

    /**
     * Sem `fim`: o término é calculado no servidor.
     *
     * É lá que se conhece o regime de dias do projeto, os feriados e a
     * capacidade diária de cada responsável — três coisas que a tela
     * não tem. Mandar uma data daqui seria mandar um palpite que o
     * reagendamento sobrescreveria em seguida.
     */
    const base = {
      nome: form.nome.trim(),
      atividade: form.atividade.trim() || null,
      paiId: form.paiId === SEM ? null : form.paiId,
      inicio: doInput(form.inicio),
      duracao,
      duracaoUnidade: form.duracaoUnidade,
      progresso: form.progresso,
      quadro: form.quadro,
      marco: form.marco,
      alocacaoPct: form.alocacao,
      responsaveis: form.responsaveis,
      predecessoras: form.predecessoras,
    };

    const idExistente = tarefa?.id;
    if (idExistente) {
      atualizar.mutate({ id: idExistente, ...base });
    } else {
      criar.mutate({ projetoId, ...base });
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tarefa ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
          <DialogDescription>
            O término é calculado a partir do esforço, da alocação e da capacidade diária de quem
            executa. Para ajustar a data final à mão, use a grade do cronograma.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Nome</Label>
            <Input
              maxLength={300}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Atividade / fase</Label>
              <Input
                maxLength={200}
                value={form.atividade}
                onChange={(e) => setForm({ ...form, atividade: e.target.value })}
                placeholder="Ex.: Levantamento"
              />
            </div>
            <div className="grid gap-2">
              <Label>Tarefa mãe (WBS)</Label>
              <Select value={form.paiId} onValueChange={(v) => setForm({ ...form, paiId: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM}>Nenhuma (nível raiz)</SelectItem>
                  {outras.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tsk-inicio">Início</Label>
              <Input
                id="tsk-inicio"
                type="date"
                value={form.inicio}
                onChange={(e) => setForm({ ...form, inicio: e.target.value })}
              />
            </div>

            {/* Esforço no lugar do término: é o trabalho previsto que se
                estima, e a data final é consequência dele. */}
            <div className="grid gap-2">
              <Label htmlFor="tsk-esforco">Esforço</Label>
              <div className="flex gap-2">
                <Input
                  id="tsk-esforco"
                  inputMode="decimal"
                  className="flex-1"
                  value={form.duracao}
                  onChange={(e) =>
                    setForm({ ...form, duracao: e.target.value.replace(/[^\d.,]/g, "") })
                  }
                />
                <Select
                  value={form.duracaoUnidade}
                  onValueChange={(v) => setForm({ ...form, duracaoUnidade: v as Unidade })}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="horas">horas</SelectItem>
                    <SelectItem value="dias">dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Situação</Label>
              <Select
                value={form.quadro}
                onValueChange={(v) => setForm({ ...form, quadro: v as QuadroTarefa })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUADROS.map((q) => (
                    <SelectItem key={q.key} value={q.key}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Checkbox
                id="tsk-marco"
                checked={form.marco}
                onCheckedChange={(v) => setForm({ ...form, marco: v === true })}
              />
              <Label htmlFor="tsk-marco" className="text-sm">
                É um marco
              </Label>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Progresso</Label>
              <span className="font-mono text-sm">{form.progresso}%</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[form.progresso]}
              onValueChange={([v]) => setForm({ ...form, progresso: v ?? 0 })}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Alocação do responsável</Label>
              <span className="font-mono text-sm">{form.alocacao}%</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={10}
              value={[form.alocacao]}
              onValueChange={([v]) => setForm({ ...form, alocacao: v ?? 0 })}
            />
            <p className="text-xs text-muted-foreground">
              Quanto da capacidade diária do responsável esta tarefa consome. Metade da alocação
              dobra o prazo sem mudar o esforço.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Responsáveis</Label>
            {recursos.length === 0 ? (
              <p className="text-xs text-warning">
                Nenhum recurso cadastrado. Cadastre em Recursos e capacidade.
              </p>
            ) : (
              <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
                {recursos.map((r) => (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-secondary/50"
                  >
                    <Checkbox
                      checked={form.responsaveis.includes(r.id)}
                      onCheckedChange={() =>
                        setForm((f) => ({ ...f, responsaveis: alternar(f.responsaveis, r.id) }))
                      }
                    />
                    <span className="truncate">{r.nome}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {outras.length > 0 ? (
            <div className="grid gap-2">
              <Label>Predecessoras</Label>
              <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
                {outras.map((t) => (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-secondary/50"
                  >
                    <Checkbox
                      checked={form.predecessoras.includes(t.id)}
                      onCheckedChange={() =>
                        setForm((f) => ({ ...f, predecessoras: alternar(f.predecessoras, t.id) }))
                      }
                    />
                    <span className="truncate">{t.nome}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {tarefa ? (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={salvando}
              onClick={() => {
                if (confirm("Excluir esta tarefa e suas subtarefas?")) excluir.mutate(tarefa.id);
              }}
            >
              Excluir
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="ghost" onClick={() => setAberto(false)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
