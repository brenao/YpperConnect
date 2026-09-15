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
import { Paginacao, usePaginacao } from "@/views/paginacao";
import { listarRecursosFn } from "@/services/recursos.functions";
import { cn } from "@/lib/utils";
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
      { title: "Administração · BeagleOne" },
      {
        name: "description",
        content:
          "Administração do BeagleOne: usuários, administradores, responsáveis por sistema, atribuição automática de chamados e notificações por e-mail.",
      },
      { property: "og:title", content: "Administração · BeagleOne" },
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

/**
 * Diálogo de usuário.
 *
 * Aceita ser controlado de fora para a lista poder abrir a edição pelo
 * clique na linha, mantendo uma única instância montada: antes havia um
 * Dialog por linha, e com a base do GLPI isso eram centenas de
 * componentes só esperando um clique que quase nunca vinha.
 */
function UserDialog({
  user,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  user?: Usuario | undefined;
  trigger?: ReactNode | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((v: boolean) => void) | undefined;
}) {
  const qc = useQueryClient();
  const [interno, setInterno] = useState(false);
  const open = openProp ?? interno;
  const setOpen = onOpenChange ?? setInterno;
  const [form, setForm] = useState<FormUsuario>(usuarioVazio);

  /**
   * Só marca os campos em vermelho depois da primeira tentativa.
   *
   * Pintar de erro um formulário recém-aberto acusa a pessoa de algo
   * que ela ainda não teve chance de fazer. Antes disso, o toast era o
   * único aviso — e ele some sem dizer qual campo estava errado.
   */
  const [tentou, setTentou] = useState(false);

  const equipes = useQuery({
    queryKey: ["equipes"],
    queryFn: () => listarEquipesFn(),
    enabled: open,
  });
  const perfis = useQuery({ queryKey: ["perfis"], queryFn: () => listarPerfisFn(), enabled: open });

  useEffect(() => {
    if (!open) return;
    setTentou(false);
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

  // Uma fonte só para a regra: o texto embaixo do campo, a borda
  // vermelha e a recusa ao salvar leem daqui. Duplicar a condição faria
  // o campo ficar vermelho sem impedir o envio, ou o contrário.
  const erroNome = form.nome.trim().length < 3 ? "Informe o nome completo." : null;
  const erroEmail =
    form.email.trim() === ""
      ? "Campo obrigatório."
      : !form.email.includes("@")
        ? "Informe um e-mail válido."
        : null;
  const erroLogin = form.login.trim().length < 3 ? "Informe o login de rede." : null;

  const classeErro = "border-destructive focus-visible:ring-destructive/40";

  function salvar() {
    setTentou(true);
    if (erroNome || erroEmail || erroLogin) {
      toast.error("Revise os campos destacados.");
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
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
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
            <Label htmlFor="usr-nome">
              Nome completo <span className="text-destructive">*</span>
            </Label>
            <Input
              id="usr-nome"
              maxLength={200}
              aria-invalid={tentou && erroNome !== null}
              className={tentou && erroNome ? classeErro : undefined}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
            {tentou && erroNome ? <p className="text-xs text-destructive">{erroNome}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usr-email">
              E-mail <span className="text-destructive">*</span>
            </Label>
            <Input
              id="usr-email"
              type="email"
              maxLength={320}
              aria-invalid={tentou && erroEmail !== null}
              className={tentou && erroEmail ? classeErro : undefined}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            {tentou && erroEmail ? <p className="text-xs text-destructive">{erroEmail}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usr-login">
              Login de rede <span className="text-destructive">*</span>
            </Label>
            <Input
              id="usr-login"
              maxLength={120}
              disabled={!!user}
              aria-invalid={tentou && erroLogin !== null}
              className={tentou && erroLogin ? classeErro : undefined}
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value })}
              placeholder="ROSSET\usuario"
            />
            {tentou && erroLogin ? <p className="text-xs text-destructive">{erroLogin}</p> : null}
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

/** Recortes que os cartões aplicam sobre a lista de usuários. */
type FiltroCartao = "todos" | "admins" | "atendentes";

/**
 * Cartão de indicador que também filtra.
 *
 * O número já estava lá dizendo "existem 14 administradores"; poder
 * clicar nele responde a pergunta seguinte — "quais?" — sem obrigar a
 * pessoa a adivinhar um termo de busca que separe esse grupo.
 *
 * O estado ligado é visível na borda e no `aria-pressed`: sem isso, a
 * lista filtrada parece uma lista incompleta.
 */
function CartaoFiltro({
  label,
  value,
  hint,
  ativo,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  ativo?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo ?? false}
      className={cn(
        "panel p-4 text-left transition-colors hover:border-primary/40",
        ativo ? "border-primary/60 bg-primary/5" : "",
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </button>
  );
}

/**
 * Tabela de usuários de um grupo.
 *
 * Extraída porque a tela passou a mostrar dois blocos com o mesmo
 * formato — quem já é recurso e quem não é. Duas cópias do mesmo markup
 * divergiriam na primeira coluna que alguém acrescentasse.
 */
function TabelaUsuarios({
  usuarios,
  isAdmin,
  alternando,
  nomeDoPerfil,
  onEditar,
  onAlternar,
}: {
  usuarios: Usuario[];
  isAdmin: boolean;
  alternando: boolean;
  nomeDoPerfil: (id: string | null) => string;
  onEditar: (u: Usuario) => void;
  onAlternar: (id: string, ativo: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">Usuário</th>
            <th className="px-4 py-2 font-medium">Departamento</th>
            <th className="px-4 py-2 font-medium">Equipe</th>
            <th className="px-4 py-2 font-medium">Perfil de acesso</th>
            <th className="px-4 py-2 font-medium">Origem</th>
            <th className="px-4 py-2 font-medium">Situação</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            /* A linha inteira abre a edição: o lápis era um alvo de 14px
               numa linha de 900, e quem quer editar clica no nome. O
               botão de ativar/desativar para a propagação para não
               abrir o diálogo junto. */
            <tr
              key={u.id}
              onClick={isAdmin ? () => onEditar(u) : undefined}
              className={cn(
                "border-b border-border/60",
                u.ativo ? "" : "opacity-60",
                isAdmin ? "cursor-pointer transition-colors hover:bg-secondary/40" : "",
              )}
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
                {u.perfilId ? (
                  <Badge variant="outline" className="text-[10px]">
                    {nomeDoPerfil(u.perfilId)}
                  </Badge>
                ) : (
                  <span className="text-xs text-warning">Sem perfil</span>
                )}
              </td>
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
                  <span className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      title={u.ativo ? "Desativar" : "Reativar"}
                      disabled={alternando}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAlternar(u.id, !u.ativo);
                      }}
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
        </tbody>
      </table>
    </div>
  );
}

function Administracao() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [filtroCartao, setFiltroCartao] = useState<FiltroCartao>("todos");
  const [aba, setAba] = useState("usuarios");
  // Um diálogo só para a lista inteira, aberto pela linha clicada.
  const [usuarioEditando, setUsuarioEditando] = useState<Usuario | undefined>(undefined);
  const [edicaoAberta, setEdicaoAberta] = useState(false);

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const usuariosQuery = useQuery({ queryKey: ["usuarios"], queryFn: () => listarUsuariosFn() });
  const sistemasQuery = useQuery({
    queryKey: ["sistemas-admin"],
    queryFn: () => listarSistemasAdminFn(),
  });
  // Só para saber quem já é recurso. A lista de recursos é pequena
  // perto da de usuários, e cruzar aqui evita uma consulta nova no
  // servidor só para responder "esta pessoa recebe tarefa?".
  const recursosQuery = useQuery({ queryKey: ["recursos"], queryFn: () => listarRecursosFn() });
  // O nome do perfil não vem na lista de usuários, só o id. A lista de
  // perfis tem meia dúzia de linhas: cruzar aqui sai mais barato do que
  // acrescentar um JOIN que toda tela de usuário passaria a pagar.
  const perfisQuery = useQuery({ queryKey: ["perfis"], queryFn: () => listarPerfisFn() });
  const notificacoes = useQuery({
    queryKey: ["notificacoes"],
    queryFn: () => listarNotificacoesFn(),
  });

  const isAdmin = usuario.data?.admin ?? false;
  const usuarios = useMemo(() => usuariosQuery.data ?? [], [usuariosQuery.data]);
  const sistemas = useMemo(() => sistemasQuery.data ?? [], [sistemasQuery.data]);

  const nomeDoPerfil = useMemo(() => {
    const mapa = new Map((perfisQuery.data ?? []).map((p) => [p.id, p.nome]));
    return (id: string | null) => (id ? (mapa.get(id) ?? "Perfil removido") : "Sem perfil");
  }, [perfisQuery.data]);

  /** Ids de usuário que têm recurso ativo — são os que recebem tarefa. */
  const usuariosComRecurso = useMemo(() => {
    const ids = new Set<string>();
    for (const r of recursosQuery.data?.recursos ?? []) {
      if (r.ativo && r.usuarioId) ids.add(r.usuarioId);
    }
    return ids;
  }, [recursosQuery.data]);

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
      qc.invalidateQueries({ queryKey: ["projetos"] });
      const detalhe = [
        `${r.lembretes.enfileirados} lembrete(s) gerado(s)`,
        r.lembretes.paralisados > 0 ? `${r.lembretes.paralisados} projeto(s) paralisado(s)` : "",
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

  /**
   * Nome e e-mail entram com guarda de nulo.
   *
   * A sincronização do GLPI traz pessoas sem e-mail cadastrado, e o
   * filtro só tocava nesses campos quando havia texto digitado — por
   * isso a tela abria bem e quebrava na primeira tecla da busca.
   */
  const usuariosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return usuarios
      .filter((u) => mostrarInativos || u.ativo)
      .filter((u) => {
        if (filtroCartao === "admins") return u.admin;
        if (filtroCartao === "atendentes") return u.equipeId !== null;
        return true;
      })
      .filter(
        (u) =>
          !q ||
          (u.nome ?? "").toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.departamento ?? "").toLowerCase().includes(q),
      );
  }, [usuarios, busca, mostrarInativos, filtroCartao]);

  /**
   * Dois blocos: quem já recebe tarefa e quem ainda não.
   *
   * Com mais de mil pessoas vindas do GLPI, a lista única escondia
   * justamente as poucas que interessam no dia a dia — quem tem recurso
   * cadastrado e pode ser responsável por uma atividade. Separar em
   * blocos põe esse grupo no topo sem esconder o resto, que continua ali
   * para quando alguém novo precisar de acesso.
   */
  const comRecurso = useMemo(
    () => usuariosFiltrados.filter((u) => usuariosComRecurso.has(u.id)),
    [usuariosFiltrados, usuariosComRecurso],
  );
  const semRecurso = useMemo(
    () => usuariosFiltrados.filter((u) => !usuariosComRecurso.has(u.id)),
    [usuariosFiltrados, usuariosComRecurso],
  );

  const chave = `${busca}|${mostrarInativos}|${filtroCartao}`;
  const paginaComRecurso = usePaginacao(comRecurso, `rec|${chave}`);
  const paginaSemRecurso = usePaginacao(semRecurso, `sem|${chave}`);

  const sistemasFiltrados = useMemo(
    () => sistemas.filter((s) => mostrarInativos || s.ativo),
    [sistemas, mostrarInativos],
  );

  const carregando = usuariosQuery.isPending || sistemasQuery.isPending;

  function abrirEdicao(u: Usuario) {
    setUsuarioEditando(u);
    setEdicaoAberta(true);
  }

  function alternarCartao(f: FiltroCartao) {
    setFiltroCartao((atual) => (atual === f ? "todos" : f));
    setAba("usuarios");
  }

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
        <CartaoFiltro
          label="Usuários"
          value={String(usuarios.filter((u) => u.ativo).length)}
          hint="ativos no sistema"
          ativo={filtroCartao === "todos" && aba === "usuarios"}
          onClick={() => {
            setFiltroCartao("todos");
            setAba("usuarios");
          }}
        />
        <CartaoFiltro
          label="Administradores"
          value={String(usuarios.filter((u) => u.admin && u.ativo).length)}
          hint="com acesso total"
          ativo={filtroCartao === "admins"}
          onClick={() => alternarCartao("admins")}
        />
        <CartaoFiltro
          label="Atendentes"
          value={String(usuarios.filter((u) => u.equipeId && u.ativo).length)}
          hint="podem receber chamado"
          ativo={filtroCartao === "atendentes"}
          onClick={() => alternarCartao("atendentes")}
        />
        <CartaoFiltro
          label="Sistemas"
          value={String(sistemas.filter((s) => s.ativo).length)}
          hint="no inventário"
          ativo={aba === "sistemas"}
          onClick={() => setAba("sistemas")}
        />
      </div>

      {carregando ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando cadastros...
        </p>
      ) : (
        <Tabs value={aba} onValueChange={setAba}>
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

            {isAdmin ? (
              <p className="text-xs text-muted-foreground">
                Clique em qualquer linha para editar o usuário.
              </p>
            ) : null}

            {filtroCartao !== "todos" ? (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                Mostrando apenas {filtroCartao === "admins" ? "administradores" : "atendentes"}.
                <button
                  type="button"
                  onClick={() => setFiltroCartao("todos")}
                  className="text-primary hover:underline"
                >
                  Ver todos
                </button>
              </p>
            ) : null}

            <section className="space-y-2">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
                Cadastrados como recurso ({comRecurso.length})
              </h2>
              {comRecurso.length === 0 ? (
                <p className="panel px-5 py-8 text-center text-sm text-muted-foreground">
                  Ninguém aqui. Cadastre em Recursos e capacidade para que a pessoa possa receber
                  tarefa de projeto.
                </p>
              ) : (
                <div className="panel overflow-hidden">
                  <Paginacao {...paginaComRecurso.controles} rotulo="com recurso" posicao="topo" />
                  <TabelaUsuarios
                    usuarios={paginaComRecurso.visiveis}
                    isAdmin={isAdmin}
                    alternando={alternarUsuario.isPending}
                    nomeDoPerfil={nomeDoPerfil}
                    onEditar={abrirEdicao}
                    onAlternar={(id, ativo) => alternarUsuario.mutate({ id, ativo })}
                  />
                  <Paginacao {...paginaComRecurso.controles} rotulo="com recurso" />
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
                Demais usuários ({semRecurso.length})
              </h2>
              {semRecurso.length === 0 ? (
                <p className="panel px-5 py-8 text-center text-sm text-muted-foreground">
                  Nenhum usuário fora dos recursos com os filtros atuais.
                </p>
              ) : (
                <div className="panel overflow-hidden">
                  <Paginacao {...paginaSemRecurso.controles} rotulo="usuários" posicao="topo" />
                  <TabelaUsuarios
                    usuarios={paginaSemRecurso.visiveis}
                    isAdmin={isAdmin}
                    alternando={alternarUsuario.isPending}
                    nomeDoPerfil={nomeDoPerfil}
                    onEditar={abrirEdicao}
                    onAlternar={(id, ativo) => alternarUsuario.mutate({ id, ativo })}
                  />
                  <Paginacao {...paginaSemRecurso.controles} rotulo="usuários" />
                </div>
              )}
            </section>
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
                  As rotinas geram os lembretes de projeto, paralisam o que está parado e despacham
                  a fila. O agendador ainda não existe: por ora, alguém precisa clicar.
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

      {/* Fora das abas: é a linha da tabela que o abre, e mantê-lo aqui
          evita remontá-lo a cada troca de aba ou de página. */}
      <UserDialog
        user={usuarioEditando}
        open={edicaoAberta}
        onOpenChange={(v) => {
          setEdicaoAberta(v);
          if (!v) setUsuarioEditando(undefined);
        }}
      />
    </AppShell>
  );
}
