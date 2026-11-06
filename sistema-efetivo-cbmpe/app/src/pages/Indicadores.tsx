import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../lib/auth';
import { useConsulta } from '../lib/consulta';
import { fmtCompetencia, fmtData, mesesAte, msgErro, rpc, pct } from '../lib/util';
import { Aviso, Botao, Cartao, Carregando, useToast } from '../components/ui';

type Ficha = { titulo: string; formula: string; fonte: string; periodicidade: string; leitura: string };
const FICHAS: Record<string, Ficha> = {
  disponibilidade: { titulo: 'Índice de disponibilidade', formula: 'efetivo pronto ÷ efetivo previsto no QOD × 100 (só OMEs com QOD lançado)', fonte: 'Fichas, afastamentos e QOD', periodicidade: 'Diária; fotografia mensal no fechamento', leitura: 'Quanto da força prevista está de fato disponível hoje. É o número-síntese para o Comando.' },
  cobertura: { titulo: 'Cobertura do QOD', formula: 'efetivo existente ÷ efetivo previsto × 100', fonte: 'Fichas e QOD', periodicidade: 'Mensal', leitura: 'Abaixo de 100% = claro de efetivo; acima = excesso em relação ao previsto.' },
  prontidao: { titulo: 'Prontidão', formula: 'efetivo pronto ÷ efetivo existente × 100', fonte: 'Fichas e afastamentos', periodicidade: 'Diária', leitura: 'Proporção do efetivo existente que não está afastado hoje.' },
  taxa: { titulo: 'Taxa de afastamento', formula: 'dias de afastamento no mês ÷ (efetivo × dias do período) × 100', fonte: 'Afastamentos', periodicidade: 'Mensal', leitura: 'Quanto da força de trabalho do mês foi perdida com afastamentos, por tipo e por OME.' },
  qualidade: { titulo: 'Qualidade cadastral', formula: 'média do % de preenchimento das fichas (7 campos)', fonte: 'Fichas', periodicidade: 'Contínua', leitura: 'Confiabilidade do próprio dado. Abaixo de 90% os demais indicadores perdem precisão.' },
  pontualidade: { titulo: 'Pontualidade da entrega', formula: 'OMEs que confirmaram até o 5º dia útil ÷ OMEs com efetivo × 100', fonte: 'Entrega mensal', periodicidade: 'Mensal', leitura: 'Disciplina do processo de atualização mensal.' },
};

export default function Indicadores() {
  const { escopo, ctx, global } = useAuth();
  const toast = useToast();
  const atual = useConsulta('competencia', () => rpc<string>('competencia_atual'), 300_000).dados;
  const [comp, setComp] = useState('');
  const competencia = comp || atual || '';
  const [aberta, setAberta] = useState<string | null>(null);
  const r = useConsulta(competencia ? `ind|${competencia}|${escopo}` : null, () => rpc<any>('indicadores', { p_competencia: competencia, p_ome: escopo }), 60_000);
  const d = r.dados;
  const nomeEscopo = escopo ? ctx?.omes.find((o) => o.id === escopo)?.sigla : global ? 'todas as OMEs' : 'minhas OMEs';

  const card = (id: string, valor: string, detalhe: string, tom?: 'ok' | 'alerta') => (
    <div className={`kpi ${tom ? 'kpi-' + tom : ''} clicavel`} onClick={() => setAberta(aberta === id ? null : id)}>
      <div className="kpi-rotulo">{FICHAS[id].titulo} <span className="nota">ⓘ</span></div>
      <div className="kpi-valor">{valor}</div>
      <div className="kpi-detalhe">{detalhe}</div>
    </div>
  );
  const boletim = async () => {
    try { const b = await rpc<any>('boletim', { p_competencia: competencia }); const { pdfBoletim } = await import('../lib/pdf'); pdfBoletim(b); }
    catch (e) { toast(msgErro(e), 'erro'); }
  };

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Indicadores de pessoal</h1><p className="sub">{nomeEscopo} · competência {fmtCompetencia(competencia)}{d ? ` · período ${fmtData(d.periodo_inicio)} a ${fmtData(d.periodo_fim)}` : ''}</p></div>
        <div className="acoes">
          <select value={competencia} onChange={(e) => setComp(e.target.value)}>
            {atual && mesesAte(atual, 12).map((m) => <option key={m} value={m}>{fmtCompetencia(m)}</option>)}
          </select>
          {global && <Botao variante="primario" onClick={boletim}>Boletim mensal (PDF)</Botao>}
        </div>
      </div>
      {r.erro && <Aviso tom="erro">{r.erro}</Aviso>}
      {!d ? <Carregando /> : <>
        <div className="kpis">
          {card('disponibilidade', pct(d.disponibilidade), d.previsto ? `${d.prontos_omes_qod} prontos / ${d.previsto} previstos (${d.omes_com_qod} OMEs com QOD)` : 'sem QOD lançado', d.disponibilidade != null && d.disponibilidade < 90 ? 'alerta' : 'ok')}
          {card('cobertura', pct(d.cobertura_qod), d.previsto ? `${d.existente_omes_qod} existentes / ${d.previsto} previstos` : 'sem QOD lançado', d.cobertura_qod != null && d.cobertura_qod < 100 ? 'alerta' : undefined)}
          {card('prontidao', pct(d.prontidao), `${d.prontos} prontos de ${d.existente}`)}
          {card('taxa', pct(d.taxa_afastamento), `${Math.round(d.dias_afastados)} dias de afastamento no período`)}
          {card('qualidade', pct(d.qualidade?.completude_media), `${d.qualidade?.fichas_completas ?? 0} fichas 100% de ${d.qualidade?.total ?? 0}`, (d.qualidade?.completude_media ?? 0) < 90 ? 'alerta' : 'ok')}
          {card('pontualidade', d.pontualidade?.total_omes ? `${Math.round((100 * d.pontualidade.no_prazo) / d.pontualidade.total_omes)}%` : '—', `${d.pontualidade?.no_prazo ?? 0} de ${d.pontualidade?.total_omes ?? 0} OMEs no prazo em ${fmtCompetencia(d.pontualidade?.competencia)}`)}
        </div>
        {aberta && (
          <Cartao titulo={`Ficha do indicador · ${FICHAS[aberta].titulo}`} acoes={<button className="link" onClick={() => setAberta(null)}>fechar</button>}>
            <table className="tabela compacta ficha-ind"><tbody>
              <tr><th>Fórmula</th><td>{FICHAS[aberta].formula}</td></tr>
              <tr><th>Fonte</th><td>{FICHAS[aberta].fonte}</td></tr>
              <tr><th>Periodicidade</th><td>{FICHAS[aberta].periodicidade}</td></tr>
              <tr><th>Como ler</th><td>{FICHAS[aberta].leitura}</td></tr>
              <tr><th>Responsável</th><td>DGP</td></tr>
              <tr><th>Meta</th><td>a definir após 3 meses de histórico</td></tr>
            </tbody></table>
          </Cartao>
        )}

        <div className="grade-2">
          <Cartao titulo="Taxa de afastamento por OME (%)">
            {d.taxa_por_ome?.length ? (
              <ResponsiveContainer width="100%" height={Math.max(180, Math.min(d.taxa_por_ome.length, 20) * 24 + 40)}>
                <BarChart data={d.taxa_por_ome.slice(0, 20)} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid horizontal={false} stroke="var(--borda)" />
                  <XAxis type="number" tick={{ fontSize: 12 }} unit="%" />
                  <YAxis type="category" dataKey="sigla" width={110} tick={{ fontSize: 11 }} interval={0} />
                  <Tooltip formatter={(v: any, _n, p: any) => [`${pct(v, 2)} (efetivo ${p.payload.efetivo})`, 'Taxa']} />
                  <Bar dataKey="taxa" fill="#8f1d1d" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="nota">Sem dados.</p>}
            {d.taxa_por_ome?.length > 20 && <p className="nota">As 20 maiores de {d.taxa_por_ome.length}.</p>}
          </Cartao>
          <div className="pilha">
            <Cartao titulo="Afastamentos no período por tipo">
              <ul className="lista-barras">
                {(d.afastamento_por_tipo || []).map((t: any) => (
                  <li key={t.nome}>
                    <span className="lb-rotulo" title={t.nome}>{t.nome.split(' - ')[0]}</span>
                    <span className="lb-barra"><i style={{ width: `${(100 * t.dias) / d.afastamento_por_tipo[0].dias}%` }} /></span>
                    <span className="lb-valor" title={`${t.militares} militar(es)`}>{t.dias}d</span>
                  </li>
                ))}
              </ul>
              {!d.afastamento_por_tipo?.length && <p className="nota">Nenhum afastamento no período.</p>}
            </Cartao>
            <Cartao titulo="Movimentações no mês">
              <div className="mini-kpis">
                <div><strong>{d.movimentacoes?.inclusoes ?? 0}</strong><span>inclusões</span></div>
                {d.movimentacoes?.transferencias_internas != null
                  ? <div><strong>{d.movimentacoes.transferencias_internas}</strong><span>transferências</span></div>
                  : <><div><strong>{d.movimentacoes?.transferencias_entrada ?? 0}</strong><span>entradas</span></div><div><strong>{d.movimentacoes?.transferencias_saida ?? 0}</strong><span>saídas</span></div></>}
                <div><strong>{d.movimentacoes?.desligamentos ?? 0}</strong><span>desligamentos</span></div>
              </div>
            </Cartao>
            {d.saude && (
              <Cartao titulo="Afastamentos de saúde no período (agregado)">
                {d.saude.oculto ? <p className="nota">Oculto: {d.saude.motivo}, para não permitir identificar pessoas.</p> : (
                  <div className="mini-kpis">
                    <div><strong>{d.saude.fisico}</strong><span>físico</span></div>
                    <div><strong>{d.saude.mental}</strong><span>mental</span></div>
                    <div><strong>{d.saude.nao_informada}</strong><span>não informada</span></div>
                  </div>
                )}
                <p className="nota">Número de militares. Uso restrito ao planejamento de ações de saúde.</p>
              </Cartao>
            )}
          </div>
        </div>
        {(d.serie || []).length > 0 && (
          <Cartao titulo="Histórico das competências fechadas">
            <table className="tabela compacta"><thead><tr><th>Competência</th><th>Existente</th><th>Previsto</th><th>Afastados no fechamento</th></tr></thead>
              <tbody>{d.serie.map((s: any) => <tr key={s.competencia}><td>{fmtCompetencia(s.competencia)}</td><td>{s.existente}</td><td>{s.previsto || '—'}</td><td>{s.afastados}</td></tr>)}</tbody></table>
          </Cartao>
        )}
      </>}
    </div>
  );
}
