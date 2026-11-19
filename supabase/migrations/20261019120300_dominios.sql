-- =====================================================================
-- Migration 4/4 - Tabelas de domínio (valores iniciais)
-- Todos podem ser ajustados depois pela tela Administração > Tabelas.
-- =====================================================================

grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

insert into posto_graduacao (id, sigla, nome, circulo, oficial, ordem) values
  (1,  'Cel',     'Coronel',             'Oficiais Superiores',       true,  1),
  (2,  'Ten Cel', 'Tenente-Coronel',     'Oficiais Superiores',       true,  2),
  (3,  'Maj',     'Major',               'Oficiais Superiores',       true,  3),
  (4,  'Cap',     'Capitão',             'Oficiais Intermediários',   true,  4),
  (5,  '1ºTen',   'Primeiro-Tenente',    'Oficiais Subalternos',      true,  5),
  (6,  '2ºTen',   'Segundo-Tenente',     'Oficiais Subalternos',      true,  6),
  (7,  'Asp',     'Aspirante-a-Oficial', 'Praças Especiais',          false, 7),
  (8,  'Subten',  'Subtenente',          'Subtenentes e Sargentos',   false, 8),
  (9,  '1ºSgt',   'Primeiro-Sargento',   'Subtenentes e Sargentos',   false, 9),
  (10, '2ºSgt',   'Segundo-Sargento',    'Subtenentes e Sargentos',   false, 10),
  (11, '3ºSgt',   'Terceiro-Sargento',   'Subtenentes e Sargentos',   false, 11),
  (12, 'Cb',      'Cabo',                'Cabos e Soldados',          false, 12),
  (13, 'Sd',      'Soldado',             'Cabos e Soldados',          false, 13);

insert into quadro (sigla, nome) values ('QOC', null), ('QOA', null);

insert into tipo_afastamento (codigo, nome, exige_saude, ordem) values
  ('FERIAS',              'Férias',                                                    false, 1),
  ('LTS',                 'LTS - Licença para Tratamento de Saúde',                    true,  2),
  ('RTS',                 'RTS',                                                       true,  3),
  ('LAUDO_MEDICO',        'Laudo médico',                                              true,  4),
  ('LTSPF',               'LTSPF - Licença para Tratamento de Saúde de Pessoa da Família', false, 5),
  ('LE',                  'LE - Licença Especial',                                     false, 6),
  ('LTIP',                'LTIP - Licença para Tratar de Interesse Particular',        false, 7),
  ('LIC_MATERNIDADE',     'Licença Maternidade',                                       false, 8),
  ('LIC_PATERNIDADE',     'Licença Paternidade',                                       false, 9),
  ('LIC_NUPCIAS',         'Licença Núpcias',                                           false, 10),
  ('LUTO',                'Licença Luto',                                              false, 11),
  ('DISPENSA_RECOMPENSA', 'Dispensa como recompensa',                                  false, 12),
  ('TRANSITO',            'Trânsito',                                                  false, 13),
  ('CURSO',               'Curso',                                                     false, 14),
  ('OUTROS',              'Outros',                                                    false, 99);

insert into nivel_escolaridade (id, nome, ordem) values
  (1, 'Ensino Fundamental', 1),
  (2, 'Ensino Médio', 2),
  (3, 'Técnico', 3),
  (4, 'Superior Incompleto', 4),
  (5, 'Superior Completo', 5),
  (6, 'Pós-Graduação', 6),
  (7, 'Mestrado', 7),
  (8, 'Doutorado', 8),
  (9, 'Pós-Doutorado', 9);

insert into tipo_punicao (nome, ordem) values
  ('Advertência', 1), ('Repreensão', 2), ('Detenção', 3), ('Prisão', 4), ('Outra', 9);

-- OMEs (siglas como aparecem na planilha; os nomes por extenso podem ser
-- preenchidos depois em Administração > OMEs)
insert into ome (sigla, tipo, ordem) values
  ('1ºGB','GRUPAMENTO',1), ('2ºGB','GRUPAMENTO',2), ('3ºGB','GRUPAMENTO',3), ('4ºGB','GRUPAMENTO',4),
  ('5ºGB','GRUPAMENTO',5), ('6ºGB','GRUPAMENTO',6), ('7ºGB','GRUPAMENTO',7), ('9ºGB','GRUPAMENTO',9),
  ('GBI','GRUPAMENTO',10), ('GBAPH','GRUPAMENTO',11), ('GBMar','GRUPAMENTO',12), ('GBS','GRUPAMENTO',13),
  ('CAT/RMR','OUTRA',20), ('CAT Zona da Mata','OUTRA',21), ('CAT Agreste','OUTRA',22), ('CAT Sertão','OUTRA',23),
  ('GCG','OUTRA',30), ('GSG','OUTRA',31), ('AjG','OUTRA',32), ('ABMG','OUTRA',33), ('AECI','OUTRA',34),
  ('CCS','OUTRA',35), ('CEAO','OUTRA',36), ('CEFD','OUTRA',37), ('CI','OUTRA',38), ('CInt','OUTRA',39),
  ('CMan','OUTRA',40), ('CPO','OUTRA',41), ('CPPA','OUTRA',42),
  ('DAS','DIRETORIA',50), ('DEIP','DIRETORIA',51), ('DF','DIRETORIA',52), ('DGO','DIRETORIA',53),
  ('DGP','DIRETORIA',54), ('DIEsp','DIRETORIA',55), ('DIM','DIRETORIA',56), ('DInter/1','DIRETORIA',57),
  ('DInter/2','DIRETORIA',58), ('DJD','DIRETORIA',59), ('DLog','DIRETORIA',60), ('DPlaG','DIRETORIA',61),
  ('DTIC','DIRETORIA',62), ('DVP','DIRETORIA',63),
  ('ADIDO','ADIDOS',90);

-- Feriados nacionais e estaduais (PE) - complete com os municipais/pontos facultativos
insert into feriado (data, descricao) values
  ('2026-01-01','Confraternização Universal'), ('2026-02-16','Carnaval'), ('2026-02-17','Carnaval'),
  ('2026-03-06','Data Magna de Pernambuco'), ('2026-04-03','Sexta-feira Santa'), ('2026-04-21','Tiradentes'),
  ('2026-05-01','Dia do Trabalho'), ('2026-09-07','Independência'), ('2026-10-12','Nossa Senhora Aparecida'),
  ('2026-11-02','Finados'), ('2026-11-15','Proclamação da República'), ('2026-11-20','Consciência Negra'),
  ('2026-12-25','Natal'),
  ('2027-01-01','Confraternização Universal'), ('2027-02-08','Carnaval'), ('2027-02-09','Carnaval'),
  ('2027-03-06','Data Magna de Pernambuco'), ('2027-03-26','Sexta-feira Santa'), ('2027-04-21','Tiradentes'),
  ('2027-05-01','Dia do Trabalho'), ('2027-09-07','Independência'), ('2027-10-12','Nossa Senhora Aparecida'),
  ('2027-11-02','Finados'), ('2027-11-15','Proclamação da República'), ('2027-11-20','Consciência Negra'),
  ('2027-12-25','Natal');
