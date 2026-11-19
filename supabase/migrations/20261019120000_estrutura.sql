-- =====================================================================
-- SISTEMA DE CONTROLE DO EFETIVO - CBMPE / DGP
-- Migration 1/4 - Estrutura (tabelas, tipos, restrições)
-- =====================================================================

-- gen_random_uuid() é nativo do PostgreSQL 13+

-- ---------------------------------------------------------------------
-- Tipos enumerados (valores fixos, que não mudam com o tempo)
-- ---------------------------------------------------------------------
create type papel_usuario as enum (
  'ADMIN',         -- DGP administrador: tudo + usuários + tabelas
  'DGP',           -- DGP operador: lê e edita todas as OMEs
  'LEITOR_GERAL',  -- Comando/EMG: lê todas as OMEs, não edita
  'GESTOR',        -- responsável da OME (SAAdm): lê e edita a(s) sua(s) OME(s)
  'LEITOR'         -- consulta da(s) sua(s) OME(s)
);

create type situacao_militar as enum ('ATIVO','RESERVA','REFORMA','FALECIDO','EXCLUIDO','OUTRO');
create type atividade_tipo   as enum ('OPERACIONAL','ADMINISTRATIVO');
create type registro_funcional_tipo as enum ('READAPTACAO','HORARIO_ESPECIAL','ACUMULACAO_CARGO','PCD');
create type natureza_saude   as enum ('FISICO','MENTAL');
create type movimentacao_tipo as enum ('INCLUSAO','TRANSFERENCIA','DESLIGAMENTO','REINCLUSAO');

-- ---------------------------------------------------------------------
-- Tabelas de domínio (editáveis pela DGP)
-- ---------------------------------------------------------------------
create table ome (
  id        integer generated always as identity primary key,
  sigla     text not null unique,
  nome      text,
  tipo      text not null default 'OUTRA'
            check (tipo in ('GRUPAMENTO','DIRETORIA','ADIDOS','OUTRA')),
  ordem     integer not null default 999,
  ativo     boolean not null default true
);
comment on table ome is 'Organizações Militares Estaduais (grupamentos, diretorias, centros etc.)';

create table secao (
  id      integer generated always as identity primary key,
  ome_id  integer not null references ome(id) on delete cascade,
  nome    text not null,
  ordem   integer not null default 999,
  ativo   boolean not null default true,
  unique (ome_id, nome)
);
comment on table secao is 'Seções / subgrupamentos de cada OME (ex.: 1ª SB (Vitória)). Para ADIDO, o órgão de destino.';

create table posto_graduacao (
  id       smallint primary key,
  sigla    text not null unique,
  nome     text not null,
  circulo  text not null,
  oficial  boolean not null,
  ordem    smallint not null unique        -- 1 = mais antigo (Cel)
);

create table quadro (
  sigla  text primary key,
  nome   text
);
comment on table quadro is 'Quadro de carreira do oficial (QOC, QOA...)';

create table tipo_afastamento (
  id           integer generated always as identity primary key,
  codigo       text not null unique,
  nome         text not null,
  exige_saude  boolean not null default false,  -- habilita natureza (Físico/Mental) e CID
  ordem        integer not null default 999,
  ativo        boolean not null default true
);

create table nivel_escolaridade (
  id     smallint primary key,
  nome   text not null unique,
  ordem  smallint not null unique   -- maior = mais alto
);

create table tipo_punicao (
  id     integer generated always as identity primary key,
  nome   text not null unique,
  ordem  integer not null default 999,
  ativo  boolean not null default true
);

create table feriado (
  data       date primary key,
  descricao  text not null
);
comment on table feriado is 'Feriados usados no cálculo do 5º dia útil (prazo de entrega mensal).';

-- ---------------------------------------------------------------------
-- Militar (uma linha por militar - a matrícula é única no CBMPE)
-- ---------------------------------------------------------------------
create table militar (
  id                  uuid primary key default gen_random_uuid(),
  matricula           text not null unique check (matricula ~ '^[0-9]{6}-[0-9]$'),
  nome                text not null check (length(trim(nome)) >= 3),
  nome_guerra         text,
  posto_id            smallint not null references posto_graduacao(id),
  quadro_sigla        text references quadro(sigla),
  ome_id              integer not null references ome(id),
  secao_id            integer references secao(id),
  atividade           atividade_tipo,
  ano_ingresso        smallint check (ano_ingresso between 1950 and 2100),
  ordem_antiguidade   integer,          -- desempate de antiguidade dentro do mesmo posto
  email               text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefone1           text,
  telefone2           text,
  endereco            text,
  situacao            situacao_militar not null default 'ATIVO',
  data_situacao       date,
  documento_situacao  text,
  observacoes         text,
  criado_em           timestamptz not null default now(),
  criado_por          uuid,
  atualizado_em       timestamptz not null default now(),
  atualizado_por      uuid
);
create index militar_ome_idx    on militar(ome_id) where situacao = 'ATIVO';
create index militar_secao_idx  on militar(secao_id);
create index militar_nome_idx   on militar(lower(nome));

-- ---------------------------------------------------------------------
-- Afastamentos (quantos forem necessários, com histórico)
-- ---------------------------------------------------------------------
create table afastamento (
  id            uuid primary key default gen_random_uuid(),
  militar_id    uuid not null references militar(id) on delete cascade,
  tipo_id       integer not null references tipo_afastamento(id),
  data_inicio   date not null check (data_inicio >= date '2000-01-01'),
  dias          integer not null check (dias between 1 and 3650),
  data_fim      date generated always as (data_inicio + (dias - 1)) stored,
  processo_sei  text,
  observacao    text,
  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid()
);
create index afastamento_militar_idx on afastamento(militar_id);
create index afastamento_periodo_idx on afastamento(data_inicio, data_fim);

-- Dados de saúde ficam separados e só são visíveis a quem tem permissão (LGPD art. 11)
create table afastamento_saude (
  afastamento_id  uuid primary key references afastamento(id) on delete cascade,
  natureza        natureza_saude,
  cid             text check (cid is null or cid ~* '^[A-Z][0-9]{2}(\.?[0-9A-Z]{1,2})?$')
);

-- ---------------------------------------------------------------------
-- Situações funcionais: readaptação, horário especial, acumulação, PCD
-- ---------------------------------------------------------------------
create table registro_funcional (
  id            uuid primary key default gen_random_uuid(),
  militar_id    uuid not null references militar(id) on delete cascade,
  tipo          registro_funcional_tipo not null,
  detalhe       text,           -- tipo de deficiência, cargo acumulado, horário etc.
  data_inicio   date,
  data_fim      date,           -- nulo = vigente por prazo indeterminado
  processo_sei  text,
  criado_em     timestamptz not null default now(),
  check (data_fim is null or data_inicio is null or data_fim >= data_inicio)
);
create index registro_funcional_militar_idx on registro_funcional(militar_id);

create table punicao (
  id            uuid primary key default gen_random_uuid(),
  militar_id    uuid not null references militar(id) on delete cascade,
  tipo_id       integer not null references tipo_punicao(id),
  data_inicio   date,
  dias          integer check (dias is null or dias between 0 and 3650),
  processo      text,          -- SEI / SIGPAD / BG
  observacao    text,
  criado_em     timestamptz not null default now()
);
create index punicao_militar_idx on punicao(militar_id);

create table formacao (
  id             uuid primary key default gen_random_uuid(),
  militar_id     uuid not null references militar(id) on delete cascade,
  nivel_id       smallint not null references nivel_escolaridade(id),
  area           text,
  instituicao    text,
  ano_conclusao  smallint check (ano_conclusao is null or ano_conclusao between 1950 and 2100),
  criado_em      timestamptz not null default now()
);
create index formacao_militar_idx on formacao(militar_id);
create index formacao_area_idx on formacao(lower(area));

create table militar_idioma (
  militar_id  uuid not null references militar(id) on delete cascade,
  idioma      text not null,
  nivel       text check (nivel is null or nivel in ('BASICO','INTERMEDIARIO','AVANCADO','FLUENTE')),
  primary key (militar_id, idioma)
);

-- ---------------------------------------------------------------------
-- Movimentações (inclusão, transferência, desligamento) - histórico
-- ---------------------------------------------------------------------
create table movimentacao (
  id                uuid primary key default gen_random_uuid(),
  militar_id        uuid not null references militar(id) on delete cascade,
  militar_matricula text,        -- cópia no momento da movimentação (histórico legível
  militar_nome      text,        --  mesmo depois que o militar sai da OME)
  militar_posto     text,
  tipo              movimentacao_tipo not null,
  ome_origem_id     integer references ome(id),
  ome_destino_id    integer references ome(id),
  secao_destino_id  integer references secao(id),
  situacao_nova     situacao_militar,
  data              date not null default current_date,
  documento         text,        -- nº do Suplemento de Pessoal (SP), BG ou processo SEI
  observacao        text,
  registrado_por    uuid default auth.uid(),
  registrado_em     timestamptz not null default now()
);
create index movimentacao_militar_idx on movimentacao(militar_id);
create index movimentacao_data_idx on movimentacao(data);

-- ---------------------------------------------------------------------
-- Usuários e acesso por OME
-- ---------------------------------------------------------------------
create table perfil (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  nome               text,
  matricula          text,
  posto              text,
  telefone           text,
  papel              papel_usuario not null default 'LEITOR',
  pode_ver_saude     boolean not null default false,
  ativo              boolean not null default false,   -- novo usuário só acessa após liberação
  deve_trocar_senha  boolean not null default true,
  criado_em          timestamptz not null default now(),
  ultimo_acesso      timestamptz
);

create table perfil_ome (
  perfil_id  uuid not null references perfil(id) on delete cascade,
  ome_id     integer not null references ome(id) on delete cascade,
  primary key (perfil_id, ome_id)
);

-- ---------------------------------------------------------------------
-- Entrega mensal (regra: até o 5º dia útil, com dados do mês anterior)
-- ---------------------------------------------------------------------
create table entrega_mensal (
  ome_id          integer not null references ome(id) on delete cascade,
  competencia     date not null check (competencia = date_trunc('month', competencia)::date),
  confirmado_por  uuid not null default auth.uid(),
  confirmado_em   timestamptz not null default now(),
  efetivo         integer,
  observacao      text,
  primary key (ome_id, competencia)
);

create table fechamento_mensal (
  competencia  date primary key check (competencia = date_trunc('month', competencia)::date),
  fechado_em   timestamptz not null default now(),
  fechado_por  uuid default auth.uid(),
  total        integer
);

create table fechamento_militar (
  competencia  date not null references fechamento_mensal(competencia) on delete cascade,
  militar_id   uuid not null,
  ome_id       integer not null,
  dados        jsonb not null,
  primary key (competencia, militar_id)
);
create index fechamento_militar_ome_idx on fechamento_militar(competencia, ome_id);

-- ---------------------------------------------------------------------
-- Auditoria (quem alterou o quê e quando)
-- ---------------------------------------------------------------------
create table auditoria (
  id           bigint generated always as identity primary key,
  momento      timestamptz not null default now(),
  usuario_id   uuid,
  tabela       text not null,
  operacao     text not null,
  registro_id  text,
  militar_id   uuid,
  ome_id       integer,
  antes        jsonb,
  depois       jsonb
);
create index auditoria_ome_idx on auditoria(ome_id, momento desc);
create index auditoria_militar_idx on auditoria(militar_id, momento desc);
create index auditoria_momento_idx on auditoria(momento desc);
