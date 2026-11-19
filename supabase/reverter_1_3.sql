-- =====================================================================
-- REVERSÃO DA VERSÃO 1.3 (volta o banco para a versão 1.2)
-- Use SOMENTE se a 1.3 apresentar problema grave.
-- Preserva: militares, afastamentos, férias, QOD e tudo da 1.2.
-- Apaga: hierarquia de comando e regiões, municípios de OMEs e seções,
-- ordem dos quadros, consultas salvas e o dicionário de dados.
-- =====================================================================
set client_min_messages = warning;
begin;
do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.3') then
    raise exception 'A versão 1.3 não está aplicada neste banco.';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.4') then
    raise exception 'Reverta antes a versão 1.4 (supabase/reverter_1_4.sql).';
  end if;
end $$;

-- funções de acesso voltam à forma da 1.2 (sem OMEs subordinadas)
create or replace function minhas_omes() returns integer[]
language sql stable security definer set search_path = public as $$
  select case
    when papel_atual() in ('ADMIN','DGP','LEITOR_GERAL') then (select coalesce(array_agg(id), '{}') from ome)
    when papel_atual() is null then '{}'::integer[]
    else coalesce((select array_agg(ome_id) from perfil_ome where perfil_id = auth.uid()), '{}')
  end
$$;

create or replace function pode_ler_ome(p_ome integer) returns boolean
language sql stable security definer set search_path = public as $$
  select e_leitura_global()
      or (usuario_ativo() and exists (
            select 1 from perfil_ome where perfil_id = auth.uid() and ome_id = p_ome))
$$;

do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('meu_contexto()'::regprocedure);
  v_novo := replace(v_def,
    'or o.id = any (omes_com_subordinadas(array(select po.ome_id from perfil_ome po where po.perfil_id = p.id)))',
    'or exists (select 1 from perfil_ome po where po.perfil_id = p.id and po.ome_id = o.id)');
  execute v_novo;
end $$;

drop trigger if exists auditoria_catalogo_campo on catalogo_campo;
drop table if exists catalogo_campo;
drop function if exists trg_catalogo_antes();
drop table if exists consulta_salva;
drop function if exists trg_consulta_salva_antes();
drop function if exists antiguidade_lista();
drop function if exists omes_com_subordinadas(integer[]);
drop view if exists v_ome_regiao;
drop trigger if exists ome_ciclo on ome;
drop function if exists trg_ome_ciclo();
alter table ome drop constraint if exists ome_comando_diferente;
alter table ome drop column if exists comando_id;
alter table ome drop column if exists regional;
alter table ome drop column if exists municipio_ibge;
alter table secao drop column if exists municipio_ibge;
alter table quadro drop column if exists ordem;
drop function if exists norm_nome(text);
drop table if exists municipio;

delete from versao_sistema where versao = '1.3';
commit;
notify pgrst, 'reload schema';
select 'Versão 1.3 revertida: o banco está na versão 1.2' as resultado;
