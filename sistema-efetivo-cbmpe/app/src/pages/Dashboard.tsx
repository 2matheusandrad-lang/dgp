import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../lib/auth';
import { fmtCompetencia, fmtData, msgErro, rpc } from '../lib/util';
import { Aviso, Badge, Cartao, Carregando, Kpi, Tabela, Vazio } from '../components/ui';

const COR = { base: '#7f1d1d', afastado: '#d97706', grade: 'var(--borda)' };

export default function Dashboard() {
  const { escopo, ctx, global } = useAuth();
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [entregas, setEntregas] = useState<any[] | null>(null);
  const [comp, setComp] = useState<string>('');
  const [saude, setSaude] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setD(null); setErro(null);
    (async () => {
      try {
        const [dash, c] = await Promise.all([rpc('dashboard', { p_ome: escopo }), rpc<string>('competencia_atual')]);
        const [ent, sa] = await Promise.all([
          rpc<any[]>('situacao_entregas', { p_competencia: c }),
          ctx?.pode_ver_saude || global ? rpc<any[]>('saude_resumo', { p_ome: escopo }) : Promise.resolve([]),
        ]);
        if (!vivo) return;
        setD(dash); setComp(c); setEntregas(escopo ? ent.filter((e) => e.ome_id === escopo) : ent); setSaude(sa || []);
      } catch (e) { if (vivo) setErro(msgErro(e)); }
    })();
    return () => { vivo = false; };
  }, [escopo, ctx, global]);

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!d) return <Carregando />;

  const pct = (n: number) => (d.total ? Math.round((100 * n) / d.total) : 0);
  const unidades = escopo ? d.por_secao : d.por_ome;
  const pendentes = (entregas || []).filter((e) => e.situacao === 'PENDENTE' || e.situacao === 'ATRASADA');
  const altura = (n: number) => Math.max(180, n * 26 + 40);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Painel do efetivo</h1>
          <p className="sub">Situação em {fmtData(new Date().toISOString())} · {escopo ? ctx?.omes.find((o) => o.id === escopo)?.sigla : global ? 'todas as OMEs' : 'minhas OMEs'}</p>
        </div>
      </div>

      <div className="kpis">
        <Kpi rotulo="Efetivo ativo" valor={d.total.toLocaleString('pt-BR')} detalhe={`${d.operacional} operacional · ${d.administrativo} administrativo`} onClick={() => nav('/efetivo')} />
        <Kpi rotulo="Disponíveis hoje" valor={d.disponiveis.toLocaleString('pt-BR')} detalhe={`${pct(d.disponiveis)}% do efetivo`} tom="ok" />
        <Kpi rotulo="Afastados hoje" valor={d.afastados} detalhe={`${pct(d.afastados)}% do efetivo`} tom={d.afastados ? 'alerta' : undefined} onClick={() => nav('/afastamentos')} />
        <Kpi rotulo="Readaptados" valor={d.readaptados} detalhe={`Horário especial: ${d.horario_especial}`} onClick={() => nav('/efetivo?condicao=readaptado')} />
        <Kpi rotulo="PCD · Acumulação" valor={`${d.pcd} · ${d.acumulacao}`} detalhe="militares PCD · com acumulação de cargo" />
        <Kpi rotulo="Cadastro completo" valor={`${d.completude_media}%`} detalhe={`${d.cadastro_completo} fichas 100% preenchidas`} tom={d.completude_media < 80 ? 'alerta' : 'ok'} onClick={() => nav('/efetivo?pendentes=1')} />
      </div>

      <div className="grade-2">
        <Cartao titulo="Efetivo por posto/graduação">
          <ResponsiveContainer width="100%" height={altura(d.por_posto.length)}>
            <BarChart data={d.por_posto.map((p: any) => ({ ...p, disponiveis: p.total - p.afastados }))} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} stroke={COR.grade} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="sigla" width={64} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: any, n: any) => [v, n === 'disponiveis' ? 'Disponíveis' : 'Afastados']} />
              <Legend formatter={(n) => (n === 'disponiveis' ? 'Disponíveis' : 'Afastados')} />
              <Bar dataKey="disponiveis" stackId="a" fill={COR.base} isAnimationActive={false} />
              <Bar dataKey="afastados" stackId="a" fill={COR.afastado} radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Cartao>

        <Cartao titulo={escopo ? 'Efetivo por seção' : 'Efetivo por OME'}>
          <ResponsiveContainer width="100%" height={altura(Math.min(unidades.length, 25))}>
            <BarChart data={unidades.slice(0, 25).map((u: any) => ({ nome: u.sigla || u.nome, disponiveis: u.total - u.afastados, afastados: u.afastados }))} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} stroke={COR.grade} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="nome" width={escopo ? 150 : 110} tick={{ fontSize: 11 }} interval={0} />
              <Tooltip formatter={(v: any, n: any) => [v, n === 'disponiveis' ? 'Disponíveis' : 'Afastados']} />
              <Bar dataKey="disponiveis" stackId="a" fill={COR.base} isAnimationActive={false} />
              <Bar dataKey="afastados" stackId="a" fill={COR.afastado} radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          {unidades.length > 25 && <p className="nota">Mostrando as 25 maiores de {unidades.length}.</p>}
        </Cartao>
      </div>

      <div className="grade-3">
        <Cartao titulo="Afastamentos em curso por tipo">
          {d.afastamentos_tipo.length ? (
            <ul className="lista-barras">
              {d.afastamentos_tipo.map((t: any) => (
                <li key={t.codigo}>
                  <span className="lb-rotulo" title={t.nome}>{t.nome.split(' - ')[0]}</span>
                  <span className="lb-barra"><i style={{ width: `${(100 * t.total) / d.afastamentos_tipo[0].total}%` }} /></span>
                  <span className="lb-valor">{t.total}</span>
                </li>
              ))}
            </ul>
          ) : <Vazio>Nenhum afastamento em curso.</Vazio>}
          {saude.length > 0 && (
            <p className="nota">Afastamentos de saúde por natureza: {saude.map((s) => `${s.natureza === 'FISICO' ? 'Físico' : s.natureza === 'MENTAL' ? 'Mental' : 'Não informada'} ${s.total}`).join(' · ')}</p>
          )}
        </Cartao>

        <Cartao titulo="Escolaridade (maior nível)">
          <ul className="lista-barras">
            {d.escolaridade.map((e: any) => {
              const max = Math.max(...d.escolaridade.map((x: any) => x.total));
              return (
                <li key={e.nivel}>
                  <span className="lb-rotulo">{e.nivel}</span>
                  <span className="lb-barra"><i className={e.ordem === 0 ? 'cinza' : ''} style={{ width: `${(100 * e.total) / max}%` }} /></span>
                  <span className="lb-valor">{e.total}</span>
                </li>
              );
            })}
          </ul>
        </Cartao>

        <Cartao titulo={`Entrega mensal · ${fmtCompetencia(comp)}`} acoes={<a className="link" onClick={() => nav('/entregas')}>ver</a>}>
          {entregas === null ? <Carregando /> : (
            <>
              <div className="entrega-resumo">
                <div><strong>{(entregas || []).length - pendentes.length}</strong><span>entregues</span></div>
                <div className={pendentes.length ? 'alerta' : ''}><strong>{pendentes.length}</strong><span>pendentes</span></div>
              </div>
              {entregas[0] && <p className="nota">Prazo: {fmtData(entregas[0].prazo)} (5º dia útil)</p>}
              {pendentes.length > 0 && (
                <div className="chips">{pendentes.slice(0, 30).map((p) => <Badge key={p.ome_id} tom={p.situacao === 'ATRASADA' ? 'vermelho' : 'amarelo'}>{p.ome_sigla}</Badge>)}</div>
              )}
            </>
          )}
        </Cartao>
      </div>

      <div className="grade-2">
        <Cartao titulo="Retornos nos próximos 15 dias">
          <Tabela porPagina={10} chave={(r: any) => r.militar_id + r.data_fim}
            linhas={d.terminando} onLinha={(r: any) => nav(`/militar/${r.militar_id}`)} vazio="Nenhum retorno previsto."
            colunas={[
              { id: 'posto_completo', titulo: 'Posto' },
              { id: 'nome', titulo: 'Nome' },
              ...(escopo ? [] : [{ id: 'ome_sigla', titulo: 'OME' }]),
              { id: 'tipo_nome', titulo: 'Tipo', render: (r: any) => <span title={r.tipo_nome}>{String(r.tipo_nome).split(' - ')[0]}</span> },
              { id: 'data_fim', titulo: 'Término', render: (r: any) => <>{fmtData(r.data_fim)} <span className="nota">({r.dias_restantes === 0 ? 'hoje' : `${r.dias_restantes}d`})</span></> },
            ]} />
        </Cartao>
        <Cartao titulo="Afastamentos que começam nos próximos 15 dias">
          <Tabela porPagina={10} chave={(r: any) => r.militar_id + r.data_inicio}
            linhas={d.iniciando} onLinha={(r: any) => nav(`/militar/${r.militar_id}`)} vazio="Nenhum afastamento previsto."
            colunas={[
              { id: 'posto_completo', titulo: 'Posto' },
              { id: 'nome', titulo: 'Nome' },
              ...(escopo ? [] : [{ id: 'ome_sigla', titulo: 'OME' }]),
              { id: 'tipo_nome', titulo: 'Tipo', render: (r: any) => <span title={r.tipo_nome}>{String(r.tipo_nome).split(' - ')[0]}</span> },
              { id: 'data_inicio', titulo: 'Início', render: (r: any) => fmtData(r.data_inicio) },
              { id: 'dias', titulo: 'Dias' },
            ]} />
        </Cartao>
      </div>

      {d.areas.length > 0 && (
        <Cartao titulo="Principais áreas de formação">
          <div className="chips">{d.areas.map((a: any) => <Badge key={a.area}>{a.area} · {a.total}</Badge>)}</div>
        </Cartao>
      )}
    </div>
  );
}
