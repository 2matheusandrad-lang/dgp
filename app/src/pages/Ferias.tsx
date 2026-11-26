// Férias (PAF) — Portaria do Comando Geral nº 312/2025
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios, secoesDa } from '../lib/dominios';
import { mapaRegioes } from '../lib/regioes';
import { codificar } from '../lib/consultaLivre';
import { invalidar, useConsulta } from '../lib/consulta';
import { buscarTodos, exportarPdf, exportarXlsx, fmtData, fmtDataHora, hojeISO, msgErro, rpc } from '../lib/util';
import {
  MOTIVOS_ART10, MOTIVO_JA_AFASTADO, ORIGEM, STATUS, TIPO_REPROG, ativo, diasEfetivos, janela, montarImportacao, rotuloMes, somaDiasIso,
  type PeriodoImportado, type Verificacao,
} from '../lib/ferias';
import { Abas, Aviso, Badge, Botao, Campo, Cartao, Carregando, Kpi, Modal, Tabela, Vazio, useToast } from '../components/ui';
import RelatoriosFerias from './FeriasRelatorios';
import { FILTROS_VAZIOS, SITUACOES_EX, contarFiltros, passaFiltro, type FiltrosFerias } from '../lib/feriasFiltros';

type Periodo = any;
type Pessoa = { id: string; tipo: 'MILITAR' | 'CIVIL'; matricula: string; nome: string; nome_guerra?: string | null; posto_completo: string;
  posto_ordem: number; ordem_antiguidade: number | null; ome_id: number; ome_sigla: string };
const pessoaArgs = (p: { tipo?: string; tipo_pessoa?: string; id?: string; pessoa_id?: string }) => {
  const id = p.pessoa_id || p.id; const civil = (p.tipo_pessoa || p.tipo) === 'CIVIL';
  return { p_militar: civil ? null : id, p_civil: civil ? id : null };
};
const anoAtualGozo = () => { const h = new Date(); return h.getMonth() === 11 ? h.getFullYear() : h.getFullYear() - 1; };
const sobrepoe = (p: Periodo, ini: string, fim: string) => p.data_inicio <= fim && p.data_fim >= ini;
const fimMesIso = (iso: string) => { const [a, m] = iso.split('-').map(Number); return `${iso.slice(0, 8)}${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`; };
const recarregarTudo = () => { invalidar('ferias'); invalidar('pendencias'); invalidar('painel'); invalidar('efetivo'); };
const useExercicios = () => useConsulta('ferias|ex', async () => {
  const { data, error } = await supabase.from('ferias_exercicio').select('*').order('ano', { ascending: false });
  if (error) throw error; return data || [];
}, 60_000);
const rotuloEx = (e: any) => `PAF ${e.ano} · gozo de 01/12/${e.ano} a 31/12/${e.ano + 1} · ${e.situacao === 'PUBLICADO' ? 'publicado' : 'em elaboração'}`;

export default function Ferias() {
  const { gestaoGlobal, podeEditarAlguma, escopo } = useAuth();
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba') || 'quadro';
  const setAba = (a: string) => setParams(new URLSearchParams({ aba: a }), { replace: true });
  const ex = useExercicios();
  const [ano, setAno] = useState<number | null>(null);
  const [rel, setRel] = useState(false);
  // filtros do quadro e região do resumo ficam aqui: os relatórios partem do que está na tela
  const [filtros, setFiltros] = useState<FiltrosFerias>(FILTROS_VAZIOS);
  const [regiaoTela, setRegiaoTela] = useState('');
  useEffect(() => { setFiltros((f) => (f.secao ? { ...f, secao: '' } : f)); }, [escopo]);
  useEffect(() => {
    if (ano || !ex.dados?.length) return;
    const atual = anoAtualGozo();
    const emElab = ex.dados.find((e: any) => e.situacao === 'ELABORACAO');
    setAno((ex.dados.find((e: any) => e.ano === atual) || emElab || ex.dados[0]).ano);
  }, [ex.dados, ano]);
  const exercicio = ex.dados?.find((e: any) => e.ano === ano);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Férias (PAF)</h1>
          <p className="sub">Portaria do Comando Geral nº 312/2025{ano ? ` · exercício ${ano}: gozo de 01/12/${ano} a 31/12/${ano + 1}` : ' · nenhum exercício cadastrado ainda'}{exercicio ? ` · ${exercicio.situacao === 'PUBLICADO' ? `publicado${exercicio.publicacao ? ` (${exercicio.publicacao})` : ''}` : `em elaboração${exercicio.prazo_ome ? `, prazo da OME ${fmtData(exercicio.prazo_ome)}` : ''}`}` : ''}</p>
        </div>
        <div className="acoes">
          {ex.dados && ex.dados.length > 0 && (
            <select aria-label="Exercício do PAF" value={ano ?? ''} onChange={(e) => setAno(Number(e.target.value))}>
              {ex.dados.map((e: any) => <option key={e.ano} value={e.ano}>PAF {e.ano}{e.situacao === 'ELABORACAO' ? ' (em elaboração)' : ''}</option>)}
            </select>
          )}
          {exercicio && <Botao onClick={() => setRel(true)}>Relatórios</Botao>}
        </div>
      </div>
      {!gestaoGlobal && <p className="nota so-dgp">Consulta: o PAF, as reprogramações e o cadastro de servidores civis são lançados e alterados somente pela DGP.</p>}
      <Abas ativa={aba} onChange={setAba} abas={[
        { id: 'quadro', rotulo: 'Quadro de férias' },
        { id: 'reprogramacoes', rotulo: 'Reprogramações' },
        { id: 'pendencias', rotulo: 'Pendências' },
        { id: 'civis', rotulo: 'Servidores civis' },
        ...(gestaoGlobal ? [{ id: 'exercicios', rotulo: 'Exercícios e regras' }, { id: 'importar', rotulo: 'Importar planilha' }] : []),
      ]} />
      {ex.erro && <Aviso tom="erro">{ex.erro}</Aviso>}
      {!ex.dados ? <Carregando /> : !ex.dados.length && aba !== 'exercicios' && aba !== 'importar' ? (
        <Aviso tom="info">Nenhum exercício do PAF cadastrado ainda.{gestaoGlobal ? ' Abra o exercício em "Exercícios e regras" ou importe a planilha atual em "Importar planilha".' : ' A DGP abre o exercício e avisa as OMEs.'}</Aviso>
      ) : <>
        {aba === 'quadro' && exercicio && <Quadro exercicio={exercicio} f={filtros} setF={setFiltros} regiao={regiaoTela} setRegiao={setRegiaoTela} />}
        {aba === 'reprogramacoes' && <Reprogramacoes />}
        {aba === 'pendencias' && exercicio && <Pendencias exercicio={exercicio} />}
        {aba === 'civis' && <Civis />}
        {aba === 'exercicios' && gestaoGlobal && <Exercicios exercicios={ex.dados} />}
        {aba === 'importar' && gestaoGlobal && <Importar />}
      </>}
      {rel && exercicio && <RelatoriosFerias exercicio={exercicio} filtrosTela={aba === 'quadro' ? filtros : FILTROS_VAZIOS} regiaoTela={aba === 'quadro' && !escopo ? regiaoTela : ''} onFechar={() => setRel(false)} />}
    </div>
  );
}

// ======================================================================= dados comuns
function usePessoas(ome: number | null) {
  return useConsulta(`ferias|pessoas|${ome}`, async () => {
    const [mil, civ] = await Promise.all([
      buscarTodos(() => {
        let q = supabase.from('v_militar').select('id,matricula,nome,nome_guerra,posto_completo,posto_sigla,posto_ordem,ordem_antiguidade,ome_id,ome_sigla,quadro_sigla,oficial,secao_id,ano_ingresso')
          .eq('situacao', 'ATIVO').order('posto_ordem').order('quadro_sigla', { ascending: false, nullsFirst: true }).order('ordem_antiguidade', { nullsFirst: false }).order('id');
        if (ome) q = q.eq('ome_id', ome);
        return q;
      }),
      (async () => {
        let q = supabase.from('servidor_civil').select('id,matricula,nome,ome_id').eq('ativo', true).order('nome');
        if (ome) q = q.eq('ome_id', ome);
        const { data, error } = await q; if (error) throw error; return data || [];
      })(),
    ]);
    return [
      ...mil.map((m: any) => ({ ...m, tipo: 'MILITAR' as const })),
      ...civ.map((c: any) => ({ ...c, tipo: 'CIVIL' as const, posto_completo: 'Civil', posto_ordem: 99, ordem_antiguidade: null, ome_sigla: '' })),
    ] as Pessoa[];
  }, 120_000);
}
function usePeriodos(ome: number | null, ini: string, fim: string) {
  return useConsulta(`ferias|periodos|${ome}|${ini}|${fim}`, () => buscarTodos<Periodo>(() => {
    let q = supabase.from('v_ferias').select('*').lte('data_inicio', fim).gte('data_fim', ini).order('data_inicio').order('id');
    if (ome) q = q.eq('ome_id', ome);
    return q;
  }), 60_000);
}
const useOmesEnsino = () => useConsulta('ferias|ensino', async () => {
  const { data } = await supabase.from('ome').select('id, orgao_ensino'); return new Set((data || []).filter((o: any) => o.orgao_ensino).map((o: any) => o.id as number));
}, 300_000);

// ======================================================================= quadro
function Quadro({ exercicio, f, setF, regiao, setRegiao }: { exercicio: any; f: FiltrosFerias; setF: (f: FiltrosFerias) => void; regiao: string; setRegiao: (r: string) => void }) {
  const { escopo, setEscopo, gestaoGlobal } = useAuth();
  const meses = janela(exercicio.ano);
  const ini = meses[0], fim = fimMesIso(meses[12]);
  const pessoas = usePessoas(escopo);
  const periodos = usePeriodos(escopo, ini, fim);
  const ensino = useOmesEnsino();
  const muda = (k: keyof FiltrosFerias, v: string) => setF({ ...f, [k]: v });
  const [aberta, setAberta] = useState<Pessoa | null>(null);
  const [buscar, setBuscar] = useState(false);
  const dom = useDominios();
  const nav = useNavigate();
  if (pessoas.erro || periodos.erro) return <Aviso tom="erro">{pessoas.erro || periodos.erro}</Aviso>;
  if (!pessoas.dados || !periodos.dados) return <Carregando />;

  const vigentes = periodos.dados.filter(ativo);
  const porPessoa = new Map<string, Periodo[]>();
  for (const p of vigentes) { const k = p.pessoa_id; if (!porPessoa.has(k)) porPessoa.set(k, []); porPessoa.get(k)!.push(p); }
  const diasEx = (id: string) => (porPessoa.get(id) || []).filter((p) => p.exercicio === exercicio.ano).reduce((s, p) => s + diasEfetivos(p), 0);

  if (!escopo) return <ResumoOmes exercicio={exercicio} pessoas={pessoas.dados} periodos={vigentes} ensino={ensino.dados} onOme={setEscopo} fReg={regiao} setFReg={setRegiao} />;

  const efetivo = pessoas.dados.length;
  const limite = ensino.dados?.has(escopo) ? null : Math.max(1, Math.floor(efetivo * 0.1));
  const contagem = meses.map((m) => new Set(vigentes.filter((p) => sobrepoe(p, m, fimMesIso(m))).map((p) => p.pessoa_id)).size);
  const linhas = pessoas.dados.filter((p: any) => passaFiltro(p, porPessoa.get(p.id) || [], exercicio.ano, f));
  const postosPres = [...new Map(pessoas.dados.map((p: any) => [p.tipo === 'CIVIL' ? 'CIVIL' : p.posto_sigla, p.tipo === 'CIVIL' ? 99 : p.posto_ordem])).entries()].sort((a, b) => a[1] - b[1]);
  const anosIngresso = [...new Set(pessoas.dados.map((p: any) => p.ano_ingresso).filter(Boolean))].sort((a: any, b: any) => b - a);
  const filtrosAtivos = contarFiltros(f);
  const sem = pessoas.dados.filter((p) => diasEx(p.id) === 0).length;
  const incompletos = pessoas.dados.filter((p) => { const d = diasEx(p.id); return d > 0 && d < 30; }).length;
  const excedidos = limite ? contagem.filter((c) => c > limite).length : 0;
  const editavel = gestaoGlobal;   // férias: só a DGP lança e altera (1.4.1)

  return <>
    <div className="kpis">
      <Kpi rotulo="Efetivo da OME" valor={efetivo} detalhe={limite ? `limite mensal de férias: ${limite} (10%, art. 5º)` : 'órgão de ensino: sem limite de 10%'} />
      <Kpi rotulo={`Com férias do PAF ${exercicio.ano}`} valor={efetivo - sem} detalhe={`${incompletos} com menos de 30 dias`} />
      <Kpi rotulo="Sem previsão" valor={sem} tom={sem ? 'alerta' : 'ok'} onClick={() => muda('so', 'sem')} />
      <Kpi rotulo="Meses acima do limite" valor={excedidos} tom={excedidos ? 'alerta' : 'ok'} />
    </div>
    <div className="filtros">
      <Campo rotulo="Buscar"><input placeholder="Nome ou matrícula" value={f.busca} onChange={(e) => muda('busca', e.target.value)} /></Campo>
      <Campo rotulo="Situação no exercício">
        <select value={f.so} onChange={(e) => muda('so', e.target.value)}>
          {SITUACOES_EX.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Posto/grad.">
        <select value={f.posto} onChange={(e) => muda('posto', e.target.value)}>
          <option value="">Todos</option>{postosPres.map(([k]) => <option key={k} value={k}>{k === 'CIVIL' ? 'Servidores civis' : k}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Quadro">
        <select value={f.quadro} onChange={(e) => muda('quadro', e.target.value)}>
          <option value="">Todos</option>{dom?.quadros.map((q) => <option key={q.sigla} value={q.sigla}>{q.sigla}</option>)}<option value="PRACA">Praças</option>
        </select>
      </Campo>
      <Campo rotulo="Seção">
        <select value={f.secao} onChange={(e) => muda('secao', e.target.value)}>
          <option value="">Todas</option><option value="-">(sem seção)</option>{secoesDa(dom, escopo).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Ano de ingresso">
        <select value={f.ingresso} onChange={(e) => muda('ingresso', e.target.value)}>
          <option value="">Todos</option>{anosIngresso.map((a: any) => <option key={a} value={a}>{a}</option>)}
        </select>
      </Campo>
      <Campo rotulo="De férias em">
        <select value={f.mes} onChange={(e) => muda('mes', e.target.value)}>
          <option value="">Qualquer mês</option>{meses.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
        </select>
      </Campo>
      <div className="acoes fim">
        {filtrosAtivos > 0 && <button className="link" onClick={() => setF(FILTROS_VAZIOS)}>limpar filtros</button>}
        <Botao onClick={() => nav(`/consultas?q=${codificar({ assunto: 'ferias', filtros: [{ campo: 'exercicio', op: 'in', valor: [String(exercicio.ano)] }, { campo: 'm.ome', op: 'in', valor: [dom?.omes.find((o) => o.id === escopo)?.sigla || ''] }], modo: 'E', linhas: 'mes', colunas: 'status', medida: 'pessoas' })}`)}>Analisar nas consultas</Botao>
        {editavel && <Botao variante="primario" onClick={() => setBuscar(true)}>+ Incluir férias</Botao>}
      </div>
    </div>
    <div className="legenda ferias-legenda">
      {['PROPOSTA', 'A_GOZAR', 'EM_GOZO', 'GOZADA', 'INTERROMPIDA'].map((s) => <span key={s} className={`fchip f-${s}`}>{STATUS[s].rotulo}</span>)}
      <span className="fchip f-outro">outro exercício</span>
      <span className="nota">{filtrosAtivos ? `${linhas.length} de ${pessoas.dados.length} pessoas · ` : ''}{editavel ? 'Clique numa linha (ou Enter) para incluir, reprogramar ou interromper.' : 'Clique numa linha para ver os períodos.'}</span>
    </div>
    <div className="tabela-wrap">
      <table className="tabela compacta ferias-grade">
        <thead><tr><th className="fix">Militar / servidor</th>{meses.map((m) => <th key={m}>{rotuloMes(m)}</th>)}<th>Dias</th></tr></thead>
        <tbody>
          {linhas.map((p) => {
            const ps = porPessoa.get(p.id) || [];
            const d = diasEx(p.id);
            return (
              <tr key={p.id} className="clicavel" tabIndex={0} aria-label={`${p.posto_completo} ${p.nome}: ${d} dias no PAF ${exercicio.ano}`}
                onClick={() => setAberta(p)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAberta(p); } }}>
                <td className="fix"><strong>{p.posto_completo}</strong> {p.nome_guerra || p.nome}</td>
                {meses.map((m) => {
                  const f = fimMesIso(m);
                  const aqui = ps.filter((x) => sobrepoe(x, m, f));
                  return <td key={m} className="fcel">{aqui.map((x) => (
                    <span key={x.id} title={`${fmtData(x.data_inicio)} a ${fmtData(x.data_fim)} · ${x.dias} dias · PAF ${x.exercicio} · ${STATUS[x.status]?.rotulo}${x.data_estimada ? ' · dia estimado' : ''}`}
                      className={`fchip f-${x.exercicio === exercicio.ano ? x.status : 'outro'}${x.data_estimada ? ' estimada' : ''}`}>
                      {x.data_inicio < m ? '1' : Number(x.data_inicio.slice(8))}–{x.data_fim > f ? f.slice(8) : Number(x.data_fim.slice(8))}
                    </span>))}</td>;
                })}
                <td className={d === 30 ? 'ok' : d > 30 ? 'qod-excesso' : d ? 'qod-falta' : 'qod-sem'}>{d || '—'}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td className="fix">Em férias no mês{limite ? ` (limite ${limite})` : ''}</td>
          {contagem.map((c, i) => <td key={i} className={limite && c > limite ? 'qod-falta' : ''}>{c}</td>)}<td /></tr></tfoot>
      </table>
    </div>
    {aberta && <PessoaFerias pessoa={aberta} exercicio={exercicio} editavel={editavel} onFechar={() => setAberta(null)} />}
    {buscar && <EscolherPessoa pessoas={pessoas.dados} onFechar={() => setBuscar(false)} onEscolher={(p) => { setBuscar(false); setAberta(p); }} />}
  </>;
}

function ResumoOmes({ exercicio, pessoas, periodos, ensino, onOme, fReg, setFReg }: { exercicio: any; pessoas: Pessoa[]; periodos: Periodo[]; ensino?: Set<number>; onOme: (id: number) => void; fReg: string; setFReg: (r: string) => void }) {
  const dom = useDominios();
  const nav = useNavigate();
  const meses = janela(exercicio.ano);
  const regioes = useMemo(() => mapaRegioes(dom), [dom]);
  const linhas = useMemo(() => {
    const m = new Map<number, any>();
    for (const p of pessoas) {
      const o = m.get(p.ome_id) || { ome_id: p.ome_id, sigla: dom?.omes.find((x) => x.id === p.ome_id)?.sigla || p.ome_sigla, efetivo: 0, dias: new Map<string, number>() };
      o.efetivo++; m.set(p.ome_id, o);
    }
    for (const x of periodos) if (x.exercicio === exercicio.ano) { const o = m.get(x.ome_id); if (o) o.dias.set(x.pessoa_id, (o.dias.get(x.pessoa_id) || 0) + diasEfetivos(x)); }
    return [...m.values()].map((o) => {
      const lim = ensino?.has(o.ome_id) ? null : Math.max(1, Math.floor(o.efetivo * 0.1));
      const doOme = periodos.filter((x) => x.ome_id === o.ome_id);
      const acima = lim ? meses.filter((mm) => new Set(doOme.filter((x) => sobrepoe(x, mm, fimMesIso(mm))).map((x) => x.pessoa_id)).size > lim).length : 0;
      const completos = [...o.dias.values()].filter((d) => d >= 30).length;
      const gozadas = doOme.filter((x) => x.exercicio === exercicio.ano && (x.status === 'GOZADA' || x.status === 'INTERROMPIDA') && x.previsto_inicio);
      const noMes = gozadas.filter((x) => x.previsto_inicio.slice(0, 7) === x.data_inicio.slice(0, 7)).length;
      return { ...o, regiao: regioes.de(o.ome_id).rotulo, completos, sem: o.efetivo - o.dias.size, acima, pct: o.efetivo ? Math.round((100 * completos) / o.efetivo) : 0,
        aderencia: gozadas.length ? Math.round((100 * noMes) / gozadas.length) : null };
    }).sort((a, b) => a.pct - b.pct);
  }, [pessoas, periodos, ensino, dom, exercicio.ano, regioes]); // eslint-disable-line
  const visiveis = linhas.filter((r: any) => !fReg || r.regiao === fReg);
  const temRegioes = !!dom?.omes.some((o) => o.regional);
  return <>
    <div className="filtros">
      {temRegioes && <Campo rotulo="Região"><select value={fReg} onChange={(e) => setFReg(e.target.value)}>
        <option value="">Todas</option>{regioes.lista.map((r) => <option key={r.rotulo} value={r.rotulo}>{r.rotulo}</option>)}
      </select></Campo>}
      <div className="acoes fim">
        <Botao onClick={() => nav(`/consultas?q=${codificar({ assunto: 'ferias', filtros: [{ campo: 'exercicio', op: 'in', valor: [String(exercicio.ano)] }], modo: 'E', linhas: 'm.regiao', colunas: 'status', medida: 'pessoas', pct: 'linha' })}`)}>Analisar nas consultas</Botao>
      </div>
    </div>
    <p className="nota">Visão de todas as OMEs. Clique numa OME para abrir o quadro de férias dela. "Gozo no mês planejado" compara, nas parcelas já gozadas, o mês de início com o mês do plano.</p>
    <Tabela linhas={visiveis} chave={(r: any) => String(r.ome_id)} porPagina={60} onLinha={(r: any) => onOme(r.ome_id)} colunas={[
      { id: 'sigla', titulo: 'OME' }, ...(temRegioes ? [{ id: 'regiao', titulo: 'Região' }] : []), { id: 'efetivo', titulo: 'Efetivo' },
      { id: 'completos', titulo: '30 dias programados' },
      { id: 'pct', titulo: '% completo', render: (r: any) => <span className="completude"><span className="completude-barra"><i style={{ width: `${r.pct}%` }} className={r.pct < 100 ? 'media' : ''} /></span>{r.pct}%</span> },
      { id: 'sem', titulo: 'Sem previsão', render: (r: any) => (r.sem ? <Badge tom="amarelo">{r.sem}</Badge> : '0') },
      { id: 'acima', titulo: 'Meses acima de 10%', render: (r: any) => (r.acima ? <Badge tom="vermelho">{r.acima}</Badge> : '0') },
      { id: 'aderencia', titulo: 'Gozo no mês planejado', valor: (r: any) => r.aderencia ?? -1, render: (r: any) => (r.aderencia == null ? <span className="nota">—</span> : `${r.aderencia}%`) },
    ]} />
  </>;
}

// ======================================================================= pessoa
function EscolherPessoa({ pessoas, onFechar, onEscolher }: { pessoas: Pessoa[]; onFechar: () => void; onEscolher: (p: Pessoa) => void }) {
  const [q, setQ] = useState('');
  const n = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const achados = n.length < 2 ? [] : pessoas.filter((p) => `${p.nome} ${p.nome_guerra || ''} ${p.matricula}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(n)).slice(0, 30);
  return (
    <Modal aberto titulo="Incluir férias: escolha o militar ou servidor" onFechar={onFechar} rodape={<Botao onClick={onFechar}>Cancelar</Botao>}>
      <Campo rotulo="Buscar" dica="Nome, nome de guerra ou matrícula (mínimo 2 letras)">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && achados[0]) onEscolher(achados[0]); }} />
      </Campo>
      <ul className="lista-escolha" role="listbox" aria-label="Resultados">
        {achados.map((p) => <li key={p.id}><button className="link" onClick={() => onEscolher(p)}><strong>{p.posto_completo}</strong> {p.nome} <span className="nota">· {p.matricula}{p.ome_sigla ? ` · ${p.ome_sigla}` : ''}</span></button></li>)}
        {n.length >= 2 && !achados.length && <li className="nota">Ninguém encontrado nesta OME.</li>}
      </ul>
    </Modal>
  );
}

type Acao = '' | 'proposta' | 'incluir' | 'reprogramar' | 'interromper';
function PessoaFerias({ pessoa, exercicio, editavel, onFechar }: { pessoa: Pessoa; exercicio: any; editavel: boolean; onFechar: () => void }) {
  const { gestaoGlobal } = useAuth();
  const toast = useToast();
  const exs = useExercicios();
  const [anoRef, setAnoRef] = useState<number>(exercicio.ano);
  const exRef = exs.dados?.find((e: any) => e.ano === anoRef) || exercicio;
  const col = pessoa.tipo === 'CIVIL' ? 'civil_id' : 'militar_id';
  const lista = useConsulta(`ferias|pessoa|${pessoa.id}`, async () => {
    const [p, r] = await Promise.all([
      supabase.from('v_ferias').select('*').eq(col, pessoa.id).order('data_inicio'),
      supabase.from('v_ferias_reprogramacao').select('*').eq(col, pessoa.id).order('solicitado_em', { ascending: false }),
    ]);
    if (p.error) throw p.error; if (r.error) throw r.error;
    return { periodos: p.data || [], reprog: r.data || [] };
  }, 10_000);
  const [modo, setModo] = useState<Acao>('');
  const [naoGozada, setNaoGozada] = useState<any>(null);
  if (!lista.dados) return <Modal aberto largo titulo={`${pessoa.posto_completo} ${pessoa.nome}`} onFechar={onFechar}><Carregando /></Modal>;
  const doEx = lista.dados.periodos.filter((p: any) => p.exercicio === exRef.ano);
  const vig = doEx.filter(ativo);
  const dias = vig.reduce((s: number, p: any) => s + diasEfetivos(p), 0);
  const hoje = hojeISO();
  const futuros = doEx.filter((p: any) => p.situacao === 'PROGRAMADA' && p.data_inicio > hoje);
  const emGozo = doEx.filter((p: any) => p.situacao === 'PROGRAMADA' && p.data_inicio <= hoje && p.data_fim >= hoje);
  const pendente = lista.dados.reprog.find((r: any) => r.status === 'AGUARDANDO_DGP' && r.exercicio === exRef.ano);
  const exercicios = [...new Set<number>(lista.dados.periodos.map((p: any) => p.exercicio))].sort((a, b) => b - a);
  const mudou = () => { lista.recarregar(); recarregarTudo(); };
  const publicado = exRef.situacao === 'PUBLICADO';
  const voltar = () => setModo('');
  const feito = () => { setModo(''); mudou(); };

  if (modo === 'proposta') return <EditorProposta pessoa={pessoa} exercicio={exRef} atuais={vig} onFechar={voltar} onFeito={feito} />;
  if (modo === 'incluir') return <EditorInclusao pessoa={pessoa} exercicio={exRef} diasAtuais={dias} onFechar={voltar} onFeito={feito} />;
  if (modo === 'reprogramar' || modo === 'interromper') return <EditorReprogramacao pessoa={pessoa} exercicio={exRef} periodos={doEx} inicial={modo === 'interromper' ? 'INTERRUPCAO' : 'A_PEDIDO'} onFechar={voltar} onFeito={feito} />;

  return (
    <Modal aberto largo titulo={`${pessoa.posto_completo} ${pessoa.nome} · ${pessoa.matricula}`} onFechar={onFechar}
      rodape={<>
        <Botao onClick={onFechar}>Fechar</Botao>
        {editavel && !publicado && <Botao variante="primario" onClick={() => setModo('proposta')}>{vig.length ? 'Alterar períodos da proposta' : 'Incluir períodos na proposta'}</Botao>}
        {editavel && publicado && <>
          {emGozo.length > 0 && !pendente && <Botao onClick={() => setModo('interromper')}>Interromper</Botao>}
          {futuros.length > 0 && !pendente && <Botao onClick={() => setModo('reprogramar')}>Reprogramar</Botao>}
          <Botao variante="primario" onClick={() => setModo('incluir')}>Incluir período</Botao>
        </>}
      </>}>
      <div className="form-grade">
        <Campo rotulo="PAF de referência" largura="meia" dica="As ações abaixo valem para este exercício">
          <select value={anoRef} onChange={(e) => setAnoRef(Number(e.target.value))}>
            {(exs.dados || [exercicio]).map((e: any) => <option key={e.ano} value={e.ano}>{rotuloEx(e)}</option>)}
          </select>
        </Campo>
      </div>
      <div className="mini-kpis">
        <div><strong>{dias}</strong><span>dias no PAF {exRef.ano}</span></div>
        <div><strong>{Math.max(0, 30 - dias)}</strong><span>saldo</span></div>
        <div><strong>{vig.length}</strong><span>período(s)</span></div>
      </div>
      {pendente && <Aviso tom="info">Há reprogramação do PAF {exRef.ano} aguardando homologação (pedida em {fmtDataHora(pendente.solicitado_em)}): decida em Férias &gt; Reprogramações.</Aviso>}
      {editavel && <p className="nota">{publicado
        ? `PAF ${exRef.ano} publicado: inclua períodos (com publicação ou SEI), reprograme os que ainda não começaram ou interrompa o que está em gozo. Tudo fica registrado.`
        : `PAF ${exRef.ano} em elaboração: os períodos entram como proposta e viram programados quando o PAF for publicado.`}</p>}
      {exercicios.length === 0 ? <Vazio>Nenhum período de férias lançado.</Vazio> : exercicios.map((e) => (
        <div key={e} className="ferias-ex">
          <h4>PAF {e}</h4>
          <Tabela linhas={lista.dados!.periodos.filter((p: any) => p.exercicio === e)} chave={(r: any) => r.id} compacta porPagina={20} colunas={[
            { id: 'parcela', titulo: 'Parcela', render: (r: any) => (r.parcela ? `${r.parcela}ª` : '—') },
            { id: 'data_inicio', titulo: 'Início', render: (r: any) => <>{fmtData(r.data_inicio)}{r.data_estimada && <Badge tom="amarelo" title="Importado só com o mês previsto">dia estimado</Badge>}</> },
            { id: 'data_fim', titulo: 'Fim', render: (r: any) => fmtData(r.data_fim) },
            { id: 'dias', titulo: 'Dias', render: (r: any) => (r.situacao === 'INTERROMPIDA' ? `${r.dias_gozados} de ${r.dias}` : r.dias) },
            { id: 'status', titulo: 'Situação', render: (r: any) => <Badge tom={STATUS[r.status]?.tom}>{STATUS[r.status]?.rotulo}</Badge> },
            { id: 'origem', titulo: 'Origem', render: (r: any) => <span className="nota">{ORIGEM[r.origem] || r.origem}</span> },
            { id: 'doc', titulo: 'Publicação / SEI', ordenavel: false, render: (r: any) => <span className="nota">{[r.publicacao, r.processo_sei].filter(Boolean).join(' · ')}</span> },
            { id: 'exc', titulo: '', ordenavel: false, render: (r: any) => r.excecao ? <Badge tom={r.excecao_aprovada_por ? 'azul' : 'amarelo'} title={r.excecao}>{r.excecao_aprovada_por ? 'exceção autorizada' : 'exceção pendente'}</Badge> : null },
            ...(gestaoGlobal ? [{ id: 'acoes', titulo: '', ordenavel: false, render: (r: any) => <span className="acoes-linha" onClick={(ev) => ev.stopPropagation()}>
              {r.situacao === 'PROGRAMADA' && <Botao pequeno variante="fantasma" onClick={() => setNaoGozada(r)}>Não gozada</Botao>}
              {(r.situacao === 'PROPOSTA' || r.origem === 'IMPORTACAO' || r.origem === 'INCLUSAO') && <Botao pequeno variante="fantasma" onClick={async () => {
                if (!confirm('Excluir este período? A exclusão fica no histórico.')) return;
                try { await rpc('ferias_excluir_periodo', { p_id: r.id }); toast('Período excluído.'); mudou(); } catch (err) { toast(msgErro(err), 'erro'); }
              }}>Excluir</Botao>}
            </span> }] : []),
          ]} />
        </div>
      ))}
      {lista.dados.reprog.length > 0 && <>
        <h4>Reprogramações</h4>
        <Tabela linhas={lista.dados.reprog} chave={(r: any) => r.id} compacta colunas={[
          { id: 'solicitado_em', titulo: 'Registro', render: (r: any) => fmtDataHora(r.solicitado_em) },
          { id: 'exercicio', titulo: 'PAF' },
          { id: 'tipo', titulo: 'Tipo', render: (r: any) => TIPO_REPROG[r.tipo] },
          { id: 'novos', titulo: 'Novo período', ordenavel: false, render: (r: any) => (r.novos || []).map((n: any) => `${fmtData(n.inicio)} (${n.dias}d)`).join(', ') },
          { id: 'status', titulo: 'Situação', render: (r: any) => <><Badge tom={r.status === 'HOMOLOGADA' ? 'verde' : r.status === 'DEVOLVIDA' ? 'vermelho' : r.status === 'CANCELADA' ? 'neutro' : 'amarelo'}>{r.status.replace('_', ' ').toLowerCase()}</Badge>{r.publicacao_dgp && <div className="nota">{r.publicacao_dgp}</div>}{r.resposta && <div className="nota">{r.resposta}</div>}</> },
        ]} />
      </>}
      {naoGozada && <NaoGozada periodo={naoGozada} onFechar={() => setNaoGozada(null)} onFeito={() => { setNaoGozada(null); mudou(); }} />}
    </Modal>
  );
}

function NaoGozada({ periodo, onFechar, onFeito }: { periodo: any; onFechar: () => void; onFeito: () => void }) {
  const [pub, setPub] = useState(''); const [mot, setMot] = useState(''); const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal aberto titulo="Registrar férias não gozadas (art. 9º)" onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="perigo" onClick={async () => {
        try { await rpc('ferias_nao_gozada', { p_id: periodo.id, p_publicacao: pub, p_motivo: mot }); onFeito(); } catch (e) { setErro(msgErro(e)); }
      }}>Registrar</Botao></>}>
      <p>{fmtData(periodo.data_inicio)} a {fmtData(periodo.data_fim)} · {periodo.dias} dias · PAF {periodo.exercicio}</p>
      <p className="nota">Só valem como não gozadas as férias interrompidas ou não gozadas nos casos dos arts. 10 e 11, com registro em veículo oficial (art. 9º).</p>
      <div className="form-grade">
        <Campo rotulo="Publicação *" dica="BGE / DOE / BI"><input value={pub} onChange={(e) => setPub(e.target.value)} /></Campo>
        <Campo rotulo="Motivo *" largura="meia"><select value={mot} onChange={(e) => setMot(e.target.value)}><option value="">Selecione</option>{MOTIVOS_ART10.map((m) => <option key={m}>{m}</option>)}</select></Campo>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

// ======================================================================= escolha de períodos
type Novo = { inicio: string; dias: number };
function SeletorPeriodos({ ano, valor, onChange, livre }: { ano: number; valor: Novo[]; onChange: (v: Novo[]) => void; livre?: boolean }) {
  const meses = janela(ano);
  const modoInicial = valor.length === 2 && valor.every((v) => v.dias === 15) ? '2x15' : valor.length === 1 && valor[0].dias === 30 ? '30' : valor.length ? 'livre' : '30';
  const [modo, setModo] = useState<'30' | '2x15' | 'livre'>(livre && modoInicial !== '30' && modoInicial !== '2x15' ? 'livre' : modoInicial as any);
  const lin = valor.length ? valor : [{ inicio: meses[1], dias: 30 }];
  const trocarModo = (m: typeof modo) => {
    setModo(m);
    if (m === '30') onChange([{ inicio: lin[0].inicio.slice(0, 8) + (lin[0].inicio.slice(8) === '16' ? '16' : '01'), dias: 30 }]);
    if (m === '2x15') onChange([{ inicio: lin[0].inicio.slice(0, 8) + '01', dias: 15 }, { inicio: (lin[1]?.inicio || lin[0].inicio).slice(0, 8) + '16', dias: 15 }]);
    if (m === 'livre') onChange(lin);
  };
  const setI = (i: number, k: 'mes' | 'dia' | 'inicio' | 'dias', v: string) => {
    const n = lin.map((x) => ({ ...x }));
    if (k === 'mes') n[i].inicio = v.slice(0, 8) + n[i].inicio.slice(8);
    if (k === 'dia') n[i].inicio = n[i].inicio.slice(0, 8) + v;
    if (k === 'inicio') n[i].inicio = v;
    if (k === 'dias') n[i].dias = Number(v) || 0;
    onChange(n);
  };
  return (
    <div className="seletor-ferias">
      <div className="radios">
        <label className="check"><input type="radio" checked={modo === '30'} onChange={() => trocarModo('30')} /> 30 dias</label>
        <label className="check"><input type="radio" checked={modo === '2x15'} onChange={() => trocarModo('2x15')} /> 2 períodos de 15 dias</label>
        {livre && <label className="check"><input type="radio" checked={modo === 'livre'} onChange={() => trocarModo('livre')} /> Outra data (exceção ou restante de interrupção)</label>}
      </div>
      {lin.map((v, i) => (
        <div key={i} className="form-grade">
          {modo !== 'livre' ? <>
            <Campo rotulo={modo === '2x15' ? `${i + 1}º período: mês` : 'Mês'}>
              <select value={v.inicio.slice(0, 8) + '01'} onChange={(e) => setI(i, 'mes', e.target.value)}>
                {meses.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Início" dica="Dia 1º ou 16 (art. 2º, II)">
              <select value={v.inicio.slice(8)} onChange={(e) => setI(i, 'dia', e.target.value)}><option value="01">dia 1º</option><option value="16">dia 16</option></select>
            </Campo>
            <Campo rotulo="Término"><input disabled value={fmtData(somaDiasIso(v.inicio, v.dias - 1))} /></Campo>
          </> : <>
            <Campo rotulo={`Período ${i + 1}: início`}><input type="date" value={v.inicio} onChange={(e) => setI(i, 'inicio', e.target.value)} /></Campo>
            <Campo rotulo="Dias"><input type="number" min={1} max={30} value={v.dias} onChange={(e) => setI(i, 'dias', e.target.value)} /></Campo>
            <Campo rotulo="Término"><input disabled value={v.inicio && v.dias ? fmtData(somaDiasIso(v.inicio, v.dias - 1)) : ''} /></Campo>
            <div className="campo"><span className="campo-rotulo">&nbsp;</span><button className="link" onClick={() => onChange(lin.filter((_, j) => j !== i))}>remover</button></div>
          </>}
        </div>
      ))}
      {modo === 'livre' && <button className="link" onClick={() => onChange([...lin, { inicio: lin[lin.length - 1]?.inicio || meses[1], dias: 15 }])}>+ período</button>}
    </div>
  );
}

function useVerificacao(args: Record<string, any> | null) {
  const [v, setV] = useState<Verificacao[] | null>(null);
  const t = useRef<any>(null);
  const chave = JSON.stringify(args);
  useEffect(() => {
    if (!args) { setV(null); return; }
    clearTimeout(t.current);
    t.current = setTimeout(() => { rpc<Verificacao[]>('ferias_verificar', args).then(setV).catch((e) => setV([{ codigo: 'erro', nivel: 'bloqueio', msg: msgErro(e) }])); }, 350);
    return () => clearTimeout(t.current);
  }, [chave]); // eslint-disable-line
  return v;
}
function ListaVerificacoes({ v }: { v: Verificacao[] | null }) {
  if (!v) return <p className="nota">Conferindo as regras da Portaria 312…</p>;
  if (!v.length) return <Aviso tom="ok">Atende às regras da Portaria 312.</Aviso>;
  return (
    <ul className="verificacoes">
      {v.map((x, i) => <li key={i} className={`ver-${x.nivel}`}><strong>{x.nivel === 'bloqueio' ? 'Fora da regra' : x.nivel === 'alerta' ? 'Atenção' : 'Informação'}:</strong> {x.msg}</li>)}
    </ul>
  );
}

function EditorProposta({ pessoa, exercicio, atuais, onFechar, onFeito }: { pessoa: Pessoa; exercicio: any; atuais: Periodo[]; onFechar: () => void; onFeito: () => void }) {
  const { gestaoGlobal } = useAuth();
  const toast = useToast();
  const [novos, setNovos] = useState<Novo[]>(atuais.length ? atuais.map((p) => ({ inicio: p.data_inicio, dias: p.dias })) : [{ inicio: janela(exercicio.ano)[1], dias: 30 }]);
  const [exc, setExc] = useState(atuais.find((a) => a.excecao)?.excecao || '');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const ver = useVerificacao({ ...pessoaArgs(pessoa), p_exercicio: exercicio.ano, p_novos: novos, p_ignorar: atuais.map((a) => a.id), p_tipo: 'PAF' });
  const bloq = (ver || []).filter((x) => x.nivel === 'bloqueio').length;
  const salvar = async () => {
    setErro(null);
    try { await rpc('ferias_propor', { ...pessoaArgs(pessoa), p_exercicio: exercicio.ano, p_periodos: novos, p_excecao: bloq ? exc : null, p_observacao: obs || null });
      toast(bloq ? (gestaoGlobal ? 'Proposta salva com exceção autorizada.' : 'Proposta salva; a exceção vai para o Diretor da DGP.') : 'Proposta salva.'); onFeito(); }
    catch (e) { setErro(msgErro(e)); }
  };
  return (
    <Modal aberto largo titulo={`Proposta do PAF ${exercicio.ano} · ${pessoa.posto_completo} ${pessoa.nome}`} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Voltar</Botao>
        {atuais.length > 0 && <Botao variante="fantasma" onClick={async () => { try { await rpc('ferias_propor', { ...pessoaArgs(pessoa), p_exercicio: exercicio.ano, p_periodos: [] }); toast('Proposta removida.'); onFeito(); } catch (e) { setErro(msgErro(e)); } }}>Remover proposta</Botao>}
        <Botao variante="primario" disabled={!ver || (bloq > 0 && !exc.trim())} onClick={salvar}>{bloq ? 'Salvar com pedido de exceção' : 'Salvar proposta'}</Botao></>}>
      <SeletorPeriodos ano={exercicio.ano} valor={novos} onChange={setNovos} livre={gestaoGlobal} />
      <ListaVerificacoes v={ver} />
      {bloq > 0 && <Campo rotulo="Justificativa da exceção *" largura="inteira" dica="Casos excepcionais são decididos pelo Diretor da DGP.">
        <textarea rows={2} value={exc} onChange={(e) => setExc(e.target.value)} /></Campo>}
      <Campo rotulo="Observação" largura="inteira"><input value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

function EditorInclusao({ pessoa, exercicio, diasAtuais, onFechar, onFeito }: { pessoa: Pessoa; exercicio: any; diasAtuais: number; onFechar: () => void; onFeito: () => void }) {
  const toast = useToast();
  const saldo = Math.max(0, 30 - diasAtuais);
  const meses = janela(exercicio.ano);
  const proxMes = meses.find((m) => m > hojeISO()) || meses[1];
  const [novos, setNovos] = useState<Novo[]>([{ inicio: proxMes, dias: saldo > 0 && saldo !== 30 ? saldo : 30 }]);
  const [pub, setPub] = useState(''); const [sei, setSei] = useState(''); const [obs, setObs] = useState(''); const [exc, setExc] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const ver = useVerificacao({ ...pessoaArgs(pessoa), p_exercicio: exercicio.ano, p_novos: novos, p_ignorar: [], p_tipo: 'INCLUSAO' });
  const bloq = (ver || []).filter((x) => x.nivel === 'bloqueio').length;
  const salvar = async () => {
    setErro(null);
    try {
      await rpc('ferias_incluir', { ...pessoaArgs(pessoa), p_exercicio: exercicio.ano, p_periodos: novos, p_publicacao: pub || null, p_processo: sei || null, p_excecao: bloq ? exc : null, p_observacao: obs || null });
      toast(`Período incluído no PAF ${exercicio.ano}${pessoa.tipo === 'MILITAR' ? ' e lançado como afastamento' : ''}.`); onFeito();
    } catch (e) { setErro(msgErro(e)); }
  };
  return (
    <Modal aberto largo titulo={`Incluir período · PAF ${exercicio.ano} · ${pessoa.posto_completo} ${pessoa.nome}`} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Voltar</Botao><Botao variante="primario" disabled={!ver || (!pub.trim() && !sei.trim()) || (bloq > 0 && !exc.trim())} onClick={salvar}>{bloq ? 'Incluir com exceção' : 'Incluir período'}</Botao></>}>
      <p className="nota">{diasAtuais} dia(s) já lançados no PAF {exercicio.ano}; saldo de {saldo}. O período entra como programado e vira afastamento "Férias".</p>
      <SeletorPeriodos ano={exercicio.ano} valor={novos} onChange={setNovos} livre />
      <ListaVerificacoes v={ver} />
      {bloq > 0 && <Campo rotulo="Justificativa da exceção *" largura="inteira" dica="Fica registrada como exceção autorizada pela DGP."><textarea rows={2} value={exc} onChange={(e) => setExc(e.target.value)} /></Campo>}
      <div className="form-grade">
        <Campo rotulo="Publicação" dica="Nota ou BGE da inclusão. Informe esta ou o SEI."><input value={pub} onChange={(e) => setPub(e.target.value)} placeholder="Nota nº 000/26-DGP ou BGE nº 000/2026" /></Campo>
        <Campo rotulo="Processo SEI"><input value={sei} onChange={(e) => setSei(e.target.value)} placeholder="3900000000.000000/2026-00" /></Campo>
        <Campo rotulo="Observação" largura="meia" dica="Não registre diagnóstico ou CID (LGPD)."><input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: incluído após a publicação (recém-incluído no CBMPE)" /></Campo>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

function EditorReprogramacao({ pessoa, exercicio, periodos, inicial, onFechar, onFeito }: { pessoa: Pessoa; exercicio: any; periodos: Periodo[]; inicial?: 'A_PEDIDO' | 'INTERRUPCAO'; onFechar: () => void; onFeito: () => void }) {
  const toast = useToast();
  const { gestaoGlobal } = useAuth();
  const [homologar, setHomologar] = useState(gestaoGlobal);
  const [pubDgp, setPubDgp] = useState('');
  const hoje = hojeISO();
  const futuros = periodos.filter((p) => p.situacao === 'PROGRAMADA' && p.data_inicio > hoje);
  const emGozo = periodos.filter((p) => p.situacao === 'PROGRAMADA' && p.data_inicio <= hoje && p.data_fim >= hoje);
  const [tipo, setTipo] = useState(inicial === 'INTERRUPCAO' && emGozo.length ? 'INTERRUPCAO' : emGozo.length && !futuros.length ? 'INTERRUPCAO' : 'A_PEDIDO');
  const [motivo, setMotivo] = useState('');
  const [req, setReq] = useState(hoje);
  const [sei, setSei] = useState('');
  const [pub, setPub] = useState('');
  const [cancelar, setCancelar] = useState<string[]>(futuros.map((p) => p.id));
  const [interromper, setInterromper] = useState<string>(emGozo[0]?.id || '');
  const [intEm, setIntEm] = useState(hoje);
  const [novos, setNovos] = useState<Novo[]>([]);
  const [exc, setExc] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const interrupcao = tipo === 'INTERRUPCAO';
  const pInt = emGozo.find((p) => p.id === interromper);
  const restante = pInt ? pInt.dias - Math.max(0, Math.round((new Date(intEm + 'T12:00').getTime() - new Date(pInt.data_inicio + 'T12:00').getTime()) / 864e5)) : 0;
  useEffect(() => {
    if (novos.length) return;
    const base = interrupcao ? restante : cancelar.reduce((s, id) => s + (futuros.find((f) => f.id === id)?.dias || 0), 0);
    if (base > 0) setNovos(base === 30 ? [{ inicio: janela(exercicio.ano)[6], dias: 30 }] : [{ inicio: janela(exercicio.ano)[6], dias: base }]);
  }, [tipo, interromper]); // eslint-disable-line
  const ver = useVerificacao({
    ...pessoaArgs(pessoa), p_exercicio: exercicio.ano, p_novos: novos, p_ignorar: interrupcao ? [] : cancelar, p_tipo: tipo,
    p_requerimento: tipo === 'A_PEDIDO' || tipo === 'DE_OFICIO' ? req : null,
    p_parcial: interrupcao && pInt ? { id: pInt.id, dias: pInt.dias - restante } : null,
  });
  const verF = (ver || []).filter((x) => !(interrupcao && ['dia_inicio', 'dias', 'composicao'].includes(x.codigo)));
  const bloq = verF.filter((x) => x.nivel === 'bloqueio').length;
  const enviar = async () => {
    setErro(null);
    try {
      const args = {
        ...pessoaArgs(pessoa), p_exercicio: exercicio.ano, p_tipo: tipo, p_motivo: motivo || null,
        p_requerimento: tipo === 'A_PEDIDO' || tipo === 'DE_OFICIO' ? req : null, p_processo: sei, p_publicacao_ome: pub || null,
        p_cancelar: interrupcao ? [] : cancelar, p_novos: novos, p_interromper: interrupcao ? interromper || null : null,
        p_interrupcao_em: interrupcao ? intEm : null, p_excecao: bloq ? exc : null, p_observacao: obs || null,
      };
      if (homologar) {
        await rpc('ferias_reprogramar_homologar', { ...args, p_publicacao_dgp: pubDgp });
        toast(interrupcao ? 'Interrupção registrada e homologada; o afastamento foi atualizado.' : 'Reprogramação registrada e homologada; o afastamento foi atualizado.');
      } else {
        await rpc('ferias_reprogramar', args);
        toast('Reprogramação registrada; homologue em Férias > Reprogramações.');
      }
      onFeito();
    } catch (e) { setErro(msgErro(e)); }
  };
  return (
    <Modal aberto largo titulo={`${interrupcao ? 'Interrupção' : 'Reprogramação'} · PAF ${exercicio.ano} · ${pessoa.posto_completo} ${pessoa.nome}`} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Voltar</Botao><Botao variante="primario" disabled={!ver || !sei.trim() || (bloq > 0 && !exc.trim()) || (homologar && !pubDgp.trim())} onClick={enviar}>{homologar ? (bloq ? 'Registrar e homologar com exceção' : 'Registrar e homologar') : 'Registrar para homologar depois'}</Botao></>}>
      <div className="form-grade">
        <Campo rotulo="Tipo *" largura="meia">
          <select value={tipo} onChange={(e) => { setTipo(e.target.value); setNovos([]); setMotivo(''); }}>
            {Object.entries(TIPO_REPROG).filter(([k]) => k !== 'INTERRUPCAO' || emGozo.length).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        {(tipo === 'OBRIGATORIA' || interrupcao) && <Campo rotulo="Motivo *" largura="meia">
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)}><option value="">Selecione</option>
            {[...MOTIVOS_ART10, ...(tipo === 'OBRIGATORIA' ? [MOTIVO_JA_AFASTADO] : [])].map((m) => <option key={m}>{m}</option>)}</select>
        </Campo>}
        {(tipo === 'A_PEDIDO' || tipo === 'DE_OFICIO') && <Campo rotulo={tipo === 'A_PEDIDO' ? 'Requerimento protocolado em *' : 'Comunicação ao militar em *'} dica="No mínimo 60 dias antes do início (art. 11, II)">
          <input type="date" value={req} onChange={(e) => setReq(e.target.value)} /></Campo>}
        <Campo rotulo="Processo SEI *"><input value={sei} onChange={(e) => setSei(e.target.value)} placeholder="3900000000.000000/2026-00" /></Campo>
        <Campo rotulo="Publicação do deferimento pela OME" dica="BGE/BI (art. 14, II, c)"><input value={pub} onChange={(e) => setPub(e.target.value)} /></Campo>
        {gestaoGlobal && <Campo rotulo={homologar ? 'Publicação da homologação (BGE) *' : 'Publicação da homologação'} dica="Art. 13, II"><input value={pubDgp} disabled={!homologar} onChange={(e) => setPubDgp(e.target.value)} placeholder="BGE nº 000/2026" /></Campo>}
      </div>
      {gestaoGlobal && <label className="check"><input type="checkbox" checked={homologar} onChange={(e) => setHomologar(e.target.checked)} /> Homologar agora (a DGP registra e homologa no mesmo passo)</label>}
      {interrupcao ? (
        <div className="form-grade">
          <Campo rotulo="Período interrompido" largura="meia">
            <select value={interromper} onChange={(e) => setInterromper(e.target.value)}>
              {emGozo.map((p) => <option key={p.id} value={p.id}>{fmtData(p.data_inicio)} a {fmtData(p.data_fim)} ({p.dias} dias)</option>)}
            </select>
          </Campo>
          <Campo rotulo="Interrompido a partir de"><input type="date" value={intEm} onChange={(e) => setIntEm(e.target.value)} /></Campo>
          <div className="campo"><span className="campo-rotulo">Restante</span><strong>{restante} dias</strong><span className="campo-dica">Informe abaixo quando serão gozados (art. 11, § 5º)</span></div>
        </div>
      ) : (
        <div className="campo campo-inteira"><span className="campo-rotulo">Períodos que deixam de valer</span>
          {futuros.length === 0 ? <span className="nota">Nenhum período futuro programado neste exercício.</span> : futuros.map((p) => (
            <label key={p.id} className="check"><input type="checkbox" checked={cancelar.includes(p.id)} onChange={(e) => setCancelar(e.target.checked ? [...cancelar, p.id] : cancelar.filter((x) => x !== p.id))} /> {fmtData(p.data_inicio)} a {fmtData(p.data_fim)} ({p.dias} dias)</label>
          ))}
        </div>
      )}
      <h4>Novo período</h4>
      <SeletorPeriodos key={tipo + interromper} ano={exercicio.ano} valor={novos} onChange={setNovos} livre />
      <ListaVerificacoes v={ver ? verF : null} />
      {bloq > 0 && <Campo rotulo="Justificativa da exceção *" largura="inteira" dica="Casos excepcionais são decididos pelo Diretor da DGP."><textarea rows={2} value={exc} onChange={(e) => setExc(e.target.value)} /></Campo>}
      <Campo rotulo="Observação" largura="inteira" dica="Não registre diagnóstico ou CID (LGPD)."><input value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
      <p className="nota">Afastamentos de saúde, luto, maternidade, paternidade e núpcias durante as férias não as interrompem (art. 11, § 3º).</p>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

// ======================================================================= reprogramações
function Reprogramacoes() {
  const { escopo, gestaoGlobal, podeEditarOme } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [filtro, setFiltro] = useState(params.get('f') || 'AGUARDANDO_DGP');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState<any>(null);
  const lista = useConsulta(`ferias|reprog|${escopo}`, async () => {
    let q = supabase.from('v_ferias_reprogramacao').select('*').order('solicitado_em', { ascending: false }).limit(2000);
    if (escopo) q = q.eq('ome_id', escopo);
    const { data, error } = await q; if (error) throw error; return data || [];
  }, 15_000);
  if (lista.erro) return <Aviso tom="erro">{lista.erro}</Aviso>;
  if (!lista.dados) return <Carregando />;
  const linhas = lista.dados.filter((r: any) => filtro === 'todas' ? true : filtro === 'sgp' ? r.status === 'HOMOLOGADA' && !r.sgp_em : r.status === filtro);
  const n = (f: (r: any) => boolean) => lista.dados!.filter(f).length;
  return <>
    <div className="atalhos">
      {([['AGUARDANDO_DGP', 'Aguardando DGP', n((r) => r.status === 'AGUARDANDO_DGP')], ['sgp', 'Homologadas sem SGP', n((r) => r.status === 'HOMOLOGADA' && !r.sgp_em)],
        ['DEVOLVIDA', 'Devolvidas', n((r) => r.status === 'DEVOLVIDA')], ['HOMOLOGADA', 'Homologadas', n((r) => r.status === 'HOMOLOGADA')], ['todas', 'Todas', lista.dados.length]] as const)
        .map(([id, r, c]) => <button key={id} className={`atalho ${filtro === id ? 'ativo' : ''}`} onClick={() => { setFiltro(id); setSel(new Set()); }}>{r} <span>{c}</span></button>)}
    </div>
    {filtro === 'sgp' && gestaoGlobal && (
      <div className="barra-lote">
        <strong>{sel.size} selecionada(s)</strong>
        <Botao pequeno variante="primario" disabled={!sel.size} onClick={async () => { try { const k = await rpc<number>('ferias_marcar_sgp', { p_ids: [...sel] }); toast(`${k} marcada(s) como inseridas no SGP.`); setSel(new Set()); lista.recarregar(); invalidar('pendencias'); } catch (e) { toast(msgErro(e), 'erro'); } }}>Marcar como inseridas no SGP</Botao>
        <Botao pequeno onClick={() => exportarXlsx('reprogramacoes_sgp', 'Reprogramações de férias homologadas para inserir no SGP', [
          { titulo: 'OME', valor: (r: any) => r.ome_sigla, largura: 10 }, { titulo: 'Posto/Grad.', valor: (r: any) => r.posto_completo, largura: 12 },
          { titulo: 'Matrícula', valor: (r: any) => r.matricula, largura: 11 }, { titulo: 'Nome', valor: (r: any) => r.nome, largura: 38 },
          { titulo: 'Exercício', valor: (r: any) => r.exercicio, largura: 9 }, { titulo: 'Tipo', valor: (r: any) => TIPO_REPROG[r.tipo], largura: 30 },
          { titulo: 'Novo(s) período(s)', valor: (r: any) => (r.novos || []).map((x: any) => `${fmtData(x.inicio)} a ${fmtData(somaDiasIso(x.inicio, x.dias - 1))}`).join('; '), largura: 40 },
          { titulo: 'Interrupção em', valor: (r: any) => fmtData(r.interrupcao_em), largura: 12 },
          { titulo: 'Homologação', valor: (r: any) => r.publicacao_dgp, largura: 16 }, { titulo: 'Processo SEI', valor: (r: any) => r.processo_sei, largura: 28 },
        ], linhas)}>Exportar lista para o SGP</Botao>
      </div>
    )}
    <Tabela linhas={linhas} chave={(r: any) => r.id} vazio="Nenhuma reprogramação neste filtro." onLinha={(r: any) => setAberta(r)} colunas={[
      ...(filtro === 'sgp' && gestaoGlobal ? [{ id: 'sel', titulo: '', ordenavel: false, largura: '28px', render: (r: any) => <span onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)} onChange={() => setSel((s) => { const x = new Set(s); x.has(r.id) ? x.delete(r.id) : x.add(r.id); return x; })} /></span> }] : []),
      { id: 'solicitado_em', titulo: 'Pedido', render: (r: any) => fmtDataHora(r.solicitado_em) },
      { id: 'ome_sigla', titulo: 'OME' },
      { id: 'nome', titulo: 'Militar / servidor', render: (r: any) => <>{r.posto_completo} {r.nome}</> },
      { id: 'exercicio', titulo: 'PAF' },
      { id: 'tipo', titulo: 'Tipo', render: (r: any) => TIPO_REPROG[r.tipo]?.split(' (')[0] },
      { id: 'novos', titulo: 'Novo período', ordenavel: false, render: (r: any) => (r.novos || []).map((x: any) => `${fmtData(x.inicio)} (${x.dias}d)`).join(', ') },
      { id: 'alertas', titulo: 'Regras', ordenavel: false, render: (r: any) => r.excecao ? <Badge tom="amarelo" title={r.excecao}>pede exceção</Badge> : (r.verificacoes || []).some((v: any) => v.nivel === 'alerta') ? <Badge tom="azul">com alertas</Badge> : <Badge tom="verde">ok</Badge> },
      { id: 'status', titulo: 'Situação', render: (r: any) => <><Badge tom={r.status === 'HOMOLOGADA' ? 'verde' : r.status === 'DEVOLVIDA' ? 'vermelho' : r.status === 'CANCELADA' ? 'neutro' : 'amarelo'}>{r.status.replace('_', ' ').toLowerCase()}</Badge>{r.status === 'HOMOLOGADA' && !r.sgp_em && <div className="nota">falta SGP</div>}</> },
    ]} />
    {aberta && <DecidirReprogramacao r={aberta} podeCancelar={false} onFechar={() => setAberta(null)} onFeito={() => { setAberta(null); lista.recarregar(); recarregarTudo(); }} />}
  </>;
}

function DecidirReprogramacao({ r, podeCancelar, onFechar, onFeito }: { r: any; podeCancelar: boolean; onFechar: () => void; onFeito: () => void }) {
  const { gestaoGlobal } = useAuth();
  const toast = useToast();
  const [pub, setPub] = useState(''); const [resp, setResp] = useState(''); const [erro, setErro] = useState<string | null>(null);
  const antigos = useConsulta(`ferias|reprog-ant|${r.id}`, async () => {
    const ids = [...(r.cancelar || []), ...(r.interromper ? [r.interromper] : [])];
    if (!ids.length) return [];
    const { data } = await supabase.from('v_ferias').select('*').in('id', ids); return data || [];
  });
  const decidir = async (acao: string) => {
    setErro(null);
    try { await rpc('ferias_decidir_reprogramacao', { p_id: r.id, p_acao: acao, p_publicacao: pub || null, p_resposta: resp || null });
      toast(acao === 'HOMOLOGAR' ? 'Reprogramação homologada; o afastamento foi atualizado.' : acao === 'DEVOLVER' ? 'Devolvida à OME.' : 'Pedido cancelado.'); onFeito(); }
    catch (e) { setErro(msgErro(e)); }
  };
  const aguardando = r.status === 'AGUARDANDO_DGP';
  return (
    <Modal aberto largo titulo={`Reprogramação · ${r.posto_completo} ${r.nome} · PAF ${r.exercicio}`} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Fechar</Botao>
        {aguardando && !gestaoGlobal && podeCancelar && <Botao variante="fantasma" onClick={() => decidir('CANCELAR')}>Cancelar pedido</Botao>}
        {aguardando && gestaoGlobal && <><Botao onClick={() => decidir('DEVOLVER')}>Devolver à OME</Botao><Botao variante="primario" onClick={() => decidir('HOMOLOGAR')}>Homologar</Botao></>}
      </>}>
      <dl className="novidades">
        <div><dt>Tipo</dt><dd>{TIPO_REPROG[r.tipo]}{r.motivo ? ` · ${r.motivo}` : ''}</dd></div>
        <div><dt>Documentos</dt><dd>SEI {r.processo_sei}{r.publicacao_ome ? ` · deferimento ${r.publicacao_ome}` : ''}{r.requerimento_em ? ` · requerimento em ${fmtData(r.requerimento_em)}` : ''}</dd></div>
        <div><dt>Antes</dt><dd>{!antigos.dados ? '…' : antigos.dados.length ? antigos.dados.map((p: any) => `${fmtData(p.data_inicio)} a ${fmtData(p.data_fim)} (${p.dias}d)`).join('; ') : '—'}{r.interrupcao_em ? ` · interrompida em ${fmtData(r.interrupcao_em)}` : ''}</dd></div>
        <div><dt>Depois</dt><dd>{(r.novos || []).map((x: any) => `${fmtData(x.inicio)} a ${fmtData(somaDiasIso(x.inicio, x.dias - 1))} (${x.dias}d)`).join('; ') || '—'}</dd></div>
        {r.excecao && <div><dt>Pedido de exceção</dt><dd>{r.excecao}</dd></div>}
        {r.observacao && <div><dt>Observação</dt><dd>{r.observacao}</dd></div>}
        <div><dt>Pedido por</dt><dd>{r.solicitado_por_nome} em {fmtDataHora(r.solicitado_em)}</dd></div>
        {r.decidido_em && <div><dt>Decisão</dt><dd>{r.decidido_por_nome} em {fmtDataHora(r.decidido_em)}{r.publicacao_dgp ? ` · ${r.publicacao_dgp}` : ''}{r.resposta ? ` · ${r.resposta}` : ''}{r.sgp_em ? ` · SGP em ${fmtDataHora(r.sgp_em)}` : ''}</dd></div>}
      </dl>
      <h4>Regras no momento do pedido</h4>
      <ListaVerificacoes v={r.verificacoes || []} />
      {aguardando && gestaoGlobal && <div className="form-grade">
        <Campo rotulo="Publicação da homologação (BGE) *" dica="Obrigatória para homologar"><input value={pub} onChange={(e) => setPub(e.target.value)} placeholder="BGE nº 000/2026" /></Campo>
        <Campo rotulo="Observação / motivo da devolução" largura="meia"><input value={resp} onChange={(e) => setResp(e.target.value)} /></Campo>
      </div>}
      {aguardando && gestaoGlobal && r.excecao && <Aviso tom="alerta">Homologar este pedido autoriza a exceção à Portaria 312 em nome do Diretor da DGP.</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

// ======================================================================= pendências
function Pendencias({ exercicio }: { exercicio: any }) {
  const { escopo, gestaoGlobal } = useAuth();
  const toast = useToast();
  const meses = janela(exercicio.ano);
  const pessoas = usePessoas(escopo);
  const periodos = usePeriodos(escopo, meses[0], fimMesIso(meses[12]));
  const [aberta, setAberta] = useState<Pessoa | null>(null);
  if (!pessoas.dados || !periodos.dados) return <Carregando />;
  const doEx = periodos.dados.filter((p: any) => p.exercicio === exercicio.ano && ativo(p));
  const dias = new Map<string, number>();
  doEx.forEach((p: any) => dias.set(p.pessoa_id, (dias.get(p.pessoa_id) || 0) + diasEfetivos(p)));
  const sem = pessoas.dados.filter((p) => !dias.has(p.id));
  const incompletos = pessoas.dados.filter((p) => (dias.get(p.id) || 0) > 0 && (dias.get(p.id) || 0) < 30);
  const excecoes = doEx.filter((p: any) => p.excecao && !p.excecao_aprovada_por);
  const estimadas = periodos.dados.filter((p: any) => p.data_estimada && ativo(p) && p.data_inicio >= hojeISO());
  const porId = new Map(pessoas.dados.map((p) => [p.id, p]));
  const colPessoa = [
    { id: 'posto_completo', titulo: 'Posto', valor: (r: any) => r.posto_ordem }, { id: 'nome', titulo: 'Nome' }, { id: 'matricula', titulo: 'Matrícula' },
    ...(escopo ? [] : [{ id: 'ome_sigla', titulo: 'OME' }]),
  ];
  return <>
    {gestaoGlobal && excecoes.length > 0 && <Cartao titulo={`Exceções para o Diretor da DGP (${excecoes.length})`}
      acoes={exercicio.situacao === 'ELABORACAO' ? <Botao pequeno variante="primario" onClick={async () => { try { const n = await rpc<number>('ferias_autorizar_excecao', { p_ids: excecoes.map((e: any) => e.id) }); toast(`${n} exceção(ões) autorizada(s).`); periodos.recarregar(); invalidar('pendencias'); } catch (e) { toast(msgErro(e), 'erro'); } }}>Autorizar todas</Botao> : undefined}>
      <Tabela linhas={excecoes} chave={(r: any) => r.id} compacta colunas={[...colPessoa,
        { id: 'data_inicio', titulo: 'Período', render: (r: any) => `${fmtData(r.data_inicio)} (${r.dias}d)` }, { id: 'excecao', titulo: 'Justificativa' }]} />
    </Cartao>}
    <Cartao titulo={`Sem previsão no PAF ${exercicio.ano} (${sem.length})`}>
      <p className="nota">Militares e servidores ativos sem nenhum período no exercício. Recém-incluídos só têm direito após 12 meses de serviço (art. 2º, I).</p>
      <Tabela linhas={sem} chave={(r: any) => r.id} compacta porPagina={20} onLinha={(r: any) => setAberta(r)} colunas={colPessoa} vazio="Todos têm previsão." />
    </Cartao>
    <Cartao titulo={`Com menos de 30 dias no exercício (${incompletos.length})`}>
      <Tabela linhas={incompletos.map((p) => ({ ...p, dias: dias.get(p.id) }))} chave={(r: any) => r.id} compacta porPagina={20} onLinha={(r: any) => setAberta(porId.get(r.id)!)} colunas={[...colPessoa, { id: 'dias', titulo: 'Dias' }]} vazio="Nenhum." />
    </Cartao>
    <Cartao titulo={`Dia estimado na importação (${estimadas.length})`}>
      <p className="nota">Vieram da planilha só com o mês previsto. Confirme o dia de início: se for 1º e 30 dias, não há o que fazer; se não, reprograme.</p>
      <Tabela linhas={estimadas} chave={(r: any) => r.id} compacta porPagina={20} onLinha={(r: any) => porId.get(r.pessoa_id) && setAberta(porId.get(r.pessoa_id)!)} colunas={[...colPessoa,
        { id: 'exercicio', titulo: 'PAF' }, { id: 'data_inicio', titulo: 'Início estimado', render: (r: any) => fmtData(r.data_inicio) }, { id: 'dias', titulo: 'Dias' }]} vazio="Nenhum." />
    </Cartao>
    {aberta && <PessoaFerias pessoa={aberta} exercicio={exercicio} editavel={gestaoGlobal} onFechar={() => { setAberta(null); periodos.recarregar(); }} />}
  </>;
}

// ======================================================================= servidores civis
function Civis() {
  const { escopo, ctx, gestaoGlobal, podeEditarOme } = useAuth();
  const dom = useDominios();
  const toast = useToast();
  const [edit, setEdit] = useState<any>(null);
  const lista = useConsulta(`ferias|civis|${escopo}`, async () => {
    let q = supabase.from('servidor_civil').select('*, ome:ome_id(sigla)').order('nome');
    if (escopo) q = q.eq('ome_id', escopo);
    const { data, error } = await q; if (error) throw error; return data || [];
  }, 30_000);
  const omes = gestaoGlobal ? (dom?.omes || []).filter((o) => o.ativo) : (ctx?.omes || []).filter((o) => podeEditarOme(o.id));
  const salvar = async () => {
    try {
      const d = { matricula: edit.matricula, nome: edit.nome, ome_id: Number(edit.ome_id), cargo: edit.cargo || null, ativo: edit.ativo !== false, observacao: edit.observacao || null };
      const { error } = edit.id ? await supabase.from('servidor_civil').update(d).eq('id', edit.id) : await supabase.from('servidor_civil').insert(d);
      if (error) throw error; toast('Servidor salvo.'); setEdit(null); lista.recarregar(); invalidar('ferias|pessoas');
    } catch (e) { toast(msgErro(e), 'erro'); }
  };
  return <>
    <div className="pagina-cab"><p className="nota">Os servidores civis lotados no CBMPE entram no PAF com o mesmo tratamento dos militares (art. 14, § 5º e art. 16). O cadastro serve só às férias: não entra no efetivo, no QOD nem nos indicadores.</p>
      {gestaoGlobal && <div className="acoes"><Botao variante="primario" onClick={() => setEdit({ matricula: '', nome: '', ome_id: escopo || omes[0]?.id || '', cargo: '', ativo: true })}>+ Servidor civil</Botao></div>}</div>
    {!lista.dados ? <Carregando /> : <Tabela linhas={lista.dados} chave={(r: any) => r.id} onLinha={(r: any) => gestaoGlobal && setEdit({ ...r })} vazio="Nenhum servidor civil cadastrado." colunas={[
      { id: 'matricula', titulo: 'Matrícula' }, { id: 'nome', titulo: 'Nome' }, { id: 'ome', titulo: 'OME', valor: (r: any) => r.ome?.sigla, render: (r: any) => r.ome?.sigla },
      { id: 'cargo', titulo: 'Cargo' }, { id: 'ativo', titulo: 'Situação', render: (r: any) => (r.ativo ? <Badge tom="verde">ativo</Badge> : <Badge>inativo</Badge>) },
    ]} />}
    {edit && <Modal aberto titulo={edit.id ? 'Editar servidor civil' : 'Novo servidor civil'} onFechar={() => setEdit(null)}
      rodape={<><Botao onClick={() => setEdit(null)}>Cancelar</Botao><Botao variante="primario" onClick={salvar}>Salvar</Botao></>}>
      <div className="form-grade">
        <Campo rotulo="Matrícula *"><input value={edit.matricula} onChange={(e) => setEdit({ ...edit, matricula: e.target.value })} /></Campo>
        <Campo rotulo="Nome *" largura="meia"><input value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></Campo>
        <Campo rotulo="OME *"><select value={edit.ome_id} onChange={(e) => setEdit({ ...edit, ome_id: e.target.value })}>{omes.map((o) => <option key={o.id} value={o.id}>{o.sigla}</option>)}</select></Campo>
        <Campo rotulo="Cargo"><input value={edit.cargo || ''} onChange={(e) => setEdit({ ...edit, cargo: e.target.value })} /></Campo>
        <label className="check"><input type="checkbox" checked={edit.ativo !== false} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo</label>
      </div>
    </Modal>}
  </>;
}

// ======================================================================= exercícios (DGP)
function Exercicios({ exercicios }: { exercicios: any[] }) {
  const dom = useDominios();
  const toast = useToast();
  const [abrir, setAbrir] = useState(false);
  const [publicar, setPublicar] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const restr = useConsulta('ferias|restr', async () => { const { data, error } = await supabase.from('ferias_restricao').select('*').order('inicio', { ascending: false }); if (error) throw error; return data || []; });
  const ensino = useOmesEnsino();
  const [nova, setNova] = useState({ inicio: '', fim: '', motivo: '' });
  const contar = useConsulta('ferias|ex-cont', async () => {
    const { data } = await supabase.from('ferias_periodo').select('exercicio, situacao').in('situacao', ['PROPOSTA', 'PROGRAMADA']).limit(50000);
    const m = new Map<number, { p: number; g: number }>();
    (data || []).forEach((x: any) => { const o = m.get(x.exercicio) || { p: 0, g: 0 }; x.situacao === 'PROPOSTA' ? o.p++ : o.g++; m.set(x.exercicio, o); });
    return m;
  });
  const prox = (exercicios[0]?.ano || new Date().getFullYear()) + 1;
  return <>
    <Cartao titulo="Exercícios do PAF" acoes={<Botao pequeno variante="primario" onClick={() => { setF({ ano: prox, prazo: `${prox}-07-15` }); setAbrir(true); }}>Abrir exercício</Botao>}>
      <p className="nota">Calendário da Portaria 312: ofício circular às OMEs até 30/05 (art. 13, I, a); proposta das OMEs até 15/07 (art. 14, I, b); a DGP homologa e publica o PAF (art. 4º).</p>
      <Tabela linhas={exercicios} chave={(r: any) => String(r.ano)} compacta colunas={[
        { id: 'ano', titulo: 'PAF' }, { id: 'gozo', titulo: 'Gozo', ordenavel: false, render: (r: any) => `01/12/${r.ano} a 31/12/${r.ano + 1}` },
        { id: 'situacao', titulo: 'Situação', render: (r: any) => <Badge tom={r.situacao === 'PUBLICADO' ? 'verde' : 'amarelo'}>{r.situacao === 'PUBLICADO' ? 'publicado' : 'em elaboração'}</Badge> },
        { id: 'prazo_ome', titulo: 'Prazo da OME', render: (r: any) => fmtData(r.prazo_ome) },
        { id: 'publicacao', titulo: 'Publicação', render: (r: any) => [r.publicacao, fmtData(r.data_publicacao), r.processo_sei].filter(Boolean).join(' · ') },
        { id: 'n', titulo: 'Períodos', ordenavel: false, render: (r: any) => { const c = contar.dados?.get(r.ano); return c ? `${c.g} programados${c.p ? ` · ${c.p} propostos` : ''}` : '—'; } },
        { id: 'acao', titulo: '', ordenavel: false, render: (r: any) => r.situacao === 'ELABORACAO' ? <Botao pequeno variante="primario" onClick={() => { setF({ publicacao: '', data: hojeISO(), sei: '' }); setPublicar(r); }}>Publicar PAF</Botao> : null },
      ]} />
    </Cartao>
    <div className="grade-2">
      <Cartao titulo="Períodos restritos (art. 12)">
        <p className="nota">Em períodos de grande mobilização (ex.: Carnaval), a DGP restringe o gozo. Propostas e reprogramações que os atingem precisam de exceção.</p>
        <div className="form-grade">
          <Campo rotulo="De"><input type="date" value={nova.inicio} onChange={(e) => setNova({ ...nova, inicio: e.target.value })} /></Campo>
          <Campo rotulo="Até"><input type="date" value={nova.fim} onChange={(e) => setNova({ ...nova, fim: e.target.value })} /></Campo>
          <Campo rotulo="Motivo"><input value={nova.motivo} onChange={(e) => setNova({ ...nova, motivo: e.target.value })} placeholder="Carnaval 2027" /></Campo>
          <div className="campo"><span className="campo-rotulo">&nbsp;</span><Botao pequeno disabled={!nova.inicio || !nova.fim || !nova.motivo} onClick={async () => {
            const { error } = await supabase.from('ferias_restricao').insert(nova); if (error) return toast(msgErro(error), 'erro');
            setNova({ inicio: '', fim: '', motivo: '' }); restr.recarregar(); }}>Incluir</Botao></div>
        </div>
        {restr.dados && <Tabela linhas={restr.dados} chave={(r: any) => String(r.id)} compacta vazio="Nenhuma restrição." colunas={[
          { id: 'inicio', titulo: 'De', render: (r: any) => fmtData(r.inicio) }, { id: 'fim', titulo: 'Até', render: (r: any) => fmtData(r.fim) }, { id: 'motivo', titulo: 'Motivo' },
          { id: 'x', titulo: '', ordenavel: false, render: (r: any) => <button className="link" onClick={async () => { const { error } = await supabase.from('ferias_restricao').delete().eq('id', r.id); if (error) toast(msgErro(error), 'erro'); restr.recarregar(); }}>excluir</button> },
        ]} />}
      </Cartao>
      <Cartao titulo="Órgãos de ensino (fora do limite de 10%)">
        <p className="nota">Militares classificados e lotados em órgãos de ensino gozam férias conforme o calendário letivo (art. 5º, parágrafo único).</p>
        <div className="omes-check">
          {(dom?.omes || []).filter((o) => o.ativo).map((o) => (
            <label key={o.id} className="check"><input type="checkbox" checked={!!ensino.dados?.has(o.id)} onChange={async (e) => {
              const { error } = await supabase.from('ome').update({ orgao_ensino: e.target.checked }).eq('id', o.id);
              if (error) toast(msgErro(error), 'erro'); else invalidar('ferias|ensino');
            }} /> {o.sigla}</label>
          ))}
        </div>
      </Cartao>
    </div>
    {abrir && <Modal aberto titulo="Abrir exercício do PAF" onFechar={() => setAbrir(false)}
      rodape={<><Botao onClick={() => setAbrir(false)}>Cancelar</Botao><Botao variante="primario" onClick={async () => {
        try { await rpc('ferias_abrir_exercicio', { p_ano: Number(f.ano), p_prazo: f.prazo || null }); toast(`PAF ${f.ano} aberto.`); setAbrir(false); invalidar('ferias'); }
        catch (e) { toast(msgErro(e), 'erro'); } }}>Abrir</Botao></>}>
      <div className="form-grade">
        <Campo rotulo="Exercício (ano)"><input type="number" value={f.ano} onChange={(e) => setF({ ...f, ano: e.target.value })} /></Campo>
        <Campo rotulo="Prazo das OMEs" dica="Art. 14, I, b: 15 de julho"><input type="date" value={f.prazo} onChange={(e) => setF({ ...f, prazo: e.target.value })} /></Campo>
      </div>
      <p className="nota">Gozo de 01/12/{f.ano} a 31/12/{Number(f.ano) + 1}. As OMEs passam a ver a pendência "sem proposta" no sino.</p>
    </Modal>}
    {publicar && <Modal aberto titulo={`Publicar o PAF ${publicar.ano}`} onFechar={() => setPublicar(null)}
      rodape={<><Botao onClick={() => setPublicar(null)}>Cancelar</Botao><Botao variante="primario" onClick={async () => {
        try { const n = await rpc<number>('ferias_publicar', { p_ano: publicar.ano, p_publicacao: f.publicacao, p_data: f.data || null, p_processo: f.sei || null });
          toast(`PAF ${publicar.ano} publicado: ${n} períodos programados e lançados como afastamento.`); setPublicar(null); recarregarTudo(); }
        catch (e) { toast(msgErro(e), 'erro'); } }}>Publicar</Botao></>}>
      <p>Depois de publicado, a proposta fica travada e as mudanças só acontecem por reprogramação homologada. Cada período vira afastamento "Férias" no efetivo.</p>
      <div className="form-grade">
        <Campo rotulo="Publicação *"><input value={f.publicacao} onChange={(e) => setF({ ...f, publicacao: e.target.value })} placeholder="BGE nº 000/2026" /></Campo>
        <Campo rotulo="Data"><input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Campo>
        <Campo rotulo="Processo SEI"><input value={f.sei} onChange={(e) => setF({ ...f, sei: e.target.value })} /></Campo>
      </div>
    </Modal>}
  </>;
}

// ======================================================================= importação (DGP)
function Importar() {
  const dom = useDominios();
  const toast = useToast();
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [an, setAn] = useState<any>(null);
  const [exs, setExs] = useState<Record<number, { situacao: string; publicacao: string }>>({});
  const [civis, setCivis] = useState<Record<string, number | ''>>({});
  const [prog, setProg] = useState<string | null>(null);
  const [res, setRes] = useState<any>(null);
  const omeDe = (txt: string) => {
    const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const o = (dom?.omes || []).find((x) => n(x.sigla) === n(txt) || (x.nome && n(x.nome) === n(txt)));
    return o?.id ?? '';
  };
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [arqLido, setArqLido] = useState<string | null>(null);
  const ler = async (f: File) => {
    setLendo(true); setRes(null); setErroLeitura(null); setAn(null); setArqLido(`${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`);
    try {
      const { lerPlanilhaPaf } = await import('../lib/excel');
      const lido = await lerPlanilhaPaf(f);
      if (!lido.abas.length) throw new Error(`Não encontrei a coluna MATRÍCULA nas primeiras 20 linhas de nenhuma aba. Abas do arquivo: ${lido.todas.join(', ') || '(nenhuma)'}. As abas devem se chamar "FÉRIAS 2025", "FÉRIAS 2026"... e ter uma linha de títulos com MATRÍCULA.`);
      if (!lido.linhas.length) throw new Error(`Li as abas ${lido.abas.join(', ')}, mas nenhuma linha tinha matrícula preenchida abaixo dos títulos.`);
      const m = montarImportacao(lido.linhas);
      const [mil, civ] = await Promise.all([
        buscarTodos<any>(() => supabase.from('militar').select('matricula, situacao').order('matricula')),
        buscarTodos<any>(() => supabase.from('servidor_civil').select('matricula').order('matricula')),
      ]);
      const conhecidas = new Set([...mil.map((x) => x.matricula), ...civ.map((x) => x.matricula)]);
      const semCad = new Map<string, { matricula: string; nome: string; ome: string; n: number }>();
      const compl = new Map(lido.complementar.map((c) => [c.matricula, c]));
      for (const p of m.periodos) if (!conhecidas.has(p.matricula)) {
        const x = semCad.get(p.matricula) || { matricula: p.matricula, nome: compl.get(p.matricula)?.nome || (p.nome && !/N[ÃA]O ENCONTRADO/i.test(p.nome) ? p.nome : ''), ome: p.omeRecebida, n: 0 };
        x.n++; semCad.set(p.matricula, x);
      }
      const porEx = new Map<number, number>(); m.periodos.forEach((p) => porEx.set(p.exercicio, (porEx.get(p.exercicio) || 0) + 1));
      const { data: existentes } = await supabase.from('ferias_exercicio').select('*');
      const e: Record<number, any> = {};
      const hoje = new Date().getFullYear();
      [...porEx.keys()].forEach((a) => {
        const x = (existentes || []).find((y: any) => y.ano === a);
        // exercício muito à frente, antes de 2000 ou antigo com 1 a 3 períodos é quase sempre erro de digitação na coluna PAF
        const suspeita = a > hoje + 1 || a < 2000 || ((porEx.get(a) || 0) <= 3 && a < hoje - 3);
        e[a] = { situacao: x?.situacao || (suspeita ? 'IGNORAR' : 'PUBLICADO'), publicacao: x?.publicacao || (a === 2025 && /BGE[_ ]?190/i.test(f.name) ? 'BGE 190/2025' : '') };
      });
      setExs(e); setCivis({});
      setAn({ arquivo: f.name, lido, ...m, semCad: [...semCad.values()].sort((a, b) => b.n - a.n), porEx: [...porEx.entries()].sort((a, b) => b[0] - a[0]) });
    } catch (err) {
      console.error('Importação do PAF:', err);
      const m = msgErro(err);
      const ilegivel = /NotReadable|could not be read|permission/i.test(String((err as any)?.name || '') + ' ' + m);
      setErroLeitura(ilegivel ? `O navegador não conseguiu ler o arquivo. Feche-o no Excel e, se ele estiver no OneDrive, na rede ou aberto direto do e-mail/SEI, copie-o para a Área de Trabalho e escolha a cópia. (${m})` : m);
    } finally { setLendo(false); }
  };
  const fora = (a: number) => exs[a]?.situacao === 'IGNORAR';
  const suspeito = (a: number, n: number) => a > new Date().getFullYear() + 1 || (n <= 3 && a < new Date().getFullYear() - 3);
  const aImportar: PeriodoImportado[] = an ? an.periodos.filter((p: PeriodoImportado) => !fora(p.exercicio)) : [];
  const importar = async () => {
    const lista = aImportar;
    const cad = an.semCad.filter((s: any) => civis[s.matricula]).map((s: any) => ({ matricula: s.matricula, nome: s.nome || `SERVIDOR ${s.matricula}`, ome_id: civis[s.matricula] }));
    const tot: any = { importados: 0, repetidos: 0, sem_cadastro: 0, civis_cadastrados: 0 };
    try {
      for (let i = 0; i < lista.length; i += 800) {
        setProg(`Gravando ${Math.min(i + 800, lista.length)} de ${lista.length}…`);
        const r = await rpc<any>('ferias_importar', {
          p_exercicios: i === 0 ? Object.entries(exs).filter(([, v]) => v.situacao !== 'IGNORAR').map(([ano, v]) => ({ ano: Number(ano), situacao: v.situacao, publicacao: v.publicacao || null })) : [],
          p_civis: i === 0 ? cad : [],
          p_linhas: lista.slice(i, i + 800).map((p) => ({ matricula: p.matricula, exercicio: p.exercicio, inicio: p.inicio, dias: p.dias, previsto: p.previsto, estimada: p.estimada, sei: p.sei, observacao: p.observacao })),
        });
        Object.keys(tot).forEach((k) => (tot[k] += r[k] || 0));
      }
      setRes(tot); recarregarTudo();
    } catch (e) { toast(msgErro(e), 'erro'); } finally { setProg(null); }
  };
  return <>
    <Cartao titulo="Importar a planilha do PAF">
      <p className="nota">Use uma única vez, para trazer o histórico. A planilha é lida no seu computador. Linhas com datas de reprogramação viram períodos com as datas reais; linhas só com o mês previsto viram 30 dias a partir do dia 1º (ou 2 × 15), marcadas como "dia estimado". Repetições são ignoradas, e as férias já lançadas como afastamento são aproveitadas, sem duplicar. As regras da Portaria 312 não bloqueiam o histórico.</p>
      <Botao variante="primario" disabled={lendo || !!prog} onClick={() => ref.current?.click()}>{lendo ? 'Lendo…' : 'Escolher planilha (.xlsx)'}</Botao>
      <input ref={ref} type="file" accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) ler(f); }} />
      {arqLido && <p className="nota">{lendo ? 'Lendo' : 'Arquivo'}: {arqLido}{lendo ? '… (planilhas grandes levam até 1 minuto)' : ''}</p>}
      {erroLeitura && <Aviso tom="erro">{erroLeitura}</Aviso>}
    </Cartao>
    {res && <Aviso tom="ok">Importação concluída: {res.importados} períodos gravados, {res.repetidos} já existiam, {res.civis_cadastrados} servidores civis cadastrados, {res.sem_cadastro} períodos sem cadastro ficaram de fora. <button className="link" onClick={() => nav('/ferias?aba=quadro')}>Ver o quadro de férias</button></Aviso>}
    {an && !res && <>
      <div className="mini-kpis">
        <div><strong>{an.lido.linhas.length}</strong><span>linhas lidas ({an.lido.abas.join(', ')})</span></div>
        <div><strong>{an.periodos.length}</strong><span>períodos a importar</span></div>
        <div><strong>{an.periodos.filter((p: any) => p.estimada).length}</strong><span>com dia estimado</span></div>
        <div><strong>{an.repetidas}</strong><span>repetidos na planilha</span></div>
        {an.deduzidas > 0 && <div title="Linhas sem código PAF cujo mês previsto cai na janela do exercício anterior ao da aba (Portaria 312, art. 1º: o exercício N vai de 01/12/N a 31/12/N+1)"><strong>{an.deduzidas}</strong><span>sem código: exercício anterior pela janela</span></div>}
        <div><strong>{an.certidoes.length}</strong><span>certidões (fora)</span></div>
        <div><strong>{an.semCad.length}</strong><span>matrículas sem cadastro</span></div>
      </div>
      <Cartao titulo="Exercícios encontrados">
        {an.porEx.some(([a, n]: [number, number]) => suspeito(a, n)) && <p className="nota">Os exercícios marcados com ⚠ têm poucos períodos ou estão no futuro distante — provavelmente erro de digitação na coluna PAF. Confira na planilha; os que estiverem como "não importar" ficam de fora.</p>}
        <table className="tabela compacta"><thead><tr><th>PAF</th><th>Períodos</th><th>Situação</th><th>Publicação</th></tr></thead>
          <tbody>{an.porEx.map(([a, n]: [number, number]) => (
            <tr key={a} className={fora(a) ? 'linha-apagada' : undefined}><td>{suspeito(a, n) ? `⚠ ${a}` : a}</td><td>{n}</td>
              <td><select value={exs[a]?.situacao} onChange={(e) => setExs({ ...exs, [a]: { ...exs[a], situacao: e.target.value } })}><option value="PUBLICADO">publicado</option><option value="ELABORACAO">em elaboração (vira proposta)</option><option value="IGNORAR">não importar</option></select></td>
              <td><input value={exs[a]?.publicacao || ''} disabled={fora(a)} onChange={(e) => setExs({ ...exs, [a]: { ...exs[a], publicacao: e.target.value } })} placeholder="BGE nº" /></td></tr>
          ))}</tbody></table>
      </Cartao>
      {an.semCad.length > 0 && <Cartao titulo={`Matrículas sem cadastro (${an.semCad.length})`}>
        <p className="nota">Não estão no efetivo nem entre os servidores civis. Marque a OME só dos que são servidores civis para cadastrá-los; os demais (militares fora do cadastro, inativos) ficam de fora e devem ser incluídos pelo Efetivo antes.</p>
        <Tabela linhas={an.semCad} chave={(r: any) => r.matricula} compacta porPagina={15} colunas={[
          { id: 'matricula', titulo: 'Matrícula' }, { id: 'nome', titulo: 'Nome', render: (r: any) => r.nome || <span className="nota">sem nome na planilha</span> },
          { id: 'ome', titulo: 'OME na planilha' }, { id: 'n', titulo: 'Períodos' },
          { id: 'civil', titulo: 'Cadastrar como civil na OME', ordenavel: false, render: (r: any) => (
            <select value={civis[r.matricula] ?? ''} onChange={(e) => setCivis({ ...civis, [r.matricula]: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">não cadastrar</option>{(dom?.omes || []).filter((o) => o.ativo).map((o) => <option key={o.id} value={o.id}>{o.sigla}{o.id === omeDe(r.ome) ? ' (sugerida)' : ''}</option>)}
            </select>) },
        ]} />
      </Cartao>}
      {(an.invalidas.length > 0 || an.certidoes.length > 0) && <details><summary>Linhas que não serão importadas ({an.invalidas.length + an.certidoes.length})</summary>
        <Tabela linhas={[...an.invalidas.map((x: any) => ({ ...x.l, motivo: x.motivo })), ...an.certidoes.map((l: any) => ({ ...l, motivo: `certidão (${l.paf}): registro de férias não gozadas, tratado à parte (art. 9º)` }))]}
          chave={(r: any) => `${r.aba}|${r.linha}`} compacta porPagina={20} colunas={[{ id: 'aba', titulo: 'Aba' }, { id: 'linha', titulo: 'Linha' }, { id: 'matricula', titulo: 'Matrícula' }, { id: 'motivo', titulo: 'Motivo' }]} />
      </details>}
      <div className="form-acoes"><Botao variante="primario" disabled={!!prog} onClick={importar}>{prog || `Importar ${aImportar.length} períodos`}</Botao></div>
    </>}
  </>;
}

// ======================================================================= ficha do militar
export function FeriasMilitar({ pessoa }: { pessoa: { militar_id?: string; civil_id?: string } }) {
  const col = pessoa.militar_id ? 'militar_id' : 'civil_id';
  const id = pessoa.militar_id || pessoa.civil_id;
  const nav = useNavigate();
  const { gestaoGlobal } = useAuth();
  const exercicios = useExercicios();
  const [aberta, setAberta] = useState<Pessoa | null>(null);
  const abrir = async () => {
    const { data } = pessoa.militar_id
      ? await supabase.from('v_militar').select('id,matricula,nome,nome_guerra,posto_completo,posto_ordem,ordem_antiguidade,ome_id,ome_sigla').eq('id', id).maybeSingle()
      : await supabase.from('servidor_civil').select('id,matricula,nome,ome_id').eq('id', id).maybeSingle();
    if (data) setAberta({ ...(data as any), tipo: pessoa.militar_id ? 'MILITAR' : 'CIVIL', posto_completo: (data as any).posto_completo || 'Civil', posto_ordem: (data as any).posto_ordem ?? 99, ordem_antiguidade: (data as any).ordem_antiguidade ?? null, ome_sigla: (data as any).ome_sigla || '' });
  };
  const exAtual = exercicios.dados?.find((e: any) => e.ano === anoAtualGozo()) || exercicios.dados?.[0];
  const lista = useConsulta(`ferias|ficha|${id}`, async () => { const { data, error } = await supabase.from('v_ferias').select('*').eq(col, id).order('data_inicio', { ascending: false }); if (error) throw error; return data || []; }, 15_000);
  if (lista.erro) return <Aviso tom="erro">{lista.erro}</Aviso>;
  if (!lista.dados) return <Carregando />;
  const exs = [...new Set<number>(lista.dados.map((p: any) => p.exercicio))].sort((a, b) => b - a);
  return (
    <div className="cartao"><div className="cartao-corpo">
      <div className="exp-cab"><p className="nota">Férias pelo PAF (Portaria 312).{gestaoGlobal ? '' : ' Lançadas e alteradas pela DGP.'}</p>
        <span className="acoes">{gestaoGlobal && exAtual && <Botao pequeno variante="primario" onClick={abrir}>Incluir / reprogramar férias</Botao>}<Botao pequeno onClick={() => nav('/ferias?aba=quadro')}>Abrir quadro de férias</Botao></span></div>
      {!exs.length ? <Vazio>Nenhum período de férias registrado.</Vazio> : exs.map((e) => {
        const ps = lista.dados!.filter((p: any) => p.exercicio === e);
        const d = ps.filter(ativo).reduce((s: number, p: any) => s + diasEfetivos(p), 0);
        return <div key={e} className="ferias-ex">
          <h4>PAF {e} · {d} de 30 dias{d < 30 ? ` · saldo ${30 - d}` : ''}</h4>
          <Tabela linhas={ps} chave={(r: any) => r.id} compacta colunas={[
            { id: 'data_inicio', titulo: 'Início', render: (r: any) => fmtData(r.data_inicio) }, { id: 'data_fim', titulo: 'Fim', render: (r: any) => fmtData(r.data_fim) },
            { id: 'dias', titulo: 'Dias', render: (r: any) => (r.situacao === 'INTERROMPIDA' ? `${r.dias_gozados} de ${r.dias}` : r.dias) },
            { id: 'status', titulo: 'Situação', render: (r: any) => <Badge tom={STATUS[r.status]?.tom}>{STATUS[r.status]?.rotulo}</Badge> },
            { id: 'doc', titulo: 'Publicação / SEI', ordenavel: false, render: (r: any) => [r.publicacao, r.processo_sei].filter(Boolean).join(' · ') },
          ]} />
        </div>;
      })}
      {aberta && exAtual && <PessoaFerias pessoa={aberta} exercicio={exAtual} editavel={gestaoGlobal} onFechar={() => { setAberta(null); lista.recarregar(); }} />}
    </div></div>
  );
}
