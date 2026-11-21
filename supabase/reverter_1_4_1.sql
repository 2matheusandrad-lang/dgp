-- =====================================================================
-- REVERSÃO DA VERSÃO 1.4.1 (volta às regras de acesso da 1.4)
-- Não apaga dados. As OMEs voltam a incluir, transferir, lançar férias, situações
-- funcionais e punições e a mandar pedidos à DGP; o pecúlio geral sai.
-- =====================================================================
set client_min_messages = warning;
begin;
do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.4.1') then
    raise exception 'A versão 1.4.1 não está aplicada neste banco.';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.5') then
    raise exception 'Reverta antes a versão 1.5 (supabase/reverter_1_5.sql).';
  end if;
end $$;

create or replace function pg_temp.trocar(p_funcao text, p_de text, p_para text) returns void
language plpgsql as $$
declare d text;
begin
  if to_regproc(p_funcao) is null then raise exception 'Função % não encontrada (ou duplicada).', p_funcao; end if;
  d := pg_get_functiondef(to_regproc(p_funcao));
  if position(p_de in d) = 0 then
    raise exception 'Função %: trecho esperado não encontrado. Nada foi alterado.', p_funcao;
  end if;
  execute replace(d, p_de, p_para);
end $$;


select pg_temp.trocar('aplicar_lote',
  $x$      atividade   = case when x ? 'atividade'   then nullif(x->>'atividade', '')::atividade_tipo else atividade end,
$x$,
  $x$      atividade   = case when x ? 'atividade'   then nullif(x->>'atividade', '')::atividade_tipo else atividade end,
      nome_guerra = case when x ? 'nome_guerra' then nullif(x->>'nome_guerra', '') else nome_guerra end,
$x$);
select pg_temp.trocar('trg_militar_antes',
  $x$'Posto/graduação, quadro, nome, nome de guerra, matrícula, nº funcional, sexo, nascimento, antiguidade, ano e data de ingresso, data de promoção e órgão de cessão são mantidos pela DGP.'$x$,
  $x$'Posto/graduação, quadro, nome, matrícula, nº funcional, sexo, nascimento, antiguidade, datas de ingresso e de promoção e órgão de cessão são mantidos pela DGP. Use "Pedir correção à DGP" na ficha.'$x$);
select pg_temp.trocar('trg_militar_antes',
  $x$or new.nome is distinct from old.nome or new.nome_guerra is distinct from old.nome_guerra
            or new.ano_ingresso is distinct from old.ano_ingresso or new.matricula is distinct from old.matricula$x$,
  $x$or new.nome is distinct from old.nome or new.matricula is distinct from old.matricula$x$);
select pg_temp.trocar('ferias_excluir_periodo',
  $x$if not e_gestao_global() then$x$,
  $x$if not (e_gestao_global() or (f.situacao = 'PROPOSTA' and pode_editar_ome(ferias_ome_pessoa(f.militar_id, f.civil_id)))) then$x$);
select pg_temp.trocar('ferias_decidir_reprogramacao',
  $x$if not e_gestao_global() then raise exception 'Somente a DGP trata reprogramações.'; end if;$x$,
  $x$if not pode_editar_ome(s.ome_id) then raise exception 'Sem permissão.'; end if;$x$);
select pg_temp.trocar('ferias_reprogramar',
  $x$if v_ome is null or not e_gestao_global() then raise exception 'Férias são lançadas e alteradas somente pela DGP.'; end if;$x$,
  $x$if v_ome is null or not pode_editar_ome(v_ome) then raise exception 'Sem permissão para esta OME.'; end if;$x$);
select pg_temp.trocar('ferias_propor',
  $x$if v_ome is null or not e_gestao_global() then raise exception 'Férias são lançadas e alteradas somente pela DGP.'; end if;$x$,
  $x$if v_ome is null or not pode_editar_ome(v_ome) then raise exception 'Sem permissão para esta OME.'; end if;$x$);
select pg_temp.trocar('decidir_solicitacao',
  $x$if not e_gestao_global() then raise exception 'Somente a DGP trata pedidos.'; end if;$x$,
  $x$if not (pode_editar_ome(s.ome_id)) then raise exception 'Sem permissão.'; end if;$x$);
select pg_temp.trocar('solicitar_correcao',
  $x$if not e_gestao_global() then raise exception 'Os dados oficiais são corrigidos somente pela DGP.'; end if;$x$,
  $x$if not pode_editar_ome(v_m.ome_id) then raise exception 'Sem permissão para esta OME.'; end if;$x$);
select pg_temp.trocar('solicitar_desligamento',
  $x$if not e_gestao_global() then raise exception 'Desligamento é tratado somente pela DGP.'; end if;$x$,
  $x$if not pode_editar_ome(v_ome) then raise exception 'Sem permissão para esta OME.'; end if;$x$);
select pg_temp.trocar('receber_militar',
  $x$if not e_gestao_global() then
    raise exception 'Transferência é registrada somente pela DGP.';$x$,
  $x$if not pode_editar_ome(p_ome_destino) then
    raise exception 'Sem permissão para incluir militares nesta OME.';$x$);
select pg_temp.trocar('transferir_militar',
  $x$if not e_gestao_global() then
    raise exception 'Transferência é registrada somente pela DGP.';$x$,
  $x$if not (pode_editar_ome(v_origem) or pode_editar_ome(p_ome_destino)) then
    raise exception 'Sem permissão: apenas a OME de origem, a de destino ou a DGP podem transferir.';$x$);

drop policy if exists militar_inserir on militar;
create policy militar_inserir on militar for insert to authenticated with check (pode_editar_ome(ome_id));
drop policy if exists movimentacao_inserir on movimentacao;
create policy movimentacao_inserir on movimentacao for insert to authenticated
  with check (tipo = 'INCLUSAO' and pode_editar_ome(ome_destino_id) and registrado_por = auth.uid());
drop policy if exists servidor_civil_inserir on servidor_civil;
drop policy if exists servidor_civil_alterar on servidor_civil;
create policy servidor_civil_inserir on servidor_civil for insert to authenticated with check (pode_editar_ome(ome_id));
create policy servidor_civil_alterar on servidor_civil for update to authenticated
  using (pode_editar_ome(ome_id)) with check (pode_editar_ome(ome_id));
do $$
declare t text;
begin
  foreach t in array array['registro_funcional', 'punicao', 'comportamento_publicado'] loop
    execute format('drop policy if exists %1$s_inserir on %1$I', t);
    execute format('drop policy if exists %1$s_alterar on %1$I', t);
    execute format('drop policy if exists %1$s_excluir on %1$I', t);
    execute format('create policy %1$s_inserir on %1$I for insert to authenticated with check (pode_editar_militar(militar_id))', t);
    execute format('create policy %1$s_alterar on %1$I for update to authenticated
                    using (pode_editar_militar(militar_id)) with check (pode_editar_militar(militar_id))', t);
    execute format('create policy %1$s_excluir on %1$I for delete to authenticated using (pode_editar_militar(militar_id))', t);
  end loop;
end $$;

drop function if exists peculio_geral();
delete from versao_sistema where versao = '1.4.1';
commit;
notify pgrst, 'reload schema';
select 'Banco revertido para a versão 1.4 (dados preservados)' as resultado;
