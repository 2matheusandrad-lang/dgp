import { useAuth } from '../lib/auth';
import { Cartao } from '../components/ui';

type Item = { t: string; d: string };
const COMUM: Item[] = [
  { t: 'Buscar um militar', d: 'Ctrl+K em qualquer tela, ou o campo "Buscar militar" no topo: nome, nome de guerra ou matrícula.' },
  { t: 'Pendências', d: 'O sino no topo lista o que precisa de ação no seu perfil. Clique no item para ir direto à tela.' },
  { t: 'Exportar', d: 'Efetivo, Afastamentos, Relatórios e Férias exportam para Excel e PDF. Toda exportação fica registrada e o arquivo sai com a marca "uso interno, LGPD": guarde em local protegido e apague quando não precisar mais.' },
  { t: 'Dados de saúde', d: 'Natureza e CID só aparecem no botão "ver" do afastamento, para quem tem permissão, e cada consulta fica registrada. Nunca escreva diagnóstico ou CID em observações.' },
  { t: 'Consultas', d: 'Em "Consultas", escolha o assunto (militares, afastamentos, férias ou movimentações), acrescente filtros (ex.: OME é 1ºGB, 2ºGB; quadro é QOA) e escolha como agrupar em linhas e colunas. Clique em qualquer número para ver a lista nominal. Use "Salvar consulta" para guardar e "Copiar link" para mandar a alguém: cada pessoa vê só o que o próprio acesso permite.' },
  { t: 'Regiões e mapa', d: 'Em "Regiões": efetivo, QOD, disponíveis, afastados e férias de hoje por região e OME, com o mapa por município. Clique numa região, num município ou numa OME para detalhar.' },
  { t: 'Antiguidade', d: 'Na ficha, a linha "Antiguidade" mostra a posição no posto, na OME, na região e geral. No Efetivo, a coluna "Antig."; em Relatórios, a "Lista de antiguidade".' },
  { t: 'Dicionário de dados', d: 'O que significa cada informação, de onde ela vem oficialmente, quem responde por ela e quem pode vê-la.' },
  { t: 'Comportamento', d: 'Em "Comportamento": o comportamento publicado de cada praça, o calculado pela escala móvel (Lei 11.817/2000, arts. 46 a 49; Decreto 50.014/2020) e o que falta publicar. O oficial é sempre o publicado em boletim; o cálculo serve para não perder prazo de melhoria e para conferir reclassificações.' },
  { t: 'Senha e saída', d: 'A senha é pessoal. Ao terminar, clique em "Sair", principalmente em computador compartilhado.' },
];
const OME: Item[] = [
  { t: 'Todo mês: conferência e entrega', d: 'Em "Conferência mensal", confira cada militar (ou baixe a planilha da OME, corrija no Excel e envie de volta). Depois clique em "Confirmar entrega" até o 5º dia útil.' },
  { t: 'Afastamentos', d: 'Lance na ficha do militar (aba Afastamentos) ou em lote no Efetivo. Férias não se lançam como afastamento: entram pelo módulo Férias e aparecem sozinhas.' },
  { t: 'Férias (PAF)', d: 'O PAF, as reprogramações e as interrupções são lançados pela DGP; a OME consulta o quadro de férias, as reprogramações e as pendências dos seus militares. Pedidos de reprogramação seguem pelo SEI (art. 11 a 13 da Portaria 312).' },
  { t: 'Transferência e inclusão', d: 'Inclusão, transferência, desligamento e reinclusão são registrados somente pela DGP. A OME consulta as movimentações que envolvem as suas OMEs, em Movimentações e na aba Movimentações da ficha.' },
  { t: 'Dados oficiais', d: 'Posto, quadro, nome, nome de guerra, matrícula, nº funcional, sexo, nascimento, antiguidade, ingresso, promoção e órgão de cessão vêm do pecúlio e do almanaque e são mantidos pela DGP. Se algo estiver errado, avise a DGP.' },
  { t: 'Situações funcionais, comportamento e punições', d: 'Readaptação, horário especial, acumulação, PCD, punições e comportamento são lançados pela DGP. A OME consulta na ficha e na tela Comportamento.' },
  { t: 'Pecúlio geral', d: 'Em "Pecúlio geral" qualquer usuário consulta o efetivo ativo de todo o CBMPE (posto, nome, matrícula, nº funcional, OME, região, cessão e ingresso), em ordem de antiguidade. A ficha completa abre só para os militares das suas OMEs.' },
];
const DGP: Item[] = [
  { t: 'Rotina mensal da DGP', d: 'Importar o QOD (por volta do dia 7) e o almanaque (dia 15) em "QOD e almanaque"; acompanhar as entregas; fechar a competência no 6º dia útil; homologar reprogramações de férias e marcar a inserção no SGP.' },
  { t: 'PAF anual', d: 'Em Férias > Exercícios: abrir o exercício (ofício às OMEs até 30/05; propostas até 15/07); cadastrar períodos restritos (ex.: Carnaval) e órgãos de ensino; autorizar as exceções; publicar o PAF com o número do BGE.' },
  { t: 'Somente a DGP', d: 'Inclusão, transferência, desligamento, férias (PAF), situações funcionais, comportamento, punições e dados oficiais são lançados só pela DGP; as OMEs consultam. Os pedidos que estavam pendentes antes da versão 1.4.1 continuam em "Desligamentos e pedidos" até serem decididos.' },
  { t: 'Recarga e pecúlio', d: 'A recarga da versão 1.4 (pecúlio + almanaque + planilha) é feita uma única vez, pelo SQL entregue à parte. Depois, o almanaque mensal atualiza antiguidade, data de praça, nascimento e data de promoção; o pecúlio ainda não tem importação pela tela (prevista).' },
  { t: 'Estrutura e regiões', d: 'Em Administração > Estrutura e regiões: comando superior de cada OME (define a região), as OMEs regionais e o município da sede. A cidade de cada seção fica em "OMEs e seções". Quem tem acesso a uma OME passa a consultar, sem editar, as subordinadas a ela.' },
  { t: 'Dicionário de dados', d: 'A DGP mantém o dicionário (fonte oficial, responsável, quem edita e sensibilidade de cada informação). Ele exporta para Excel e PDF, como anexo do regimento.' },
  { t: 'Usuários', d: 'Em Administração: criar usuário com senha provisória (troca obrigatória no primeiro acesso), definir perfil, OMEs e permissão de saúde. Em "Acessos por OME", veja quem não entra no sistema.' },
];

export default function Ajuda() {
  const { podeEditarAlguma, gestaoGlobal, admin } = useAuth();
  const bloco = (titulo: string, itens: Item[]) => (
    <Cartao titulo={titulo}><dl className="novidades">{itens.map((i) => <div key={i.t}><dt>{i.t}</dt><dd>{i.d}</dd></div>)}</dl></Cartao>
  );
  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Ajuda</h1><p className="sub">O essencial para o seu perfil. Dúvidas e problemas: DGP, pelo canal de costume.</p></div></div>
      {bloco('Para todos', COMUM)}
      {podeEditarAlguma && bloco('Para quem edita a OME', OME)}
      {gestaoGlobal && bloco('Para a DGP', DGP)}
      {admin && bloco('Para o administrador', [
        { t: 'Auditoria', d: 'Em "Histórico de alterações": todas as alterações, os acessos a dados de saúde, as exportações e a varredura de possíveis dados de saúde em texto livre.' },
        { t: 'Termo de uso', d: 'Uma nova versão do termo (Administração > Termo de uso) obriga todos a aceitá-lo de novo no próximo acesso.' },
        { t: 'Backup', d: 'Rodar o scripts/backup.bat todo mês, depois do fechamento, e guardar o arquivo em local protegido.' },
      ])}
    </div>
  );
}
