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
import { Switch } from "@/components/ui/switch";
import { ESFORCOS, VALORES, calcularScore, type ModeloPriorizacao } from "@/services/priorizacao";
import { cn } from "@/lib/utils";

/** Radix não aceita SelectItem com value vazio. */
const SEM = "__nenhum__";

interface Form {
  nome: string;
  objetivo: string;
  sponsorId: string;
  gerenteId: string;
  status: ProjectStatus;
  usaDiasUteis: boolean;
  areaDemandante: string;
  justificativa: string;
  valor: number | null;
  esforco: number | null;
  alcance: number | null;
  confianca: number | null;
}

const vazio = (status: ProjectStatus): Form => ({
  nome: "",
  objetivo: "",
  sponsorId: SEM,
  gerenteId: SEM,
  status,
  usaDiasUteis: true,
  areaDemandante: "",
  justificativa: "",
  valor: null,
  esforco: null,
  alcance: null,
  confianca: 80,
});

/**
 * Cadastro de projeto, um só para backlog e execução.
 *
 * Os campos são idênticos nos dois casos de propósito. Dois formulários
 * diferentes fariam a promoção do backlog perder informação ou pedir de
 * novo o que já tinha sido preenchido — e o projeto que nasce direto em
 * planejamento ficaria sem a justificativa que sustenta a decisão.
 *
 * O que muda entre os dois é só a ênfase: no backlog a priorização vem
 * aberta, porque é o que se está decidindo ali.
 */
export function ProjectDialog({
  project,
  trigger,
  statusInicial = "planejamento",
  modelo = "simples",
  aoSalvar,
}: {
  project?: Projeto;
  trigger?: ReactNode;
  /** Estado em que o projeto nasce. O backlog cria já em "backlog". */
  statusInicial?: ProjectStatus;
  modelo?: ModeloPriorizacao;
  aoSalvar?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(() => vazio(statusInicial));

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
            usaDiasUteis: project.usaDiasUteis,
            areaDemandante: project.areaDemandante ?? "",
            justificativa: project.justificativa ?? "",
            valor: project.valor,
            esforco: project.esforco,
            alcance: project.alcance,
            confianca: project.confianca ?? 80,
          }
        : vazio(statusInicial),
    );
  }, [open, project, statusInicial]);

  const noBacklog = form.status === "backlog";

  function sucesso() {
    qc.invalidateQueries({ queryKey: ["projetos"] });
    qc.invalidateQueries({ queryKey: ["backlog"] });
    qc.invalidateQueries({ queryKey: ["projeto", project?.id] });
    toast.success(project ? "Projeto atualizado" : "Projeto criado");
    aoSalvar?.();
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
  const score = calcularScore(modelo, form);

  function salvar() {
    if (form.nome.trim().length < 3) {
      toast.error("Informe o nome do projeto.");
      return;
    }

    const payload: ProjetoInput = {
      nome: form.nome.trim(),
      objetivo: form.objetivo.trim() || null,
      sponsorId: form.sponsorId === SEM ? null : form.sponsorId,
      gerenteId: form.gerenteId === SEM ? null : form.gerenteId,
      status: form.status,
      usaDiasUteis: form.usaDiasUteis,
      areaDemandante: form.areaDemandante.trim() || null,
      justificativa: form.justificativa.trim() || null,
      valor: form.valor,
      esforco: form.esforco,
      alcance: modelo === "rice" ? form.alcance : null,
      confianca: modelo === "rice" ? form.confianca : null,
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
            {noBacklog
              ? "Vai para o backlog: não cobra acompanhamento nem ocupa capacidade até ser priorizado."
              : "O cronograma e as tarefas são cadastrados depois, dentro do projeto."}
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
              <Label htmlFor="prj-area">Área demandante</Label>
              <Input
                id="prj-area"
                maxLength={160}
                value={form.areaDemandante}
                onChange={(e) => setForm({ ...form, areaDemandante: e.target.value })}
                placeholder="Ex.: Comercial"
              />
            </div>
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
            <Label htmlFor="prj-just">Por que precisa ser feito</Label>
            <Textarea
              id="prj-just"
              rows={2}
              maxLength={4000}
              value={form.justificativa}
              onChange={(e) => setForm({ ...form, justificativa: e.target.value })}
              placeholder="O problema que resolve, ou o que acontece se não for feito"
            />
            {/* É o campo que se lê na hora de recusar ou adiar. */}
            <p className="text-xs text-muted-foreground">
              Sustenta a decisão quando o projeto for priorizado, adiado ou recusado.
            </p>
          </div>

          {/* ------------------------------------------------ priorização */}
          <div className="grid gap-4 rounded-lg border border-border bg-surface p-3">
            <div className="grid gap-2">
              <Label>Valor para o negócio</Label>
              <Select
                value={form.valor === null ? "" : String(form.valor)}
                onValueChange={(v) => setForm({ ...form, valor: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Ainda não avaliado" />
                </SelectTrigger>
                <SelectContent>
                  {VALORES.map((v) => (
                    <SelectItem key={v.valor} value={String(v.valor)}>
                      {v.valor} · {v.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {modelo === "rice" ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="prj-alcance">Alcance</Label>
                    <Input
                      id="prj-alcance"
                      type="number"
                      min={0}
                      value={form.alcance ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          alcance: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      placeholder="Pessoas afetadas"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="prj-conf">Confiança (%)</Label>
                    <Input
                      id="prj-conf"
                      type="number"
                      min={0}
                      max={100}
                      value={form.confianca ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          confianca: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="prj-esforco">Esforço (pessoa-dias)</Label>
                  <Input
                    id="prj-esforco"
                    type="number"
                    min={1}
                    value={form.esforco ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        esforco: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </div>
              </>
            ) : (
              <div className="grid gap-2">
                <Label>Esforço</Label>
                <div className="flex gap-2">
                  {ESFORCOS.map((e) => (
                    <button
                      key={e.valor}
                      type="button"
                      onClick={() =>
                        setForm({ ...form, esforco: form.esforco === e.valor ? null : e.valor })
                      }
                      aria-pressed={form.esforco === e.valor}
                      className={cn(
                        "flex-1 rounded-md border p-2 text-left transition-colors",
                        form.esforco === e.valor
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      <span className="block text-sm font-semibold">{e.rotulo}</span>
                      <span className="block text-[11px] text-muted-foreground">{e.descricao}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {score === null
                ? "Valor e esforço definem a posição na fila do backlog. Podem ficar em branco."
                : `Score ${score}. É a sugestão de ordem — a fila final é arrastada à mão.`}
            </p>
          </div>

          {/* O período não é digitado: ele é o intervalo das tarefas.
              Dois campos editáveis permitiriam um projeto que termina
              em março com tarefa entregando em maio. */}
          <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
            <p className="text-xs text-muted-foreground">
              O início e o término do projeto vêm das datas das tarefas do cronograma, e se ajustam
              sozinhos conforme elas mudam.
            </p>

            <div className="flex items-start gap-3">
              <Switch
                id="prj-dias-uteis"
                checked={form.usaDiasUteis}
                onCheckedChange={(v) => setForm({ ...form, usaDiasUteis: v })}
              />
              <div className="grid gap-0.5">
                <Label htmlFor="prj-dias-uteis" className="text-sm">
                  Cronograma em dias úteis
                </Label>
                <span className="text-xs text-muted-foreground">
                  Desligue apenas para projeto com equipe escalada no fim de semana — virada de
                  sistema, parada de fábrica. Feriados e finais de semana deixam de ser pulados.
                </span>
              </div>
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
              {noBacklog ? (
                <>
                  O projeto nasce no <strong>Backlog</strong>. Promova quando ele for priorizado, e
                  aí começa o cronograma.
                </>
              ) : (
                <>
                  O projeto nasce em <strong>Planejamento</strong>. Mude para Execução quando o
                  cronograma estiver definido.
                </>
              )}
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
