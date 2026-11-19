-- =====================================================================
-- Sistema de Controle do Efetivo (DGP/CBMPE) — versão 1.4.1
-- Ajuste de acesso (decisão da DGP de 19/11/2026):
--   * Movimentações (inclusão, transferência, desligamento, reinclusão), férias (PAF, propostas,
--     reprogramações, servidores civis), situações funcionais e comportamento/punições:
--     as OMEs consultam; só a DGP (papéis DGP e ADMIN) altera.
--   * Pedidos das OMEs à DGP (comunicar desligamento, pedir correção, pedir reprogramação) deixam de existir.
--   * Nome de guerra e ano de ingresso passam a ser mantidos só pela DGP (pecúlio/almanaque), como os demais dados oficiais.
--   * Pecúlio geral: qualquer usuário consulta a identificação e a lotação de todo o efetivo ativo
--     (sem contato, endereço, nascimento, saúde ou disciplina); edição só na própria OME.
--
-- Requer a versão 1.4. Uma transação; não apaga dados. Para desfazer: supabase/reverter_1_4_1.sql
-- =====================================================================
set client_min_messages = warning;
begin;

do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.4') then
    raise exception 'Aplique antes o 20261222000000_versao_1_4.sql (versão 1.4).';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.4.1') then
    raise exception 'A versão 1.4.1 já está aplicada neste banco: nada a fazer.';
  end if;
end $$;

insert into versao_sistema (versao) values ('1.4.1');

-- troca um trecho do corpo de uma função (falha se o trecho não existir: banco fora do esperado)
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

-- =====================================================================
-- 1. MOVIMENTAÇÕES: inclusão, transferência e desligamento só pela DGP
-- =====================================================================
select pg_temp.trocar('transferir_militar',
  $x$if not (pode_editar_ome(v_origem) or pode_editar_ome(p_ome_destino)) then
    raise exception 'Sem permissão: apenas a OME de origem, a de destino ou a DGP podem transferir.';$x$,
  $x$if not e_gestao_global() then
    raise exception 'Transferência é registrada somente pela DGP.';$x$);

select pg_temp.trocar('receber_militar',
  $x$if not pode_editar_ome(p_ome_destino) then
    raise exception 'Sem permissão para incluir militares nesta OME.';$x$,
  $x$if not e_gestao_global() then
    raise exception 'Transferência é registrada somente pela DGP.';$x$);

drop policy if exists militar_inserir on militar;
create policy militar_inserir on militar for insert to authenticated
  with check ((select e_gestao_global()) and pode_editar_ome(ome_id));

drop policy if exists movimentacao_inserir on movimentacao;
create policy movimentacao_inserir on movimentacao for insert to authenticated
  with check (tipo = 'INCLUSAO' and (select e_gestao_global()) and pode_editar_ome(ome_destino_id) and registrado_por = auth.uid());

-- pedidos da OME à DGP: desativados (a DGP registra direto)
select pg_temp.trocar('solicitar_desligamento',
  $x$if not pode_editar_ome(v_ome) then raise exception 'Sem permissão para esta OME.'; end if;$x$,
  $x$if not e_gestao_global() then raise exception 'Desligamento é tratado somente pela DGP.'; end if;$x$);
select pg_temp.trocar('solicitar_correcao',
  $x$if not pode_editar_ome(v_m.ome_id) then raise exception 'Sem permissão para esta OME.'; end if;$x$,
  $x$if not e_gestao_global() then raise exception 'Os dados oficiais são corrigidos somente pela DGP.'; end if;$x$);
select pg_temp.trocar('decidir_solicitacao',
  $x$if not (pode_editar_ome(s.ome_id)) then raise exception 'Sem permissão.'; end if;$x$,
  $x$if not e_gestao_global() then raise exception 'Somente a DGP trata pedidos.'; end if;$x$);

-- =====================================================================
-- 2. FÉRIAS (PAF): só a DGP lança, reprograma, exclui e cadastra servidores civis
-- =====================================================================
select pg_temp.trocar('ferias_propor',
  $x$if v_ome is null or not pode_editar_ome(v_ome) then raise exception 'Sem permissão para esta OME.'; end if;$x$,
  $x$if v_ome is null or not e_gestao_global() then raise exception 'Férias são lançadas e alteradas somente pela DGP.'; end if;$x$);
select pg_temp.trocar('ferias_reprogramar',
  $x$if v_ome is null or not pode_editar_ome(v_ome) then raise exception 'Sem permissão para esta OME.'; end if;$x$,
  $x$if v_ome is null or not e_gestao_global() then raise exception 'Férias são lançadas e alteradas somente pela DGP.'; end if;$x$);
select pg_temp.trocar('ferias_decidir_reprogramacao',
  $x$if not pode_editar_ome(s.ome_id) then raise exception 'Sem permissão.'; end if;$x$,
  $x$if not e_gestao_global() then raise exception 'Somente a DGP trata reprogramações.'; end if;$x$);
select pg_temp.trocar('ferias_excluir_periodo',
  $x$if not (e_gestao_global() or (f.situacao = 'PROPOSTA' and pode_editar_ome(ferias_ome_pessoa(f.militar_id, f.civil_id)))) then$x$,
  $x$if not e_gestao_global() then$x$);

drop policy if exists servidor_civil_inserir on servidor_civil;
drop policy if exists servidor_civil_alterar on servidor_civil;
create policy servidor_civil_inserir on servidor_civil for insert to authenticated
  with check ((select e_gestao_global()) and pode_editar_ome(ome_id));
create policy servidor_civil_alterar on servidor_civil for update to authenticated
  using ((select e_gestao_global()) and pode_editar_ome(ome_id)) with check ((select e_gestao_global()) and pode_editar_ome(ome_id));

-- =====================================================================
-- 3. SITUAÇÕES FUNCIONAIS, PUNIÇÕES E COMPORTAMENTO: só a DGP altera
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['registro_funcional', 'punicao', 'comportamento_publicado'] loop
    execute format('drop policy if exists %1$s_inserir on %1$I', t);
    execute format('drop policy if exists %1$s_alterar on %1$I', t);
    execute format('drop policy if exists %1$s_excluir on %1$I', t);
    execute format('create policy %1$s_inserir on %1$I for insert to authenticated
                    with check ((select e_gestao_global()) and pode_editar_militar(militar_id))', t);
    execute format('create policy %1$s_alterar on %1$I for update to authenticated
                    using ((select e_gestao_global()) and pode_editar_militar(militar_id))
                    with check ((select e_gestao_global()) and pode_editar_militar(militar_id))', t);
    execute format('create policy %1$s_excluir on %1$I for delete to authenticated
                    using ((select e_gestao_global()) and pode_editar_militar(militar_id))', t);
  end loop;
end $$;

-- =====================================================================
-- 4. NOME DE GUERRA E ANO DE INGRESSO: dados oficiais (pecúlio/almanaque), mantidos pela DGP
-- =====================================================================
select pg_temp.trocar('trg_militar_antes',
  $x$or new.nome is distinct from old.nome or new.matricula is distinct from old.matricula$x$,
  $x$or new.nome is distinct from old.nome or new.nome_guerra is distinct from old.nome_guerra
            or new.ano_ingresso is distinct from old.ano_ingresso or new.matricula is distinct from old.matricula$x$);
select pg_temp.trocar('trg_militar_antes',
  $x$'Posto/graduação, quadro, nome, matrícula, nº funcional, sexo, nascimento, antiguidade, datas de ingresso e de promoção e órgão de cessão são mantidos pela DGP. Use "Pedir correção à DGP" na ficha.'$x$,
  $x$'Posto/graduação, quadro, nome, nome de guerra, matrícula, nº funcional, sexo, nascimento, antiguidade, ano e data de ingresso, data de promoção e órgão de cessão são mantidos pela DGP.'$x$);
-- a planilha da OME deixa de mexer no nome de guerra (o ano de ingresso a tela já não envia; se vier, a regra acima recusa)
select pg_temp.trocar('aplicar_lote',
  $x$      nome_guerra = case when x ? 'nome_guerra' then nullif(x->>'nome_guerra', '') else nome_guerra end,
$x$, '');

-- =====================================================================
-- 5. PECÚLIO GERAL: identificação e lotação de todo o efetivo ativo, para qualquer usuário
--    (o que vai além disso continua restrito às OMEs de cada um)
-- =====================================================================
create or replace function peculio_geral()
returns table (militar_id uuid, matricula text, numero_funcional text, nome text, nome_guerra text,
               posto_id smallint, posto_sigla text, posto_ordem smallint, quadro_sigla text, quadro_ordem smallint,
               posto_completo text, ome_id integer, ome_sigla text, municipio text, orgao_cessao text, sexo text,
               ano_ingresso smallint, data_ingresso date, ordem_antiguidade integer, ve_ficha boolean)
language sql stable security definer set search_path = public as $$
  with eu as (select usuario_ativo() as ativo, minhas_omes() as omes)
  select m.id, m.matricula::text, m.numero_funcional, m.nome::text, m.nome_guerra::text,
         m.posto_id::smallint, pg.sigla::text, pg.ordem::smallint, m.quadro_sigla::text, q.ordem::smallint,
         trim(pg.sigla || coalesce(' ' || m.quadro_sigla, ''))::text, m.ome_id, o.sigla::text, mu.nome::text, m.orgao_cessao, m.sexo,
         m.ano_ingresso::smallint, m.data_ingresso, m.ordem_antiguidade::integer, m.ome_id = any (eu.omes)
    from eu
    join militar m on eu.ativo
    join posto_graduacao pg on pg.id = m.posto_id
    join ome o on o.id = m.ome_id
    left join quadro q on q.sigla = m.quadro_sigla
    left join municipio mu on mu.codigo = o.municipio_ibge
   where m.situacao = 'ATIVO'
$$;
comment on function peculio_geral() is
  'Pecúlio geral para consulta por qualquer usuário ativo: identificação e lotação do efetivo ativo, sem contato, nascimento, saúde ou disciplina. ve_ficha = o usuário pode abrir a ficha.';
revoke execute on function peculio_geral() from public, anon;
grant execute on function peculio_geral() to authenticated, service_role;

-- =====================================================================
-- 6. DICIONÁRIO DE DADOS
-- =====================================================================
update catalogo_campo set responsavel = 'DGP', edicao = 'Somente DGP (as OMEs consultam)'
 where campo in ('Readaptação', 'Horário especial', 'Acumulação de cargo', 'PCD', 'Punições', 'Comportamento', 'Períodos do PAF');
update catalogo_campo set edicao = 'Somente DGP (pecúlio)' where campo = 'Nome de guerra';
update catalogo_campo set edicao = 'Somente DGP (inclusão, transferência e desligamento)' where campo = 'OME';

commit;
notify pgrst, 'reload schema';
select 'Versão 1.4.1 aplicada com sucesso' as resultado;
