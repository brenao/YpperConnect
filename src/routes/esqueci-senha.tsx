import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import logo from "@/assets/beagleone-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { esqueciSenhaFn } from "@/services/sessao.functions";

export const Route = createFileRoute("/esqueci-senha")({
  head: () => ({ meta: [{ title: "Esqueci minha senha · BeagleOne" }] }),
  component: EsqueciSenha,
});

function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await esqueciSenhaFn({ data: { email } });
      setEnviado(true);
    } catch {
      setErro("Não foi possível enviar agora. Tente de novo em instantes.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <img src={logo} alt="BeagleOne" width={1240} height={1240} className="h-24 w-auto" />
        </div>

        {enviado ? (
          <div className="space-y-3 rounded-lg border border-border bg-card p-6 text-center">
            <MailCheck className="mx-auto size-8 text-primary" />
            <h1 className="text-lg font-semibold">Confira seu e-mail</h1>
            <p className="text-sm text-muted-foreground">
              Se <strong>{email.trim().toLowerCase()}</strong> tiver cadastro, enviamos um link para
              criar uma senha nova. Ele vale uma vez e expira em 1 hora.
            </p>
            <p className="text-xs text-muted-foreground">
              Não chegou? Veja o spam ou aguarde alguns minutos antes de pedir de novo.
            </p>
            <Link to="/login" className="inline-block text-sm text-primary hover:underline">
              Voltar ao login
            </Link>
          </div>
        ) : (
          <form
            onSubmit={aoEnviar}
            className="space-y-4 rounded-lg border border-border bg-card p-6"
          >
            <div>
              <h1 className="text-lg font-semibold">Esqueci minha senha</h1>
              <p className="text-sm text-muted-foreground">
                Informe seu e-mail. Enviaremos um link para criar uma senha nova. Serve também para
                quem ainda não criou a senha.
              </p>
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
            {erro ? (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? <Loader2 className="size-4 animate-spin" /> : null}
              Enviar link
            </Button>
            <Link
              to="/login"
              className="block text-center text-sm text-muted-foreground hover:underline"
            >
              Voltar ao login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
