import { useState } from 'react';
import { Botao, Modal } from './ui';

export const VERSAO = '1.5';
const ITENS = [
  ['Menu mais enxuto', 'O menu passou de 20 para 10 itens. Páginas do mesmo assunto viraram abas no topo: Efetivo (suas OMEs e o pecúlio geral), Movimentações (inclusões e transferências, desligamentos), Rotina mensal (1. conferência, 2. entrega), Indicadores (indicadores, regiões e mapa, QOD), Relatórios (relatórios prontos e consultas) e Administração. Ajuda e Dicionário de dados foram para o rodapé, ao lado de Sair.'],
  ['Painel mais limpo', 'Os avisos de pendências saíram do painel e ficam só no sino. E o sino mostra só o que cada um resolve: a OME vê entrega mensal, conferência e militares sem seção; o restante (férias, situações funcionais, QOD, fechamento) fica com a DGP.'],
  ['Regiões oficiais', 'DIM (GBI, GBMar, GBS, GBAPH), DINTER I (1º, 2º, 6º e 7º GB), DINTER II (3º, 4º, 5º e 9º GB) e DIESP (CAT RMR, Agreste, Zona da Mata e Sertão). DIM, DINTER I, DINTER II e DIESP aparecem como região e também como OME, com efetivo próprio.'],
  ['Visual novo', 'Cores mais sóbrias, menu claro e uma fonte nova, mais legível nos números. Nada mudou de lugar.'],
  ['Erros à vista', 'Se alguma tela falhar, o aviso aparece no canto da tela, em vez de nada acontecer. A importação do PAF mostra o arquivo que está lendo e explica o problema quando não consegue abrir a planilha.'],
];

export default function Novidades() {
  const visto = (() => { try { return localStorage.getItem('novidades_vistas'); } catch { return VERSAO; } })();
  const [aberto, setAberto] = useState(visto !== VERSAO);
  const fechar = () => { try { localStorage.setItem('novidades_vistas', VERSAO); } catch { /* sem storage */ } setAberto(false); };
  return (
    <Modal aberto={aberto} onFechar={fechar} titulo={`Novidades da versão ${VERSAO}`} largo rodape={<Botao variante="primario" onClick={fechar}>Entendi</Botao>}>
      <dl className="novidades">
        {ITENS.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}
      </dl>
    </Modal>
  );
}
