-- =====================================================================
-- Sistema de Controle do Efetivo (DGP/CBMPE) — versão 1.3
-- Regiões e hierarquia de comando, municípios (mapa), antiguidade,
-- consultas salvas e dicionário de dados.
--
-- Requer a versão 1.2. Roda numa única transação: ou aplica tudo, ou nada.
-- Não apaga dados. Para desfazer: supabase/reverter_1_3.sql
-- =====================================================================
set client_min_messages = warning;
begin;

do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.2') then
    raise exception 'Aplique antes o 20261201000000_versao_1_2.sql (versão 1.2).';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.3') then
    raise exception 'A versão 1.3 já está aplicada neste banco: nada a fazer.';
  end if;
end $$;

insert into versao_sistema (versao) values ('1.3');

-- =====================================================================
-- 1. MUNICÍPIOS DE PERNAMBUCO (códigos do IBGE)
-- =====================================================================
create table if not exists municipio (
  codigo  integer primary key check (codigo between 2600000 and 2699999),
  nome    text not null unique
);
comment on table municipio is 'Municípios de Pernambuco (código IBGE), usados no mapa e nas consultas por cidade';

insert into municipio (codigo, nome) values
  (2600054, 'Abreu e Lima'), (2600104, 'Afogados da Ingazeira'), (2600203, 'Afrânio'), (2600302, 'Agrestina'), (2600609, 'Alagoinha'), (2600708, 'Aliança'),
  (2600807, 'Altinho'), (2600906, 'Amaraji'), (2601003, 'Angelim'), (2601102, 'Araripina'), (2601052, 'Araçoiaba'), (2601201, 'Arcoverde'),
  (2601300, 'Barra de Guabiraba'), (2601409, 'Barreiros'), (2601706, 'Belo Jardim'), (2601508, 'Belém de Maria'), (2601607, 'Belém de São Francisco'), (2601805, 'Betânia'),
  (2601904, 'Bezerros'), (2602001, 'Bodocó'), (2602100, 'Bom Conselho'), (2602209, 'Bom Jardim'), (2602308, 'Bonito'), (2602506, 'Brejinho'),
  (2602605, 'Brejo da Madre de Deus'), (2602407, 'Brejão'), (2602704, 'Buenos Aires'), (2602803, 'Buíque'), (2602902, 'Cabo de Santo Agostinho'), (2603009, 'Cabrobó'),
  (2603108, 'Cachoeirinha'), (2603207, 'Caetés'), (2603405, 'Calumbi'), (2603306, 'Calçado'), (2603454, 'Camaragibe'), (2603504, 'Camocim de São Félix'),
  (2603603, 'Camutanga'), (2603702, 'Canhotinho'), (2603801, 'Capoeiras'), (2603926, 'Carnaubeira da Penha'), (2603900, 'Carnaíba'), (2604007, 'Carpina'),
  (2604106, 'Caruaru'), (2604155, 'Casinhas'), (2604205, 'Catende'), (2604304, 'Cedro'), (2604502, 'Chã Grande'), (2604403, 'Chã de Alegria'),
  (2604601, 'Condado'), (2604700, 'Correntes'), (2604809, 'Cortês'), (2604908, 'Cumaru'), (2605004, 'Cupira'), (2605103, 'Custódia'),
  (2605152, 'Dormentes'), (2605202, 'Escada'), (2605301, 'Exu'), (2605400, 'Feira Nova'), (2605459, 'Fernando de Noronha'), (2605509, 'Ferreiros'),
  (2605608, 'Flores'), (2605707, 'Floresta'), (2605806, 'Frei Miguelinho'), (2605905, 'Gameleira'), (2606002, 'Garanhuns'), (2606101, 'Glória do Goitá'),
  (2606200, 'Goiana'), (2606309, 'Granito'), (2606408, 'Gravatá'), (2606507, 'Iati'), (2606606, 'Ibimirim'), (2606705, 'Ibirajuba'),
  (2606804, 'Igarassu'), (2606903, 'Iguaraci'), (2607604, 'Ilha de Itamaracá'), (2607000, 'Inajá'), (2607109, 'Ingazeira'), (2607208, 'Ipojuca'),
  (2607307, 'Ipubi'), (2607406, 'Itacuruba'), (2607653, 'Itambé'), (2607703, 'Itapetim'), (2607752, 'Itapissuma'), (2607802, 'Itaquitinga'),
  (2607505, 'Itaíba'), (2607901, 'Jaboatão dos Guararapes'), (2607950, 'Jaqueira'), (2608008, 'Jataúba'), (2608057, 'Jatobá'), (2608206, 'Joaquim Nabuco'),
  (2608107, 'João Alfredo'), (2608255, 'Jucati'), (2608305, 'Jupi'), (2608404, 'Jurema'), (2608750, 'Lagoa Grande'), (2608453, 'Lagoa do Carro'),
  (2608503, 'Lagoa do Itaenga'), (2608602, 'Lagoa do Ouro'), (2608701, 'Lagoa dos Gatos'), (2608800, 'Lajedo'), (2608909, 'Limoeiro'), (2609006, 'Macaparana'),
  (2609105, 'Machados'), (2609154, 'Manari'), (2609204, 'Maraial'), (2609303, 'Mirandiba'), (2614303, 'Moreilândia'), (2609402, 'Moreno'),
  (2609501, 'Nazaré da Mata'), (2609600, 'Olinda'), (2609709, 'Orobó'), (2609808, 'Orocó'), (2609907, 'Ouricuri'), (2610004, 'Palmares'),
  (2610103, 'Palmeirina'), (2610202, 'Panelas'), (2610301, 'Paranatama'), (2610400, 'Parnamirim'), (2610509, 'Passira'), (2610608, 'Paudalho'),
  (2610707, 'Paulista'), (2610806, 'Pedra'), (2610905, 'Pesqueira'), (2611101, 'Petrolina'), (2611002, 'Petrolândia'), (2611309, 'Pombos'),
  (2611200, 'Poção'), (2611408, 'Primavera'), (2611507, 'Quipapá'), (2611533, 'Quixaba'), (2611606, 'Recife'), (2611705, 'Riacho das Almas'),
  (2611804, 'Ribeirão'), (2611903, 'Rio Formoso'), (2612000, 'Sairé'), (2612109, 'Salgadinho'), (2612208, 'Salgueiro'), (2612307, 'Saloá'),
  (2612406, 'Sanharó'), (2612455, 'Santa Cruz'), (2612471, 'Santa Cruz da Baixa Verde'), (2612505, 'Santa Cruz do Capibaribe'), (2612554, 'Santa Filomena'), (2612604, 'Santa Maria da Boa Vista'),
  (2612703, 'Santa Maria do Cambucá'), (2612802, 'Santa Terezinha'), (2613909, 'Serra Talhada'), (2614006, 'Serrita'), (2614105, 'Sertânia'), (2614204, 'Sirinhaém'),
  (2614402, 'Solidão'), (2614501, 'Surubim'), (2612901, 'São Benedito do Sul'), (2613008, 'São Bento do Una'), (2613107, 'São Caitano'), (2613305, 'São Joaquim do Monte'),
  (2613404, 'São José da Coroa Grande'), (2613503, 'São José do Belmonte'), (2613602, 'São José do Egito'), (2613206, 'São João'), (2613701, 'São Lourenço da Mata'), (2613800, 'São Vicente Ferrer'),
  (2614600, 'Tabira'), (2614709, 'Tacaimbó'), (2614808, 'Tacaratu'), (2614857, 'Tamandaré'), (2615003, 'Taquaritinga do Norte'), (2615102, 'Terezinha'),
  (2615201, 'Terra Nova'), (2615300, 'Timbaúba'), (2615409, 'Toritama'), (2615508, 'Tracunhaém'), (2615607, 'Trindade'), (2615706, 'Triunfo'),
  (2615805, 'Tupanatinga'), (2615904, 'Tuparetama'), (2616001, 'Venturosa'), (2616100, 'Verdejante'), (2616183, 'Vertente do Lério'), (2616209, 'Vertentes'),
  (2616308, 'Vicência'), (2616407, 'Vitória de Santo Antão'), (2616506, 'Xexéu'), (2600401, 'Água Preta'), (2600500, 'Águas Belas');

alter table municipio enable row level security;
create policy municipio_ler on municipio for select to authenticated using ((select usuario_ativo()));

-- Nome sem acento, minúsculo e com espaços simples (para casar nomes de cidades)
create or replace function norm_nome(p text) returns text
language sql immutable strict set search_path = public as $$
  select lower(regexp_replace(trim(translate(p,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g'))
$$;

-- =====================================================================
-- 2. HIERARQUIA DE COMANDO E REGIÕES
--    comando_id = OME imediatamente superior (ex.: 2ºGB -> DInter/1)
--    regional   = OME que dá nome a uma região (DIM, DInter/1, DInter/2)
--    A região de uma OME é a primeira OME regional subindo pela hierarquia.
-- =====================================================================
alter table ome add column if not exists comando_id     integer references ome(id) on delete set null;
alter table ome add column if not exists regional       boolean not null default false;
alter table ome add column if not exists municipio_ibge integer references municipio(codigo);
alter table ome drop constraint if exists ome_comando_diferente;
alter table ome add constraint ome_comando_diferente check (comando_id is null or comando_id <> id);
create index if not exists ome_comando_idx on ome(comando_id);

alter table secao add column if not exists municipio_ibge integer references municipio(codigo);

comment on column ome.comando_id is 'OME imediatamente superior na cadeia de comando';
comment on column ome.regional is 'Marca as OMEs que definem uma região (DIM, DINTER I, DINTER II)';
comment on column ome.municipio_ibge is 'Município da sede da OME';
comment on column secao.municipio_ibge is 'Município da seção; vazio = o da OME';

-- Impede ciclos (A comanda B que comanda A)
create or replace function trg_ome_ciclo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.comando_id is not null and exists (
    with recursive acima(id) as (
      select new.comando_id
      union
      select o.comando_id from ome o join acima a on o.id = a.id where o.comando_id is not null
    ) select 1 from acima where id = new.id
  ) then
    raise exception 'Hierarquia inválida: % ficaria subordinada a uma OME que ela mesma comanda.', new.sigla;
  end if;
  return new;
end $$;
drop trigger if exists ome_ciclo on ome;
create trigger ome_ciclo before insert or update of comando_id on ome
  for each row execute function trg_ome_ciclo();

update ome set regional = true where sigla in ('DIM', 'DInter/1', 'DInter/2');

-- Região de cada OME (null = "Demais OMEs")
create or replace view v_ome_regiao with (security_invoker = on) as
with recursive r(ome_id, regiao_id, nivel) as (
  select id, id, 0 from ome where regional
  union all
  select o.id, r.regiao_id, r.nivel + 1
  from ome o join r on o.comando_id = r.ome_id
  where not o.regional and r.nivel < 20
)
select o.id as ome_id, r.regiao_id, rg.sigla as regiao_sigla
from ome o
left join r on r.ome_id = o.id
left join ome rg on rg.id = r.regiao_id;

-- Município das seções pelo nome entre parênteses, ex.: "1ª SB (Caruaru)"
with apelido(curto, nome) as (values
  ('vitoria', 'Vitória de Santo Antão'), ('cabo', 'Cabo de Santo Agostinho'),
  ('jaboatao', 'Jaboatão dos Guararapes'), ('sao lourenco', 'São Lourenço da Mata'),
  ('santa cruz', 'Santa Cruz do Capibaribe'), ('noronha', 'Fernando de Noronha'),
  ('itamaraca', 'Ilha de Itamaracá'), ('st cruz do capibaribe', 'Santa Cruz do Capibaribe')
), alvo as (
  select s.id, norm_nome(substring(s.nome from '\(([^)]*)\)')) as cidade
  from secao s where s.municipio_ibge is null
)
update secao s set municipio_ibge = m.codigo
from alvo a
left join apelido ap on ap.curto = a.cidade
join municipio m on norm_nome(m.nome) = coalesce(norm_nome(ap.nome), a.cidade)
where s.id = a.id;

-- Sede da OME = cidade da sua 1ª SB, quando houver
update ome o set municipio_ibge = x.municipio_ibge
from (
  select distinct on (s.ome_id) s.ome_id, s.municipio_ibge
  from secao s
  where s.municipio_ibge is not null
  order by s.ome_id, (s.nome ~* '^\s*1\s*[ªa]') desc, s.ordem
) x
where x.ome_id = o.id and o.municipio_ibge is null;

-- ---------------------------------------------------------------------
-- Acesso pela hierarquia: quem tem uma OME enxerga (somente leitura)
-- as OMEs subordinadas a ela. Edição continua só nas OMEs marcadas.
-- ---------------------------------------------------------------------
create or replace function omes_com_subordinadas(p_ids integer[]) returns integer[]
language sql stable security definer set search_path = public as $$
  with recursive t(id) as (
    select unnest(coalesce(p_ids, '{}'::integer[]))
    union
    select o.id from ome o join t on o.comando_id = t.id
  )
  select coalesce(array_agg(id), '{}') from t
$$;

create or replace function minhas_omes() returns integer[]
language sql stable security definer set search_path = public as $$
  select case
    when papel_atual() in ('ADMIN','DGP','LEITOR_GERAL') then (select coalesce(array_agg(id), '{}') from ome)
    when papel_atual() is null then '{}'::integer[]
    else omes_com_subordinadas((select array_agg(ome_id) from perfil_ome where perfil_id = auth.uid()))
  end
$$;

create or replace function pode_ler_ome(p_ome integer) returns boolean
language sql stable security definer set search_path = public as $$
  select e_leitura_global()
      or (usuario_ativo() and p_ome = any (omes_com_subordinadas(
            (select array_agg(ome_id) from perfil_ome where perfil_id = auth.uid()))))
$$;

-- meu_contexto: a lista de OMEs do usuário passa a incluir as subordinadas
do $$
declare v_def text; v_novo text;
begin
  v_def := pg_get_functiondef('meu_contexto()'::regprocedure);
  v_novo := replace(v_def,
    'or exists (select 1 from perfil_ome po where po.perfil_id = p.id and po.ome_id = o.id)',
    'or o.id = any (omes_com_subordinadas(array(select po.ome_id from perfil_ome po where po.perfil_id = p.id)))');
  if v_novo = v_def then
    raise exception 'meu_contexto: formato inesperado (a 1.2 foi alterada manualmente?)';
  end if;
  execute v_novo;
end $$;

-- =====================================================================
-- 3. ANTIGUIDADE
--    Ordem geral: posto/graduação, quadro (QOC antes de QOA), número de
--    antiguidade, data de ingresso, nome. Posições calculadas sobre todo
--    o efetivo ativo; cada usuário recebe só as linhas das OMEs que vê.
-- =====================================================================
alter table quadro add column if not exists ordem smallint not null default 50;
update quadro set ordem = case sigla when 'QOC' then 1 when 'QOA' then 2 else ordem end;

create or replace function antiguidade_lista()
returns table (militar_id uuid, pos_geral integer, total_geral integer,
               pos_posto integer, total_posto integer, pos_ome integer, total_ome integer,
               pos_posto_ome integer, total_posto_ome integer, pos_regiao integer, total_regiao integer)
language sql stable security definer set search_path = public as $$
  with base as (
    select m.id, m.ome_id, m.posto_id, coalesce(m.quadro_sigla, '') as quadro, coalesce(r.regiao_id, 0) as regiao,
           row_number() over (order by pg.ordem, coalesce(q.ordem, 50), m.ordem_antiguidade nulls last,
                                       m.data_ingresso nulls last, m.ano_ingresso nulls last, m.nome, m.matricula) as k
    from militar m
    join posto_graduacao pg on pg.id = m.posto_id
    left join quadro q on q.sigla = m.quadro_sigla
    left join v_ome_regiao r on r.ome_id = m.ome_id
    where m.situacao = 'ATIVO'
  ), pos as (
    select b.id, b.ome_id,
      b.k::int as pos_geral, (count(*) over ())::int as total_geral,
      (row_number() over (partition by b.posto_id, b.quadro order by b.k))::int as pos_posto,
      (count(*) over (partition by b.posto_id, b.quadro))::int as total_posto,
      (row_number() over (partition by b.ome_id order by b.k))::int as pos_ome,
      (count(*) over (partition by b.ome_id))::int as total_ome,
      (row_number() over (partition by b.ome_id, b.posto_id, b.quadro order by b.k))::int as pos_posto_ome,
      (count(*) over (partition by b.ome_id, b.posto_id, b.quadro))::int as total_posto_ome,
      case when b.regiao = 0 then null else (row_number() over (partition by b.regiao order by b.k))::int end as pos_regiao,
      case when b.regiao = 0 then null else (count(*) over (partition by b.regiao))::int end as total_regiao
    from base b
  )
  select p.id, p.pos_geral, p.total_geral, p.pos_posto, p.total_posto, p.pos_ome, p.total_ome,
         p.pos_posto_ome, p.total_posto_ome, p.pos_regiao, p.total_regiao
  from pos p
  where p.ome_id = any (minhas_omes())
  order by p.pos_geral
$$;

-- =====================================================================
-- 4. CONSULTAS SALVAS
--    Guardam só a "receita" da consulta (filtros e agrupamentos), nunca
--    os dados: ao abrir, cada usuário vê apenas o que já pode ver.
-- =====================================================================
create table if not exists consulta_salva (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) between 3 and 120),
  descricao      text,
  assunto        text not null,
  spec           jsonb not null,
  dono           uuid not null default auth.uid() references perfil(id) on delete cascade,
  compartilhada  boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists consulta_salva_dono_idx on consulta_salva(dono);

alter table consulta_salva enable row level security;
create policy consulta_salva_ler on consulta_salva for select to authenticated
  using ((select usuario_ativo()) and (dono = auth.uid() or compartilhada));
create policy consulta_salva_incluir on consulta_salva for insert to authenticated
  with check ((select usuario_ativo()) and dono = auth.uid() and (not compartilhada or (select e_gestao_global())));
create policy consulta_salva_alterar on consulta_salva for update to authenticated
  using (dono = auth.uid() or (select e_admin()))
  with check (not compartilhada or (select e_gestao_global()));
create policy consulta_salva_excluir on consulta_salva for delete to authenticated
  using (dono = auth.uid() or (select e_admin()));

create or replace function trg_consulta_salva_antes() returns trigger
language plpgsql set search_path = public as $$
begin
  new.nome := trim(new.nome);
  new.atualizado_em := now();
  if tg_op = 'UPDATE' then new.dono := old.dono; new.criado_em := old.criado_em; end if;
  return new;
end $$;
drop trigger if exists consulta_salva_antes on consulta_salva;
create trigger consulta_salva_antes before insert or update on consulta_salva
  for each row execute function trg_consulta_salva_antes();

-- =====================================================================
-- 5. DICIONÁRIO DE DADOS (pertinência de cada informação)
-- =====================================================================
create table if not exists catalogo_campo (
  id             integer generated always as identity primary key,
  grupo          text not null,
  campo          text not null,
  definicao      text,
  fonte          text,
  responsavel    text,
  edicao         text,
  sensibilidade  text not null default 'INTERNO' check (sensibilidade in ('INTERNO','PESSOAL','RESTRITO','SENSIVEL')),
  atualizacao    text,
  situacao       text not null default 'EM_USO' check (situacao in ('EM_USO','PREVISTO','NAO_ARMAZENADO')),
  observacao     text,
  ordem          integer not null default 999,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  unique (grupo, campo)
);
alter table catalogo_campo enable row level security;
create policy catalogo_ler on catalogo_campo for select to authenticated using ((select usuario_ativo()));
create policy catalogo_manter on catalogo_campo for all to authenticated
  using ((select e_gestao_global())) with check ((select e_gestao_global()));

create or replace function trg_catalogo_antes() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now(); new.atualizado_por := auth.uid();
  return new;
end $$;
drop trigger if exists catalogo_antes on catalogo_campo;
create trigger catalogo_antes before insert or update on catalogo_campo
  for each row execute function trg_catalogo_antes();

insert into catalogo_campo (ordem, grupo, campo, definicao, fonte, responsavel, edicao, sensibilidade, atualizacao, situacao, observacao) values
 (10, 'Identificação', 'Matrícula', 'Número funcional do militar, no formato 000000-0. Chave de todos os cruzamentos.', 'Pecúlio (SGP)', 'DGP', 'Somente DGP', 'PESSOAL', 'Na inclusão', 'EM_USO', null),
 (11, 'Identificação', 'Nome completo', 'Nome civil completo, em maiúsculas.', 'Pecúlio (SGP)', 'DGP', 'Somente DGP (a OME pede correção)', 'PESSOAL', 'Eventual', 'EM_USO', null),
 (12, 'Identificação', 'Nome de guerra', 'Nome pelo qual o militar é identificado na corporação.', 'Almanaque', 'DGP', 'Importação do almanaque', 'PESSOAL', 'Mensal', 'EM_USO', null),
 (20, 'Carreira', 'Posto/graduação', 'Posto (oficiais) ou graduação (praças) atual.', 'Almanaque; promoção publicada em BGE', 'DGP', 'Somente DGP (almanaque ou correção)', 'INTERNO', 'A cada promoção', 'EM_USO', null),
 (21, 'Carreira', 'Quadro', 'Quadro do oficial: QOC, QOA etc.', 'Almanaque / pecúlio', 'DGP', 'Somente DGP', 'INTERNO', 'Eventual', 'EM_USO', null),
 (22, 'Carreira', 'Data de ingresso', 'Data de inclusão (praça) na corporação. Base do tempo de serviço e dos 12 meses para férias.', 'Almanaque (data de praça) / pecúlio', 'DGP', 'Importação', 'PESSOAL', 'Na inclusão', 'EM_USO', null),
 (23, 'Carreira', 'Ano de ingresso', 'Ano da data de ingresso (calculado).', 'Calculado', 'DGP', 'Ninguém (automático)', 'INTERNO', 'Automática', 'EM_USO', null),
 (24, 'Carreira', 'Número de antiguidade', 'Posição na lista de antiguidade do posto/quadro.', 'Almanaque (fonte oficial a definir: almanaque ou pecúlio)', 'DGP', 'Importação', 'INTERNO', 'Mensal', 'EM_USO', null),
 (25, 'Carreira', 'Data da última promoção', 'Data de promoção ao posto/graduação atual.', 'Pecúlio (SGP)', 'DGP', 'Importação', 'INTERNO', 'A cada promoção', 'PREVISTO', 'Entra com o pecúlio'),
 (30, 'Lotação', 'OME', 'Organização em que o militar está classificado.', 'Movimentação publicada em BGE', 'DGP (DMCP)', 'Somente DGP (movimentação)', 'INTERNO', 'A cada movimentação', 'EM_USO', null),
 (31, 'Lotação', 'Seção', 'Subunidade ou setor dentro da OME.', 'Decisão do comandante da OME', 'OME', 'OME', 'INTERNO', 'Eventual', 'EM_USO', null),
 (32, 'Lotação', 'Atividade', 'Operacional ou administrativa.', 'OME', 'OME', 'OME', 'INTERNO', 'Eventual', 'EM_USO', null),
 (33, 'Lotação', 'Município', 'Cidade da seção (ou da sede da OME). Usado no mapa e nas consultas por região.', 'Cadastro de seções', 'DGP', 'Somente DGP', 'INTERNO', 'Eventual', 'EM_USO', null),
 (34, 'Lotação', 'Região / comando superior', 'DIM, DINTER I, DINTER II ou demais OMEs, pela cadeia de comando.', 'Estrutura organizacional (regimento)', 'DGP', 'Somente ADMIN', 'INTERNO', 'Eventual', 'EM_USO', null),
 (40, 'Situação', 'Situação funcional', 'Ativo, reserva, reforma, falecido, exonerado etc.', 'Publicação em BGE', 'DGP', 'Somente DGP (desligamento)', 'INTERNO', 'A cada publicação', 'EM_USO', null),
 (50, 'Afastamentos', 'Afastamento', 'Tipo, início, dias e processo SEI de cada afastamento.', 'Ato da OME / processo SEI', 'OME', 'OME lança; DGP confere', 'INTERNO', 'A cada ocorrência', 'EM_USO', null),
 (51, 'Afastamentos', 'Natureza / CID', 'Dado de saúde do afastamento.', 'Atestado / junta', 'OME', 'Só quem tem permissão de saúde', 'SENSIVEL', 'A cada ocorrência', 'EM_USO', 'LGPD, art. 11: acesso registrado'),
 (60, 'Férias', 'Períodos do PAF', 'Períodos de férias por exercício, reprogramações e interrupções.', 'PAF publicado (Portaria do CG nº 312/2025)', 'DGP', 'OME propõe; DGP homologa', 'INTERNO', 'Anual e a cada reprogramação', 'EM_USO', null),
 (70, 'Condições especiais', 'Readaptação', 'Restrição funcional por motivo de saúde, com processo.', 'Processo SEI', 'OME / DGP', 'OME com processo', 'SENSIVEL', 'Eventual', 'EM_USO', null),
 (71, 'Condições especiais', 'Horário especial', 'Horário especial de trabalho concedido.', 'Processo SEI', 'OME / DGP', 'OME com processo', 'RESTRITO', 'Eventual', 'EM_USO', null),
 (72, 'Condições especiais', 'Acumulação de cargo', 'Acumulação de cargo público autorizada.', 'Processo SEI', 'OME / DGP', 'OME com processo', 'RESTRITO', 'Eventual', 'EM_USO', null),
 (73, 'Condições especiais', 'PCD', 'Pessoa com deficiência e tipo da deficiência.', 'Laudo / processo SEI', 'OME / DGP', 'OME com processo', 'SENSIVEL', 'Eventual', 'EM_USO', null),
 (80, 'Disciplina', 'Punições', 'Tipo, dias e publicação de cada punição.', 'BI / BGE', 'A definir no regimento (DGP ou Corregedoria)', 'A definir', 'RESTRITO', 'A cada publicação', 'EM_USO', null),
 (81, 'Disciplina', 'Comportamento', 'Classificação do comportamento das praças.', 'Publicação; cálculo pela portaria', 'A definir no regimento', 'A definir', 'RESTRITO', 'A cada mudança', 'PREVISTO', 'Etapa C da versão 1.3'),
 (90, 'Perfil', 'Sexo', 'Sexo conforme registro funcional.', 'Pecúlio (SGP)', 'DGP', 'Importação', 'PESSOAL', 'Na inclusão', 'PREVISTO', 'Entra com o pecúlio'),
 (91, 'Perfil', 'Data de nascimento', 'Base de idade e da previsão de passagem para a inatividade.', 'Pecúlio (SGP)', 'DGP', 'Importação', 'PESSOAL', 'Na inclusão', 'PREVISTO', 'Entra com o pecúlio'),
 (92, 'Perfil', 'Escolaridade e área', 'Maior nível de escolaridade e áreas de formação.', 'Militar / OME (planilha); pecúlio', 'OME', 'OME', 'PESSOAL', 'Eventual', 'EM_USO', null),
 (93, 'Perfil', 'Idiomas', 'Idiomas declarados.', 'Militar / OME', 'OME', 'OME', 'PESSOAL', 'Eventual', 'EM_USO', null),
 (100, 'Contato', 'E-mail', 'E-mail de contato (preferencialmente funcional).', 'Militar / OME', 'OME', 'OME', 'PESSOAL', 'Eventual', 'EM_USO', null),
 (101, 'Contato', 'Telefone', 'Telefones de contato.', 'Militar / OME', 'OME', 'OME', 'PESSOAL', 'Eventual', 'EM_USO', null),
 (102, 'Contato', 'Endereço', 'Endereço residencial.', 'Militar / OME', 'OME', 'OME', 'PESSOAL', 'Eventual', 'EM_USO', null),
 (110, 'Não armazenados', 'CPF, RG e dados bancários', 'Não são guardados no sistema (minimização de dados, LGPD). Consultar no SGP.', '—', '—', '—', 'PESSOAL', '—', 'NAO_ARMAZENADO', null)
on conflict (grupo, campo) do nothing;

-- =====================================================================
-- 6. PERMISSÕES, AUDITORIA E ESTATÍSTICAS
-- =====================================================================
revoke all on municipio, consulta_salva, catalogo_campo, v_ome_regiao from anon;
grant select on municipio, v_ome_regiao to authenticated;
grant select, insert, update, delete on consulta_salva, catalogo_campo to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke execute on function norm_nome(text), omes_com_subordinadas(integer[]), antiguidade_lista(),
                           trg_ome_ciclo(), trg_consulta_salva_antes(), trg_catalogo_antes() from anon, public;
grant execute on function norm_nome(text), omes_com_subordinadas(integer[]), antiguidade_lista() to authenticated;
grant all on municipio, consulta_salva, catalogo_campo, v_ome_regiao to service_role;
grant execute on function norm_nome(text), omes_com_subordinadas(integer[]), antiguidade_lista() to service_role;

drop trigger if exists auditoria_catalogo_campo on catalogo_campo;
create trigger auditoria_catalogo_campo after insert or update or delete on catalogo_campo
  for each row execute function trg_auditoria();

commit;

analyze;
notify pgrst, 'reload schema';

select 'Versão 1.3 aplicada com sucesso' as resultado;
