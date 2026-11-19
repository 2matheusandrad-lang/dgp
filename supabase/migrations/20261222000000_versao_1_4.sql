-- =====================================================================
-- Sistema de Controle do Efetivo (DGP/CBMPE) — versão 1.4
-- Novos dados do pecúlio e do almanaque (sexo, nascimento, nº funcional,
-- órgão de cessão, data da última promoção) e comportamento das praças
-- (Lei 11.817/2000, arts. 45 a 49 e 60 a 64; Decreto 50.014/2020).
--
-- Requer a versão 1.3. Roda numa única transação: ou aplica tudo, ou nada.
-- Não apaga dados. Para desfazer: supabase/reverter_1_4.sql
-- A recarga da base (pecúlio + planilha + almanaque) é um arquivo à parte,
-- entregue fora do repositório porque contém dados pessoais.
-- =====================================================================
set client_min_messages = warning;
begin;

do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.3') then
    raise exception 'Aplique antes o 20261215000000_versao_1_3.sql (versão 1.3).';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.4') then
    raise exception 'A versão 1.4 já está aplicada neste banco: nada a fazer.';
  end if;
end $$;

insert into versao_sistema (versao) values ('1.4');

-- =====================================================================
-- 1. NOVOS CAMPOS DO MILITAR (fonte oficial: pecúlio e almanaque; só a DGP altera)
-- =====================================================================
alter table militar add column if not exists sexo             text;
alter table militar add column if not exists data_nascimento  date;
alter table militar add column if not exists numero_funcional text;
alter table militar add column if not exists orgao_cessao     text;
alter table militar add column if not exists data_promocao    date;

alter table militar drop constraint if exists militar_sexo_check;
alter table militar add constraint militar_sexo_check check (sexo is null or sexo in ('M', 'F'));
alter table militar drop constraint if exists militar_data_nascimento_check;
alter table militar add constraint militar_data_nascimento_check
  check (data_nascimento is null or data_nascimento between date '1930-01-01' and date '2015-12-31');
alter table militar drop constraint if exists militar_numero_funcional_check;
alter table militar add constraint militar_numero_funcional_check
  check (numero_funcional is null or numero_funcional ~ '^[0-9]{3,9}(/[0-9]{1,3})?$');
alter table militar drop constraint if exists militar_data_promocao_check;
alter table militar add constraint militar_data_promocao_check
  check (data_promocao is null or data_promocao >= date '1970-01-01');
create unique index if not exists militar_numero_funcional_key on militar (numero_funcional) where numero_funcional is not null;

comment on column militar.sexo is 'M ou F, conforme o pecúlio (SGP)';
comment on column militar.data_nascimento is 'Data de nascimento (almanaque)';
comment on column militar.numero_funcional is 'Número funcional do pecúlio, ex.: 2441616/01';
comment on column militar.orgao_cessao is 'Órgão onde o militar está cedido (pecúlio, coluna ÓRGÃO); vazio = no CBMPE';
comment on column militar.data_promocao is 'Data da promoção ao posto/graduação atual (almanaque)';

-- regras do cadastro: os dados oficiais novos também são mantidos só pela DGP
create or replace function trg_militar_antes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_secao_ome integer;
begin
  new.nome        := upper(regexp_replace(trim(new.nome), '\s+', ' ', 'g'));
  new.nome_guerra := nullif(upper(trim(coalesce(new.nome_guerra, ''))), '');
  new.email       := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.sexo        := nullif(upper(trim(coalesce(new.sexo, ''))), '');
  new.orgao_cessao := nullif(upper(trim(coalesce(new.orgao_cessao, ''))), '');
  if new.orgao_cessao = 'CBMPE' then new.orgao_cessao := null; end if;
  new.numero_funcional := nullif(trim(coalesce(new.numero_funcional, '')), '');
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
            or new.data_ingresso is distinct from old.data_ingresso
            or new.sexo is distinct from old.sexo or new.data_nascimento is distinct from old.data_nascimento
            or new.numero_funcional is distinct from old.numero_funcional
            or new.orgao_cessao is distinct from old.orgao_cessao
            or new.data_promocao is distinct from old.data_promocao) then
      raise exception 'Posto/graduação, quadro, nome, matrícula, nº funcional, sexo, nascimento, antiguidade, datas de ingresso e de promoção e órgão de cessão são mantidos pela DGP. Use "Pedir correção à DGP" na ficha.';
    end if;
  end if;
  return new;
end $$;

-- pedido de correção (OME -> DGP) passa a aceitar os campos novos
create or replace function solicitar_correcao(p_militar uuid, p_dados jsonb, p_justificativa text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_m militar; v_id uuid; v_d jsonb;
begin
  select * into v_m from militar where id = p_militar;
  if v_m.id is null or v_m.situacao <> 'ATIVO' then raise exception 'Militar não encontrado ou não ativo.'; end if;
  if not pode_editar_ome(v_m.ome_id) then raise exception 'Sem permissão para esta OME.'; end if;
  if coalesce(trim(p_justificativa), '') = '' then raise exception 'Informe a justificativa (ex.: publicação, almanaque, documento).'; end if;
  select coalesce(jsonb_object_agg(k, v), '{}') into v_d from jsonb_each(coalesce(p_dados, '{}')) e(k, v)
   where k in ('posto_id', 'quadro_sigla', 'nome', 'matricula', 'ordem_antiguidade', 'data_ingresso',
               'sexo', 'data_nascimento', 'numero_funcional', 'data_promocao');
  if v_d = '{}' then raise exception 'Informe ao menos um campo a corrigir.'; end if;
  if v_d ? 'matricula' and not matricula_valida(v_d->>'matricula') then raise exception 'Matrícula informada é inválida.'; end if;
  if v_d ? 'sexo' and coalesce(v_d->>'sexo', '') not in ('M', 'F') then raise exception 'Sexo deve ser M ou F.'; end if;
  insert into solicitacao (tipo, militar_id, ome_id, dados)
  values ('CORRECAO', p_militar, v_m.ome_id, jsonb_build_object('campos', v_d, 'justificativa', trim(p_justificativa),
          'antes', jsonb_build_object('posto_id', v_m.posto_id, 'quadro_sigla', v_m.quadro_sigla, 'nome', v_m.nome,
                   'matricula', v_m.matricula, 'ordem_antiguidade', v_m.ordem_antiguidade, 'data_ingresso', v_m.data_ingresso,
                   'sexo', v_m.sexo, 'data_nascimento', v_m.data_nascimento, 'numero_funcional', v_m.numero_funcional,
                   'data_promocao', v_m.data_promocao)))
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
        data_ingresso     = case when c ? 'data_ingresso' then nullif(c->>'data_ingresso', '')::date else data_ingresso end,
        sexo              = case when c ? 'sexo' then nullif(c->>'sexo', '') else sexo end,
        data_nascimento   = case when c ? 'data_nascimento' then nullif(c->>'data_nascimento', '')::date else data_nascimento end,
        numero_funcional  = case when c ? 'numero_funcional' then nullif(c->>'numero_funcional', '') else numero_funcional end,
        data_promocao     = case when c ? 'data_promocao' then nullif(c->>'data_promocao', '')::date else data_promocao end
      where id = s.militar_id;
    end if;
    update solicitacao set status = 'ATENDIDA', decidido_por = auth.uid(), decidido_em = now(), resposta = p_resposta where id = p_id;
  else
    raise exception 'Ação inválida.';
  end if;
end $$;

-- almanaque passa a gravar também nascimento e data da última promoção
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
    nome_guerra       = coalesce(m.nome_guerra, nullif(x.nome_guerra, '')),
    data_nascimento   = coalesce(x.data_nascimento, m.data_nascimento),
    data_promocao     = coalesce(x.data_promocao, m.data_promocao)
  from jsonb_to_recordset(coalesce(p_alteracoes, '[]'))
       as x(id uuid, posto_id smallint, quadro_sigla text, ordem_antiguidade integer, ano_ingresso smallint,
            data_ingresso date, nome_guerra text, data_nascimento date, data_promocao date)
  where m.id = x.id and m.situacao = 'ATIVO';
  get diagnostics n = row_count;
  insert into referencia_importacao (tipo, referencia, documento, resumo)
  values ('ALMANAQUE', p_referencia, nullif(trim(coalesce(p_documento, '')), ''),
          coalesce(p_resumo, '{}') || jsonb_build_object('militares_atualizados', n));
  return n;
end $$;

-- =====================================================================
-- 2. COMPORTAMENTO DAS PRAÇAS
--    Lei 11.817/2000: art. 45 §2 (inclusão no Bom), art. 46 (classes),
--    art. 47 (escala móvel; condenação criminal), art. 48 (contagem a partir
--    do fim do cumprimento), art. 49 (2 detenções = 1 prisão), arts. 60-64
--    (cancelamento), art. 67 §9 (elogio anula efeitos).
--    Decreto 50.014/2020, art. 9: desde 27/12/2020 a sanção se considera
--    cumprida na data da publicação do ato (após os recursos).
--    Oficiais e aspirantes não são classificados (Decreto 50.014, art. 6º §2).
-- =====================================================================

-- 2.1 cada tipo de pena diz como pesa no comportamento
alter table tipo_punicao add column if not exists efeito_comportamento text not null default 'NENHUM';
alter table tipo_punicao drop constraint if exists tipo_punicao_efeito_check;
alter table tipo_punicao add constraint tipo_punicao_efeito_check
  check (efeito_comportamento in ('PRISAO', 'DETENCAO', 'REPREENSAO', 'NENHUM'));
update tipo_punicao set efeito_comportamento = 'REPREENSAO' where nome = 'Repreensão';
update tipo_punicao set efeito_comportamento = 'DETENCAO'   where nome = 'Detenção';
update tipo_punicao set efeito_comportamento = 'PRISAO'     where nome = 'Prisão';
insert into tipo_punicao (nome, ordem, efeito_comportamento) values
  ('Condenação por crime (art. 47, I)', 5, 'PRISAO'),
  ('Condenação por contravenção (art. 47, II)', 6, 'DETENCAO'),
  ('Licenciamento a bem da disciplina', 7, 'NENHUM'),
  ('Exclusão a bem da disciplina', 8, 'NENHUM')
on conflict (nome) do update set efeito_comportamento = excluded.efeito_comportamento;
comment on column tipo_punicao.efeito_comportamento is
  'Como a pena conta para o comportamento. Advertência é verbal e não vai à ficha (art. 28 §3): não conta.';

-- 2.2 dados da publicação e do cancelamento na punição
alter table punicao add column if not exists data_publicacao        date;
alter table punicao add column if not exists publicacao             text;
alter table punicao add column if not exists natureza               text;
alter table punicao add column if not exists cumprimento_fim        date;
alter table punicao add column if not exists cancelada_em           date;
alter table punicao add column if not exists cancelamento_motivo    text;
alter table punicao add column if not exists cancelamento_publicacao text;
alter table punicao drop constraint if exists punicao_natureza_check;
alter table punicao add constraint punicao_natureza_check check (natureza is null or natureza in ('LEVE', 'MEDIA', 'GRAVE'));
alter table punicao drop constraint if exists punicao_cancelamento_check;
alter table punicao add constraint punicao_cancelamento_check check (
  (cancelada_em is null and cancelamento_motivo is null)
  or (cancelada_em is not null and cancelamento_motivo is not null
      and cancelamento_motivo in ('CANCELAMENTO', 'ELOGIO', 'RECURSO', 'OUTRO')));
alter table punicao drop constraint if exists punicao_datas_check;
alter table punicao add constraint punicao_datas_check check (
  (data_publicacao is null or data_publicacao >= date '1980-01-01')
  and (data_inicio is null or data_inicio >= date '1980-01-01')
  and (cumprimento_fim is null or data_inicio is null or cumprimento_fim >= data_inicio));
-- data a partir da qual a pena conta (art. 48 da Lei; art. 9º do Decreto 50.014)
alter table punicao add column if not exists data_contagem date generated always as (
  case when data_publicacao >= date '2020-12-27' then data_publicacao
       else coalesce(cumprimento_fim,
                     data_inicio + (greatest(coalesce(dias, 1), 1) - 1),
                     data_publicacao)
  end) stored;
create index if not exists punicao_contagem_idx on punicao (militar_id, data_contagem);
comment on column punicao.data_publicacao is 'Publicação do ato punitivo depois de esgotados os recursos (Decreto 50.014, art. 9º)';
comment on column punicao.cumprimento_fim is 'Último dia de cumprimento (penas anteriores a 27/12/2020); se vazio, usa início + dias - 1';
comment on column punicao.data_contagem is 'Calculada: publicação (a partir de 27/12/2020) ou fim do cumprimento (antes)';
comment on column punicao.cancelada_em is 'Cancelamento (arts. 60-64), anulação por elogio (art. 67 §9) ou recurso provido: a pena deixa de contar nessa data';

-- a lista de punições (ficha, relatórios) mostra os campos novos
do $$
declare d text;
begin
  d := pg_get_viewdef('v_punicao'::regclass);
  if position('data_publicacao' in d) = 0 then
    if d !~ 'o\.sigla AS ome_sigla\s+FROM' then raise exception 'v_punicao: formato inesperado.'; end if;
    d := regexp_replace(d, 'o\.sigla AS ome_sigla\s+FROM',
      'o.sigla AS ome_sigla, p.data_publicacao, p.publicacao, p.natureza, p.cumprimento_fim, p.data_contagem, '
      || 'p.cancelada_em, p.cancelamento_motivo, p.cancelamento_publicacao, tp.efeito_comportamento FROM');
    execute 'create or replace view v_punicao with (security_invoker = on) as ' || d;
  end if;
end $$;

-- 2.3 parâmetros (uma linha; só o administrador altera)
create table if not exists comportamento_regra (
  id                 smallint primary key default 1 check (id = 1),
  peso_prisao        numeric(4,2) not null default 1,
  peso_detencao      numeric(4,2) not null default 0.5,
  peso_repreensao    numeric(4,2) not null default 0.5,
  excepcional_anos   smallint not null default 6,
  otimo_anos         smallint not null default 4,
  otimo_limite       numeric(4,2) not null default 0.5,
  bom_anos           smallint not null default 2,
  bom_limite         numeric(4,2) not null default 1,
  mau_meses          smallint not null default 12,
  mau_limite         numeric(4,2) not null default 2,
  observacao         text,
  atualizado_em      timestamptz not null default now(),
  atualizado_por     uuid default auth.uid()
);
comment on table comportamento_regra is
  'Parâmetros do cálculo. Peso = quanto cada pena vale em "prisões" (art. 49: 2 detenções = 1 prisão; repreensão conta como sanção menor). '
  'Excepcional: nenhuma pena em 6 anos (e 6 anos de serviço). Ótimo: em 4 anos, nenhuma prisão e soma <= 0,5 (e 4 anos de serviço). '
  'Bom: em 2 anos, soma <= 1. Mau: em 12 meses, soma > 2. Demais casos: Insuficiente.';
insert into comportamento_regra (id, observacao) values (1,
  'Leitura da DGP para a Lei 11.817/2000, art. 46: avaliação do melhor para o pior. Quem sai do Mau (12 meses sem passar do limite) '
  'e ainda não alcança o Bom fica Insuficiente. 4 sanções menores equivalem a 2 prisões (Insuficiente); a 5ª leva ao Mau.')
on conflict (id) do nothing;
alter table comportamento_regra enable row level security;
drop policy if exists comportamento_regra_ler on comportamento_regra;
create policy comportamento_regra_ler on comportamento_regra for select to authenticated using ((select usuario_ativo()));
drop policy if exists comportamento_regra_alterar on comportamento_regra;
create policy comportamento_regra_alterar on comportamento_regra for update to authenticated
  using ((select e_admin())) with check ((select e_admin()));

-- 2.4 comportamento publicado (histórico; o mais recente é o oficial)
create table if not exists comportamento_publicado (
  id             uuid primary key default gen_random_uuid(),
  militar_id     uuid not null references militar(id) on delete cascade,
  comportamento  text not null check (comportamento in ('EXCEPCIONAL', 'OTIMO', 'BOM', 'INSUFICIENTE', 'MAU')),
  data_vigencia  date not null check (data_vigencia >= date '1970-01-01'),
  publicacao     text,
  origem         text not null default 'MANUAL' check (origem in ('INCLUSAO', 'IMPORTACAO', 'RECLASSIFICACAO', 'MANUAL')),
  observacao     text,
  criado_em      timestamptz not null default now(),
  criado_por     uuid default auth.uid()
);
create index if not exists comportamento_publicado_idx on comportamento_publicado (militar_id, data_vigencia desc, criado_em desc);
comment on table comportamento_publicado is 'Classificações publicadas em boletim (art. 45 §1). A mais recente é a oficial.';
alter table comportamento_publicado enable row level security;
drop policy if exists comportamento_publicado_ler on comportamento_publicado;
create policy comportamento_publicado_ler on comportamento_publicado for select to authenticated
  using (exists (select 1 from militar m where m.id = comportamento_publicado.militar_id));
drop policy if exists comportamento_publicado_inserir on comportamento_publicado;
create policy comportamento_publicado_inserir on comportamento_publicado for insert to authenticated
  with check (pode_editar_militar(militar_id));
drop policy if exists comportamento_publicado_alterar on comportamento_publicado;
create policy comportamento_publicado_alterar on comportamento_publicado for update to authenticated
  using (pode_editar_militar(militar_id)) with check (pode_editar_militar(militar_id));
drop policy if exists comportamento_publicado_excluir on comportamento_publicado;
create policy comportamento_publicado_excluir on comportamento_publicado for delete to authenticated
  using (pode_editar_militar(militar_id));

create or replace function trg_comportamento_publicado_antes() returns trigger
language plpgsql set search_path = public as $$
declare v_posto smallint;
begin
  select pg.ordem into v_posto from militar m join posto_graduacao pg on pg.id = m.posto_id where m.id = new.militar_id;
  if v_posto is not null and v_posto < 8 then
    raise exception 'Oficiais e aspirantes não têm comportamento classificado (Decreto 50.014/2020, art. 6º §2).';
  end if;
  new.publicacao := nullif(trim(coalesce(new.publicacao, '')), '');
  if tg_op = 'INSERT' then new.criado_por := coalesce(auth.uid(), new.criado_por); end if;
  return new;
end $$;
drop trigger if exists comportamento_publicado_antes on comportamento_publicado;
create trigger comportamento_publicado_antes before insert or update on comportamento_publicado
  for each row execute function trg_comportamento_publicado_antes();

-- 2.5 motor de cálculo
do $$ begin
  if not exists (select 1 from pg_type where typname = 'comp_evento') then
    create type comp_evento as (data date, peso numeric, prisao boolean, fim date);
  end if;
end $$;

create or replace function comportamento_nivel(p text) returns smallint
language sql immutable as $$
  select case p when 'EXCEPCIONAL' then 1 when 'OTIMO' then 2 when 'BOM' then 3
                when 'INSUFICIENTE' then 4 when 'MAU' then 5 end::smallint
$$;
create or replace function comportamento_nome(p smallint) returns text
language sql immutable as $$
  select (array['EXCEPCIONAL', 'OTIMO', 'BOM', 'INSUFICIENTE', 'MAU'])[p]
$$;

-- classe (1 = Excepcional ... 5 = Mau) numa data, dados o ingresso e as penas
create or replace function comportamento_avaliar(p_ref date, p_ingresso date, p_ev comp_evento[], r comportamento_regra)
returns smallint
language plpgsql immutable as $$
declare
  e comp_evento;
  n_exc integer := 0; w_oti numeric := 0; p_oti integer := 0; w_bom numeric := 0; w_mau numeric := 0;
  l_exc timestamp := p_ref - make_interval(years => r.excepcional_anos);
  l_oti timestamp := p_ref - make_interval(years => r.otimo_anos);
  l_bom timestamp := p_ref - make_interval(years => r.bom_anos);
  l_mau timestamp := p_ref - make_interval(months => r.mau_meses);
begin
  foreach e in array coalesce(p_ev, '{}'::comp_evento[]) loop
    continue when e.data is null or e.data > p_ref or (e.fim is not null and e.fim <= p_ref) or coalesce(e.peso, 0) <= 0;
    if e.data > l_exc then n_exc := n_exc + 1; end if;
    if e.data > l_oti then w_oti := w_oti + e.peso; if e.prisao then p_oti := p_oti + 1; end if; end if;
    if e.data > l_bom then w_bom := w_bom + e.peso; end if;
    if e.data > l_mau then w_mau := w_mau + e.peso; end if;
  end loop;
  if p_ingresso is not null and p_ingresso <= l_exc and n_exc = 0 then return 1; end if;
  if p_ingresso is not null and p_ingresso <= l_oti and p_oti = 0 and w_oti <= r.otimo_limite then return 2; end if;
  if w_bom <= r.bom_limite then return 3; end if;
  if w_mau > r.mau_limite then return 5; end if;
  return 4;
end $$;

-- núcleo do cálculo (função pura): recebe as penas, o último publicado e os parâmetros
--   calculado/desde: classe pelo cálculo e desde quando vale
--   proxima_data/proximo: próxima mudança automática prevista (escala móvel)
--   situacao: SEM_BASE (nada publicado), EM_DIA, MELHORIA ou REBAIXAMENTO (a publicar)
--   base_estimada: as penas cadastradas não explicam o publicado; o cálculo supõe o pior caso
--                  (pena na data da publicação) até que o histórico seja completado
create or replace function comportamento_situacao(p_ref date, p_ingresso date, p_ev comp_evento[],
                                                  p_base text, p_base_data date, r comportamento_regra)
returns table (calculado text, desde date, proxima_data date, proximo text, situacao text, base_estimada boolean)
language plpgsql immutable as $$
declare
  ev comp_evento[] := coalesce(p_ev, '{}'::comp_evento[]);
  k smallint; c smallint := comportamento_nivel(p_base); cur smallint; x smallint; cand date[]; d date; i integer;
begin
  base_estimada := false;
  if p_base is not null and p_base_data is not null then
    k := comportamento_avaliar(p_base_data, p_ingresso, ev, r);
    if k < c then
      base_estimada := true;
      ev := ev || case c
        when 2 then array[row(p_base_data, r.peso_detencao, false, null)::comp_evento]
        when 3 then array[row(p_base_data, r.peso_prisao, true, null)::comp_evento]
        when 4 then array[row(p_base_data, r.peso_prisao, true, null)::comp_evento,
                          row(p_base_data, r.peso_prisao, true, null)::comp_evento]
        else        array[row(p_base_data, r.peso_prisao, true, null)::comp_evento,
                          row(p_base_data, r.peso_prisao, true, null)::comp_evento,
                          row(p_base_data, r.peso_prisao, true, null)::comp_evento]
      end;
    end if;
  end if;

  cur := comportamento_avaliar(p_ref, p_ingresso, ev, r);
  calculado := comportamento_nome(cur);

  -- datas em que a classe pode mudar: entrada e saída de cada pena das janelas, cancelamentos e aniversários de serviço
  select coalesce(array_agg(distinct dd order by dd), '{}') into cand from (
    select e.data as dd from unnest(ev) e
    union all select (e.data + make_interval(months => r.mau_meses))::date from unnest(ev) e
    union all select (e.data + make_interval(years => y))::date from unnest(ev) e,
                     unnest(array[r.bom_anos, r.otimo_anos, r.excepcional_anos]) y
    union all select e.fim from unnest(ev) e
    union all select (p_ingresso + make_interval(years => y))::date from unnest(array[r.otimo_anos, r.excepcional_anos]) y
  ) z where dd is not null;

  foreach d in array cand loop
    continue when d <= p_ref;
    x := comportamento_avaliar(d, p_ingresso, ev, r);
    if x <> cur then proxima_data := d; proximo := comportamento_nome(x); exit; end if;
  end loop;

  if array_length(cand, 1) is not null then
    for i in reverse array_length(cand, 1) .. 1 loop
      d := cand[i];
      continue when d > p_ref;
      if comportamento_avaliar(d - 1, p_ingresso, ev, r) <> cur then desde := d; exit; end if;
    end loop;
  end if;
  desde := coalesce(desde, p_ingresso);

  situacao := case when p_base is null then 'SEM_BASE'
                   when cur = c then 'EM_DIA'
                   when cur < c then 'MELHORIA'
                   else 'REBAIXAMENTO' end;
  return next;
end $$;

-- penas de cada militar no formato do motor (uma linha por militar com pena que conta)
create or replace view v_comportamento_penas with (security_invoker = on) as
select p.militar_id,
       array_agg(row(p.data_contagem,
                     case t.efeito_comportamento when 'PRISAO' then r.peso_prisao when 'DETENCAO' then r.peso_detencao
                                                 when 'REPREENSAO' then r.peso_repreensao else 0 end,
                     t.efeito_comportamento = 'PRISAO', p.cancelada_em)::comp_evento)
         filter (where p.data_contagem is not null) as ev,
       count(*) filter (where p.data_contagem is not null and (p.cancelada_em is null or p.cancelada_em > current_date))::integer as consideradas,
       count(*) filter (where p.data_contagem is null and p.cancelada_em is null)::integer as sem_data
  from punicao p
  join tipo_punicao t on t.id = p.tipo_id
  cross join comportamento_regra r
 where t.efeito_comportamento <> 'NENHUM' and r.id = 1
 group by p.militar_id;

-- situação de um militar numa data (para conferências e para a ficha em datas passadas)
create or replace function comportamento_calcular(p_militar uuid, p_ref date default current_date)
returns table (calculado text, desde date, proxima_data date, proximo text,
               publicado text, publicado_data date, publicado_publicacao text,
               situacao text, base_estimada boolean, punicoes_consideradas integer, punicoes_sem_data integer)
language plpgsql stable set search_path = public as $$
declare r comportamento_regra; v_ing date; ev comp_evento[]; b comportamento_publicado; s record;
begin
  select * into r from comportamento_regra where id = 1;
  select coalesce(m.data_ingresso, case when m.ano_ingresso is not null then make_date(m.ano_ingresso, 12, 31) end)
    into v_ing from militar m where m.id = p_militar;
  select coalesce(array_agg(row(p.data_contagem,
           case t.efeito_comportamento when 'PRISAO' then r.peso_prisao when 'DETENCAO' then r.peso_detencao
                                       when 'REPREENSAO' then r.peso_repreensao else 0 end,
           t.efeito_comportamento = 'PRISAO', p.cancelada_em)::comp_evento) filter (where p.data_contagem is not null), '{}'),
         count(*) filter (where p.data_contagem is not null and (p.cancelada_em is null or p.cancelada_em > p_ref)),
         count(*) filter (where p.data_contagem is null and p.cancelada_em is null)
    into ev, punicoes_consideradas, punicoes_sem_data
    from punicao p join tipo_punicao t on t.id = p.tipo_id
   where p.militar_id = p_militar and t.efeito_comportamento <> 'NENHUM';
  select * into b from comportamento_publicado cp
   where cp.militar_id = p_militar and cp.data_vigencia <= p_ref
   order by cp.data_vigencia desc, cp.criado_em desc limit 1;
  publicado := b.comportamento; publicado_data := b.data_vigencia; publicado_publicacao := b.publicacao;
  select * into s from comportamento_situacao(p_ref, v_ing, ev, b.comportamento, b.data_vigencia, r);
  calculado := s.calculado; desde := s.desde; proxima_data := s.proxima_data; proximo := s.proximo;
  situacao := s.situacao; base_estimada := s.base_estimada;
  return next;
end $$;

-- praças ativas com o comportamento calculado (respeita o acesso de cada usuário).
-- Tudo em conjunto: penas e publicações são lidas uma vez, não militar a militar.
create or replace view v_comportamento with (security_invoker = on) as
with base as (
  select distinct on (cp.militar_id) cp.militar_id, cp.comportamento, cp.data_vigencia, cp.publicacao
    from comportamento_publicado cp
   where cp.data_vigencia <= current_date
   order by cp.militar_id, cp.data_vigencia desc, cp.criado_em desc
)
select m.id as militar_id, m.matricula, m.nome, m.nome_guerra, m.posto_id, pg.sigla as posto_sigla, pg.ordem as posto_ordem,
       m.quadro_sigla, m.ome_id, o.sigla as ome_sigla, m.secao_id, m.data_ingresso, m.ordem_antiguidade,
       c.calculado, c.desde, c.proxima_data, c.proximo,
       b.comportamento as publicado, b.data_vigencia as publicado_data, b.publicacao as publicado_publicacao,
       c.situacao, c.base_estimada, coalesce(pe.consideradas, 0) as punicoes_consideradas, coalesce(pe.sem_data, 0) as punicoes_sem_data
  from militar m
  join posto_graduacao pg on pg.id = m.posto_id
  join ome o on o.id = m.ome_id
  cross join comportamento_regra r
  left join base b on b.militar_id = m.id
  left join v_comportamento_penas pe on pe.militar_id = m.id
  cross join lateral comportamento_situacao(current_date,
      coalesce(m.data_ingresso, case when m.ano_ingresso is not null then make_date(m.ano_ingresso, 12, 31) end),
      pe.ev, b.comportamento, b.data_vigencia, r) c
 where m.situacao = 'ATIVO' and pg.ordem >= 8 and r.id = 1;

-- =====================================================================
-- 3. FICHA (v_militar): campos novos e comportamento publicado
-- =====================================================================
do $$
declare d text; novos text :=
  'm.data_ingresso, m.sexo, m.data_nascimento, '
  || '(date_part(''year'', age(CURRENT_DATE, m.data_nascimento)))::integer AS idade, '
  || 'm.numero_funcional, m.orgao_cessao, m.data_promocao, '
  || '(SELECT cp.comportamento FROM comportamento_publicado cp WHERE cp.militar_id = m.id AND cp.data_vigencia <= CURRENT_DATE '
  || 'ORDER BY cp.data_vigencia DESC, cp.criado_em DESC LIMIT 1) AS comportamento, '
  || '(SELECT cp.data_vigencia FROM comportamento_publicado cp WHERE cp.militar_id = m.id AND cp.data_vigencia <= CURRENT_DATE '
  || 'ORDER BY cp.data_vigencia DESC, cp.criado_em DESC LIMIT 1) AS comportamento_data FROM';
begin
  d := pg_get_viewdef('v_militar'::regclass);
  if position('NULL::text AS sexo' in d) > 0 then          -- banco que já teve a 1.4 e foi revertido
    d := regexp_replace(d, 'm\.data_ingresso,\s+NULL::text AS sexo.*AS comportamento_data\s+FROM', novos);
  elsif d ~ 'm\.data_ingresso\s+FROM' then
    d := regexp_replace(d, 'm\.data_ingresso\s+FROM', novos);
  else raise exception 'v_militar: formato inesperado.'; end if;
  execute 'create or replace view v_militar with (security_invoker = on) as ' || d;
end $$;

-- =====================================================================
-- 4. DICIONÁRIO DE DADOS
-- =====================================================================
update catalogo_campo set fonte = 'Pecúlio (SGP); almanaque quando faltar', edicao = 'Somente DGP (pecúlio ou correção)'
 where campo = 'Nome de guerra';
update catalogo_campo set fonte = 'Pecúlio (SGP)' where campo in ('Posto/graduação', 'Quadro');
update catalogo_campo set fonte = 'Almanaque (data de praça)' where campo = 'Data de ingresso';
update catalogo_campo set fonte = 'Almanaque' where campo = 'Número de antiguidade';
update catalogo_campo set fonte = 'Almanaque', situacao = 'EM_USO', observacao = null, edicao = 'Somente DGP (almanaque ou correção)'
 where campo = 'Data da última promoção';
update catalogo_campo set fonte = 'Pecúlio (SGP)', situacao = 'EM_USO', edicao = 'Somente DGP (pecúlio ou correção)',
       definicao = 'M ou F.' where campo = 'Sexo';
update catalogo_campo set fonte = 'Almanaque', situacao = 'EM_USO', edicao = 'Somente DGP (almanaque ou correção)',
       definicao = 'Data de nascimento. A idade é calculada.' where campo = 'Data de nascimento';
update catalogo_campo set responsavel = 'OME (BI) e DGP (BGE)', edicao = 'Gestor da OME e DGP',
       definicao = 'Penas disciplinares (art. 28): tipo, publicação, cumprimento e cancelamento. Base do cálculo do comportamento.',
       fonte = 'BI / BGE; ficha disciplinar'
 where campo = 'Punições';
update catalogo_campo set situacao = 'EM_USO', responsavel = 'OME (BI) e DGP (BGE)', edicao = 'Gestor da OME e DGP',
       definicao = 'Comportamento da praça (Excepcional, Ótimo, Bom, Insuficiente, Mau). O oficial é o publicado; o sistema calcula a escala móvel e aponta o que falta publicar.',
       fonte = 'Publicação em boletim; cálculo pela Lei 11.817/2000 (arts. 45-49) e Decreto 50.014/2020',
       observacao = 'Oficiais e aspirantes não são classificados.'
 where campo = 'Comportamento';
insert into catalogo_campo (ordem, grupo, campo, definicao, fonte, responsavel, edicao, sensibilidade, atualizacao, situacao, observacao) values
 (13, 'Identificação', 'Nº funcional', 'Número funcional do vínculo no Estado (ex.: 2441616/01).', 'Pecúlio (SGP)', 'DGP', 'Somente DGP (pecúlio)', 'PESSOAL', 'Na inclusão', 'EM_USO', null),
 (35, 'Lotação', 'Órgão de cessão', 'Órgão onde o militar está cedido ou à disposição (SDS, CAMIL, TJPE...). Vazio = no CBMPE.', 'Pecúlio (SGP), coluna ÓRGÃO', 'DGP', 'Somente DGP (pecúlio)', 'INTERNO', 'Mensal (pecúlio)', 'EM_USO', null),
 (111, 'Não armazenados', 'Raça/cor', 'Existe no pecúlio, mas não é carregado.', 'Pecúlio (SGP)', '—', '—', 'SENSIVEL', '—', 'NAO_ARMAZENADO', 'Decisão da DGP (18/11/2026): dado sensível (LGPD art. 5º II e art. 11) sem finalidade definida no regimento.')
on conflict (grupo, campo) do nothing;

-- =====================================================================
-- 5. PERMISSÕES, AUDITORIA E ESTATÍSTICAS
-- =====================================================================
revoke all on comportamento_regra, comportamento_publicado, v_comportamento, v_comportamento_penas from anon;
grant select on comportamento_regra, v_comportamento, v_comportamento_penas to authenticated;
grant update on comportamento_regra to authenticated;
grant select, insert, update, delete on comportamento_publicado to authenticated;
grant all on comportamento_regra, comportamento_publicado, v_comportamento, v_comportamento_penas to service_role;
revoke execute on function comportamento_avaliar(date, date, comp_evento[], comportamento_regra),
                           comportamento_situacao(date, date, comp_evento[], text, date, comportamento_regra),
                           comportamento_calcular(uuid, date), comportamento_nivel(text), comportamento_nome(smallint),
                           trg_comportamento_publicado_antes() from anon, public;
grant execute on function comportamento_avaliar(date, date, comp_evento[], comportamento_regra),
                          comportamento_situacao(date, date, comp_evento[], text, date, comportamento_regra),
                          comportamento_calcular(uuid, date), comportamento_nivel(text), comportamento_nome(smallint)
  to authenticated, service_role;

drop trigger if exists auditoria_comportamento_publicado on comportamento_publicado;
create trigger auditoria_comportamento_publicado after insert or update or delete on comportamento_publicado
  for each row execute function trg_auditoria();
drop trigger if exists auditoria_comportamento_regra on comportamento_regra;
create trigger auditoria_comportamento_regra after insert or update or delete on comportamento_regra
  for each row execute function trg_auditoria();

commit;

analyze militar;
analyze punicao;
notify pgrst, 'reload schema';

select 'Versão 1.4 aplicada com sucesso' as resultado;
