# Sistema de Controle do Efetivo — DGP/CBMPE

Substitui a "Planilha de Controle de Pessoal" (uma aba por OME + aba GERAL) por um banco de dados único no **Supabase** com:

- **acesso individual por usuário**, vinculado a uma ou mais OMEs (o gestor do 1º GB só vê e edita o 1º GB);
- **cadastro, edição, exclusão e consulta** do efetivo, com histórico de **afastamentos ilimitados** (acabam as colunas fixas "Afastamento (1)/(2)");
- **painel (dashboard)**, **relatórios** em Excel/PDF e **auditoria** de toda alteração;
- **movimentações** (inclusão, transferência por SP, desligamento) que levam a ficha do militar entre OMEs sem duplicar a matrícula;
- **entrega mensal** com prazo no 5º dia útil e **fechamento da competência** (a "planilha salva pela DGP").

---

## 1. O que muda em relação à planilha

| Problema na planilha | Como o sistema resolve |
|---|---|
| A aba GERAL empilha abas com layouts diferentes (1º GB tem 41 colunas, as demais 38): colunas ficam desalinhadas e os totais saem errados | Um único banco; a "GERAL" passa a ser qualquer consulta/relatório com o seletor "Todas as OMEs" |
| 74 matrículas aparecem em duas OMEs (transferência não baixada na origem) | Matrícula é **única**. A OME de destino usa "Receber militar transferido" informando o SP, e o militar sai da origem automaticamente |
| Aba DTIC quebrada (#REF!) | Sem IMPORTRANGE; cada OME grava direto no banco |
| "Afastamento (1)" e "(2)" fixos, histórico se perde todo mês | Quantos afastamentos forem necessários; término calculado; status "em curso / previsto / encerrado" |
| Escrita livre: Operacional/OPERACIONAL/ADM, Férias/FÉRIAS, Sim/SIM, datas 0206 | Listas fixas, datas validadas, **dígito verificador da matrícula** conferido (módulo 11) |
| CID visível para todo mundo que abre a planilha | Natureza (Físico/Mental) e CID em tabela separada, visível só para quem tem permissão de saúde (LGPD, art. 11) |
| "Atualizado em" manual | Auditoria automática: quem alterou o quê e quando |
| Cópia salva no 6º dia útil | Botão "Fechar competência" grava a fotografia do efetivo do mês, consultável depois |

## 2. Estrutura do projeto

```
netlify.toml           configuração de publicação no Netlify
supabase/migrations/   4 scripts SQL (estrutura, segurança/RLS, views e funções, tabelas de domínio)
supabase/functions/    admin-usuarios: cria usuários e redefine senhas (só ADMIN)
importacao/            importar_planilha.py: converte a planilha atual em carga para o banco
app/                   interface web (React + Vite + supabase-js)
```

## 3. Perfis de acesso

| Perfil | Enxerga | Edita | Uso típico |
|---|---|---|---|
| **Administrador (DGP)** | todas as OMEs | tudo, usuários, exclusão definitiva | chefe/adjunto DGP |
| **Operador DGP** | todas | todas as OMEs; fecha competência; tabelas | equipe DGP |
| **Consulta geral** | todas | nada | Comando, EMG |
| **Gestor da OME** | suas OMEs | suas OMEs (inclusive seções) | responsável da SAAdm |
| **Consulta da OME** | suas OMEs | nada | comandante da OME |

"Pode ver saúde" é uma permissão à parte (natureza Físico/Mental e CID).
Todas as regras ficam **no banco** (Row Level Security): mesmo que alguém use a API diretamente, não acessa dados de outra OME.

> **Recomendação:** um login por pessoa, não um login compartilhado por OME. Assim a auditoria mostra quem fez cada alteração e um acesso é cortado sem afetar os demais. A aba CADASTROAVISOS já traz os responsáveis de cada OME: eles são os primeiros "Gestores da OME".

## 4. Implantação passo a passo

### 4.1 Criar o projeto no Supabase
1. Em supabase.com, crie um projeto (região **South America (São Paulo)**). Guarde a senha do banco.
2. **Authentication > Sign In / Providers > Email:** mantenha e-mail/senha ligado e **desligue "Allow new users to sign up"** (só o ADMIN cria usuários).
3. **Authentication > URL Configuration:** em *Site URL*, coloque o endereço onde o sistema ficará publicado (passo 4.6).

### 4.2 Criar as tabelas
No **SQL Editor**, rode, **nesta ordem**, o conteúdo de cada arquivo de `supabase/migrations/`:
1. `20261019120000_estrutura.sql`
2. `20261019120100_seguranca.sql`
3. `20261019120200_views_funcoes.sql`
4. `20261019120300_dominios.sql`

(Com a Supabase CLI: `supabase link --project-ref SEU_REF` e `supabase db push`.)

### 4.3 Importar a planilha atual

A importação é feita **uma única vez**, no banco ainda vazio. Ela tem duas etapas: gerar os arquivos de carga no seu computador e rodá-los no Supabase.

**a) Preparar o computador (Windows)**
1. Instale o Python em python.org/downloads. Na primeira tela do instalador, marque **"Add python.exe to PATH"**.
2. Abra o **Prompt de Comando** (tecla Windows, digite `cmd`) e instale a biblioteca de leitura de Excel:
   ```
   py -m pip install openpyxl
   ```

**b) Gerar os arquivos de carga**
1. Baixe a planilha do Google Sheets como Excel: *Arquivo > Fazer download > Microsoft Excel (.xlsx)*. Baixe na hora da carga, para levar os dados mais recentes.
2. Coloque o `.xlsx` na pasta do projeto (`sistema-efetivo-cbmpe`) com um nome simples, por exemplo `planilha.xlsx`.
3. No Prompt de Comando, entre na pasta e rode o script:
   ```
   cd C:\caminho\para\sistema-efetivo-cbmpe
   py importacao\importar_planilha.py planilha.xlsx saida
   ```
4. Ao final, a tela mostra os totais (militares, afastamentos, duplicidades etc.) e a pasta `saida` passa a ter:
   - `seed_1_militares.sql`: seções, militares e registro de inclusão;
   - `seed_2_detalhes.sql`: afastamentos, situações funcionais, formação, idiomas e punições;
   - `relatorio_importacao.xlsx`: tudo o que precisa de correção, por OME.

> Os arquivos da pasta `saida` têm dados pessoais e de saúde. **Não envie para o GitHub nem por e-mail aberto**; apague depois da carga.

**c) Carregar no Supabase pelo SQL Editor (caminho mais simples)**
1. No painel do Supabase, abra **SQL Editor > New query**.
2. Abra `seed_1_militares.sql` no Bloco de Notas, copie tudo (Ctrl+A, Ctrl+C), cole no editor e clique **Run**. Aguarde a mensagem de sucesso.
3. Repita com `seed_2_detalhes.sql`, **nesta ordem**.
4. Confira, numa nova consulta:
   ```sql
   select (select count(*) from militar) as militares,
          (select count(*) from afastamento) as afastamentos,
          (select count(*) from formacao) as formacoes;
   ```
   Os números devem bater com os que o script mostrou na tela.

**d) Se o SQL Editor recusar o arquivo (tamanho ou tempo esgotado)**
1. Instale só o cliente do PostgreSQL: no instalador da EDB (postgresql.org/download/windows), marque apenas **Command Line Tools**.
2. No Supabase, clique em **Connect** (topo do painel) e copie a string de conexão do **Session pooler**. Troque `[YOUR-PASSWORD]` pela senha do banco criada no passo 4.1.
3. Rode:
   ```
   psql "COLE_A_STRING_AQUI" -f saida\seed_1_militares.sql
   psql "COLE_A_STRING_AQUI" -f saida\seed_2_detalhes.sql
   ```

**e) Se precisar refazer a carga**
O script se recusa a rodar em banco que já tem militares. Para recomeçar do zero (só antes de o sistema entrar em uso), rode no SQL Editor:
```sql
truncate militar, movimentacao, secao, entrega_mensal, fechamento_mensal, auditoria restart identity cascade;
```
Depois gere os arquivos de novo e repita o item c.

**f) Depois da carga**
Distribua o `relatorio_importacao.xlsx` às OMEs. A aba **Ocorrências** já vem filtrável por OME e indica, em cada linha, o que foi feito e o que a unidade precisa corrigir no sistema.

### 4.4 Publicar a função de criação de usuários

A tela de Administração cria usuários e redefine senhas por meio de uma pequena função que roda no servidor do Supabase (`admin-usuarios`). Ela usa a chave mestra (`service_role`), que **nunca** pode ficar no site, e por isso precisa estar no servidor. Há dois caminhos para publicá-la.

**Opção A: pelo painel do Supabase (sem instalar nada)**
1. No menu lateral, clique em **Edge Functions > Deploy a new function > Via Editor**.
2. Apague o código de exemplo e cole todo o conteúdo de `supabase/functions/admin-usuarios/index.ts`.
3. Dê à função o nome exato **`admin-usuarios`** (o site chama por esse nome).
4. Clique em **Deploy function** e aguarde de 10 a 30 segundos.
5. Mantenha ligada a opção de verificação de JWT ("Enforce JWT verification" / "Verify JWT"), que já vem ligada por padrão. Só usuário logado consegue chamar a função, e o código ainda confere se é ADMIN.

Não é preciso cadastrar segredos: `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetados automaticamente pelo Supabase.

**Opção B: pela linha de comando (recomendada se o código ficar no GitHub)**
Requer Node.js 20 ou superior (nodejs.org). No Prompt de Comando, na pasta do projeto:
```
npx supabase login
npx supabase init
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase functions deploy admin-usuarios
```
- `login` abre o navegador para autorizar.
- `init` cria só o arquivo de configuração; responda **N** às perguntas. Ele não apaga as migrations.
- O **project ref** é o código do endereço do projeto: em `https://abcdxyz.supabase.co`, é `abcdxyz`. Também aparece em *Project Settings > General*.

**Como testar:** depois do passo 4.6, entre como ADMIN e crie um usuário em *Administração > + Novo usuário*. Se aparecer a mensagem "A função admin-usuarios não está publicada", confira o nome da função.

**Se preferir não publicar a função agora:** crie os usuários em *Authentication > Users > Add user* (com "Auto Confirm User" marcado). Eles aparecem como **bloqueados** em Administração, onde o ADMIN define perfil, OMEs e libera o acesso. A única coisa que se perde é o botão "Nova senha".

### 4.5 Criar o primeiro administrador

Como o cadastro público fica desligado, o primeiro ADMIN é criado à mão. Os demais usuários serão criados por ele, pela tela.

1. No Supabase: **Authentication > Users > Add user > Create new user**.
   - Email: o seu e-mail (de preferência o institucional).
   - Password: uma senha forte (mínimo de 10 caracteres, com letras e números).
   - Marque **Auto Confirm User**.
   - Clique em **Create user**.
2. O banco cria sozinho o seu perfil, **bloqueado**. Para torná-lo administrador, rode no **SQL Editor**, trocando os dados:
   ```sql
   update perfil
      set papel = 'ADMIN', ativo = true, deve_trocar_senha = false,
          nome = 'MATHEUS ...', posto = '2º Ten', matricula = '000000-0'
    where email = 'seu.email@bombeiros.pe.gov.br';
   ```
   O resultado deve ser `UPDATE 1`.
3. Confira:
   ```sql
   select email, papel, ativo from perfil;
   ```
4. Se o resultado for `UPDATE 0` (usuário criado antes de rodar as migrations), crie o perfil e rode o `update` do item 2 de novo:
   ```sql
   insert into perfil (id, email) select id, email from auth.users on conflict do nothing;
   ```

Recomenda-se ter **dois administradores** (por exemplo, você e o chefe ou adjunto da DGP), para que ninguém fique sem acesso se um deles se ausentar.

### 4.6 Publicar a interface (GitHub + Netlify)

Publicar a partir do GitHub é o melhor caminho: o código fica versionado (dá para ver o que mudou e voltar atrás), e cada alteração enviada ao GitHub é publicada sozinha pelo Netlify.

**a) Colocar o código no GitHub**
1. Crie uma conta em github.com (se ainda não tiver) e um repositório **privado**, por exemplo `controle-efetivo-cbmpe`. Marque **Private**.
2. Envie o conteúdo da pasta `sistema-efetivo-cbmpe`. O jeito mais simples é o **GitHub Desktop** (desktop.github.com): *File > Add local repository*, escolha a pasta, *Publish repository* e deixe marcado *Keep this code private*.
3. **Antes de enviar**, confira que não estão indo:
   - a planilha `.xlsx`;
   - a pasta `saida/`;
   - o arquivo `app/.env`;
   - a pasta `node_modules`.

   O arquivo `.gitignore` já bloqueia esses itens, mas olhe a lista de arquivos no GitHub Desktop antes do primeiro envio.

**b) Ligar o Netlify ao repositório**
1. No Netlify: **Add new project (ou Add new site) > Import an existing project > GitHub**. Autorize o acesso ao repositório `controle-efetivo-cbmpe`.
2. As configurações de build vêm do arquivo `netlify.toml` que está na raiz do projeto, e o Netlify as preenche sozinho:
   - Base directory: `app`
   - Build command: `npm run build`
   - Publish directory: `app/dist`
3. Ainda nessa tela, clique em **Add environment variables** (ou, depois, em *Site configuration > Environment variables*) e crie:

   | Nome | Valor (Supabase > Project Settings > API) |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL, ex.: `https://abcdxyz.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | chave **anon / public** (ou a "publishable key", conforme o painel) |

   Use **somente** a chave pública. Nunca use a `service_role` / secret key.
4. Clique em **Deploy**. Em cerca de 1 minuto o site fica no ar num endereço como `https://nome-aleatorio.netlify.app`. Você pode trocar o nome em *Site configuration > Change site name*, por exemplo para `efetivo-dgp.netlify.app`.
5. Se as variáveis foram criadas depois do primeiro deploy, clique em *Deploys > Trigger deploy > Deploy site* para recompilar com elas.

**c) Avisar o Supabase do endereço do site**
Em **Authentication > URL Configuration**:
- **Site URL:** `https://efetivo-dgp.netlify.app`.
- **Redirect URLs:** adicione `https://efetivo-dgp.netlify.app/**`.

Sem isso, o link de "Esqueci minha senha" leva para o endereço errado.

**d) Primeiro acesso e conferência**
Abra o endereço, entre com o ADMIN do passo 4.5 e confira:
- se o painel mostra o total do efetivo importado;
- se uma ficha abre;
- se a criação de usuário funciona (passo 4.4).

**e) Atualizações futuras**
Cada envio (*push*) para a branch `main` do GitHub gera uma nova publicação automática. Se algo der errado, em **Deploys** escolha uma publicação anterior e clique **Publish deploy** para voltar.

> **Atenção ao plano gratuito do Netlify.** Contas criadas a partir de setembro de 2025 usam o modelo de créditos: 300 créditos por mês, 15 por publicação em produção e 20 por GB de tráfego. Se os créditos acabam, **todos os sites da conta ficam fora do ar** até o mês seguinte. Este sistema gasta pouco tráfego (cerca de 300 KB por acesso), mas convém:
> - agrupar alterações em poucos envios para a `main`, ou desligar a publicação automática em *Site configuration > Build & deploy > Stop builds* e publicar manualmente;
> - acompanhar em *Usage & billing*;
> - se você já tem outros sites na mesma conta, considerar uma conta ou equipe separada para o sistema oficial.
>
> Contas antigas (anteriores a setembro de 2025) seguem o modelo de 100 GB de tráfego e 300 minutos de build por mês.

### 4.7 Cadastrar as OMEs
Em **Administração > Usuários e acessos > + Novo usuário**: e-mail (de preferência o institucional da SAAdm), perfil "Gestor da OME" e a(s) OME(s). O sistema gera uma senha provisória para enviar por canal seguro; no primeiro acesso ela é trocada obrigatoriamente.

## 5. Rotina de uso

- **Dia a dia (OMEs):** lançar afastamentos, situações funcionais, formação, punições; incluir militar novo; receber transferido (com o nº do SP); desligar (reserva, reforma etc.).
- **Até o 5º dia útil:** cada OME confere os dados e clica **Entrega mensal > Confirmar entrega**. O painel da DGP mostra quem entregou no prazo, quem atrasou e quem está pendente.
- **6º dia útil (DGP):** **Fechar competência** grava a fotografia do mês; o relatório "Efetivo de competência fechada" a consulta depois.
- **Relatórios:** efetivo nominal, quadro resumo OME × posto, afastamentos no período, situações funcionais, formação acadêmica (ex.: todos os engenheiros civis, que hoje exigem a aba "ArquitEng Civil"), pendências de cadastro, contatos, movimentações, punições. Todos exportam para Excel e imprimem/geram PDF.

## 6. Decisões tomadas na importação (conferir)

- **Lotação** = aba onde o militar está listado. Se a matrícula aparece em duas abas, fica na aba que coincide com a coluna "OME"; a outra linha vai para o relatório (aba "Duplicidades").
- **Ordem de antiguidade** = ordem das linhas na aba (a planilha já é organizada assim). Pode ser ajustada na ficha.
- **Término do afastamento** é recalculado (início + dias − 1). Afastamentos sem data de início ou sem dias (ex.: vários RTS) **não** foram importados e estão no relatório para cadastro.
- **Físico/Mental** só é mantido para LTS, RTS e Laudo médico (na planilha aparecia até em férias e dispensa).
- **Aba DTIC** (#REF!) foi recuperada a partir da aba GERAL: conferir.
- **Ano de ingresso** só existia na aba do 1º GB; nas demais OMEs fica como pendência de cadastro.
- 4 linhas não foram importadas (posto "#N/A" ou matrícula inválida): ver relatório.

## 7. Ajustes recomendados após a carga

- **Administração > OMEs e seções:** preencher os nomes por extenso das OMEs e revisar as seções (vieram do texto da planilha).
- **Administração > Tabelas:** conferir o nome por extenso de RTS e de outros tipos de afastamento; incluir feriados municipais e pontos facultativos (usados no cálculo do 5º dia útil); incluir quadros de oficiais além de QOC/QOA, se houver.

## 8. Segurança, LGPD e operação

- O sistema guarda dados pessoais e **dados sensíveis de saúde** (CID). Antes de colocar em produção, recomenda-se formalizar com a DTIC e com o encarregado de dados (LGPD) do CBMPE: hospedagem em nuvem, base legal, prazo de guarda e quem pode ver saúde.
- Banco hospedado em São Paulo; acesso por HTTPS; senhas com no mínimo 10 caracteres; senha provisória trocada no 1º acesso.
- Toda inclusão, alteração e exclusão fica na tabela `auditoria`, com o usuário e o conteúdo antes/depois.
- Exclusão definitiva só pelo ADMIN. Para saída do efetivo use **Desligar** (o histórico é preservado).
- **Backup:** confira os planos vigentes do Supabase. Os planos pagos incluem backups diários automáticos, e projetos do plano gratuito podem ser pausados por inatividade. Para uso oficial, use um plano pago ou exporte com `pg_dump` periodicamente.

## 9. Testes realizados

- Migrations executadas em PostgreSQL 16, com a carga real (2.507 militares, 184 afastamentos, 2.306 formações).
- Testes de permissão: gestor não insere nem vê militar de outra OME; não muda OME por edição direta; não grava CID sem permissão; não se promove a ADMIN; leitor não edita; usuário bloqueado não vê nada; transferência e recebimento exigem documento.
- Interface testada no navegador contra o banco real: login, painel, efetivo, ficha, lançamento de afastamento, histórico, entrega mensal, relatórios, criação de usuário e recebimento de militar transferido, em desktop e celular.
