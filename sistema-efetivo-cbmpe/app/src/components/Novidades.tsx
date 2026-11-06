import { useState } from 'react';
import { Botao, Modal } from './ui';

export const VERSAO = '1.2';
const ITENS = [
  ['Férias (PAF)', 'Novo módulo pela Portaria 312: quadro de férias da OME com o limite de 10% por mês, proposta do PAF (30 dias ou 2 × 15, a partir do dia 1º ou 16), reprogramação e interrupção com homologação da DGP. Férias viram afastamento sozinhas: não se lançam mais como afastamento avulso.'],
  ['Pedido de correção', 'Posto, quadro, nome, matrícula, antiguidade e data de ingresso agora são mantidos pela DGP (almanaque). Se algo estiver errado, use "Pedir correção à DGP" na ficha.'],
  ['Exportações registradas', 'Todo Excel e PDF sai com a marca "uso interno, LGPD" e o nome de quem gerou, e fica registrado.'],
  ['Ajuda', 'Nova página de Ajuda no menu, com o essencial de cada perfil.'],
  ['Mais rápido e mais completo', 'Desde a versão 1.1: conferência mensal, QOD, indicadores, boletim, desligamentos pela DGP, busca rápida (Ctrl+K) e o sino de pendências.'],
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
