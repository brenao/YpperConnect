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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useItsm } from "@/controllers/itsm-store";
import {
  PROJECT_STATUS_LABEL,
  type Project,
  type ProjectStatus,
  type ProjectTask,
} from "@/models/itsm-types";
import { toISODate } from "@/services/project-utils";
import { capacityHours, demandAt, findResource } from "@/services/resource-utils";

const hoje = () => toISODate(Date.now());
const emDias = (n: number) => toISODate(Date.now() + n * 86_400_000);

const STATUSES = Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[];

export function NewProjectDialog({ onCreated }: { onCreated?: (p: Project) => void }) {
  const { createProject } = useItsm();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [gerente, setGerente] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planejamento");
  const [inicio, setInicio] = useState(hoje());
  const [fim, setFim] = useState(emDias(90));

  function submit() {
    if (nome.trim().length < 4) {
      toast.error("Informe o nome do projeto.");
      return;
    }
    if (gerente.trim().length < 3) {
      toast.error("Informe o gerente do projeto (GP).");
      return;
    }
    if (new Date(fim) <= new Date(inicio)) {
      toast.error("A data fim deve ser após o início.");
      return;
    }
    const p = createProject({
      nome: nome.trim().slice(0, 120),
      objetivo: objetivo.trim().slice(0, 600),
      sponsor: sponsor.trim().slice(0, 80) || "A definir",
      gerente: gerente.trim().slice(0, 80),
      status,
      inicio,
      fim,
    });
    toast.success(`${p.id} criado`, {
      description: "Cadastre tarefas, riscos e a atualização semanal.",
    });
    setOpen(false);
    setNome("");
    setObjetivo("");
    onCreated?.(p);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Novo projeto</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastrar projeto</DialogTitle>
          <DialogDescription>
            Todos os perfis podem cadastrar projetos. Riscos e atualização semanal são obrigatórios
            para manter o projeto verde.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="p-nome">Nome do projeto</Label>
            <Input
              id="p-nome"
              maxLength={120}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-obj">Objetivo</Label>
            <Textarea
              id="p-obj"
              rows={3}
              maxLength={600}
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="p-gp">Gerente do projeto (GP)</Label>
              <Input
                id="p-gp"
                maxLength={80}
                value={gerente}
                onChange={(e) => setGerente(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-sp">Sponsor</Label>
              <Input
                id="p-sp"
                maxLength={80}
                value={sponsor}
                onChange={(e) => setSponsor(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PROJECT_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div />
            <div className="grid gap-2">
              <Label htmlFor="p-ini">Início</Label>
              <Input
                id="p-ini"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-fim">Fim</Label>
              <Input id="p-fim" type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit}>Criar projeto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaskDialog({
  project,
  task,
  trigger,
  afterTask,
}: {
  project: Project;
  task?: ProjectTask;
  trigger: React.ReactNode;
  /** Quando informado, a nova tarefa é inserida logo abaixo desta. */
  afterTask?: ProjectTask;
}) {
  const { addTask, updateTask, resources, projects } = useItsm();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState(task?.nome ?? "");
  const [atividade, setAtividade] = useState(task?.atividade ?? "Execução");
  const [inicio, setInicio] = useState(task?.inicio ?? project.inicio);
  const [duracao, setDuracao] = useState(String(task?.duracao ?? 5));
  const [unidade, setUnidade] = useState<"dias" | "horas">(task?.duracaoUnidade ?? "dias");
  const [progresso, setProgresso] = useState(String(task?.progresso ?? 0));
  const [responsaveis, setResponsaveis] = useState(
    (task?.responsaveis ?? [task?.responsavel ?? ""]).join(", "),
  );
  const [paiId, setPaiId] = useState(task?.paiId ?? afterTask?.paiId ?? "");
  const [filhaDaAcima, setFilhaDaAcima] = useState(false);
  const [marco, setMarco] = useState(Boolean(task?.marco));
  const [alocacao, setAlocacao] = useState(String(task?.alocacaoPct ?? 100));

  const candidatas = project.tarefas.filter((t) => t.id !== task?.id);
  /** Número visível da tarefa = posição no cronograma (1..n). */
  const numeroPorId = new Map(project.tarefas.map((t, i) => [t.id, i + 1]));
  const idPorNumero = new Map(project.tarefas.map((t, i) => [i + 1, t.id]));
  const [predsTexto, setPredsTexto] = useState(
    (task?.predecessoras ?? [])
      .map((id) => numeroPorId.get(id))
      .filter((n): n is number => Boolean(n))
      .join(", "),
  );
  const numerosInformados = predsTexto
    .split(/[,;\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const numeroProprio = task ? numeroPorId.get(task.id) : undefined;
  const predsInvalidas = numerosInformados.filter(
    (n) => !idPorNumero.has(n) || (numeroProprio !== undefined && n === numeroProprio),
  );
  const predsIds = Array.from(
    new Set(
      numerosInformados.filter((n) => !predsInvalidas.includes(n)).map((n) => idPorNumero.get(n)!),
    ),
  );

  const pessoasSelecionadas = responsaveis
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const alocNum = Math.max(5, Math.min(100, Number(alocacao) || 100));
  const capacidade = pessoasSelecionadas.map((nome) => {
    const r = findResource(resources, nome);
    const jaAlocado = demandAt(nome, projects) - (task ? (task.alocacaoPct ?? 100) : 0);
    return {
      nome,
      cadastrado: Boolean(r),
      disponibilidade: r?.disponibilidadeProjetos ?? 100,
      horasDia: r ? (capacityHours(r) * alocNum) / 100 : (8 * alocNum) / 100,
      total: Math.max(jaAlocado, 0) + alocNum,
    };
  });

  function submit() {
    if (nome.trim().length < 3) {
      toast.error("Informe o nome da tarefa.");
      return;
    }
    if (predsInvalidas.length) {
      toast.error(`Predecessoras inválidas: ${predsInvalidas.join(", ")}`);
      return;
    }
    const dur = Number(duracao);
    if (!Number.isFinite(dur) || dur <= 0) {
      toast.error("Informe uma duração válida.");
      return;
    }
    const dias = unidade === "horas" ? Math.max(dur / 8, 0.125) : dur;
    const fim = toISODate(
      new Date(`${inicio}T00:00:00`).getTime() + Math.max(dias - 1, 0) * 86_400_000,
    );
    const pessoas = responsaveis
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (!pessoas.length) {
      toast.error("Atribua a tarefa a pelo menos uma pessoa.");
      return;
    }

    const paiFinal = !task && afterTask && filhaDaAcima ? afterTask.id : paiId || undefined;
    const payload = {
      nome: nome.trim().slice(0, 120),
      atividade: atividade.trim().slice(0, 80),
      inicio,
      fim,
      duracao: dur,
      duracaoUnidade: unidade,
      progresso: Math.max(0, Math.min(100, Number(progresso) || 0)),
      responsavel: pessoas[0]!,
      responsaveis: pessoas,
      predecessoras: predsIds,
      paiId: paiFinal,
      marco,
      alocacaoPct: alocNum,
    };

    if (task) updateTask(project.id, task.id, payload);
    else addTask(project.id, payload, afterTask?.id);
    toast.success(task ? "Tarefa atualizada" : "Tarefa adicionada");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
          <DialogDescription>
            {afterTask && !task
              ? `Será inserida logo abaixo de "${afterTask.nome}". Duração, predecessoras e hierarquia alimentam o caminho crítico.`
              : "Duração em dias ou horas, predecessoras e hierarquia (tarefa pai) alimentam o caminho crítico."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {afterTask && !task ? (
            <label className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <Checkbox
                checked={filhaDaAcima}
                onCheckedChange={(c) => setFilhaDaAcima(Boolean(c))}
                className="mt-0.5"
              />
              <span>
                Criar como subtarefa de <span className="font-medium">{afterTask.nome}</span>
                <span className="block text-xs text-muted-foreground">
                  Deixe desmarcado para criar no mesmo nível da tarefa acima.
                </span>
              </span>
            </label>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="t-nome">Nome da tarefa</Label>
            <Input
              id="t-nome"
              value={nome}
              maxLength={120}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="t-ativ">Atividade</Label>
              <Input
                id="t-ativ"
                value={atividade}
                maxLength={80}
                onChange={(e) => setAtividade(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-ini">Início</Label>
              <Input
                id="t-ini"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-dur">Duração</Label>
              <Input
                id="t-dur"
                type="number"
                min={1}
                value={duracao}
                onChange={(e) => setDuracao(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Unidade</Label>
              <Select value={unidade} onValueChange={(v) => setUnidade(v as "dias" | "horas")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dias">Dias</SelectItem>
                  <SelectItem value="horas">Horas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-prog">% concluído</Label>
              <Input
                id="t-prog"
                type="number"
                min={0}
                max={100}
                value={progresso}
                onChange={(e) => setProgresso(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label>Tarefa pai</Label>
              <Select
                value={paiId || "none"}
                onValueChange={(v) => setPaiId(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem tarefa pai</SelectItem>
                  {candidatas.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {numeroPorId.get(t.id)}. {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="t-resp">Responsáveis (separe por vírgula)</Label>
            <Input
              id="t-resp"
              value={responsaveis}
              onChange={(e) => setResponsaveis(e.target.value)}
              placeholder="Rafael Lima, Bruna Sato"
            />
            {resources.length ? (
              <div className="flex flex-wrap gap-1">
                {resources.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    onClick={() =>
                      setResponsaveis((prev) => {
                        const atuais = prev
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean);
                        return atuais.includes(r.nome)
                          ? atuais.filter((x) => x !== r.nome).join(", ")
                          : [...atuais, r.nome].join(", ");
                      })
                    }
                  >
                    {r.nome} · {r.disponibilidadeProjetos}%
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="t-aloc">% de alocação do recurso nesta tarefa</Label>
            <Input
              id="t-aloc"
              type="number"
              min={5}
              max={100}
              value={alocacao}
              onChange={(e) => setAlocacao(e.target.value)}
            />
            <div className="space-y-1 text-[11px] text-muted-foreground">
              {capacidade.map((c) => (
                <p key={c.nome} className={c.total > 100 ? "text-destructive" : undefined}>
                  {c.nome}:{" "}
                  {c.cadastrado
                    ? `${c.disponibilidade}% do dia para projetos`
                    : "não cadastrado como recurso"}{" "}
                  · {c.horasDia.toFixed(1)}h/dia nesta tarefa · carga total no portfólio{" "}
                  {Math.round(c.total)}%{c.total > 100 ? " (sobrealocado)" : ""}
                </p>
              ))}
            </div>
          </div>
          {candidatas.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="t-preds">
                Predecessoras (números das tarefas, separados por vírgula)
              </Label>
              <Input
                id="t-preds"
                value={predsTexto}
                onChange={(e) => setPredsTexto(e.target.value)}
                placeholder="Ex.: 2, 5, 7"
                className={predsInvalidas.length ? "border-destructive" : undefined}
              />
              {predsInvalidas.length ? (
                <p className="text-[11px] text-destructive">
                  Número(s) inexistente(s) ou inválido(s): {predsInvalidas.join(", ")}
                </p>
              ) : predsIds.length ? (
                <p className="text-[11px] text-muted-foreground">
                  Após:{" "}
                  {predsIds
                    .map(
                      (id) =>
                        `${numeroPorId.get(id)}. ${project.tarefas.find((x) => x.id === id)?.nome ?? id}`,
                    )
                    .join(" · ")}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Use a coluna <strong>#</strong> do cronograma para identificar o número de cada
                  tarefa.
                </p>
              )}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={marco} onCheckedChange={(c) => setMarco(Boolean(c))} />
            Marco do projeto
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit}>{task ? "Salvar" : "Adicionar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WeeklyUpdateDialog({ project }: { project: Project }) {
  const { addProjectUpdate } = useItsm();
  const [open, setOpen] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [ultimas, setUltimas] = useState("");
  const [proximas, setProximas] = useState("");

  function submit() {
    if (descricao.trim().length < 10) {
      toast.error("Descreva a situação do projeto.");
      return;
    }
    addProjectUpdate(project.id, {
      data: new Date().toISOString(),
      autor: project.gerente,
      descricao: descricao.trim().slice(0, 1500),
      ultimasEntregas: ultimas.trim().slice(0, 800),
      proximasEntregas: proximas.trim().slice(0, 800),
    });
    toast.success("Atualização semanal registrada");
    setOpen(false);
    setDescricao("");
    setUltimas("");
    setProximas("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Atualização semanal
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Atualização semanal do projeto</DialogTitle>
          <DialogDescription>
            Obrigatória toda semana. Após 7 dias o projeto fica amarelo; após 14 dias, vermelho.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="u-desc">Situação atual do projeto</Label>
            <Textarea
              id="u-desc"
              rows={4}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-ult">Últimas entregas</Label>
            <Textarea
              id="u-ult"
              rows={3}
              value={ultimas}
              onChange={(e) => setUltimas(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-prox">Próximas entregas</Label>
            <Textarea
              id="u-prox"
              rows={3}
              value={proximas}
              onChange={(e) => setProximas(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RiskDialog({ project }: { project: Project }) {
  const { addRisk } = useItsm();
  const [open, setOpen] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [probabilidade, setProbabilidade] = useState<"alta" | "media" | "baixa">("media");
  const [impacto, setImpacto] = useState<"alto" | "medio" | "baixo">("medio");
  const [mitigacao, setMitigacao] = useState("");

  function submit() {
    if (descricao.trim().length < 10) {
      toast.error("Descreva o risco.");
      return;
    }
    addRisk(project.id, {
      descricao: descricao.trim().slice(0, 500),
      probabilidade,
      impacto,
      mitigacao: mitigacao.trim().slice(0, 500),
      status: "aberto",
    });
    toast.success("Risco cadastrado");
    setOpen(false);
    setDescricao("");
    setMitigacao("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Cadastrar risco
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cadastro de risco</DialogTitle>
          <DialogDescription>Projetos sem risco cadastrado ficam em alerta.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="r-desc">Risco</Label>
            <Textarea
              id="r-desc"
              rows={3}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Probabilidade</Label>
              <Select
                value={probabilidade}
                onValueChange={(v) => setProbabilidade(v as typeof probabilidade)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="baixa">Baixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Impacto</Label>
              <Select value={impacto} onValueChange={(v) => setImpacto(v as typeof impacto)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alto">Alto</SelectItem>
                  <SelectItem value="medio">Médio</SelectItem>
                  <SelectItem value="baixo">Baixo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="r-mit">Plano de mitigação</Label>
            <Textarea
              id="r-mit"
              rows={3}
              value={mitigacao}
              onChange={(e) => setMitigacao(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit}>Cadastrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AttentionDialog({ project }: { project: Project }) {
  const { addAttention } = useItsm();
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [decisao, setDecisao] = useState("");
  const [responsavel, setResponsavel] = useState(project.sponsor);

  function submit() {
    if (titulo.trim().length < 5) {
      toast.error("Informe o título do ponto de atenção.");
      return;
    }
    if (decisao.trim().length < 5) {
      toast.error("Informe a decisão necessária.");
      return;
    }
    addAttention(project.id, {
      titulo: titulo.trim().slice(0, 120),
      descricao: descricao.trim().slice(0, 800),
      decisaoNecessaria: decisao.trim().slice(0, 400),
      responsavelDecisao: responsavel.trim().slice(0, 80) || project.sponsor,
    });
    toast.success("Ponto de atenção registrado para a diretoria");
    setOpen(false);
    setTitulo("");
    setDescricao("");
    setDecisao("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Atenção / decisão
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ponto de atenção</DialogTitle>
          <DialogDescription>
            Problema que exige ação imediata do superior ou uma decisão a ser tomada.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="a-tit">Título</Label>
            <Input
              id="a-tit"
              maxLength={120}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="a-desc">Contexto</Label>
            <Textarea
              id="a-desc"
              rows={3}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="a-dec">Decisão necessária</Label>
            <Textarea
              id="a-dec"
              rows={2}
              value={decisao}
              onChange={(e) => setDecisao(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="a-resp">Responsável pela decisão</Label>
            <Input
              id="a-resp"
              maxLength={80}
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
