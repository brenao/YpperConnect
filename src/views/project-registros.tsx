/**
 * Riscos, pontos de atenção e atualizações de status.
 *
 * Ficam na aba Tarefas em vez de aba própria: quem abre o cronograma
 * precisa ver na mesma tela o que ameaça o prazo. Cada painel rola por
 * dentro para a grade continuar sendo o assunto principal.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, MessageSquarePlus, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { doInput, fmt, paraInput } from "@/lib/datas";
import { cn } from "@/lib/utils";
import type { Atencao, Atualizacao, Risco } from "@/repositories/projetos.repo";
import { listarUsuariosFn } from "@/services/cadastros.functions";
import type { AtencaoInput, AtualizacaoInput, RiscoInput } from "@/services/projetos.functions";

const SEM = "__nenhum__";

const nivelStyle: Record<string, string> = {
  alta: "border-destructive/40 text-destructive",
  alto: "border-destructive/40 text-destructive",
  media: "border-warning/40 text-warning",
  medio: "border-warning/40 text-warning",
  baixa: "border-border text-muted-foreground",
  baixo: "border-border text-muted-foreground",
};

// ---------------------------------------------------------------- riscos

export function PainelRiscos({
  projetoId,
  riscos,
  editavel,
  salvando,
  onSalvar,
}: {
  projetoId: string;
  riscos: Risco[];
  editavel: boolean;
  salvando: boolean;
  onSalvar: (v: RiscoInput) => void;
}) {
  const abertos = riscos.filter((r) => r.status !== "mitigado");

  return (
    <section
      className={cn("panel flex flex-col p-4", riscos.length === 0 ? "border-warning/40" : "")}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="size-4 text-warning" /> Riscos
          {abertos.length > 0 ? (
            <span className="font-mono text-xs text-muted-foreground">{abertos.length}</span>
          ) : null}
        </h2>
        {editavel ? (
          <RiscoDialog projetoId={projetoId} onSalvar={onSalvar} salvando={salvando} />
        ) : null}
      </div>

      {riscos.length === 0 ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          Projeto sem risco cadastrado. Todo projeto deve ter ao menos um risco identificado.
        </p>
      ) : (
        <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
          {riscos.map((r) => (
            <li key={r.id} className="rounded-lg border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={cn("text-[10px]", nivelStyle[r.probabilidade])}>
                  prob. {r.probabilidade}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px]", nivelStyle[r.impacto])}>
                  impacto {r.impacto}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {r.status}
                </Badge>
              </div>
              <p className="mt-1.5 text-xs">{r.descricao}</p>
              {r.mitigacao ? (
                <p className="mt-1 text-[11px] text-muted-foreground">Mitigação: {r.mitigacao}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// -------------------------------------------------------------- atenções

export function PainelAtencoes({
  projetoId,
  atencoes,
  editavel,
  salvando,
  resolvendo,
  onSalvar,
  onResolver,
}: {
  projetoId: string;
  atencoes: Atencao[];
  editavel: boolean;
  salvando: boolean;
  resolvendo: boolean;
  onSalvar: (v: AtencaoInput) => void;
  onResolver: (id: string) => void;
}) {
  const abertas = atencoes.filter((a) => a.status === "aberto");

  return (
    <section className="panel flex flex-col p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="size-4 text-destructive" /> Pontos de atenção
          {abertas.length > 0 ? (
            <span className="font-mono text-xs text-destructive">{abertas.length}</span>
          ) : null}
        </h2>
        {editavel ? (
          <AtencaoDialog projetoId={projetoId} onSalvar={onSalvar} salvando={salvando} />
        ) : null}
      </div>

      {atencoes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Nenhuma decisão pendente registrada.</p>
      ) : (
        <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
          {atencoes.map((a) => (
            <li
              key={a.id}
              className={cn(
                "rounded-lg border p-2.5",
                a.status === "aberto"
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-border opacity-70",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium">{a.titulo}</p>
                {editavel && a.status === "aberto" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 shrink-0 text-[11px]"
                    disabled={resolvendo}
                    onClick={() => onResolver(a.id)}
                  >
                    Resolver
                  </Button>
                ) : null}
              </div>
              {a.descricao ? (
                <p className="mt-1 text-[11px] text-muted-foreground">{a.descricao}</p>
              ) : null}
              {a.decisaoNecessaria ? (
                <p className="mt-1 text-[11px]">
                  <strong>Decisão:</strong> {a.decisaoNecessaria}
                </p>
              ) : null}
              <p className="mt-1 text-[10px] text-muted-foreground">
                {a.responsavelDecisaoNome ? `${a.responsavelDecisaoNome} · ` : ""}
                {fmt(a.criadoEm)}
                {a.resolvidoEm ? ` · resolvido em ${fmt(a.resolvidoEm)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------- atualizações

export function PainelAtualizacoes({
  projetoId,
  atualizacoes,
  diasSemAtualizar,
  editavel,
  salvando,
  onSalvar,
}: {
  projetoId: string;
  atualizacoes: Atualizacao[];
  diasSemAtualizar: number | null;
  editavel: boolean;
  salvando: boolean;
  onSalvar: (v: AtualizacaoInput) => void;
}) {
  const atrasada = diasSemAtualizar === null || diasSemAtualizar > 7;

  return (
    <section className={cn("panel flex flex-col p-4", atrasada ? "border-warning/40" : "")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-primary" /> Acompanhamento
        </h2>
        {editavel ? (
          <AtualizacaoDialog projetoId={projetoId} onSalvar={onSalvar} salvando={salvando} />
        ) : null}
      </div>

      {atrasada ? (
        <p
          className={cn(
            "mt-2 flex items-start gap-1.5 text-xs",
            diasSemAtualizar === null || diasSemAtualizar > 14
              ? "text-destructive"
              : "text-warning",
          )}
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          {diasSemAtualizar === null
            ? "Nenhuma atualização registrada. O acompanhamento é semanal."
            : `${diasSemAtualizar} dias sem atualização. O acompanhamento é semanal.`}
        </p>
      ) : null}

      {atualizacoes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Projeto sem acompanhamento some do radar da diretoria.
        </p>
      ) : (
        <ol className="mt-3 max-h-56 space-y-3 overflow-y-auto pr-1">
          {atualizacoes.map((a) => (
            <li key={a.id} className="border-l-2 border-border pl-3">
              <p className="font-mono text-[11px] text-muted-foreground">
                {fmt(a.dataRef)}
                {a.autorNome ? ` · ${a.autorNome}` : ""}
              </p>
              {a.descricao ? <p className="mt-0.5 text-xs">{a.descricao}</p> : null}
              {a.ultimasEntregas ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  <strong className="text-foreground">Entregue:</strong> {a.ultimasEntregas}
                </p>
              ) : null}
              {a.proximasEntregas ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  <strong className="text-foreground">A seguir:</strong> {a.proximasEntregas}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// -------------------------------------------------------------- diálogos

function RiscoDialog({
  projetoId,
  onSalvar,
  salvando,
}: {
  projetoId: string;
  onSalvar: (v: RiscoInput) => void;
  salvando: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [probabilidade, setProbabilidade] = useState<"alta" | "media" | "baixa">("media");
  const [impacto, setImpacto] = useState<"alto" | "medio" | "baixo">("medio");
  const [mitigacao, setMitigacao] = useState("");

  function salvar() {
    if (descricao.trim().length < 5) {
      toast.error("Descreva o risco.");
      return;
    }
    onSalvar({
      projetoId,
      descricao: descricao.trim(),
      probabilidade,
      impacto,
      mitigacao: mitigacao.trim() || null,
    });
    setDescricao("");
    setMitigacao("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
          <Plus className="size-3" /> Risco
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar risco</DialogTitle>
          <DialogDescription>
            Risco é o que ainda não aconteceu mas pode comprometer o projeto.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Descrição</Label>
            <Textarea
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: fornecedor pode atrasar a entrega dos equipamentos"
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
            <Label>Plano de mitigação</Label>
            <Textarea
              rows={2}
              value={mitigacao}
              onChange={(e) => setMitigacao(e.target.value)}
              placeholder="O que será feito para reduzir a probabilidade ou o impacto"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salvar} disabled={salvando}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AtencaoDialog({
  projetoId,
  onSalvar,
  salvando,
}: {
  projetoId: string;
  onSalvar: (v: AtencaoInput) => void;
  salvando: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [decisao, setDecisao] = useState("");
  const [responsavel, setResponsavel] = useState(SEM);

  const usuarios = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => listarUsuariosFn(),
    enabled: open,
  });

  function salvar() {
    if (titulo.trim().length < 5) {
      toast.error("Informe o título.");
      return;
    }
    onSalvar({
      projetoId,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      decisaoNecessaria: decisao.trim() || null,
      responsavelDecisaoId: responsavel === SEM ? null : responsavel,
    });
    setTitulo("");
    setDescricao("");
    setDecisao("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
          <Plus className="size-3" /> Atenção
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ponto de atenção</DialogTitle>
          <DialogDescription>
            Algo que trava o projeto e depende de decisão de alguém.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Título</Label>
            <Input maxLength={300} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Contexto</Label>
            <Textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Decisão necessária</Label>
            <Textarea rows={2} value={decisao} onChange={(e) => setDecisao(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Quem decide</Label>
            <Select value={responsavel} onValueChange={setResponsavel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Não definido</SelectItem>
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
        </div>
        <DialogFooter>
          <Button onClick={salvar} disabled={salvando}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AtualizacaoDialog({
  projetoId,
  onSalvar,
  salvando,
}: {
  projetoId: string;
  onSalvar: (v: AtualizacaoInput) => void;
  salvando: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dataRef, setDataRef] = useState(paraInput(new Date()));
  const [descricao, setDescricao] = useState("");
  const [ultimas, setUltimas] = useState("");
  const [proximas, setProximas] = useState("");

  function salvar() {
    if (descricao.trim().length < 5 && ultimas.trim().length < 5) {
      toast.error("Descreva o andamento ou o que foi entregue.");
      return;
    }
    onSalvar({
      projetoId,
      dataRef: doInput(dataRef),
      descricao: descricao.trim() || null,
      ultimasEntregas: ultimas.trim() || null,
      proximasEntregas: proximas.trim() || null,
    });
    setDescricao("");
    setUltimas("");
    setProximas("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
          <MessageSquarePlus className="size-3" /> Atualizar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atualização de status</DialogTitle>
          <DialogDescription>
            Registro semanal do andamento. É o que a diretoria lê.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Data de referência</Label>
            <Input type="date" value={dataRef} onChange={(e) => setDataRef(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Andamento geral</Label>
            <Textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Últimas entregas</Label>
            <Textarea rows={2} value={ultimas} onChange={(e) => setUltimas(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Próximas entregas</Label>
            <Textarea rows={2} value={proximas} onChange={(e) => setProximas(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={salvar} disabled={salvando}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
