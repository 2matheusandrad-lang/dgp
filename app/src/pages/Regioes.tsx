import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios } from '../lib/dominios';
import { useConsulta } from '../lib/consulta';
import { DEMAIS, mapaRegioes, municipioDe } from '../lib/regioes';
import { nomeMunicipio } from '../lib/municipios';
import { codificar } from '../lib/consultaLivre';
import { buscarTodos, fmtCompetencia } from '../lib/util';
import { Aviso, Botao, Cartao, Carregando } from '../components/ui';
import MapaPE from '../components/MapaPE';

type Num = { existente: number; afastados: number; ferias: number; operacional: number; previsto: number | null };
const novo = (): Num => ({ existente: 0, afastados: 0, ferias: 0, operacional: 0, previsto: null });
const pctTxt = (a: number, b: number) => (b ? `${((100 * a) / b).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');
const MEDIDAS = [
  { id: 'existente', rotulo: 'Efetivo' }, { id: 'disponiveis', rotulo: 'Disponíveis hoje' },
  { id: 'afastados', rotulo: 'Afastados hoje' }, { id: 'ferias', rotulo: 'Em férias hoje' },
] as const;

export default function Regioes() {
  const { gestaoGlobal } = useAuth();
  const dom = useDominios();
  const nav = useNavigate();
  const [selRegiao, setSelRegiao] = useState<string | null>(null);
  const [medida, setMedida] = useState<(typeof MEDIDAS)[number]['id']>('existente');
  const [mun, setMun] = useState<number | null>(null);

  const mil = useConsulta('regioes:mil', () => buscarTodos(() => supabase.from('v_militar')
    .select('id,ome_id,secao_id,atividade,afastado_hoje,afastamento_codigo').eq('situacao', 'ATIVO').order('id')), 120_000);
  const qod = useConsulta('regioes:qod', async () => {
    const { data: u } = await supabase.from('qod').select('competencia').order('competencia', { ascending: false }).limit(1);
    const comp = u?.[0]?.competencia;
    if (!comp) return { comp: null as string | null, linhas: [] as any[] };
    const linhas = await buscarTodos(() => supabase.from('qod').select('ome_id,previsto').eq('competencia', comp).order('id'));
    return { comp, linhas };
  }, 300_000);

  const regioes = useMemo(() => mapaRegioes(dom), [dom]);
  const calc = useMemo(() => {
    if (!dom || !mil.dados) return null;
    const porRegiao = new Map<string, Num>(), porOme = new Map<number, Num>(), porMun = new Map<number, { ex: number; disp: number; af: number; fe: number }>();
    let semMun = 0;
    const reg = (k: string) => { let x = porRegiao.get(k); if (!x) { x = novo(); porRegiao.set(k, x); } return x; };
    const ome = (k: number) => { let x = porOme.get(k); if (!x) { x = novo(); porOme.set(k, x); } return x; };
    for (const m of mil.dados as any[]) {
      const r = regioes.de(m.ome_id).rotulo;
      const ferias = m.afastado_hoje && m.afastamento_codigo === 'FERIAS';
      for (const x of [reg(r), ome(m.ome_id)]) {
        x.existente++; if (m.afastado_hoje) x.afastados++; if (ferias) x.ferias++; if (m.atividade === 'OPERACIONAL') x.operacional++;
      }
      const c = municipioDe(dom, m.ome_id, m.secao_id);
      if (!c && (!selRegiao || r === selRegiao)) semMun++;
      if (c && (!selRegiao || r === selRegiao)) {
        const y = porMun.get(c) || { ex: 0, disp: 0, af: 0, fe: 0 };
        y.ex++; if (m.afastado_hoje) y.af++; else y.disp++; if (ferias) y.fe++;
        porMun.set(c, y);
      }
    }
    for (const q of qod.dados?.linhas || []) {
      const r = regioes.de(q.ome_id).rotulo;
      reg(r).previsto = (reg(r).previsto || 0) + (q.previsto || 0);
      ome(q.ome_id).previsto = (ome(q.ome_id).previsto || 0) + (q.previsto || 0);
    }
    return { porRegiao, porOme, porMun, semMun };
  }, [dom, mil.dados, qod.dados, regioes, selRegiao]);

  if (!dom || !calc) return <div className="pagina"><Carregando /></div>;
  const semEstrutura = !dom.omes.some((o) => o.regional && dom.omes.some((x) => x.comando_id === o.id));
  const valoresMapa = new Map([...calc.porMun].map(([c, y]) => [c, medida === 'existente' ? y.ex : medida === 'disponiveis' ? y.disp : medida === 'afastados' ? y.af : y.fe]));
  const omesRegiao = dom.omes.filter((o) => o.ativo && calc.porOme.has(o.id) && (!selRegiao || regioes.de(o.id).rotulo === selRegiao))
    .sort((a, b) => regioes.de(a.id).ordem - regioes.de(b.id).ordem || Number(!!b.regional) - Number(!!a.regional) || a.ordem - b.ordem);
  const consultaOme = (sigla: string) => nav(`/consultas?q=${codificar({ assunto: 'militares', filtros: [{ campo: 'situacao', op: 'in', valor: ['Ativo'] }, { campo: 'ome', op: 'in', valor: [sigla] }], modo: 'E', linhas: 'secao', colunas: 'disponivel', medida: 'qtd' })}`);
  const consultaMun = (c: number) => nav(`/consultas?q=${codificar({ assunto: 'militares', filtros: [{ campo: 'situacao', op: 'in', valor: ['Ativo'] }, { campo: 'municipio', op: 'in', valor: [nomeMunicipio.get(c)!] }], modo: 'E', linhas: 'ome', colunas: 'posto', medida: 'qtd' })}`);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Regiões</h1>
          <p className="sub">Efetivo por região, OME e município{qod.dados?.comp ? ` · QOD de ${fmtCompetencia(qod.dados.comp)}` : ' · sem QOD importado'} · dados de hoje</p>
        </div>
        <div className="acoes"><Link className="btn btn-secundario" to="/consultas">Fazer uma consulta</Link></div>
      </div>

      {semEstrutura && (
        <Aviso tom="alerta">A cadeia de comando ainda não foi cadastrada, por isso todas as OMEs aparecem em "{DEMAIS}". {gestaoGlobal
          ? <>Defina em <Link to="/admin?aba=estrutura">Administração &gt; Estrutura e regiões</Link> a qual região cada OME pertence.</>
          : 'A DGP define o enquadramento em Administração.'}</Aviso>
      )}

      <div className="regioes-cartoes">
        {regioes.lista.filter((r) => calc.porRegiao.has(r.rotulo)).map((r) => {
          const x = calc.porRegiao.get(r.rotulo)!;
          const claros = x.previsto != null ? x.previsto - x.existente : null;
          return (
            <button key={r.rotulo} className={`regiao-cartao ${selRegiao === r.rotulo ? 'ativo' : ''}`} onClick={() => { setSelRegiao(selRegiao === r.rotulo ? null : r.rotulo); setMun(null); }}>
              <span className="regiao-nome">{r.rotulo}</span>
              <span className="regiao-num">{x.existente.toLocaleString('pt-BR')}<small> militares</small></span>
              <span className="regiao-linha">QOD previsto <strong>{x.previsto != null ? x.previsto.toLocaleString('pt-BR') : '—'}</strong>{claros != null && <> · {claros >= 0 ? 'claros' : 'excedente'} <strong>{Math.abs(claros).toLocaleString('pt-BR')}</strong></>}</span>
              <span className="regiao-linha">Disponíveis <strong>{pctTxt(x.existente - x.afastados, x.existente)}</strong> · afastados <strong>{x.afastados}</strong> · férias <strong>{x.ferias}</strong></span>
              <span className="regiao-barra"><i style={{ width: pctTxt(x.existente - x.afastados, x.existente).replace(',', '.') }} /></span>
            </button>
          );
        })}
      </div>

      <div className="pilha">
        <Cartao titulo={`Mapa${selRegiao ? ` · ${selRegiao}` : ''}`} acoes={
          <select value={medida} onChange={(e) => setMedida(e.target.value as any)} aria-label="Medida do mapa">
            {MEDIDAS.map((m) => <option key={m.id} value={m.id}>{m.rotulo}</option>)}
          </select>}>
          <div className="mapa-regioes">
          <MapaPE valores={valoresMapa} rotulo={MEDIDAS.find((m) => m.id === medida)!.rotulo.toLowerCase()} selecionado={mun} onSelecionar={setMun} />
          <div className="mapa-lado">
            <h4>Maiores concentrações</h4>
            <ol>{[...valoresMapa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, v]) => <li key={c}><button className="link" onClick={() => setMun(c)}>{nomeMunicipio.get(c)}</button> <span className="nota">{v.toLocaleString('pt-BR')}</span></li>)}</ol>
            {calc.semMun > 0 && <p className="nota">{calc.semMun.toLocaleString('pt-BR')} militares sem município cadastrado (seção ou sede da OME){gestaoGlobal ? <>: <Link to="/admin?aba=estrutura">completar</Link></> : ''}.</p>}
          </div>
          </div>
          {mun && (() => {
            const y = calc.porMun.get(mun);
            return (
              <div className="mapa-detalhe">
                <span><strong>{nomeMunicipio.get(mun)}</strong>: {y ? `${y.ex} militares, ${y.disp} disponíveis, ${y.af} afastados (${y.fe} em férias)` : 'sem militares lotados'}</span>
                {y && <Botao pequeno onClick={() => consultaMun(mun)}>Ver na consulta</Botao>}
              </div>
            );
          })()}
        </Cartao>
        <Cartao titulo={selRegiao ? `OMEs da ${selRegiao}` : 'OMEs'}>
          <div className="tabela-rolagem">
            <table className="tabela compacta">
              <thead><tr><th>OME</th>{!selRegiao && <th>Região</th>}<th className="num">Existente</th><th className="num">QOD</th><th className="num">Claros</th><th className="num">Afastados</th><th className="num">Férias</th></tr></thead>
              <tbody>
                {omesRegiao.map((o) => {
                  const x = calc.porOme.get(o.id)!;
                  const claros = x.previsto != null ? x.previsto - x.existente : null;
                  return (
                    <tr key={o.id} className="clicavel" onClick={() => consultaOme(o.sigla)}>
                      <td><strong>{o.sigla}</strong>{o.regional && <span className="nota"> · OME sede da região</span>}</td>
                      {!selRegiao && <td className="nota nowrap">{regioes.de(o.id).rotulo}</td>}
                      <td className="num">{x.existente}</td>
                      <td className="num">{x.previsto ?? '—'}</td>
                      <td className={`num ${claros != null && claros < 0 ? 'texto-alerta' : ''}`}>{claros ?? '—'}</td>
                      <td className="num">{x.afastados} <span className="nota">{pctTxt(x.afastados, x.existente)}</span></td>
                      <td className="num">{x.ferias}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="nota">Clique numa OME para abri-la nas consultas, por seção e situação.</p>
        </Cartao>
      </div>
    </div>
  );
}
