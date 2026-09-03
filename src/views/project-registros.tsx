/**
 * Riscos, pontos de atenção e atualizações de status.
 *
 * Ficam na aba Tarefas em vez de aba própria: quem abre o cronograma
 * precisa ver na mesma tela o que ameaça o prazo. Cada painel rola por
 * dentro para a grade continuar sendo o assunto principal.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
} from "lucide-react";
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
import type {
  AtencaoInput,
  AtencaoUpdateInput,
  AtualizacaoInput,
  AtualizacaoUpdateInput,
  RiscoInput,
  RiscoUpdateInput,
} from "@/services/projetos.functions";

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
  atualizando,
  onSalvar,
  onEditar,
}: {
  projetoId: string;
  riscos: Risco[];
  editavel: boolean;
  salvando: boolean;
  atualizando: boolean;
  onSalvar: (v: RiscoInput) => void;
  onEditar: (v: RiscoUpdateInput) => void;
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
          <RiscoDialog
            projetoId={projetoId}
            onSalvar={onSalvar}
            onEditar={onEditar}
            salvando={salvando}
          />
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
            <li key={r.id} className="group/item rounded-lg border border-border p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", nivelStyle[r.probabilidade])}
                  >
                    prob. {r.probabilidade}
                  </Badge>
                  <Badge variant="outline" className={cn("text-[10px]", nivelStyle[r.impacto])}>
                    impacto {r.impacto}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {r.status}
                  </Badge>
                </div>
                {/* Só aparece no hover: a leitura do risco é o assunto, o
                    botão é exceção. */}
                {editavel ? (
                  <RiscoDialog
                    projetoId={projetoId}
                    risco={r}
                    onSalvar={onSalvar}
                    onEditar={onEditar}
                    salvando={atualizando}
                  />
                ) : null}
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
  atualizando,
  resolvendo,
  reabrindo,
  onSalvar,
  onEditar,
  onResolver,
  onReabrir,
}: {
  projetoId: string;
  atencoes: Atencao[];
  editavel: boolean;
  salvando: boolean;
  atualizando: boolean;
  resolvendo: boolean;
  reabrindo: boolean;
  onSalvar: (v: AtencaoInput) => void;
  onEditar: (v: AtencaoUpdateInput) => void;
  onResolver: (id: string) => void;
  onReabrir: (id: string) => void;
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
          <AtencaoDialog
            projetoId={projetoId}
            onSalvar={onSalvar}
            onEditar={onEditar}
            salvando={salvando}
          />
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
                {editavel ? (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <AtencaoDialog
                      projetoId={projetoId}
                      atencao={a}
                      onSalvar={onSalvar}
                      onEditar={onEditar}
                      salvando={atualizando}
                    />
                    {a.status === "aberto" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 text-[11px]"
                        disabled={resolvendo}
                        onClick={() => onResolver(a.id)}
                      >
                        Resolver
                      </Button>
                    ) : (
                      /* Resolver era caminho sem volta: um clique errado
                         tirava o item da lista e a única saída era
                         cadastrar de novo, perdendo a data de abertura —
                         que é o número que diz há quanto tempo a decisão
                         está parada. */
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 gap-1 text-[11px]"
                        disabled={reabrindo}
                        title="Reabrir este ponto de atenção"
                        onClick={() => onReabrir(a.id)}
                      >
                        <RotateCcw className="size-3" /> Reabrir
                      </Button>
                    )}
                  </span>
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

/** Primeira linha de texto do registro, para a versão recolhida. */
function resumoDaAtualizacao(a: Atualizacao): string {
  const texto = a.descricao?.trim() || a.ultimasEntregas?.trim() || a.proximasEntregas?.trim();
  if (!texto) return "Sem descrição";
  const primeira = texto.split(/(?<=[.!?])\s|\n/)[0] ?? texto;
  return primeira.length > 90 ? `${primeira.slice(0, 90)}…` : primeira;
}

/**
 * Histórico de acompanhamento.
 *
 * Só a atualização mais recente vem aberta; as anteriores ficam em uma
 * linha cada e expandem no clique. O registro é semanal e não para de
 * crescer — em um ano são cinquenta entradas por projeto, e mostrar
 * todas abertas transformava o painel num paredão em que ninguém achava
 * a informação de ontem.
 *
 * A busca vai ao banco em vez de filtrar o que está em memória: a tela
 * carrega apenas a janela recente, então filtrar aqui só encontraria o
 * que já está visível.
 */
export function PainelAtualizacoes({
  projetoId,
  atualizacoes,
  total,
  busca,
  buscando,
  verTodas,
  diasSemAtualizar,
  editavel,
  salvando,
  atualizando,
  onBusca,
  onVerTodas,
  onSalvar,
  onEditar,
}: {
  projetoId: string;
  atualizacoes: Atualizacao[];
  total: number;
  busca: string;
  buscando: boolean;
  verTodas: boolean;
  diasSemAtualizar: number | null;
  editavel: boolean;
  salvando: boolean;
  atualizando: boolean;
  onBusca: (texto: string) => void;
  onVerTodas: () => void;
  onSalvar: (v: AtualizacaoInput) => void;
  onEditar: (v: AtualizacaoUpdateInput) => void;
}) {
  const atrasada = diasSemAtualizar === null || diasSemAtualizar > 7;

  // Quais registros antigos o usuário abriu nesta sessão de leitura.
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());

  function alternar(id: string) {
    setExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  const buscaAtiva = busca.trim().length > 0;
  const primeiroId = atualizacoes[0]?.id;

  // O campo de busca só aparece quando há histórico suficiente para
  // justificá-lo: com três registros ele é ruído.
  const mostrarBusca = total > 5 || buscaAtiva;
  const truncado = !verTodas && !buscaAtiva && total > atualizacoes.length;

  return (
    <section className={cn("panel flex flex-col p-4", atrasada ? "border-warning/40" : "")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-primary" /> Acompanhamento
          {total > 0 ? (
            <span className="font-mono text-xs text-muted-foreground">{total}</span>
          ) : null}
        </h2>
        {editavel ? (
          <AtualizacaoDialog
            projetoId={projetoId}
            onSalvar={onSalvar}
            onEditar={onEditar}
            salvando={salvando}
          />
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

      {mostrarBusca ? (
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => onBusca(e.target.value)}
            placeholder="Buscar no histórico..."
            className="h-8 pl-7 text-xs"
          />
        </div>
      ) : null}

      {buscando ? (
        <p className="mt-3 text-xs text-muted-foreground">Buscando...</p>
      ) : atualizacoes.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {buscaAtiva
            ? "Nenhum acompanhamento encontrado para essa busca."
            : "Projeto sem acompanhamento some do radar da diretoria."}
        </p>
      ) : (
        <ol className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
          {atualizacoes.map((a) => {
            // A mais recente já vem aberta: é ela que responde "como está
            // o projeto agora", que é a pergunta de quem abre a tela.
            const aberta = a.id === primeiroId || expandidas.has(a.id);

            return (
              <li key={a.id} className="border-l-2 border-border pl-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => alternar(a.id)}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  >
                    {aberta ? (
                      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {fmt(a.dataRef)}
                    </span>
                    {a.autorNome ? (
                      <span className="truncate text-[11px] text-muted-foreground">
                        · {a.autorNome}
                      </span>
                    ) : null}
                  </button>
                  {editavel ? (
                    <AtualizacaoDialog
                      projetoId={projetoId}
                      atualizacao={a}
                      onSalvar={onSalvar}
                      onEditar={onEditar}
                      salvando={atualizando}
                    />
                  ) : null}
                </div>

                {aberta ? (
                  <div className="mt-0.5 pl-4">
                    {a.descricao ? <p className="text-xs">{a.descricao}</p> : null}
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
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => alternar(a.id)}
                    className="block w-full truncate pl-4 text-left text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {resumoDaAtualizacao(a)}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {truncado ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 text-xs"
          onClick={onVerTodas}
          disabled={buscando}
        >
          Ver todas as {total}
        </Button>
      ) : null}
    </section>
  );
}

// -------------------------------------------------------------- diálogos

/**
 * Um diálogo só para criar e editar.
 *
 * Duplicar o formulário garantiria que um campo novo entrasse em um e
 * fosse esquecido no outro. A presença do registro decide o modo: sem
 * ele é cadastro, com ele é edição, e o gatilho muda de forma junto.
 */
function RiscoDialog({
  projetoId,
  risco,
  onSalvar,
  onEditar,
  salvando,
}: {
  projetoId: string;
  risco?: Risco;
  onSalvar: (v: RiscoInput) => void;
  onEditar: (v: RiscoUpdateInput) => void;
  salvando: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [probabilidade, setProbabilidade] = useState<"alta" | "media" | "baixa">("media");
  const [impacto, setImpacto] = useState<"alto" | "medio" | "baixo">("medio");
  const [mitigacao, setMitigacao] = useState("");
  const [status, setStatus] = useState<"aberto" | "monitorado" | "mitigado">("aberto");

  // Recarrega ao abrir, não ao montar: o registro pode ter mudado
  // enquanto o diálogo estava fechado.
  useEffect(() => {
    if (!open) return;
    setDescricao(risco?.descricao ?? "");
    setProbabilidade(risco?.probabilidade ?? "media");
    setImpacto(risco?.impacto ?? "medio");
    setMitigacao(risco?.mitigacao ?? "");
    setStatus(risco?.status ?? "aberto");
  }, [open, risco]);

  function salvar() {
    if (descricao.trim().length < 5) {
      toast.error("Descreva o risco.");
      return;
    }

    const comum = {
      descricao: descricao.trim(),
      probabilidade,
      impacto,
      mitigacao: mitigacao.trim() || null,
    };

    if (risco) onEditar({ id: risco.id, ...comum, status });
    else onSalvar({ projetoId, ...comum });

    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {risco ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-5 shrink-0 text-muted-foreground"
            title="Editar risco"
          >
            <Pencil className="size-3" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <Plus className="size-3" /> Risco
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{risco ? "Editar risco" : "Registrar risco"}</DialogTitle>
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

          {/* O status só aparece na edição: risco nasce aberto, e o
              campo no cadastro seria uma pergunta com uma resposta só. */}
          {risco ? (
            <div className="grid gap-2">
              <Label>Situação</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aberto">Aberto</SelectItem>
                  <SelectItem value="monitorado">Monitorado</SelectItem>
                  <SelectItem value="mitigado">Mitigado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

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
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : risco ? "Salvar" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AtencaoDialog({
  projetoId,
  atencao,
  onSalvar,
  onEditar,
  salvando,
}: {
  projetoId: string;
  atencao?: Atencao;
  onSalvar: (v: AtencaoInput) => void;
  onEditar: (v: AtencaoUpdateInput) => void;
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

  useEffect(() => {
    if (!open) return;
    setTitulo(atencao?.titulo ?? "");
    setDescricao(atencao?.descricao ?? "");
    setDecisao(atencao?.decisaoNecessaria ?? "");
    setResponsavel(atencao?.responsavelDecisaoId ?? SEM);
  }, [open, atencao]);

  function salvar() {
    if (titulo.trim().length < 5) {
      toast.error("Informe o título.");
      return;
    }

    const comum = {
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      decisaoNecessaria: decisao.trim() || null,
      responsavelDecisaoId: responsavel === SEM ? null : responsavel,
    };

    if (atencao) onEditar({ id: atencao.id, ...comum });
    else onSalvar({ projetoId, ...comum });

    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {atencao ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-5 shrink-0 text-muted-foreground"
            title="Editar ponto de atenção"
          >
            <Pencil className="size-3" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <Plus className="size-3" /> Atenção
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{atencao ? "Editar ponto de atenção" : "Ponto de atenção"}</DialogTitle>
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
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : atencao ? "Salvar" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AtualizacaoDialog({
  projetoId,
  atualizacao,
  onSalvar,
  onEditar,
  salvando,
}: {
  projetoId: string;
  atualizacao?: Atualizacao;
  onSalvar: (v: AtualizacaoInput) => void;
  onEditar: (v: AtualizacaoUpdateInput) => void;
  salvando: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dataRef, setDataRef] = useState(paraInput(new Date()));
  const [descricao, setDescricao] = useState("");
  const [ultimas, setUltimas] = useState("");
  const [proximas, setProximas] = useState("");

  useEffect(() => {
    if (!open) return;
    setDataRef(paraInput(atualizacao ? new Date(atualizacao.dataRef) : new Date()));
    setDescricao(atualizacao?.descricao ?? "");
    setUltimas(atualizacao?.ultimasEntregas ?? "");
    setProximas(atualizacao?.proximasEntregas ?? "");
  }, [open, atualizacao]);

  function salvar() {
    if (descricao.trim().length < 5 && ultimas.trim().length < 5) {
      toast.error("Descreva o andamento ou o que foi entregue.");
      return;
    }

    const comum = {
      dataRef: doInput(dataRef),
      descricao: descricao.trim() || null,
      ultimasEntregas: ultimas.trim() || null,
      proximasEntregas: proximas.trim() || null,
    };

    if (atualizacao) onEditar({ id: atualizacao.id, ...comum });
    else onSalvar({ projetoId, ...comum });

    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {atualizacao ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-5 shrink-0 text-muted-foreground"
            title="Editar acompanhamento"
          >
            <Pencil className="size-3" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
            <MessageSquarePlus className="size-3" /> Atualizar
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {atualizacao ? "Editar acompanhamento" : "Atualização de status"}
          </DialogTitle>
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
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando..." : atualizacao ? "Salvar" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
