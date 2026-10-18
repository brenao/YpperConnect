-- Esqueci minha senha: registro dos pedidos, so para limitar abuso
-- (muitos e-mails para a mesma pessoa, ou um IP disparando pedidos).
-- Guarda hash do e-mail e do IP, nunca o valor. Sem policies: so o
-- service_role (servidor) le e grava.

create table public.recuperacoes_senha (
  id         bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash    text,
  criado_em  timestamptz not null default now()
);
create index recuperacoes_senha_email_idx on public.recuperacoes_senha (email_hash, criado_em desc);
create index recuperacoes_senha_ip_idx on public.recuperacoes_senha (ip_hash, criado_em desc);

alter table public.recuperacoes_senha enable row level security;
revoke all on public.recuperacoes_senha from anon, authenticated;

-- Registra o pedido e diz se pode enviar: ate 3 por e-mail e 10 por IP
-- por hora. Atomico (advisory lock por e-mail) para pedidos simultaneos.
create or replace function public.registrar_recuperacao_senha(p_email_hash text, p_ip_hash text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_por_email int;
  v_por_ip    int;
begin
  perform pg_advisory_xact_lock(hashtext(p_email_hash));

  -- Limpeza: pedidos com mais de 1 dia nao servem para nada.
  delete from public.recuperacoes_senha where criado_em < now() - interval '1 day';

  select count(*) into v_por_email from public.recuperacoes_senha
   where email_hash = p_email_hash and criado_em > now() - interval '1 hour';
  select count(*) into v_por_ip from public.recuperacoes_senha
   where p_ip_hash is not null and ip_hash = p_ip_hash and criado_em > now() - interval '1 hour';

  if v_por_email >= 3 or v_por_ip >= 10 then
    return false;
  end if;

  insert into public.recuperacoes_senha (email_hash, ip_hash) values (p_email_hash, p_ip_hash);
  return true;
end $$;
revoke all on function public.registrar_recuperacao_senha(text, text) from public, anon, authenticated;
grant execute on function public.registrar_recuperacao_senha(text, text) to service_role;
