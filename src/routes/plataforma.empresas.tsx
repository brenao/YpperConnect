import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/views/app-shell";
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
import { ConfirmarExclusao } from "@/views/confirmar-exclusao";
import { DialogLink } from "@/views/dialog-link";
import { sessaoFn } from "@/services/sessao.functions";
import {
  criarEmpresaFn,
  excluirEmpresaFn,
  listarEmpresasFn,
  resumoEmpresaFn,
} from "@/services/empresas.functions";
import type { Empresa } from "@/repositories/empresas.repo";

export const Route = createFileRoute("/plataforma/empresas")({
  head: () => ({
    meta: [
      { title: "Empresas · Plataforma · BeagleOne" },
      { name: "description", content: "Empresas clientes do BeagleOne." },
    ],
  }),
  component: Empresas,
});

/** "Grupo Rosset" -> "grupo-rosset". Sugestão; a pessoa pode editar. */
function sugerirSlug(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function useErro() {
  return (e: Error) => toast.error("Não foi possível concluir", { description: e.message });
}

function DialogNovaEmpresa({
  aberto,
  onFechar,
  onLink,
}: {
  aberto: boolean;
  onFechar: () => void;
  onLink: (url: string) => void;
}) {
  const qc = useQueryClient();
  const erro = useErro();
  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEditado, setSlugEditado] = useState(false);
  const [adminNome, setAdminNome] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  function limpar() {
    setNome("");
    setSlug("");
    setSlugEditado(false);
    setAdminNome("");
    setAdminEmail("");
  }

  const criar = useMutation({
    mutationFn: () => criarEmpresaFn({ data: { nome, slug, adminNome, adminEmail } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["empresas"] });
      toast.success("Empresa criada");
      limpar();
      onFechar();
      if (r.link) onLink(r.link);
    },
    onError: erro,
  });

  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    criar.mutate();
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? null : onFechar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova empresa</DialogTitle>
          <DialogDescription>
            A empresa nasce pronta para uso: perfis, equipes, catálogo, calendário e feriados
            nacionais. O primeiro administrador recebe um link para criar a senha.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={aoEnviar}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="empresa-nome">Nome da empresa</Label>
              <Input
                id="empresa-nome"
                required
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value);
                  if (!slugEditado) setSlug(sugerirSlug(e.target.value));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="empresa-slug">Endereço</Label>
              <Input
                id="empresa-slug"
                required
                value={slug}
                className="font-mono"
                onChange={(e) => {
                  setSlugEditado(true);
                  setSlug(e.target.value.toLowerCase());
                }}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            O endereço identifica a empresa e não se repete. Minúsculas, números e hífen.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="admin-nome">Nome do administrador</Label>
              <Input
                id="admin-nome"
                required
                value={adminNome}
                onChange={(e) => setAdminNome(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-email">E-mail do administrador</Label>
              <Input
                id="admin-email"
                type="email"
                required
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={criar.isPending} className="gap-2">
              {criar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Criar empresa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Empresas() {
  const qc = useQueryClient();
  const erro = useErro();
  const sessao = useQuery({ queryKey: ["sessao"], queryFn: () => sessaoFn() });
  const operador = sessao.data?.adminPlataforma === true;

  const empresas = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listarEmpresasFn(),
    enabled: operador,
  });

  const [criando, setCriando] = useState(false);
  const [link, setLink] = useState<{ url: string; titulo: string } | null>(null);

  // Exclusão: confirmação com resumo do que a empresa tem, e o endereço
  // digitado para liberar o botão.
  const [excluindo, setExcluindo] = useState<Empresa | null>(null);
  const resumo = useQuery({
    queryKey: ["resumo-empresa", excluindo?.id],
    queryFn: () => resumoEmpresaFn({ data: { id: excluindo!.id } }),
    enabled: excluindo !== null,
    staleTime: 0,
  });
  const excluir = useMutation({
    mutationFn: (v: { id: string; confirmacao: string }) => excluirEmpresaFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empresas"] });
      setExcluindo(null);
      toast.success("Empresa excluída");
    },
    onError: erro,
  });

  const vinculos: string[] = [];
  if (resumo.data) {
    const r = resumo.data;
    if (r.usuarios) vinculos.push(`${r.usuarios} ${r.usuarios === 1 ? "usuário" : "usuários"}`);
    if (r.chamados) vinculos.push(`${r.chamados} ${r.chamados === 1 ? "chamado" : "chamados"}`);
    if (r.projetos) vinculos.push(`${r.projetos} ${r.projetos === 1 ? "projeto" : "projetos"}`);
  }

  return (
    <AppShell
      trilha="Plataforma"
      title="Empresas"
      subtitle="Empresas clientes do BeagleOne, cada uma com seus dados isolados"
      actions={
        operador ? (
          <Button size="sm" className="gap-2" onClick={() => setCriando(true)}>
            <Plus className="size-4" /> Nova empresa
          </Button>
        ) : undefined
      }
    >
      {sessao.isPending ? null : !operador ? (
        <div className="panel p-4 text-sm text-muted-foreground">
          Esta área é exclusiva dos operadores da plataforma.
        </div>
      ) : empresas.isPending ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando empresas...
        </p>
      ) : empresas.isError ? (
        <p className="panel border-destructive/40 p-4 text-sm text-destructive">
          Não foi possível carregar: {empresas.error.message}
        </p>
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Empresa</th>
                  <th className="px-4 py-2 font-medium">Endereço</th>
                  <th className="px-4 py-2 font-medium">Usuários</th>
                  <th className="px-4 py-2 font-medium">Chamados</th>
                  <th className="px-4 py-2 font-medium">Criada em</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {(empresas.data ?? []).map((e) => (
                  <tr key={e.id} className="border-b border-border/60">
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <Building2 className="size-4 text-muted-foreground" />
                        {e.nome}
                        {e.id === sessao.data?.tenant?.id ? (
                          <span className="text-[11px] text-muted-foreground">(atual)</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{e.slug}</td>
                    <td className="px-4 py-2">{e.usuarios}</td>
                    <td className="px-4 py-2">{e.chamados}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(e.criadoEm).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Excluir"
                          disabled={excluir.isPending}
                          onClick={() => setExcluindo(e)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DialogNovaEmpresa
        aberto={criando}
        onFechar={() => setCriando(false)}
        onLink={(url) => setLink({ url, titulo: "Convite do administrador" })}
      />
      <DialogLink link={link} onFechar={() => setLink(null)} />
      {excluindo ? (
        <ConfirmarExclusao
          key={excluindo.id}
          aberto
          onAbertoChange={(v) => (v ? null : setExcluindo(null))}
          nome={excluindo.nome}
          verificando={resumo.isPending}
          vinculos={vinculos}
          explicacao={
            <>
              A empresa sai de todas as telas e ninguém mais entra nela. Os dados continuam
              guardados no banco.
            </>
          }
          exigirTexto={excluindo.slug}
          excluindo={excluir.isPending}
          onConfirmar={() => excluir.mutate({ id: excluindo.id, confirmacao: excluindo.slug })}
        />
      ) : null}
    </AppShell>
  );
}
