-- =====================================================================
-- Migration 2/4 - Segurança: funções de permissão, gatilhos, RLS
-- Regra central: cada usuário só enxerga/edita as OMEs vinculadas ao
-- seu perfil; DGP/ADMIN enxergam todas. Tudo é reforçado NO BANCO
-- (Row Level Security), não apenas na tela.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funções auxiliares de permissão (security definer => sem recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function papel_atual() returns papel_usuario
language sql stable security definer set search_path = public as $$
  select papel from perfil where id = auth.uid() and ativo
$$;

create or replace function e_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(papel_atual() = 'ADMIN', false)
$$;

create or replace function e_gestao_global() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(papel_atual() in ('ADMIN','DGP'), false)
$$;

create or replace function e_leitura_global() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(papel_atual() in ('ADMIN','DGP','LEITOR_GERAL'), false)
$$;

create or replace function usuario_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select papel_atual() is not null
$$;

create or replace function pode_ler_ome(p_ome integer) returns boolean
language sql stable security definer set search_path = public as $$
  select e_leitura_global()
      or (usuario_ativo() and exists (
            select 1 from perfil_ome where perfil_id = auth.uid() and ome_id = p_ome))
$$;

create or replace function pode_editar_ome(p_ome integer) returns boolean
language sql stable security definer set search_path = public as $$
  select e_gestao_global()
      or (papel_atual() = 'GESTOR' and exists (
            select 1 from perfil_ome where perfil_id = auth.uid() and ome_id = p_ome))
$$;

create or replace function ome_do_militar(p_militar uuid) returns integer
language sql stable security definer set search_path = public as $$
  select ome_id from militar where id = p_militar
$$;

create or replace function pode_ler_militar(p_militar uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pode_ler_ome(ome_do_militar(p_militar))
$$;

create or replace function pode_editar_militar(p_militar uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pode_editar_ome(ome_do_militar(p_militar))
$$;

create or replace function pode_ver_saude() returns boolean
language sql stable security definer set search_path = public as $$
  select e_admin() or coalesce(
    (select pode_ver_saude from perfil where id = auth.uid() and ativo), false)
$$;

create or replace function militar_do_afastamento(p_afastamento uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select militar_id from afastamento where id = p_afastamento
$$;

-- ---------------------------------------------------------------------
-- Validação do dígito verificador da matrícula (módulo 11, pesos 7..2)
-- Conferido contra a planilha: 2.564 de 2.565 matrículas válidas.
-- ---------------------------------------------------------------------
create or replace function matricula_valida(p text) returns boolean
language plpgsql immutable as $$
declare s int := 0; dv int;
begin
  if p is null or p !~ '^[0-9]{6}-[0-9]$' then return false; end if;
  for i in 1..6 loop
    s := s + substr(p, i, 1)::int * (8 - i);
  end loop;
  dv := 11 - (s % 11);
  if dv >= 10 then dv := 0; end if;
  return dv = substr(p, 8, 1)::int;
end $$;

-- ---------------------------------------------------------------------
-- Gatilho do militar: normalização, carimbo de usuário/data e proteção
-- de lotação/situação (só mudam via transferência/desligamento, que
-- registram a movimentação).
-- ---------------------------------------------------------------------
create or replace function trg_militar_antes() returns trigger
language plpgsql security definer set search_path = public as $$
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

  -- verificação do dígito (ADMIN pode cadastrar exceções)
  if not matricula_valida(new.matricula) and auth.uid() is not null and not e_admin() then
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
end $$;

create trigger militar_antes
  before insert or update on militar
  for each row execute function trg_militar_antes();

-- Movimentação guarda uma cópia de matrícula/nome/posto do militar
create or replace function trg_movimentacao_antes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select m.matricula, m.nome, trim(pg.sigla || coalesce(' ' || m.quadro_sigla, ''))
    into new.militar_matricula, new.militar_nome, new.militar_posto
  from militar m join posto_graduacao pg on pg.id = m.posto_id where m.id = new.militar_id;
  return new;
end $$;

create trigger movimentacao_antes
  before insert on movimentacao
  for each row execute function trg_movimentacao_antes();

-- ---------------------------------------------------------------------
-- Auditoria genérica
-- ---------------------------------------------------------------------
create or replace function trg_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_reg jsonb; v_mil uuid; v_ome integer; v_id text;
begin
  if coalesce(current_setting('app.importacao', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and (v_old - 'atualizado_em' - 'atualizado_por' - 'ultimo_acesso')
                        = (v_new - 'atualizado_em' - 'atualizado_por' - 'ultimo_acesso') then
    return new;
  end if;
  v_reg := coalesce(v_new, v_old);
  v_id  := coalesce(v_reg->>'id', v_reg->>'afastamento_id', v_reg->>'militar_id', v_reg->>'perfil_id');

  if tg_table_name = 'militar' then
    v_mil := (v_reg->>'id')::uuid;
    v_ome := (v_reg->>'ome_id')::int;
  elsif v_reg ? 'militar_id' then
    v_mil := (v_reg->>'militar_id')::uuid;
    v_ome := coalesce((v_reg->>'ome_destino_id')::int, ome_do_militar(v_mil));
  elsif tg_table_name = 'afastamento_saude' then
    v_mil := militar_do_afastamento((v_reg->>'afastamento_id')::uuid);
    v_ome := ome_do_militar(v_mil);
  elsif v_reg ? 'ome_id' then
    v_ome := (v_reg->>'ome_id')::int;
  end if;

  insert into auditoria (usuario_id, tabela, operacao, registro_id, militar_id, ome_id, antes, depois)
  values (auth.uid(), tg_table_name, tg_op, v_id, v_mil, v_ome, v_old, v_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['militar','afastamento','afastamento_saude','registro_funcional','punicao',
                           'formacao','militar_idioma','movimentacao','perfil','perfil_ome',
                           'entrega_mensal','ome','secao','tipo_afastamento']
  loop
    execute format('create trigger auditoria_%1$s after insert or update or delete on %1$I
                    for each row execute function trg_auditoria()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Perfil criado automaticamente quando um usuário é criado no Auth
-- (inativo até o ADMIN liberar)
-- ---------------------------------------------------------------------
create or replace function trg_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfil (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function trg_novo_usuario();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table ome                enable row level security;
alter table secao              enable row level security;
alter table posto_graduacao    enable row level security;
alter table quadro             enable row level security;
alter table tipo_afastamento   enable row level security;
alter table nivel_escolaridade enable row level security;
alter table tipo_punicao       enable row level security;
alter table feriado            enable row level security;
alter table militar            enable row level security;
alter table afastamento        enable row level security;
alter table afastamento_saude  enable row level security;
alter table registro_funcional enable row level security;
alter table punicao            enable row level security;
alter table formacao           enable row level security;
alter table militar_idioma     enable row level security;
alter table movimentacao       enable row level security;
alter table perfil             enable row level security;
alter table perfil_ome         enable row level security;
alter table entrega_mensal     enable row level security;
alter table fechamento_mensal  enable row level security;
alter table fechamento_militar enable row level security;
alter table auditoria          enable row level security;

-- Domínios: todos os usuários ativos leem; ADMIN/DGP mantêm
do $$
declare t text;
begin
  foreach t in array array['ome','posto_graduacao','quadro','tipo_afastamento',
                           'nivel_escolaridade','tipo_punicao','feriado']
  loop
    execute format('create policy %1$s_ler on %1$I for select to authenticated using (usuario_ativo())', t);
    execute format('create policy %1$s_manter on %1$I for all to authenticated
                    using (e_gestao_global()) with check (e_gestao_global())', t);
  end loop;
end $$;

-- Seções: todos leem; o gestor mantém as seções da sua própria OME
create policy secao_ler on secao for select to authenticated using (usuario_ativo());
create policy secao_inserir on secao for insert to authenticated with check (pode_editar_ome(ome_id));
create policy secao_alterar on secao for update to authenticated
  using (pode_editar_ome(ome_id)) with check (pode_editar_ome(ome_id));
create policy secao_excluir on secao for delete to authenticated using (e_gestao_global());

-- Militar
create policy militar_ler on militar for select to authenticated using (pode_ler_ome(ome_id));
create policy militar_inserir on militar for insert to authenticated with check (pode_editar_ome(ome_id));
create policy militar_alterar on militar for update to authenticated
  using (pode_editar_ome(ome_id)) with check (pode_editar_ome(ome_id));
create policy militar_excluir on militar for delete to authenticated using (e_admin());

-- Tabelas filhas do militar
do $$
declare t text;
begin
  foreach t in array array['afastamento','registro_funcional','punicao','formacao','militar_idioma']
  loop
    execute format('create policy %1$s_ler on %1$I for select to authenticated using (pode_ler_militar(militar_id))', t);
    execute format('create policy %1$s_inserir on %1$I for insert to authenticated with check (pode_editar_militar(militar_id))', t);
    execute format('create policy %1$s_alterar on %1$I for update to authenticated
                    using (pode_editar_militar(militar_id)) with check (pode_editar_militar(militar_id))', t);
    execute format('create policy %1$s_excluir on %1$I for delete to authenticated using (pode_editar_militar(militar_id))', t);
  end loop;
end $$;

-- Saúde: só quem tem permissão de saúde
create policy saude_ler on afastamento_saude for select to authenticated
  using (pode_ver_saude() and pode_ler_militar(militar_do_afastamento(afastamento_id)));
create policy saude_inserir on afastamento_saude for insert to authenticated
  with check (pode_ver_saude() and pode_editar_militar(militar_do_afastamento(afastamento_id)));
create policy saude_alterar on afastamento_saude for update to authenticated
  using (pode_ver_saude() and pode_editar_militar(militar_do_afastamento(afastamento_id)))
  with check (pode_ver_saude() and pode_editar_militar(militar_do_afastamento(afastamento_id)));
create policy saude_excluir on afastamento_saude for delete to authenticated
  using (pode_ver_saude() and pode_editar_militar(militar_do_afastamento(afastamento_id)));

-- Movimentações: leitura por origem ou destino; inclusão manual só do tipo INCLUSAO
-- (transferência e desligamento são feitos pelas funções próprias)
create policy movimentacao_ler on movimentacao for select to authenticated
  using (pode_ler_ome(ome_origem_id) or pode_ler_ome(ome_destino_id) or pode_ler_militar(militar_id));
create policy movimentacao_inserir on movimentacao for insert to authenticated
  with check (tipo = 'INCLUSAO' and pode_editar_ome(ome_destino_id) and registrado_por = auth.uid());
create policy movimentacao_excluir on movimentacao for delete to authenticated using (e_admin());

-- Perfis
create policy perfil_ler on perfil for select to authenticated
  using (id = auth.uid() or e_gestao_global());
create policy perfil_manter on perfil for all to authenticated
  using (e_admin()) with check (e_admin());
create policy perfil_ome_ler on perfil_ome for select to authenticated
  using (perfil_id = auth.uid() or e_gestao_global());
create policy perfil_ome_manter on perfil_ome for all to authenticated
  using (e_admin()) with check (e_admin());

-- Entrega mensal
create policy entrega_ler on entrega_mensal for select to authenticated using (pode_ler_ome(ome_id));
create policy entrega_confirmar on entrega_mensal for insert to authenticated
  with check (pode_editar_ome(ome_id) and confirmado_por = auth.uid());
create policy entrega_reabrir on entrega_mensal for delete to authenticated using (e_gestao_global());

-- Fechamentos (gerados pela função fechar_competencia)
create policy fechamento_ler on fechamento_mensal for select to authenticated using (usuario_ativo());
create policy fechamento_excluir on fechamento_mensal for delete to authenticated using (e_admin());
create policy fechamento_militar_ler on fechamento_militar for select to authenticated using (pode_ler_ome(ome_id));

-- Auditoria: DGP/ADMIN veem tudo; gestor vê a da sua OME (exceto dados de saúde)
create policy auditoria_ler on auditoria for select to authenticated
  using (
    (tabela <> 'afastamento_saude' or pode_ver_saude())
    and (e_gestao_global() or (ome_id is not null and pode_editar_ome(ome_id)
                               and tabela not in ('perfil','perfil_ome')))
  );

-- ---------------------------------------------------------------------
-- Permissões de acesso (anon não acessa nada)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
