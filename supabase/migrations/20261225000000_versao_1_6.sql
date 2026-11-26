-- =====================================================================
-- Sistema de Controle do Efetivo (DGP/CBMPE) — versão 1.6 (Férias)
--   * Inclusão de período pela DGP, também depois de publicado o PAF (militar sem previsão,
--     recém-incluído, aditamento): ferias_incluir(). Fica com origem INCLUSAO e a publicação informada.
--   * Reprogramação e interrupção lançadas e homologadas pela DGP num passo só:
--     ferias_reprogramar_homologar() (a mesma regra de ferias_reprogramar + homologação, numa transação).
--   * v_ferias ganha nº funcional, quadro, seção e situação da pessoa, para os relatórios
--     e para o arquivo de lote do SGP (layout da SAD).
-- Requer a versão 1.5. Uma transação; não apaga dados. Para desfazer: supabase/reverter_1_6.sql
-- =====================================================================
set client_min_messages = warning;
begin;

do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.5') then
    raise exception 'Aplique antes o 20261224000000_versao_1_5.sql (versão 1.5).';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.6') then
    raise exception 'A versão 1.6 já está aplicada neste banco: nada a fazer.';
  end if;
end $$;

insert into versao_sistema (versao) values ('1.6');

-- origem INCLUSAO: período lançado pela DGP fora da proposta (antes ou depois da publicação)
alter table ferias_periodo drop constraint if exists ferias_periodo_origem_check;
alter table ferias_periodo add constraint ferias_periodo_origem_check
  check (origem in ('PAF', 'REPROGRAMACAO', 'IMPORTACAO', 'INCLUSAO'));

-- =====================================================================
-- 1. INCLUIR PERÍODO (DGP)
--    PAF em elaboração: entra como proposta, somando-se às que a pessoa já tem.
--    PAF publicado: entra programado (vira afastamento), com publicação ou processo SEI.
-- =====================================================================
create or replace function ferias_incluir(p_militar uuid, p_civil uuid, p_exercicio smallint, p_periodos jsonb,
                                          p_publicacao text default null, p_processo text default null,
                                          p_excecao text default null, p_observacao text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ome integer; v_ex ferias_exercicio; v_ver jsonb; n jsonb; v_bloq integer;
begin
  if not e_gestao_global() then raise exception 'Férias são lançadas e alteradas somente pela DGP.'; end if;
  v_ome := ferias_ome_pessoa(p_militar, p_civil);
  if v_ome is null then raise exception 'Militar ou servidor não encontrado.'; end if;
  select * into v_ex from ferias_exercicio where ano = p_exercicio;
  if v_ex.ano is null then raise exception 'O exercício % do PAF não foi aberto. Abra-o em "Exercícios e regras".', p_exercicio; end if;
  if jsonb_array_length(coalesce(p_periodos, '[]')) = 0 then raise exception 'Informe ao menos um período.'; end if;
  if v_ex.situacao = 'PUBLICADO' and coalesce(trim(p_publicacao), '') = '' and coalesce(trim(p_processo), '') = '' then
    raise exception 'PAF % já publicado: informe a publicação (BGE/Nota) ou o processo SEI da inclusão.', p_exercicio;
  end if;
  v_ver := ferias_verificar(p_militar, p_civil, p_exercicio, p_periodos, '{}', 'INCLUSAO');
  v_bloq := ferias_bloqueios(v_ver);
  if v_bloq > 0 and coalesce(trim(p_excecao), '') = '' then
    raise exception 'Período fora das regras da Portaria 312: %. Para lançar mesmo assim, informe a justificativa da exceção.',
      (select string_agg(e->>'msg', ' | ') from jsonb_array_elements(v_ver) e where e->>'nivel' = 'bloqueio');
  end if;
  perform set_config('app.ferias', 'on', true);
  for n in select * from jsonb_array_elements(p_periodos) loop
    insert into ferias_periodo (exercicio, militar_id, civil_id, data_inicio, dias, previsto_inicio, situacao, origem,
                                excecao, excecao_aprovada_por, excecao_aprovada_em, processo_sei, publicacao, observacao)
    values (p_exercicio, p_militar, p_civil, (n->>'inicio')::date, (n->>'dias')::int,
            case when v_ex.situacao = 'PUBLICADO' then (n->>'inicio')::date end,
            case when v_ex.situacao = 'PUBLICADO' then 'PROGRAMADA' else 'PROPOSTA' end, 'INCLUSAO',
            case when v_bloq > 0 then trim(p_excecao) end,
            case when v_bloq > 0 then auth.uid() end, case when v_bloq > 0 then now() end,
            nullif(trim(coalesce(p_processo, '')), ''), nullif(trim(coalesce(p_publicacao, '')), ''),
            nullif(trim(coalesce(p_observacao, '')), ''));
  end loop;
  return v_ver;
end $$;

-- =====================================================================
-- 2. REPROGRAMAR / INTERROMPER E HOMOLOGAR NUM PASSO SÓ (DGP)
-- =====================================================================
create or replace function ferias_reprogramar_homologar(
  p_militar uuid, p_civil uuid, p_exercicio smallint, p_tipo text, p_motivo text, p_requerimento date,
  p_processo text, p_publicacao_ome text, p_cancelar uuid[], p_novos jsonb, p_publicacao_dgp text,
  p_interromper uuid default null, p_interrupcao_em date default null, p_excecao text default null, p_observacao text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not e_gestao_global() then raise exception 'Somente a DGP homologa reprogramações (art. 13, II).'; end if;
  if coalesce(trim(p_publicacao_dgp), '') = '' then raise exception 'Informe a publicação da homologação (BGE nº).'; end if;
  v_id := ferias_reprogramar(p_militar, p_civil, p_exercicio, p_tipo, p_motivo, p_requerimento, p_processo, p_publicacao_ome,
                             p_cancelar, p_novos, p_interromper, p_interrupcao_em, p_excecao, p_observacao);
  perform ferias_decidir_reprogramacao(v_id, 'HOMOLOGAR', p_publicacao_dgp, null);
  return v_id;
end $$;

revoke execute on function ferias_incluir(uuid, uuid, smallint, jsonb, text, text, text, text) from public, anon;
grant execute on function ferias_incluir(uuid, uuid, smallint, jsonb, text, text, text, text) to authenticated, service_role;
revoke execute on function ferias_reprogramar_homologar(uuid, uuid, smallint, text, text, date, text, text, uuid[], jsonb, text, uuid, date, text, text) from public, anon;
grant execute on function ferias_reprogramar_homologar(uuid, uuid, smallint, text, text, date, text, text, uuid[], jsonb, text, uuid, date, text, text) to authenticated, service_role;

-- =====================================================================
-- 3. v_ferias com os dados de que os relatórios e o lote do SGP precisam (colunas novas no fim)
-- =====================================================================
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
                                    order by f.data_inicio) end as parcela,
       m.numero_funcional,
       m.quadro_sigla,
       s.nome as secao_nome,
       case when m.id is not null then m.situacao::text when c.ativo then 'ATIVO' else 'INATIVO' end as situacao_pessoa
from ferias_periodo f
left join militar m on m.id = f.militar_id
left join posto_graduacao pg on pg.id = m.posto_id
left join servidor_civil c on c.id = f.civil_id
left join secao s on s.id = m.secao_id
join ome o on o.id = coalesce(m.ome_id, c.ome_id);

update catalogo_campo set edicao = 'Somente DGP (inclusão, reprogramação e interrupção; as OMEs consultam)'
 where campo = 'Períodos do PAF';

commit;
notify pgrst, 'reload schema';
select 'Versão 1.6 aplicada com sucesso' as resultado;
