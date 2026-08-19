import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Send, Sparkles, TicketPlus } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/views/app-shell";
import { AiTicketDraft } from "@/views/ai-ticket-draft";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { listarServicosFn } from "@/services/cadastros.functions";
import { draftTicketFromConversation, type TicketDraft } from "@/services/ai-triage.functions";

/**
 * Marcador emitido pela IA quando já tem informação suficiente.
 * Precisa ser idêntico ao definido em src/routes/api/chat.ts.
 */
const MARCADOR_PRONTO = "[[ABRIR_CHAMADO]]";

export const Route = createFileRoute("/assistente")({
  head: () => ({
    meta: [
      { title: "Assistente IA de atendimento · Beagle One" },
      {
        name: "description",
        content:
          "IA conversacional que coleta informações, sugere classificação e prioridade e direciona o chamado para a equipe responsável.",
      },
      { property: "og:title", content: "Assistente IA de atendimento · Beagle One" },
      {
        property: "og:description",
        content: "Abertura de chamados guiada por IA com sugestão de categoria e prioridade.",
      },
    ],
  }),
  component: Assistente,
});

const SUGESTOES = [
  "O ERP está fora do ar para toda a equipe fiscal",
  "Preciso de acesso ao Power BI para um novo analista",
  "A VPN cai várias vezes por dia nesta semana",
  "Quero sugerir uma melhoria no relatório de chamados",
];

/** Remove o marcador antes de exibir: ele é protocolo, não conteúdo. */
function limparMarcador(texto: string): string {
  return texto.split(MARCADOR_PRONTO).join("").trimEnd();
}

function Assistente() {
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [criado, setCriado] = useState<string | null>(null);
  const [descartado, setDescartado] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // O catálogo alimenta o prompt: a IA só pode sugerir serviço que existe.
  const servicos = useQuery({ queryKey: ["servicos"], queryFn: () => listarServicosFn() });
  const gerarRascunho = useServerFn(draftTicketFromConversation);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    onError: (error) =>
      toast.error("Não foi possível falar com o assistente", { description: error.message }),
  });

  const loading = status === "submitted" || status === "streaming";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status, draft]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  function textoDe(m: (typeof messages)[number]): string {
    return m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  }

  const conversa = messages
    .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${limparMarcador(textoDe(m))}`)
    .join("\n\n")
    .slice(-8000);

  const estruturarChamado = useCallback(
    async (automatico = false) => {
      if (conversa.trim().length < 10 || drafting) return;
      setDrafting(true);
      setCriado(null);
      try {
        const result = await gerarRascunho({
          data: {
            conversa,
            servicos: (servicos.data ?? []).map((s) => s.nome).slice(0, 60),
          },
        });
        setDraft(result);
      } catch (error) {
        // Falha silenciosa no modo automático: o usuário ainda tem o
        // botão manual, e um toast de erro que ele não pediu incomoda.
        if (!automatico) {
          toast.error("Não foi possível estruturar o chamado", {
            description: error instanceof Error ? error.message : undefined,
          });
        }
      } finally {
        setDrafting(false);
      }
    },
    [conversa, drafting, gerarRascunho, servicos.data],
  );

  /**
   * Proatividade: quando a IA termina de responder emitindo o marcador,
   * o rascunho é montado sozinho. O usuário confirma ou descarta — não
   * precisa clicar em nada para a proposta aparecer.
   *
   * `descartado` impede que a proposta reapareça depois de recusada,
   * já que o marcador continua no histórico da conversa.
   */
  useEffect(() => {
    if (loading || draft || drafting || criado || descartado) return;

    const ultima = [...messages].reverse().find((m) => m.role === "assistant");
    if (!ultima) return;
    if (!textoDe(ultima).includes(MARCADOR_PRONTO)) return;

    void estruturarChamado(true);
    // textoDe é estável o suficiente para o escopo deste efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, loading, draft, drafting, criado, descartado, estruturarChamado]);

  function submit(text: string) {
    const value = text.trim();
    if (!value || loading) return;
    void sendMessage({ text: value.slice(0, 2000) });
    setInput("");
    setCriado(null);
    // Nova mensagem reabre a possibilidade de proposta automática.
    setDescartado(false);
  }

  return (
    <AppShell
      title="Assistente IA de atendimento"
      subtitle="Coleta as informações, sugere categoria e prioridade e direciona o chamado à equipe responsável"
    >
      <div className="mx-auto flex h-[calc(100vh-11rem)] max-w-3xl flex-col">
        <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="mx-auto max-w-md py-10 text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-xl bg-hero ring-1 ring-primary/40">
                  <Sparkles className="size-5 text-primary" />
                </span>
                <h2 className="mt-4 text-base font-semibold">Descreva o que está acontecendo</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  A IA classifica o registro, aplica a matriz de prioridade e propõe a abertura
                  assim que entender o caso. Registros do tipo Problema seguem exclusivos da equipe
                  de TI.
                </p>
                <div className="mt-5 grid gap-2 text-left">
                  {SUGESTOES.map((s) => (
                    <button
                      key={s}
                      onClick={() => submit(s)}
                      className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((m) => {
              const texto = limparMarcador(textoDe(m)).trim();
              if (!texto) return null;
              return (
                <div
                  key={m.id}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-line rounded-xl px-4 py-3 text-sm",
                      m.role === "user"
                        ? "bg-primary/15 text-foreground"
                        : "border border-border bg-surface text-muted-foreground",
                    )}
                  >
                    {texto}
                  </div>
                </div>
              );
            })}

            {status === "submitted" ? (
              <div className="flex justify-start">
                <div className="rounded-xl border border-border bg-surface px-4 py-3">
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="size-1.5 animate-pulse rounded-full bg-primary"
                        style={{ animationDelay: `${i * 150}ms` }}
                      />
                    ))}
                  </span>
                </div>
              </div>
            ) : null}

            {drafting && !draft ? (
              <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-surface px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                Montando a proposta de chamado...
              </div>
            ) : null}

            {draft ? (
              <AiTicketDraft
                draft={draft}
                onDismiss={() => {
                  setDraft(null);
                  setDescartado(true);
                }}
                onCreated={(codigo) => {
                  setDraft(null);
                  setCriado(codigo);
                }}
              />
            ) : null}

            {criado ? (
              <div className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
                Chamado <strong className="font-mono">{criado}</strong> registrado pelo assistente e
                enviado para a fila de atendimento.
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="border-t border-border p-4">
            {/* Atalho manual: a proposta automática cobre o caso normal,
                mas o usuário pode forçar a qualquer momento. */}
            {messages.length > 0 && !draft && !drafting ? (
              <div className="mb-3">
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-2 text-muted-foreground"
                  disabled={loading}
                  onClick={() => void estruturarChamado(false)}
                >
                  <TicketPlus className="size-4" />
                  Abrir chamado agora
                </Button>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                rows={2}
                maxLength={2000}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(input);
                  }
                }}
                placeholder="Descreva o problema ou a solicitação..."
                className="resize-none"
              />
              <Button size="icon" disabled={loading} onClick={() => submit(input)}>
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
