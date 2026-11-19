import { useState } from 'react';
import { Botao, Modal } from './ui';

export const VERSAO = '1.4.1';
const ITENS = [
  ['Só a DGP altera', 'Movimentações (inclusão, transferência e desligamento), férias (PAF), situações funcionais, comportamento e punições passam a ser lançados e alterados somente pela DGP. As OMEs consultam tudo isso dos seus militares. Os pedidos à DGP pela tela (comunicar desligamento, pedir correção, pedir reprogramação) saíram: a comunicação segue pelo SEI.'],
  ['Pecúlio geral', 'Novo item no menu: o efetivo ativo de todo o CBMPE em ordem de antiguidade, para qualquer usuário consultar. A ficha completa (contato, afastamentos, férias, disciplina) abre só para os militares das suas OMEs.'],
  ['Dados oficiais', 'Nome de guerra e ano de ingresso entram na lista de dados mantidos pela DGP (pecúlio e almanaque), junto com posto, nome, matrícula, nascimento e os demais. A OME continua cuidando de seção, atividade, contato, afastamentos e formação.'],

  ['Base recarregada', 'O cadastro foi refeito a partir do pecúlio de 17/11, do almanaque de 15/09 e da planilha de controle. Cada informação vem da fonte oficial definida pela DGP (veja o Dicionário de dados). Militares que entraram sem seção aparecem na Conferência mensal para a OME completar.'],
  ['Novos dados na ficha', 'Nº funcional, sexo, data de nascimento (idade), data da última promoção (tempo no posto) e órgão de cessão. São mantidos pela DGP: se algo estiver errado, avise a DGP.'],
  ['Comportamento', 'Nova tela com o comportamento das praças: o publicado em boletim, o calculado pela escala móvel (Lei 11.817/2000 e Decreto 50.014/2020), o que falta publicar e as próximas mudanças. A ficha ganhou a aba "Comportamento e punições", e as punições passam a ter publicação e cancelamento.'],
  ['Consultas', 'Novos campos: sexo, idade e faixa etária, tempo no posto, ano da promoção, órgão de cessão e comportamento. Novas perguntas prontas: faixa etária por posto, comportamento por OME, cedidos a outros órgãos e tempo médio no posto.'],
  ['PAF', 'A importação da planilha do PAF entende códigos como "2025.0" e, nas linhas sem código, usa a janela de gozo (Portaria 312, art. 1º) para achar o exercício. Matrículas antigas de 5 dígitos são reconhecidas.'],
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
