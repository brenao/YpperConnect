import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase com a chave service_role. SOMENTE SERVIDOR.
 *
 * Ignora o RLS. Por isso o uso é restrito ao que o banco não permite
 * fazer com a sessão do usuário:
 *   - criar usuário no Auth (convite) e gerar link de acesso;
 *   - procurar se um e-mail já tem conta, inclusive em outra empresa.
 *
 * Toda chamada que chega aqui já passou pela checagem de permissão
 * (`usuario.gerenciar`) em quem chamou. Gravações de negócio — vínculo
 * com o tenant, papel, equipe — continuam no cliente com a sessão do
 * usuário, para o RLS e a auditoria registrarem quem fez.
 */
export function getSupabaseAdmin() {
  const url = process.env["SUPABASE_URL"];
  const chave = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !chave) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar no .env para convidar usuários.",
    );
  }
  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
