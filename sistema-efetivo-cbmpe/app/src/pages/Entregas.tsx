import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { exportarXlsx, fmtCompetencia, fmtData, fmtDataHora, msgErro, rpc } from '../lib/util';
import { Aviso, Badge, Botao, Cartao, Carregando, Confirmar, Kpi, Tabela, useToast } from '../components/ui';

const TOM: Record<string, any> = { 'ENTREGUE NO PRAZO': 'verde', 'ENTREGUE COM ATRASO': 'amarelo', PENDENTE: 'azul', ATRASADA: 'vermelho' };

export default function Entregas() {
  const { escopo, podeEditarOme, gestaoGlobal } = useAuth();
  const toast = useToast();
  const [comp, setComp] = useState('');
  const [compAtual, setCompAtual] = useState('');
  const [linhas, setLinhas] = useState<any[] | null>(null);
  const [fechamentos, setFechamentos] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarOme, setConfirmarOme] = useState<any>(null);
  const [fechar, setFechar] = useState(false);

  useEffect(() => { rpc<string>('competencia_atual').then((c) => { setComp(c); setCompAtual(c); }).catch((e) => setErro(msgErro(e))); }, []);
  const carregar = useCallback(async () => {
    if (!comp) return;
    setLinhas(null);
    try {
      const l = await rpc<any[]>('situacao_entregas', { p_competencia: comp });
      setLinhas(escopo ? l.filter((x) => x.ome_id === escopo) : l);
      const { data } = await supabase.from('fechamento_mensal').select('*').order('competencia', { ascending: false }).limit(24);
      setFechamentos(data || []);
    } catch (e) { setErro(msgErro(e)); }
  }, [comp, escopo]);
  useEffect(() => { carregar(); }, [carregar]);

  const meses = (() => {
    if (!compAtual) return [];
    const [a, m] = compAtual.split('-').map(Number);
    return Array.from({ length: 12 }, (_, i) => { const d = new Date(a, m - 1 - i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; });
  })();
  const n = (s: string) => (linhas || []).filter((l) => l.situacao === s).length;
  const fechada = fechamentos.find((f) => f.competencia === comp);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Entrega mensal</h1>
          <p className="sub">Cada OME confirma até o 5º dia útil que os dados do mês anterior estão atualizados (SEI 3900000732.000263/2024-20).</p>
        </div>
        <div className="acoes">
          <select value={comp} onChange={(e) => setComp(e.target.value)}>
            {meses.map((m) => <option key={m} value={m}>Competência {fmtCompetencia(m)}{m === compAtual ? ' (em aberto)' : ''}</option>)}
          </select>
          {linhas && <Botao onClick={() => exportarXlsx('entregas', `Entrega mensal — competência ${fmtCompetencia(comp)}`, [
            { titulo: 'OME', valor: (r: any) => r.ome_sigla }, { titulo: 'Efetivo', valor: (r: any) => r.efetivo },
            { titulo: 'Prazo', valor: (r: any) => fmtData(r.prazo) }, { titulo: 'Situação', valor: (r: any) => r.situacao, largura: 22 },
            { titulo: 'Confirmado em', valor: (r: any) => fmtDataHora(r.confirmado_em), largura: 18 }, { titulo: 'Confirmado por', valor: (r: any) => r.confirmado_por, largura: 30 },
            { titulo: 'Última alteração', valor: (r: any) => fmtDataHora(r.ultima_alteracao), largura: 18 }], linhas)}>Exportar Excel</Botao>}
          {gestaoGlobal && <Botao variante="primario" onClick={() => setFechar(true)}>{fechada ? 'Refazer fechamento' : 'Fechar competência'}</Botao>}
        </div>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!linhas ? <Carregando /> : <>
        <div className="kpis">
          <Kpi rotulo="Prazo" valor={linhas[0] ? fmtData(linhas[0].prazo) : '—'} detalhe={`competência ${fmtCompetencia(comp)}`} />
          <Kpi rotulo="Entregues no prazo" valor={n('ENTREGUE NO PRAZO')} tom="ok" />
          <Kpi rotulo="Entregues com atraso" valor={n('ENTREGUE COM ATRASO')} />
          <Kpi rotulo="Pendentes" valor={n('PENDENTE') + n('ATRASADA')} detalhe={n('ATRASADA') ? `${n('ATRASADA')} com prazo vencido` : undefined} tom={n('ATRASADA') ? 'alerta' : undefined} />
          <Kpi rotulo="Fechamento DGP" valor={fechada ? 'Fechada' : 'Aberta'} detalhe={fechada ? `${fmtDataHora(fechada.fechado_em)} · ${fechada.total} militares` : 'fotografia ainda não gerada'} />
        </div>
        <Cartao>
          <Tabela linhas={linhas} chave={(r: any) => String(r.ome_id)} porPagina={100} colunas={[
            { id: 'ome_sigla', titulo: 'OME' },
            { id: 'efetivo', titulo: 'Efetivo' },
            { id: 'situacao', titulo: 'Situação', render: (r: any) => <Badge tom={TOM[r.situacao]}>{r.situacao.toLowerCase()}</Badge> },
            { id: 'confirmado_em', titulo: 'Confirmado em', render: (r: any) => fmtDataHora(r.confirmado_em) },
            { id: 'confirmado_por', titulo: 'Por' },
            { id: 'ultima_alteracao', titulo: 'Última alteração nos dados', render: (r: any) => fmtDataHora(r.ultima_alteracao) || <span className="nota">sem alterações desde a carga</span> },
            { id: 'acao', titulo: '', ordenavel: false, render: (r: any) => podeEditarOme(r.ome_id) && !fechada
              ? <Botao pequeno variante={r.confirmado_em ? 'fantasma' : 'primario'} onClick={() => setConfirmarOme(r)}>{r.confirmado_em ? 'Confirmar novamente' : 'Confirmar entrega'}</Botao> : null },
          ]} />
        </Cartao>
      </>}

      <Confirmar aberto={!!confirmarOme} titulo={`Confirmar entrega · ${confirmarOme?.ome_sigla}`} rotuloSim="Confirmo"
        texto={<>Declaro que os dados do efetivo do <strong>{confirmarOme?.ome_sigla}</strong> ({confirmarOme?.efetivo} militares) estão atualizados para a competência <strong>{fmtCompetencia(comp)}</strong>: lotação, afastamentos, situações funcionais, punições, escolaridade e contatos.</>}
        onNao={() => setConfirmarOme(null)}
        onSim={async () => {
          try { await rpc('confirmar_entrega', { p_ome: confirmarOme.ome_id, p_competencia: comp, p_observacao: null }); toast('Entrega confirmada.'); carregar(); }
          catch (e) { toast(msgErro(e), 'erro'); }
          setConfirmarOme(null);
        }} />
      <Confirmar aberto={fechar} titulo={`Fechar competência ${fmtCompetencia(comp)}`} rotuloSim="Gerar fotografia"
        texto="Será salva uma fotografia do efetivo ativo de todas as OMEs, com os afastamentos do mês. Ela alimenta o relatório “Efetivo de competência fechada” e não muda com alterações posteriores. Após o fechamento, as OMEs não confirmam mais esta competência."
        onNao={() => setFechar(false)}
        onSim={async () => {
          try { const t = await rpc<number>('fechar_competencia', { p_competencia: comp }); toast(`Competência fechada: ${t} militares.`); carregar(); }
          catch (e) { toast(msgErro(e), 'erro'); }
          setFechar(false);
        }} />
    </div>
  );
}
