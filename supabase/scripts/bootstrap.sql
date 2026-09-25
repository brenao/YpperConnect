-- Rodar UMA vez no SQL Editor (local ou nuvem), depois de criar
-- seu usuario em Authentication > Users. Troque o e-mail abaixo.

insert into public.plataforma_admins (usuario_id)
select id from auth.users where email = 'SEU_EMAIL@dominio.com.br';

select app.provisionar_tenant(
  'Grupo Rosset', 'rosset',
  (select id from auth.users where email = 'SEU_EMAIL@dominio.com.br')
);

-- Opcional: quem entrar com este dominio cai no tenant como solicitante.
-- insert into public.tenant_dominios (dominio, tenant_id, verificado)
-- select 'rosset.com.br', id, true from public.tenants where slug = 'rosset';
