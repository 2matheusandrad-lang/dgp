-- =====================================================================
-- SISTEMA DE CONTROLE DO EFETIVO - CBMPE / DGP
-- VERSÃO 1.2 (incremental: não apaga dados existentes)
-- Rodar DEPOIS do 20261110000000_fase1.sql (versão 1.1), no mesmo dia.
--
-- A. Segurança e governança
--   A1. Termo de uso: aceite obrigatório no primeiro acesso (e a cada nova versão)
--   A2. Senha provisória: o banco só libera os dados depois da troca real
--   A3. Posto, quadro, nome, matrícula e antiguidade: só a DGP altera depois da inclusão
--   A4. Pedido de correção cadastral da OME à DGP
--   A5. Registro de exportações (Excel/PDF)
--   A6. Localizar matrícula: só quem edita alguma OME
--   A7. Varredura de possíveis dados de saúde em texto livre
--   A8. Acessos por OME (quem não entra no sistema)
--   A9. Data de ingresso (data de praça, do almanaque)
-- B. Férias (PAF) conforme a Portaria do Comando Geral nº 312/2025
--   B1. Servidores civis (só para o PAF: art. 14, § 5º e art. 16)
--   B2. Exercícios, períodos restritos (art. 12) e períodos de férias
--   B3. Verificações da Portaria 312
--   B4. Proposta da OME, exceções (Diretor da DGP) e publicação do PAF
--   B5. Reprogramação e interrupção (arts. 10 e 11), homologação da DGP (art. 13) e SGP
--   B6. Férias viram afastamento automaticamente; férias não se lançam como afastamento avulso
--   B7. Importação da planilha do PAF
--   B8. Pendências de férias
--
-- Está dentro de uma transação: se algo falhar, nada é aplicado.
-- =====================================================================
set client_min_messages = warning;
begin;

do $$ begin
  if not exists (select 1 from versao_sistema where versao = '1.1') then
    raise exception 'Aplique antes o 20261110000000_fase1.sql (versão 1.1).';
  end if;
  if exists (select 1 from versao_sistema where versao = '1.2') then
    raise exception 'A versão 1.2 já está aplicada neste banco: nada a fazer.';
  end if;
end $$;
insert into versao_sistema (versao) values ('1.2');

-- =====================================================================
-- A1. TERMO DE USO
-- =====================================================================
create table if not exists termo_uso (
  versao       integer primary key,
  texto        text not null,
  vigente_desde timestamptz not null default now(),
  criado_por   uuid default auth.uid()
);
create table if not exists termo_aceite (
  perfil_id uuid not null references perfil(id) on delete cascade,
  versao    integer not null references termo_uso(versao),
  aceito_em timestamptz not null default now(),
  primary key (perfil_id, versao)
);
alter table termo_uso enable row level security;
alter table termo_aceite enable row level security;
drop policy if exists termo_uso_ler on termo_uso;
drop policy if exists termo_uso_manter on termo_uso;
drop policy if exists termo_aceite_ler on termo_aceite;
create policy termo_uso_ler on termo_uso for select to authenticated using (true);
create policy termo_uso_manter on termo_uso for insert to authenticated with check ((select e_admin()));
create policy termo_aceite_ler on termo_aceite for select to authenticated
  using (perfil_id = (select auth.uid()) or (select e_admin()));

insert into termo_uso (versao, texto) values (1,
'TERMO DE RESPONSABILIDADE E USO DO SISTEMA DE CONTROLE DO EFETIVO (CBMPE/DGP)

Ao acessar este sistema, declaro que:

1. Uso o acesso exclusivamente em razão do serviço, nos limites do perfil que me foi atribuído.
2. A senha é pessoal e intransferível. Não a compartilho, não a anoto em local visível e saio do sistema ao deixar o computador.
3. Os dados aqui tratados são dados pessoais de militares e servidores, protegidos pela Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018), e incluem dados pessoais sensíveis de saúde.
4. Não copio, exporto, imprimo, fotografo ou repasso dados além do necessário ao serviço. Arquivos exportados são de uso interno, guardados em local protegido e descartados quando não forem mais necessários.
5. Não registro diagnóstico, CID ou outra informação de saúde em campos de texto livre (observações). Esses dados só são lançados no campo próprio, por quem tem permissão.
6. Estou ciente de que todos os acessos, alterações e exportações ficam registrados com meu nome, data e hora.
7. Comunico imediatamente à DGP qualquer suspeita de acesso indevido, perda de senha ou erro nos dados.
8. O uso indevido sujeita o responsável às sanções administrativas, disciplinares, civis e penais cabíveis.')
on conflict (versao) do nothing;

create or replace function aceitar_termo(p_versao integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from perfil where id = auth.uid() and ativo) then
    raise exception 'Usuário inativo.';
  end if;
  if p_versao is distinct from (select max(versao) from termo_uso) then
    raise exception 'Versão do termo desatualizada: recarregue a página.';
  end if;
  insert into termo_aceite (perfil_id, versao) values (auth.uid(), p_versao) on conflict do nothing;
end $$;

-- =====================================================================
-- A2. SENHA PROVISÓRIA
-- O perfil só "existe" para as regras de acesso depois de trocar a senha
-- provisória e aceitar o termo vigente.
-- =====================================================================
alter table perfil add column if not exists senha_provisoria_hash text;

create or replace function papel_atual() returns papel_usuario
language sql stable security definer set search_path = public as $$
  select p.papel from perfil p
  where p.id = auth.uid() and p.ativo and not p.deve_trocar_senha
    and (not exists (select 1 from termo_uso)
         or exists (select 1 from termo_aceite a where a.perfil_id = p.id
                    and a.versao = (select max(versao) from termo_uso)))
$$;

-- chamada pela função de criação de usuários (chave de serviço) logo após definir a senha provisória
create or replace function registrar_senha_provisoria(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update perfil set deve_trocar_senha = true,
         senha_provisoria_hash = (select u.encrypted_password from auth.users u where u.id = p_id)
  where id = p_id
$$;

create or replace function marcar_senha_trocada() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from perfil p join auth.users u on u.id = p.id
             where p.id = auth.uid() and p.senha_provisoria_hash is not null
               and u.encrypted_password is not distinct from p.senha_provisoria_hash) then
    raise exception 'A senha provisória ainda não foi trocada.';
  end if;
  update perfil set deve_trocar_senha = false, senha_provisoria_hash = null where id = auth.uid();
end $$;

create or replace function meu_contexto() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'email', p.email, 'nome', p.nome, 'posto', p.posto, 'matricula', p.matricula,
    'papel', p.papel, 'ativo', p.ativo, 'pode_ver_saude', (p.pode_ver_saude or p.papel = 'ADMIN'),
    'deve_trocar_senha', p.deve_trocar_senha,
    'termo_pendente', case when (select max(versao) from termo_uso) is null then null
                           when exists (select 1 from termo_aceite a where a.perfil_id = p.id
                                        and a.versao = (select max(versao) from termo_uso)) then null
                           else (select max(versao) from termo_uso) end,
    'omes', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'sigla', o.sigla) order by o.ordem, o.sigla)
      from ome o
      where o.ativo and (p.papel in ('ADMIN','DGP','LEITOR_GERAL')
             or exists (select 1 from perfil_ome po where po.perfil_id = p.id and po.ome_id = o.id))
    ), '[]'::jsonb)
  )
  from perfil p where p.id = auth.uid()
$$;

-- =====================================================================
-- A3. CAMPOS OFICIAIS SÓ PELA DGP + A9. DATA DE INGRESSO
-- =====================================================================
alter table militar add column if not exists data_ingresso date;

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

-- a ficha passa a mostrar a data de ingresso
do $$
declare d text;
begin
  d := pg_get_viewdef('v_militar'::regclass);
  if position('NULL::date AS data_ingresso' in d) > 0 then      -- banco que já teve a 1.2 e foi revertido
    d := replace(d, 'NULL::date AS data_ingresso', 'm.data_ingresso');
  elsif d ~ 'AS pendencias\s+FROM' then
    d := regexp_replace(d, 'AS pendencias\s+FROM', 'AS pendencias, m.data_ingresso FROM');
  else raise exception 'v_militar: formato inesperado.'; end if;
  execute 'create or replace view v_militar with (security_invoker = on) as ' || d;
end $$;

-- almanaque também grava a data de praça
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

-- =====================================================================
-- A4. PEDIDO DE CORREÇÃO CADASTRAL (OME -> DGP)
-- =====================================================================
alter table solicitacao drop constraint if exists solicitacao_tipo_check;
alter table solicitacao add constraint solicitacao_tipo_check check (tipo in ('DESLIGAMENTO', 'CORRECAO'));

-- p_dados: {posto_id?, quadro_sigla?, nome?, matricula?, ordem_antiguidade?, data_ingresso?}
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

-- o aviso de "pedidos de desligamento" passa a contar só desligamentos; correções ganham aviso próprio (B8)
do $$
declare d text;
begin
  d := pg_get_functiondef('minhas_pendencias(integer)'::regprocedure);
  d := replace(d, 'where s.status = ''PENDENTE'' and s.ome_id = any (v_ed)',
                  'where s.status = ''PENDENTE'' and s.tipo = ''DESLIGAMENTO'' and s.ome_id = any (v_ed)');
  execute d;
end $$;

-- =====================================================================
-- A5. REGISTRO DE EXPORTAÇÕES
-- =====================================================================
create table if not exists registro_exportacao (
  id             bigint generated always as identity primary key,
  momento        timestamptz not null default now(),
  usuario_id     uuid default auth.uid(),
  tela           text not null,
  arquivo        text,
  formato        text,
  registros      integer,
  colunas        text[],
  dados_pessoais boolean not null default false
);
create index if not exists registro_exportacao_momento_idx on registro_exportacao (momento desc);
alter table registro_exportacao enable row level security;
drop policy if exists registro_exportacao_ler on registro_exportacao;
create policy registro_exportacao_ler on registro_exportacao for select to authenticated using ((select e_admin()));

create or replace function registrar_exportacao(p_tela text, p_arquivo text, p_formato text, p_registros integer,
                                                p_colunas text[], p_dados_pessoais boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not usuario_ativo() then raise exception 'Usuário inativo.'; end if;
  insert into registro_exportacao (tela, arquivo, formato, registros, colunas, dados_pessoais)
  values (left(p_tela, 80), left(p_arquivo, 120), left(p_formato, 10), p_registros, p_colunas[1:60], coalesce(p_dados_pessoais, false));
end $$;

-- =====================================================================
-- A6. LOCALIZAR MATRÍCULA: só quem edita
-- =====================================================================
create or replace function localizar_matricula(p_matricula text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not (e_gestao_global() or coalesce(cardinality(minhas_omes_edicao()), 0) > 0) then null else (
    select jsonb_build_object('ome', o.sigla, 'situacao', m.situacao, 'posto', pg.sigla, 'nome', m.nome)
    from militar m join ome o on o.id = m.ome_id join posto_graduacao pg on pg.id = m.posto_id
    where m.matricula = trim(p_matricula)) end
$$;

-- =====================================================================
-- A7. POSSÍVEIS DADOS DE SAÚDE EM TEXTO LIVRE (CID ou termos de saúde)
-- =====================================================================
create or replace function textos_com_saude()
returns table (tabela text, registro text, militar_id uuid, militar text, ome_sigla text, campo text, trecho text)
language sql stable security definer set search_path = public as $$
  with t as (
    select 'afastamento' as tabela, a.id::text as registro, a.militar_id, 'observação' as campo, a.observacao as txt from afastamento a
    union all select 'registro_funcional', r.id::text, r.militar_id, 'detalhe', r.detalhe from registro_funcional r
    union all select 'punicao', p.id::text, p.militar_id, 'observação', p.observacao from punicao p
    union all select 'militar', m.id::text, m.id, 'observações', m.observacoes from militar m
    union all select 'movimentacao', v.id::text, v.militar_id, 'observação', v.observacao from movimentacao v
  )
  select t.tabela, t.registro, t.militar_id, m.nome, o.sigla, t.campo, left(t.txt, 160)
  from t join militar m on m.id = t.militar_id join ome o on o.id = m.ome_id
  where e_admin() and t.txt is not null
    and (t.txt ~ '\m[A-Z][0-9]{2}(\.[0-9]{1,2})?\M' or t.txt ~* '\m(cid|diagn[oó]stic|patologia|depress|ansiedade|transtorno|psiqui)')
  order by o.sigla, m.nome
$$;

-- =====================================================================
-- A8. ACESSOS POR OME
-- =====================================================================
create or replace function acessos_por_ome()
returns table (ome_id integer, ome_sigla text, usuarios integer, editores integer, ultimo_acesso timestamptz, efetivo integer)
language sql stable security definer set search_path = public as $$
  select o.id, o.sigla,
         count(distinct p.id) filter (where p.ativo)::int,
         count(distinct p.id) filter (where p.ativo and p.papel = 'GESTOR')::int,
         max(p.ultimo_acesso) filter (where p.ativo),
         (select count(*) from militar m where m.ome_id = o.id and m.situacao = 'ATIVO')::int
  from ome o
  left join perfil_ome po on po.ome_id = o.id
  left join perfil p on p.id = po.perfil_id
  where o.ativo and e_gestao_global()
  group by o.id, o.sigla, o.ordem
  order by max(p.ultimo_acesso) filter (where p.ativo) nulls first, o.ordem
$$;

-- =====================================================================
-- B1. SERVIDORES CIVIS (somente para o PAF)
-- =====================================================================
alter table ome add column if not exists orgao_ensino boolean not null default false;

create table if not exists servidor_civil (
  id          uuid primary key default gen_random_uuid(),
  matricula   text not null unique check (length(trim(matricula)) >= 3),
  nome        text not null check (length(trim(nome)) >= 3),
  ome_id      integer not null references ome(id),
  cargo       text,
  ativo       boolean not null default true,
  observacao  text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid default auth.uid()
);
create index if not exists servidor_civil_ome_idx on servidor_civil (ome_id) where ativo;
alter table servidor_civil enable row level security;
drop policy if exists servidor_civil_ler on servidor_civil;
drop policy if exists servidor_civil_inserir on servidor_civil;
drop policy if exists servidor_civil_alterar on servidor_civil;
drop policy if exists servidor_civil_excluir on servidor_civil;
create policy servidor_civil_ler on servidor_civil for select to authenticated
  using (ome_id = any (array(select unnest(minhas_omes()))));
create policy servidor_civil_inserir on servidor_civil for insert to authenticated with check (pode_editar_ome(ome_id));
create policy servidor_civil_alterar on servidor_civil for update to authenticated
  using (pode_editar_ome(ome_id)) with check (pode_editar_ome(ome_id));
create policy servidor_civil_excluir on servidor_civil for delete to authenticated using ((select e_admin()));

create or replace function trg_servidor_civil() returns trigger
language plpgsql set search_path = public as $$
begin
  new.nome := upper(regexp_replace(trim(new.nome), '\s+', ' ', 'g'));
  new.matricula := trim(new.matricula);
  return new;
end $$;
drop trigger if exists servidor_civil_antes on servidor_civil;
create trigger servidor_civil_antes before insert or update on servidor_civil for each row execute function trg_servidor_civil();

-- =====================================================================
-- B2. EXERCÍCIOS, RESTRIÇÕES E PERÍODOS
-- Exercício N: gozo de 01/12/N a 31/12/(N+1) (art. 1º).
-- =====================================================================
create table if not exists ferias_exercicio (
  ano            smallint primary key check (ano between 2000 and 2100),
  situacao       text not null default 'ELABORACAO' check (situacao in ('ELABORACAO', 'PUBLICADO')),
  prazo_ome      date,
  publicacao     text,
  data_publicacao date,
  processo_sei   text,
  observacao     text,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create table if not exists ferias_restricao (
  id        integer generated always as identity primary key,
  inicio    date not null,
  fim       date not null check (fim >= inicio),
  motivo    text not null,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create table if not exists ferias_periodo (
  id               uuid primary key default gen_random_uuid(),
  exercicio        smallint not null references ferias_exercicio(ano),
  militar_id       uuid references militar(id) on delete cascade,
  civil_id         uuid references servidor_civil(id) on delete cascade,
  data_inicio      date not null,
  dias             smallint not null check (dias between 1 and 60),
  data_fim         date generated always as (data_inicio + (dias - 1)) stored,
  previsto_inicio  date,
  data_estimada    boolean not null default false,
  situacao         text not null default 'PROPOSTA'
                   check (situacao in ('PROPOSTA', 'PROGRAMADA', 'CANCELADA', 'INTERROMPIDA', 'NAO_GOZADA')),
  dias_gozados     smallint,
  origem           text not null default 'PAF' check (origem in ('PAF', 'REPROGRAMACAO', 'IMPORTACAO')),
  excecao          text,
  excecao_aprovada_por uuid,
  excecao_aprovada_em  timestamptz,
  processo_sei     text,
  publicacao       text,
  observacao       text,
  reprogramacao_id uuid,
  criado_em        timestamptz not null default now(),
  criado_por       uuid default auth.uid(),
  atualizado_em    timestamptz not null default now(),
  check (num_nonnulls(militar_id, civil_id) = 1)
);
create index if not exists ferias_periodo_militar_idx on ferias_periodo (militar_id, exercicio) where militar_id is not null;
create index if not exists ferias_periodo_civil_idx on ferias_periodo (civil_id, exercicio) where civil_id is not null;
create index if not exists ferias_periodo_datas_idx on ferias_periodo (data_inicio, data_fim) where situacao <> 'CANCELADA';
create index if not exists ferias_periodo_exercicio_idx on ferias_periodo (exercicio, situacao);

create table if not exists ferias_reprogramacao (
  id               uuid primary key default gen_random_uuid(),
  exercicio        smallint not null references ferias_exercicio(ano),
  militar_id       uuid references militar(id) on delete cascade,
  civil_id         uuid references servidor_civil(id) on delete cascade,
  ome_id           integer not null references ome(id),
  tipo             text not null check (tipo in ('A_PEDIDO', 'DE_OFICIO', 'OBRIGATORIA', 'INTERRUPCAO')),
  motivo           text,
  requerimento_em  date,
  processo_sei     text not null,
  publicacao_ome   text,
  cancelar         uuid[] not null default '{}',
  interromper      uuid,
  interrupcao_em   date,
  novos            jsonb not null default '[]',
  excecao          text,
  verificacoes     jsonb not null default '[]',
  observacao       text,
  status           text not null default 'AGUARDANDO_DGP'
                   check (status in ('AGUARDANDO_DGP', 'HOMOLOGADA', 'DEVOLVIDA', 'CANCELADA')),
  solicitado_por   uuid not null default auth.uid(),
  solicitado_em    timestamptz not null default now(),
  decidido_por     uuid,
  decidido_em      timestamptz,
  resposta         text,
  publicacao_dgp   text,
  sgp_em           timestamptz,
  sgp_por          uuid,
  check (num_nonnulls(militar_id, civil_id) = 1)
);
create index if not exists ferias_reprogramacao_status_idx on ferias_reprogramacao (status, solicitado_em desc);
create index if not exists ferias_reprogramacao_ome_idx on ferias_reprogramacao (ome_id, status);

alter table ferias_exercicio enable row level security;
alter table ferias_restricao enable row level security;
alter table ferias_periodo enable row level security;
alter table ferias_reprogramacao enable row level security;
drop policy if exists ferias_exercicio_ler on ferias_exercicio;
drop policy if exists ferias_restricao_ler on ferias_restricao;
drop policy if exists ferias_restricao_manter on ferias_restricao;
drop policy if exists ferias_periodo_ler on ferias_periodo;
drop policy if exists ferias_reprogramacao_ler on ferias_reprogramacao;
create policy ferias_exercicio_ler on ferias_exercicio for select to authenticated using ((select usuario_ativo()));
create policy ferias_restricao_ler on ferias_restricao for select to authenticated using ((select usuario_ativo()));
create policy ferias_restricao_manter on ferias_restricao for all to authenticated
  using ((select e_gestao_global())) with check ((select e_gestao_global()));
create policy ferias_periodo_ler on ferias_periodo for select to authenticated using (
  (militar_id is not null and exists (select 1 from militar m where m.id = militar_id))
  or (civil_id is not null and exists (select 1 from servidor_civil c where c.id = civil_id)));
create policy ferias_reprogramacao_ler on ferias_reprogramacao for select to authenticated
  using ((select e_gestao_global()) or ome_id = any (array(select unnest(minhas_omes()))));

-- pessoa (militar ou civil) em uma forma só
create or replace function ferias_ome_pessoa(p_militar uuid, p_civil uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select ome_id from militar where id = p_militar), (select ome_id from servidor_civil where id = p_civil))
$$;

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

create or replace view v_ferias_reprogramacao with (security_invoker = on) as
select r.*, coalesce(m.matricula, c.matricula) as matricula, coalesce(m.nome, c.nome) as nome,
       case when m.id is not null then trim(pg.sigla || coalesce(' ' || m.quadro_sigla, '')) else 'Civil' end as posto_completo,
       o.sigla as ome_sigla, nome_usuario(r.solicitado_por) as solicitado_por_nome,
       nome_usuario(r.decidido_por) as decidido_por_nome, nome_usuario(r.sgp_por) as sgp_por_nome
from ferias_reprogramacao r
left join militar m on m.id = r.militar_id
left join posto_graduacao pg on pg.id = m.posto_id
left join servidor_civil c on c.id = r.civil_id
join ome o on o.id = r.ome_id;

-- =====================================================================
-- B3. VERIFICAÇÕES DA PORTARIA 312
-- p_novos: [{inicio:'AAAA-MM-DD', dias:n}]  p_ignorar: períodos que deixam de valer (cancelados/substituídos)
-- p_parcial: {id, dias} = período interrompido que passa a contar só com os dias gozados
-- Retorna [{codigo, nivel: bloqueio|alerta|info, msg}]
-- =====================================================================
create or replace function ferias_verificar(
  p_militar uuid, p_civil uuid, p_exercicio smallint, p_novos jsonb,
  p_ignorar uuid[] default '{}', p_tipo text default 'PAF', p_requerimento date default null,
  p_parcial jsonb default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := '[]'; v_ome integer; v_ensino boolean; v_tipo_ome text; v_sit text; v_ing date; v_ano_ing smallint;
  v_ini_jan date := make_date(p_exercicio, 12, 1); v_fim_jan date := make_date(p_exercicio + 1, 12, 31);
  n jsonb; v_i date; v_d integer; v_f date; v_total integer := 0; v_dias integer[] := '{}';
  v_mes date; v_min_novo date; v_efetivo integer; v_lim integer; v_ocup integer; v_txt text; q record; v_min_antigo date;
  v_pessoa uuid := coalesce(p_militar, p_civil);
begin
  v_ome := ferias_ome_pessoa(p_militar, p_civil);
  if v_ome is null then
    return jsonb_build_array(jsonb_build_object('codigo', 'pessoa', 'nivel', 'bloqueio', 'msg', 'Militar ou servidor não encontrado.'));
  end if;
  select orgao_ensino, tipo into v_ensino, v_tipo_ome from ome where id = v_ome;
  if p_militar is not null then
    select situacao::text, data_ingresso, ano_ingresso into v_sit, v_ing, v_ano_ing from militar where id = p_militar;
    if v_sit <> 'ATIVO' then
      r := r || jsonb_build_object('codigo', 'situacao', 'nivel', 'bloqueio', 'msg', 'Militar não está ativo.');
    end if;
    if v_tipo_ome = 'ADIDOS' then
      r := r || jsonb_build_object('codigo', 'adido', 'nivel', 'info',
        'msg', 'Militar à disposição de outro órgão: o período deve ser definido com consulta prévia ao órgão (art. 2º, III).');
    end if;
  end if;
  if not exists (select 1 from ferias_exercicio where ano = p_exercicio) then
    return r || jsonb_build_object('codigo', 'exercicio', 'nivel', 'bloqueio', 'msg', 'Exercício ' || p_exercicio || ' não foi aberto pela DGP.');
  end if;

  -- dias já programados no exercício (fora os que deixam de valer)
  select coalesce(sum(case when f.id = (p_parcial->>'id')::uuid then (p_parcial->>'dias')::int
                           when f.situacao = 'INTERROMPIDA' then coalesce(f.dias_gozados, 0) else f.dias end), 0),
         coalesce(array_agg(case when f.id = (p_parcial->>'id')::uuid then (p_parcial->>'dias')::int
                                 when f.situacao = 'INTERROMPIDA' then coalesce(f.dias_gozados, 0) else f.dias end), '{}')
    into v_total, v_dias
  from ferias_periodo f
  where coalesce(f.militar_id, f.civil_id) = v_pessoa and f.exercicio = p_exercicio
    and f.situacao in ('PROPOSTA', 'PROGRAMADA', 'INTERROMPIDA') and not (f.id = any (coalesce(p_ignorar, '{}')));

  for n in select * from jsonb_array_elements(coalesce(p_novos, '[]')) loop
    v_i := (n->>'inicio')::date; v_d := (n->>'dias')::int; v_f := v_i + v_d - 1;
    v_total := v_total + v_d; v_dias := v_dias || v_d;
    v_txt := to_char(v_i, 'DD/MM/YYYY') || ' (' || v_d || ' dias)';
    if extract(day from v_i) not in (1, 16) then
      r := r || jsonb_build_object('codigo', 'dia_inicio', 'nivel', 'bloqueio',
        'msg', v_txt || ': as férias começam sempre no dia 1º ou 16 (art. 2º, II).');
    end if;
    if v_d not in (15, 30) then
      r := r || jsonb_build_object('codigo', 'dias', 'nivel', 'bloqueio',
        'msg', v_txt || ': o período deve ser de 30 dias ou de 15 dias (art. 2º, II).');
    end if;
    if v_i < v_ini_jan or v_f > v_fim_jan then
      r := r || jsonb_build_object('codigo', 'janela', 'nivel', 'bloqueio',
        'msg', v_txt || ': fora do período de gozo do exercício ' || p_exercicio || ' (01/12/' || p_exercicio || ' a 31/12/' || (p_exercicio + 1)
               || ', art. 1º). Acumulação só nos casos do art. 10 (art. 6º).');
    end if;
    -- sobreposição com outras férias da mesma pessoa (qualquer exercício)
    if exists (select 1 from ferias_periodo f where coalesce(f.militar_id, f.civil_id) = v_pessoa
               and f.situacao in ('PROPOSTA', 'PROGRAMADA') and not (f.id = any (coalesce(p_ignorar, '{}')))
               and f.id is distinct from (p_parcial->>'id')::uuid
               and f.data_inicio <= v_f and f.data_fim >= v_i) then
      r := r || jsonb_build_object('codigo', 'sobreposicao', 'nivel', 'bloqueio', 'msg', v_txt || ': coincide com outras férias já programadas.');
    end if;
    -- períodos restritos pela DGP (art. 12)
    for q in select * from ferias_restricao x where x.inicio <= v_f and x.fim >= v_i loop
      r := r || jsonb_build_object('codigo', 'restricao', 'nivel', 'bloqueio',
        'msg', v_txt || ': período restrito pela DGP (' || q.motivo || ', ' || to_char(q.inicio, 'DD/MM') || ' a ' || to_char(q.fim, 'DD/MM/YYYY') || ', art. 12).');
    end loop;
    -- outros afastamentos (art. 11, I, b)
    if p_militar is not null then
      for q in select t.nome, a.data_inicio, a.data_fim from afastamento a join tipo_afastamento t on t.id = a.tipo_id
               where a.militar_id = p_militar and t.codigo <> 'FERIAS' and a.data_inicio <= v_f and a.data_fim >= v_i loop
        r := r || jsonb_build_object('codigo', 'afastamento', 'nivel', 'alerta',
          'msg', v_txt || ': coincide com ' || q.nome || ' (' || to_char(q.data_inicio, 'DD/MM/YYYY') || ' a ' || to_char(q.data_fim, 'DD/MM/YYYY')
                 || '). Se já estiver afastado no 1º dia, a reprogramação é obrigatória (art. 11, I, b).');
      end loop;
      -- 12 meses de serviço (art. 2º, I)
      if coalesce(v_ing, case when v_ano_ing is not null then make_date(v_ano_ing, 1, 1) end) is not null
         and v_i < (coalesce(v_ing, make_date(v_ano_ing, 1, 1)) + interval '12 months')::date then
        r := r || jsonb_build_object('codigo', 'direito', 'nivel', 'alerta',
          'msg', v_txt || ': o militar ainda não terá 12 meses de serviço' || case when v_ing is null then ' (pela data de ingresso, só o ano é conhecido)' else '' end || ' (art. 2º, I).');
      end if;
    end if;
    -- limite de 10% da OME por mês (art. 5º e art. 14, § 2º)
    if not v_ensino then
      select (select count(*) from militar m where m.ome_id = v_ome and m.situacao = 'ATIVO')
           + (select count(*) from servidor_civil c where c.ome_id = v_ome and c.ativo) into v_efetivo;
      v_lim := greatest(1, floor(v_efetivo * 0.10)::int);
      v_mes := date_trunc('month', v_i)::date;
      while v_mes <= v_f loop
        select count(distinct coalesce(f.militar_id, f.civil_id)) into v_ocup
        from ferias_periodo f
        left join militar m on m.id = f.militar_id left join servidor_civil c on c.id = f.civil_id
        where coalesce(m.ome_id, c.ome_id) = v_ome and f.situacao in ('PROPOSTA', 'PROGRAMADA')
          and coalesce(f.militar_id, f.civil_id) <> v_pessoa
          and not (f.id = any (coalesce(p_ignorar, '{}')))
          and f.data_inicio <= (v_mes + interval '1 month - 1 day')::date and f.data_fim >= v_mes;
        if v_ocup + 1 > v_lim then
          r := r || jsonb_build_object('codigo', 'limite_10', 'nivel', 'bloqueio',
            'msg', to_char(v_mes, 'MM/YYYY') || ': a OME passaria a ter ' || (v_ocup + 1) || ' de ' || v_efetivo
                   || ' em férias no mês (limite de 10% = ' || v_lim || ', art. 5º).');
        end if;
        v_mes := (v_mes + interval '1 month')::date;
      end loop;
    end if;
    v_min_novo := least(coalesce(v_min_novo, v_i), v_i);
    -- abono (art. 7º)
    if p_tipo <> 'PAF' and v_i - current_date < 60 then
      r := r || jsonb_build_object('codigo', 'abono', 'nivel', 'info',
        'msg', v_txt || ': menos de 60 dias de antecedência; o abono pode ser pago no mês seguinte ao gozo (art. 7º, parágrafo único).');
    end if;
  end loop;

  -- antecedência de 60 dias para reprogramação facultativa (art. 11, II)
  if p_tipo in ('A_PEDIDO', 'DE_OFICIO') then
    select min(f.data_inicio) into v_min_antigo from ferias_periodo f where f.id = any (coalesce(p_ignorar, '{}'));
    if p_requerimento is null then
      r := r || jsonb_build_object('codigo', 'antecedencia', 'nivel', 'bloqueio', 'msg', 'Informe a data do requerimento (ou da comunicação de ofício).');
    elsif least(coalesce(v_min_antigo, v_min_novo), coalesce(v_min_novo, v_min_antigo)) - p_requerimento < 60 then
      r := r || jsonb_build_object('codigo', 'antecedencia', 'nivel', 'bloqueio',
        'msg', 'Requerimento em ' || to_char(p_requerimento, 'DD/MM/YYYY') || ': menos de 60 dias antes de '
          || to_char(least(coalesce(v_min_antigo, v_min_novo), coalesce(v_min_novo, v_min_antigo)), 'DD/MM/YYYY')
          || case when v_min_antigo is not null and v_min_antigo <= coalesce(v_min_novo, v_min_antigo) then ', início das férias que seriam reprogramadas' else ', início do novo período' end
          || ' (art. 11, II).');
    end if;
  end if;

  if v_total > 30 then
    r := r || jsonb_build_object('codigo', 'total', 'nivel', 'bloqueio', 'msg', 'O exercício ficaria com ' || v_total || ' dias (máximo de 30).');
  end if;
  if jsonb_array_length(coalesce(p_novos, '[]')) > 0 and p_parcial is null and v_total <= 30
     and not exists (select 1 from jsonb_array_elements(r) e where e->>'codigo' in ('dias', 'total')) then
    if v_total < 30 then
      r := r || jsonb_build_object('codigo', 'composicao', 'nivel', 'alerta',
        'msg', 'O exercício soma ' || v_total || ' dias: faltam ' || (30 - v_total) || ' para completar os 30 (art. 2º, II).');
    elsif not (cardinality(v_dias) = 1 or (cardinality(v_dias) = 2 and v_dias <@ array[15])) then
      r := r || jsonb_build_object('codigo', 'composicao', 'nivel', 'alerta',
        'msg', 'O exercício deve ter um período de 30 dias ou dois de 15 (art. 2º, II).');
    end if;
  end if;
  -- acúmulo (art. 6º): exercícios anteriores com saldo e prazo vencido
  if exists (select 1 from ferias_exercicio e where e.ano < p_exercicio and make_date(e.ano + 1, 12, 31) < current_date
             and e.ano >= p_exercicio - 2
             and coalesce((select sum(case when f.situacao = 'INTERROMPIDA' then coalesce(f.dias_gozados, 0) else f.dias end)
                           from ferias_periodo f where coalesce(f.militar_id, f.civil_id) = v_pessoa and f.exercicio = e.ano
                             and f.situacao in ('PROGRAMADA', 'INTERROMPIDA')), 0) < 30
             and exists (select 1 from ferias_periodo f where coalesce(f.militar_id, f.civil_id) = v_pessoa and f.exercicio = e.ano)) then
    r := r || jsonb_build_object('codigo', 'acumulo', 'nivel', 'alerta',
      'msg', 'Há exercício anterior com saldo e prazo vencido. Acumulação só nos casos do art. 10, até 2 períodos, justificada (art. 6º).');
  end if;
  return r;
end $$;

-- bloqueios só passam com justificativa (exceção, a ser autorizada pelo Diretor da DGP)
create or replace function ferias_bloqueios(p_verif jsonb) returns integer
language sql immutable as $$ select count(*)::int from jsonb_array_elements(coalesce(p_verif, '[]')) e where e->>'nivel' = 'bloqueio' $$;

-- =====================================================================
-- B4. PROPOSTA (OME), EXCEÇÃO E PUBLICAÇÃO (DGP)
-- =====================================================================
create or replace function ferias_abrir_exercicio(p_ano smallint, p_prazo date default null, p_observacao text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not e_gestao_global() then raise exception 'Somente a DGP abre o exercício do PAF.'; end if;
  insert into ferias_exercicio (ano, prazo_ome, observacao)
  values (p_ano, coalesce(p_prazo, make_date(p_ano, 7, 15)), p_observacao)
  on conflict (ano) do update set prazo_ome = excluded.prazo_ome, observacao = coalesce(excluded.observacao, ferias_exercicio.observacao),
     atualizado_em = now(), atualizado_por = auth.uid();
end $$;

-- grava a proposta do PAF de uma pessoa (substitui a proposta anterior dela no exercício)
create or replace function ferias_propor(p_militar uuid, p_civil uuid, p_exercicio smallint, p_periodos jsonb,
                                         p_excecao text default null, p_observacao text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ome integer; v_ex ferias_exercicio; v_ign uuid[]; v_ver jsonb; n jsonb; v_global boolean := e_gestao_global();
begin
  v_ome := ferias_ome_pessoa(p_militar, p_civil);
  if v_ome is null or not pode_editar_ome(v_ome) then raise exception 'Sem permissão para esta OME.'; end if;
  select * into v_ex from ferias_exercicio where ano = p_exercicio;
  if v_ex.ano is null then raise exception 'Exercício % não foi aberto pela DGP.', p_exercicio; end if;
  if v_ex.situacao = 'PUBLICADO' then raise exception 'O PAF % já foi publicado: use a reprogramação.', p_exercicio; end if;
  if not v_global and v_ex.prazo_ome is not null and current_date > v_ex.prazo_ome then
    raise exception 'O prazo da OME para o PAF % terminou em %. Fale com a DGP.', p_exercicio, to_char(v_ex.prazo_ome, 'DD/MM/YYYY');
  end if;
  select coalesce(array_agg(id), '{}') into v_ign from ferias_periodo
   where coalesce(militar_id, civil_id) = coalesce(p_militar, p_civil) and exercicio = p_exercicio and situacao = 'PROPOSTA';
  v_ver := ferias_verificar(p_militar, p_civil, p_exercicio, p_periodos, v_ign, 'PAF');
  if ferias_bloqueios(v_ver) > 0 and coalesce(trim(p_excecao), '') = '' then
    raise exception 'Proposta fora das regras da Portaria 312: %. Para pedir exceção ao Diretor da DGP, informe a justificativa.',
      (select string_agg(e->>'msg', ' | ') from jsonb_array_elements(v_ver) e where e->>'nivel' = 'bloqueio');
  end if;
  perform set_config('app.ferias', 'on', true);
  delete from ferias_periodo where id = any (v_ign);
  for n in select * from jsonb_array_elements(coalesce(p_periodos, '[]')) loop
    insert into ferias_periodo (exercicio, militar_id, civil_id, data_inicio, dias, situacao, origem, excecao,
                                excecao_aprovada_por, excecao_aprovada_em, observacao)
    values (p_exercicio, p_militar, p_civil, (n->>'inicio')::date, (n->>'dias')::int, 'PROPOSTA', 'PAF',
            case when ferias_bloqueios(v_ver) > 0 then trim(p_excecao) end,
            case when ferias_bloqueios(v_ver) > 0 and v_global then auth.uid() end,
            case when ferias_bloqueios(v_ver) > 0 and v_global then now() end,
            nullif(trim(coalesce(p_observacao, '')), ''));
  end loop;
  return v_ver;
end $$;

create or replace function ferias_autorizar_excecao(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not e_gestao_global() then raise exception 'Somente a DGP autoriza exceções.'; end if;
  update ferias_periodo set excecao_aprovada_por = auth.uid(), excecao_aprovada_em = now(), atualizado_em = now()
   where id = any (p_ids) and excecao is not null and excecao_aprovada_por is null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function ferias_publicar(p_ano smallint, p_publicacao text, p_data date, p_processo text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not e_gestao_global() then raise exception 'Somente a DGP publica o PAF.'; end if;
  if coalesce(trim(p_publicacao), '') = '' then raise exception 'Informe a publicação (BGE nº).'; end if;
  if exists (select 1 from ferias_periodo where exercicio = p_ano and situacao = 'PROPOSTA' and excecao is not null and excecao_aprovada_por is null) then
    raise exception 'Há exceções ainda não autorizadas no PAF %: autorize ou peça correção antes de publicar.', p_ano;
  end if;
  perform set_config('app.ferias', 'on', true);
  update ferias_periodo set situacao = 'PROGRAMADA', previsto_inicio = coalesce(previsto_inicio, data_inicio),
         publicacao = trim(p_publicacao), atualizado_em = now()
   where exercicio = p_ano and situacao = 'PROPOSTA';
  get diagnostics n = row_count;
  update ferias_exercicio set situacao = 'PUBLICADO', publicacao = trim(p_publicacao), data_publicacao = p_data,
         processo_sei = nullif(trim(coalesce(p_processo, '')), ''), atualizado_em = now(), atualizado_por = auth.uid()
   where ano = p_ano;
  return n;
end $$;

-- =====================================================================
-- B5. REPROGRAMAÇÃO E INTERRUPÇÃO (arts. 10, 11, 13 e 14)
-- =====================================================================
create or replace function ferias_reprogramar(
  p_militar uuid, p_civil uuid, p_exercicio smallint, p_tipo text, p_motivo text, p_requerimento date,
  p_processo text, p_publicacao_ome text, p_cancelar uuid[], p_novos jsonb,
  p_interromper uuid default null, p_interrupcao_em date default null, p_excecao text default null, p_observacao text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ome integer; v_ver jsonb; v_id uuid; v_parcial jsonb; v_int ferias_periodo; v_gozados integer; v_novos_dias integer;
begin
  v_ome := ferias_ome_pessoa(p_militar, p_civil);
  if v_ome is null or not pode_editar_ome(v_ome) then raise exception 'Sem permissão para esta OME.'; end if;
  if p_tipo not in ('A_PEDIDO', 'DE_OFICIO', 'OBRIGATORIA', 'INTERRUPCAO') then raise exception 'Tipo de reprogramação inválido.'; end if;
  if coalesce(trim(p_processo), '') = '' then raise exception 'Informe o processo SEI da reprogramação.'; end if;
  if p_tipo in ('OBRIGATORIA', 'INTERRUPCAO') and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo (art. 10 ou militar já afastado no 1º dia, art. 11, I).';
  end if;
  if not exists (select 1 from ferias_exercicio where ano = p_exercicio and situacao = 'PUBLICADO') then
    raise exception 'O PAF % ainda não foi publicado: altere a proposta.', p_exercicio;
  end if;
  if exists (select 1 from ferias_reprogramacao where coalesce(militar_id, civil_id) = coalesce(p_militar, p_civil)
             and exercicio = p_exercicio and status = 'AGUARDANDO_DGP') then
    raise exception 'Já existe reprogramação deste exercício aguardando a DGP.';
  end if;
  if exists (select 1 from ferias_periodo where id = any (coalesce(p_cancelar, '{}'))
             and (coalesce(militar_id, civil_id) <> coalesce(p_militar, p_civil) or exercicio <> p_exercicio
                  or situacao <> 'PROGRAMADA' or data_inicio <= current_date)) then
    raise exception 'Só podem ser reprogramados períodos programados deste exercício que ainda não começaram.';
  end if;
  if p_tipo = 'INTERRUPCAO' then
    select * into v_int from ferias_periodo where id = p_interromper;
    if v_int.id is null or coalesce(v_int.militar_id, v_int.civil_id) <> coalesce(p_militar, p_civil) or v_int.situacao <> 'PROGRAMADA' then
      raise exception 'Escolha o período de férias a interromper.';
    end if;
    if p_interrupcao_em is null or p_interrupcao_em < v_int.data_inicio or p_interrupcao_em > v_int.data_fim then
      raise exception 'A data da interrupção deve estar dentro do período em gozo.';
    end if;
    v_gozados := p_interrupcao_em - v_int.data_inicio;
    select coalesce(sum((e->>'dias')::int), 0) into v_novos_dias from jsonb_array_elements(coalesce(p_novos, '[]')) e;
    if v_novos_dias < v_int.dias - v_gozados then
      raise exception 'Informe o período futuro para os % dias restantes (art. 11, § 5º).', v_int.dias - v_gozados;
    end if;
    v_parcial := jsonb_build_object('id', v_int.id, 'dias', v_gozados);
  end if;
  v_ver := ferias_verificar(p_militar, p_civil, p_exercicio, p_novos, coalesce(p_cancelar, '{}'), p_tipo, p_requerimento, v_parcial);
  -- na interrupção, as regras de dia 1º/16 e de 15/30 dias não se aplicam ao restante
  if p_tipo = 'INTERRUPCAO' then
    v_ver := coalesce((select jsonb_agg(e) from jsonb_array_elements(v_ver) e where e->>'codigo' not in ('dia_inicio', 'dias', 'composicao')), '[]');
  end if;
  if ferias_bloqueios(v_ver) > 0 and coalesce(trim(p_excecao), '') = '' then
    raise exception 'Reprogramação fora das regras da Portaria 312: %. Para pedir exceção ao Diretor da DGP, informe a justificativa.',
      (select string_agg(e->>'msg', ' | ') from jsonb_array_elements(v_ver) e where e->>'nivel' = 'bloqueio');
  end if;
  insert into ferias_reprogramacao (exercicio, militar_id, civil_id, ome_id, tipo, motivo, requerimento_em, processo_sei,
         publicacao_ome, cancelar, interromper, interrupcao_em, novos, excecao, verificacoes, observacao)
  values (p_exercicio, p_militar, p_civil, v_ome, p_tipo, nullif(trim(coalesce(p_motivo, '')), ''), p_requerimento, trim(p_processo),
          nullif(trim(coalesce(p_publicacao_ome, '')), ''), coalesce(p_cancelar, '{}'), p_interromper, p_interrupcao_em,
          coalesce(p_novos, '[]'), case when ferias_bloqueios(v_ver) > 0 then trim(p_excecao) end, v_ver,
          nullif(trim(coalesce(p_observacao, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

-- HOMOLOGAR (DGP), DEVOLVER (DGP, com motivo) ou CANCELAR (OME, antes da decisão)
create or replace function ferias_decidir_reprogramacao(p_id uuid, p_acao text, p_publicacao text default null, p_resposta text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare s ferias_reprogramacao; v_ver jsonb; v_parcial jsonb; v_int ferias_periodo; n jsonb;
begin
  select * into s from ferias_reprogramacao where id = p_id for update;
  if s.id is null then raise exception 'Reprogramação não encontrada.'; end if;
  if s.status <> 'AGUARDANDO_DGP' then raise exception 'Esta reprogramação já foi decidida.'; end if;
  if p_acao = 'CANCELAR' then
    if not pode_editar_ome(s.ome_id) then raise exception 'Sem permissão.'; end if;
    update ferias_reprogramacao set status = 'CANCELADA', decidido_por = auth.uid(), decidido_em = now(), resposta = p_resposta where id = p_id;
    return;
  end if;
  if not e_gestao_global() then raise exception 'Somente a DGP homologa reprogramações (art. 13, II).'; end if;
  if p_acao = 'DEVOLVER' then
    if coalesce(trim(p_resposta), '') = '' then raise exception 'Informe o que a OME deve corrigir (art. 13, parágrafo único).'; end if;
    update ferias_reprogramacao set status = 'DEVOLVIDA', decidido_por = auth.uid(), decidido_em = now(), resposta = p_resposta where id = p_id;
    return;
  end if;
  if p_acao <> 'HOMOLOGAR' then raise exception 'Ação inválida.'; end if;
  if coalesce(trim(p_publicacao), '') = '' then raise exception 'Informe a publicação da homologação (BGE nº).'; end if;
  -- confere de novo: a situação pode ter mudado desde o pedido
  if exists (select 1 from ferias_periodo where id = any (s.cancelar) and situacao <> 'PROGRAMADA') then
    raise exception 'Um dos períodos a reprogramar mudou desde o pedido. Devolva à OME para refazer.';
  end if;
  if s.tipo = 'INTERRUPCAO' then
    select * into v_int from ferias_periodo where id = s.interromper;
    v_parcial := jsonb_build_object('id', v_int.id, 'dias', s.interrupcao_em - v_int.data_inicio);
  end if;
  v_ver := ferias_verificar(s.militar_id, s.civil_id, s.exercicio, s.novos, s.cancelar, 'HOMOLOGACAO', s.requerimento_em, v_parcial);
  if s.tipo = 'INTERRUPCAO' then
    v_ver := coalesce((select jsonb_agg(e) from jsonb_array_elements(v_ver) e where e->>'codigo' not in ('dia_inicio', 'dias', 'composicao')), '[]');
  end if;
  if ferias_bloqueios(v_ver) > 0 and s.excecao is null then
    raise exception 'A reprogramação deixou de atender à Portaria 312: %',
      (select string_agg(e->>'msg', ' | ') from jsonb_array_elements(v_ver) e where e->>'nivel' = 'bloqueio');
  end if;
  perform set_config('app.ferias', 'on', true);
  perform set_config('app.origem', 'ferias', true);
  update ferias_periodo set situacao = 'CANCELADA', reprogramacao_id = s.id, atualizado_em = now() where id = any (s.cancelar);
  if s.tipo = 'INTERRUPCAO' then
    update ferias_periodo set situacao = 'INTERROMPIDA', dias_gozados = s.interrupcao_em - data_inicio,
           reprogramacao_id = s.id, observacao = concat_ws(' · ', observacao, 'Interrompida em ' || to_char(s.interrupcao_em, 'DD/MM/YYYY') || ': ' || s.motivo),
           atualizado_em = now()
     where id = s.interromper;
  end if;
  for n in select * from jsonb_array_elements(s.novos) loop
    insert into ferias_periodo (exercicio, militar_id, civil_id, data_inicio, dias, situacao, origem, excecao,
                                excecao_aprovada_por, excecao_aprovada_em, processo_sei, publicacao, reprogramacao_id)
    values (s.exercicio, s.militar_id, s.civil_id, (n->>'inicio')::date, (n->>'dias')::int, 'PROGRAMADA', 'REPROGRAMACAO',
            s.excecao, case when s.excecao is not null then auth.uid() end, case when s.excecao is not null then now() end,
            s.processo_sei, trim(p_publicacao), s.id);
  end loop;
  update ferias_reprogramacao set status = 'HOMOLOGADA', decidido_por = auth.uid(), decidido_em = now(),
         publicacao_dgp = trim(p_publicacao), resposta = p_resposta, verificacoes = v_ver
   where id = p_id;
end $$;

-- inserção dos dados no SGP/SAD (art. 13, II, c)
create or replace function ferias_marcar_sgp(p_ids uuid[], p_feito boolean default true) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not e_gestao_global() then raise exception 'Somente a DGP registra a inserção no SGP.'; end if;
  update ferias_reprogramacao set sgp_em = case when p_feito then now() end, sgp_por = case when p_feito then auth.uid() end
   where id = any (p_ids) and status = 'HOMOLOGADA';
  get diagnostics n = row_count;
  return n;
end $$;

-- registrar férias não gozadas (art. 9º): só DGP, com publicação
create or replace function ferias_nao_gozada(p_id uuid, p_publicacao text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not e_gestao_global() then raise exception 'Somente a DGP registra férias não gozadas.'; end if;
  if coalesce(trim(p_publicacao), '') = '' or coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe a publicação e o motivo (art. 9º).';
  end if;
  perform set_config('app.ferias', 'on', true);
  update ferias_periodo set situacao = 'NAO_GOZADA', publicacao = trim(p_publicacao),
         observacao = concat_ws(' · ', observacao, 'Não gozada: ' || trim(p_motivo)), atualizado_em = now()
   where id = p_id and situacao = 'PROGRAMADA';
  if not found then raise exception 'Período não encontrado ou não programado.'; end if;
end $$;

-- excluir proposta (antes da publicação) ou período importado errado (DGP)
create or replace function ferias_excluir_periodo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare f ferias_periodo;
begin
  select * into f from ferias_periodo where id = p_id;
  if f.id is null then raise exception 'Período não encontrado.'; end if;
  if not (e_gestao_global() or (f.situacao = 'PROPOSTA' and pode_editar_ome(ferias_ome_pessoa(f.militar_id, f.civil_id)))) then
    raise exception 'Só a DGP exclui períodos programados; a OME exclui apenas a própria proposta.';
  end if;
  perform set_config('app.ferias', 'on', true);
  delete from ferias_periodo where id = p_id;
end $$;

-- =====================================================================
-- B6. FÉRIAS = AFASTAMENTO (uma fonte só)
-- =====================================================================
alter table afastamento add column if not exists ferias_periodo_id uuid unique references ferias_periodo(id) on delete cascade;
alter table referencia_importacao drop constraint if exists referencia_importacao_tipo_check;
alter table referencia_importacao add constraint referencia_importacao_tipo_check check (tipo in ('QOD', 'ALMANAQUE', 'PAF'));
-- a lista de afastamentos passa a dizer quais vêm do PAF
do $$
declare d text;
begin
  d := pg_get_viewdef('v_afastamento'::regclass);
  if position('NULL::uuid AS ferias_periodo_id' in d) > 0 then
    d := replace(d, 'NULL::uuid AS ferias_periodo_id', 'a.ferias_periodo_id');
  elsif d ~ 'AS tem_dados_saude\s+FROM' then
    d := regexp_replace(d, 'AS tem_dados_saude\s+FROM', 'AS tem_dados_saude, a.ferias_periodo_id FROM');
  else raise exception 'v_afastamento: formato inesperado.'; end if;
  execute 'create or replace view v_afastamento with (security_invoker = on) as ' || d;
end $$;

create or replace function trg_ferias_afastamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo integer; v_dias integer;
begin
  if tg_op = 'DELETE' then return old; end if;   -- o afastamento cai junto (on delete cascade)
  select id into v_tipo from tipo_afastamento where codigo = 'FERIAS';
  perform set_config('app.ferias', 'on', true);
  if new.militar_id is null or new.situacao not in ('PROGRAMADA', 'INTERROMPIDA')
     or (new.situacao = 'INTERROMPIDA' and coalesce(new.dias_gozados, 0) = 0) then
    delete from afastamento where ferias_periodo_id = new.id;
    return new;
  end if;
  v_dias := case when new.situacao = 'INTERROMPIDA' then new.dias_gozados else new.dias end;
  update afastamento set data_inicio = new.data_inicio, dias = v_dias, processo_sei = coalesce(new.processo_sei, processo_sei),
         observacao = 'Férias do exercício ' || new.exercicio || coalesce(' · ' || new.publicacao, '')
   where ferias_periodo_id = new.id;
  if not found then
    -- aproveita um afastamento de férias já lançado no mesmo início (carga antiga), em vez de duplicar
    update afastamento set ferias_periodo_id = new.id, dias = v_dias,
           processo_sei = coalesce(processo_sei, new.processo_sei)
     where id = (select a.id from afastamento a where a.militar_id = new.militar_id and a.tipo_id = v_tipo
                 and a.data_inicio = new.data_inicio and a.ferias_periodo_id is null limit 1);
    if not found then
      insert into afastamento (militar_id, tipo_id, data_inicio, dias, processo_sei, observacao, ferias_periodo_id)
      values (new.militar_id, v_tipo, new.data_inicio, v_dias, new.processo_sei,
              'Férias do exercício ' || new.exercicio || coalesce(' · ' || new.publicacao, ''), new.id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ferias_afastamento on ferias_periodo;
create trigger ferias_afastamento after insert or update on ferias_periodo
  for each row execute function trg_ferias_afastamento();

create or replace function trg_afastamento_ferias_protege() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo integer;
begin
  if auth.uid() is null or coalesce(current_setting('app.ferias', true), '') = 'on' then return coalesce(new, old); end if;
  select id into v_tipo from tipo_afastamento where codigo = 'FERIAS';
  if tg_op = 'INSERT' and new.tipo_id = v_tipo then
    raise exception 'Férias são lançadas no módulo Férias (PAF), não como afastamento avulso.';
  end if;
  if tg_op = 'DELETE' and old.ferias_periodo_id is not null
     and (not exists (select 1 from ferias_periodo f where f.id = old.ferias_periodo_id)
          or not exists (select 1 from militar m where m.id = old.militar_id)) then
    return old;   -- exclusão em cascata (militar ou período removido)
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.ferias_periodo_id is not null then
    raise exception 'Este afastamento vem do PAF: altere pelo módulo Férias (reprogramação).';
  end if;
  if tg_op = 'UPDATE' and new.tipo_id = v_tipo and old.tipo_id <> v_tipo then
    raise exception 'Férias são lançadas no módulo Férias (PAF), não como afastamento avulso.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists afastamento_ferias_protege on afastamento;
create trigger afastamento_ferias_protege before insert or update or delete on afastamento
  for each row execute function trg_afastamento_ferias_protege();

-- desligamento: férias futuras canceladas; a que estiver em gozo é interrompida (art. 10, IV)
do $$
declare d text; marca text := '  -- encerra afastamentos e situações funcionais em aberto na data do desligamento';
begin
  d := pg_get_functiondef('desligar_militar(uuid, integer, date, text, text, text)'::regprocedure);
  if position(marca in d) = 0 then raise exception 'desligar_militar: ponto de inserção não encontrado.'; end if;
  d := replace(d, marca, '  -- férias: canceladas a partir da data; a que estiver em gozo é interrompida (art. 10, IV)
  perform set_config(''app.ferias'', ''on'', true);
  update ferias_periodo set situacao = ''CANCELADA'', observacao = concat_ws('' · '', observacao, ''Cancelada pelo desligamento''), atualizado_em = now()
   where militar_id = p_militar and situacao in (''PROPOSTA'', ''PROGRAMADA'') and data_inicio >= p_data;
  update ferias_periodo set situacao = ''INTERROMPIDA'', dias_gozados = p_data - data_inicio,
         observacao = concat_ws('' · '', observacao, ''Interrompida pelo desligamento''), atualizado_em = now()
   where militar_id = p_militar and situacao = ''PROGRAMADA'' and data_inicio < p_data and data_fim >= p_data;
' || marca);
  execute d;
end $$;

-- =====================================================================
-- B7. IMPORTAÇÃO DA PLANILHA DO PAF (DGP, uma vez; em lotes)
-- p_exercicios: [{ano, situacao, publicacao?, data_publicacao?, processo?}]
-- p_civis: [{matricula, nome, ome_id}]  (cadastra os servidores civis escolhidos)
-- p_linhas: [{matricula, exercicio, inicio, dias, previsto?, estimada?, sei?, observacao?}]
-- Duplicados (mesma pessoa, exercício, início e dias) são ignorados.
-- =====================================================================
create or replace function ferias_importar(p_exercicios jsonb, p_civis jsonb, p_linhas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; v_m uuid; v_c uuid; n_ok int := 0; n_dup int := 0; n_sem int := 0; n_civ int := 0; v_sit text;
begin
  if not e_gestao_global() then raise exception 'Somente a DGP importa o PAF.'; end if;
  perform set_config('app.ferias', 'on', true);
  perform set_config('app.origem', 'planilha', true);
  perform set_config('app.importacao', 'on', true);   -- carga histórica: não gera milhares de linhas de auditoria
  for x in select * from jsonb_array_elements(coalesce(p_exercicios, '[]')) loop
    insert into ferias_exercicio (ano, situacao, publicacao, data_publicacao, processo_sei, prazo_ome)
    values ((x->>'ano')::smallint, coalesce(x->>'situacao', 'PUBLICADO'), nullif(x->>'publicacao', ''),
            nullif(x->>'data_publicacao', '')::date, nullif(x->>'processo', ''), make_date((x->>'ano')::int, 7, 15))
    on conflict (ano) do update set
      situacao = excluded.situacao,
      publicacao = coalesce(excluded.publicacao, ferias_exercicio.publicacao),
      data_publicacao = coalesce(excluded.data_publicacao, ferias_exercicio.data_publicacao),
      processo_sei = coalesce(excluded.processo_sei, ferias_exercicio.processo_sei), atualizado_em = now();
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_civis, '[]')) loop
    insert into servidor_civil (matricula, nome, ome_id, observacao)
    values (trim(x->>'matricula'), x->>'nome', (x->>'ome_id')::int, 'Incluído na importação do PAF')
    on conflict (matricula) do nothing;
    if found then n_civ := n_civ + 1; end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_linhas, '[]')) loop
    select id into v_m from militar where matricula = trim(x->>'matricula');
    v_c := null;
    if v_m is null then select id into v_c from servidor_civil where matricula = trim(x->>'matricula'); end if;
    if v_m is null and v_c is null then n_sem := n_sem + 1; continue; end if;
    if not exists (select 1 from ferias_exercicio where ano = (x->>'exercicio')::smallint) then
      insert into ferias_exercicio (ano, situacao) values ((x->>'exercicio')::smallint, 'PUBLICADO');
    end if;
    if exists (select 1 from ferias_periodo f where coalesce(f.militar_id, f.civil_id) = coalesce(v_m, v_c)
               and f.exercicio = (x->>'exercicio')::smallint and f.data_inicio = (x->>'inicio')::date
               and f.dias = (x->>'dias')::int and f.situacao <> 'CANCELADA') then
      n_dup := n_dup + 1; continue;
    end if;
    select situacao into v_sit from ferias_exercicio where ano = (x->>'exercicio')::smallint;
    insert into ferias_periodo (exercicio, militar_id, civil_id, data_inicio, dias, previsto_inicio, data_estimada,
                                situacao, origem, processo_sei, observacao)
    values ((x->>'exercicio')::smallint, v_m, v_c, (x->>'inicio')::date, (x->>'dias')::int, nullif(x->>'previsto', '')::date,
            coalesce((x->>'estimada')::boolean, false),
            case when v_sit = 'PUBLICADO' then 'PROGRAMADA' else 'PROPOSTA' end, 'IMPORTACAO',
            nullif(trim(coalesce(x->>'sei', '')), ''), nullif(trim(coalesce(x->>'observacao', '')), ''));
    n_ok := n_ok + 1;
  end loop;
  insert into referencia_importacao (tipo, referencia, documento, resumo)
  values ('PAF', current_date, 'Planilha do PAF',
          jsonb_build_object('importados', n_ok, 'repetidos', n_dup, 'sem_cadastro', n_sem, 'civis_cadastrados', n_civ));
  return jsonb_build_object('importados', n_ok, 'repetidos', n_dup, 'sem_cadastro', n_sem, 'civis_cadastrados', n_civ);
end $$;

-- =====================================================================
-- B8. PENDÊNCIAS DE FÉRIAS E DE CORREÇÕES (somadas às do sino)
-- =====================================================================
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

-- =====================================================================
-- PERMISSÕES
-- =====================================================================
revoke all on termo_uso, termo_aceite, registro_exportacao, servidor_civil, ferias_exercicio, ferias_restricao,
              ferias_periodo, ferias_reprogramacao, v_ferias, v_ferias_reprogramacao from anon;
grant select on termo_uso, termo_aceite, registro_exportacao, ferias_exercicio, ferias_periodo, ferias_reprogramacao,
                v_ferias, v_ferias_reprogramacao to authenticated;
grant select, insert, update, delete on servidor_civil, ferias_restricao to authenticated;
grant insert on termo_uso to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
-- só a chave de serviço (função de criação de usuários) registra a senha provisória
revoke execute on function registrar_senha_provisoria(uuid) from authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

do $$
declare t text;
begin
  foreach t in array array['termo_uso', 'servidor_civil', 'ferias_exercicio', 'ferias_restricao', 'ferias_periodo', 'ferias_reprogramacao']
  loop
    execute format('drop trigger if exists auditoria_%1$s on %1$I', t);
    execute format('create trigger auditoria_%1$s after insert or update or delete on %1$I
                    for each row execute function trg_auditoria()', t);
  end loop;
end $$;

commit;

analyze;
notify pgrst, 'reload schema';

select 'Versão 1.2 aplicada com sucesso' as resultado;
