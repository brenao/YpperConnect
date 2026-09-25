import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Search,
  Tags,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
import { PainelCalendario } from "@/views/calendario-admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Paginacao, usePaginacao } from "@/views/paginacao";
import { cn } from "@/lib/utils";
import { sessaoFn } from "@/services/sessao.functions";
import {
  atualizarCategoriaFn,
  atualizarEquipeFn,
  atualizarMembroFn,
  convidarMembroFn,
  criarCategoriaFn,
  criarEquipeFn,
  dadosAdministracaoFn,
  gerarLinkAcessoFn,
} from "@/services/administracao.functions";
import type {
  Categoria,
  EscopoCategoria,
  Equipe,
  Membro,
  PapelResumo,
} from "@/repositories/administracao.repo";

export const Route = createFileRoute("/administracao")({
  head: () => ({
    meta: [
      { title: "Administração · BeagleOne" },
      {
        name: "description",
        content: "Administração da empresa no BeagleOne: membros, papéis, equipes e categorias.",
      },
    ],
  }),
  component: Administracao,
});

/** Radix não aceita SelectItem com value vazio. */
const SEM = "__nenhum__";

const ESCOPO_LABEL: Record<EscopoCategoria, string> = {
  chamado: "Chamado",
  servico: "Serviço",
  artigo: "Artigo",
  sistema: "Sistema",
};

const ORIGEM_LABEL: Record<string, string> = {
  manual: "manual",
  convite: "convite",
  importacao: "importação",
  dominio: "domínio",
  sso: "SSO",
  scim: "SCIM",
  api: "API",
};

const CHAVE_DADOS = ["administracao"] as const;

// ------------------------------------------------------------------ apoio

function CartaoResumo({
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

function useErro() {
  return (e: Error) => toast.error("Não foi possível concluir", { description: e.message });
}

/**
 * Link de convite ou de acesso, para o administrador copiar e enviar.
 * Vale uma vez e expira: o aviso evita que alguém guarde o link para
 * usar na semana seguinte.
 */
function DialogLink({
  link,
  titulo,
  onFechar,
}: {
  link: string | null;
  titulo: string;
  onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  return (
    <Dialog open={link !== null} onOpenChange={(aberto) => (aberto ? null : onFechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Envie este link à pessoa pelo canal que preferir. Ele vale uma única vez e expira em 1
            hora. Ao abrir, ela define a própria senha.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={link ?? ""} className="font-mono text-xs" />
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-2"
            onClick={async () => {
              await navigator.clipboard.writeText(link ?? "");
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2000);
            }}
          >
            {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copiado ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onFechar}>Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SeletorPapel({
  papeis,
  value,
  onChange,
}: {
  papeis: PapelResumo[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Escolha o papel" />
      </SelectTrigger>
      <SelectContent>
        {papeis.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SeletorEquipe({
  equipes,
  value,
  onChange,
}: {
  equipes: Equipe[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SEM}>Sem equipe</SelectItem>
        {equipes
          .filter((e) => e.ativo)
          .map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.nome}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

// ------------------------------------------------------------------ membros

function DialogConvite({
  aberto,
  onFechar,
  papeis,
  equipes,
  onLink,
}: {
  aberto: boolean;
  onFechar: () => void;
  papeis: PapelResumo[];
  equipes: Equipe[];
  onLink: (link: string) => void;
}) {
  const qc = useQueryClient();
  const erro = useErro();
  const solicitante = papeis.find((p) => p.chave === "solicitante")?.id ?? papeis[0]?.id ?? "";

  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [papelId, setPapelId] = useState(solicitante);
  const [equipeId, setEquipeId] = useState(SEM);

  function limpar() {
    setEmail("");
    setNome("");
    setPapelId(solicitante);
    setEquipeId(SEM);
  }

  const convidar = useMutation({
    mutationFn: () =>
      convidarMembroFn({
        data: { email, nome, papelId, equipeId: equipeId === SEM ? null : equipeId },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: CHAVE_DADOS });
      limpar();
      onFechar();
      if (r.link) {
        onLink(r.link);
      } else {
        toast.success("Pessoa adicionada", {
          description: "Ela já tinha conta e pode entrar com a senha atual.",
        });
      }
    },
    onError: erro,
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? null : onFechar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar pessoa</DialogTitle>
          <DialogDescription>
            Se o e-mail ainda não tem conta, geramos um link de convite para você enviar.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            convidar.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="convite-email">E-mail</Label>
            <Input
              id="convite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="convite-nome">Nome</Label>
            <Input
              id="convite-nome"
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Papel</Label>
              <SeletorPapel papeis={papeis} value={papelId} onChange={setPapelId} />
            </div>
            <div className="space-y-2">
              <Label>Equipe</Label>
              <SeletorEquipe equipes={equipes} value={equipeId} onChange={setEquipeId} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={convidar.isPending || !papelId} className="gap-2">
              {convidar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Convidar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edição de papel e equipe. Montado com `key` da pessoa: abrir para
 * outra pessoa recria o componente e o formulário nasce com os dados
 * certos, sem efeito para sincronizar estado.
 */
function DialogMembro({
  membro,
  onFechar,
  papeis,
  equipes,
}: {
  membro: Membro;
  onFechar: () => void;
  papeis: PapelResumo[];
  equipes: Equipe[];
}) {
  const qc = useQueryClient();
  const erro = useErro();
  const [papelId, setPapelId] = useState(membro.papelId ?? "");
  const [equipeId, setEquipeId] = useState(membro.equipeId ?? SEM);

  const salvar = useMutation({
    mutationFn: () =>
      atualizarMembroFn({
        data: {
          usuarioId: membro.usuarioId,
          ...(papelId && papelId !== membro.papelId ? { papelId } : {}),
          equipeId: equipeId === SEM ? null : equipeId,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE_DADOS });
      qc.invalidateQueries({ queryKey: ["sessao"] });
      toast.success("Alterações salvas");
      onFechar();
    },
    onError: erro,
  });

  return (
    <Dialog open onOpenChange={(v) => (v ? null : onFechar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{membro.nome}</DialogTitle>
          <DialogDescription>{membro.email ?? "sem e-mail"}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Papel</Label>
            <SeletorPapel papeis={papeis} value={papelId} onChange={setPapelId} />
          </div>
          <div className="space-y-2">
            <Label>Equipe</Label>
            <SeletorEquipe equipes={equipes} value={equipeId} onChange={setEquipeId} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending} className="gap-2">
            {salvar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AbaMembros({
  membros,
  papeis,
  equipes,
  meuId,
  podeGerenciar,
  mostrarInativos,
  filtroAdmins,
  onLimparFiltro,
}: {
  membros: Membro[];
  papeis: PapelResumo[];
  equipes: Equipe[];
  meuId: string;
  podeGerenciar: boolean;
  mostrarInativos: boolean;
  filtroAdmins: boolean;
  onLimparFiltro: () => void;
}) {
  const qc = useQueryClient();
  const erro = useErro();
  const [busca, setBusca] = useState("");
  const [convidando, setConvidando] = useState(false);
  const [editando, setEditando] = useState<Membro | null>(null);
  const [link, setLink] = useState<{ url: string; titulo: string } | null>(null);

  const papelPorId = useMemo(() => new Map(papeis.map((p) => [p.id, p])), [papeis]);
  const equipePorId = useMemo(() => new Map(equipes.map((e) => [e.id, e.nome])), [equipes]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return membros
      .filter((m) => mostrarInativos || m.ativo)
      .filter((m) => !filtroAdmins || papelPorId.get(m.papelId ?? "")?.chave === "admin_tenant")
      .filter(
        (m) => !q || m.nome.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q),
      );
  }, [membros, busca, mostrarInativos, filtroAdmins, papelPorId]);

  const pagina = usePaginacao(filtrados, `${busca}|${mostrarInativos}|${filtroAdmins}`);

  const alternar = useMutation({
    mutationFn: (v: { usuarioId: string; ativo: boolean }) => atualizarMembroFn({ data: v }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: CHAVE_DADOS });
      toast.success(v.ativo ? "Acesso reativado" : "Acesso desativado");
    },
    onError: erro,
  });

  const gerarLink = useMutation({
    mutationFn: (usuarioId: string) => gerarLinkAcessoFn({ data: { usuarioId } }),
    onSuccess: (r) => setLink({ url: r.link, titulo: "Link de acesso" }),
    onError: erro,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou e-mail"
            className="pl-8"
          />
        </div>
        {podeGerenciar ? (
          <Button size="sm" className="gap-2" onClick={() => setConvidando(true)}>
            <UserPlus className="size-4" /> Convidar pessoa
          </Button>
        ) : null}
      </div>

      {podeGerenciar ? (
        <p className="text-xs text-muted-foreground">
          Clique na linha para mudar papel ou equipe. A chave gera um link de acesso (primeiro
          acesso ou senha esquecida).
        </p>
      ) : null}

      {filtroAdmins ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Mostrando apenas administradores.
          <button type="button" onClick={onLimparFiltro} className="text-primary hover:underline">
            Ver todos
          </button>
        </p>
      ) : null}

      {filtrados.length === 0 ? (
        <p className="panel px-5 py-8 text-center text-sm text-muted-foreground">
          Ninguém encontrado com os filtros atuais.
        </p>
      ) : (
        <div className="panel overflow-hidden">
          <Paginacao {...pagina.controles} rotulo="membros" posicao="topo" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Pessoa</th>
                  <th className="px-4 py-2 font-medium">Papel</th>
                  <th className="px-4 py-2 font-medium">Equipe</th>
                  <th className="px-4 py-2 font-medium">Origem</th>
                  <th className="px-4 py-2 font-medium">Situação</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {pagina.visiveis.map((m) => (
                  <tr
                    key={m.usuarioId}
                    onClick={podeGerenciar ? () => setEditando(m) : undefined}
                    className={cn(
                      "border-b border-border/60",
                      m.ativo ? "" : "opacity-60",
                      podeGerenciar ? "cursor-pointer transition-colors hover:bg-secondary/40" : "",
                    )}
                  >
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        {m.nome}
                        {m.usuarioId === meuId ? (
                          <Badge variant="outline" className="text-[10px]">
                            você
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {m.email ?? "sem e-mail"}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {m.papelId ? (
                        <Badge variant="outline" className="text-[10px]">
                          {papelPorId.get(m.papelId)?.nome ?? "—"}
                        </Badge>
                      ) : (
                        <span className="text-xs text-warning">Sem papel</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {m.equipeId ? (equipePorId.get(m.equipeId) ?? "—") : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {ORIGEM_LABEL[m.origem] ?? m.origem}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {m.ativo ? (
                        <span className="text-success">Ativo</span>
                      ) : (
                        <span className="text-muted-foreground">Inativo</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {podeGerenciar ? (
                        <span className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Gerar link de acesso"
                            disabled={gerarLink.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              gerarLink.mutate(m.usuarioId);
                            }}
                          >
                            <KeyRound className="size-3.5 text-muted-foreground" />
                          </Button>
                          {m.usuarioId !== meuId ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              title={m.ativo ? "Desativar acesso" : "Reativar acesso"}
                              disabled={alternar.isPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                alternar.mutate({ usuarioId: m.usuarioId, ativo: !m.ativo });
                              }}
                            >
                              {m.ativo ? (
                                <EyeOff className="size-3.5 text-muted-foreground" />
                              ) : (
                                <Eye className="size-3.5 text-success" />
                              )}
                            </Button>
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacao {...pagina.controles} rotulo="membros" />
        </div>
      )}

      <DialogConvite
        aberto={convidando}
        onFechar={() => setConvidando(false)}
        papeis={papeis}
        equipes={equipes}
        onLink={(url) => setLink({ url, titulo: "Convite criado" })}
      />
      {editando ? (
        <DialogMembro
          key={editando.usuarioId}
          membro={editando}
          onFechar={() => setEditando(null)}
          papeis={papeis}
          equipes={equipes}
        />
      ) : null}
      <DialogLink
        link={link?.url ?? null}
        titulo={link?.titulo ?? ""}
        onFechar={() => setLink(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ cadastro simples

/**
 * Lista com inclusão, renomeação e ativação. Equipes e categorias têm o
 * mesmo comportamento; a diferença (coluna extra) entra por props.
 */
function ListaCadastro<T extends { id: string; nome: string; ativo: boolean }>({
  itens,
  podeGerenciar,
  mostrarInativos,
  rotuloNovo,
  placeholder,
  colunaExtra,
  onCriar,
  onAtualizar,
  criando,
  atualizando,
}: {
  itens: T[];
  podeGerenciar: boolean;
  mostrarInativos: boolean;
  rotuloNovo: string;
  placeholder: string;
  colunaExtra?: { titulo: string; valor: (item: T) => ReactNode };
  onCriar: (nome: string) => Promise<boolean>;
  onAtualizar: (id: string, mudancas: { nome?: string; ativo?: boolean }) => void;
  criando: boolean;
  atualizando: boolean;
}) {
  const [novo, setNovo] = useState("");
  const [renomeando, setRenomeando] = useState<T | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState("");

  const visiveis = itens.filter((i) => mostrarInativos || i.ativo);

  return (
    <div className="space-y-4">
      {podeGerenciar ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!novo.trim()) return;
            if (await onCriar(novo.trim())) setNovo("");
          }}
        >
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder={placeholder}
            className="max-w-sm"
          />
          <Button type="submit" size="sm" className="gap-2" disabled={criando}>
            {criando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {rotuloNovo}
          </Button>
        </form>
      ) : null}

      {visiveis.length === 0 ? (
        <p className="panel px-5 py-8 text-center text-sm text-muted-foreground">
          Nada cadastrado ainda.
        </p>
      ) : (
        <div className="panel overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Nome</th>
                {colunaExtra ? (
                  <th className="px-4 py-2 font-medium">{colunaExtra.titulo}</th>
                ) : null}
                <th className="px-4 py-2 font-medium">Situação</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((item) => (
                <tr
                  key={item.id}
                  className={cn("border-b border-border/60", item.ativo ? "" : "opacity-60")}
                >
                  <td className="px-4 py-2">{item.nome}</td>
                  {colunaExtra ? (
                    <td className="px-4 py-2 text-muted-foreground">{colunaExtra.valor(item)}</td>
                  ) : null}
                  <td className="px-4 py-2">
                    {item.ativo ? (
                      <span className="text-success">Ativo</span>
                    ) : (
                      <span className="text-muted-foreground">Inativo</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {podeGerenciar ? (
                      <span className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title="Renomear"
                          onClick={() => {
                            setRenomeando(item);
                            setNomeEdicao(item.nome);
                          }}
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title={item.ativo ? "Desativar" : "Reativar"}
                          disabled={atualizando}
                          onClick={() => onAtualizar(item.id, { ativo: !item.ativo })}
                        >
                          {item.ativo ? (
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
      )}

      <Dialog open={renomeando !== null} onOpenChange={(v) => (v ? null : setRenomeando(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (renomeando && nomeEdicao.trim()) {
                onAtualizar(renomeando.id, { nome: nomeEdicao.trim() });
                setRenomeando(null);
              }
            }}
          >
            <Input value={nomeEdicao} onChange={(e) => setNomeEdicao(e.target.value)} autoFocus />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenomeando(null)}>
                Cancelar
              </Button>
              <Button type="submit">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AbaEquipes({
  equipes,
  podeGerenciar,
  mostrarInativos,
}: {
  equipes: Equipe[];
  podeGerenciar: boolean;
  mostrarInativos: boolean;
}) {
  const qc = useQueryClient();
  const erro = useErro();

  const criar = useMutation({
    mutationFn: (nome: string) => criarEquipeFn({ data: { nome } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE_DADOS });
      toast.success("Equipe criada");
    },
    onError: erro,
  });

  const atualizar = useMutation({
    mutationFn: (v: { id: string; nome?: string; ativo?: boolean }) =>
      atualizarEquipeFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE_DADOS });
      toast.success("Equipe atualizada");
    },
    onError: erro,
  });

  return (
    <ListaCadastro
      itens={equipes}
      podeGerenciar={podeGerenciar}
      mostrarInativos={mostrarInativos}
      rotuloNovo="Nova equipe"
      placeholder="Nome da equipe"
      colunaExtra={{ titulo: "Membros ativos", valor: (e) => e.membros }}
      onCriar={(nome) =>
        criar.mutateAsync(nome).then(
          () => true,
          () => false,
        )
      }
      onAtualizar={(id, mudancas) => atualizar.mutate({ id, ...mudancas })}
      criando={criar.isPending}
      atualizando={atualizar.isPending}
    />
  );
}

function AbaCategorias({
  categorias,
  podeGerenciar,
  mostrarInativos,
}: {
  categorias: Categoria[];
  podeGerenciar: boolean;
  mostrarInativos: boolean;
}) {
  const qc = useQueryClient();
  const erro = useErro();
  const [escopo, setEscopo] = useState<EscopoCategoria>("chamado");

  const criar = useMutation({
    mutationFn: (nome: string) => criarCategoriaFn({ data: { nome, escopo } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE_DADOS });
      toast.success("Categoria criada");
    },
    onError: erro,
  });

  const atualizar = useMutation({
    mutationFn: (v: { id: string; nome?: string; ativo?: boolean }) =>
      atualizarCategoriaFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHAVE_DADOS });
      toast.success("Categoria atualizada");
    },
    onError: erro,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(ESCOPO_LABEL) as EscopoCategoria[]).map((e) => (
          <Button
            key={e}
            size="sm"
            variant={escopo === e ? "default" : "outline"}
            onClick={() => setEscopo(e)}
          >
            {ESCOPO_LABEL[e]} ({categorias.filter((c) => c.escopo === e && c.ativo).length})
          </Button>
        ))}
      </div>
      <ListaCadastro
        itens={categorias.filter((c) => c.escopo === escopo)}
        podeGerenciar={podeGerenciar}
        mostrarInativos={mostrarInativos}
        rotuloNovo={`Nova categoria de ${ESCOPO_LABEL[escopo].toLowerCase()}`}
        placeholder="Nome da categoria"
        onCriar={(nome) =>
          criar.mutateAsync(nome).then(
            () => true,
            () => false,
          )
        }
        onAtualizar={(id, mudancas) => atualizar.mutate({ id, ...mudancas })}
        criando={criar.isPending}
        atualizando={atualizar.isPending}
      />
    </div>
  );
}

// ------------------------------------------------------------------ página

function Administracao() {
  const [aba, setAba] = useState("membros");
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [filtroAdmins, setFiltroAdmins] = useState(false);

  const sessao = useQuery({ queryKey: ["sessao"], queryFn: () => sessaoFn() });
  const dados = useQuery({ queryKey: CHAVE_DADOS, queryFn: () => dadosAdministracaoFn() });

  const permissoes = sessao.data?.permissoes ?? [];
  const pode = (p: string) => permissoes.includes(p);

  const membros = dados.data?.membros ?? [];
  const papeis = dados.data?.papeis ?? [];
  const equipes = dados.data?.equipes ?? [];
  const categorias = dados.data?.categorias ?? [];
  const adminId = papeis.find((p) => p.chave === "admin_tenant")?.id;

  return (
    <AppShell
      title="Administração"
      subtitle={
        sessao.data?.tenant
          ? `Membros, papéis, equipes e categorias de ${sessao.data.tenant.nome}`
          : "Membros, papéis, equipes e categorias"
      }
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
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoResumo
          label="Membros"
          value={String(membros.filter((m) => m.ativo).length)}
          hint="com acesso ativo"
          ativo={aba === "membros" && !filtroAdmins}
          onClick={() => {
            setFiltroAdmins(false);
            setAba("membros");
          }}
        />
        <CartaoResumo
          label="Administradores"
          value={String(membros.filter((m) => m.ativo && m.papelId === adminId).length)}
          hint="gerenciam a empresa"
          ativo={aba === "membros" && filtroAdmins}
          onClick={() => {
            setFiltroAdmins((v) => !v);
            setAba("membros");
          }}
        />
        <CartaoResumo
          label="Equipes"
          value={String(equipes.filter((e) => e.ativo).length)}
          hint="ativas"
          ativo={aba === "equipes"}
          onClick={() => setAba("equipes")}
        />
        <CartaoResumo
          label="Categorias"
          value={String(categorias.filter((c) => c.ativo).length)}
          hint="em todos os escopos"
          ativo={aba === "categorias"}
          onClick={() => setAba("categorias")}
        />
      </div>

      {dados.isPending ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando cadastros...
        </p>
      ) : dados.isError ? (
        <p className="panel border-destructive/40 p-4 text-sm text-destructive">
          Não foi possível carregar: {dados.error.message}
        </p>
      ) : (
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList>
            <TabsTrigger value="membros" className="gap-2">
              <UserCog className="size-4" /> Membros
            </TabsTrigger>
            <TabsTrigger value="equipes" className="gap-2">
              <Users className="size-4" /> Equipes
            </TabsTrigger>
            <TabsTrigger value="categorias" className="gap-2">
              <Tags className="size-4" /> Categorias
            </TabsTrigger>
            <TabsTrigger value="calendario" className="gap-2">
              <CalendarDays className="size-4" /> Calendário
            </TabsTrigger>
          </TabsList>

          <TabsContent value="membros" className="mt-4">
            <AbaMembros
              membros={membros}
              papeis={papeis}
              equipes={equipes}
              meuId={dados.data.meuId}
              podeGerenciar={pode("usuario.gerenciar") && pode("papel.gerenciar")}
              mostrarInativos={mostrarInativos}
              filtroAdmins={filtroAdmins}
              onLimparFiltro={() => setFiltroAdmins(false)}
            />
          </TabsContent>

          <TabsContent value="equipes" className="mt-4">
            <AbaEquipes
              equipes={equipes}
              podeGerenciar={pode("cadastro.gerenciar")}
              mostrarInativos={mostrarInativos}
            />
          </TabsContent>

          <TabsContent value="categorias" className="mt-4">
            <AbaCategorias
              categorias={categorias}
              podeGerenciar={pode("cadastro.gerenciar")}
              mostrarInativos={mostrarInativos}
            />
          </TabsContent>

          <TabsContent value="calendario" className="mt-4">
            <PainelCalendario isAdmin={pode("cadastro.gerenciar")} />
          </TabsContent>
        </Tabs>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Sistemas e notificações voltam para esta tela nos próximos passos da migração.
      </p>
    </AppShell>
  );
}
