-- =====================================================================
-- REVERSÃO DA FASE 1 (volta o banco para a versão 1.0)
-- Use SOMENTE se a atualização apresentar problema grave.
-- ATENÇÃO: apaga o que foi registrado com as funções novas
-- (QOD e de-para do QOD, histórico de importações, conferências, solicitações,
--  registro de acesso a dados de saúde,
--  motivo/publicação de desligamento). Militares, afastamentos e demais
--  dados da versão 1.0 são preservados.
-- =====================================================================
set client_min_messages = warning;
begin;

do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.1') then
    raise exception 'A fase 1 não está aplicada neste banco.';
  end if;
end $$;

-- atualização mensal por PDF
drop function if exists qod_importar(date, jsonb, text, jsonb, jsonb);
drop function if exists aplicar_almanaque(date, text, jsonb, jsonb);
drop table if exists qod_alias;
drop table if exists referencia_importacao;
delete from ome o where o.sigla in ('CG', 'SCG', 'CPP')
  and not exists (select 1 from militar m where m.ome_id = o.id)
  and not exists (select 1 from movimentacao mv where mv.ome_origem_id = o.id or mv.ome_destino_id = o.id);
-- militar: volta o gatilho original
create or replace function trg_militar_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_secao_ome integer;
begin
  new.nome        := upper(regexp_replace(trim(new.nome), '\s+', ' ', 'g'));
  new.nome_guerra := nullif(upper(trim(coalesce(new.nome_guerra, ''))), '');
  new.email       := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.atualizado_em  := now();
  new.atualizado_por := auth.uid();

  if new.secao_id is not null then
    select ome_id into v_secao_ome from secao where id = new.secao_id;
    if v_secao_ome is distinct from new.ome_id then
      raise exception 'A seção informada não pertence à OME do militar.';
    end if;
  end if;

  -- verificação do dígito (ADMIN pode cadastrar exceções)
  if not matricula_valida(new.matricula) and auth.uid() is not null and not e_admin() then
    raise exception 'Matrícula % inválida (dígito verificador não confere).', new.matricula;
  end if;

  if tg_op = 'INSERT' then
    new.criado_por := auth.uid();
    if auth.uid() is not null and new.situacao <> 'ATIVO' then
      raise exception 'Novo militar deve ser cadastrado como ATIVO.';
    end if;
  elsif tg_op = 'UPDATE' and auth.uid() is not null
        and coalesce(current_setting('app.movimentacao', true), '') <> 'on'
        and (new.ome_id is distinct from old.ome_id or new.situacao is distinct from old.situacao) then
    raise exception 'Alteração de OME ou situação deve ser feita por Transferência ou Desligamento.';
  end if;
  return new;
end $$;

-- funções novas
drop function if exists minhas_pendencias(integer);
drop function if exists indicadores(date, integer);
drop function if exists boletim(date);
drop function if exists buscar_militar(text);
drop function if exists sem_acento(text);
drop function if exists qod_historico(integer);
drop function if exists qod_salvar(date, jsonb, text);
drop function if exists qod_impacto(uuid, integer);
drop function if exists qod_comparativo(date);
drop function if exists qod_competencia_vigente(date);
drop function if exists aplicar_lote(integer, jsonb, jsonb, jsonb, date);
drop function if exists conferir_militares(date, uuid[], boolean);
drop function if exists decidir_solicitacao(uuid, text, text);
drop function if exists solicitar_desligamento(uuid, integer, date, text, text, text);
drop function if exists ver_dados_saude(uuid);
drop function if exists salvar_dados_saude(uuid, natureza_saude, text);
drop function if exists desligar_militar(uuid, integer, date, text, text, text);
drop function if exists situacao_entregas(date);

-- views novas
drop view if exists v_solicitacao;
drop view if exists v_desligamento;
drop view if exists v_afastamento;
drop function if exists tem_dados_saude(uuid);

-- tabelas novas
drop table if exists qod;
drop table if exists conferencia;
drop table if exists solicitacao;
drop table if exists acesso_sensivel;
alter table militar drop column if exists motivo_desligamento_id;
alter table militar drop column if exists publicacao_desligamento;
drop table if exists motivo_desligamento;
alter table entrega_mensal drop column if exists nao_conferidos;
delete from tipo_afastamento t where codigo in ('AGREGACAO','CESSAO')
  and not exists (select 1 from afastamento a where a.tipo_id = t.id);

-- auditoria: volta o gatilho original (a coluna origem é mantida, sem uso)
create or replace function trg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_reg jsonb; v_mil uuid; v_ome integer; v_id text;
begin
  if coalesce(current_setting('app.importacao', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and (v_old - 'atualizado_em' - 'atualizado_por' - 'ultimo_acesso')
                        = (v_new - 'atualizado_em' - 'atualizado_por' - 'ultimo_acesso') then
    return new;
  end if;
  v_reg := coalesce(v_new, v_old);
  v_id  := coalesce(v_reg->>'id', v_reg->>'afastamento_id', v_reg->>'militar_id', v_reg->>'perfil_id');

  if tg_table_name = 'militar' then
    v_mil := (v_reg->>'id')::uuid;
    v_ome := (v_reg->>'ome_id')::int;
  elsif v_reg ? 'militar_id' then
    v_mil := (v_reg->>'militar_id')::uuid;
    v_ome := coalesce((v_reg->>'ome_destino_id')::int, ome_do_militar(v_mil));
  elsif tg_table_name = 'afastamento_saude' then
    v_mil := militar_do_afastamento((v_reg->>'afastamento_id')::uuid);
    v_ome := ome_do_militar(v_mil);
  elsif v_reg ? 'ome_id' then
    v_ome := (v_reg->>'ome_id')::int;
  end if;

  insert into auditoria (usuario_id, tabela, operacao, registro_id, militar_id, ome_id, antes, depois)
  values (auth.uid(), tg_table_name, tg_op, v_id, v_mil, v_ome, v_old, v_new);
  return coalesce(new, old);
end $$;

-- políticas originais
drop policy if exists militar_ler on militar;
create policy militar_ler on militar for select to authenticated using (pode_ler_ome(ome_id));
do $$
declare t text;
begin
  foreach t in array array['afastamento','registro_funcional','punicao','formacao','militar_idioma']
  loop
    execute format('drop policy if exists %1$s_ler on %1$I', t);
    execute format('create policy %1$s_ler on %1$I for select to authenticated using (pode_ler_militar(militar_id))', t);
  end loop;
end $$;
drop policy if exists movimentacao_ler on movimentacao;
create policy movimentacao_ler on movimentacao for select to authenticated
  using (pode_ler_ome(ome_origem_id) or pode_ler_ome(ome_destino_id) or pode_ler_militar(militar_id));
drop policy if exists entrega_ler on entrega_mensal;
create policy entrega_ler on entrega_mensal for select to authenticated using (pode_ler_ome(ome_id));
drop policy if exists fechamento_militar_ler on fechamento_militar;
create policy fechamento_militar_ler on fechamento_militar for select to authenticated using (pode_ler_ome(ome_id));
drop policy if exists auditoria_ler on auditoria;
create policy auditoria_ler on auditoria for select to authenticated
  using (
    (tabela <> 'afastamento_saude' or pode_ver_saude())
    and (e_gestao_global() or (ome_id is not null and pode_editar_ome(ome_id)
                               and tabela not in ('perfil','perfil_ome')))
  );
drop policy if exists saude_ler on afastamento_saude;
create policy saude_ler on afastamento_saude for select to authenticated
  using (pode_ver_saude() and pode_ler_militar(militar_do_afastamento(afastamento_id)));
create policy saude_inserir on afastamento_saude for insert to authenticated
  with check (pode_ver_saude() and pode_editar_militar(militar_do_afastamento(afastamento_id)));
create policy saude_alterar on afastamento_saude for update to authenticated
  using (pode_ver_saude() and pode_editar_militar(militar_do_afastamento(afastamento_id)))
  with check (pode_ver_saude() and pode_editar_militar(militar_do_afastamento(afastamento_id)));
create policy saude_excluir on afastamento_saude for delete to authenticated
  using (pode_ver_saude() and pode_editar_militar(militar_do_afastamento(afastamento_id)));

-- views e funções originais
drop view if exists v_militar;
create or replace view v_militar with (security_invoker = on) as
select
  m.id, m.matricula, m.nome, m.nome_guerra,
  m.posto_id, pg.sigla as posto_sigla, pg.nome as posto_nome, pg.ordem as posto_ordem,
  pg.circulo, pg.oficial, m.quadro_sigla,
  trim(pg.sigla || coalesce(' ' || m.quadro_sigla, '')) as posto_completo,
  m.ome_id, o.sigla as ome_sigla, m.secao_id, s.nome as secao_nome,
  m.atividade, m.ano_ingresso, m.ordem_antiguidade,
  m.email, m.telefone1, m.telefone2, m.endereco,
  m.situacao, m.data_situacao, m.documento_situacao, m.observacoes,
  m.criado_em, m.atualizado_em,
  af.codigo  as afastamento_codigo,
  af.nome    as afastamento_nome,
  af.data_fim as afastamento_fim,
  (af.codigo is not null) as afastado_hoje,
  coalesce(rf.readaptado, false)       as readaptado,
  coalesce(rf.horario_especial, false) as horario_especial,
  coalesce(rf.acumulacao_cargo, false) as acumulacao_cargo,
  coalesce(rf.pcd, false)              as pcd,
  esc.nivel       as escolaridade,
  esc.nivel_ordem as escolaridade_ordem,
  fa.areas        as areas_formacao,
  idi.idiomas,
  pun.qtd         as qtd_punicoes,
  round(100.0 * c.pontos / 7)::int as completude,
  array_remove(array[
    case when m.secao_id    is null then 'Seção' end,
    case when m.atividade   is null then 'Atividade (Operacional/Adm.)' end,
    case when esc.nivel     is null then 'Escolaridade' end,
    case when m.email       is null then 'E-mail' end,
    case when m.telefone1   is null then 'Telefone' end,
    case when m.endereco    is null then 'Endereço' end,
    case when m.ano_ingresso is null then 'Ano de ingresso' end
  ], null) as pendencias
from militar m
join posto_graduacao pg on pg.id = m.posto_id
join ome o on o.id = m.ome_id
left join secao s on s.id = m.secao_id
left join lateral (
  select t.codigo, t.nome, a.data_fim
  from afastamento a join tipo_afastamento t on t.id = a.tipo_id
  where a.militar_id = m.id and current_date between a.data_inicio and a.data_fim
  order by a.data_fim desc limit 1
) af on true
left join lateral (
  select bool_or(r.tipo = 'READAPTACAO')      as readaptado,
         bool_or(r.tipo = 'HORARIO_ESPECIAL') as horario_especial,
         bool_or(r.tipo = 'ACUMULACAO_CARGO') as acumulacao_cargo,
         bool_or(r.tipo = 'PCD')              as pcd
  from registro_funcional r
  where r.militar_id = m.id
    and (r.data_inicio is null or r.data_inicio <= current_date)
    and (r.data_fim is null or r.data_fim >= current_date)
) rf on true
left join lateral (
  select n.nome as nivel, n.ordem as nivel_ordem
  from formacao f join nivel_escolaridade n on n.id = f.nivel_id
  where f.militar_id = m.id order by n.ordem desc limit 1
) esc on true
left join lateral (
  select string_agg(distinct f.area, '; ') as areas
  from formacao f where f.militar_id = m.id and f.area is not null
) fa on true
left join lateral (
  select string_agg(i.idioma, ', ' order by i.idioma) as idiomas
  from militar_idioma i where i.militar_id = m.id
) idi on true
left join lateral (
  select count(*)::int as qtd from punicao p where p.militar_id = m.id
) pun on true
cross join lateral (
  select (m.secao_id is not null)::int + (m.atividade is not null)::int + (esc.nivel is not null)::int
       + (m.email is not null)::int + (m.telefone1 is not null)::int + (m.endereco is not null)::int
       + (m.ano_ingresso is not null)::int as pontos
) c;

create or replace view v_afastamento with (security_invoker = on) as
select
  a.id, a.militar_id, a.tipo_id, t.codigo as tipo_codigo, t.nome as tipo_nome, t.exige_saude,
  a.data_inicio, a.dias, a.data_fim, a.processo_sei, a.observacao, a.criado_em,
  case when current_date < a.data_inicio then 'PREVISTO'
       when current_date > a.data_fim   then 'ENCERRADO'
       else 'EM CURSO' end as status,
  (a.data_fim - current_date) as dias_restantes,
  m.matricula, m.nome, m.posto_id, pg.sigla as posto_sigla, pg.ordem as posto_ordem,
  trim(pg.sigla || coalesce(' ' || m.quadro_sigla, '')) as posto_completo,
  m.ome_id, o.sigla as ome_sigla, s.nome as secao_nome, m.situacao,
  sa.natureza, sa.cid
from afastamento a
join tipo_afastamento t on t.id = a.tipo_id
join militar m on m.id = a.militar_id
join posto_graduacao pg on pg.id = m.posto_id
join ome o on o.id = m.ome_id
left join secao s on s.id = m.secao_id
left join afastamento_saude sa on sa.afastamento_id = a.id;

create or replace function desligar_militar(
  p_militar uuid, p_situacao situacao_militar, p_data date, p_documento text, p_observacao text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_ome integer; v_sit situacao_militar;
begin
  select ome_id, situacao into v_ome, v_sit from militar where id = p_militar for update;
  if v_ome is null then raise exception 'Militar não encontrado.'; end if;
  if not pode_editar_ome(v_ome) then raise exception 'Sem permissão.'; end if;
  if p_situacao = 'ATIVO' then raise exception 'Use a reinclusão para reativar.'; end if;
  if v_sit <> 'ATIVO' then raise exception 'Militar já está desligado (%).', v_sit; end if;
  if coalesce(trim(p_documento), '') = '' then raise exception 'Informe o documento (SP/BG/SEI).'; end if;

  perform set_config('app.movimentacao', 'on', true);
  update militar set situacao = p_situacao, data_situacao = coalesce(p_data, current_date),
                     documento_situacao = trim(p_documento)
  where id = p_militar;
  perform set_config('app.movimentacao', '', true);

  insert into movimentacao (militar_id, tipo, ome_origem_id, situacao_nova, data, documento, observacao, registrado_por)
  values (p_militar, 'DESLIGAMENTO', v_ome, p_situacao, coalesce(p_data, current_date), trim(p_documento), p_observacao, auth.uid());
end $$;

create or replace function reincluir_militar(
  p_militar uuid, p_ome integer, p_secao integer, p_data date, p_documento text, p_observacao text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_ome integer;
begin
  if not e_gestao_global() then raise exception 'Reinclusão é feita pela DGP.'; end if;
  select ome_id into v_ome from militar where id = p_militar for update;
  perform set_config('app.movimentacao', 'on', true);
  update militar set situacao = 'ATIVO', ome_id = p_ome, secao_id = p_secao,
                     data_situacao = coalesce(p_data, current_date), documento_situacao = p_documento
  where id = p_militar;
  perform set_config('app.movimentacao', '', true);
  insert into movimentacao (militar_id, tipo, ome_origem_id, ome_destino_id, secao_destino_id, situacao_nova, data, documento, observacao, registrado_por)
  values (p_militar, 'REINCLUSAO', v_ome, p_ome, p_secao, 'ATIVO', coalesce(p_data, current_date), p_documento, p_observacao, auth.uid());
end $$;

create or replace function confirmar_entrega(p_ome integer, p_competencia date, p_observacao text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pode_editar_ome(p_ome) then raise exception 'Sem permissão para esta OME.'; end if;
  if exists (select 1 from fechamento_mensal where competencia = date_trunc('month', p_competencia)::date)
     and not e_gestao_global() then
    raise exception 'Esta competência já foi fechada pela DGP.';
  end if;
  insert into entrega_mensal (ome_id, competencia, confirmado_por, efetivo, observacao)
  values (p_ome, date_trunc('month', p_competencia)::date, auth.uid(),
          (select count(*) from militar where ome_id = p_ome and situacao = 'ATIVO'), p_observacao)
  on conflict (ome_id, competencia) do update
     set confirmado_por = excluded.confirmado_por, confirmado_em = now(),
         efetivo = excluded.efetivo, observacao = excluded.observacao;
end $$;

create or replace function situacao_entregas(p_competencia date)
returns table (ome_id integer, ome_sigla text, efetivo bigint, prazo date,
               confirmado_em timestamptz, confirmado_por text, situacao text, ultima_alteracao timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.sigla,
         (select count(*) from militar m where m.ome_id = o.id and m.situacao = 'ATIVO'),
         prazo_entrega(p_competencia),
         e.confirmado_em, nome_usuario(e.confirmado_por),
         case
           when e.confirmado_em is null and current_date > prazo_entrega(p_competencia) then 'ATRASADA'
           when e.confirmado_em is null then 'PENDENTE'
           when e.confirmado_em::date > prazo_entrega(p_competencia) then 'ENTREGUE COM ATRASO'
           else 'ENTREGUE NO PRAZO' end,
         (select max(a.momento) from auditoria a where a.ome_id = o.id)
  from ome o
  left join entrega_mensal e on e.ome_id = o.id and e.competencia = date_trunc('month', p_competencia)::date
  where o.ativo and pode_ler_ome(o.id)
  order by o.ordem, o.sigla
$$;

drop function if exists minhas_omes();
drop function if exists minhas_omes_edicao();
drop index if exists afastamento_militar_fim_idx;
drop index if exists militar_situacao_ome_idx;

grant select on v_militar, v_afastamento to authenticated;
revoke all on v_militar, v_afastamento from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;

delete from versao_sistema where versao = '1.1';
commit;

notify pgrst, 'reload schema';
select 'Fase 1 revertida: sistema de volta à versão ' || max(versao) as resultado from versao_sistema;
