import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { listarUsuariosFn } from "@/services/cadastros.functions";
import { cn } from "@/lib/utils";

/**
 * Escolha de pessoa por digitação.
 *
 * Substitui o `Select` nos campos de gerente, patrocinador, responsável
 * por decisão e vínculo de recurso. Com a lista vinda do GLPI são mais
 * de mil nomes: rolar até achar o colega de equipe, passando por
 * representantes comerciais, é inviável — e o `Select` nativo não filtra.
 *
 * A lista tem a largura do campo, nunca mais: dentro de um diálogo com
 * rolagem vertical, qualquer filho que ultrapasse a borda cria barra
 * horizontal. Nome comprido quebra em duas linhas — cabe a quem usa o
 * componente dar largura suficiente ao campo.
 *
 * O tipo do usuário é derivado da própria server function em vez de
 * redeclarado. Foi assim que o `ProjectStatus` duplicado quebrou o build
 * três vezes nesta base; aqui a lista muda de forma e este arquivo
 * acompanha sozinho.
 */
type Usuario = Awaited<ReturnType<typeof listarUsuariosFn>>[number];

/**
 * Teto de itens desenhados.
 *
 * Mil e duzentos nós no DOM travam a digitação. Quem não achou nos
 * primeiros cinquenta precisa refinar a busca, e o rodapé diz isso em
 * vez de deixar a pessoa achando que a lista acabou.
 */
const MAX_VISIVEIS = 50;

/**
 * Mínimo de letras antes de listar.
 *
 * Abrir com a lista inteira não ajuda ninguém: são mais de mil nomes, e
 * os dez primeiros em ordem alfabética quase nunca são quem se procura.
 * Uma letra só também não filtra o suficiente — "a" traz centenas.
 */
const MIN_BUSCA = 2;

/** Ignora acento e caixa: "joao" encontra "João". */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export interface SeletorUsuarioProps {
  /** Id selecionado, ou null quando vazio. */
  valor: string | null;
  onMudar: (id: string | null, usuario?: Usuario) => void;
  placeholder?: string | undefined;
  /** Texto do item que limpa a seleção. Omitido, o campo é obrigatório. */
  rotuloVazio?: string | undefined;
  id?: string | undefined;
  disabled?: boolean | undefined;
}

export function SeletorUsuario({
  valor,
  onMudar,
  placeholder = "Digite para buscar...",
  rotuloVazio,
  id,
  disabled,
}: SeletorUsuarioProps) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [destacado, setDestacado] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const q = useQuery({ queryKey: ["usuarios"], queryFn: () => listarUsuariosFn() });

  const ativos = useMemo(() => (q.data ?? []).filter((u) => u.ativo), [q.data]);
  const selecionado = useMemo(
    () => (valor ? ativos.find((u) => u.id === valor) : undefined),
    [ativos, valor],
  );

  const filtrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (termo.length < MIN_BUSCA) return [];

    const casam = ativos.filter((u) => normalizar(u.nome).includes(termo));

    // Quem começa com o termo vem antes de quem só o contém: digitar
    // "ana" deve trazer Ana antes de Mariana.
    casam.sort((a, b) => {
      const aComeca = normalizar(a.nome).startsWith(termo) ? 0 : 1;
      const bComeca = normalizar(b.nome).startsWith(termo) ? 0 : 1;
      if (aComeca !== bComeca) return aComeca - bComeca;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
    return casam.slice(0, MAX_VISIVEIS);
  }, [ativos, busca]);

  const total = useMemo(() => {
    const termo = normalizar(busca.trim());
    if (termo.length < MIN_BUSCA) return 0;
    return ativos.filter((u) => normalizar(u.nome).includes(termo)).length;
  }, [ativos, busca]);

  const digitouPouco = normalizar(busca.trim()).length < MIN_BUSCA;

  // Fecha ao clicar fora. `mousedown` e não `click` para a lista sumir
  // antes de o clique chegar ao que está embaixo.
  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto]);

  useEffect(() => setDestacado(0), [busca]);

  function escolher(u: Usuario | null) {
    onMudar(u?.id ?? null, u ?? undefined);
    setBusca("");
    setAberto(false);
  }

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAberto(true);
      setDestacado((i) => Math.min(i + 1, filtrados.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setDestacado((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && aberto) {
      e.preventDefault();
      const alvo = filtrados[destacado];
      if (alvo) escolher(alvo);
      return;
    }
    if (e.key === "Escape") {
      setBusca("");
      setAberto(false);
    }
  }

  // Fechado, o campo mostra quem está escolhido; aberto, o que se digita.
  const textoCampo = aberto ? busca : (selecionado?.nome ?? "");

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        value={textoCampo}
        disabled={disabled}
        placeholder={selecionado && !aberto ? selecionado.nome : placeholder}
        onFocus={() => setAberto(true)}
        onChange={(e) => {
          setBusca(e.target.value);
          setAberto(true);
        }}
        onKeyDown={aoTeclar}
        className={cn("pr-16", selecionado && !aberto ? "" : "")}
        autoComplete="off"
      />

      <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {/* Limpar só aparece com algo escolhido: botão que não faz nada
            é ruído numa linha que já tem ícone. */}
        {selecionado && rotuloVazio && !disabled ? (
          <button
            type="button"
            title={rotuloVazio}
            className="rounded p-0.5 text-muted-foreground hover:text-destructive"
            onClick={() => escolher(null)}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
        {q.isPending ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        )}
      </span>

      {aberto ? (
        <div
          className={cn(
            "absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md",
            "border border-border bg-card p-1 shadow-lg",
          )}
        >
          {q.isPending ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Carregando pessoas...</p>
          ) : (
            <>
              {rotuloVazio ? (
                <button
                  type="button"
                  // `mousedown` do input dispararia o fechamento antes do
                  // clique; prevenir aqui mantém o item clicável.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher(null)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-secondary"
                >
                  {rotuloVazio}
                </button>
              ) : null}

              {filtrados.map((u, i) => (
                <button
                  key={u.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher(u)}
                  onMouseEnter={() => setDestacado(i)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                    i === destacado ? "bg-secondary" : "",
                  )}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      u.id === valor ? "text-primary" : "invisible",
                    )}
                  />
                  {/* Quebra em duas linhas em vez de cortar: nome pela
                      metade não permite escolher com segurança. */}
                  <span className="min-w-0 flex-1 break-words leading-snug">{u.nome}</span>
                </button>
              ))}

              {digitouPouco ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  Digite ao menos {MIN_BUSCA} letras do nome.
                </p>
              ) : filtrados.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  Ninguém encontrado com esse nome.
                </p>
              ) : null}

              {!digitouPouco && total > filtrados.length ? (
                <p className="border-t border-border px-2 py-1.5 text-[11px] text-muted-foreground">
                  Mostrando {filtrados.length} de {total}. Digite mais para refinar.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}