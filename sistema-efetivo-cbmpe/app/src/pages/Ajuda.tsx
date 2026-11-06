import { useAuth } from '../lib/auth';
import { Cartao } from '../components/ui';

type Item = { t: string; d: string };
const COMUM: Item[] = [
  { t: 'Buscar um militar', d: 'Ctrl+K em qualquer tela, ou o campo "Buscar militar" no topo: nome, nome de guerra ou matrícula.' },
  { t: 'Pendências', d: 'O sino no topo lista o que precisa de ação no seu perfil. Clique no item para ir direto à tela.' },
  { t: 'Exportar', d: 'Efetivo, Afastamentos, Relatórios e Férias exportam para Excel e PDF. Toda exportação fica registrada e o arquivo sai com a marca "uso interno, LGPD": guarde em local protegido e apague quando não precisar mais.' },
  { t: 'Dados de saúde', d: 'Natureza e CID só aparecem no botão "ver" do afastamento, para quem tem permissão, e cada consulta fica registrada. Nunca escreva diagnóstico ou CID em observações.' },
  { t: 'Senha e saída', d: 'A senha é pessoal. Ao terminar, clique em "Sair", principalmente em computador compartilhado.' },
];
const OME: Item[] = [
  { t: 'Todo mês: conferência e entrega', d: 'Em "Conferência mensal", confira cada militar (ou baixe a planilha da OME, corrija no Excel e envie de volta). Depois clique em "Confirmar entrega" até o 5º dia útil.' },
  { t: 'Afastamentos', d: 'Lance na ficha do militar (aba Afastamentos) ou em lote no Efetivo. Férias não se lançam como afastamento: entram pelo módulo Férias e aparecem sozinhas.' },
  { t: 'Férias (PAF)', d: 'No quadro de férias, clique no militar para lançar a proposta (30 dias ou 2 × 15, sempre a partir do dia 1º ou 16) até o prazo da OME. Depois de publicado o PAF, mudanças são por reprogramação: processo SEI, deferimento do titular da OME publicado e homologação da DGP. Pedido a pedido do militar precisa de 60 dias de antecedência. A OME pode ter no máximo 10% do efetivo em férias no mês.' },
  { t: 'Transferência e inclusão', d: 'Quem recebe o militar usa "Receber transferido" no Efetivo, informando o documento. Militar novo: "+ Novo militar".' },
  { t: 'Desligamento e correções', d: 'Desligamento é registrado só pela DGP: use "Comunicar desligamento" na ficha. Posto, quadro, nome, matrícula, antiguidade e data de ingresso são mantidos pela DGP: use "Pedir correção à DGP" na ficha.' },
];
const DGP: Item[] = [
  { t: 'Rotina mensal da DGP', d: 'Importar o QOD (por volta do dia 7) e o almanaque (dia 15) em "QOD e almanaque"; acompanhar as entregas; fechar a competência no 6º dia útil; homologar reprogramações de férias e marcar a inserção no SGP.' },
  { t: 'PAF anual', d: 'Em Férias > Exercícios: abrir o exercício (ofício às OMEs até 30/05; propostas até 15/07); cadastrar períodos restritos (ex.: Carnaval) e órgãos de ensino; autorizar as exceções; publicar o PAF com o número do BGE.' },
  { t: 'Pedidos das OMEs', d: 'Em "Desligamentos e pedidos": efetivar ou devolver desligamentos e aplicar ou devolver correções cadastrais.' },
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
