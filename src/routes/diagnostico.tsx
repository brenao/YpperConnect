import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { listarEquipesFn, listarPerfisFn, usuarioAtualFn } from "@/services/cadastros.functions";
import { criarChamadoFn, listarChamadosFn } from "@/services/chamados.functions";

export const Route = createFileRoute("/diagnostico")({ component: Diagnostico });

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="mb-2 text-sm font-semibold text-foreground">{titulo}</h2>
      <div className="space-y-1 text-xs text-muted-foreground">{children}</div>
    </section>
  );
}

function Diagnostico() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string>("");

  const usuario = useQuery({ queryKey: ["usuario-atual"], queryFn: () => usuarioAtualFn() });
  const equipes = useQuery({ queryKey: ["equipes"], queryFn: () => listarEquipesFn() });
  const perfis = useQuery({ queryKey: ["perfis"], queryFn: () => listarPerfisFn() });
  const chamados = useQuery({
    queryKey: ["chamados"],
    queryFn: () => listarChamadosFn({ data: { limite: 20 } }),
  });

  const criar = useMutation({
    mutationFn: () =>
      criarChamadoFn({
        data: {
          titulo: "Chamado de teste da camada Oracle",
          descricao: "Criado pela rota /diagnostico para validar a integração ponta a ponta.",
          tipo: "incidente",
          impacto: "medio",
          urgencia: "media",
          origem: "portal",
        },
      }),
    onSuccess: (r) => {
      setMsg(`Chamado criado: #${r.numero}`);
      qc.invalidateQueries({ queryKey: ["chamados"] });
    },
    onError: (e: Error) => setMsg(`Erro: ${e.message}`),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Diagnóstico da camada Oracle</h1>

      <Bloco titulo="Usuário atual (getUsuarioAtual)">
        {usuario.isPending && "carregando..."}
        {usuario.error && <span className="text-red-500">{String(usuario.error)}</span>}
        {usuario.data && (
          <pre className="overflow-auto">{JSON.stringify(usuario.data, null, 2)}</pre>
        )}
      </Bloco>

      <Bloco titulo={`Equipes (${equipes.data?.length ?? 0})`}>
        {equipes.error && <span className="text-red-500">{String(equipes.error)}</span>}
        {equipes.data?.map((e) => (
          <div key={e.id}>
            {e.id} · {e.nome}
          </div>
        ))}
      </Bloco>

      <Bloco titulo={`Perfis (${perfis.data?.length ?? 0})`}>
        {perfis.error && <span className="text-red-500">{String(perfis.error)}</span>}
        {perfis.data?.map((p) => (
          <div key={p.id}>
            {p.nome} · {p.modulos.length} módulos · {p.funcionalidades.length} funcionalidades
          </div>
        ))}
      </Bloco>

      <Bloco titulo={`Chamados (${chamados.data?.length ?? 0})`}>
        {chamados.error && <span className="text-red-500">{String(chamados.error)}</span>}
        {chamados.data?.map((c) => (
          <div key={c.id}>
            #{c.numero} · {c.titulo} · {c.prioridade} · {c.status} · prazo{" "}
            {new Date(c.prazoSla).toLocaleString("pt-BR")}
          </div>
        ))}
      </Bloco>

      <div className="flex items-center gap-3">
        <button
          onClick={() => criar.mutate()}
          disabled={criar.isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {criar.isPending ? "Criando..." : "Criar chamado de teste"}
        </button>
        {msg && <span className="text-xs">{msg}</span>}
      </div>
    </div>
  );
}
