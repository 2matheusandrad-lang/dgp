-- =====================================================================
-- REVERSÃO DA VERSÃO 1.6 (volta às férias da 1.5)
-- Não apaga períodos: os lançados como INCLUSAO passam a constar como PAF.
-- =====================================================================
set client_min_messages = warning;
begin;
do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.6') then
    raise exception 'A versão 1.6 não está aplicada neste banco.';
  end if;
end $$;

drop function if exists ferias_incluir(uuid, uuid, smallint, jsonb, text, text, text, text);
drop function if exists ferias_reprogramar_homologar(uuid, uuid, smallint, text, text, date, text, text, uuid[], jsonb, text, uuid, date, text, text);

select set_config('app.ferias', 'on', true);
update ferias_periodo set origem = 'PAF' where origem = 'INCLUSAO';
alter table ferias_periodo drop constraint if exists ferias_periodo_origem_check;
alter table ferias_periodo add constraint ferias_periodo_origem_check check (origem in ('PAF', 'REPROGRAMACAO', 'IMPORTACAO'));

drop view if exists v_ferias;
create or replace view v_ferias with (security_invoker = on) as
select f.*,
       case when f.militar_id is not null then 'MILITAR' else 'CIVIL' end as tipo_pessoa,
       coalesce(f.militar_id, f.civil_id) as pessoa_id,
       coalesce(m.matricula, c.matricula) as matricula,
       coalesce(m.nome, c.nome) as nome,
       m.nome_guerra,
       case when m.id is not null then trim(pg.sigla || coalesce(' ' || m.quadro_sigla, '')) else 'Civil' end as posto_completo,
       coalesce(pg.ordem, 99) as posto_ordem, m.ordem_antiguidade,
       coalesce(m.ome_id, c.ome_id) as ome_id, o.sigla as ome_sigla,
       case when f.situacao in ('CANCELADA', 'PROPOSTA', 'NAO_GOZADA') then f.situacao
            when f.situacao = 'INTERROMPIDA' then 'INTERROMPIDA'
            when current_date < f.data_inicio then 'A_GOZAR'
            when current_date > f.data_fim then 'GOZADA'
            else 'EM_GOZO' end as status,
       case when f.situacao = 'INTERROMPIDA' then coalesce(f.dias_gozados, 0) else f.dias end as dias_efetivos,
       case when f.situacao in ('CANCELADA', 'NAO_GOZADA') then null
            else row_number() over (partition by coalesce(f.militar_id, f.civil_id), f.exercicio,
                                    (f.situacao in ('CANCELADA', 'NAO_GOZADA'))
                                    order by f.data_inicio) end as parcela
from ferias_periodo f
left join militar m on m.id = f.militar_id
left join posto_graduacao pg on pg.id = m.posto_id
left join servidor_civil c on c.id = f.civil_id
join ome o on o.id = coalesce(m.ome_id, c.ome_id);
revoke all on v_ferias from anon;
grant select on v_ferias to authenticated;

update catalogo_campo set edicao = 'Somente DGP (as OMEs consultam)' where campo = 'Períodos do PAF';
delete from versao_sistema where versao = '1.6';
commit;
notify pgrst, 'reload schema';
select 'Versão 1.6 revertida' as resultado;
