-- =====================================================================
-- REVERSÃO DA VERSÃO 1.2 (volta o banco para a versão 1.1)
-- Use SOMENTE se a 1.2 apresentar problema grave.
-- Preserva: militares, afastamentos (inclusive as férias já geradas, que ficam
-- como afastamentos comuns), auditoria e tudo da 1.1.
-- Apaga: termo de uso e aceites, registro de exportações, servidores civis,
-- PAF (exercícios, períodos, reprogramações), pedidos de correção e a data de ingresso.
-- =====================================================================
set client_min_messages = warning;
begin;
do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.2') then
    raise exception 'A versão 1.2 não está aplicada neste banco.';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.3') then
    raise exception 'Reverta antes a versão 1.3 (supabase/reverter_1_3.sql).';
  end if;
end $$;

drop trigger if exists afastamento_ferias_protege on afastamento;
drop function if exists trg_afastamento_ferias_protege();
drop trigger if exists ferias_afastamento on ferias_periodo;
drop function if exists trg_ferias_afastamento();
do $$
declare d text;
begin
  d := pg_get_viewdef('v_afastamento'::regclass);
  d := replace(d, 'a.ferias_periodo_id', 'NULL::uuid AS ferias_periodo_id');
  execute 'create or replace view v_afastamento with (security_invoker = on) as ' || d;
  d := pg_get_viewdef('v_militar'::regclass);
  d := replace(d, 'm.data_ingresso', 'NULL::date AS data_ingresso');
  execute 'create or replace view v_militar with (security_invoker = on) as ' || d;
end $$;
alter table afastamento drop column if exists ferias_periodo_id;
delete from referencia_importacao where tipo = 'PAF';
alter table referencia_importacao drop constraint if exists referencia_importacao_tipo_check;
alter table referencia_importacao add constraint referencia_importacao_tipo_check check (tipo in ('QOD', 'ALMANAQUE'));

drop function if exists pendencias_extra(integer);
drop function if exists ferias_importar(jsonb, jsonb, jsonb);
drop function if exists ferias_excluir_periodo(uuid);
drop function if exists ferias_nao_gozada(uuid, text, text);
drop function if exists ferias_marcar_sgp(uuid[], boolean);
drop function if exists ferias_decidir_reprogramacao(uuid, text, text, text);
drop function if exists ferias_reprogramar(uuid, uuid, smallint, text, text, date, text, text, uuid[], jsonb, uuid, date, text, text);
drop function if exists ferias_publicar(smallint, text, date, text);
drop function if exists ferias_autorizar_excecao(uuid[]);
drop function if exists ferias_propor(uuid, uuid, smallint, jsonb, text, text);
drop function if exists ferias_abrir_exercicio(smallint, date, text);
drop function if exists ferias_bloqueios(jsonb);
drop function if exists ferias_verificar(uuid, uuid, smallint, jsonb, uuid[], text, date, jsonb);
drop view if exists v_ferias_reprogramacao;
drop view if exists v_ferias;
drop function if exists ferias_ome_pessoa(uuid, uuid);
drop table if exists ferias_reprogramacao;
drop table if exists ferias_periodo;
drop table if exists ferias_restricao;
drop table if exists ferias_exercicio;
drop table if exists servidor_civil;
drop function if exists trg_servidor_civil();
alter table ome drop column if exists orgao_ensino;

drop function if exists acessos_por_ome();
drop function if exists textos_com_saude();
drop function if exists registrar_exportacao(text, text, text, integer, text[], boolean);
drop table if exists registro_exportacao;
drop function if exists solicitar_correcao(uuid, jsonb, text);
delete from solicitacao where tipo = 'CORRECAO';
alter table solicitacao drop constraint if exists solicitacao_tipo_check;
alter table solicitacao add constraint solicitacao_tipo_check check (tipo in ('DESLIGAMENTO'));
drop function if exists registrar_senha_provisoria(uuid);
drop function if exists aceitar_termo(integer);
drop table if exists termo_aceite;
drop table if exists termo_uso;

-- funções da versão 1.1
CREATE OR REPLACE FUNCTION public.papel_atual()
 RETURNS papel_usuario
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select papel from perfil where id = auth.uid() and ativo
$function$;

CREATE OR REPLACE FUNCTION public.meu_contexto()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.marcar_senha_trocada()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update perfil set deve_trocar_senha = false where id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.trg_militar_antes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.aplicar_almanaque(p_referencia date, p_documento text, p_alteracoes jsonb, p_resumo jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.decidir_solicitacao(p_id uuid, p_acao text, p_resposta text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.minhas_pendencias(p_ome integer DEFAULT NULL::integer)
 RETURNS TABLE(chave text, gravidade text, titulo text, detalhe text, qtd integer, link text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.localizar_matricula(p_matricula text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when not usuario_ativo() then null else (
    select jsonb_build_object('ome', o.sigla, 'situacao', m.situacao, 'posto', pg.sigla, 'nome', m.nome)
    from militar m join ome o on o.id = m.ome_id join posto_graduacao pg on pg.id = m.posto_id
    where m.matricula = trim(p_matricula)) end
$function$;

CREATE OR REPLACE FUNCTION public.desligar_militar(p_militar uuid, p_motivo integer, p_data date, p_publicacao text, p_processo text, p_observacao text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

alter table perfil drop column if exists senha_provisoria_hash;
alter table militar drop column if exists data_ingresso;

grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema public from anon, public;
delete from versao_sistema where versao = '1.2';
commit;
notify pgrst, 'reload schema';
select 'Versão 1.2 revertida: sistema de volta à versão ' || max(versao) as resultado from versao_sistema;
