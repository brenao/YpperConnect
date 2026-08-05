import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { KeyRound, Lock, Plus, Search, ShieldCheck, Trash2, Users } from "lucide-react";
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
import { useItsm } from "@/controllers/itsm-store";
import { APP_FEATURES, APP_MODULES, type AccessProfile } from "@/models/itsm-types";

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

function Permissoes() {
  const { profiles, users, addProfile, updateProfile, removeProfile, assignProfile } = useItsm();
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? "");
  const [busca, setBusca] = useState("");

  const selected = profiles.find((p) => p.id === selectedId) ?? profiles[0];

  const usuariosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return users.filter(
      (u) => !q || u.nome.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, busca]);

  const contagem = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of users) if (u.perfilId) map.set(u.perfilId, (map.get(u.perfilId) ?? 0) + 1);
    return map;
  }, [users]);

  function novoPerfil() {
    addProfile({
      nome: "Novo perfil",
      descricao: "Descreva o objetivo deste perfil.",
      modulos: ["/"],
      funcionalidades: [],
      ativo: true,
    });
    toast.success("Perfil criado. Ajuste os menus e funcionalidades.");
  }

  function toggle(list: string[], key: string) {
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  }

  function patch(p: AccessProfile, changes: Partial<AccessProfile>) {
    updateProfile(p.id, changes);
  }

  return (
    <AppShell
      title="Perfis de acesso"
      subtitle="Defina quais menus e funcionalidades cada usuário poderá acessar"
      actions={
        <Button size="sm" onClick={novoPerfil}>
          <Plus className="mr-1 size-4" /> Novo perfil
        </Button>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        {/* Lista de perfis */}
        <aside className="panel h-fit p-3">
          <p className="px-2 pb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Perfis cadastrados
          </p>
          <div className="flex flex-col gap-1">
            {profiles.map((p) => {
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
            {/* Identificação */}
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
                      onCheckedChange={(v) => patch(selected, { ativo: v })}
                    />
                    <Label htmlFor="perfil-ativo" className="text-xs">
                      Ativo
                    </Label>
                  </div>
                  {!selected.sistema ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        removeProfile(selected.id);
                        setSelectedId(profiles[0]?.id ?? "");
                        toast.success("Perfil removido.");
                      }}
                    >
                      <Trash2 className="mr-1 size-4" /> Excluir
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
                <div className="space-y-1.5">
                  <Label htmlFor="perfil-nome">Nome do perfil</Label>
                  <Input
                    id="perfil-nome"
                    value={selected.nome}
                    onChange={(e) => patch(selected, { nome: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="perfil-desc">Descrição</Label>
                  <Textarea
                    id="perfil-desc"
                    rows={2}
                    value={selected.descricao}
                    onChange={(e) => patch(selected, { descricao: e.target.value })}
                  />
                </div>
              </div>
            </section>

            {/* Menus */}
            <section className="panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Menus liberados</h2>
                  <p className="text-xs text-muted-foreground">
                    Menus não marcados ficam ocultos na navegação deste perfil.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => patch(selected, { modulos: APP_MODULES.map((m) => m.key) })}
                  >
                    Marcar todos
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => patch(selected, { modulos: ["/"] })}
                  >
                    Limpar
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {GRUPOS.map((grupo) => (
                  <div key={grupo} className="rounded-xl border border-border p-3">
                    <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {grupo}
                    </p>
                    <div className="flex flex-col gap-2">
                      {APP_MODULES.filter((m) => m.grupo === grupo).map((m) => {
                        const checked = selected.modulos.includes(m.key);
                        return (
                          <label
                            key={m.key}
                            className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-sidebar-accent/40"
                          >
                            <Checkbox
                              className="mt-0.5"
                              checked={checked}
                              disabled={m.fixo}
                              onCheckedChange={() =>
                                patch(selected, { modulos: toggle(selected.modulos, m.key) })
                              }
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
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Funcionalidades */}
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
                  {selected.funcionalidades.length} de {APP_FEATURES.length}
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
                            checked={selected.funcionalidades.includes(f.key)}
                            onCheckedChange={() =>
                              patch(selected, {
                                funcionalidades: toggle(selected.funcionalidades, f.key),
                              })
                            }
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

            {/* Usuários */}
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
                        <td className="py-2 pr-3 text-muted-foreground">{u.departamento}</td>
                        <td className="py-2 pr-3">
                          <Select
                            value={u.perfilId ?? ""}
                            onValueChange={(v) => assignProfile(u.id, v)}
                          >
                            <SelectTrigger className="w-60">
                              <SelectValue placeholder="Sem perfil" />
                            </SelectTrigger>
                            <SelectContent>
                              {profiles.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.nome}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    ))}
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
