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
import { useItsm } from "@/lib/itsm-store";
import {
  PROJECT_STATUS_LABEL,
  type Project,
  type ProjectStatus,
  type ProjectTask,
} from "@/lib/itsm-types";
import { toISODate } from "@/lib/project-utils";
import { capacityHours, demandAt, findResource } from "@/lib/resource-utils";

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
    if (nome.trim().length < 4) { toast.error("Informe o nome do projeto."); return; }
    if (gerente.trim().length < 3) { toast.error("Informe o gerente do projeto (GP)."); return; }
    if (new Date(fim) <= new Date(inicio)) { toast.error("A data fim deve ser após o início."); return; }
    const p = createProject({
      nome: nome.trim().slice(0, 120),
      objetivo: objetivo.trim().slice(0, 600),
      sponsor: sponsor.trim().slice(0, 80) || "A definir",
      gerente: gerente.trim().slice(0, 80),
      status,
      inicio,
      fim,
    });
    toast.success(`${p.id} criado`, { description: "Cadastre tarefas, riscos e a atualização semanal." });
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
            <Input id="p-nome" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} />
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
              <Input id="p-gp" maxLength={80} value={gerente} onChange={(e) => setGerente(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-sp">Sponsor</Label>
              <Input id="p-sp" maxLength={80} value={sponsor} onChange={(e) => setSponsor(e.target.value)} />
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
              <Input id="p-ini" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
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
}: {
  project: Project;
  task?: ProjectTask;
  trigger: React.ReactNode;
}) {
  const { addTask, updateTask, resources, projects } = useItsm();
  const [open, setOpen] = useState(false);
  const [nome, setNome] = useState(task?.nome ?? "");
  const [atividade, setAtividade] = useState(task?.atividade ?? "Execução");
  const [inicio, setInicio] = useState(task?.inicio ?? project.inicio);
  const [duracao, setDuracao] = useState(String(task?.duracao ?? 5));
  const [unidade, setUnidade] = useState<"dias" | "horas">(task?.duracaoUnidade ?? "dias");
  const [progresso, setProgresso] = useState(String(task?.progresso ?? 0));
  const [responsaveis, setResponsaveis] = useState((task?.responsaveis ?? [task?.responsavel ?? ""]).join(", "));
  const [paiId, setPaiId] = useState(task?.paiId ?? "");
  const [preds, setPreds] = useState<string[]>(task?.predecessoras ?? []);
  const [marco, setMarco] = useState(Boolean(task?.marco));
  const [alocacao, setAlocacao] = useState(String(task?.alocacaoPct ?? 100));

  const candidatas = project.tarefas.filter((t) => t.id !== task?.id);

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
    if (nome.trim().length < 3) { toast.error("Informe o nome da tarefa."); return; }
    const dur = Number(duracao);
    if (!Number.isFinite(dur) || dur <= 0) { toast.error("Informe uma duração válida."); return; }
    const dias = unidade === "horas" ? Math.max(dur / 8, 0.125) : dur;
    const fim = toISODate(new Date(`${inicio}T00:00:00`).getTime() + Math.max(dias - 1, 0) * 86_400_000);
    const pessoas = responsaveis
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (!pessoas.length) { toast.error("Atribua a tarefa a pelo menos uma pessoa."); return; }

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
      predecessoras: preds,
      paiId: paiId || undefined,
      marco,
      alocacaoPct: alocNum,
    };

    if (task) updateTask(project.id, task.id, payload);
    else addTask(project.id, payload);
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
            Duração em dias ou horas, predecessoras e hierarquia (tarefa pai) alimentam o caminho
            crítico.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="t-nome">Nome da tarefa</Label>
            <Input id="t-nome" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="t-ativ">Atividade</Label>
              <Input id="t-ativ" value={atividade} maxLength={80} onChange={(e) => setAtividade(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="t-ini">Início</Label>
              <Input id="t-ini" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
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
              <Select value={paiId || "none"} onValueChange={(v) => setPaiId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem tarefa pai</SelectItem>
                  {candidatas.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nome}
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
          </div>
          {candidatas.length > 0 && (
            <div className="grid gap-2">
              <Label>Predecessoras</Label>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
                {candidatas.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={preds.includes(t.id)}
                      onCheckedChange={(c) =>
                        setPreds((prev) => (c ? [...prev, t.id] : prev.filter((x) => x !== t.id)))
                      }
                    />
                    <span className="truncate">{t.nome}</span>
                  </label>
                ))}
              </div>
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
    if (descricao.trim().length < 10) { toast.error("Descreva a situação do projeto."); return; }
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
            <Textarea id="u-desc" rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-ult">Últimas entregas</Label>
            <Textarea id="u-ult" rows={3} value={ultimas} onChange={(e) => setUltimas(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="u-prox">Próximas entregas</Label>
            <Textarea id="u-prox" rows={3} value={proximas} onChange={(e) => setProximas(e.target.value)} />
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
    if (descricao.trim().length < 10) { toast.error("Descreva o risco."); return; }
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
            <Textarea id="r-desc" rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Probabilidade</Label>
              <Select value={probabilidade} onValueChange={(v) => setProbabilidade(v as typeof probabilidade)}>
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
            <Textarea id="r-mit" rows={3} value={mitigacao} onChange={(e) => setMitigacao(e.target.value)} />
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
    if (titulo.trim().length < 5) { toast.error("Informe o título do ponto de atenção."); return; }
    if (decisao.trim().length < 5) { toast.error("Informe a decisão necessária."); return; }
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
            <Input id="a-tit" maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="a-desc">Contexto</Label>
            <Textarea id="a-desc" rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="a-dec">Decisão necessária</Label>
            <Textarea id="a-dec" rows={2} value={decisao} onChange={(e) => setDecisao(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="a-resp">Responsável pela decisão</Label>
            <Input id="a-resp" maxLength={80} value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
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
