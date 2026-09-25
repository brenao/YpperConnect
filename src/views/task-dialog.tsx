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
import {
  TIPOS_DEPENDENCIA,
  TIPO_PADRAO,
  descreverDependencia,
  type Dependencia,
  type TipoDependencia,
} from "@/services/dependencias";
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
  /**
   * Término, opcional.
   *
   * Vazio significa "calcule": o servidor deriva a data do esforço e da
   * capacidade de quem executa. Preenchido, a data manda e o esforço
   * passa a ser o derivado — é o mesmo par de caminhos que a grade do
   * cronograma já oferece, agora disponível também no formulário.
   */
  fim: string;
  duracao: string;
  duracaoUnidade: Unidade;
  progresso: number;
  quadro: QuadroTarefa;
  marco: boolean;
  responsaveis: string[];
  /**
   * Predecessoras com tipo e defasagem, como na grade.
   *
   * Guardar só o id aqui obrigaria a pessoa a criar o vínculo no
   * diálogo e corrigir o tipo na grade — duas edições para uma decisão
   * só.
   */
  predecessoras: Dependencia[];
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
  predecessorasAtuais?: Dependencia[] | undefined;
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
    // Nasce vazio: quem cria informa o esforço, e o término sai dele.
    fim: "",
    duracao: String(ESFORCO_PADRAO),
    duracaoUnidade: "horas",
    progresso: 0,
    quadro: "backlog",
    marco: false,
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
            // Na edição o término vem preenchido: é o que está gravado,
            // e deixá-lo em branco faria o salvar recalcular a data sem
            // ninguém ter pedido.
            fim: paraInput(tarefa.fim),
            // Tarefa antiga, criada antes de o esforço existir, cai na
            // jornada padrão: melhor um valor editável do que um campo
            // vazio que o servidor recusaria ao salvar.
            duracao: String(tarefa.duracao ?? ESFORCO_PADRAO),
            duracaoUnidade: tarefa.duracaoUnidade === "dias" ? "dias" : "horas",
            progresso: tarefa.progresso,
            quadro: tarefa.quadro,
            marco: tarefa.marco,
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

  /**
   * Liga e desliga a predecessora.
   *
   * Ao ligar, nasce TI sem defasagem — o caso comum, e o que o vínculo
   * significava antes de os tipos existirem. Os controles de tipo e
   * dias só aparecem depois de marcada, para a lista não virar um
   * formulário de vinte linhas antes de alguém escolher qualquer coisa.
   */
  function alternarPredecessora(id: string) {
    setForm((f) => {
      const jaTem = f.predecessoras.some((p) => p.predecessoraId === id);
      return {
        ...f,
        predecessoras: jaTem
          ? f.predecessoras.filter((p) => p.predecessoraId !== id)
          : [...f.predecessoras, { predecessoraId: id, tipo: TIPO_PADRAO, defasagem: 0 }],
      };
    });
  }

  /** Edita uma aresta já marcada, sem mexer nas outras. */
  function mudarPredecessora(id: string, mudanca: Partial<Omit<Dependencia, "predecessoraId">>) {
    setForm((f) => ({
      ...f,
      predecessoras: f.predecessoras.map((p) =>
        p.predecessoraId === id ? { ...p, ...mudanca } : p,
      ),
    }));
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

    if (form.fim && form.fim < form.inicio) {
      toast.error("O término não pode ser anterior ao início.");
      return;
    }

    /**
     * `fim` só vai quando a pessoa digitou.
     *
     * Em branco, o término é calculado no servidor: é lá que se conhece
     * o regime de dias do projeto, os feriados da localidade de quem
     * executa e a capacidade diária dele — três coisas que a tela não
     * tem. Mandar uma data daqui sem necessidade seria mandar um
     * palpite que o reagendamento sobrescreveria em seguida.
     *
     * Digitado, ele manda. Existe tarefa com data contratada, e essa
     * não se discute com aritmética.
     */
    const base = {
      nome: form.nome.trim(),
      atividade: form.atividade.trim() || null,
      paiId: form.paiId === SEM ? null : form.paiId,
      inicio: doInput(form.inicio),
      ...(form.fim ? { fim: doInput(form.fim) } : {}),
      duracao,
      duracaoUnidade: form.duracaoUnidade,
      progresso: form.progresso,
      quadro: form.quadro,
      marco: form.marco,
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
            Deixe o término em branco para que ele seja calculado a partir do esforço e da
            capacidade diária de quem executa — aquele percentual definido em Recursos. Preencha
            quando a data já estiver fechada.
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

            {/* Opcional de propósito, e com o efeito dito embaixo: os
                dois caminhos são legítimos, e o que não pode é a pessoa
                preencher sem saber que acabou de desligar o cálculo. */}
            <div className="grid gap-2">
              <Label htmlFor="tsk-fim">
                Término{" "}
                <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="tsk-fim"
                type="date"
                min={form.inicio || undefined}
                value={form.fim}
                onChange={(e) => setForm({ ...form, fim: e.target.value })}
              />
            </div>

            {/* Esforço: é o trabalho previsto, e por padrão é ele que
                define o término. */}
            <div className="grid gap-2">
              <Label htmlFor="tsk-esforco">Esforço</Label>
              <div className="flex gap-2">
                <Input
                  id="tsk-esforco"
                  inputMode="decimal"
                  className="flex-1"
                  value={form.duracao}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      duracao: e.target.value.replace(/[^\d.,]/g, ""),
                    })
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

          <p className="rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground">
            {form.fim
              ? "Término fixado: o esforço acima vira referência de trabalho, e a data digitada é o que vale no cronograma."
              : "Término em branco: sai do esforço e da capacidade de quem executa, pulando fins de semana, feriados da localidade e as ausências dele."}
          </p>

          {/* Barra e campo apontam para o mesmo valor: a barra serve para
              o ajuste grosseiro, o campo para quem já sabe o número e
              não quer caçar a marca de 35% arrastando. */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="tsk-progresso">Progresso</Label>
              <span className="flex items-center gap-1">
                <Input
                  id="tsk-progresso"
                  inputMode="numeric"
                  className="h-8 w-16 text-right font-mono"
                  value={String(form.progresso)}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/\D/g, ""));
                    setForm({
                      ...form,
                      progresso: Math.min(100, Number.isFinite(n) ? n : 0),
                    });
                  }}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[form.progresso]}
              onValueChange={([v]) => setForm({ ...form, progresso: v ?? 0 })}
            />
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
                        setForm((f) => ({
                          ...f,
                          responsaveis: alternar(f.responsaveis, r.id),
                        }))
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
              {/* Tipo e defasagem aparecem só na linha marcada. É a
                  mesma tabela do MS Project — tarefa, tipo, dias —, mas
                  sem obrigar quem só quer o vínculo simples a encarar
                  três controles por linha. */}
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-border p-2">
                {outras.map((t) => {
                  const dep = form.predecessoras.find((p) => p.predecessoraId === t.id);

                  return (
                    <div key={t.id} className="rounded px-2 py-1 hover:bg-secondary/50">
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={dep !== undefined}
                          onCheckedChange={() => alternarPredecessora(t.id)}
                        />
                        <span className="truncate">{t.nome}</span>
                      </label>

                      {dep ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
                          <Select
                            value={dep.tipo}
                            onValueChange={(v) =>
                              mudarPredecessora(t.id, {
                                tipo: v as TipoDependencia,
                              })
                            }
                          >
                            <SelectTrigger className="h-8 w-52 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIPOS_DEPENDENCIA.map((op) => (
                                <SelectItem key={op.valor} value={op.valor}>
                                  {op.rotulo}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {/* O sinal aparece sempre: "+2" e "2" são a
                              mesma coisa, mas só o primeiro revela que
                              existe o outro lado — defasagem negativa,
                              que antecipa e cria sobreposição. */}
                          <span className="flex items-center gap-1.5">
                            <Input
                              inputMode="numeric"
                              className="h-8 w-20 text-right font-mono text-xs"
                              value={
                                dep.defasagem > 0 ? `+${dep.defasagem}` : String(dep.defasagem)
                              }
                              onChange={(e) => {
                                // O sinal fica; o resto vira dígito. Um
                                // "+" digitado é aceito e descartado,
                                // porque positivo já é o padrão.
                                const limpo = e.target.value.replace(/[^\d-]/g, "");
                                const negativo = limpo.startsWith("-");
                                const n =
                                  Number(limpo.replace(/-/g, "") || "0") * (negativo ? -1 : 1);
                                mudarPredecessora(t.id, {
                                  defasagem: Number.isFinite(n)
                                    ? Math.max(-365, Math.min(365, n))
                                    : 0,
                                });
                              }}
                            />
                            <span className="text-xs text-muted-foreground">dias</span>
                          </span>
                        </div>
                      ) : null}

                      {/* A frase por extenso é o que evita o erro mais
                          comum: escolher IT achando que é TI. */}
                      {dep ? (
                        <p className="mt-1 pl-6 text-[11px] text-muted-foreground">
                          Esta tarefa {descreverDependencia(t.nome, dep.tipo, dep.defasagem)}.
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                A defasagem é contada no regime do projeto — em dias úteis, pula fins de semana e
                feriados. Negativa antecipa e cria sobreposição.
              </p>
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
