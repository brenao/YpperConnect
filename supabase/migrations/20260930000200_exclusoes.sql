-- =====================================================================
-- Exclusao de cadastro errado
--
-- 1. Sistema: o administrador da empresa exclui pela tela, enquanto
--    nenhum chamado usar o sistema. Quando a tabela de chamados existir,
--    a FK dela barra a exclusao sozinha (erro 23503) e a tela orienta a
--    desativar. A exclusao fica registrada na auditoria.
--
-- 2. Empresa: so o operador da plataforma, pelo terminal, como a
--    criacao. Apaga tudo da empresa (cascata). As contas de login
--    continuam: a pessoa pode estar em outras empresas.
-- =====================================================================

create policy sistemas_excluir on public.sistemas for delete to authenticated
  using (app.tem_permissao(tenant_id, 'admin.sistemas'));

create or replace function app.excluir_empresa(p_slug text, p_confirmacao text)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id   uuid;
  v_nome text;
begin
  if p_confirmacao is distinct from p_slug then
    raise exception 'Confirmacao nao confere. Repita o slug exato da empresa.';
  end if;

  select id, nome into v_id, v_nome from public.tenants where slug = lower(p_slug);
  if v_id is null then
    raise exception 'Empresa com slug "%" nao encontrada.', p_slug;
  end if;

  delete from public.tenants where id = v_id;
  return format('Empresa "%s" (%s) excluida.', v_nome, p_slug);
end $$;

revoke all on function app.excluir_empresa(text, text) from public, anon, authenticated;
