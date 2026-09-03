import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Pencil, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { ResourceDialog } from "@/views/resource-forms";
import { Badge } from "@/components/ui/badge";
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
import { Progress } from "@/components/ui/progress";
import type { Recurso } from "@/repositories/recursos.repo";
import { capacidadeProjeto } from "@/services/resource-utils";
import {
  listarRecursosFn,
  definirRecursoAtivoFn,
  usuariosSemRecursoFn,
  criarRecursosDeUsuariosFn,
} from "@/services/recursos.functions";
import { usuarioAtualFn } from "@/services/cadastros.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/recursos")({
  head: () => ({
    meta: [
      { title: "Recursos e capacidade · YpperConnect" },
      {
        name: "description",
        content:
          "Cadastro de recursos de TI com percentual de disponibilidade diária para projetos, alocação multiprojeto e alertas de sobrealocação.",
      },
      { property: "og:title", content: "Recursos e capacidade · YpperConnect" },
      {
        property: "og:description",
        content:
          "Disponibilidade diária, alocação multiprojeto e conflitos de capacidade da equipe de TI.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Recursos,
});

/** Mesma chave que o repositório exige para escrever. */
const FEATURE_RECURSO_EDITAR = "recurso.editar";

function Recursos() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const q = useQuery({ queryKey: ["recursos"], queryFn: () => listarRecursosFn() });

  // Antes bastava ter equipe — a mesma regra de TI que já saiu de
  // projetos. Capacidade de projeto não é assunto de quem atende
  // chamado: quem administra é quem tem a funcionalidade no perfil.
  const u = usuario.data;
  const podeEditar = u ? u.admin || u.funcionalidades.includes(FEATURE_RECURSO_EDITAR) : false;

  const recursos: Recurso[] = useMemo(() => q.data?.recursos ?? [], [q.data]);

  /** Carga vinda das tarefas de projeto, indexada por recurso. */
  const cargaPorId = useMemo(() => {
    const m = new Map<string, { horas: number; projetos: number }>();
    for (const c of q.data?.cargas ?? []) {
      m.set(c.recursoId, { horas: c.horasComprometidas, projetos: c.projetosAtivos });
    }
    return m;
  }, [q.data]);

  const alternar = useMutation({
    mutationFn: (v: { id: string; ativo: boolean }) => definirRecursoAtivoFn({ data: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["recursos"] });
      toast.success(v.ativo ? "Recurso reativado" : "Recurso desativado");
    },
    onError: (e: Error) => toast.error("Não foi possível alterar", { description: e.message }),
  });

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return recursos
      .filter((r) => mostrarInativos || r.ativo)
      .filter(
        (r) => !t || `${r.nome} ${r.papel ?? ""} ${r.equipeNome ?? ""}`.toLowerCase().includes(t),
      );
  }, [recursos, busca, mostrarInativos]);

  const ativos = recursos.filter((r) => r.ativo);
  const capacidadeTotal = ativos.reduce((acc, r) => acc + capacidadeProjeto(r), 0);
  const comprometido = [...cargaPorId.values()].reduce((acc, c) => acc + c.horas, 0);
  const conflitos = ativos.filter(
    (r) => (cargaPorId.get(r.id)?.horas ?? 0) > capacidadeProjeto(r),
  ).length;

  const semAlocacao = (q.data?.cargas ?? []).length === 0;

  return (
    <AppShell
      title="Recursos e capacidade"
      subtitle="Disponibilidade diária para projetos, alocação multiprojeto e conflitos de capacidade"
    >
      <div className="space-y-4">
        {q.error ? (
          <div className="panel border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar os recursos: {String(q.error)}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Capacidade de projetos
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold">
              {capacidadeTotal.toFixed(1)}h<span className="text-base">/dia</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {ativos.length} recurso(s) ativo(s)
            </p>
          </div>
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Comprometido hoje
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold">{comprometido.toFixed(1)}h</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {capacidadeTotal ? Math.round((comprometido / capacidadeTotal) * 100) : 0}% da
              capacidade
            </p>
          </div>
          <div className="panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sobrealocados</p>
            <p
              className={cn(
                "mt-2 font-mono text-3xl font-semibold",
                conflitos ? "text-destructive" : "text-success",
              )}
            >
              {conflitos}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Recursos acima da própria capacidade
            </p>
          </div>
        </section>

        {/* Recurso é o que liga a pessoa à tarefa. Sem nenhum cadastrado,
            ninguém consegue ser responsável — e o cronograma inteiro
            fica sem dono. Vale dizer isso de frente. */}
        {!q.isPending && recursos.length === 0 ? (
          <div className="panel border-warning/40 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Nenhum recurso cadastrado.</p>
            <p className="mt-1">
              Sem recursos não há quem atribuir às tarefas, e ninguém enxerga os projetos em que
              trabalha. Use <strong>Adicionar de usuários</strong> para trazer quem já está no
              sistema.
            </p>
          </div>
        ) : null}

        {semAlocacao && recursos.length > 0 ? (
          <div className="panel border-warning/40 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Alocação zerada.</p>
            <p className="mt-1">
              A carga vem das tarefas de projeto em andamento. Nenhuma tarefa tem responsável
              alocado no período atual — vincule os recursos às tarefas dentro de cada projeto.
            </p>
          </div>
        ) : null}

        {/* Ação de coleção fica junto da coleção. O cabeçalho é reservado
            à identidade e ao "Abrir chamado", que é global de toda tela. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, papel ou equipe"
              className="pl-8"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => setMostrarInativos((v) => !v)}
          >
            {mostrarInativos ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            {mostrarInativos ? "Ocultar inativos" : "Mostrar inativos"}
          </Button>
          {podeEditar ? (
            <>
              <DialogoAdicionarUsuarios />
              {/* Cadastro avulso fica secundário: serve ao externo sem
                  login, que é a exceção. */}
              <ResourceDialog />
            </>
          ) : null}
        </div>

        {q.isPending ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando recursos...
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visiveis.map((r) => {
              const capacidade = capacidadeProjeto(r);
              const carga = cargaPorId.get(r.id);
              const horas = carga?.horas ?? 0;
              const pct = capacidade ? Math.round((horas / capacidade) * 100) : 0;
              const conflito = horas > capacidade;

              return (
                <article key={r.id} className={cn("panel p-5", r.ativo ? "" : "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{r.nome}</h3>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.papel ?? "Sem papel definido"}
                        {r.equipeNome ? ` · ${r.equipeNome}` : ""}
                      </p>
                    </div>
                    {podeEditar ? (
                      <div className="flex shrink-0 gap-1">
                        <ResourceDialog
                          resource={r}
                          trigger={
                            <Button variant="ghost" size="icon" className="size-7" title="Editar">
                              <Pencil className="size-3.5" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title={r.ativo ? "Desativar" : "Reativar"}
                          disabled={alternar.isPending}
                          onClick={() => alternar.mutate({ id: r.id, ativo: !r.ativo })}
                        >
                          {r.ativo ? (
                            <EyeOff className="size-3.5 text-muted-foreground" />
                          ) : (
                            <Eye className="size-3.5 text-success" />
                          )}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {!r.ativo ? (
                      <Badge variant="outline" className="text-xs">
                        Inativo
                      </Badge>
                    ) : null}
                    {/* Sem vínculo, a pessoa não vê os projetos em que
                        trabalha: é por `usuario_id` que o acesso
                        descobre "tenho tarefa aqui". */}
                    {r.usuarioId ? null : (
                      <Badge variant="outline" className="border-warning/40 text-xs text-warning">
                        Sem vínculo no sistema
                      </Badge>
                    )}
                    {conflito ? (
                      <Badge
                        variant="outline"
                        className="border-destructive/40 text-xs text-destructive"
                      >
                        Sobrealocado
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {horas.toFixed(1)}h de {capacidade.toFixed(1)}h/dia
                      </span>
                      <span
                        className={cn(
                          "font-mono",
                          conflito ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {pct}%
                      </span>
                    </div>
                    <Progress value={Math.min(100, pct)} />
                    <p className="text-xs text-muted-foreground">
                      {r.disponibilidadeProjetos}% para projetos
                      {r.horasDia !== 8 ? ` · jornada de ${r.horasDia}h` : ""}
                      {carga?.projetos ? ` · ${carga.projetos} projeto(s)` : ""}
                    </p>
                  </div>
                </article>
              );
            })}

            {visiveis.length === 0 && recursos.length > 0 ? (
              <p className="panel col-span-full px-5 py-10 text-center text-sm text-muted-foreground">
                Nenhum recurso corresponde à busca.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/**
 * Traz quem já está no sistema para a lista de recursos.
 *
 * Existe porque cadastrar a mesma pessoa em dois lugares é a origem da
 * divergência entre os dois cadastros: alguém muda de equipe no AD e o
 * recurso continua na antiga. Nome, equipe e vínculo vêm do usuário; a
 * única decisão aqui é a disponibilidade, e ela se ajusta depois por
 * pessoa.
 */
function DialogoAdicionarUsuarios() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [disponibilidade, setDisponibilidade] = useState(50);

  const q = useQuery({
    queryKey: ["usuarios-sem-recurso"],
    queryFn: () => usuariosSemRecursoFn(),
    enabled: open,
  });

  const criar = useMutation({
    mutationFn: (v: { usuarioIds: string[]; disponibilidadeProjetos: number }) =>
      criarRecursosDeUsuariosFn({ data: v }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["recursos"] });
      qc.invalidateQueries({ queryKey: ["usuarios-sem-recurso"] });
      toast.success(`${r.criados} recurso(s) criado(s)`);
      setMarcados(new Set());
      setOpen(false);
    },
    onError: (e: Error) => toast.error("Não foi possível cadastrar", { description: e.message }),
  });

  const usuarios = useMemo(() => q.data?.usuarios ?? [], [q.data]);
  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return usuarios;
    return usuarios.filter((u) =>
      `${u.nome} ${u.email} ${u.departamento ?? ""} ${u.equipeNome ?? ""}`
        .toLowerCase()
        .includes(t),
    );
  }, [usuarios, busca]);

  function alternar(id: string) {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <UserPlus className="size-4" /> Adicionar de usuários
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adicionar recursos</DialogTitle>
          <DialogDescription>
            Usuários que ainda não são recursos. Nome e equipe vêm do cadastro; a disponibilidade
            pode ser ajustada depois, por pessoa.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="disp-lote">Disponibilidade para projetos (%)</Label>
            <Input
              id="disp-lote"
              type="number"
              min={0}
              max={100}
              value={disponibilidade}
              onChange={(e) => setDisponibilidade(Math.round(Number(e.target.value)))}
              className="w-24"
            />
            <p className="text-xs text-muted-foreground">
              Capacidade de {((8 * disponibilidade) / 100).toFixed(1)}h/dia. O restante fica no
              atendimento de chamados.
            </p>
          </div>

          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar usuário..."
          />

          {q.isPending ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Carregando...
            </p>
          ) : visiveis.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {usuarios.length === 0
                ? "Todos os usuários ativos já são recursos."
                : "Nenhum usuário corresponde à busca."}
            </p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {visiveis.map((u) => (
                <li key={u.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-secondary/40">
                    <Checkbox checked={marcados.has(u.id)} onCheckedChange={() => alternar(u.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{u.nome}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {u.equipeNome ?? "Sem equipe"}
                        {u.departamento ? ` · ${u.departamento}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={criar.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={marcados.size === 0 || criar.isPending}
            onClick={() =>
              criar.mutate({
                usuarioIds: [...marcados],
                disponibilidadeProjetos: disponibilidade,
              })
            }
          >
            {criar.isPending ? "Cadastrando..." : `Adicionar ${marcados.size || ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
