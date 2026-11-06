import { useMemo, useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../lib/auth';
import { useDominios } from '../lib/dominios';
import { invalidar, useConsulta } from '../lib/consulta';
import { fmtCompetencia, mesesAte, msgErro, rpc } from '../lib/util';
import { Aviso, Botao, Campo, Cartao, Carregando, Kpi, Modal, Vazio, useToast } from '../components/ui';
import Exportar from '../components/Exportar';

type Linha = { ome_id: number; ome_sigla: string; ome_ordem: number; posto_id: number; posto_sigla: string; posto_ordem: number; quadro_sigla: string | null; previsto: number; existente: number; afastados: number };
const chaveCol = (l: { posto_sigla: string; quadro_sigla: string | null }) => (l.quadro_sigla ? `${l.posto_sigla} ${l.quadro_sigla}` : l.posto_sigla);

export default function Qod() {
  const { gestaoGlobal, escopo } = useAuth();
  const dom = useDominios();
  const toast = useToast();
  const atual = useConsulta('competencia', () => rpc<string>('competencia_atual'), 300_000).dados;
  const [comp, setComp] = useState<string>('');
  const competencia = comp || atual || '';
  const dados = useConsulta(competencia ? `qod|${competencia}` : null, () => rpc<Linha[]>('qod_comparativo', { p_competencia: competencia }), 30_000);
  const hist = useConsulta(`qod|hist|${escopo}`, () => rpc<any[]>('qod_historico', { p_ome: escopo }), 300_000);
  const [modo, setModo] = useState<'existente' | 'pronto'>('existente');
  const [soComQod, setSoComQod] = useState(true);
  const [editar, setEditar] = useState(false);
  const [importar, setImportar] = useState<File | null>(null);
  const [exp, setExp] = useState(false);
  const arq = useRef<HTMLInputElement>(null);

  const linhas = useMemo(() => (dados.dados || []).filter((l) => !escopo || l.ome_id === escopo), [dados.dados, escopo]);
  const temQod = linhas.some((l) => l.previsto > 0);
  const omesComQod = new Set(linhas.filter((l) => l.previsto > 0).map((l) => l.ome_id));
  const visiveis = soComQod && temQod ? linhas.filter((l) => omesComQod.has(l.ome_id)) : linhas;
  const colunas = useMemo(() => {
    const m = new Map<string, number>();
    visiveis.forEach((l) => m.set(chaveCol(l), l.posto_ordem * 10 + (l.quadro_sigla === 'QOA' ? 2 : l.quadro_sigla ? 1 : 0)));
    return [...m.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  }, [visiveis]);
  const omes = useMemo(() => {
    const m = new Map<number, { id: number; sigla: string; ordem: number }>();
    visiveis.forEach((l) => m.set(l.ome_id, { id: l.ome_id, sigla: l.ome_sigla, ordem: l.ome_ordem }));
    return [...m.values()].sort((a, b) => a.ordem - b.ordem || a.sigla.localeCompare(b.sigla));
  }, [visiveis]);
  const cel = useMemo(() => {
    const m = new Map<string, Linha>();
    visiveis.forEach((l) => m.set(`${l.ome_id}|${chaveCol(l)}`, l));
    return m;
  }, [visiveis]);
  const valor = (l?: Linha) => (l ? (modo === 'pronto' ? l.existente - l.afastados : l.existente) : 0);
  const tot = visiveis.reduce((s, l) => ({ p: s.p + l.previsto, e: s.e + valor(l) }), { p: 0, e: 0 });
  const omesClaro = omes.filter((o) => {
    const ls = visiveis.filter((l) => l.ome_id === o.id);
    return ls.reduce((s, l) => s + l.previsto, 0) > ls.reduce((s, l) => s + valor(l), 0);
  }).length;
  const meses = atual ? [...mesesAte(atual, 13)].reverse().concat([]) : [];
  const vigente = dados.dados && !temQod ? null : competencia;

  const classe = (prev: number, v: number) => (!prev ? (v ? 'qod-sem' : '') : v < prev ? 'qod-falta' : v > prev ? 'qod-excesso' : 'qod-ok');

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>QOD · previsto × existente</h1>
          <p className="sub">Competência {fmtCompetencia(competencia)} · {modo === 'pronto' ? 'efetivo pronto (descontando afastados hoje)' : 'efetivo existente'}</p>
        </div>
        <div className="acoes">
          <select value={competencia} onChange={(e) => setComp(e.target.value)}>
            {meses.map((m) => <option key={m} value={m}>Competência {fmtCompetencia(m)}{m === atual ? ' (atual)' : ''}</option>)}
          </select>
          <select value={modo} onChange={(e) => setModo(e.target.value as any)}>
            <option value="existente">Existente</option><option value="pronto">Pronto (sem afastados)</option>
          </select>
          <Botao onClick={() => setExp(true)} disabled={!visiveis.length}>Exportar claros</Botao>
          {gestaoGlobal && <>
            <Botao onClick={async () => {
              const { gerarModeloQod } = await import('../lib/excel');
              const vals: Record<string, number> = {};
              linhas.forEach((l) => { if (!l.quadro_sigla) vals[`${l.ome_id}|${l.posto_id}`] = l.previsto; });
              await gerarModeloQod((dom?.omes || []).filter((o) => o.ativo), dom?.postos || [], vals, fmtCompetencia(competencia));
            }}>Baixar modelo</Botao>
            <Botao onClick={() => arq.current?.click()}>Importar QOD</Botao>
            <input ref={arq} type="file" accept=".xlsx" hidden onChange={(e) => { if (e.target.files?.[0]) setImportar(e.target.files[0]); e.target.value = ''; }} />
            <Botao variante={editar ? 'primario' : 'secundario'} onClick={() => setEditar(!editar)}>{editar ? 'Fechar edição' : 'Editar na grade'}</Botao>
          </>}
        </div>
      </div>

      {dados.erro && <Aviso tom="erro">{dados.erro}</Aviso>}
      {!dados.dados ? <Carregando /> : <>
        {!temQod && <Aviso tom="info">Nenhum QOD lançado para esta competência (nem para meses anteriores).{gestaoGlobal ? ' Use "Baixar modelo" ou "Importar QOD" para cadastrar.' : ''} A tabela mostra só o efetivo existente.</Aviso>}
        {temQod && vigente && <p className="nota">Quando um mês não tem QOD próprio, vale o último lançado.</p>}
        <div className="kpis">
          <Kpi rotulo="Previsto (QOD)" valor={tot.p || '—'} />
          <Kpi rotulo={modo === 'pronto' ? 'Pronto' : 'Existente'} valor={tot.e} />
          <Kpi rotulo="Diferença" valor={tot.p ? (tot.e - tot.p > 0 ? '+' : '') + (tot.e - tot.p) : '—'} tom={tot.p && tot.e < tot.p ? 'alerta' : 'ok'} />
          <Kpi rotulo="Cobertura" valor={tot.p ? `${Math.round((100 * tot.e) / tot.p)}%` : '—'} />
          <Kpi rotulo="OMEs com claro" valor={temQod ? omesClaro : '—'} tom={omesClaro ? 'alerta' : undefined} />
        </div>
        {temQod && <label className="check"><input type="checkbox" checked={soComQod} onChange={(e) => setSoComQod(e.target.checked)} /> Mostrar só OMEs com QOD lançado</label>}

        {editar && gestaoGlobal && dom ? <EditorQod competencia={competencia} linhas={linhas} onSalvo={() => { setEditar(false); invalidar('qod'); invalidar('pendencias'); }} /> : (
          omes.length === 0 ? <Vazio>Sem dados.</Vazio> : (
            <div className="tabela-wrap">
              <table className="tabela compacta qod-matriz">
                <thead><tr><th>OME</th>{colunas.map((c) => <th key={c}>{c}</th>)}<th>Total</th></tr></thead>
                <tbody>
                  {omes.map((o) => {
                    const ls = visiveis.filter((l) => l.ome_id === o.id);
                    const p = ls.reduce((s, l) => s + l.previsto, 0), v = ls.reduce((s, l) => s + valor(l), 0);
                    return (
                      <tr key={o.id}>
                        <td><strong>{o.sigla}</strong></td>
                        {colunas.map((c) => {
                          const l = cel.get(`${o.id}|${c}`);
                          const vv = valor(l);
                          return <td key={c} className={classe(l?.previsto || 0, vv)} title={l ? `previsto ${l.previsto} · existente ${l.existente} · afastados ${l.afastados}` : ''}>
                            {l ? (l.previsto ? `${vv}/${l.previsto}` : vv || '') : ''}</td>;
                        })}
                        <td className={classe(p, v)}><strong>{p ? `${v}/${p}` : v}</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><td>TOTAL</td>{colunas.map((c) => {
                  const ls = visiveis.filter((l) => chaveCol(l) === c);
                  const p = ls.reduce((s, l) => s + l.previsto, 0), v = ls.reduce((s, l) => s + valor(l), 0);
                  return <td key={c} className={classe(p, v)}>{p ? `${v}/${p}` : v}</td>;
                })}<td className={classe(tot.p, tot.e)}>{tot.p ? `${tot.e}/${tot.p}` : tot.e}</td></tr></tfoot>
              </table>
              <p className="nota legenda"><span className="qod-falta">abaixo do previsto</span> <span className="qod-ok">completo</span> <span className="qod-excesso">acima do previsto</span> <span className="qod-sem">sem previsão no QOD</span> · célula = {modo}/previsto</p>
            </div>
          )
        )}

        {(hist.dados || []).length > 1 && (
          <Cartao titulo="Evolução mensal (competências fechadas)">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={(hist.dados || []).map((h) => ({ mes: fmtCompetencia(h.competencia), previsto: Number(h.previsto) || null, existente: Number(h.existente) || null }))}>
                <CartesianGrid stroke="var(--borda)" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip /><Legend />
                <Line type="monotone" dataKey="previsto" name="Previsto" stroke="#6b7280" strokeDasharray="5 4" isAnimationActive={false} />
                <Line type="monotone" dataKey="existente" name="Existente" stroke="#8f1d1d" strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Cartao>
        )}
      </>}

      <Exportar aberto={exp} onFechar={() => setExp(false)} arquivo="qod_claros" titulo="QOD — previsto × existente" subtitulo={`Competência ${fmtCompetencia(competencia)}`}
        qtd={visiveis.length} obterLinhas={async () => [...visiveis].sort((a, b) => a.ome_ordem - b.ome_ordem || a.posto_ordem - b.posto_ordem)}
        agrupamentos={[{ id: 'ome', rotulo: 'OME', fn: (r) => r.ome_sigla, ordem: (r) => String(r.ome_ordem).padStart(4, '0') }]}
        colunas={[
          { id: 'ome', titulo: 'OME', valor: (r) => r.ome_sigla, padrao: true },
          { id: 'posto', titulo: 'Posto/Grad.', valor: (r) => chaveCol(r), padrao: true },
          { id: 'previsto', titulo: 'Previsto', valor: (r) => r.previsto, padrao: true },
          { id: 'existente', titulo: 'Existente', valor: (r) => r.existente, padrao: true },
          { id: 'dif', titulo: 'Diferença', valor: (r) => r.existente - r.previsto, padrao: true },
          { id: 'afastados', titulo: 'Afastados hoje', valor: (r) => r.afastados, padrao: true },
          { id: 'pronto', titulo: 'Pronto', valor: (r) => r.existente - r.afastados, padrao: true },
          { id: 'difpronto', titulo: 'Diferença (pronto)', valor: (r) => r.existente - r.afastados - r.previsto },
        ]} />
      {importar && dom && <ImportarQod arquivo={importar} competencia={competencia} dom={dom} onFechar={() => setImportar(null)}
        onSalvo={() => { setImportar(null); invalidar('qod'); invalidar('pendencias'); toast('QOD gravado.'); }} />}
    </div>
  );
}

function EditorQod({ competencia, linhas, onSalvo }: { competencia: string; linhas: Linha[]; onSalvo: () => void }) {
  const dom = useDominios();
  const toast = useToast();
  const granulares = linhas.filter((l) => l.quadro_sigla && l.previsto);
  const inicial = useMemo(() => {
    const v: Record<string, string> = {};
    linhas.forEach((l) => { if (!l.quadro_sigla && l.previsto) v[`${l.ome_id}|${l.posto_id}`] = String(l.previsto); });
    return v;
  }, [linhas]);
  const [v, setV] = useState<Record<string, string>>(inicial);
  const [doc, setDoc] = useState('');
  const [filtro, setFiltro] = useState('');
  if (!dom) return <Carregando />;
  const omes = dom.omes.filter((o) => o.ativo && o.sigla.toLowerCase().includes(filtro.toLowerCase()));
  const salvar = async () => {
    const out = Object.entries(v).filter(([, x]) => Number(x) > 0).map(([k, x]) => { const [o, p] = k.split('|'); return { ome_id: +o, posto_id: +p, previsto: +x }; });
    granulares.forEach((g) => out.push({ ome_id: g.ome_id, posto_id: g.posto_id, quadro_sigla: g.quadro_sigla, previsto: g.previsto } as any));
    try { const n = await rpc<number>('qod_salvar', { p_competencia: competencia, p_linhas: out, p_documento: doc || null }); toast(`QOD de ${fmtCompetencia(competencia)} gravado (${n} linhas).`); onSalvo(); }
    catch (e) { toast(msgErro(e), 'erro'); }
  };
  return (
    <Cartao titulo={`Editar QOD · ${fmtCompetencia(competencia)}`} acoes={<Botao variante="primario" onClick={salvar}>Gravar QOD desta competência</Botao>}>
      <p className="nota">Os valores começam com o QOD vigente; gravar cria (ou substitui) o QOD desta competência. Células vazias = 0.{granulares.length ? ' Linhas por quadro (QOC/QOA) já lançadas são mantidas.' : ''}</p>
      <div className="filtros">
        <Campo rotulo="Filtrar OME"><input value={filtro} onChange={(e) => setFiltro(e.target.value)} /></Campo>
        <Campo rotulo="Documento (portaria / BG)"><input value={doc} onChange={(e) => setDoc(e.target.value)} /></Campo>
      </div>
      <div className="tabela-wrap">
        <table className="tabela compacta qod-editor">
          <thead><tr><th>OME</th>{dom.postos.map((p) => <th key={p.id}>{p.sigla}</th>)}<th>Total</th></tr></thead>
          <tbody>{omes.map((o) => (
            <tr key={o.id}><td><strong>{o.sigla}</strong></td>
              {dom.postos.map((p) => <td key={p.id}><input inputMode="numeric" value={v[`${o.id}|${p.id}`] || ''} onChange={(e) => setV({ ...v, [`${o.id}|${p.id}`]: e.target.value.replace(/\D/g, '') })} /></td>)}
              <td><strong>{dom.postos.reduce((s, p) => s + (Number(v[`${o.id}|${p.id}`]) || 0), 0) || ''}</strong></td></tr>
          ))}</tbody>
        </table>
      </div>
    </Cartao>
  );
}

function ImportarQod({ arquivo, competencia, dom, onFechar, onSalvo }: { arquivo: File; competencia: string; dom: NonNullable<ReturnType<typeof useDominios>>; onFechar: () => void; onSalvo: () => void }) {
  const [doc, setDoc] = useState('');
  const [salvando, setSalvando] = useState(false);
  const toast = useToast();
  const leitura = useConsulta(`qodimp|${arquivo.name}|${arquivo.lastModified}`, async () => {
    const { lerModeloQod } = await import('../lib/excel');
    const brutas = await lerModeloQod(arquivo);
    const erros: string[] = []; const linhas: any[] = [];
    for (const b of brutas) {
      const o = dom.omes.find((x) => x.sigla.toLowerCase().replace(/\s/g, '') === b.ome.toLowerCase().replace(/\s/g, ''));
      const partes = b.posto.split(/\s+/);
      const quadro = partes.length > 1 && /^Q[A-Z]{2}$/i.test(partes[partes.length - 1]) ? partes.pop()!.toUpperCase() : null;
      const sig = partes.join(' ').replace(/\s/g, '').toLowerCase();
      const p = dom.postos.find((x) => x.sigla.replace(/\s/g, '').toLowerCase() === sig);
      if (!o) { erros.push(`OME "${b.ome}" não encontrada`); continue; }
      if (!p) { erros.push(`Posto "${b.posto}" não reconhecido`); continue; }
      linhas.push({ ome_id: o.id, posto_id: p.id, quadro_sigla: quadro, previsto: b.previsto, _o: o.sigla, _p: b.posto });
    }
    return { linhas, erros: [...new Set(erros)] };
  });
  const d = leitura.dados;
  return (
    <Modal aberto largo titulo={`Importar QOD · ${fmtCompetencia(competencia)}`} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={!d?.linhas.length || salvando} onClick={async () => {
        setSalvando(true);
        try { await rpc('qod_salvar', { p_competencia: competencia, p_linhas: d!.linhas.map(({ _o, _p, ...x }: any) => x), p_documento: doc || null }); onSalvo(); }
        catch (e) { toast(msgErro(e), 'erro'); } finally { setSalvando(false); }
      }}>Gravar QOD</Botao></>}>
      {leitura.erro && <Aviso tom="erro">{leitura.erro}</Aviso>}
      {!d ? <Carregando /> : <>
        <p>{d.linhas.length} valores lidos, total previsto <strong>{d.linhas.reduce((s: number, l: any) => s + l.previsto, 0)}</strong>, em {new Set(d.linhas.map((l: any) => l.ome_id)).size} OMEs. Gravar substitui o QOD desta competência.</p>
        {d.erros.length > 0 && <Aviso tom="alerta">Ignorados: {d.erros.join('; ')}</Aviso>}
        <Campo rotulo="Documento (portaria / BG)"><input value={doc} onChange={(e) => setDoc(e.target.value)} /></Campo>
      </>}
    </Modal>
  );
}
