-- =====================================================================
-- Sistema de Controle do Efetivo (DGP/CBMPE) — versão 1.5
-- Refinamentos (decisão da DGP de 19/11/2026):
--   * Regiões oficiais. DIM, DINTER I, DINTER II e DIESP são OMEs e também dão nome a uma região:
--       DIM ........ GBI, GBMar, GBS, GBAPH
--       DINTER I ... 1º, 2º, 6º e 7º GB
--       DINTER II .. 3º, 4º, 5º e 9º GB
--       DIESP ...... CAT RMR, CAT Agreste, CAT Zona da Mata, CAT Sertão
--     (a cadeia de comando também dá às regionais a consulta, sem edição, das OMEs subordinadas)
--   * Pendências (sino) só com o que cada um resolve: a OME vê entrega mensal, conferência e militares
--     sem seção; a DGP vê o restante (férias, situações funcionais, LTS longa, QOD, fechamento...).
--     Saem os avisos de pedidos devolvidos (os pedidos acabaram na 1.4.1) e os retornos de afastamento
--     (já estão no painel).
--
-- Requer a versão 1.4.1. Uma transação; não apaga dados. Para desfazer: supabase/reverter_1_5.sql
-- =====================================================================
set client_min_messages = warning;
begin;

do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.4.1') then
    raise exception 'Aplique antes o 20261223000000_versao_1_4_1.sql (versão 1.4.1).';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.5') then
    raise exception 'A versão 1.5 já está aplicada neste banco: nada a fazer.';
  end if;
end $$;

insert into versao_sistema (versao) values ('1.5');

-- =====================================================================
-- 1. REGIÕES E CADEIA DE COMANDO
--    As siglas são comparadas sem acento, espaço, barra ou "º" (1ºGB = 1 GB; CAT/RMR = CAT RMR).
-- =====================================================================
create or replace function pg_temp.chave(p text) returns text language sql immutable as $$
  select regexp_replace(translate(upper(coalesce(p, '')), 'ÁÀÂÃÉÊÍÓÔÕÚÜÇ', 'AAAAEEIOOOUUC'), '[^A-Z0-9]', '', 'g')
$$;

create temp table regiao_mapa (filho text, pai text) on commit drop;
insert into regiao_mapa values
  ('GBI', 'DIM'), ('GBMAR', 'DIM'), ('GBS', 'DIM'), ('GBAPH', 'DIM'),
  ('1GB', 'DINTER1'), ('2GB', 'DINTER1'), ('6GB', 'DINTER1'), ('7GB', 'DINTER1'),
  ('3GB', 'DINTER2'), ('4GB', 'DINTER2'), ('5GB', 'DINTER2'), ('9GB', 'DINTER2'),
  ('CATRMR', 'DIESP'), ('CATAGRESTE', 'DIESP'), ('CATZONADAMATA', 'DIESP'), ('CATZM', 'DIESP'), ('CATSERTAO', 'DIESP');

do $$
declare n_reg integer; n_sub integer;
begin
  select count(*) into n_reg from ome where pg_temp.chave(sigla) in ('DIM', 'DINTER1', 'DINTER2', 'DIESP');
  if n_reg < 4 then
    raise exception 'Não encontrei as 4 OMEs regionais (DIM, DInter/1, DInter/2, DIEsp). Confira as siglas em Administração > Estrutura e regiões.';
  end if;
  -- regionais não ficam subordinadas a uma OME da própria região (evita ciclo)
  update ome p set comando_id = null
   where pg_temp.chave(p.sigla) in ('DIM', 'DINTER1', 'DINTER2', 'DIESP')
     and p.comando_id in (select o.id from ome o join regiao_mapa m on m.filho = pg_temp.chave(o.sigla));
  update ome set regional = (pg_temp.chave(sigla) in ('DIM', 'DINTER1', 'DINTER2', 'DIESP'))
   where regional is distinct from (pg_temp.chave(sigla) in ('DIM', 'DINTER1', 'DINTER2', 'DIESP'));
  update ome f set comando_id = p.id
    from regiao_mapa m join ome p on pg_temp.chave(p.sigla) = m.pai
   where pg_temp.chave(f.sigla) = m.filho and f.comando_id is distinct from p.id;
  select count(*) into n_sub from ome f join regiao_mapa m on m.filho = pg_temp.chave(f.sigla);
  if n_sub < 16 then
    raise notice 'Só % das 16 OMEs subordinadas foram encontradas pela sigla; ajuste as que faltarem na tela.', n_sub;
  end if;
end $$;

comment on column ome.regional is 'Marca as OMEs que definem uma região (DIM, DINTER I, DINTER II, DIESP)';

-- =====================================================================
-- 2. PENDÊNCIAS (sino): cada um vê o que resolve
-- =====================================================================
create or replace function minhas_pendencias(p_ome integer default null)
returns table (chave text, gravidade text, titulo text, detalhe text, qtd integer, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_comp date := competencia_atual(); v_prazo date := prazo_entrega(competencia_atual());
  v_ed integer[] := minhas_omes_edicao(); v_global boolean := e_gestao_global(); n integer;
  v_da_ome boolean := not e_gestao_global() or p_ome is not null;   -- visão de uma OME (gestor, ou DGP com uma OME escolhida)
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

  if v_da_ome then
    -- conferência mensal
    select count(*) into n from militar m
    where m.ome_id = any (v_ed) and m.situacao = 'ATIVO'
      and not exists (select 1 from conferencia c where c.competencia = v_comp and c.militar_id = m.id);
    if n > 0 then
      return query select 'conferencia', case when v_prazo - current_date <= 5 then 'media' else 'info' end,
        n || ' militar(es) ainda não conferido(s)', 'Conferência mensal da competência ' || to_char(v_comp, 'MM/YYYY'), n, '/conferencia';
    end if;
    -- cadastro sem seção
    select count(*) into n from militar m where m.ome_id = any (v_ed) and m.situacao = 'ATIVO' and m.secao_id is null;
    if n > 0 then
      return query select 'sem_secao', 'info', n || ' militar(es) sem seção definida', 'Completar a lotação', n, '/efetivo?secao=-';
    end if;
  end if;

  if v_global then
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
    -- pedidos antigos das OMEs ainda não tratados
    select count(*) into n from solicitacao s where s.status = 'PENDENTE' and s.tipo = 'DESLIGAMENTO' and s.ome_id = any (v_ed);
    if n > 0 then
      return query select 'solicitacoes', 'alta', n || ' pedido(s) antigo(s) de desligamento aguardando a DGP', 'Atender ou devolver', n, '/desligamentos?aba=pedidos';
    end if;
    if p_ome is null then
      -- competência anterior com prazo vencido e não fechada
      if current_date > prazo_entrega((v_comp - interval '1 month')::date)
         and not exists (select 1 from fechamento_mensal f where f.competencia = (v_comp - interval '1 month')::date) then
        return query select 'fechamento', 'media', 'Competência ' || to_char((v_comp - interval '1 month')::date, 'MM/YYYY') || ' não fechada',
          'Gerar a fotografia do mês em Entrega mensal', 1, '/entregas';
      end if;
      if not exists (select 1 from qod where competencia = v_comp) then
        return query select 'qod', 'info', 'QOD da competência ' || to_char(v_comp, 'MM/YYYY') || ' não lançado',
          case when qod_competencia_vigente(v_comp) is null then 'Nenhum QOD cadastrado' else 'Usando o QOD de ' || to_char(qod_competencia_vigente(v_comp), 'MM/YYYY') end,
          1, '/atualizacao-mensal';
      end if;
    end if;
  end if;
end $$;

create or replace function pendencias_extra(p_ome integer default null)
returns table (chave text, gravidade text, titulo text, detalhe text, qtd integer, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_ed integer[] := minhas_omes_edicao(); n integer; v_ex ferias_exercicio;
begin
  -- férias, correções e reprogramações: só a DGP trata (versão 1.4.1)
  if not e_gestao_global() then return; end if;
  if p_ome is not null then v_ed := array(select unnest(v_ed) intersect select p_ome); end if;
  if coalesce(array_length(v_ed, 1), 0) = 0 then return; end if;
  select count(*) into n from solicitacao s where s.status = 'PENDENTE' and s.tipo = 'CORRECAO' and s.ome_id = any (v_ed);
  if n > 0 then return query select 'correcoes', 'media', n || ' pedido(s) antigo(s) de correção cadastral', 'Atender ou devolver', n, '/desligamentos?aba=correcoes'; end if;
  select count(*) into n from ferias_reprogramacao r where r.status = 'AGUARDANDO_DGP' and r.ome_id = any (v_ed);
  if n > 0 then return query select 'ferias_reprog', 'alta', n || ' reprogramação(ões) de férias aguardando homologação', 'Homologar ou devolver (art. 13)', n, '/ferias?aba=reprogramacoes'; end if;
  select count(*) into n from ferias_reprogramacao r where r.status = 'HOMOLOGADA' and r.sgp_em is null and r.ome_id = any (v_ed);
  if n > 0 then return query select 'ferias_sgp', 'media', n || ' reprogramação(ões) homologada(s) sem registro no SGP', 'Inserir no SGP e marcar (art. 13, II, c)', n, '/ferias?aba=reprogramacoes&f=sgp'; end if;
  select count(*) into n from ferias_periodo f where f.situacao = 'PROPOSTA' and f.excecao is not null and f.excecao_aprovada_por is null;
  if n > 0 then return query select 'ferias_excecao', 'media', n || ' exceção(ões) do PAF para o Diretor da DGP decidir', 'Autorizar ou pedir correção', n, '/ferias?aba=pendencias'; end if;
  -- PAF em elaboração: militares ainda sem período lançado
  for v_ex in select * from ferias_exercicio e where e.situacao = 'ELABORACAO' order by e.ano loop
    select count(*) into n from militar m where m.situacao = 'ATIVO' and m.ome_id = any (v_ed)
      and not exists (select 1 from ferias_periodo f where f.militar_id = m.id and f.exercicio = v_ex.ano);
    if n > 0 then
      return query select 'ferias_proposta', case when v_ex.prazo_ome - current_date <= 15 then 'alta' else 'media' end,
        n || ' militar(es) sem período no PAF ' || v_ex.ano,
        'Prazo: ' || coalesce(to_char(v_ex.prazo_ome, 'DD/MM/YYYY'), 'a definir') || ' (art. 14, I, b)', n, '/ferias?aba=quadro';
    end if;
  end loop;
  -- férias que começam em até 30 dias com o militar afastado por outro motivo no 1º dia (art. 11, I, b)
  select count(*) into n from ferias_periodo f join militar m on m.id = f.militar_id
   where f.situacao = 'PROGRAMADA' and m.ome_id = any (v_ed) and f.data_inicio between current_date and current_date + 30
     and exists (select 1 from afastamento a join tipo_afastamento t on t.id = a.tipo_id
                 where a.militar_id = f.militar_id and t.codigo <> 'FERIAS' and f.data_inicio between a.data_inicio and a.data_fim);
  if n > 0 then return query select 'ferias_obrigatoria', 'alta', n || ' militar(es) afastado(s) no 1º dia das férias', 'Reprogramação obrigatória (art. 11, I, b)', n, '/ferias?aba=pendencias'; end if;
  -- datas estimadas na importação
  select count(*) into n from ferias_periodo f left join militar m on m.id = f.militar_id left join servidor_civil c on c.id = f.civil_id
   where f.data_estimada and f.situacao in ('PROPOSTA', 'PROGRAMADA') and f.data_inicio >= current_date and coalesce(m.ome_id, c.ome_id) = any (v_ed);
  if n > 0 then return query select 'ferias_estimada', 'info', n || ' período(s) de férias com dia estimado na importação', 'Confirmar o dia de início no quadro de férias', n, '/ferias?aba=pendencias'; end if;
end $$;

revoke execute on function minhas_pendencias(integer), pendencias_extra(integer) from public, anon;
grant execute on function minhas_pendencias(integer), pendencias_extra(integer) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';

-- resultado: como ficaram as regiões
select 'Versão 1.5 aplicada com sucesso' as resultado,
       case r.regiao_sigla when 'DInter/1' then 'DINTER I' when 'DInter/2' then 'DINTER II' when 'DIEsp' then 'DIESP' else coalesce(r.regiao_sigla, 'Demais OMEs') end as regiao,
       string_agg(o.sigla, ', ' order by o.regional desc, o.ordem) as omes
  from ome o join v_ome_regiao r on r.ome_id = o.id
 where o.ativo and r.regiao_sigla is not null
 group by r.regiao_sigla
 order by min(case r.regiao_sigla when 'DIM' then 0 when 'DInter/1' then 1 when 'DInter/2' then 2 else 3 end);
