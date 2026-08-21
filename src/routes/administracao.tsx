import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  ShieldCheck,
  Plus,
  Mail,
  Server,
  UserCog,
  Search,
  Pencil,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CRITICALITY_LABEL, type SystemCriticality } from "@/models/itsm-types";
import type { Sistema } from "@/repositories/catalogo.repo";
import type { Usuario } from "@/repositories/usuarios.repo";
import {
  usuarioAtualFn,
  listarUsuariosFn,
  listarEquipesFn,
  listarPerfisFn,
  listarSistemasAdminFn,
  listarCategoriasFn,
  listarNotificacoesFn,
  criarUsuarioFn,
  atualizarUsuarioFn,
  definirUsuarioAtivoFn,
  criarSistemaFn,
  atualizarSistemaFn,
  definirSistemaAtivoFn,
  executarRotinasFn,
  processarFilaEmailFn,
  testarSmtpFn,
  type UsuarioInput,
  type UsuarioUpdateInput,
  type SistemaInput,
  type SistemaUpdateInput,
  type AtivoInput,
} from "@/services/cadastros.functions";

export const Route = createFileRoute("/administracao")({
  head: () => ({
    meta: [
      { title: "Administração · YpperConnect" },
      {
        name: "description",
        content:
          "Administração do YpperConnect: usuários, administradores, responsáveis por sistema, atribuição automática de chamados e notificações por e-mail.",
      },
      { property: "og:title", content: "Administração · YpperConnect" },
      {
        property: "og:description",
        content: "Usuários, administradores, responsáveis por sistema e notificações.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Administracao,
});

/** Radix não aceita SelectItem com value vazio. */
const SEM = "__nenhum__";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function fmt(v: Date | string | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ------------------------------------------------------------ diálogo usuário

interface FormUsuario {
  nome: string;
  email: string;
  login: string;
  departamento: string;
  equipeId: string;
  perfilId: string;
  admin: boolean;
}

const usuarioVazio: FormUsuario = {
  nome: "",
  email: "",
  login: "",
  departamento: "",
  equipeId: SEM,
  perfilId: SEM,
  admin: false,
};

function UserDialog({ user, trigger }: { user?: Usuario; trigger: ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormUsuario>(usuarioVazio);

  const equipes = useQuery({
    queryKey: ["equipes"],
    queryFn: () => listarEquipesFn(),
    enabled: open,
  });
  const perfis = useQuery({ queryKey: ["perfis"], queryFn: () => listarPerfisFn(), enabled: open });

  useEffect(() => {
    if (!open) return;
    setForm(
      user
        ? {
            nome: user.nome,
            email: user.email,
            login: user.login,
            departamento: user.departamento ?? "",
            equipeId: user.equipeId ?? SEM,
            perfilId: user.perfilId ?? SEM,
            admin: user.admin,
          }
        : usuarioVazio,
    );
  }, [open, user]);

  function sucesso() {
    qc.invalidateQueries({ queryKey: ["usuarios"] });
    qc.invalidateQueries({ queryKey: ["atendentes"] });
    toast.success(user ? "Usuário atualizado" : "Usuário cadastrado");
    setOpen(false);
  }
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: UsuarioInput) => criarUsuarioFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });
  const atualizar = useMutation({
    mutationFn: (v: UsuarioUpdateInput) => atualizarUsuarioFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });

  const salvando = criar.isPending || atualizar.isPending;

  function salvar() {
    if (form.nome.trim().length < 3) {
      toast.error("Informe o nome completo.");
      return;
    }
    if (!form.email.includes("@")) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    if (form.login.trim().length < 3) {
      toast.error("Informe o login de rede.");
      return;
    }

    const payload = {
      nome: form.nome.trim(),
      email: form.email.trim(),
      login: form.login.trim(),
      departamento: form.departamento.trim() || null,
      equipeId: form.equipeId === SEM ? null : form.equipeId,
      perfilId: form.perfilId === SEM ? null : form.perfilId,
      admin: form.admin,
    };

    // Capturado antes do desvio: o narrowing de `user` não sobrevive
    // ao spread do payload.
    const idExistente = user?.id;
    if (idExistente) {
      atualizar.mutate({ id: idExistente, ...payload });
    } else {
      criar.mutate(payload);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{user ? "Editar usuário" : "Novo usuário"}</DialogTitle>
          <DialogDescription>
            Usuários com equipe podem receber atribuição de chamado. Quando a integração com o
            Active Directory entrar, o cadastro passa a ser sincronizado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nome completo</Label>
            <Input
              maxLength={200}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input
              type="email"
              maxLength={320}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Login de rede</Label>
            <Input
              maxLength={120}
              disabled={!!user}
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value })}
              placeholder="ROSSET\usuario"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Departamento</Label>
            <Input
              maxLength={160}
              value={form.departamento}
              onChange={(e) => setForm({ ...form, departamento: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Equipe de TI</Label>
            <Select value={form.equipeId} onValueChange={(v) => setForm({ ...form, equipeId: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem equipe (usuário final)</SelectItem>
                {(equipes.data ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Perfil de acesso</Label>
            <Select value={form.perfilId} onValueChange={(v) => setForm({ ...form, perfilId: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem perfil</SelectItem>
                {(perfis.data ?? [])
                  .filter((p) => p.ativo)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch
              id="usr-admin"
              checked={form.admin}
              onCheckedChange={(v) => setForm({ ...form, admin: v })}
            />
            <Label htmlFor="usr-admin" className="text-sm">
              Administrador do sistema
            </Label>
          </div>
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

// ------------------------------------------------------------ diálogo sistema

interface FormSistema {
  nome: string;
  descricao: string;
  categoriaId: string;
  responsavelId: string;
  atribuicaoId: string;
  equipeId: string;
  criticidade: SystemCriticality;
}

const sistemaVazio: FormSistema = {
  nome: "",
  descricao: "",
  categoriaId: SEM,
  responsavelId: SEM,
  atribuicaoId: SEM,
  equipeId: SEM,
  criticidade: "media",
};

function SystemDialog({ system, trigger }: { system?: Sistema; trigger: ReactNode }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormSistema>(sistemaVazio);

  const usuarios = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => listarUsuariosFn(),
    enabled: open,
  });
  const equipes = useQuery({
    queryKey: ["equipes"],
    queryFn: () => listarEquipesFn(),
    enabled: open,
  });
  const categorias = useQuery({
    queryKey: ["categorias", "sistema"],
    queryFn: () => listarCategoriasFn({ data: { escopo: "sistema" } }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setForm(
      system
        ? {
            nome: system.nome,
            descricao: system.descricao ?? "",
            categoriaId: system.categoriaId ?? SEM,
            responsavelId: system.responsavelId ?? SEM,
            atribuicaoId: system.atribuicaoId ?? SEM,
            equipeId: system.equipeId ?? SEM,
            criticidade: system.criticidade,
          }
        : sistemaVazio,
    );
  }, [open, system]);

  function sucesso() {
    qc.invalidateQueries({ queryKey: ["sistemas"] });
    qc.invalidateQueries({ queryKey: ["sistemas-admin"] });
    toast.success(system ? "Sistema atualizado" : "Sistema cadastrado");
    setOpen(false);
  }
  const erro = (e: Error) => toast.error("Não foi possível salvar", { description: e.message });

  const criar = useMutation({
    mutationFn: (v: SistemaInput) => criarSistemaFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });
  const atualizar = useMutation({
    mutationFn: (v: SistemaUpdateInput) => atualizarSistemaFn({ data: v }),
    onSuccess: sucesso,
    onError: erro,
  });

  const salvando = criar.isPending || atualizar.isPending;

  function salvar() {
    if (form.nome.trim().length < 2) {
      toast.error("Informe o nome do sistema.");
      return;
    }

    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      categoriaId: form.categoriaId === SEM ? null : form.categoriaId,
      responsavelId: form.responsavelId === SEM ? null : form.responsavelId,
      atribuicaoId: form.atribuicaoId === SEM ? null : form.atribuicaoId,
      equipeId: form.equipeId === SEM ? null : form.equipeId,
      criticidade: form.criticidade,
    };

    const idExistente = system?.id;
    if (idExistente) {
      atualizar.mutate({ id: idExistente, ...payload });
    } else {
      criar.mutate(payload);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{system ? "Editar sistema" : "Novo sistema"}</DialogTitle>
          <DialogDescription>
            O responsável responde pelo sistema; a atribuição define quem recebe os chamados dele.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nome do sistema</Label>
            <Input
              maxLength={200}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex.: ERP"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Descrição</Label>
            <Textarea
              rows={2}
              maxLength={1000}
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <Select
              value={form.categoriaId}
              onValueChange={(v) => setForm({ ...form, categoriaId: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem categoria</SelectItem>
                {(categorias.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Criticidade</Label>
            <Select
              value={form.criticidade}
              onValueChange={(v) => setForm({ ...form, criticidade: v as SystemCriticality })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["alta", "media", "baixa"] as const).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CRITICALITY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Responsável pelo sistema</Label>
            <Select
              value={form.responsavelId}
              onValueChange={(v) => setForm({ ...form, responsavelId: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Não definido</SelectItem>
                {(usuarios.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Chamados atribuídos a</Label>
            <Select
              value={form.atribuicaoId}
              onValueChange={(v) => setForm({ ...form, atribuicaoId: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Não definido</SelectItem>
                {(usuarios.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Equipe responsável</Label>
            <Select value={form.equipeId} onValueChange={(v) => setForm({ ...form, equipeId: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM}>Sem equipe</SelectItem>
                {(equipes.data ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nome}
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
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------- tela

function Administracao() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const usuariosQuery = useQuery({ queryKey: ["usuarios"], queryFn: () => listarUsuariosFn() });
  const sistemasQuery = useQuery({
    queryKey: ["sistemas-admin"],
    queryFn: () => listarSistemasAdminFn(),
  });
  const notificacoes = useQuery({
    queryKey: ["notificacoes"],
    queryFn: () => listarNotificacoesFn(),
  });

  const isAdmin = usuario.data?.admin ?? false;
  const usuarios = useMemo(() => usuariosQuery.data ?? [], [usuariosQuery.data]);
  const sistemas = useMemo(() => sistemasQuery.data ?? [], [sistemasQuery.data]);

  const erro = (e: Error) => toast.error("Não foi possível alterar", { description: e.message });

  const alternarUsuario = useMutation({
    mutationFn: (v: AtivoInput) => definirUsuarioAtivoFn({ data: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["atendentes"] });
      toast.success(v.ativo ? "Usuário reativado" : "Usuário desativado");
    },
    onError: erro,
  });

  const alternarSistema = useMutation({
    mutationFn: (v: AtivoInput) => definirSistemaAtivoFn({ data: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["sistemas-admin"] });
      qc.invalidateQueries({ queryKey: ["sistemas"] });
      toast.success(v.ativo ? "Sistema reativado" : "Sistema desativado");
    },
    onError: erro,
  });

  const processarFila = useMutation({
    mutationFn: () => processarFilaEmailFn(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["notificacoes"] });
      toast.success(`${r.enviadas} enviada(s), ${r.falhas} falha(s)`, {
        description: r.erros[0] ?? undefined,
      });
    },
    onError: erro,
  });

  // Gera os lembretes de projeto e despacha a fila, na ordem. É a mesma
  // rotina que o cron chamaria — existe como botão porque o agendador
  // ainda não foi decidido.
  const executarRotinas = useMutation({
    mutationFn: () => executarRotinasFn(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["notificacoes"] });
      const detalhe = [
        `${r.lembretes.enfileirados} lembrete(s) gerado(s)`,
        r.lembretes.jaAvisadosHoje > 0 ? `${r.lembretes.jaAvisadosHoje} já avisado(s) hoje` : "",
        r.lembretes.semGerente > 0 ? `${r.lembretes.semGerente} projeto(s) sem gerente` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(`${r.fila.enviadas} e-mail(s) enviado(s), ${r.fila.falhas} falha(s)`, {
        description: detalhe,
      });
    },
    onError: erro,
  });

  const testarSmtp = useMutation({
    mutationFn: () => testarSmtpFn(),
    onSuccess: () => toast.success("Conexão SMTP funcionando"),
    onError: (e: Error) => toast.error("SMTP inacessível", { description: e.message }),
  });

  const usuariosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return usuarios
      .filter((u) => mostrarInativos || u.ativo)
      .filter(
        (u) =>
          !q ||
          u.nome.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.departamento ?? "").toLowerCase().includes(q),
      );
  }, [usuarios, busca, mostrarInativos]);

  const sistemasFiltrados = useMemo(
    () => sistemas.filter((s) => mostrarInativos || s.ativo),
    [sistemas, mostrarInativos],
  );

  const carregando = usuariosQuery.isPending || sistemasQuery.isPending;

  return (
    <AppShell
      title="Administração"
      subtitle="Usuários, administradores, responsáveis por sistema e notificações"
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => setMostrarInativos((v) => !v)}
        >
          {mostrarInativos ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          {mostrarInativos ? "Ocultar inativos" : "Mostrar inativos"}
        </Button>
      }
    >
      {!isAdmin ? (
        <div className="panel mb-4 border-warning/40 p-4 text-sm text-muted-foreground">
          Você pode consultar os cadastros, mas somente administradores podem alterá-los.
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Usuários"
          value={String(usuarios.filter((u) => u.ativo).length)}
          hint="ativos no sistema"
        />
        <Kpi
          label="Administradores"
          value={String(usuarios.filter((u) => u.admin && u.ativo).length)}
          hint="com acesso total"
        />
        <Kpi
          label="Atendentes"
          value={String(usuarios.filter((u) => u.equipeId && u.ativo).length)}
          hint="podem receber chamado"
        />
        <Kpi
          label="Sistemas"
          value={String(sistemas.filter((s) => s.ativo).length)}
          hint="no inventário"
        />
      </div>

      {carregando ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando cadastros...
        </p>
      ) : (
        <Tabs defaultValue="usuarios">
          <TabsList>
            <TabsTrigger value="usuarios" className="gap-2">
              <UserCog className="size-4" /> Usuários
            </TabsTrigger>
            <TabsTrigger value="sistemas" className="gap-2">
              <Server className="size-4" /> Sistemas
            </TabsTrigger>
            <TabsTrigger value="emails" className="gap-2">
              <Mail className="size-4" /> Notificações
            </TabsTrigger>
          </TabsList>

          {/* -------------------------------------------------- usuários */}
          <TabsContent value="usuarios" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome, e-mail ou departamento"
                  className="pl-8"
                />
              </div>
              {isAdmin ? (
                <UserDialog
                  trigger={
                    <Button size="sm" className="gap-2">
                      <Plus className="size-4" /> Novo usuário
                    </Button>
                  }
                />
              ) : null}
            </div>

            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Usuário</th>
                    <th className="px-4 py-2 font-medium">Departamento</th>
                    <th className="px-4 py-2 font-medium">Equipe</th>
                    <th className="px-4 py-2 font-medium">Origem</th>
                    <th className="px-4 py-2 font-medium">Situação</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {usuariosFiltrados.map((u) => (
                    <tr
                      key={u.id}
                      className={`border-b border-border/60 ${u.ativo ? "" : "opacity-60"}`}
                    >
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2">
                          {u.nome}
                          {u.admin ? (
                            <Badge variant="outline" className="gap-1 text-[10px]">
                              <ShieldCheck className="size-3" /> admin
                            </Badge>
                          ) : null}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">{u.email}</span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{u.departamento ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">{u.equipeNome ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {u.origem}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        {u.ativo ? (
                          <span className="text-success">Ativo</span>
                        ) : (
                          <span className="text-muted-foreground">Inativo</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {isAdmin ? (
                          <span className="flex justify-end gap-1">
                            <UserDialog
                              user={u}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  title="Editar"
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              title={u.ativo ? "Desativar" : "Reativar"}
                              disabled={alternarUsuario.isPending}
                              onClick={() => alternarUsuario.mutate({ id: u.id, ativo: !u.ativo })}
                            >
                              {u.ativo ? (
                                <EyeOff className="size-3.5 text-muted-foreground" />
                              ) : (
                                <Eye className="size-3.5 text-success" />
                              )}
                            </Button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {usuariosFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        Nenhum usuário encontrado.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* -------------------------------------------------- sistemas */}
          <TabsContent value="sistemas" className="mt-4 space-y-4">
            {isAdmin ? (
              <SystemDialog
                trigger={
                  <Button size="sm" className="gap-2">
                    <Plus className="size-4" /> Novo sistema
                  </Button>
                }
              />
            ) : null}

            <div className="panel overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Sistema</th>
                    <th className="px-4 py-2 font-medium">Categoria</th>
                    <th className="px-4 py-2 font-medium">Responsável</th>
                    <th className="px-4 py-2 font-medium">Atribuir a</th>
                    <th className="px-4 py-2 font-medium">Criticidade</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sistemasFiltrados.map((s) => (
                    <tr
                      key={s.id}
                      className={`border-b border-border/60 ${s.ativo ? "" : "opacity-60"}`}
                    >
                      <td className="px-4 py-2">
                        <span className="block">{s.nome}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {s.equipeNome ?? "Sem equipe"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{s.categoriaNome ?? "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {s.responsavelNome ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{s.atribuicaoNome ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Badge
                          variant="outline"
                          className={
                            s.criticidade === "alta"
                              ? "border-destructive/40 text-destructive"
                              : s.criticidade === "media"
                                ? "border-warning/40 text-warning"
                                : ""
                          }
                        >
                          {CRITICALITY_LABEL[s.criticidade]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        {isAdmin ? (
                          <span className="flex justify-end gap-1">
                            <SystemDialog
                              system={s}
                              trigger={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  title="Editar"
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              title={s.ativo ? "Desativar" : "Reativar"}
                              disabled={alternarSistema.isPending}
                              onClick={() => alternarSistema.mutate({ id: s.id, ativo: !s.ativo })}
                            >
                              {s.ativo ? (
                                <EyeOff className="size-3.5 text-muted-foreground" />
                              ) : (
                                <Eye className="size-3.5 text-success" />
                              )}
                            </Button>
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {sistemasFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        Nenhum sistema cadastrado. Chamados de incidente exigem um sistema.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ----------------------------------------------- notificações */}
          <TabsContent value="emails" className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Kpi label="Enviadas" value={String(notificacoes.data?.contagem["enviado"] ?? 0)} />
              <Kpi label="Pendentes" value={String(notificacoes.data?.contagem["pendente"] ?? 0)} />
              <Kpi label="Com erro" value={String(notificacoes.data?.contagem["erro"] ?? 0)} />
            </div>

            {isAdmin ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testarSmtp.isPending}
                  onClick={() => testarSmtp.mutate()}
                >
                  {testarSmtp.isPending ? "Testando..." : "Testar conexão SMTP"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={processarFila.isPending}
                  onClick={() => processarFila.mutate()}
                >
                  {processarFila.isPending ? "Enviando..." : "Processar fila agora"}
                </Button>
                <Button
                  size="sm"
                  disabled={executarRotinas.isPending}
                  onClick={() => executarRotinas.mutate()}
                >
                  {executarRotinas.isPending ? "Executando..." : "Executar rotinas do dia"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  As rotinas geram os lembretes de projeto sem atualização e despacham a fila. O
                  agendador ainda não existe: por ora, alguém precisa clicar.
                </span>
              </div>
            ) : null}

            {(notificacoes.data?.lista.length ?? 0) === 0 ? (
              <div className="panel p-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Nenhuma notificação registrada.</p>
                <p className="mt-1">
                  A fila é alimentada quando um chamado é aberto ou muda de status. Abra um chamado
                  e volte aqui.
                </p>
                <p className="mt-2">
                  O envio depende das variáveis <code className="font-mono">SMTP_*</code> no
                  ambiente do servidor.
                </p>
              </div>
            ) : (
              <div className="panel overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Destinatário</th>
                      <th className="px-4 py-2 font-medium">Assunto</th>
                      <th className="px-4 py-2 font-medium">Situação</th>
                      <th className="px-4 py-2 font-medium">Criada</th>
                      <th className="px-4 py-2 font-medium">Enviada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(notificacoes.data?.lista ?? []).map((n) => (
                      <tr key={n.id} className="border-b border-border/60">
                        <td className="px-4 py-2">
                          <span className="block">{n.destinatarioNome ?? "—"}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {n.destinatarioEmail}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{n.assunto}</td>
                        <td className="px-4 py-2">
                          <Badge
                            variant="outline"
                            className={
                              n.status === "erro"
                                ? "border-destructive/40 text-destructive"
                                : n.status === "pendente"
                                  ? "border-warning/40 text-warning"
                                  : "border-success/40 text-success"
                            }
                          >
                            {n.status}
                          </Badge>
                          {n.tentativas > 0 ? (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              {n.tentativas}x
                            </span>
                          ) : null}
                          {n.erro ? (
                            <span className="mt-1 block text-[11px] text-destructive">
                              {n.erro}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {fmt(n.criadoEm)}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          {fmt(n.enviadoEm)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </AppShell>
  );
}
