import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ShieldCheck,
  RefreshCw,
  Plus,
  Trash2,
  Mail,
  Server,
  UserCog,
  Search,
  Lock,
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
import { useHydrated } from "@/hooks/use-hydrated";
import { useItsm } from "@/controllers/itsm-store";
import {
  CRITICALITY_LABEL,
  NOTIFICATION_LABEL,
  type SystemCriticality,
  type SystemRegistry,
} from "@/models/itsm-types";
import { LEMBRETE_DIARIO_DIAS, LEMBRETE_DIAS, diasSemAtualizacao } from "@/services/notifications";

export const Route = createFileRoute("/administracao")({
  head: () => ({
    meta: [
      { title: "Administração · YpperConnect" },
      {
        name: "description",
        content:
          "Administração do YpperConnect: usuários do Active Directory, administradores, responsáveis por sistema, atribuição automática de chamados e notificações por e-mail.",
      },
      { property: "og:title", content: "Administração · YpperConnect" },
      {
        property: "og:description",
        content: "Usuários do AD, administradores, responsáveis por sistema e notificações.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Administracao,
});

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const sistemaVazio = {
  nome: "",
  descricao: "",
  categoria: "Aplicações",
  responsavelId: "",
  atribuicaoId: "",
  equipe: "Service Desk",
  criticidade: "media" as SystemCriticality,
  ativo: true,
};

function SystemDialog({ system, trigger }: { system?: SystemRegistry; trigger: React.ReactNode }) {
  const { users, addSystem, updateSystem } = useItsm();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(system ? { ...sistemaVazio, ...system } : sistemaVazio);

  function salvar() {
    if (form.nome.trim().length < 2) {
      toast.error("Informe o nome do sistema.");
      return;
    }
    if (!form.responsavelId || !form.atribuicaoId) {
      toast.error("Defina o responsável e para quem os chamados serão atribuídos.");
      return;
    }
    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim(),
      categoria: form.categoria.trim() || "Aplicações",
      responsavelId: form.responsavelId,
      atribuicaoId: form.atribuicaoId,
      equipe: form.equipe.trim() || "Service Desk",
      criticidade: form.criticidade,
      ativo: form.ativo,
    };
    if (system) {
      updateSystem(system.id, payload);
      toast.success("Sistema atualizado");
    } else {
      addSystem(payload);
      toast.success("Sistema cadastrado");
    }
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm(system ? { ...sistemaVazio, ...system } : sistemaVazio);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{system ? "Editar sistema" : "Novo sistema"}</DialogTitle>
          <DialogDescription>
            Defina o dono do sistema e para quem os chamados serão atribuídos automaticamente.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nome do sistema</Label>
            <Input
              value={form.nome}
              maxLength={60}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex.: ERP Protheus"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Categoria</Label>
            <Input
              value={form.categoria}
              maxLength={30}
              onChange={(e) => setForm({ ...form, categoria: e.target.value })}
            />
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
                {(Object.keys(CRITICALITY_LABEL) as SystemCriticality[]).map((c) => (
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
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Atribuir chamados para</Label>
            <Select
              value={form.atribuicaoId}
              onValueChange={(v) => setForm({ ...form, atribuicaoId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Equipe de atendimento</Label>
            <Input
              value={form.equipe}
              maxLength={40}
              onChange={(e) => setForm({ ...form, equipe: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
            <span className="text-sm">Sistema ativo</span>
            <Switch checked={form.ativo} onCheckedChange={(v) => setForm({ ...form, ativo: v })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Descrição</Label>
            <Textarea
              rows={2}
              maxLength={300}
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={salvar}>{system ? "Salvar" : "Cadastrar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Administracao() {
  const {
    users,
    systems,
    notifications,
    projects,
    updateUser,
    removeUser,
    removeSystem,
    syncDirectory,
    currentUserId,
    setCurrentUser,
    isAdmin,
  } = useItsm();
  const hydrated = useHydrated();
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(
    () =>
      users.filter((u) =>
        `${u.nome} ${u.email} ${u.departamento} ${u.equipe}`
          .toLowerCase()
          .includes(busca.trim().toLowerCase()),
      ),
    [users, busca],
  );

  const nome = (id: string) => users.find((u) => u.id === id)?.nome ?? "—";
  const pendentes = hydrated
    ? projects.filter(
        (p) =>
          p.status !== "concluido" &&
          p.status !== "cancelado" &&
          diasSemAtualizacao(p) >= LEMBRETE_DIAS,
      )
    : [];

  return (
    <AppShell
      title="Administração"
      subtitle="Usuários do Active Directory, administradores, responsáveis por sistema e regras de notificação"
      actions={
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => {
            const n = syncDirectory();
            toast.success(`Sincronização com o AD concluída`, {
              description: `${n} contas atualizadas a partir do diretório corporativo.`,
            });
          }}
        >
          <RefreshCw className="size-4" /> Sincronizar AD
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Usuários" value={String(users.length)} hint="importados do AD" />
          <Kpi
            label="Administradores"
            value={String(users.filter((u) => u.admin).length)}
            hint="podem editar cadastros"
          />
          <Kpi label="Sistemas" value={String(systems.length)} hint="com responsável definido" />
          <Kpi
            label="E-mails enviados"
            value={hydrated ? String(notifications.length) : "—"}
            hint="status de chamados e lembretes"
          />
        </div>

        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm text-muted-foreground">Sessão atual (simulação do AD):</span>
          <Select value={currentUserId} onValueChange={setCurrentUser}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.nome} {u.admin ? "· admin" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdmin ? (
            <Badge className="gap-1 bg-primary/15 text-primary">
              <ShieldCheck className="size-3.5" /> Administrador
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <Lock className="size-3.5" /> Somente leitura
            </Badge>
          )}
        </div>

        <Tabs defaultValue="usuarios">
          <TabsList>
            <TabsTrigger value="usuarios" className="gap-2">
              <UserCog className="size-4" /> Usuários e administradores
            </TabsTrigger>
            <TabsTrigger value="sistemas" className="gap-2">
              <Server className="size-4" /> Sistemas e atribuição
            </TabsTrigger>
            <TabsTrigger value="emails" className="gap-2">
              <Mail className="size-4" /> Notificações
            </TabsTrigger>
          </TabsList>

          <TabsContent value="usuarios" className="mt-4 space-y-4">
            <div className="panel flex flex-wrap items-center gap-3 p-4">
              <div className="relative min-w-56 flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  maxLength={60}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome, e-mail, área ou equipe"
                  className="pl-9"
                />
              </div>
              <span className="text-xs text-muted-foreground">
                As contas chegam pela integração com o Active Directory; aqui você define quem é
                administrador do YpperConnect.
              </span>
            </div>

            <div className="panel overflow-hidden">
              <div className="hidden grid-cols-[1fr_1fr_10rem_8rem_6rem_3rem] gap-3 border-b border-border px-5 py-3 text-xs uppercase tracking-wide text-muted-foreground lg:grid">
                <span>Usuário</span>
                <span>E-mail</span>
                <span>Área</span>
                <span>Equipe</span>
                <span>Admin</span>
                <span />
              </div>
              <ul className="divide-y divide-border">
                {filtrados.map((u) => (
                  <li
                    key={u.id}
                    className="grid grid-cols-1 gap-2 px-5 py-3 text-sm lg:grid-cols-[1fr_1fr_10rem_8rem_6rem_3rem] lg:items-center lg:gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{u.nome}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {u.login}
                      </span>
                    </span>
                    <span className="truncate text-muted-foreground">{u.email}</span>
                    <span className="truncate text-muted-foreground">{u.departamento}</span>
                    <span className="truncate text-muted-foreground">{u.equipe}</span>
                    <span>
                      <Switch
                        checked={u.admin}
                        disabled={!isAdmin}
                        onCheckedChange={(v) => {
                          updateUser(u.id, { admin: v });
                          toast.success(
                            v
                              ? `${u.nome} agora é administrador`
                              : `${u.nome} deixou de ser administrador`,
                          );
                        }}
                      />
                    </span>
                    <span className="text-right">
                      {isAdmin && u.id !== currentUserId ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          title="Remover usuário"
                          onClick={() => removeUser(u.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
                {filtrados.length === 0 ? (
                  <li className="px-5 py-10 text-center text-sm text-muted-foreground">
                    Nenhum usuário encontrado.
                  </li>
                ) : null}
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="sistemas" className="mt-4 space-y-4">
            <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted-foreground">
                Cada sistema tem um dono e um destinatário padrão: chamados abertos para ele são
                atribuídos automaticamente.
              </p>
              {isAdmin ? (
                <SystemDialog
                  trigger={
                    <Button size="sm" className="gap-2">
                      <Plus className="size-4" /> Novo sistema
                    </Button>
                  }
                />
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {systems.map((s) => (
                <article key={s.id} className="panel flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{s.nome}</h3>
                      <p className="text-xs text-muted-foreground">
                        {s.categoria} · criticidade {CRITICALITY_LABEL[s.criticidade]}
                      </p>
                    </div>
                    {isAdmin ? (
                      <div className="flex shrink-0 gap-1">
                        <SystemDialog
                          system={s}
                          trigger={
                            <Button variant="ghost" size="icon" className="size-7" title="Editar">
                              <UserCog className="size-3.5" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          title="Excluir"
                          onClick={() => removeSystem(s.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <p className="flex-1 text-sm text-muted-foreground">{s.descricao}</p>
                  <dl className="space-y-1 border-t border-border pt-3 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Responsável</dt>
                      <dd className="truncate">{nome(s.responsavelId)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Atribuição automática</dt>
                      <dd className="truncate text-primary">{nome(s.atribuicaoId)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Equipe</dt>
                      <dd className="truncate">{s.equipe}</dd>
                    </div>
                  </dl>
                  {!s.ativo ? (
                    <Badge variant="outline" className="w-fit">
                      Inativo
                    </Badge>
                  ) : null}
                </article>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="emails" className="mt-4 space-y-4">
            <div className="panel grid gap-3 p-4 text-sm md:grid-cols-3">
              <div>
                <p className="font-medium">Mudança de status de chamado</p>
                <p className="text-xs text-muted-foreground">
                  E-mail para o solicitante e para o responsável pelo atendimento a cada alteração.
                </p>
              </div>
              <div>
                <p className="font-medium">Projeto sem atualização</p>
                <p className="text-xs text-muted-foreground">
                  Lembrete ao gerente e ao sponsor com {LEMBRETE_DIAS} dias sem status report.
                </p>
              </div>
              <div>
                <p className="font-medium">Escalonamento diário</p>
                <p className="text-xs text-muted-foreground">
                  A partir de {LEMBRETE_DIARIO_DIAS} dias, o lembrete passa a ser enviado todo dia.
                </p>
              </div>
            </div>

            {pendentes.length ? (
              <div className="panel space-y-2 border-warning/40 p-4">
                <p className="text-sm font-medium text-warning">Projetos em cobrança automática</p>
                {pendentes.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm"
                  >
                    <span>{p.nome}</span>
                    <span className="text-xs text-muted-foreground">
                      {diasSemAtualizacao(p)} dias sem atualização · {p.gerente}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="panel overflow-hidden">
              <div className="border-b border-border px-5 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                Caixa de saída
              </div>
              <ul className="divide-y divide-border">
                {(hydrated ? notifications : []).map((n) => (
                  <li key={n.id} className="space-y-1 px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[11px]">
                        {NOTIFICATION_LABEL[n.tipo]}
                      </Badge>
                      <span className="text-sm font-medium">{n.assunto}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {new Date(n.criadoEm).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Para: {n.destinatarios.join(", ")}
                    </p>
                    <p className="whitespace-pre-line text-sm text-muted-foreground">{n.corpo}</p>
                  </li>
                ))}
                {!hydrated || notifications.length === 0 ? (
                  <li className="px-5 py-10 text-center text-sm text-muted-foreground">
                    Nenhuma notificação disparada ainda.
                  </li>
                ) : null}
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
