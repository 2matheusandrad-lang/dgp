-- =====================================================================
-- Migration 3/4 - Views de consulta e funções de negócio
-- As views usam security_invoker: respeitam o RLS de quem consulta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nome de usuário (para exibir "registrado por")
-- ---------------------------------------------------------------------
create or replace function nome_usuario(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(coalesce(posto,'') || ' ' || coalesce(nome,'')), ''), email)
  from perfil where id = p
$$;

-- ---------------------------------------------------------------------
-- v_militar: ficha consolidada (situação do dia, condições, escolaridade,
-- completude do cadastro)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- v_afastamento: afastamentos com dados do militar e status do dia.
-- natureza/CID só aparecem para quem tem permissão de saúde (RLS).
-- ---------------------------------------------------------------------
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

create or replace view v_registro_funcional with (security_invoker = on) as
select r.*, (r.data_inicio is null or r.data_inicio <= current_date)
            and (r.data_fim is null or r.data_fim >= current_date) as vigente,
       m.matricula, m.nome, trim(pg.sigla || coalesce(' ' || m.quadro_sigla, '')) as posto_completo,
       pg.ordem as posto_ordem, m.ome_id, o.sigla as ome_sigla, s.nome as secao_nome, m.situacao
from registro_funcional r
join militar m on m.id = r.militar_id
join posto_graduacao pg on pg.id = m.posto_id
join ome o on o.id = m.ome_id
left join secao s on s.id = m.secao_id;

create or replace view v_punicao with (security_invoker = on) as
select p.*, tp.nome as tipo_nome, m.matricula, m.nome,
       trim(pg.sigla || coalesce(' ' || m.quadro_sigla, '')) as posto_completo, pg.ordem as posto_ordem,
       m.ome_id, o.sigla as ome_sigla
from punicao p
join tipo_punicao tp on tp.id = p.tipo_id
join militar m on m.id = p.militar_id
join posto_graduacao pg on pg.id = m.posto_id
join ome o on o.id = m.ome_id;

create or replace view v_formacao with (security_invoker = on) as
select f.*, n.nome as nivel_nome, n.ordem as nivel_ordem, m.matricula, m.nome,
       trim(pg.sigla || coalesce(' ' || m.quadro_sigla, '')) as posto_completo, pg.ordem as posto_ordem,
       m.ome_id, o.sigla as ome_sigla, s.nome as secao_nome, m.situacao, m.email, m.telefone1
from formacao f
join nivel_escolaridade n on n.id = f.nivel_id
join militar m on m.id = f.militar_id
join posto_graduacao pg on pg.id = m.posto_id
join ome o on o.id = m.ome_id
left join secao s on s.id = m.secao_id;

create or replace view v_movimentacao with (security_invoker = on) as
select mv.*,
       oo.sigla as ome_origem_sigla, od.sigla as ome_destino_sigla, sd.nome as secao_destino_nome,
       nome_usuario(mv.registrado_por) as registrado_por_nome
from movimentacao mv
left join ome oo on oo.id = mv.ome_origem_id
left join ome od on od.id = mv.ome_destino_id
left join secao sd on sd.id = mv.secao_destino_id;

create or replace view v_auditoria with (security_invoker = on) as
select a.*, nome_usuario(a.usuario_id) as usuario_nome, o.sigla as ome_sigla,
       m.nome as militar_nome, m.matricula as militar_matricula
from auditoria a
left join ome o on o.id = a.ome_id
left join militar m on m.id = a.militar_id;

create or replace view v_perfil with (security_invoker = on) as
select p.*,
  coalesce((select array_agg(po.ome_id order by po.ome_id) from perfil_ome po where po.perfil_id = p.id), '{}') as omes_ids,
  coalesce((select string_agg(o.sigla, ', ' order by o.ordem, o.sigla)
            from perfil_ome po join ome o on o.id = po.ome_id where po.perfil_id = p.id), '') as omes_siglas
from perfil p;

-- ---------------------------------------------------------------------
-- Contexto do usuário logado
-- ---------------------------------------------------------------------
create or replace function meu_contexto() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'email', p.email, 'nome', p.nome, 'posto', p.posto, 'matricula', p.matricula,
    'papel', p.papel, 'ativo', p.ativo, 'pode_ver_saude', (p.pode_ver_saude or p.papel = 'ADMIN'),
    'deve_trocar_senha', p.deve_trocar_senha,
    'omes', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'sigla', o.sigla) order by o.ordem, o.sigla)
      from ome o
      where o.ativo and (p.papel in ('ADMIN','DGP','LEITOR_GERAL')
             or exists (select 1 from perfil_ome po where po.perfil_id = p.id and po.ome_id = o.id))
    ), '[]'::jsonb)
  )
  from perfil p where p.id = auth.uid()
$$;

create or replace function registrar_acesso() returns void
language sql security definer set search_path = public as $$
  update perfil set ultimo_acesso = now() where id = auth.uid();
$$;

create or replace function marcar_senha_trocada() returns void
language sql security definer set search_path = public as $$
  update perfil set deve_trocar_senha = false where id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Movimentações
-- ---------------------------------------------------------------------
create or replace function transferir_militar(
  p_militar uuid, p_ome_destino integer, p_secao_destino integer,
  p_data date, p_documento text, p_observacao text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_origem integer; v_situacao situacao_militar;
begin
  select ome_id, situacao into v_origem, v_situacao from militar where id = p_militar for update;
  if v_origem is null then raise exception 'Militar não encontrado.'; end if;
  if v_situacao <> 'ATIVO' then raise exception 'Militar não está ATIVO.'; end if;
  if v_origem = p_ome_destino then raise exception 'O militar já está nesta OME.'; end if;
  if not (pode_editar_ome(v_origem) or pode_editar_ome(p_ome_destino)) then
    raise exception 'Sem permissão: apenas a OME de origem, a de destino ou a DGP podem transferir.';
  end if;
  if coalesce(trim(p_documento), '') = '' then
    raise exception 'Informe o documento da movimentação (SP/BG/SEI).';
  end if;
  if p_secao_destino is not null and not exists (select 1 from secao where id = p_secao_destino and ome_id = p_ome_destino) then
    raise exception 'A seção de destino não pertence à OME de destino.';
  end if;

  perform set_config('app.movimentacao', 'on', true);
  update militar set ome_id = p_ome_destino, secao_id = p_secao_destino where id = p_militar;
  perform set_config('app.movimentacao', '', true);

  insert into movimentacao (militar_id, tipo, ome_origem_id, ome_destino_id, secao_destino_id, data, documento, observacao, registrado_por)
  values (p_militar, 'TRANSFERENCIA', v_origem, p_ome_destino, p_secao_destino, coalesce(p_data, current_date), trim(p_documento), p_observacao, auth.uid());
end $$;

-- A OME de destino "puxa" o militar pela matrícula (não precisa enxergar a ficha antes)
create or replace function receber_militar(
  p_matricula text, p_ome_destino integer, p_secao_destino integer,
  p_data date, p_documento text, p_observacao text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not pode_editar_ome(p_ome_destino) then
    raise exception 'Sem permissão para incluir militares nesta OME.';
  end if;
  select id into v_id from militar where matricula = trim(p_matricula);
  if v_id is null then
    raise exception 'MATRICULA_NAO_CADASTRADA';
  end if;
  perform transferir_militar(v_id, p_ome_destino, p_secao_destino, p_data, p_documento, p_observacao);
  return v_id;
end $$;

-- Onde está a matrícula? (sem expor dados pessoais)
create or replace function localizar_matricula(p_matricula text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not usuario_ativo() then null else (
    select jsonb_build_object('ome', o.sigla, 'situacao', m.situacao, 'posto', pg.sigla, 'nome', m.nome)
    from militar m join ome o on o.id = m.ome_id join posto_graduacao pg on pg.id = m.posto_id
    where m.matricula = trim(p_matricula)) end
$$;

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

-- ---------------------------------------------------------------------
-- Prazo de entrega mensal: 5º dia útil do mês seguinte à competência
-- ---------------------------------------------------------------------
create or replace function n_dia_util(p_mes date, p_n integer) returns date
language plpgsql stable set search_path = public as $$
declare d date := date_trunc('month', p_mes)::date; k int := 0;
begin
  loop
    if extract(isodow from d) < 6 and not exists (select 1 from feriado f where f.data = d) then
      k := k + 1;
      if k = p_n then return d; end if;
    end if;
    d := d + 1;
  end loop;
end $$;

create or replace function prazo_entrega(p_competencia date) returns date
language sql stable set search_path = public as $$
  select n_dia_util((date_trunc('month', p_competencia) + interval '1 month')::date, 5)
$$;

-- Competência em aberto: até o 5º dia útil cobra-se o mês anterior;
-- a partir do 6º dia útil, as OMEs já atualizam o mês corrente.
create or replace function competencia_atual() returns date
language sql stable set search_path = public as $$
  select case
    when current_date <= prazo_entrega((date_trunc('month', current_date) - interval '1 month')::date)
      then (date_trunc('month', current_date) - interval '1 month')::date
    else date_trunc('month', current_date)::date
  end
$$;

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

-- Fechamento: fotografia do efetivo da competência (para relatórios históricos)
create or replace function fechar_competencia(p_competencia date) returns integer
language plpgsql security definer set search_path = public as $$
declare v_comp date := date_trunc('month', p_competencia)::date; v_fim date; v_total int;
begin
  if not e_gestao_global() then raise exception 'Somente a DGP fecha a competência.'; end if;
  v_fim := (v_comp + interval '1 month - 1 day')::date;
  delete from fechamento_mensal where competencia = v_comp;
  insert into fechamento_mensal (competencia, fechado_por) values (v_comp, auth.uid());

  insert into fechamento_militar (competencia, militar_id, ome_id, dados)
  select v_comp, v.id, v.ome_id,
         to_jsonb(v) - 'pendencias' || jsonb_build_object('afastamentos_no_mes', coalesce((
           select jsonb_agg(jsonb_build_object('tipo', t.codigo, 'inicio', a.data_inicio, 'fim', a.data_fim,
                                               'dias', a.dias, 'processo_sei', a.processo_sei))
           from afastamento a join tipo_afastamento t on t.id = a.tipo_id
           where a.militar_id = v.id and a.data_inicio <= v_fim and a.data_fim >= v_comp), '[]'::jsonb))
  from v_militar v where v.situacao = 'ATIVO';

  get diagnostics v_total = row_count;
  update fechamento_mensal set total = v_total where competencia = v_comp;
  return v_total;
end $$;

-- ---------------------------------------------------------------------
-- Dashboard (respeita o RLS de quem chama)
-- ---------------------------------------------------------------------
create or replace function dashboard(p_ome integer default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare r jsonb;
begin
  with base as (
    select * from v_militar where situacao = 'ATIVO' and (p_ome is null or ome_id = p_ome)
  ),
  afs as (
    select * from v_afastamento
    where situacao = 'ATIVO' and (p_ome is null or ome_id = p_ome)
  )
  select jsonb_build_object(
    'total',            (select count(*) from base),
    'operacional',      (select count(*) from base where atividade = 'OPERACIONAL'),
    'administrativo',   (select count(*) from base where atividade = 'ADMINISTRATIVO'),
    'sem_atividade',    (select count(*) from base where atividade is null),
    'afastados',        (select count(*) from base where afastado_hoje),
    'disponiveis',      (select count(*) from base where not afastado_hoje),
    'readaptados',      (select count(*) from base where readaptado),
    'horario_especial', (select count(*) from base where horario_especial),
    'acumulacao',       (select count(*) from base where acumulacao_cargo),
    'pcd',              (select count(*) from base where pcd),
    'completude_media', (select coalesce(round(avg(completude)), 0) from base),
    'cadastro_completo',(select count(*) from base where completude = 100),
    'por_posto', coalesce((select jsonb_agg(x order by x.ordem) from (
        select posto_sigla as sigla, posto_ordem as ordem, count(*) as total,
               count(*) filter (where afastado_hoje) as afastados
        from base group by posto_sigla, posto_ordem) x), '[]'),
    'por_ome', coalesce((select jsonb_agg(x order by x.total desc) from (
        select ome_id as id, ome_sigla as sigla, count(*) as total,
               count(*) filter (where afastado_hoje) as afastados,
               round(avg(completude))::int as completude
        from base group by ome_id, ome_sigla) x), '[]'),
    'por_secao', coalesce((select jsonb_agg(x order by x.total desc) from (
        select coalesce(secao_nome, '(sem seção)') as nome, count(*) as total,
               count(*) filter (where afastado_hoje) as afastados
        from base group by secao_nome) x), '[]'),
    'afastamentos_tipo', coalesce((select jsonb_agg(x order by x.total desc) from (
        select tipo_codigo as codigo, tipo_nome as nome, count(distinct militar_id) as total
        from afs where status = 'EM CURSO' group by tipo_codigo, tipo_nome) x), '[]'),
    'terminando', coalesce((select jsonb_agg(x order by x.data_fim, x.posto_ordem) from (
        select militar_id, nome, posto_completo, posto_ordem, ome_sigla, tipo_codigo, tipo_nome, data_fim, dias_restantes
        from afs where status = 'EM CURSO' and dias_restantes <= 15
        order by data_fim limit 40) x), '[]'),
    'iniciando', coalesce((select jsonb_agg(x order by x.data_inicio) from (
        select militar_id, nome, posto_completo, ome_sigla, tipo_codigo, tipo_nome, data_inicio, dias
        from afs where status = 'PREVISTO' and data_inicio <= current_date + 15
        order by data_inicio limit 40) x), '[]'),
    'escolaridade', coalesce((select jsonb_agg(x order by x.ordem) from (
        select coalesce(escolaridade, 'Não informado') as nivel, coalesce(escolaridade_ordem, 0) as ordem, count(*) as total
        from base group by escolaridade, escolaridade_ordem) x), '[]'),
    'areas', coalesce((select jsonb_agg(x) from (
        select f.area, count(distinct f.militar_id) as total
        from formacao f join base b on b.id = f.militar_id
        where f.area is not null group by f.area order by count(distinct f.militar_id) desc limit 12) x), '[]'),
    'tempo_servico', coalesce((select jsonb_agg(x order by x.ordem) from (
        select case when anos <= 5 then 'até 5 anos' when anos <= 10 then '6 a 10' when anos <= 20 then '11 a 20'
                    when anos <= 30 then '21 a 30' else 'mais de 30' end as faixa,
               min(anos) as ordem, count(*) as total
        from (select extract(year from current_date)::int - ano_ingresso as anos from base where ano_ingresso is not null) t
        group by 1) x), '[]')
  ) into r;
  return r;
end $$;

-- Resumo de saúde agregado (Físico x Mental) - só para quem tem permissão
create or replace function saude_resumo(p_ome integer default null)
returns table (natureza text, total bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(sa.natureza::text, 'NÃO INFORMADA'), count(distinct a.militar_id)
  from afastamento a
  join tipo_afastamento t on t.id = a.tipo_id and t.exige_saude
  join militar m on m.id = a.militar_id and m.situacao = 'ATIVO'
  left join afastamento_saude sa on sa.afastamento_id = a.id
  where current_date between a.data_inicio and a.data_fim
    and (p_ome is null or m.ome_id = p_ome)
    and pode_ler_ome(m.ome_id)
    and (pode_ver_saude() or e_leitura_global())
  group by 1
$$;

-- ---------------------------------------------------------------------
-- Permissões nas views/funções
-- ---------------------------------------------------------------------
grant select on v_militar, v_afastamento, v_registro_funcional, v_punicao, v_formacao,
                v_movimentacao, v_auditoria, v_perfil to authenticated;
revoke all on v_militar, v_afastamento, v_registro_funcional, v_punicao, v_formacao,
              v_movimentacao, v_auditoria, v_perfil from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
-- A função de gatilho de novo usuário precisa ser executável pelo Auth
grant execute on function trg_novo_usuario() to supabase_auth_admin;
