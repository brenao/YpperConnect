import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import logo from "@/assets/beagleone-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { entrarFn, sairFn, sessaoFn } from "@/services/sessao.functions";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Entrar · BeagleOne" }] }),
  /**
   * Quem já está logado e tem empresa não precisa ver o login.
   * "sem_tenant" fica aqui: a tela mostra o aviso e o botão de sair.
   */
  beforeLoad: async () => {
    const sessao = await sessaoFn();
    if (sessao.estado === "ok") throw redirect({ to: "/" });
    return { sessao };
  },
  component: LoginPage,
});

function LoginPage() {
  const { sessao } = Route.useRouteContext();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await entrarFn({ data: { email, senha } });
      if (r.erro) {
        setErro(r.erro);
        return;
      }
      // Descarta o que ficou em cache de outra sessão antes de entrar.
      queryClient.clear();
      await router.invalidate();
      await router.navigate({ to: "/" });
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível entrar.");
    } finally {
      setEnviando(false);
    }
  }

  async function aoSair() {
    await sairFn();
    queryClient.clear();
    await router.invalidate();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <img src={logo} alt="BeagleOne" width={1240} height={1240} className="h-24 w-auto" />
        </div>

        {sessao.estado === "sem_tenant" ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <h1 className="text-lg font-semibold">Olá, {sessao.usuario?.nome}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Seu usuário ainda não está vinculado a nenhuma empresa. Peça acesso ao administrador
              da sua empresa.
            </p>
            <Button variant="outline" className="mt-6 w-full" onClick={aoSair}>
              Sair
            </Button>
          </div>
        ) : (
          <form
            onSubmit={aoEnviar}
            className="space-y-4 rounded-lg border border-border bg-card p-6"
          >
            <div>
              <h1 className="text-lg font-semibold">Entrar</h1>
              <p className="text-sm text-muted-foreground">Acesse com seu e-mail e senha.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                autoComplete="current-password"
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </div>

            {erro ? (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? <Loader2 className="size-4 animate-spin" /> : null}
              Entrar
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
