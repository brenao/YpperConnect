import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Lock, LockOpen, UserPlus, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SeletorUsuario } from "@/views/seletor-usuario";
import type { SolicitacaoAcesso } from "@/repositories/acesso-projeto.repo";
import {
  listarAcessosFn,
  listarSolicitacoesParaAprovarFn,
  decidirSolicitacaoFn,
  concederAcessoFn,
  revogarAcessoFn,
} from "@/services/acesso-projeto.functions";

/**
 * Quem entra neste projeto.
 *
 * Vive dentro do projeto, e não numa tela própria de aprovações, porque
 * é aqui que o gerente já está quando decide — e porque a pergunta
 * "quem tem acesso?" só faz sentido ao lado do projeto de que se fala.
 * Uma caixa de entrada separada seria mais um lugar para esquecer de
 * visitar.
 *
 * A fila vem da consulta geral de pendências e é recortada por projeto
 * no cliente: quem aprova tem uns poucos projetos, e uma server
 * function a mais só para filtrar o que já veio não se paga.
 */
export function PainelAcessos({
  projetoId,
  sigiloso,
  editavel,
}: {
  projetoId: string;
  sigiloso: boolean;
  editavel: boolean;
}) {
  const qc = useQueryClient();
  const [recusando, setRecusando] = useState<SolicitacaoAcesso | undefined>(undefined);
  const [motivo, setMotivo] = useState("");
  const [convidado, setConvidado] = useState<string | null>(null);

  const acessos = useQuery({
    queryKey: ["projeto-acessos", projetoId],
    queryFn: () => listarAcessosFn({ data: { projetoId } }),
  });

  const pedidos = useQuery({
    queryKey: ["solicitacoes-aprovar"],
    queryFn: () => listarSolicitacoesParaAprovarFn({ data: { incluirDecididas: false } }),
    enabled: editavel,
  });

  const pendentes = (pedidos.data ?? []).filter((s) => s.projetoId === projetoId);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["projeto-acessos", projetoId] });
    qc.invalidateQueries({ queryKey: ["solicitacoes-aprovar"] });
  };
  const erro = (e: Error) => toast.error("Não foi possível concluir", { description: e.message });

  const decidir = useMutation({
    mutationFn: (v: { id: string; aprovar: boolean; motivo?: string }) =>
      decidirSolicitacaoFn({ data: v }),
    onSuccess: (_r, v) => {
      invalidar();
      setRecusando(undefined);
      setMotivo("");
      toast.success(v.aprovar ? "Acesso concedido" : "Solicitação recusada");
    },
    onError: erro,
  });

  const conceder = useMutation({
    mutationFn: (usuarioId: string) => concederAcessoFn({ data: { projetoId, usuarioId } }),
    onSuccess: () => {
      invalidar();
      setConvidado(null);
      toast.success("Pessoa adicionada ao projeto");
    },
    onError: erro,
  });

  const revogar = useMutation({
    mutationFn: (usuarioId: string) => revogarAcessoFn({ data: { projetoId, usuarioId } }),
    onSuccess: () => {
      invalidar();
      toast.success("Acesso removido");
    },
    onError: erro,
  });

  return (
    <div className="space-y-4">
      {/* O aviso de sigilo vem antes de qualquer lista: é ele que
          explica por que esta aba existe neste projeto e não nos
          outros. */}
      <section className="panel flex items-start gap-3 p-4">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
            sigiloso ? "bg-warning/10 text-warning" : "bg-secondary text-muted-foreground"
          }`}
        >
          {sigiloso ? <Lock className="size-5" /> : <LockOpen className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {sigiloso ? "Projeto sigiloso" : "Projeto visível na carteira"}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {sigiloso
              ? "Só quem está na lista abaixo enxerga este projeto. Para os demais, ele não aparece nem pelo nome no backlog."
              : "Qualquer pessoa vê o nome deste projeto no backlog — é o que evita cadastro em duplicidade — e pode pedir acesso ao conteúdo."}
          </p>
        </div>
      </section>

      {/* ------------------------------------------------- pendências */}
      {editavel && pendentes.length > 0 ? (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            Aguardando sua decisão
            <Badge variant="outline" className="border-warning/40 text-[10px] text-warning">
              {pendentes.length}
            </Badge>
          </h3>

          {pendentes.map((s) => (
            <div
              key={s.id}
              className="panel flex flex-col gap-3 border-warning/30 p-4 sm:flex-row sm:items-start"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {iniciais(s.solicitanteNome)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.solicitanteNome ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {s.solicitanteDepartamento ?? "Sem departamento"}
                  {s.solicitanteEmail ? ` · ${s.solicitanteEmail}` : ""}
                </p>
                {s.justificativa ? (
                  <p className="mt-2 border-l-2 border-primary/40 pl-3 text-sm">
                    {s.justificativa}
                  </p>
                ) : (
                  <p className="mt-2 text-xs italic text-muted-foreground">
                    Pediu sem justificativa.
                  </p>
                )}
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="size-3" /> {desde(s.criadoEm)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={decidir.isPending}
                  onClick={() => setRecusando(s)}
                >
                  <X className="size-3.5" /> Recusar
                </Button>
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={decidir.isPending}
                  onClick={() => decidir.mutate({ id: s.id, aprovar: true })}
                >
                  <Check className="size-3.5" /> Aprovar
                </Button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* ------------------------------------------------ quem já tem */}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Com acesso concedido</h3>
          <span className="font-mono text-xs text-muted-foreground">
            {acessos.data?.length ?? 0}
          </span>
        </div>

        {editavel ? (
          <div className="flex flex-wrap items-end gap-2 border-b border-border bg-secondary/30 px-4 py-3">
            <div className="min-w-56 flex-1">
              <Label className="text-xs">Adicionar alguém sem esperar pedido</Label>
              <SeletorUsuario
                valor={convidado}
                onMudar={(v) => setConvidado(v)}
                placeholder="Digite o nome da pessoa..."
              />
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!convidado || conceder.isPending}
              onClick={() => convidado && conceder.mutate(convidado)}
            >
              <UserPlus className="size-3.5" /> Adicionar
            </Button>
          </div>
        ) : null}

        {acessos.isPending ? (
          <p className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando...
          </p>
        ) : (acessos.data?.length ?? 0) === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Ninguém além do gerente, do patrocinador e de quem tem tarefa neste projeto — esses
            entram pelo próprio vínculo e não aparecem nesta lista.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {(acessos.data ?? []).map((a) => (
              <li key={a.usuarioId} className="flex items-center gap-3 px-4 py-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold">
                  {iniciais(a.usuarioNome)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{a.usuarioNome}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {a.origem === "solicitacao" ? "Pediu e foi aprovado" : "Adicionado"}
                    {a.concedidoPorNome ? ` por ${a.concedidoPorNome}` : ""}
                  </p>
                </div>
                {editavel ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={revogar.isPending}
                    onClick={() => revogar.mutate(a.usuarioId)}
                  >
                    Remover
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------- recusa */}
      <Dialog
        open={recusando !== undefined}
        onOpenChange={(v) => {
          if (!v) {
            setRecusando(undefined);
            setMotivo("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Recusar solicitação</DialogTitle>
            <DialogDescription>
              {recusando?.solicitanteNome ?? "A pessoa"} recebe o motivo junto com a resposta.
              Recusa sem explicação vira pedido repetido na semana seguinte.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="acesso-motivo">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="acesso-motivo"
              rows={3}
              maxLength={1000}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: restrito à diretoria até o anúncio interno."
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRecusando(undefined)}
              disabled={decidir.isPending}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={decidir.isPending || motivo.trim() === ""}
              onClick={() =>
                recusando && decidir.mutate({ id: recusando.id, aprovar: false, motivo })
              }
            >
              {decidir.isPending ? "Salvando..." : "Recusar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  const a = partes[0]?.[0] ?? "?";
  const b = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase();
}

/** "há 3 dias" diz mais que a data quando o pedido está parado. */
function desde(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  const dias = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (dias <= 0) return "pedido hoje";
  if (dias === 1) return "pedido ontem";
  return `pedido há ${dias} dias`;
}
