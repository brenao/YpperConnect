import { createServerClient } from "@supabase/ssr";
import { getCookies, setCookie } from "@tanstack/react-start/server";

/**
 * Cliente Supabase do lado do servidor. SOMENTE SERVIDOR.
 *
 * Usa a chave pública (anon) + a sessão que está nos cookies da
 * requisição. Por isso toda consulta feita com ele passa pelo RLS com a
 * identidade de quem está logado: se um repositório esquecer um filtro
 * de tenant, o banco barra mesmo assim.
 *
 * A chave service_role NUNCA entra aqui. Ela ignora o RLS e fica restrita
 * a jobs e scripts administrativos.
 *
 * Criado a cada chamada, de propósito: o cliente guarda a sessão, e
 * reaproveitá-lo entre requisições misturaria usuários diferentes.
 */
export function getSupabaseServerClient() {
  const url = process.env["SUPABASE_URL"];
  const chave = process.env["SUPABASE_ANON_KEY"];
  if (!url || !chave) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_ANON_KEY precisam estar no .env. Veja o .env.example.",
    );
  }

  return createServerClient(url, chave, {
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookies) {
        for (const c of cookies) setCookie(c.name, c.value, c.options);
      },
    },
  });
}
