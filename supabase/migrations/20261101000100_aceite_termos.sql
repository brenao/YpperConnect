-- Aceite dos Termos de uso e da Politica de privacidade na contratacao.
--
-- Prova do aceite: quem aceitou (conta e e-mail), em qual empresa, qual
-- versao dos documentos, quando, de qual IP e navegador.
--
-- O registro e imutavel (sem update nem delete, nem pelo service_role) e
-- nao tem chave estrangeira: precisa sobreviver a exclusao da empresa ou
-- da conta, porque serve de prova em caso de disputa (LGPD, art. 16, II,
-- e art. 7, VI: exercicio regular de direitos).
--
-- Quem grava e a checkout_criar_empresa, na mesma transacao que cria a
-- empresa: ou as duas coisas acontecem, ou nenhuma. O servidor so chama a
-- funcao com o aceite marcado (checkout.functions.ts).

create table public.aceites_termos (
  id          bigint generated always as identity primary key,
  tenant_id   uuid,
  usuario_id  uuid not null,
  email       text not null,
  documentos  text[] not null default array['termos', 'privacidade'],
  versao      text not null check (versao ~ '^\d{4}-\d{2}-\d{2}$'),
  origem      text not null default 'checkout' check (origem in ('checkout')),
  ip          text,
  user_agent  text,
  aceito_em   timestamptz not null default now()
);
create index aceites_termos_tenant_idx on public.aceites_termos (tenant_id, aceito_em desc);
create index aceites_termos_usuario_idx on public.aceites_termos (usuario_id, aceito_em desc);

alter table public.aceites_termos enable row level security;
revoke all on public.aceites_termos from anon, authenticated;
grant select on public.aceites_termos to authenticated;
grant select, insert on public.aceites_termos to service_role;

-- O administrador da empresa consulta os aceites da propria empresa.
create policy aceites_ler on public.aceites_termos for select to authenticated
  using (tenant_id is not null and app.tem_permissao(tenant_id, 'admin.usuarios'));

create or replace function app.aceite_imutavel() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Registro de aceite nao pode ser alterado nem excluido.' using errcode = '42501';
end $$;

create trigger tg_aceites_termos_imutavel before update or delete on public.aceites_termos
  for each row execute function app.aceite_imutavel();

-- ---------------------------------------------------------------------
-- Checkout: mesma funcao de 20261020000100, com o registro do aceite.
-- ---------------------------------------------------------------------
drop function public.checkout_criar_empresa(text, text, uuid, text, text, integer, boolean, text, text);

create or replace function public.checkout_criar_empresa(
  p_nome text, p_slug text, p_admin uuid, p_plano text, p_ciclo text,
  p_usuarios integer, p_addon_ia boolean, p_visitante text, p_cupom text default null,
  p_versao_termos text default null, p_ip text default null, p_user_agent text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant   uuid;
  v_afiliado uuid;
  v_desconto numeric(5,2) := 0;
  v_cupom    text;
  v_email    text;
  f          record;
begin
  if exists (select 1 from public.tenants where slug = lower(p_slug) and excluido_em is null) then
    raise exception 'Ja existe uma empresa com o endereco "%".', p_slug using errcode = '23505';
  end if;
  if not exists (select 1 from public.planos where codigo = p_plano and ativo) then
    raise exception 'Plano invalido.' using errcode = 'P0001';
  end if;

  select email into v_email from public.usuarios where id = p_admin;

  if nullif(trim(coalesce(p_cupom, '')), '') is not null then
    select id, codigo, email, desconto_pct into f
      from public.afiliados
     where upper(codigo) = upper(trim(p_cupom)) and ativo;
    if f.id is null then
      raise exception 'Cupom "%" não encontrado ou inativo.', upper(trim(p_cupom))
        using errcode = '22023';
    end if;
    if lower(coalesce(v_email, '')) = lower(f.email) then
      raise exception 'Não é possível usar o próprio cupom.' using errcode = '22023';
    end if;
    v_afiliado := f.id;
    v_desconto := f.desconto_pct;
    v_cupom    := f.codigo;
  elsif p_visitante is not null then
    -- Sem cupom digitado: vale o ultimo clique em link (90 dias), sem desconto.
    v_afiliado := app.afiliado_do_visitante(p_visitante);
  end if;

  v_tenant := app.provisionar_tenant(trim(p_nome), lower(trim(p_slug)), p_admin);

  update public.assinaturas set
    plano_codigo = p_plano, ciclo = p_ciclo, usuarios_contratados = greatest(p_usuarios, 3),
    addon_ia = p_addon_ia, afiliado_id = v_afiliado,
    atribuido_em = case when v_afiliado is not null then now() end,
    cupom = v_cupom, desconto_pct = v_desconto
   where tenant_id = v_tenant;

  if nullif(trim(coalesce(p_versao_termos, '')), '') is not null then
    insert into public.aceites_termos (tenant_id, usuario_id, email, versao, ip, user_agent)
    values (v_tenant, p_admin, coalesce(v_email, ''), trim(p_versao_termos),
            left(nullif(trim(coalesce(p_ip, '')), ''), 64),
            left(nullif(trim(coalesce(p_user_agent, '')), ''), 500));
  end if;

  return v_tenant;
end $$;

revoke all on function public.checkout_criar_empresa(text, text, uuid, text, text, integer, boolean, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.checkout_criar_empresa(text, text, uuid, text, text, integer, boolean, text, text, text, text, text)
  to service_role;