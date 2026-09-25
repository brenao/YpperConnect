-- Rodar UMA vez no SQL Editor (local ou nuvem), depois de criar
-- seu usuario em Authentication > Users. Troque os valores entre < >.

insert into public.plataforma_admins (usuario_id)
select id from auth.users where email = '<seu-email>';

select app.provisionar_tenant(
  '<Nome da empresa>', '<slug-da-empresa>',
  (select id from auth.users where email = '<seu-email>')
);

-- Opcional: quem entrar com este dominio cai na empresa como usuario final.
-- insert into public.tenant_dominios (dominio, tenant_id, verificado)
-- select '<dominio.com.br>', id, true from public.tenants where slug = '<slug-da-empresa>';
