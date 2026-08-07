import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Lock, Plus, Save, Search, ShieldCheck, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { APP_FEATURES, APP_MODULES } from "@/models/itsm-types";
import {
  listarPerfisFn,
  listarUsuariosFn,
  criarPerfilFn,
  atualizarPerfilFn,
  desativarPerfilFn,
  salvarPermissoesFn,
  atualizarUsuarioFn,
  usuarioAtualFn,
  type PerfilInput,
  type PerfilUpdateInput,
  type PermissoesInput,
  type UsuarioUpdateInput,
} from "@/services/cadastros.functions";

export const Route = createFileRoute("/permissoes")({
  head: () => ({
    meta: [
      { title: "Perfis de acesso · YpperConnect" },
      {
        name: "description",
        content:
          "Cadastre perfis de acesso do YpperConnect definindo quais menus e funcionalidades cada usuário poderá utilizar.",
      },
      { property: "og:title", content: "Perfis de acesso · YpperConnect" },
      {
        property: "og:description",
        content: "Controle de menus e funcionalidades por perfil de usuário.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Permissoes,
});

const GRUPOS = ["Operação", "Projetos", "Gestão", "Administração"] as const;

/** Sentinela: Radix não aceita SelectItem com value vazio. */
const SEM_PERFIL = "__nenhum__";

function Permissoes() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string>("");
  const [busca, setBusca] = useState("");

  // Rascunho local: as permissões só vão ao banco quando o admin salva.
  // Gravar a cada clique geraria dezenas de transações e deixaria o
  // perfil num estado intermediário se a rede caísse no meio.
  const [modulos, setModulos] = useState<string[]>([]);
  const [funcionalidades, setFuncionalidades] = useState<string[]>([]);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const perfisQuery = useQuery({ queryKey: ["perfis"], queryFn: () => listarPerfisFn() });
  const usuariosQuery = useQuery({ queryKey: ["usuarios"], queryFn: () => listarUsuariosFn() });

  const isAdmin = usuario.data?.admin ?? false;
  const perfis = useMemo(() => perfisQuery.data ?? [], [perfisQuery.data]);
  const usuarios = useMemo(() => usuariosQuery.data ?? [], [usuariosQuery.data]);

  const selected = perfis.find((p) => p.id === selectedId) ?? perfis[0];

  // Sincroniza o rascunho quando muda o perfil selecionado ou os dados
  // chegam do servidor.
  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setModulos(selected.modulos);
    setFuncionalidades(selected.funcionalidades);
    setNome(selected.nome);
    setDescricao(selected.descricao ?? "");
  }, [selected?.id, perfisQuery.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const sujo =
    !!selected &&
    (nome !== selected.nome ||
      descricao !== (selected.descricao ?? "") ||
      modulos.slice().sort().join() !== selected.modulos.slice().sort().join() ||
      funcionalidades.slice().sort().join() !== selected.funcionalidades.slice().sort().join());

  function invalidar() {
    qc.invalidateQueries({ queryKey: ["perfis"] });
    qc.invalidateQueries({ queryKey: ["usuarios"] });
  }

  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criarPerfil = useMutation({
    mutationFn: (v: PerfilInput) => criarPerfilFn({ data: v }),
    onSuccess: (r) => {
      invalidar();
      setSelectedId(r.id);
      toast.success("Perfil criado. Ajuste os menus e salve.");
    },
    onError: erro,
  });

  const salvarIdentificacao = useMutation({
    mutationFn: (v: PerfilUpdateInput) => atualizarPerfilFn({ data: v }),
    onError: erro,
  });

  const salvarPerms = useMutation({
    mutationFn: (v: PermissoesInput) => salvarPermissoesFn({ data: v }),
    onError: erro,
  });

  const desativar = useMutation({
    mutationFn: (id: string) => desativarPerfilFn({ data: { id } }),
    onSuccess: () => {
      invalidar();
      setSelectedId(perfis[0]?.id ?? "");
      toast.success("Perfil desativado");
    },
    onError: erro,
  });

  const atribuirPerfil = useMutation({
    mutationFn: (v: UsuarioUpdateInput) => atualizarUsuarioFn({ data: v }),
    onSuccess: () => {
      invalidar();
      toast.success("Perfil atribuído");
    },
    onError: erro,
  });

  const alternarAtivo = useMutation({
    mutationFn: (v: PerfilUpdateInput) => atualizarPerfilFn({ data: v }),
    onSuccess: () => {
      invalidar();
      toast.success("Situação do perfil atualizada");
    },
    onError: erro,
  });

  const salvando = salvarIdentificacao.isPending || salvarPerms.isPending;

  async function salvarTudo() {
    if (!selected) return;
    if (nome.trim().length < 3) {
      toast.error("Informe o nome do perfil.");
      return;
    }
    try {
      await salvarIdentificacao.mutateAsync({
        id: selected.id,
        nome: nome.trim(),
        descricao: descricao.trim() || null,
      });
      await salvarPerms.mutateAsync({
        perfilId: selected.id,
        modulos,
        funcionalidades,
      });
      invalidar();
      toast.success("Perfil salvo", {
        description: "As mudanças valem no próximo carregamento de quem usa este perfil.",
      });
    } catch {
      /* onError já notificou */
    }
  }

  function toggle(lista: string[], key: string) {
    return lista.includes(key) ? lista.filter((k) => k !== key) : [...lista, key];
  }

  const usuariosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return usuarios.filter(
      (u) => !q || u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [usuarios, busca]);

  const contagem = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of usuarios) {
      if (u.perfilId) map.set(u.perfilId, (map.get(u.perfilId) ?? 0) + 1);
    }
    return map;
  }, [usuarios]);

  if (perfisQuery.isPending) {
    return (
      <AppShell title="Perfis de acesso" subtitle="Carregando...">
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando perfis...
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Perfis de acesso"
      subtitle="Defina quais menus e funcionalidades cada usuário poderá acessar"
      actions={
        isAdmin ? (
          <Button
            size="sm"
            disabled={criarPerfil.isPending}
            onClick={() =>
              criarPerfil.mutate({
                nome: "Novo perfil",
                descricao: "Descreva o objetivo deste perfil.",
              })
            }
          >
            <Plus className="mr-1 size-4" /> Novo perfil
          </Button>
        ) : undefined
      }
    >
      {!isAdmin ? (
        <div className="panel mb-4 border-warning/40 p-4 text-sm text-muted-foreground">
          Você pode consultar os perfis, mas somente administradores podem alterá-los.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="panel h-fit p-3">
          <p className="px-2 pb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Perfis cadastrados
          </p>
          <div className="flex flex-col gap-1">
            {perfis.map((p) => {
              const active = p.id === selected?.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-muted-foreground hover:bg-sidebar-accent/60"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{p.nome}</span>
                    {p.sistema ? <Lock className="size-3 shrink-0 opacity-60" /> : null}
                  </span>
                  <span className="mt-0.5 block text-[11px]">
                    {p.modulos.length} menus · {contagem.get(p.id) ?? 0} usuários
                    {p.ativo ? "" : " · inativo"}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {selected ? (
          <div className="flex min-w-0 flex-col gap-4">
            {/* Barra de salvamento: aparece só quando há alteração pendente. */}
            {sujo ? (
              <div className="panel sticky top-2 z-10 flex items-center justify-between gap-3 border-primary/40 p-3 text-sm">
                <span className="text-muted-foreground">Há alterações não salvas neste perfil.</span>
                <Button size="sm" className="gap-2" disabled={salvando} onClick={() => void salvarTudo()}>
                  {salvando ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Salvar alterações
                </Button>
              </div>
            ) : null}

            <section className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-lg bg-hero ring-1 ring-primary/40">
                    <ShieldCheck className="size-4 text-primary" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold">Identificação do perfil</h2>
                    <p className="text-xs text-muted-foreground">
                      {selected.sistema
                        ? "Perfil padrão do sistema — pode ser ajustado, mas não excluído."
                        : "Perfil personalizado."}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="perfil-ativo"
                      checked={selected.ativo}
                      disabled={!isAdmin || alternarAtivo.isPending}
                      onCheckedChange={(v) =>
                        alternarAtivo.mutate({ id: selected.id, ativo: v })
                      }
                    />
                    <Label htmlFor="perfil-ativo" className="text-xs">
                      Ativo
                    </Label>
                  </div>
                  {isAdmin && !selected.sistema ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={desativar.isPending}
                      onClick={() => desativar.mutate(selected.id)}
                    >
                      <Trash2 className="mr-1 size-4" /> Desativar
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
                <div className="space-y-1.5">
                  <Label htmlFor="perfil-nome">Nome do perfil</Label>
                  <Input
                    id="perfil-nome"
                    maxLength={120}
                    disabled={!isAdmin}
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="perfil-desc">Descrição</Label>
                  <Textarea
                    id="perfil-desc"
                    rows={2}
                    maxLength={500}
                    disabled={!isAdmin}
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <section className="panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Menus liberados</h2>
                  <p className="text-xs text-muted-foreground">
                    Menus não marcados ficam ocultos na navegação deste perfil.
                  </p>
                </div>
                {isAdmin ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setModulos(APP_MODULES.map((m) => m.key))}
                    >
                      Marcar todos
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setModulos(["/"])}>
                      Limpar
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {GRUPOS.map((grupo) => (
                  <div key={grupo} className="rounded-xl border border-border p-3">
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {grupo}
                    </p>
                    <div className="flex flex-col gap-2">
                      {APP_MODULES.filter((m) => m.grupo === grupo).map((m) => (
                        <label
                          key={m.key}
                          className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-sidebar-accent/40"
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={modulos.includes(m.key)}
                            disabled={m.fixo || !isAdmin}
                            onCheckedChange={() => setModulos((l) => toggle(l, m.key))}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm">
                              {m.label}
                              {m.fixo ? (
                                <Badge variant="outline" className="ml-2 text-[10px]">
                                  obrigatório
                                </Badge>
                              ) : null}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {m.descricao}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Funcionalidades</h2>
                  <p className="text-xs text-muted-foreground">
                    Ações permitidas dentro dos menus liberados.
                  </p>
                </div>
                <Badge variant="outline" className="gap-1">
                  <KeyRound className="size-3" />
                  {funcionalidades.length} de {APP_FEATURES.length}
                </Badge>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from(new Set(APP_FEATURES.map((f) => f.grupo))).map((grupo) => (
                  <div key={grupo} className="rounded-xl border border-border p-3">
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {grupo}
                    </p>
                    <div className="flex flex-col gap-2">
                      {APP_FEATURES.filter((f) => f.grupo === grupo).map((f) => (
                        <label
                          key={f.key}
                          className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-sidebar-accent/40"
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={funcionalidades.includes(f.key)}
                            disabled={!isAdmin}
                            onCheckedChange={() => setFuncionalidades((l) => toggle(l, f.key))}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm">{f.label}</span>
                            <span className="block text-[11px] text-muted-foreground">
                              {f.descricao}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Perfil por usuário</h2>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar usuário"
                    className="w-56 pl-8"
                  />
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Usuário</th>
                      <th className="py-2 pr-3 font-medium">Departamento</th>
                      <th className="py-2 pr-3 font-medium">Perfil de acesso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuariosFiltrados.map((u) => (
                      <tr key={u.id} className="border-b border-border/60">
                        <td className="py-2 pr-3">
                          <span className="block">{u.nome}</span>
                          <span className="block text-[11px] text-muted-foreground">{u.email}</span>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {u.departamento ?? "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <Select
                            value={u.perfilId ?? SEM_PERFIL}
                            disabled={!isAdmin || atribuirPerfil.isPending}
                            onValueChange={(v) =>
                              atribuirPerfil.mutate({
                                id: u.id,
                                perfilId: v === SEM_PERFIL ? null : v,
                              })
                            }
                          >
                            <SelectTrigger className="w-60">
                              <SelectValue placeholder="Sem perfil" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SEM_PERFIL}>Sem perfil</SelectItem>
                              {perfis
                                .filter((p) => p.ativo)
                                .map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.nome}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
                    {usuariosFiltrados.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-muted-foreground">
                          Nenhum usuário encontrado.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}