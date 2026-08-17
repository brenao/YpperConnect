/**
 * Painel da baseline: versão vigente, alerta quando não existe, registro
 * de nova versão com justificativa e histórico das anteriores.
 *
 * A justificativa é obrigatória a partir da segunda versão. A primeira é
 * só congelar o plano; da segunda em diante alguém replanejou, e quem
 * cobra prazo precisa saber por quê.
 */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmt } from "@/lib/datas";
import { cn } from "@/lib/utils";
import type { Baseline } from "@/repositories/projetos.repo";
import { salvarBaselineFn, tarefasDaBaselineFn } from "@/services/projetos.functions";
import type { EstadoBaseline } from "@/services/projeto-metricas";

export function ProjectBaseline({
  projetoId,
  baselines,
  estado,
  editavel,
  onSalvo,
}: {
  projetoId: string;
  baselines: Baseline[];
  estado: EstadoBaseline;
  editavel: boolean;
  onSalvo: () => void;
}) {
  const [dialogo, setDialogo] = useState(false);
  const [historico, setHistorico] = useState(false);
  const [justificativa, setJustificativa] = useState("");

  const atual = baselines[0];
  const primeira = baselines.length === 0;

  const salvar = useMutation({
    mutationFn: (descricao: string | null) => salvarBaselineFn({ data: { projetoId, descricao } }),
    onSuccess: () => {
      setDialogo(false);
      setJustificativa("");
      onSalvo();
      toast.success("Baseline registrada", {
        description: "As datas atuais viraram a referência de comparação.",
      });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  function confirmar() {
    if (!primeira && justificativa.trim().length < 10) {
      toast.error("Descreva o motivo do replanejamento (mínimo 10 caracteres).");
      return;
    }
    salvar.mutate(justificativa.trim() || null);
  }

  const mudancas = [
    estado.alteradas > 0 ? `${estado.alteradas} com data alterada` : "",
    estado.novas > 0 ? `${estado.novas} nova(s)` : "",
    estado.removidas > 0 ? `${estado.removidas} removida(s)` : "",
  ].filter(Boolean);

  return (
    <section className={cn("panel p-4", primeira ? "border-warning/40" : "")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Baseline</p>

          {primeira ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              Nenhuma baseline registrada — não há como medir desvio de prazo.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm font-medium">
                v{atual?.versao} · {fmt(atual?.criadoEm)}
                {atual?.autorNome ? (
                  <span className="font-normal text-muted-foreground"> · {atual.autorNome}</span>
                ) : null}
              </p>
              {atual?.descricao ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{atual.descricao}</p>
              ) : null}
              {mudancas.length > 0 ? (
                <p className="mt-1 text-xs text-warning">
                  Cronograma mudou desde então: {mudancas.join(", ")}.
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Cronograma igual à baseline vigente.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {baselines.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => setHistorico(true)}
            >
              <History className="size-3.5" /> Histórico
            </Button>
          ) : null}
          {editavel ? (
            <Button
              size="sm"
              variant={primeira || estado.precisaNovaBaseline ? "default" : "outline"}
              disabled={!primeira && !estado.precisaNovaBaseline}
              title={
                !primeira && !estado.precisaNovaBaseline
                  ? "Sem mudanças no cronograma desde a última baseline"
                  : undefined
              }
              onClick={() => setDialogo(true)}
            >
              {primeira ? "Salvar baseline" : "Nova baseline"}
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={dialogo} onOpenChange={setDialogo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{primeira ? "Salvar baseline" : "Registrar nova baseline"}</DialogTitle>
            <DialogDescription>
              {primeira
                ? "Congela o cronograma atual como plano de referência. É contra ele que o desvio de prazo passa a ser medido."
                : "A baseline anterior continua guardada. Explique o que motivou o replanejamento."}
            </DialogDescription>
          </DialogHeader>

          {!primeira ? (
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="justificativa-baseline">
                Motivo do replanejamento
              </label>
              <Textarea
                id="justificativa-baseline"
                rows={3}
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                placeholder="Ex.: fornecedor antecipou a entrega e o escopo da fase 2 foi ampliado"
              />
              {mudancas.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Serão congeladas as datas atuais: {mudancas.join(", ")}.
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogo(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistoricoBaselines
        aberto={historico}
        onFechar={() => setHistorico(false)}
        baselines={baselines}
      />
    </section>
  );
}

/** Lista de versões com as tarefas congeladas na escolhida. */
function HistoricoBaselines({
  aberto,
  onFechar,
  baselines,
}: {
  aberto: boolean;
  onFechar: () => void;
  baselines: Baseline[];
}) {
  const [selecionada, setSelecionada] = useState<string | null>(null);

  const tarefas = useQuery({
    queryKey: ["baseline-tarefas", selecionada],
    queryFn: () => tarefasDaBaselineFn({ data: { baselineId: selecionada ?? "" } }),
    enabled: aberto && selecionada !== null,
  });

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) {
          setSelecionada(null);
          onFechar();
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Histórico de baselines</DialogTitle>
          <DialogDescription>
            Cada versão guarda as datas de todas as tarefas no momento em que foi registrada.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <ul className="space-y-1">
            {baselines.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setSelecionada(b.id)}
                  className={cn(
                    "w-full rounded-lg border p-2 text-left text-xs transition-colors",
                    selecionada === b.id
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:border-primary/30",
                  )}
                >
                  <span className="font-medium">v{b.versao}</span>
                  <span className="text-muted-foreground"> · {fmt(b.criadoEm)}</span>
                  {b.autorNome ? (
                    <span className="block text-[11px] text-muted-foreground">{b.autorNome}</span>
                  ) : null}
                  {b.descricao ? <span className="mt-1 block">{b.descricao}</span> : null}
                </button>
              </li>
            ))}
          </ul>

          <div className="min-h-40 rounded-lg border border-border p-3">
            {selecionada === null ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Escolha uma versão para ver o cronograma congelado.
              </p>
            ) : tarefas.isPending ? (
              <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Carregando...
              </p>
            ) : tarefas.error ? (
              <p className="py-12 text-center text-sm text-destructive">
                Não foi possível carregar esta versão.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pb-1 font-medium">Tarefa</th>
                      <th className="w-24 pb-1 font-medium">Início</th>
                      <th className="w-24 pb-1 font-medium">Término</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tarefas.data?.tarefas ?? []).map((t) => (
                      <tr key={t.tarefaId} className="border-t border-border/60">
                        <td className="py-1 pr-2">{t.nome}</td>
                        <td className="py-1 font-mono">{fmt(t.inicio)}</td>
                        <td className="py-1 font-mono">{fmt(t.fim)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(tarefas.data?.tarefas ?? []).length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    Esta baseline foi registrada sem tarefas.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
