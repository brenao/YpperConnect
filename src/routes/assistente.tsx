import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, TicketPlus } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/views/app-shell";
import { AiTicketDraft } from "@/views/ai-ticket-draft";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useItsm } from "@/controllers/itsm-store";
import { draftTicketFromConversation, type TicketDraft } from "@/services/ai-triage.functions";

export const Route = createFileRoute("/assistente")({
  head: () => ({
    meta: [
      { title: "Assistente IA de atendimento · YpperConnect" },
      {
        name: "description",
        content:
          "IA conversacional que coleta informações, sugere classificação e prioridade e direciona o chamado para a equipe responsável.",
      },
      { property: "og:title", content: "Assistente IA de atendimento · YpperConnect" },
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

function Assistente() {
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [criado, setCriado] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const { services } = useItsm();
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

  function submit(text: string) {
    const value = text.trim();
    if (!value || loading) return;
    void sendMessage({ text: value.slice(0, 2000) });
    setInput("");
    setCriado(null);
  }

  const conversa = messages
    .map((m) => {
      const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
      return `${m.role === "user" ? "Usuário" : "Assistente"}: ${text}`;
    })
    .join("\n\n")
    .slice(-8000);

  async function estruturarChamado() {
    if (conversa.trim().length < 10) return;
    setDrafting(true);
    setCriado(null);
    try {
      const result = await gerarRascunho({
        data: { conversa, servicos: services.map((s) => s.nome).slice(0, 60) },
      });
      setDraft(result);
    } catch (error) {
      toast.error("Não foi possível estruturar o chamado", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDrafting(false);
    }
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
                  A IA classifica o registro, aplica a matriz de prioridade e orienta o próximo
                  passo. Registros do tipo Problema seguem exclusivos da equipe de TI.
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
              const text = m.parts
                .map((p) => (p.type === "text" ? p.text : ""))
                .join("")
                .trim();
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
                    {text}
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

            {draft ? (
              <AiTicketDraft
                draft={draft}
                onDismiss={() => setDraft(null)}
                onCreated={(id) => {
                  setDraft(null);
                  setCriado(id);
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
            {messages.length > 0 && !draft ? (
              <div className="mb-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={drafting || loading}
                  onClick={() => void estruturarChamado()}
                >
                  {drafting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <TicketPlus className="size-4" />
                  )}
                  Abrir chamado com base nesta conversa
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
