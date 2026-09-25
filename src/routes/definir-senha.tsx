import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import logo from "@/assets/beagleone-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { definirSenhaFn, sessaoFn } from "@/services/sessao.functions";

/**
 * Definição de senha depois de um convite ou link de acesso.
 * Exige sessão (o guarda do __root garante): só chega aqui quem abriu
 * um link válido ou já está logado e quer trocar a senha.
 */
export const Route = createFileRoute("/definir-senha")({
  head: () => ({ meta: [{ title: "Definir senha · BeagleOne" }] }),
  component: DefinirSenha,
});

function DefinirSenha() {
  const router = useRouter();
  const sessao = useQuery({ queryKey: ["sessao"], queryFn: () => sessaoFn() });

  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha.length < 8) return setErro("Use ao menos 8 caracteres.");
    if (senha !== confirmacao) return setErro("As senhas não conferem.");

    setEnviando(true);
    try {
      const r = await definirSenhaFn({ data: { senha } });
      if (r.erro) return setErro(r.erro);
      toast.success("Senha definida");
      await router.navigate({ to: "/" });
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível salvar a senha.");
    } finally {
      setEnviando(false);
    }
  }

  const nome = sessao.data?.usuario?.nome;
  const empresa = sessao.data?.tenant?.nome;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <img src={logo} alt="BeagleOne" width={1240} height={1240} className="h-24 w-auto" />
        </div>
        <form onSubmit={aoEnviar} className="space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <h1 className="text-lg font-semibold">{nome ? `Olá, ${nome}` : "Definir senha"}</h1>
            <p className="text-sm text-muted-foreground">
              {empresa ? `Crie sua senha para acessar ${empresa}.` : "Crie sua senha de acesso."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="senha">Nova senha</Label>
            <Input
              id="senha"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmacao">Confirme a senha</Label>
            <Input
              id="confirmacao"
              type="password"
              autoComplete="new-password"
              required
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
            />
          </div>

          {erro ? (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={enviando}>
            {enviando ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar e entrar
          </Button>
        </form>
      </div>
    </div>
  );
}
