-- =====================================================================
-- REVERSÃO DA VERSÃO 1.5 (volta às pendências da 1.4.1)
-- Não apaga dados. A cadeia de comando aplicada (DIM, DINTER I, DINTER II, DIESP) é mantida:
-- se quiser mudar, ajuste em Administração > Estrutura e regiões. A DIESP deixa de ser região.
-- =====================================================================
set client_min_messages = warning;
begin;
do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.5') then
    raise exception 'A versão 1.5 não está aplicada neste banco.';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.6') then
    raise exception 'Reverta antes a versão 1.6 (supabase/reverter_1_6.sql).';
  end if;
end $$;

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

create or replace function pendencias_extra(p_ome integer default null)
returns table (chave text, gravidade text, titulo text, detalhe text, qtd integer, link text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_ed integer[] := minhas_omes_edicao(); v_global boolean := e_gestao_global(); n integer; v_ex ferias_exercicio;
begin
  if p_ome is not null then v_ed := array(select unnest(v_ed) intersect select p_ome); end if;
  if coalesce(array_length(v_ed, 1), 0) = 0 then return; end if;
  if v_global then
    select count(*) into n from solicitacao s where s.status = 'PENDENTE' and s.tipo = 'CORRECAO' and s.ome_id = any (v_ed);
    if n > 0 then return query select 'correcoes', 'media', n || ' pedido(s) de correção cadastral', 'Atender ou devolver', n, '/desligamentos?aba=correcoes'; end if;
    select count(*) into n from ferias_reprogramacao r where r.status = 'AGUARDANDO_DGP' and r.ome_id = any (v_ed);
    if n > 0 then return query select 'ferias_reprog', 'alta', n || ' reprogramação(ões) de férias aguardando homologação', 'Homologar ou devolver (art. 13)', n, '/ferias?aba=reprogramacoes'; end if;
    select count(*) into n from ferias_reprogramacao r where r.status = 'HOMOLOGADA' and r.sgp_em is null and r.ome_id = any (v_ed);
    if n > 0 then return query select 'ferias_sgp', 'media', n || ' reprogramação(ões) homologada(s) sem registro no SGP', 'Inserir no SGP e marcar (art. 13, II, c)', n, '/ferias?aba=reprogramacoes&f=sgp'; end if;
    select count(*) into n from ferias_periodo f where f.situacao = 'PROPOSTA' and f.excecao is not null and f.excecao_aprovada_por is null;
    if n > 0 then return query select 'ferias_excecao', 'media', n || ' exceção(ões) do PAF para o Diretor da DGP decidir', 'Autorizar ou pedir correção', n, '/ferias?aba=pendencias'; end if;
  else
    select count(*) into n from ferias_reprogramacao r where r.status = 'DEVOLVIDA' and r.ome_id = any (v_ed) and r.decidido_em > now() - interval '30 days';
    if n > 0 then return query select 'ferias_devolvidas', 'media', n || ' reprogramação(ões) de férias devolvida(s) pela DGP', 'Ver a resposta e refazer', n, '/ferias?aba=reprogramacoes'; end if;
  end if;
  -- proposta do PAF em elaboração
  for v_ex in select * from ferias_exercicio e where e.situacao = 'ELABORACAO' order by e.ano loop
    select count(*) into n from militar m where m.situacao = 'ATIVO' and m.ome_id = any (v_ed)
      and not exists (select 1 from ferias_periodo f where f.militar_id = m.id and f.exercicio = v_ex.ano);
    if n > 0 then
      return query select 'ferias_proposta', case when v_ex.prazo_ome - current_date <= 15 then 'alta' else 'media' end,
        n || ' militar(es) sem proposta no PAF ' || v_ex.ano,
        'Prazo da OME: ' || coalesce(to_char(v_ex.prazo_ome, 'DD/MM/YYYY'), 'a definir') || ' (art. 14, I, b)', n, '/ferias?aba=quadro';
    end if;
  end loop;
  -- férias que começam em até 30 dias e o militar está afastado por outro motivo no 1º dia (art. 11, I, b)
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

update ome set regional = false where sigla = 'DIEsp';
delete from versao_sistema where versao = '1.5';
commit;
notify pgrst, 'reload schema';
select 'Versão 1.5 revertida' as resultado;
