-- =====================================================================
-- SISTEMA DE CONTROLE DO EFETIVO - CBMPE / DGP
-- ATUALIZAÇÃO FASE 1 (incremental: não apaga dados existentes)
--
--  1. Desempenho (permissões calculadas uma vez por consulta; view reescrita)
--  2. Auditoria com origem (tela / planilha)
--  3. Dados de saúde só por função, com registro de quem consultou
--  4. Desligamento só pela DGP, com motivos configuráveis
--  5. Solicitações da OME à DGP (pedido de desligamento)
--  6. Conferência mensal por militar, ligada à entrega
--  7. Atualização em lote (planilha da OME)
--  8. QOD mensal (previsto x existente)
--  9. Pendências (alertas dentro do sistema)
-- 10. Indicadores e boletim mensal
-- 11. Busca rápida
-- 12. Atualização mensal por PDF: QOD e almanaque (novas OMEs CG, SCG e CPP)
--
-- Rodar UMA vez, inteiro, no SQL Editor. Está dentro de uma transação:
-- se algo falhar, nada é aplicado.
-- =====================================================================
set client_min_messages = warning;
begin;

create table if not exists versao_sistema (
  versao      text primary key,
  aplicada_em timestamptz not null default now()
);
alter table versao_sistema enable row level security;
drop policy if exists versao_ler on versao_sistema;
create policy versao_ler on versao_sistema for select to authenticated using (true);

do $$ begin
  if exists (select 1 from versao_sistema where versao = '1.1') then
    raise exception 'A atualização 1.1 (fase 1) já foi aplicada neste banco.';
  end if;
end $$;
insert into versao_sistema (versao) values ('1.0'), ('1.1') on conflict do nothing;

-- =====================================================================
-- 1. DESEMPENHO
-- =====================================================================
-- Lista de OMEs que o usuário enxerga/edita, calculada UMA vez por consulta
create or replace function minhas_omes() returns integer[]
language sql stable security definer set search_path = public as $$
  select case
    when papel_atual() in ('ADMIN','DGP','LEITOR_GERAL') then (select coalesce(array_agg(id), '{}') from ome)
    when papel_atual() is null then '{}'::integer[]
    else coalesce((select array_agg(ome_id) from perfil_ome where perfil_id = auth.uid()), '{}')
  end
$$;

create or replace function minhas_omes_edicao() returns integer[]
language sql stable security definer set search_path = public as $$
  select case
    when papel_atual() in ('ADMIN','DGP') then (select coalesce(array_agg(id), '{}') from ome)
    when papel_atual() = 'GESTOR' then coalesce((select array_agg(ome_id) from perfil_ome where perfil_id = auth.uid()), '{}')
    else '{}'::integer[]
  end
$$;

drop policy if exists militar_ler on militar;
create policy militar_ler on militar for select to authenticated
  using (ome_id = any (array(select unnest(minhas_omes()))));

do $$
declare t text;
begin
  foreach t in array array['afastamento','registro_funcional','punicao','formacao','militar_idioma']
  loop
    execute format('drop policy if exists %1$s_ler on %1$I', t);
    execute format('create policy %1$s_ler on %1$I for select to authenticated
                    using (exists (select 1 from militar m where m.id = militar_id))', t);
  end loop;
end $$;

drop policy if exists movimentacao_ler on movimentacao;
create policy movimentacao_ler on movimentacao for select to authenticated
  using (ome_origem_id = any (array(select unnest(minhas_omes())))
      or ome_destino_id = any (array(select unnest(minhas_omes())))
      or exists (select 1 from militar m where m.id = militar_id));

drop policy if exists entrega_ler on entrega_mensal;
create policy entrega_ler on entrega_mensal for select to authenticated
  using (ome_id = any (array(select unnest(minhas_omes()))));

drop policy if exists fechamento_militar_ler on fechamento_militar;
create policy fechamento_militar_ler on fechamento_militar for select to authenticated
  using (ome_id = any (array(select unnest(minhas_omes()))));

drop policy if exists auditoria_ler on auditoria;
create policy auditoria_ler on auditoria for select to authenticated
  using (
    (tabela <> 'afastamento_saude' or (select pode_ver_saude()))
    and ((select e_gestao_global())
         or (ome_id = any (array(select unnest(minhas_omes_edicao())))
             and tabela not in ('perfil','perfil_ome')))
  );

-- Tabelas de domínio: a permissão é avaliada uma vez por consulta, não por linha
do $$
declare t text;
begin
  foreach t in array array['ome','posto_graduacao','quadro','tipo_afastamento','nivel_escolaridade','tipo_punicao','feriado','secao']
  loop
    execute format('drop policy if exists %1$s_ler on %1$I', t);
    execute format('create policy %1$s_ler on %1$I for select to authenticated using ((select usuario_ativo()))', t);
  end loop;
  foreach t in array array['ome','posto_graduacao','quadro','tipo_afastamento','nivel_escolaridade','tipo_punicao','feriado']
  loop
    execute format('drop policy if exists %1$s_manter on %1$I', t);
    execute format('create policy %1$s_manter on %1$I for all to authenticated
                    using ((select e_gestao_global())) with check ((select e_gestao_global()))', t);
  end loop;
end $$;

-- v_militar reescrita: agregações feitas uma vez para todos (antes: 6 subconsultas por militar)
create or replace view v_militar with (security_invoker = on) as
with
af as (
  select distinct on (a.militar_id) a.militar_id, t.codigo, t.nome, a.data_fim
  from afastamento a join tipo_afastamento t on t.id = a.tipo_id
  where current_date between a.data_inicio and a.data_fim
  order by a.militar_id, a.data_fim desc
),
rf as (
  select r.militar_id,
         bool_or(r.tipo = 'READAPTACAO') as readaptado, bool_or(r.tipo = 'HORARIO_ESPECIAL') as horario_especial,
         bool_or(r.tipo = 'ACUMULACAO_CARGO') as acumulacao_cargo, bool_or(r.tipo = 'PCD') as pcd
  from registro_funcional r
  where (r.data_inicio is null or r.data_inicio <= current_date) and (r.data_fim is null or r.data_fim >= current_date)
  group by r.militar_id
),
fo as (
  select f.militar_id, max(n.ordem) as nivel_ordem,
         (array_agg(n.nome order by n.ordem desc))[1] as nivel,
         string_agg(distinct f.area, '; ') as areas
  from formacao f join nivel_escolaridade n on n.id = f.nivel_id
  group by f.militar_id
),
idi as (select militar_id, string_agg(idioma, ', ' order by idioma) as idiomas from militar_idioma group by militar_id),
pun as (select militar_id, count(*)::int as qtd from punicao group by militar_id)
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
  af.codigo as afastamento_codigo, af.nome as afastamento_nome, af.data_fim as afastamento_fim,
  (af.codigo is not null) as afastado_hoje,
  coalesce(rf.readaptado, false) as readaptado, coalesce(rf.horario_especial, false) as horario_especial,
  coalesce(rf.acumulacao_cargo, false) as acumulacao_cargo, coalesce(rf.pcd, false) as pcd,
  fo.nivel as escolaridade, fo.nivel_ordem as escolaridade_ordem, fo.areas as areas_formacao,
  idi.idiomas, coalesce(pun.qtd, 0) as qtd_punicoes,
  round(100.0 * ((m.secao_id is not null)::int + (m.atividade is not null)::int + (fo.nivel is not null)::int
       + (m.email is not null)::int + (m.telefone1 is not null)::int + (m.endereco is not null)::int
       + (m.ano_ingresso is not null)::int) / 7)::int as completude,
  array_remove(array[
    case when m.secao_id    is null then 'Seção' end,
    case when m.atividade   is null then 'Atividade (Operacional/Adm.)' end,
    case when fo.nivel      is null then 'Escolaridade' end,
    case when m.email       is null then 'E-mail' end,
    case when m.telefone1   is null then 'Telefone' end,
    case when m.endereco    is null then 'Endereço' end,
    case when m.ano_ingresso is null then 'Ano de ingresso' end
  ], null) as pendencias
from militar m
join posto_graduacao pg on pg.id = m.posto_id
join ome o on o.id = m.ome_id
left join secao s on s.id = m.secao_id
left join af on af.militar_id = m.id
left join rf on rf.militar_id = m.id
left join fo on fo.militar_id = m.id
left join idi on idi.militar_id = m.id
left join pun on pun.militar_id = m.id;

create index if not exists afastamento_militar_fim_idx on afastamento (militar_id, data_fim);
create index if not exists militar_situacao_ome_idx on militar (situacao, ome_id);

-- =====================================================================
-- 2. AUDITORIA COM ORIGEM
-- =====================================================================
alter table auditoria add column if not exists origem text;

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
    v_ome := coalesce((v_reg->>'ome_destino_id')::int, (v_reg->>'ome_id')::int, ome_do_militar(v_mil));
  elsif tg_table_name = 'afastamento_saude' then
    v_mil := militar_do_afastamento((v_reg->>'afastamento_id')::uuid);
    v_ome := ome_do_militar(v_mil);
  elsif v_reg ? 'ome_id' then
    v_ome := (v_reg->>'ome_id')::int;
  end if;

  insert into auditoria (usuario_id, tabela, operacao, registro_id, militar_id, ome_id, antes, depois, origem)
  values (auth.uid(), tg_table_name, tg_op, v_id, v_mil, v_ome, v_old, v_new,
          coalesce(nullif(current_setting('app.origem', true), ''), 'tela'));
  return coalesce(new, old);
end $$;

-- =====================================================================
-- 3. DADOS DE SAÚDE: só por função, com registro de acesso
-- =====================================================================
create table if not exists acesso_sensivel (
  id              bigint generated always as identity primary key,
  momento         timestamptz not null default now(),
  usuario_id      uuid not null,
  militar_id      uuid,
  afastamento_id  uuid,
  acao            text not null    -- CONSULTA | GRAVACAO
);
create index if not exists acesso_sensivel_momento_idx on acesso_sensivel (momento desc);
alter table acesso_sensivel enable row level security;
drop policy if exists acesso_sensivel_ler on acesso_sensivel;
create policy acesso_sensivel_ler on acesso_sensivel for select to authenticated using ((select e_admin()));

drop policy if exists saude_ler on afastamento_saude;
drop policy if exists saude_inserir on afastamento_saude;
drop policy if exists saude_alterar on afastamento_saude;
drop policy if exists saude_excluir on afastamento_saude;
create policy saude_ler on afastamento_saude for select to authenticated using ((select e_admin()));

create or replace function tem_dados_saude(p_afastamento uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from afastamento_saude where afastamento_id = p_afastamento
                 and (natureza is not null or cid is not null))
$$;

create or replace function ver_dados_saude(p_afastamento uuid)
returns table (natureza natureza_saude, cid text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_mil uuid;
begin
  v_mil := militar_do_afastamento(p_afastamento);
  if v_mil is null or not pode_ver_saude() or not pode_ler_militar(v_mil) then
    raise exception 'Sem permissão para dados de saúde.';
  end if;
  insert into acesso_sensivel (usuario_id, militar_id, afastamento_id, acao)
  values (auth.uid(), v_mil, p_afastamento, 'CONSULTA');
  return query select s.natureza, s.cid from afastamento_saude s where s.afastamento_id = p_afastamento;
end $$;

create or replace function salvar_dados_saude(p_afastamento uuid, p_natureza natureza_saude, p_cid text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_mil uuid;
begin
  v_mil := militar_do_afastamento(p_afastamento);
  if v_mil is null or not pode_ver_saude() or not pode_editar_militar(v_mil) then
    raise exception 'Sem permissão para dados de saúde.';
  end if;
  if p_natureza is null and nullif(trim(coalesce(p_cid, '')), '') is null then
    delete from afastamento_saude where afastamento_id = p_afastamento;
  else
    insert into afastamento_saude (afastamento_id, natureza, cid)
    values (p_afastamento, p_natureza, nullif(upper(trim(p_cid)), ''))
    on conflict (afastamento_id) do update set natureza = excluded.natureza, cid = excluded.cid;
  end if;
  insert into acesso_sensivel (usuario_id, militar_id, afastamento_id, acao)
  values (auth.uid(), v_mil, p_afastamento, 'GRAVACAO');
end $$;

drop view if exists v_afastamento;
create view v_afastamento with (security_invoker = on) as
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
  case when t.exige_saude and (select pode_ver_saude()) then tem_dados_saude(a.id) end as tem_dados_saude
from afastamento a
join tipo_afastamento t on t.id = a.tipo_id
join militar m on m.id = a.militar_id
join posto_graduacao pg on pg.id = m.posto_id
join ome o on o.id = m.ome_id
left join secao s on s.id = m.secao_id;

-- =====================================================================
-- 4. DESLIGAMENTO SÓ PELA DGP, COM MOTIVOS
-- =====================================================================
create table if not exists motivo_desligamento (
  id        integer generated always as identity primary key,
  nome      text not null unique,
  situacao  situacao_militar not null check (situacao <> 'ATIVO'),
  ordem     integer not null default 999,
  ativo     boolean not null default true
);
alter table motivo_desligamento enable row level security;
drop policy if exists motivo_desligamento_ler on motivo_desligamento;
drop policy if exists motivo_desligamento_manter on motivo_desligamento;
create policy motivo_desligamento_ler on motivo_desligamento for select to authenticated using ((select usuario_ativo()));
create policy motivo_desligamento_manter on motivo_desligamento for all to authenticated
  using ((select e_gestao_global())) with check ((select e_gestao_global()));

insert into motivo_desligamento (nome, situacao, ordem) values
  ('Reserva remunerada a pedido', 'RESERVA', 1),
  ('Reserva remunerada de ofício', 'RESERVA', 2),
  ('Reforma', 'REFORMA', 3),
  ('Falecimento', 'FALECIDO', 4),
  ('Exoneração', 'EXCLUIDO', 5),
  ('Demissão', 'EXCLUIDO', 6),
  ('Licenciamento', 'EXCLUIDO', 7),
  ('Exclusão', 'EXCLUIDO', 8),
  ('Outro', 'OUTRO', 99)
on conflict (nome) do nothing;

alter table militar add column if not exists motivo_desligamento_id integer references motivo_desligamento(id);
alter table militar add column if not exists publicacao_desligamento text;

-- Agregação e cessão NÃO são desligamento: o militar continua no efetivo, mas indisponível na OME
insert into tipo_afastamento (codigo, nome, exige_saude, ordem) values
  ('AGREGACAO', 'Agregação', false, 20),
  ('CESSAO', 'Cessão / à disposição de outro órgão', false, 21)
on conflict (codigo) do nothing;

drop function if exists desligar_militar(uuid, situacao_militar, date, text, text);
create or replace function desligar_militar(
  p_militar uuid, p_motivo integer, p_data date, p_publicacao text, p_processo text, p_observacao text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_ome integer; v_sit situacao_militar; v_mot motivo_desligamento;
begin
  if not e_gestao_global() then raise exception 'Desligamento é registrado somente pela DGP.'; end if;
  select ome_id, situacao into v_ome, v_sit from militar where id = p_militar for update;
  if v_ome is null then raise exception 'Militar não encontrado.'; end if;
  if v_sit <> 'ATIVO' then raise exception 'Militar já está desligado (%).', v_sit; end if;
  select * into v_mot from motivo_desligamento where id = p_motivo;
  if v_mot.id is null then raise exception 'Informe o motivo do desligamento.'; end if;
  if p_data is null then raise exception 'Informe a data do desligamento.'; end if;
  if coalesce(trim(p_publicacao), '') = '' and coalesce(trim(p_processo), '') = '' then
    raise exception 'Informe a publicação (BG/DOE) ou o processo SEI.';
  end if;

  -- encerra afastamentos e situações funcionais em aberto na data do desligamento
  delete from afastamento where militar_id = p_militar and data_inicio >= p_data;
  update afastamento set dias = (p_data - data_inicio)
   where militar_id = p_militar and data_inicio < p_data and data_fim >= p_data;
  update registro_funcional set data_fim = p_data - 1
   where militar_id = p_militar and (data_fim is null or data_fim >= p_data)
     and (data_inicio is null or data_inicio < p_data);

  perform set_config('app.movimentacao', 'on', true);
  update militar set situacao = v_mot.situacao, data_situacao = p_data,
                     motivo_desligamento_id = v_mot.id,
                     publicacao_desligamento = nullif(trim(p_publicacao), ''),
                     documento_situacao = nullif(trim(p_processo), '')
  where id = p_militar;
  perform set_config('app.movimentacao', '', true);

  insert into movimentacao (militar_id, tipo, ome_origem_id, situacao_nova, data, documento, observacao, registrado_por)
  values (p_militar, 'DESLIGAMENTO', v_ome, v_mot.situacao, p_data,
          coalesce(nullif(trim(p_publicacao), ''), trim(p_processo)),
          v_mot.nome || coalesce(' — ' || nullif(trim(p_observacao), ''), ''), auth.uid());
end $$;

create or replace function reincluir_militar(
  p_militar uuid, p_ome integer, p_secao integer, p_data date, p_documento text, p_observacao text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_ome integer;
begin
  if not e_gestao_global() then raise exception 'Reinclusão é feita pela DGP.'; end if;
  if coalesce(trim(p_documento), '') = '' then raise exception 'Informe o documento da reinclusão.'; end if;
  select ome_id into v_ome from militar where id = p_militar for update;
  perform set_config('app.movimentacao', 'on', true);
  update militar set situacao = 'ATIVO', ome_id = p_ome, secao_id = p_secao,
                     data_situacao = coalesce(p_data, current_date), documento_situacao = p_documento,
                     motivo_desligamento_id = null, publicacao_desligamento = null
  where id = p_militar;
  perform set_config('app.movimentacao', '', true);
  insert into movimentacao (militar_id, tipo, ome_origem_id, ome_destino_id, secao_destino_id, situacao_nova, data, documento, observacao, registrado_por)
  values (p_militar, 'REINCLUSAO', v_ome, p_ome, p_secao, 'ATIVO', coalesce(p_data, current_date), p_documento, p_observacao, auth.uid());
end $$;

create or replace view v_desligamento with (security_invoker = on) as
select m.id as militar_id, m.matricula, m.nome, trim(pg.sigla || coalesce(' ' || m.quadro_sigla, '')) as posto_completo,
       pg.ordem as posto_ordem, m.ome_id, o.sigla as ome_sigla, m.situacao, m.data_situacao,
       md.nome as motivo, m.publicacao_desligamento, m.documento_situacao as processo_sei
from militar m
join posto_graduacao pg on pg.id = m.posto_id
join ome o on o.id = m.ome_id
left join motivo_desligamento md on md.id = m.motivo_desligamento_id
where m.situacao <> 'ATIVO';

-- =====================================================================
-- 5. SOLICITAÇÕES DA OME À DGP
-- =====================================================================
create table if not exists solicitacao (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('DESLIGAMENTO')),
  militar_id     uuid not null references militar(id) on delete cascade,
  ome_id         integer not null references ome(id),
  dados          jsonb not null default '{}',
  status         text not null default 'PENDENTE' check (status in ('PENDENTE','ATENDIDA','DEVOLVIDA','CANCELADA')),
  solicitado_por uuid not null default auth.uid(),
  solicitado_em  timestamptz not null default now(),
  decidido_por   uuid,
  decidido_em    timestamptz,
  resposta       text
);
create index if not exists solicitacao_status_idx on solicitacao (status, solicitado_em desc);
create unique index if not exists solicitacao_pendente_unica on solicitacao (militar_id, tipo) where status = 'PENDENTE';
alter table solicitacao enable row level security;
drop policy if exists solicitacao_ler on solicitacao;
create policy solicitacao_ler on solicitacao for select to authenticated
  using (ome_id = any (array(select unnest(minhas_omes()))));

drop trigger if exists auditoria_solicitacao on solicitacao;
create trigger auditoria_solicitacao after insert or update or delete on solicitacao
  for each row execute function trg_auditoria();

create or replace function solicitar_desligamento(
  p_militar uuid, p_motivo integer, p_data date, p_publicacao text, p_processo text, p_observacao text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ome integer; v_sit situacao_militar; v_id uuid;
begin
  select ome_id, situacao into v_ome, v_sit from militar where id = p_militar;
  if v_ome is null then raise exception 'Militar não encontrado.'; end if;
  if not pode_editar_ome(v_ome) then raise exception 'Sem permissão para esta OME.'; end if;
  if v_sit <> 'ATIVO' then raise exception 'Militar não está ativo.'; end if;
  if not exists (select 1 from motivo_desligamento where id = p_motivo) then raise exception 'Informe o motivo.'; end if;
  if exists (select 1 from solicitacao where militar_id = p_militar and tipo = 'DESLIGAMENTO' and status = 'PENDENTE') then
    raise exception 'Já existe pedido de desligamento pendente para este militar.';
  end if;
  insert into solicitacao (tipo, militar_id, ome_id, dados, solicitado_por)
  values ('DESLIGAMENTO', p_militar, v_ome,
          jsonb_build_object('motivo_id', p_motivo, 'data', p_data, 'publicacao', nullif(trim(p_publicacao), ''),
                             'processo', nullif(trim(p_processo), ''), 'observacao', nullif(trim(p_observacao), '')),
          auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function decidir_solicitacao(p_id uuid, p_acao text, p_resposta text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitacao;
begin
  select * into s from solicitacao where id = p_id for update;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if s.status <> 'PENDENTE' then raise exception 'Solicitação já foi decidida.'; end if;
  if p_acao = 'CANCELAR' then
    if not (pode_editar_ome(s.ome_id)) then raise exception 'Sem permissão.'; end if;
    update solicitacao set status = 'CANCELADA', decidido_por = auth.uid(), decidido_em = now(), resposta = p_resposta where id = p_id;
    return;
  end if;
  if not e_gestao_global() then raise exception 'Somente a DGP decide solicitações.'; end if;
  if p_acao = 'DEVOLVER' then
    if coalesce(trim(p_resposta), '') = '' then raise exception 'Informe o motivo da devolução.'; end if;
    update solicitacao set status = 'DEVOLVIDA', decidido_por = auth.uid(), decidido_em = now(), resposta = p_resposta where id = p_id;
  elsif p_acao = 'ATENDER' then
    perform desligar_militar(s.militar_id, (s.dados->>'motivo_id')::int, (s.dados->>'data')::date,
                             s.dados->>'publicacao', s.dados->>'processo', s.dados->>'observacao');
    update solicitacao set status = 'ATENDIDA', decidido_por = auth.uid(), decidido_em = now(), resposta = p_resposta where id = p_id;
  else
    raise exception 'Ação inválida.';
  end if;
end $$;

create or replace view v_solicitacao with (security_invoker = on) as
select s.*, m.matricula, m.nome, trim(pg.sigla || coalesce(' ' || m.quadro_sigla, '')) as posto_completo,
       o.sigla as ome_sigla, md.nome as motivo_nome,
       nome_usuario(s.solicitado_por) as solicitado_por_nome, nome_usuario(s.decidido_por) as decidido_por_nome
from solicitacao s
join militar m on m.id = s.militar_id
join posto_graduacao pg on pg.id = m.posto_id
join ome o on o.id = s.ome_id
left join motivo_desligamento md on md.id = (s.dados->>'motivo_id')::int;

-- =====================================================================
-- 6. CONFERÊNCIA MENSAL
-- =====================================================================
create table if not exists conferencia (
  competencia    date not null check (competencia = date_trunc('month', competencia)::date),
  militar_id     uuid not null references militar(id) on delete cascade,
  ome_id         integer not null references ome(id),
  conferido_por  uuid not null default auth.uid(),
  conferido_em   timestamptz not null default now(),
  primary key (competencia, militar_id)
);
create index if not exists conferencia_ome_idx on conferencia (competencia, ome_id);
alter table conferencia enable row level security;
drop policy if exists conferencia_ler on conferencia;
create policy conferencia_ler on conferencia for select to authenticated
  using (ome_id = any (array(select unnest(minhas_omes()))));

create or replace function conferir_militares(p_competencia date, p_militares uuid[], p_conferido boolean default true)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_comp date := date_trunc('month', p_competencia)::date; v_n integer := 0; r record;
begin
  if exists (select 1 from fechamento_mensal where competencia = v_comp) and not e_gestao_global() then
    raise exception 'Esta competência já foi fechada pela DGP.';
  end if;
  for r in select id, ome_id from militar where id = any (p_militares) and situacao = 'ATIVO' loop
    if not pode_editar_ome(r.ome_id) then raise exception 'Sem permissão para conferir militares desta OME.'; end if;
    if p_conferido then
      insert into conferencia (competencia, militar_id, ome_id, conferido_por)
      values (v_comp, r.id, r.ome_id, auth.uid())
      on conflict (competencia, militar_id) do update
        set conferido_por = excluded.conferido_por, conferido_em = now(), ome_id = excluded.ome_id;
    else
      delete from conferencia where competencia = v_comp and militar_id = r.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

alter table entrega_mensal add column if not exists nao_conferidos integer;

create or replace function confirmar_entrega(p_ome integer, p_competencia date, p_observacao text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_comp date := date_trunc('month', p_competencia)::date; v_falta integer;
begin
  if not pode_editar_ome(p_ome) then raise exception 'Sem permissão para esta OME.'; end if;
  if exists (select 1 from fechamento_mensal where competencia = v_comp) and not e_gestao_global() then
    raise exception 'Esta competência já foi fechada pela DGP.';
  end if;
  select count(*) into v_falta
  from militar m
  where m.ome_id = p_ome and m.situacao = 'ATIVO'
    and not exists (select 1 from conferencia c where c.competencia = v_comp and c.militar_id = m.id);
  if v_falta > 0 and coalesce(trim(p_observacao), '') = '' then
    raise exception 'Há % militar(es) não conferido(s). Confira todos ou informe a justificativa.', v_falta;
  end if;
  insert into entrega_mensal (ome_id, competencia, confirmado_por, efetivo, observacao, nao_conferidos)
  values (p_ome, v_comp, auth.uid(),
          (select count(*) from militar where ome_id = p_ome and situacao = 'ATIVO'), nullif(trim(p_observacao), ''), v_falta)
  on conflict (ome_id, competencia) do update
     set confirmado_por = excluded.confirmado_por, confirmado_em = now(),
         efetivo = excluded.efetivo, observacao = excluded.observacao, nao_conferidos = excluded.nao_conferidos;
end $$;

drop function if exists situacao_entregas(date);
create or replace function situacao_entregas(p_competencia date)
returns table (ome_id integer, ome_sigla text, efetivo bigint, conferidos bigint, prazo date,
               confirmado_em timestamptz, confirmado_por text, situacao text, ultima_alteracao timestamptz,
               observacao text)
language sql stable security definer set search_path = public as $$
  with comp as (select date_trunc('month', p_competencia)::date as c, prazo_entrega(p_competencia) as prazo),
  ef as (select m.ome_id, count(*) as efetivo,
                count(c.militar_id) as conferidos
         from militar m cross join comp
         left join conferencia c on c.militar_id = m.id and c.competencia = comp.c
         where m.situacao = 'ATIVO' group by m.ome_id),
  ua as (select a.ome_id, max(a.momento) as ultima from auditoria a group by a.ome_id)
  select o.id, o.sigla, coalesce(ef.efetivo, 0), coalesce(ef.conferidos, 0), comp.prazo,
         e.confirmado_em, nome_usuario(e.confirmado_por),
         case
           when e.confirmado_em is null and current_date > comp.prazo then 'ATRASADA'
           when e.confirmado_em is null then 'PENDENTE'
           when e.confirmado_em::date > comp.prazo then 'ENTREGUE COM ATRASO'
           else 'ENTREGUE NO PRAZO' end,
         ua.ultima, e.observacao
  from ome o cross join comp
  left join ef on ef.ome_id = o.id
  left join ua on ua.ome_id = o.id
  left join entrega_mensal e on e.ome_id = o.id and e.competencia = comp.c
  where o.ativo and o.id = any (minhas_omes())
  order by o.ordem, o.sigla
$$;

-- =====================================================================
-- 7. ATUALIZAÇÃO EM LOTE (planilha da OME)
-- =====================================================================
-- p_militares: [{id, secao_id?, atividade?, nome_guerra?, email?, telefone1?, telefone2?, endereco?, ano_ingresso?}]
--   (só as chaves presentes são alteradas)
-- p_formacoes: [{militar_id, nivel_id, area}]
-- p_afastamentos: [{militar_id, tipo_id, data_inicio, dias, processo_sei, observacao}]
-- Roda com as permissões de quem chama (RLS vale) e numa única transação.
create or replace function aplicar_lote(
  p_ome integer, p_militares jsonb, p_formacoes jsonb, p_afastamentos jsonb, p_conferir_competencia date default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare x jsonb; n_mil int := 0; n_form int := 0; n_af int := 0; n_af_dup int := 0; n_conf int := 0; v_ids uuid[] := '{}';
begin
  if not pode_editar_ome(p_ome) then raise exception 'Sem permissão para esta OME.'; end if;
  perform set_config('app.origem', 'planilha', true);

  for x in select * from jsonb_array_elements(coalesce(p_militares, '[]')) loop
    if not exists (select 1 from militar where id = (x->>'id')::uuid and ome_id = p_ome and situacao = 'ATIVO') then
      raise exception 'Militar % não pertence à OME.', x->>'id';
    end if;
    update militar set
      secao_id    = case when x ? 'secao_id'    then nullif(x->>'secao_id', '')::int else secao_id end,
      atividade   = case when x ? 'atividade'   then nullif(x->>'atividade', '')::atividade_tipo else atividade end,
      nome_guerra = case when x ? 'nome_guerra' then nullif(x->>'nome_guerra', '') else nome_guerra end,
      email       = case when x ? 'email'       then nullif(x->>'email', '') else email end,
      telefone1   = case when x ? 'telefone1'   then nullif(x->>'telefone1', '') else telefone1 end,
      telefone2   = case when x ? 'telefone2'   then nullif(x->>'telefone2', '') else telefone2 end,
      endereco    = case when x ? 'endereco'    then nullif(x->>'endereco', '') else endereco end,
      ano_ingresso= case when x ? 'ano_ingresso'then nullif(x->>'ano_ingresso', '')::smallint else ano_ingresso end
    where id = (x->>'id')::uuid;
    n_mil := n_mil + 1;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_formacoes, '[]')) loop
    insert into formacao (militar_id, nivel_id, area)
    values ((x->>'militar_id')::uuid, (x->>'nivel_id')::smallint, nullif(x->>'area', ''));
    n_form := n_form + 1;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_afastamentos, '[]')) loop
    if exists (select 1 from afastamento where militar_id = (x->>'militar_id')::uuid
               and tipo_id = (x->>'tipo_id')::int and data_inicio = (x->>'data_inicio')::date) then
      n_af_dup := n_af_dup + 1;
    else
      insert into afastamento (militar_id, tipo_id, data_inicio, dias, processo_sei, observacao)
      values ((x->>'militar_id')::uuid, (x->>'tipo_id')::int, (x->>'data_inicio')::date, (x->>'dias')::int,
              nullif(x->>'processo_sei', ''), nullif(x->>'observacao', ''));
      n_af := n_af + 1;
    end if;
  end loop;

  if p_conferir_competencia is not null then
    select coalesce(array_agg((e->>'id')::uuid), '{}') into v_ids from jsonb_array_elements(coalesce(p_militares, '[]')) e;
    n_conf := conferir_militares(p_conferir_competencia, v_ids, true);
  end if;

  perform set_config('app.origem', '', true);
  return jsonb_build_object('militares', n_mil, 'formacoes', n_form, 'afastamentos', n_af,
                            'afastamentos_repetidos', n_af_dup, 'conferidos', n_conf);
end $$;

-- =====================================================================
-- 8. QOD MENSAL
-- =====================================================================
create table if not exists qod (
  id             integer generated always as identity primary key,
  competencia    date not null check (competencia = date_trunc('month', competencia)::date),
  ome_id         integer not null references ome(id) on delete cascade,
  posto_id       smallint not null references posto_graduacao(id),
  quadro_sigla   text references quadro(sigla),
  previsto       integer not null check (previsto >= 0),
  documento      text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create unique index if not exists qod_unico on qod (competencia, ome_id, posto_id, coalesce(quadro_sigla, ''));
alter table qod enable row level security;
drop policy if exists qod_ler on qod;
drop policy if exists qod_manter on qod;
create policy qod_ler on qod for select to authenticated using ((select usuario_ativo()));
create policy qod_manter on qod for all to authenticated
  using ((select e_gestao_global())) with check ((select e_gestao_global()));

create or replace function qod_competencia_vigente(p_competencia date) returns date
language sql stable set search_path = public as $$
  select max(competencia) from qod where competencia <= date_trunc('month', p_competencia)::date
$$;

-- Previsto x existente por OME/posto(/quadro). Competência fechada usa a fotografia do fechamento.
create or replace function qod_comparativo(p_competencia date default null)
returns table (ome_id integer, ome_sigla text, ome_ordem integer, posto_id smallint, posto_sigla text,
               posto_ordem smallint, quadro_sigla text, previsto integer, existente integer, afastados integer)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_comp date := date_trunc('month', coalesce(p_competencia, competencia_atual()))::date;
        v_vig date; v_fechada boolean; v_omes integer[] := minhas_omes();
begin
  v_vig := qod_competencia_vigente(v_comp);
  v_fechada := exists (select 1 from fechamento_mensal f where f.competencia = v_comp);
  return query
  with q as (
    select qd.ome_id, qd.posto_id, qd.quadro_sigla, qd.previsto from qod qd where qd.competencia = v_vig
  ),
  base as (
    select m.ome_id, m.posto_id, m.quadro_sigla, m.afastado from (
      select vm.ome_id, vm.posto_id, vm.quadro_sigla, false as afastado from militar vm
       where not v_fechada and vm.situacao = 'ATIVO'
      union all
      select fm.ome_id, (fm.dados->>'posto_id')::smallint, fm.dados->>'quadro_sigla', false
        from fechamento_militar fm where v_fechada and fm.competencia = v_comp
    ) m
  ),
  afs as (
    select m.ome_id, m.posto_id, m.quadro_sigla
    from militar m join afastamento a on a.militar_id = m.id
    where not v_fechada and m.situacao = 'ATIVO' and current_date between a.data_inicio and a.data_fim
    group by m.id, m.ome_id, m.posto_id, m.quadro_sigla
    union all
    select fm.ome_id, (fm.dados->>'posto_id')::smallint, fm.dados->>'quadro_sigla'
    from fechamento_militar fm where v_fechada and fm.competencia = v_comp and (fm.dados->>'afastado_hoje')::boolean
  ),
  -- se o QOD separa um posto por quadro (QOC/QOA), o existente desse posto é separado em todas as OMEs
  gran as (select distinct q.posto_id from q where q.quadro_sigla is not null),
  e as (
    select b.ome_id, b.posto_id,
           case when g.posto_id is not null then b.quadro_sigla end as quadro_k, count(*)::int as existente
    from base b left join gran g on g.posto_id = b.posto_id
    group by 1, 2, 3
  ),
  a as (
    select b.ome_id, b.posto_id,
           case when g.posto_id is not null then b.quadro_sigla end as quadro_k, count(*)::int as afastados
    from afs b left join gran g on g.posto_id = b.posto_id
    group by 1, 2, 3
  ),
  j as (
    select coalesce(q.ome_id, e.ome_id) as ome_id, coalesce(q.posto_id, e.posto_id) as posto_id,
           coalesce(q.quadro_sigla, e.quadro_k) as quadro_sigla,
           coalesce(q.previsto, 0) as previsto, coalesce(e.existente, 0) as existente
    from q full join e on e.ome_id = q.ome_id and e.posto_id = q.posto_id
                      and coalesce(e.quadro_k, '') = coalesce(q.quadro_sigla, '')
  )
  select j.ome_id, o.sigla, o.ordem, j.posto_id, pg.sigla, pg.ordem, j.quadro_sigla,
         j.previsto, j.existente, coalesce(a.afastados, 0)
  from j
  join ome o on o.id = j.ome_id
  join posto_graduacao pg on pg.id = j.posto_id
  left join a on a.ome_id = j.ome_id and a.posto_id = j.posto_id and coalesce(a.quadro_k, '') = coalesce(j.quadro_sigla, '')
  where j.ome_id = any (v_omes)
  order by o.ordem, o.sigla, pg.ordem, j.quadro_sigla;
end $$;

-- Impacto de uma transferência no QOD (origem e destino), sem expor nomes
create or replace function qod_impacto(p_militar uuid, p_ome_destino integer) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_mil militar; v_vig date; r jsonb := '{}';
  v_o integer; v_d integer; q_o integer; q_d integer; v_gran_o boolean; v_gran_d boolean;
begin
  if not usuario_ativo() then return null; end if;
  select * into v_mil from militar where id = p_militar;
  if v_mil.id is null then return null; end if;
  v_vig := qod_competencia_vigente(competencia_atual());
  if v_vig is null then return jsonb_build_object('sem_qod', true); end if;
  v_gran_o := exists (select 1 from qod where competencia = v_vig and posto_id = v_mil.posto_id and quadro_sigla is not null);
  v_gran_d := v_gran_o;
  select coalesce(sum(previsto), 0) into q_o from qod where competencia = v_vig and ome_id = v_mil.ome_id and posto_id = v_mil.posto_id
     and (not v_gran_o or quadro_sigla is not distinct from v_mil.quadro_sigla);
  select coalesce(sum(previsto), 0) into q_d from qod where competencia = v_vig and ome_id = p_ome_destino and posto_id = v_mil.posto_id
     and (not v_gran_d or quadro_sigla is not distinct from v_mil.quadro_sigla);
  select count(*) into v_o from militar where situacao = 'ATIVO' and ome_id = v_mil.ome_id and posto_id = v_mil.posto_id
     and (not v_gran_o or quadro_sigla is not distinct from v_mil.quadro_sigla);
  select count(*) into v_d from militar where situacao = 'ATIVO' and ome_id = p_ome_destino and posto_id = v_mil.posto_id
     and (not v_gran_d or quadro_sigla is not distinct from v_mil.quadro_sigla);
  return jsonb_build_object(
    'posto', (select trim(sigla || coalesce(' ' || v_mil.quadro_sigla, '')) from posto_graduacao where id = v_mil.posto_id),
    'origem', jsonb_build_object('sigla', (select sigla from ome where id = v_mil.ome_id), 'previsto', q_o, 'antes', v_o, 'depois', v_o - 1),
    'destino', jsonb_build_object('sigla', (select sigla from ome where id = p_ome_destino), 'previsto', q_d, 'antes', v_d, 'depois', v_d + 1));
end $$;

-- Grava o QOD de uma competência (substitui o que houver nela)
create or replace function qod_salvar(p_competencia date, p_linhas jsonb, p_documento text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare v_comp date := date_trunc('month', p_competencia)::date; n integer;
begin
  if not e_gestao_global() then raise exception 'Somente a DGP mantém o QOD.'; end if;
  delete from qod where competencia = v_comp;
  insert into qod (competencia, ome_id, posto_id, quadro_sigla, previsto, documento, atualizado_por)
  select v_comp, (l->>'ome_id')::int, (l->>'posto_id')::smallint, nullif(l->>'quadro_sigla', ''),
         (l->>'previsto')::int, nullif(trim(coalesce(p_documento, '')), ''), auth.uid()
  from jsonb_array_elements(p_linhas) l
  where coalesce((l->>'previsto')::int, 0) > 0;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function qod_historico(p_ome integer default null)
returns table (competencia date, previsto bigint, existente bigint)
language sql stable security definer set search_path = public as $$
  with comps as (
    select distinct competencia from qod
    union select competencia from fechamento_mensal
  )
  select c.competencia,
         (select sum(q.previsto) from qod q where q.competencia = qod_competencia_vigente(c.competencia)
            and (p_ome is null or q.ome_id = p_ome) and q.ome_id = any (minhas_omes())),
         (select count(*) from fechamento_militar f where f.competencia = c.competencia
            and (p_ome is null or f.ome_id = p_ome) and f.ome_id = any (minhas_omes()))
  from comps c
  order by c.competencia
$$;

-- =====================================================================
-- 9. PENDÊNCIAS (alertas dentro do sistema)
-- =====================================================================
create or replace function minhas_pendencias(p_ome integer default null)
returns table (chave text, gravidade text, titulo text, detalhe text, qtd integer, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_comp date := competencia_atual(); v_prazo date := prazo_entrega(competencia_atual());
  v_ed integer[] := minhas_omes_edicao(); v_global boolean := e_gestao_global(); n integer;
begin
  if p_ome is not null then v_ed := array(select unnest(v_ed) intersect select p_ome); end if;
  if coalesce(array_length(v_ed, 1), 0) = 0 then return; end if;

  -- entrega mensal
  select count(*) into n from ome o
  where o.ativo and o.id = any (v_ed)
    and exists (select 1 from militar m where m.ome_id = o.id and m.situacao = 'ATIVO')
    and not exists (select 1 from entrega_mensal e where e.ome_id = o.id and e.competencia = v_comp);
  if n > 0 then
    return query select 'entrega', case when current_date > v_prazo then 'alta' when v_prazo - current_date <= 5 then 'media' else 'info' end,
      case when v_global and p_ome is null then n || ' OME(s) sem entrega mensal confirmada' else 'Entrega mensal não confirmada' end,
      'Competência ' || to_char(v_comp, 'MM/YYYY') || ' — prazo ' || to_char(v_prazo, 'DD/MM/YYYY'), n, '/entregas';
  end if;

  -- conferência (só para quem confere a própria OME)
  if not v_global or p_ome is not null then
    select count(*) into n from militar m
    where m.ome_id = any (v_ed) and m.situacao = 'ATIVO'
      and not exists (select 1 from conferencia c where c.competencia = v_comp and c.militar_id = m.id);
    if n > 0 then
      return query select 'conferencia', case when v_prazo - current_date <= 5 then 'media' else 'info' end,
        n || ' militar(es) ainda não conferido(s)', 'Conferência mensal da competência ' || to_char(v_comp, 'MM/YYYY'), n, '/conferencia';
    end if;
  end if;

  -- retornos nos próximos 3 dias
  select count(distinct a.militar_id) into n from afastamento a join militar m on m.id = a.militar_id
  where m.ome_id = any (v_ed) and m.situacao = 'ATIVO' and a.data_fim between current_date and current_date + 3;
  if n > 0 then
    return query select 'retornos', 'info', n || ' retorno(s) de afastamento em até 3 dias', 'Prever escala e apresentação', n, '/afastamentos?aba=retornos';
  end if;

  -- situações funcionais vencendo em 30 dias
  select count(*) into n from registro_funcional r join militar m on m.id = r.militar_id
  where m.ome_id = any (v_ed) and m.situacao = 'ATIVO' and r.data_fim between current_date and current_date + 30;
  if n > 0 then
    return query select 'situacoes', 'media', n || ' readaptação/horário especial/acumulação vencendo em 30 dias',
      'Providenciar renovação ou encerramento', n, '/relatorios?r=situacoes';
  end if;

  -- LTS em curso há mais de 90 dias
  select count(distinct a.militar_id) into n from afastamento a
  join tipo_afastamento t on t.id = a.tipo_id and t.codigo = 'LTS'
  join militar m on m.id = a.militar_id
  where m.ome_id = any (v_ed) and m.situacao = 'ATIVO' and current_date between a.data_inicio and a.data_fim
    and a.data_inicio <= current_date - 90;
  if n > 0 then
    return query select 'lts_longa', 'media', n || ' militar(es) em LTS há mais de 90 dias',
      'Verificar necessidade de junta / acompanhamento', n, '/afastamentos?tipo=LTS';
  end if;

  -- cadastro sem seção
  select count(*) into n from militar m where m.ome_id = any (v_ed) and m.situacao = 'ATIVO' and m.secao_id is null;
  if n > 0 then
    return query select 'sem_secao', 'info', n || ' militar(es) sem seção definida', 'Completar a lotação', n, '/efetivo?secao=-';
  end if;

  -- solicitações
  if v_global then
    select count(*) into n from solicitacao s where s.status = 'PENDENTE' and s.ome_id = any (v_ed);
    if n > 0 then
      return query select 'solicitacoes', 'alta', n || ' pedido(s) de desligamento aguardando a DGP', 'Atender ou devolver', n, '/desligamentos';
    end if;
    -- competência anterior com prazo vencido e não fechada
    if current_date > prazo_entrega((v_comp - interval '1 month')::date)
       and not exists (select 1 from fechamento_mensal f where f.competencia = (v_comp - interval '1 month')::date) then
      return query select 'fechamento', 'media', 'Competência ' || to_char((v_comp - interval '1 month')::date, 'MM/YYYY') || ' não fechada',
        'Gerar a fotografia do mês em Entrega mensal', 1, '/entregas';
    end if;
    if not exists (select 1 from qod where competencia = v_comp) then
      return query select 'qod', 'info', 'QOD da competência ' || to_char(v_comp, 'MM/YYYY') || ' não lançado',
        case when qod_competencia_vigente(v_comp) is null then 'Nenhum QOD cadastrado' else 'Usando o QOD de ' || to_char(qod_competencia_vigente(v_comp), 'MM/YYYY') end,
        1, '/qod';
    end if;
  else
    select count(*) into n from solicitacao s where s.status = 'DEVOLVIDA' and s.ome_id = any (v_ed)
      and s.decidido_em > now() - interval '30 days';
    if n > 0 then
      return query select 'devolvidas', 'media', n || ' pedido(s) devolvido(s) pela DGP', 'Ver a resposta e corrigir', n, '/desligamentos';
    end if;
  end if;
end $$;

-- =====================================================================
-- 10. INDICADORES E BOLETIM
-- =====================================================================
create or replace function indicadores(p_competencia date default null, p_ome integer default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_comp date := date_trunc('month', coalesce(p_competencia, current_date))::date;
  v_ini date; v_fim date; v_dias integer; v_omes integer[] := minhas_omes();
  v_exist integer; v_prontos integer; v_previsto integer; v_dias_af numeric; r jsonb;
  v_omes_qod integer[]; v_exist_q integer; v_prontos_q integer;
  v_saude boolean := pode_ver_saude() or e_leitura_global();
begin
  if p_ome is not null then v_omes := array(select unnest(v_omes) intersect select p_ome); end if;
  v_ini := v_comp;
  v_fim := least((v_comp + interval '1 month - 1 day')::date, current_date);
  v_dias := greatest(v_fim - v_ini + 1, 1);

  select count(*) into v_exist from militar where situacao = 'ATIVO' and ome_id = any (v_omes);
  select count(*) into v_prontos from militar m where m.situacao = 'ATIVO' and m.ome_id = any (v_omes)
    and not exists (select 1 from afastamento a where a.militar_id = m.id and current_date between a.data_inicio and a.data_fim);
  -- disponibilidade/cobertura só sobre as OMEs que têm QOD lançado
  select coalesce(sum(previsto), 0), coalesce(array_agg(distinct ome_id), '{}') into v_previsto, v_omes_qod from qod
   where competencia = qod_competencia_vigente(v_comp) and ome_id = any (v_omes);
  select count(*) into v_exist_q from militar where situacao = 'ATIVO' and ome_id = any (v_omes_qod);
  select count(*) into v_prontos_q from militar m where m.situacao = 'ATIVO' and m.ome_id = any (v_omes_qod)
    and not exists (select 1 from afastamento a where a.militar_id = m.id and current_date between a.data_inicio and a.data_fim);

  -- dias de afastamento dentro do mês
  select coalesce(sum(least(a.data_fim, v_fim) - greatest(a.data_inicio, v_ini) + 1), 0) into v_dias_af
  from afastamento a join militar m on m.id = a.militar_id
  where m.situacao = 'ATIVO' and m.ome_id = any (v_omes) and a.data_inicio <= v_fim and a.data_fim >= v_ini;

  r := jsonb_build_object(
    'competencia', v_comp, 'periodo_inicio', v_ini, 'periodo_fim', v_fim,
    'existente', v_exist, 'prontos', v_prontos, 'previsto', v_previsto,
    'omes_com_qod', coalesce(array_length(v_omes_qod, 1), 0), 'existente_omes_qod', v_exist_q, 'prontos_omes_qod', v_prontos_q,
    'disponibilidade', case when v_previsto > 0 then round(100.0 * v_prontos_q / v_previsto, 1) end,
    'cobertura_qod', case when v_previsto > 0 then round(100.0 * v_exist_q / v_previsto, 1) end,
    'prontidao', case when v_exist > 0 then round(100.0 * v_prontos / v_exist, 1) end,
    'taxa_afastamento', case when v_exist > 0 then round(100.0 * v_dias_af / (v_exist * v_dias), 2) end,
    'dias_afastados', v_dias_af,
    'afastamento_por_tipo', coalesce((
      select jsonb_agg(x order by x.dias desc) from (
        select t.nome, sum(least(a.data_fim, v_fim) - greatest(a.data_inicio, v_ini) + 1)::int as dias,
               count(distinct a.militar_id)::int as militares
        from afastamento a join tipo_afastamento t on t.id = a.tipo_id join militar m on m.id = a.militar_id
        where m.situacao = 'ATIVO' and m.ome_id = any (v_omes) and a.data_inicio <= v_fim and a.data_fim >= v_ini
        group by t.nome) x), '[]'),
    'taxa_por_ome', coalesce((
      select jsonb_agg(x order by x.taxa desc nulls last) from (
        select o.sigla, count(distinct m.id)::int as efetivo,
               round(100.0 * coalesce(sum(case when a.id is not null then least(a.data_fim, v_fim) - greatest(a.data_inicio, v_ini) + 1 end), 0)
                     / nullif(count(distinct m.id) * v_dias, 0), 2) as taxa
        from militar m join ome o on o.id = m.ome_id
        left join afastamento a on a.militar_id = m.id and a.data_inicio <= v_fim and a.data_fim >= v_ini
        where m.situacao = 'ATIVO' and m.ome_id = any (v_omes)
        group by o.sigla) x), '[]'),
    'movimentacoes', jsonb_build_object(
      'inclusoes', (select count(*) from movimentacao mv where mv.tipo = 'INCLUSAO' and mv.documento is distinct from 'Carga inicial'
                      and mv.data between v_ini and v_fim and mv.ome_destino_id = any (v_omes)),
      'transferencias_entrada', (select count(*) from movimentacao mv where mv.tipo = 'TRANSFERENCIA' and mv.data between v_ini and v_fim
                      and mv.ome_destino_id = any (v_omes) and (p_ome is not null or not (mv.ome_origem_id = any (v_omes)))),
      'transferencias_saida', (select count(*) from movimentacao mv where mv.tipo = 'TRANSFERENCIA' and mv.data between v_ini and v_fim
                      and mv.ome_origem_id = any (v_omes) and (p_ome is not null or not (mv.ome_destino_id = any (v_omes)))),
      'transferencias_internas', case when p_ome is null then (select count(*) from movimentacao mv where mv.tipo = 'TRANSFERENCIA'
                      and mv.data between v_ini and v_fim and mv.ome_origem_id = any (v_omes) and mv.ome_destino_id = any (v_omes)) end,
      'desligamentos', (select count(*) from movimentacao mv where mv.tipo = 'DESLIGAMENTO' and mv.data between v_ini and v_fim
                      and mv.ome_origem_id = any (v_omes))),
    'qualidade', (select jsonb_build_object('completude_media', round(avg(completude)), 'fichas_completas', count(*) filter (where completude = 100),
                     'total', count(*)) from v_militar where situacao = 'ATIVO' and ome_id = any (v_omes)),
    'pontualidade', (select jsonb_build_object('no_prazo', count(*) filter (where e.confirmado_em::date <= prazo_entrega((v_comp - interval '1 month')::date)),
                       'total_omes', count(distinct o.id), 'competencia', (v_comp - interval '1 month')::date)
                     from ome o left join entrega_mensal e on e.ome_id = o.id and e.competencia = (v_comp - interval '1 month')::date
                     where o.ativo and o.id = any (v_omes)
                       and exists (select 1 from militar m where m.ome_id = o.id and m.situacao = 'ATIVO')),
    -- saúde: só agregado, só para quem pode, e oculto quando o grupo é pequeno (< 5)
    'saude', case when v_saude then (
       select case when count(*) < 5 then jsonb_build_object('oculto', true, 'motivo', 'menos de 5 casos')
              else jsonb_build_object('fisico', count(*) filter (where sa.natureza = 'FISICO'),
                                      'mental', count(*) filter (where sa.natureza = 'MENTAL'),
                                      'nao_informada', count(*) filter (where sa.natureza is null), 'total', count(*)) end
       from (select distinct on (a.militar_id) a.militar_id, s.natureza
             from afastamento a join tipo_afastamento t on t.id = a.tipo_id and t.exige_saude
             join militar m on m.id = a.militar_id
             left join afastamento_saude s on s.afastamento_id = a.id
             where m.situacao = 'ATIVO' and m.ome_id = any (v_omes) and a.data_inicio <= v_fim and a.data_fim >= v_ini) sa) end,
    'serie', coalesce((
      select jsonb_agg(x order by x.competencia) from (
        select c.competencia,
               (select count(*) from fechamento_militar f where f.competencia = c.competencia and f.ome_id = any (v_omes)) as existente,
               (select coalesce(sum(q.previsto), 0) from qod q where q.competencia = qod_competencia_vigente(c.competencia) and q.ome_id = any (v_omes)) as previsto,
               (select count(*) from fechamento_militar f where f.competencia = c.competencia and f.ome_id = any (v_omes)
                  and (f.dados->>'afastado_hoje')::boolean) as afastados
        from fechamento_mensal c where c.competencia >= v_comp - interval '12 months') x), '[]')
  );
  return r;
end $$;

-- Dados para o Boletim Mensal do Efetivo
create or replace function boletim(p_competencia date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_comp date := date_trunc('month', p_competencia)::date; v_fim date; v_omes integer[] := minhas_omes();
begin
  if not e_leitura_global() then raise exception 'O boletim consolidado é restrito à DGP e ao Comando.'; end if;
  v_fim := (v_comp + interval '1 month - 1 day')::date;
  return jsonb_build_object(
    'competencia', v_comp,
    'fechada', exists (select 1 from fechamento_mensal where competencia = v_comp),
    'fechamento', (select to_jsonb(f) from fechamento_mensal f where f.competencia = v_comp),
    'qod_competencia', qod_competencia_vigente(v_comp),
    'indicadores', indicadores(v_comp, null),
    'por_ome', coalesce((select jsonb_agg(x order by x.ordem, x.sigla) from (
        select q.ome_id, min(q.ome_sigla) as sigla, min(q.ome_ordem) as ordem, sum(q.previsto)::int as previsto,
               sum(q.existente)::int as existente, sum(q.afastados)::int as afastados
        from qod_comparativo(v_comp) q group by q.ome_id) x), '[]'),
    'por_posto', coalesce((select jsonb_agg(x order by x.ordem) from (
        select min(q.posto_sigla) as sigla, q.posto_ordem as ordem, sum(q.previsto)::int as previsto, sum(q.existente)::int as existente
        from qod_comparativo(v_comp) q group by q.posto_ordem) x), '[]'),
    'entregas', (select jsonb_agg(jsonb_build_object('sigla', s.ome_sigla, 'situacao', s.situacao, 'efetivo', s.efetivo))
                 from situacao_entregas(v_comp) s),
    'movimentacoes', coalesce((select jsonb_agg(x order by x.data, x.militar_nome) from (
        select mv.data, mv.tipo, mv.militar_posto, mv.militar_nome, oo.sigla as origem, od.sigla as destino,
               mv.situacao_nova, mv.documento
        from movimentacao mv left join ome oo on oo.id = mv.ome_origem_id left join ome od on od.id = mv.ome_destino_id
        where mv.data between v_comp and v_fim and mv.documento is distinct from 'Carga inicial') x), '[]')
  );
end $$;

-- =====================================================================
-- 11. BUSCA RÁPIDA
-- =====================================================================
create or replace function sem_acento(t text) returns text language sql immutable as $$
  select lower(translate(coalesce(t, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                                           'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
$$;

create or replace function buscar_militar(p_texto text)
returns table (id uuid, matricula text, nome text, nome_guerra text, posto_completo text, ome_sigla text, situacao situacao_militar)
language sql stable security invoker set search_path = public as $$
  select m.id, m.matricula, m.nome, m.nome_guerra, trim(pg.sigla || coalesce(' ' || m.quadro_sigla, '')), o.sigla, m.situacao
  from militar m join posto_graduacao pg on pg.id = m.posto_id join ome o on o.id = m.ome_id
  where length(trim(p_texto)) >= 2
    and (m.matricula like regexp_replace(p_texto, '\D', '', 'g') || '%' and length(regexp_replace(p_texto, '\D', '', 'g')) >= 3
         or sem_acento(m.nome) like '%' || sem_acento(trim(p_texto)) || '%'
         or sem_acento(m.nome_guerra) like '%' || sem_acento(trim(p_texto)) || '%'
         or m.matricula like trim(p_texto) || '%')
  order by (m.situacao = 'ATIVO') desc, pg.ordem, m.nome
  limit 15
$$;

-- =====================================================================
-- 12. ATUALIZAÇÃO MENSAL POR PDF (QOD e almanaque)
--     Os PDFs são lidos no navegador de quem importa (nada é processado
--     no servidor e os arquivos não ficam guardados). Aqui ficam só:
--     novas OMEs do QOD, o de-para de nomes do QOD, o histórico das
--     importações e a gravação das diferenças.
-- =====================================================================

-- OMEs que o QOD traz à parte (decisão DGP, 26/10/2026)
insert into ome (sigla, nome, tipo, ordem) values
  ('CG',  'Comando Geral',    'OUTRA', 28),
  ('SCG', 'Subcomando Geral', 'OUTRA', 29),
  ('CPP', null,               'OUTRA', 43)
on conflict (sigla) do nothing;

-- de-para: nome como aparece no QOD (normalizado) -> OME do sistema.
-- Nomes iguais à sigla (GBI, DGP...) e "Nº GB Cidade" são reconhecidos sem cadastro.
create table if not exists qod_alias (
  chave     text primary key,
  ome_id    integer not null references ome(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table qod_alias enable row level security;
drop policy if exists qod_alias_ler on qod_alias;
drop policy if exists qod_alias_manter on qod_alias;
create policy qod_alias_ler on qod_alias for select to authenticated using ((select usuario_ativo()));
create policy qod_alias_manter on qod_alias for all to authenticated
  using ((select e_gestao_global())) with check ((select e_gestao_global()));

insert into qod_alias (chave, ome_id)
select v.chave, o.id
from (values ('COMANDO GERAL', 'CG'), ('SUBCOMANDO GERAL', 'SCG'),
             ('DINTER I', 'DInter/1'), ('DINTER II', 'DInter/2'),
             ('CAT/ZM', 'CAT Zona da Mata'), ('CAT/AG', 'CAT Agreste'), ('CAT/SE', 'CAT Sertão')) v(chave, sigla)
join ome o on o.sigla = v.sigla
on conflict (chave) do nothing;

-- histórico das importações (o que foi lido e o que mudou; sem dados pessoais)
create table if not exists referencia_importacao (
  id            bigint generated always as identity primary key,
  tipo          text not null check (tipo in ('QOD', 'ALMANAQUE')),
  referencia    date not null,
  documento     text,
  resumo        jsonb not null default '{}',
  importado_em  timestamptz not null default now(),
  importado_por uuid default auth.uid()
);
create index if not exists referencia_importacao_tipo_idx on referencia_importacao (tipo, importado_em desc);
alter table referencia_importacao enable row level security;
drop policy if exists referencia_importacao_ler on referencia_importacao;
create policy referencia_importacao_ler on referencia_importacao for select to authenticated
  using ((select e_leitura_global()));

-- Militar: o dígito verificador só é conferido quando a matrícula é digitada ou alterada.
-- (antes, um cadastro antigo com exceção de dígito não podia ter nenhum outro campo editado)
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

  if (tg_op = 'INSERT' or new.matricula is distinct from old.matricula)
     and not matricula_valida(new.matricula) and auth.uid() is not null and not e_admin() then
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

-- Auditoria: a renumeração da antiguidade (que muda todo mês com o almanaque)
-- não gera registro; qualquer outra alteração continua registrada.
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
  if tg_op = 'UPDATE' and (v_old - 'atualizado_em' - 'atualizado_por' - 'ultimo_acesso' - 'ordem_antiguidade')
                        = (v_new - 'atualizado_em' - 'atualizado_por' - 'ultimo_acesso' - 'ordem_antiguidade') then
    return new;
  end if;
  v_reg := coalesce(v_new, v_old);
  v_id  := coalesce(v_reg->>'id', v_reg->>'afastamento_id', v_reg->>'militar_id', v_reg->>'perfil_id');

  if tg_table_name = 'militar' then
    v_mil := (v_reg->>'id')::uuid;
    v_ome := (v_reg->>'ome_id')::int;
  elsif v_reg ? 'militar_id' then
    v_mil := (v_reg->>'militar_id')::uuid;
    v_ome := coalesce((v_reg->>'ome_destino_id')::int, (v_reg->>'ome_id')::int, ome_do_militar(v_mil));
  elsif tg_table_name = 'afastamento_saude' then
    v_mil := militar_do_afastamento((v_reg->>'afastamento_id')::uuid);
    v_ome := ome_do_militar(v_mil);
  elsif v_reg ? 'ome_id' then
    v_ome := (v_reg->>'ome_id')::int;
  end if;

  insert into auditoria (usuario_id, tabela, operacao, registro_id, militar_id, ome_id, antes, depois, origem)
  values (auth.uid(), tg_table_name, tg_op, v_id, v_mil, v_ome, v_old, v_new,
          coalesce(nullif(current_setting('app.origem', true), ''), 'tela'));
  return coalesce(new, old);
end $$;

-- Entrega mensal: OME sem nenhum militar não tem o que entregar (CG, SCG e CPP até receberem efetivo)
create or replace function situacao_entregas(p_competencia date)
returns table (ome_id integer, ome_sigla text, efetivo bigint, conferidos bigint, prazo date,
               confirmado_em timestamptz, confirmado_por text, situacao text, ultima_alteracao timestamptz,
               observacao text)
language sql stable security definer set search_path = public as $$
  with comp as (select date_trunc('month', p_competencia)::date as c, prazo_entrega(p_competencia) as prazo),
  ef as (select m.ome_id, count(*) as efetivo,
                count(c.militar_id) as conferidos
         from militar m cross join comp
         left join conferencia c on c.militar_id = m.id and c.competencia = comp.c
         where m.situacao = 'ATIVO' group by m.ome_id),
  ua as (select a.ome_id, max(a.momento) as ultima from auditoria a group by a.ome_id)
  select o.id, o.sigla, coalesce(ef.efetivo, 0), coalesce(ef.conferidos, 0), comp.prazo,
         e.confirmado_em, nome_usuario(e.confirmado_por),
         case
           when e.confirmado_em is null and current_date > comp.prazo then 'ATRASADA'
           when e.confirmado_em is null then 'PENDENTE'
           when e.confirmado_em::date > comp.prazo then 'ENTREGUE COM ATRASO'
           else 'ENTREGUE NO PRAZO' end,
         ua.ultima, e.observacao
  from ome o cross join comp
  left join ef on ef.ome_id = o.id
  left join ua on ua.ome_id = o.id
  left join entrega_mensal e on e.ome_id = o.id and e.competencia = comp.c
  where o.ativo and o.id = any (minhas_omes())
    and (coalesce(ef.efetivo, 0) > 0 or e.confirmado_em is not null)
  order by o.ordem, o.sigla
$$;

-- QOD lido do PDF: grava o QOD da competência, aprende o de-para e registra a importação
create or replace function qod_importar(p_competencia date, p_linhas jsonb, p_documento text,
                                        p_aliases jsonb default '[]', p_resumo jsonb default '{}')
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not e_gestao_global() then raise exception 'Somente a DGP mantém o QOD.'; end if;
  perform set_config('app.origem', 'qod_pdf', true);
  insert into qod_alias (chave, ome_id)
  select upper(trim(a->>'chave')), (a->>'ome_id')::int
  from jsonb_array_elements(coalesce(p_aliases, '[]')) a
  where coalesce(trim(a->>'chave'), '') <> '' and (a->>'ome_id') is not null
  on conflict (chave) do update set ome_id = excluded.ome_id;
  n := qod_salvar(p_competencia, p_linhas, p_documento);
  insert into referencia_importacao (tipo, referencia, documento, resumo)
  values ('QOD', date_trunc('month', p_competencia)::date, nullif(trim(coalesce(p_documento, '')), ''),
          coalesce(p_resumo, '{}') || jsonb_build_object('linhas_gravadas', n));
  return n;
end $$;

-- Almanaque: aplica só os campos oficiais que mudaram (posto/graduação, quadro,
-- antiguidade, ano de ingresso, nome de guerra). Nunca muda OME, seção,
-- afastamentos ou situação; nunca inclui nem desliga ninguém.
-- p_alteracoes: [{id, posto_id?, quadro_sigla?, ordem_antiguidade?, ano_ingresso?, nome_guerra?}]
create or replace function aplicar_almanaque(p_referencia date, p_documento text, p_alteracoes jsonb,
                                             p_resumo jsonb default '{}')
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not e_gestao_global() then raise exception 'Somente a DGP aplica o almanaque.'; end if;
  perform set_config('app.origem', 'almanaque', true);
  update militar m set
    posto_id          = coalesce(x.posto_id, m.posto_id),
    quadro_sigla      = coalesce(nullif(x.quadro_sigla, ''), m.quadro_sigla),
    ordem_antiguidade = coalesce(x.ordem_antiguidade, m.ordem_antiguidade),
    ano_ingresso      = coalesce(x.ano_ingresso, m.ano_ingresso),
    nome_guerra       = coalesce(nullif(x.nome_guerra, ''), m.nome_guerra)
  from jsonb_to_recordset(coalesce(p_alteracoes, '[]'))
       as x(id uuid, posto_id smallint, quadro_sigla text, ordem_antiguidade integer, ano_ingresso smallint, nome_guerra text)
  where m.id = x.id and m.situacao = 'ATIVO';
  get diagnostics n = row_count;
  insert into referencia_importacao (tipo, referencia, documento, resumo)
  values ('ALMANAQUE', p_referencia, nullif(trim(coalesce(p_documento, '')), ''),
          coalesce(p_resumo, '{}') || jsonb_build_object('militares_atualizados', n));
  return n;
end $$;

revoke all on qod_alias, referencia_importacao from anon;
grant select, insert, update, delete on qod_alias to authenticated;
grant select on referencia_importacao to authenticated;
drop trigger if exists auditoria_qod_alias on qod_alias;
create trigger auditoria_qod_alias after insert or update or delete on qod_alias
  for each row execute function trg_auditoria();

-- =====================================================================
-- PERMISSÕES
-- =====================================================================
revoke all on versao_sistema, acesso_sensivel, motivo_desligamento, solicitacao, conferencia, qod,
              v_afastamento, v_desligamento, v_solicitacao from anon;
grant select on versao_sistema, acesso_sensivel, v_afastamento, v_desligamento, v_solicitacao, conferencia, solicitacao to authenticated;
grant select, insert, update, delete on motivo_desligamento, qod to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

do $$
declare t text;
begin
  foreach t in array array['motivo_desligamento','qod','conferencia']
  loop
    execute format('drop trigger if exists auditoria_%1$s on %1$I', t);
    execute format('create trigger auditoria_%1$s after insert or update or delete on %1$I
                    for each row execute function trg_auditoria()', t);
  end loop;
end $$;

commit;

-- estatísticas atualizadas para o planejador de consultas
analyze;

-- avisa a API (PostgREST) para recarregar as novas tabelas e funções imediatamente
notify pgrst, 'reload schema';

select 'Fase 1 aplicada com sucesso: versão ' || max(versao) as resultado from versao_sistema;
