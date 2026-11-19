-- =====================================================================
-- REVERSÃO DA VERSÃO 1.4 (volta o banco para a versão 1.3)
-- Use SOMENTE se a 1.4 apresentar problema grave.
-- Preserva todos os dados: militares (inclusive sexo, nascimento, nº funcional,
-- órgão de cessão e data de promoção, que ficam guardados sem uso), punições,
-- comportamentos publicados e parâmetros. Remove só o cálculo do comportamento
-- e devolve as regras de cadastro da 1.3. Reaplicar a 1.4 depois é seguro.
-- =====================================================================
set client_min_messages = warning;
begin;
do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.4') then
    raise exception 'A versão 1.4 não está aplicada neste banco.';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.4.1') then
    raise exception 'Reverta antes a versão 1.4.1 (supabase/reverter_1_4_1.sql).';
  end if;
end $$;

-- a ficha deixa de mostrar os campos novos (as colunas continuam existindo, vazias na visão)
do $$
declare d text;
begin
  d := pg_get_viewdef('v_militar'::regclass);
  if d !~ 'm\.data_ingresso,\s+m\.sexo,' then raise exception 'v_militar: formato inesperado.'; end if;
  d := regexp_replace(d, 'm\.data_ingresso,\s+m\.sexo,.*AS comportamento_data\s+FROM',
    'm.data_ingresso, NULL::text AS sexo, NULL::date AS data_nascimento, NULL::integer AS idade, NULL::text AS numero_funcional, '
    || 'NULL::text AS orgao_cessao, NULL::date AS data_promocao, NULL::text AS comportamento, NULL::date AS comportamento_data FROM');
  execute 'create or replace view v_militar with (security_invoker = on) as ' || d;
end $$;

drop view if exists v_comportamento;
drop view if exists v_comportamento_penas;
drop function if exists comportamento_calcular(uuid, date);
drop function if exists comportamento_situacao(date, date, comp_evento[], text, date, comportamento_regra);
drop function if exists comportamento_avaliar(date, date, comp_evento[], comportamento_regra);
drop function if exists comportamento_nivel(text);
drop function if exists comportamento_nome(smallint);
drop type if exists comp_evento;

-- regras do cadastro, almanaque e pedidos de correção como na 1.2/1.3
create or replace function trg_militar_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_secao_ome integer;
begin
  new.nome        := upper(regexp_replace(trim(new.nome), '\s+', ' ', 'g'));
  new.nome_guerra := nullif(upper(trim(coalesce(new.nome_guerra, ''))), '');
  new.email       := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.atualizado_em  := now();
  new.atualizado_por := auth.uid();
  if new.data_ingresso is not null then new.ano_ingresso := extract(year from new.data_ingresso); end if;

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
  elsif tg_op = 'UPDATE' and auth.uid() is not null then
    if coalesce(current_setting('app.movimentacao', true), '') <> 'on'
       and (new.ome_id is distinct from old.ome_id or new.situacao is distinct from old.situacao) then
      raise exception 'Alteração de OME ou situação deve ser feita por Transferência ou Desligamento.';
    end if;
    if not e_gestao_global()
       and (new.posto_id is distinct from old.posto_id or new.quadro_sigla is distinct from old.quadro_sigla
            or new.nome is distinct from old.nome or new.matricula is distinct from old.matricula
            or new.ordem_antiguidade is distinct from old.ordem_antiguidade
            or new.data_ingresso is distinct from old.data_ingresso) then
      raise exception 'Posto/graduação, quadro, nome, matrícula, antiguidade e data de ingresso são mantidos pela DGP. Use "Pedir correção à DGP" na ficha.';
    end if;
  end if;
  return new;
end $$;

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
    data_ingresso     = coalesce(x.data_ingresso, m.data_ingresso),
    ano_ingresso      = coalesce(x.ano_ingresso, m.ano_ingresso),
    nome_guerra       = coalesce(nullif(x.nome_guerra, ''), m.nome_guerra)
  from jsonb_to_recordset(coalesce(p_alteracoes, '[]'))
       as x(id uuid, posto_id smallint, quadro_sigla text, ordem_antiguidade integer, ano_ingresso smallint,
            data_ingresso date, nome_guerra text)
  where m.id = x.id and m.situacao = 'ATIVO';
  get diagnostics n = row_count;
  insert into referencia_importacao (tipo, referencia, documento, resumo)
  values ('ALMANAQUE', p_referencia, nullif(trim(coalesce(p_documento, '')), ''),
          coalesce(p_resumo, '{}') || jsonb_build_object('militares_atualizados', n));
  return n;
end $$;

create or replace function solicitar_correcao(p_militar uuid, p_dados jsonb, p_justificativa text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_m militar; v_id uuid; v_d jsonb;
begin
  select * into v_m from militar where id = p_militar;
  if v_m.id is null or v_m.situacao <> 'ATIVO' then raise exception 'Militar não encontrado ou não ativo.'; end if;
  if not pode_editar_ome(v_m.ome_id) then raise exception 'Sem permissão para esta OME.'; end if;
  if coalesce(trim(p_justificativa), '') = '' then raise exception 'Informe a justificativa (ex.: publicação, almanaque, documento).'; end if;
  select coalesce(jsonb_object_agg(k, v), '{}') into v_d from jsonb_each(coalesce(p_dados, '{}')) e(k, v)
   where k in ('posto_id', 'quadro_sigla', 'nome', 'matricula', 'ordem_antiguidade', 'data_ingresso');
  if v_d = '{}' then raise exception 'Informe ao menos um campo a corrigir.'; end if;
  if v_d ? 'matricula' and not matricula_valida(v_d->>'matricula') then raise exception 'Matrícula informada é inválida.'; end if;
  insert into solicitacao (tipo, militar_id, ome_id, dados)
  values ('CORRECAO', p_militar, v_m.ome_id, jsonb_build_object('campos', v_d, 'justificativa', trim(p_justificativa),
          'antes', jsonb_build_object('posto_id', v_m.posto_id, 'quadro_sigla', v_m.quadro_sigla, 'nome', v_m.nome,
                   'matricula', v_m.matricula, 'ordem_antiguidade', v_m.ordem_antiguidade, 'data_ingresso', v_m.data_ingresso)))
  returning id into v_id;
  return v_id;
end $$;

create or replace function decidir_solicitacao(p_id uuid, p_acao text, p_resposta text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitacao; c jsonb;
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
    if s.tipo = 'DESLIGAMENTO' then
      perform desligar_militar(s.militar_id, (s.dados->>'motivo_id')::int, (s.dados->>'data')::date,
                               s.dados->>'publicacao', s.dados->>'processo', s.dados->>'observacao');
    elsif s.tipo = 'CORRECAO' then
      c := s.dados->'campos';
      update militar set
        posto_id          = case when c ? 'posto_id' then (c->>'posto_id')::smallint else posto_id end,
        quadro_sigla      = case when c ? 'quadro_sigla' then nullif(c->>'quadro_sigla', '') else quadro_sigla end,
        nome              = case when c ? 'nome' then c->>'nome' else nome end,
        matricula         = case when c ? 'matricula' then c->>'matricula' else matricula end,
        ordem_antiguidade = case when c ? 'ordem_antiguidade' then nullif(c->>'ordem_antiguidade', '')::int else ordem_antiguidade end,
        data_ingresso     = case when c ? 'data_ingresso' then nullif(c->>'data_ingresso', '')::date else data_ingresso end
      where id = s.militar_id;
    end if;
    update solicitacao set status = 'ATENDIDA', decidido_por = auth.uid(), decidido_em = now(), resposta = p_resposta where id = p_id;
  else
    raise exception 'Ação inválida.';
  end if;
end $$;

delete from versao_sistema where versao = '1.4';
commit;
notify pgrst, 'reload schema';
select 'Banco revertido para a versão 1.3 (dados preservados)' as resultado;
