// Relatórios de férias: simplificado, completo (cópia do PAF), resumo por região e OME, mapa mensal,
// de férias no mês, pendências e o arquivo de lote do SGP no layout da SAD (só DGP).
// Abrangência (todo o CBMPE, uma região ou OMEs escolhidas) e filtros valem para todos.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { secoesDa, useDominios } from '../lib/dominios';
import { mapaRegioes } from '../lib/regioes';
import { exportarPdf, exportarXlsx, fmtData, hojeISO, msgErro, rpc } from '../lib/util';
import { STATUS, ativo, diasEfetivos, janela, rotuloMes } from '../lib/ferias';
import { FILTROS_VAZIOS, SITUACOES_EX, contarFiltros, descreverFiltros, passaFiltro, type FiltrosFerias } from '../lib/feriasFiltros';
import { invalidar } from '../lib/consulta';
import { Aviso, Botao, Campo, Carregando, Modal, useToast } from '../components/ui';
import type { DadosFerias, OpcoesSad } from '../lib/feriasRelatorios';

type Tipo = 'simples' | 'completo' | 'resumo' | 'mapa' | 'mes' | 'pendencias' | 'sad';
type Agrupar = 'regiao_ome' | 'ome' | 'nenhum';
type Abrangencia = { modo: 'todas' | 'regiao' | 'omes'; regiao: string; omes: number[] };
const OPCOES: { id: Tipo; rotulo: string; desc: string; dgp?: boolean }[] = [
  { id: 'simples', rotulo: 'Relação simplificada', desc: 'Uma linha por militar/servidor: períodos e dias do exercício, por OME e antiguidade. Base para a publicação. PDF ou Excel.' },
  { id: 'completo', rotulo: 'Relação completa (cópia do PAF)', desc: 'Excel com todas as informações: resumo por pessoa, todos os períodos (inclusive reprogramados, interrompidos e não gozados), reprogramações e dados do exercício. Serve de cópia de segurança.' },
  { id: 'resumo', rotulo: 'Resumo por região e OME', desc: 'Uma linha por OME, com subtotais por região: efetivo, 30 dias programados, menos de 30, sem previsão, em gozo hoje, pico mensal e meses acima do limite de 10%. PDF ou Excel.' },
  { id: 'mapa', rotulo: 'Mapa mensal', desc: 'Excel com o quadro de férias: uma linha por pessoa, uma coluna por mês e o total em férias em cada mês.' },
  { id: 'mes', rotulo: 'De férias em um mês', desc: 'Quem está de férias no mês escolhido, com início, fim e dias. Útil para escalas. PDF ou Excel.' },
  { id: 'pendencias', rotulo: 'Pendências do exercício', desc: 'Sem previsão, com menos de 30 dias, com exceção pendente ou com dia estimado. PDF ou Excel.' },
  { id: 'sad', rotulo: 'Lote do SGP (layout SAD)', desc: 'Arquivo .csv para a transação 131 do SGP ("Atualização de gozo de férias em lote") e a planilha GERAL_layout_ferias_importacao para conferência.', dgp: true },
];
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[º°ª]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fimMes = (iso: string) => `${iso.slice(0, 8)}${String(new Date(+iso.slice(0, 4), +iso.slice(5, 7), 0).getDate()).padStart(2, '0')}`;

export default function RelatoriosFerias({ exercicio, filtrosTela = FILTROS_VAZIOS, regiaoTela = '', onFechar }: {
  exercicio: any; filtrosTela?: FiltrosFerias; regiaoTela?: string; onFechar: () => void;
}) {
  const { escopo, gestaoGlobal, global, ctx } = useAuth();
  const dom = useDominios();
  const toast = useToast();
  const regioes = useMemo(() => mapaRegioes(dom), [dom]);
  const meses = janela(exercicio.ano);
  const [tipo, setTipo] = useState<Tipo>('simples');
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [mes, setMes] = useState(() => { const h = new Date().toISOString().slice(0, 8) + '01'; return meses.includes(h) ? h : meses[0]; });
  const [sad, setSad] = useState<OpcoesSad | null>(null);
  const [mod, setMod] = useState<typeof import('../lib/feriasRelatorios') | null>(null);
  const [f, setF] = useState<FiltrosFerias>({ ...filtrosTela, busca: '' });
  const [abr, setAbr] = useState<Abrangencia>(() => escopo ? { modo: 'omes', regiao: '', omes: [escopo] } : regiaoTela ? { modo: 'regiao', regiao: regiaoTela, omes: [] } : { modo: 'todas', regiao: '', omes: [] });
  const [agrupar, setAgrupar] = useState<Agrupar | null>(null);

  // ----------------------------------------------------------- OMEs que o usuário pode escolher
  const permitidas = useMemo(() => (dom?.omes || [])
    .filter((o) => o.ativo && (global || ctx?.omes.some((x) => x.id === o.id)))
    .map((o) => ({ ...o, reg: regioes.de(o.id) }))
    .sort((a, b) => a.reg.ordem - b.reg.ordem || (a.reg.id === a.id ? -1 : b.reg.id === b.id ? 1 : 0) || a.ordem - b.ordem || a.sigla.localeCompare(b.sigla)), [dom, global, ctx, regioes]);
  const regioesComOme = regioes.lista.filter((r) => permitidas.some((o) => o.reg.rotulo === r.rotulo));
  const temRegioes = regioesComOme.some((r) => r.id != null);
  const selecionadas = useMemo(() => new Set(
    abr.modo === 'todas' ? permitidas.map((o) => o.id)
      : abr.modo === 'regiao' ? permitidas.filter((o) => o.reg.rotulo === abr.regiao).map((o) => o.id)
        : abr.omes.filter((id) => permitidas.some((o) => o.id === id)),
  ), [abr, permitidas]);
  const unica = selecionadas.size === 1 ? [...selecionadas][0] : null;
  const regioesSel = new Set(permitidas.filter((o) => selecionadas.has(o.id)).map((o) => o.reg.rotulo));
  const modoAgrupar: Agrupar = agrupar ?? (regioesSel.size > 1 ? 'regiao_ome' : selecionadas.size > 1 ? 'ome' : 'nenhum');

  // ----------------------------------------------------------- carga (uma OME, ou tudo o que o usuário enxerga)
  const chave = unica != null ? String(unica) : 'todas';
  const cache = useRef(new Map<string, DadosFerias>());
  const [dados, setDados] = useState<DadosFerias | null>(null);
  useEffect(() => {
    let vivo = true;
    const pronto = cache.current.get(chave) || cache.current.get('todas');   // tudo já carregado serve para qualquer recorte
    setDados(pronto || null); setErro(null);
    import('../lib/feriasRelatorios').then(async (m) => {
      if (!vivo) return;
      setMod(m); setSad((s) => s || m.opcoesSadPadrao(exercicio));
      if (pronto) return;
      try { const d = await m.carregar(exercicio.ano, unica != null ? [unica] : null); cache.current.set(chave, d); if (vivo) setDados(d); } catch (e) { if (vivo) setErro(msgErro(e)); }
    });
    return () => { vivo = false; };
  }, [exercicio.ano, chave]); // eslint-disable-line

  // ----------------------------------------------------------- recorte: abrangência + filtros, já ordenado
  const nFiltros = contarFiltros(f);
  const ordemOme = useMemo(() => new Map(permitidas.map((o, i) => [o.id, i])), [permitidas]);
  const recorte = useMemo<(DadosFerias & { base: any[] }) | null>(() => {
    if (!dados) return null;
    const enriquecer = (r: any) => { const g = regioes.de(r.ome_id); return { ...r, regiao: g.rotulo, _rg: g.ordem, _om: ordemOme.get(r.ome_id) ?? 999 }; };
    const cmp = (a: any, b: any) => a._rg - b._rg || a._om - b._om || (a.posto_ordem ?? 99) - (b.posto_ordem ?? 99)
      || (a.ordem_antiguidade ?? 9e9) - (b.ordem_antiguidade ?? 9e9) || (a.nome || '').localeCompare(b.nome || '');
    const vig = new Map<string, any[]>();
    dados.periodos.filter(ativo).forEach((p) => { if (!vig.has(p.pessoa_id)) vig.set(p.pessoa_id, []); vig.get(p.pessoa_id)!.push(p); });
    const base = dados.pessoas.filter((p) => selecionadas.has(p.ome_id)).map(enriquecer);
    const pessoas = base.filter((p) => passaFiltro(p, vig.get(p.id) || [], exercicio.ano, f)).sort(cmp);
    const ids = new Set(pessoas.map((p) => p.id));
    // sem filtros a cópia leva todos os períodos das OMEs (inclusive de quem já saiu); com filtros, só das pessoas filtradas
    const entra = (omeId: number, pessoa: string) => (nFiltros ? ids.has(pessoa) : selecionadas.has(omeId));
    const periodos = dados.periodos.filter((p) => entra(p.ome_id, p.pessoa_id)).map(enriquecer)
      .sort((a, b) => cmp(a, b) || a.data_inicio.localeCompare(b.data_inicio));
    const reprog = dados.reprog.filter((r) => entra(r.ome_id, r.militar_id || r.civil_id)).map(enriquecer);
    return { pessoas, periodos, reprog, base };
  }, [dados, selecionadas, f, nFiltros, regioes, ordemOme, exercicio.ano]);

  // ----------------------------------------------------------- textos
  const siglas = permitidas.filter((o) => selecionadas.has(o.id)).map((o) => o.sigla);
  const abrTxt = abr.modo === 'todas' ? (global ? 'todo o CBMPE' : 'todas as suas OMEs')
    : abr.modo === 'regiao' ? `${abr.regiao} (${siglas.length} OME${siglas.length === 1 ? '' : 's'})`
      : siglas.length <= 4 ? siglas.join(', ') || 'nenhuma OME' : `${siglas.length} OMEs escolhidas`;
  const filtrosTxt = descreverFiltros(f, dom);
  const sufixo = '_' + slug(abr.modo === 'todas' ? (global ? 'CBMPE' : 'minhas-OMEs') : abr.modo === 'regiao' ? abr.regiao : siglas.length === 1 ? siglas[0] : `${siglas.length}OMEs`) + (nFiltros ? '_filtrado' : '');
  const sub = (n: string) => [abrTxt, filtrosTxt, n].filter(Boolean).join(' · ');
  const multi = selecionadas.size > 1;
  const grupo = modoAgrupar === 'regiao_ome' ? (r: any) => `${r.regiao} · ${r.ome_sigla}` : modoAgrupar === 'ome' ? (r: any) => r.ome_sigla : undefined;
  const colsLocal = multi && modoAgrupar === 'nenhum'
    ? [...(regioesSel.size > 1 ? [{ titulo: 'Região', valor: (r: any) => r.regiao, largura: 10 }] : []), { titulo: 'OME', valor: (r: any) => r.ome_sigla, largura: 10 }]
    : [];

  const exec = async (fn: () => Promise<void> | void) => {
    setGerando(true); setErro(null);
    try { await fn(); } catch (e) { setErro(msgErro(e)); } finally { setGerando(false); }
  };
  const pp = recorte && mod ? mod.porPessoa(recorte) : [];
  const nomeArq = (s: string) => `paf_${exercicio.ano}${sufixo}${s}`;

  // ----------------------------------------------------------- relatórios em lista (PDF/Excel)
  const simples = (fmt: 'pdf' | 'xlsx') => exec(async () => {
    const max = Math.max(2, ...pp.map((p) => p.ps.length));
    const cols = [
      { titulo: 'Posto/Grad.', valor: (r: any) => r.posto_completo, largura: 12 }, { titulo: 'Matrícula', valor: (r: any) => r.matricula, largura: 11 },
      { titulo: 'Nome', valor: (r: any) => r.nome, largura: 38 }, ...colsLocal,
      ...Array.from({ length: max }, (_, i) => ({ titulo: `${i + 1}º período`, valor: (r: any) => (r.ps[i] ? `${fmtData(r.ps[i].data_inicio)} a ${fmtData(r.ps[i].data_fim)}` : ''), largura: 24 })),
      { titulo: 'Dias', valor: (r: any) => r.dias, largura: 6 },
    ];
    const t = `Plano Anual de Férias ${exercicio.ano}`;
    if (fmt === 'pdf') await exportarPdf(nomeArq(''), t, sub(`${pp.length} militar(es)/servidor(es)`), cols, pp, grupo);
    else await exportarXlsx(nomeArq(''), t, cols, pp, grupo);
  });
  const noMes = (fmt: 'pdf' | 'xlsx') => exec(async () => {
    const fm = fimMes(mes);
    const linhas = recorte!.periodos.filter((p) => ativo(p) && p.data_inicio <= fm && p.data_fim >= mes);
    const cols = [
      { titulo: 'Posto/Grad.', valor: (r: any) => r.posto_completo, largura: 12 }, { titulo: 'Matrícula', valor: (r: any) => r.matricula, largura: 11 },
      { titulo: 'Nome', valor: (r: any) => r.nome, largura: 36 }, ...colsLocal,
      { titulo: 'Seção', valor: (r: any) => r.secao_nome || '', largura: 16 },
      { titulo: 'Início', valor: (r: any) => fmtData(r.data_inicio), largura: 11 }, { titulo: 'Fim', valor: (r: any) => fmtData(r.data_fim), largura: 11 },
      { titulo: 'Dias', valor: (r: any) => diasEfetivos(r), largura: 6 }, { titulo: 'Situação', valor: (r: any) => STATUS[r.status]?.rotulo, largura: 12 },
    ];
    const t = `De férias em ${rotuloMes(mes)} — PAF ${exercicio.ano}`;
    const arq = `ferias_${mes.slice(0, 7)}${sufixo}`;
    if (fmt === 'pdf') await exportarPdf(arq, t, sub(`${linhas.length} período(s)`), cols, linhas, grupo);
    else await exportarXlsx(arq, t, cols, linhas, grupo);
  });
  const pendencias = (fmt: 'pdf' | 'xlsx') => exec(async () => {
    const linhas: any[] = [];
    pp.forEach((p) => {
      if (!p.dias) linhas.push({ ...p, pend: 'Sem previsão no exercício', det: '' });
      else if (p.dias < 30) linhas.push({ ...p, pend: 'Menos de 30 dias', det: `${p.dias} dias · saldo ${p.saldo}` });
      p.ps.filter((x: any) => x.excecao && !x.excecao_aprovada_em).forEach((x: any) => linhas.push({ ...p, pend: 'Exceção pendente', det: `${fmtData(x.data_inicio)}: ${x.excecao}` }));
      p.ps.filter((x: any) => x.data_estimada).forEach((x: any) => linhas.push({ ...p, pend: 'Dia estimado na importação', det: `${fmtData(x.data_inicio)} (${x.dias}d)` }));
    });
    const cols = [
      { titulo: 'Pendência', valor: (r: any) => r.pend, largura: 24 }, { titulo: 'Posto/Grad.', valor: (r: any) => r.posto_completo, largura: 12 },
      { titulo: 'Matrícula', valor: (r: any) => r.matricula, largura: 11 }, { titulo: 'Nome', valor: (r: any) => r.nome, largura: 36 },
      ...colsLocal, { titulo: 'Detalhe', valor: (r: any) => r.det, largura: 40 },
    ];
    const t = `Pendências do PAF ${exercicio.ano}`;
    if (fmt === 'pdf') await exportarPdf(nomeArq('_pendencias'), t, sub(`${linhas.length} pendência(s)`), cols, linhas, grupo);
    else await exportarXlsx(nomeArq('_pendencias'), t, cols, linhas, grupo);
  });

  // ----------------------------------------------------------- resumo por região e OME
  const resumo = useMemo(() => {
    if (!recorte || tipo !== 'resumo') return [];
    const hoje = hojeISO();
    const vig = recorte.periodos.filter((p) => ativo(p) && p.exercicio === exercicio.ano);
    const diasDe = new Map<string, number>(); const emGozo = new Set<string>();
    vig.forEach((p) => { diasDe.set(p.pessoa_id, (diasDe.get(p.pessoa_id) || 0) + diasEfetivos(p)); if (p.data_inicio <= hoje && p.data_fim >= hoje) emGozo.add(p.pessoa_id); });
    // pico e limite de 10% olham a OME inteira (sem filtros), como o art. 5º
    const vigTodos = (dados?.periodos || []).filter((p) => ativo(p) && p.exercicio === exercicio.ano);
    const pico = (omes: Set<number>) => Math.max(0, ...meses.map((m) => { const fm = fimMes(m); return new Set(vigTodos.filter((p) => omes.has(p.ome_id) && p.data_inicio <= fm && p.data_fim >= m).map((p) => p.pessoa_id)).size; }));
    const linha = (rotulo: { regiao: string; ome: string }, pes: any[], baseN: number, omes: Set<number>, porOme: boolean) => {
      const completos = pes.filter((p) => (diasDe.get(p.id) || 0) >= 30).length;
      const menos = pes.filter((p) => { const d = diasDe.get(p.id) || 0; return d > 0 && d < 30; }).length;
      const ensino = porOme && dom?.omes.find((o) => omes.has(o.id))?.orgao_ensino;
      const lim = porOme && !ensino ? Math.max(1, Math.floor(baseN * 0.1)) : null;
      const acima = lim ? meses.filter((m) => { const fm = fimMes(m); return new Set(vigTodos.filter((p) => omes.has(p.ome_id) && p.data_inicio <= fm && p.data_fim >= m).map((p) => p.pessoa_id)).size > lim; }).length : null;
      return { ...rotulo, efetivo: pes.length, completos, menos, sem: pes.length - completos - menos, pct: pes.length ? Math.round((100 * completos) / pes.length) : 0,
        gozo: pes.filter((p) => emGozo.has(p.id)).length, pico: pico(omes), limite: porOme ? (ensino ? 'ensino' : lim) : '', acima: acima ?? '', total: !porOme };
    };
    const out: any[] = [];
    const omesSel = permitidas.filter((o) => selecionadas.has(o.id));
    const porRegiao = new Map<string, typeof omesSel>();
    omesSel.forEach((o) => { if (!porRegiao.has(o.reg.rotulo)) porRegiao.set(o.reg.rotulo, []); porRegiao.get(o.reg.rotulo)!.push(o); });
    porRegiao.forEach((lista, reg) => {
      lista.forEach((o) => out.push(linha({ regiao: reg, ome: o.sigla }, recorte.pessoas.filter((p) => p.ome_id === o.id), recorte.base.filter((p) => p.ome_id === o.id).length, new Set([o.id]), true)));
      if (porRegiao.size > 1 && lista.length > 1) out.push(linha({ regiao: reg, ome: `Subtotal ${reg}` }, recorte.pessoas.filter((p) => p.regiao === reg), 0, new Set(lista.map((o) => o.id)), false));
    });
    if (omesSel.length > 1) out.push(linha({ regiao: porRegiao.size > 1 ? 'Total' : [...porRegiao.keys()][0], ome: abr.modo === 'todas' ? (global ? 'Total do CBMPE' : 'Total') : abr.modo === 'regiao' ? `Total ${abr.regiao}` : `Total das ${omesSel.length} OMEs` }, recorte.pessoas, 0, new Set(omesSel.map((o) => o.id)), false));
    return out;
  }, [recorte, tipo, dados, selecionadas, permitidas, dom, exercicio.ano, abrTxt]); // eslint-disable-line
  const gerarResumo = (fmt: 'pdf' | 'xlsx') => exec(async () => {
    const cols = [
      ...(regioesSel.size > 1 || temRegioes ? [{ titulo: 'Região', valor: (r: any) => r.regiao, largura: 11 }] : []),
      { titulo: 'OME', valor: (r: any) => r.ome, largura: 20 }, { titulo: 'Efetivo', valor: (r: any) => r.efetivo, largura: 8 },
      { titulo: '30 dias', valor: (r: any) => r.completos, largura: 8 }, { titulo: '% com 30 dias', valor: (r: any) => `${r.pct}%`, largura: 9 },
      { titulo: 'Menos de 30', valor: (r: any) => r.menos, largura: 9 }, { titulo: 'Sem previsão', valor: (r: any) => r.sem, largura: 9 },
      { titulo: 'Em gozo hoje', valor: (r: any) => r.gozo, largura: 9 }, { titulo: 'Pico mensal', valor: (r: any) => r.pico, largura: 9 },
      { titulo: 'Limite 10%', valor: (r: any) => r.limite, largura: 9 }, { titulo: 'Meses acima', valor: (r: any) => r.acima, largura: 9 },
    ];
    const t = `Resumo do PAF ${exercicio.ano} por região e OME`;
    const s = sub(`posição de ${fmtData(hojeISO())}${nFiltros ? ' · pico, limite e meses acima consideram a OME inteira' : ''}`);
    if (fmt === 'pdf') await exportarPdf(nomeArq('_resumo'), t, s, cols, resumo);
    else await exportarXlsx(nomeArq('_resumo'), t, cols, resumo);
  });

  // ----------------------------------------------------------- lote SAD
  const lote = recorte && mod && sad && tipo === 'sad' ? mod.montarLoteSad(recorte, exercicio, sad) : null;
  const setP = (k: keyof OpcoesSad['publ'], v: string) => setSad((s) => s && { ...s, publ: { ...s.publ, [k]: v } });
  const setFx = (k: keyof OpcoesSad['fixos'], v: string) => setSad((s) => s && { ...s, fixos: { ...s.fixos, [k]: v } });

  // ----------------------------------------------------------- opções dos filtros
  const postos = [...(dom?.postos || [])].sort((a, b) => a.ordem - b.ordem);
  const anosIngresso = [...new Set((recorte?.base || []).map((p: any) => p.ano_ingresso).filter(Boolean))].sort((a: any, b: any) => b - a);
  const muda = (k: keyof FiltrosFerias, v: string) => setF((x) => ({ ...x, [k]: v }));
  const marcar = (ids: number[], on: boolean) => setAbr((a) => ({ ...a, omes: on ? [...new Set([...a.omes, ...ids])] : a.omes.filter((x) => !ids.includes(x)) }));
  useEffect(() => { if (unica == null && f.secao) setF((x) => ({ ...x, secao: '' })); }, [unica]); // eslint-disable-line

  const visiveis = OPCOES.filter((o) => !o.dgp || gestaoGlobal);
  const pronto = !!recorte && selecionadas.size > 0;
  const botoes = (fn: (fmt: 'pdf' | 'xlsx') => void) => <><Botao disabled={gerando || !pronto} onClick={() => fn('pdf')}>PDF</Botao><Botao variante="primario" disabled={gerando || !pronto} onClick={() => fn('xlsx')}>Excel</Botao></>;
  return (
    <Modal aberto largo titulo={`Relatórios de férias · PAF ${exercicio.ano}`} onFechar={onFechar} rodape={<>
      <Botao onClick={onFechar}>Fechar</Botao>
      {tipo === 'simples' && botoes(simples)}
      {tipo === 'completo' && <Botao variante="primario" disabled={gerando || !pronto} onClick={() => exec(() => mod!.backupCompleto(recorte!, exercicio, abrTxt, filtrosTxt, sufixo))}>Gerar Excel completo</Botao>}
      {tipo === 'resumo' && botoes(gerarResumo)}
      {tipo === 'mapa' && <Botao variante="primario" disabled={gerando || !pronto} onClick={() => exec(() => mod!.mapaMensal(recorte!, exercicio, abrTxt, filtrosTxt, sufixo))}>Gerar mapa (Excel)</Botao>}
      {tipo === 'mes' && botoes(noMes)}
      {tipo === 'pendencias' && botoes(pendencias)}
      {lote && <>
        <Botao disabled={gerando || !lote.linhas.length} onClick={() => exec(() => mod!.baixarPlanilhaSad(lote, exercicio, sad!, sufixo))}>Planilha para conferir</Botao>
        <Botao variante="primario" disabled={gerando || !lote.linhas.length} onClick={() => exec(() => mod!.baixarCsvSad(lote, exercicio, sad!, sufixo))}>Baixar .csv para o SGP</Botao>
      </>}
    </>}>
      <fieldset className="opcoes-relatorio">
        <legend className="campo-rotulo">Escolha o relatório</legend>
        {visiveis.map((o) => (
          <label key={o.id} className={`opcao-relatorio ${tipo === o.id ? 'ativa' : ''}`}>
            <input type="radio" name="tipo-relatorio" checked={tipo === o.id} onChange={() => setTipo(o.id)} />
            <span><strong>{o.rotulo}</strong><span className="nota">{o.desc}</span></span>
          </label>
        ))}
      </fieldset>

      {permitidas.length > 1 && <>
        <h4>Abrangência</h4>
        <div className="form-grade">
          <Campo rotulo="Incluir">
            <select value={abr.modo} onChange={(e) => {
              const modo = e.target.value as Abrangencia['modo'];
              setAbr((a) => ({ ...a, modo, regiao: a.regiao || regioesComOme.find((r) => r.id != null)?.rotulo || '', omes: a.omes.length ? a.omes : escopo ? [escopo] : [] }));
            }}>
              <option value="todas">{global ? 'Todo o CBMPE' : 'Todas as minhas OMEs'}</option>
              {temRegioes && <option value="regiao">Uma região</option>}
              <option value="omes">OMEs escolhidas</option>
            </select>
          </Campo>
          {abr.modo === 'regiao' && <Campo rotulo="Região">
            <select value={abr.regiao} onChange={(e) => setAbr({ ...abr, regiao: e.target.value })}>
              {regioesComOme.map((r) => <option key={r.rotulo} value={r.rotulo}>{r.rotulo}</option>)}
            </select>
          </Campo>}
          {multi && <Campo rotulo="Agrupar por">
            <select value={modoAgrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
              {regioesSel.size > 1 && <option value="regiao_ome">Região e OME</option>}
              <option value="ome">OME</option>
              <option value="nenhum">Sem grupos (coluna OME)</option>
            </select>
          </Campo>}
        </div>
        {abr.modo === 'omes' && <div className="lista-omes" role="group" aria-label="OMEs do relatório">
          {regioesComOme.map((r) => {
            const daReg = permitidas.filter((o) => o.reg.rotulo === r.rotulo);
            const todas = daReg.every((o) => selecionadas.has(o.id));
            return (
              <fieldset key={r.rotulo}>
                <legend>{r.rotulo} <button type="button" className="link" onClick={() => marcar(daReg.map((o) => o.id), !todas)}>{todas ? 'desmarcar' : 'marcar todas'}</button></legend>
                {daReg.map((o) => (
                  <label key={o.id} className="check"><input type="checkbox" checked={selecionadas.has(o.id)} onChange={(e) => marcar([o.id], e.target.checked)} /> {o.sigla}</label>
                ))}
              </fieldset>
            );
          })}
        </div>}
      </>}

      <details className="detalhes" open={nFiltros > 0}>
        <summary>Filtros{nFiltros ? ` (${nFiltros})` : ''}</summary>
        <div className="form-grade">
          <Campo rotulo="Situação no exercício"><select value={f.so} onChange={(e) => muda('so', e.target.value)}>{SITUACOES_EX.map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></Campo>
          <Campo rotulo="Posto/grad."><select value={f.posto} onChange={(e) => muda('posto', e.target.value)}>
            <option value="">Todos</option>{postos.map((p) => <option key={p.sigla} value={p.sigla}>{p.sigla}</option>)}<option value="CIVIL">Servidores civis</option>
          </select></Campo>
          <Campo rotulo="Quadro"><select value={f.quadro} onChange={(e) => muda('quadro', e.target.value)}>
            <option value="">Todos</option>{dom?.quadros.map((q) => <option key={q.sigla} value={q.sigla}>{q.sigla}</option>)}<option value="PRACA">Praças</option>
          </select></Campo>
          {unica != null && <Campo rotulo="Seção"><select value={f.secao} onChange={(e) => muda('secao', e.target.value)}>
            <option value="">Todas</option><option value="-">(sem seção)</option>{secoesDa(dom, unica).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select></Campo>}
          <Campo rotulo="Ano de ingresso"><select value={f.ingresso} onChange={(e) => muda('ingresso', e.target.value)}>
            <option value="">Todos</option>{anosIngresso.map((a: any) => <option key={a} value={a}>{a}</option>)}
          </select></Campo>
          <Campo rotulo="De férias em"><select value={f.mes} onChange={(e) => muda('mes', e.target.value)}>
            <option value="">Qualquer mês</option>{meses.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
          </select></Campo>
        </div>
        {nFiltros > 0 && <button type="button" className="link" onClick={() => setF(FILTROS_VAZIOS)}>limpar filtros</button>}
      </details>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!selecionadas.size ? <Aviso tom="alerta">Marque ao menos uma OME.</Aviso>
        : !recorte ? (!erro && <Carregando />)
          : <p className="resumo-recorte" aria-live="polite"><strong>{recorte.pessoas.length}</strong> militar(es)/servidor(es) · {abrTxt}{filtrosTxt ? ` · ${filtrosTxt}` : ''}</p>}

      {recorte && tipo === 'mes' && <div className="form-grade">
        <Campo rotulo="Mês"><select value={mes} onChange={(e) => setMes(e.target.value)}>{meses.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}</select></Campo>
      </div>}
      {lote && sad && <>
        <h4>Quais períodos</h4>
        <div className="form-grade">
          <Campo rotulo="Períodos programados do PAF" largura="meia">
            <select value={sad.filtro} onChange={(e) => setSad({ ...sad, filtro: e.target.value as OpcoesSad['filtro'] })}>
              <option value="todos">Todos do exercício</option>
              <option value="reprog_sem_sgp">Só reprogramações homologadas ainda não inseridas no SGP</option>
              <option value="desde">Com início a partir de uma data</option>
            </select>
          </Campo>
          {sad.filtro === 'desde' && <Campo rotulo="Início a partir de"><input type="date" value={sad.desde} onChange={(e) => setSad({ ...sad, desde: e.target.value })} /></Campo>}
          <Campo rotulo="Datas no arquivo" dica="O modelo da SAD usa dd/mm/aaaa">
            <select value={sad.formatoData} onChange={(e) => setSad({ ...sad, formatoData: e.target.value as OpcoesSad['formatoData'] })}>
              <option value="texto">dd/mm/aaaa</option><option value="serial">Número do Excel (ex.: 46113)</option>
            </select>
          </Campo>
        </div>
        <h4>Publicação</h4>
        <div className="form-grade">
          <Campo rotulo="TIPO_PUBL"><input value={sad.publ.TIPO_PUBL} onChange={(e) => setP('TIPO_PUBL', e.target.value)} /></Campo>
          <Campo rotulo="MOTIVO_PUBL"><input value={sad.publ.MOTIVO_PUBL} onChange={(e) => setP('MOTIVO_PUBL', e.target.value)} /></Campo>
          <Campo rotulo="NUMERO_PUBL" dica="Ex.: 044/25-DGP/SPD"><input value={sad.publ.NUMERO_PUBL} onChange={(e) => setP('NUMERO_PUBL', e.target.value)} /></Campo>
          <Campo rotulo="DATA_PUBL"><input type="date" value={sad.publ.DATA_PUBL} onChange={(e) => setP('DATA_PUBL', e.target.value)} /></Campo>
          <Campo rotulo="TIPO_DO_PUBL"><input value={sad.publ.TIPO_DO_PUBL} onChange={(e) => setP('TIPO_DO_PUBL', e.target.value)} /></Campo>
          <Campo rotulo="DATA_DO_PUBL"><input type="date" value={sad.publ.DATA_DO_PUBL} onChange={(e) => setP('DATA_DO_PUBL', e.target.value)} /></Campo>
          <Campo rotulo="NUM_PROCESSO_PUBL" largura="meia"><input value={sad.publ.NUM_PROCESSO_PUBL} onChange={(e) => setP('NUM_PROCESSO_PUBL', e.target.value)} /></Campo>
        </div>
        <label className="check"><input type="checkbox" checked={sad.usarDoPeriodo} onChange={(e) => setSad({ ...sad, usarDoPeriodo: e.target.checked })} /> Em reprogramações e inclusões, usar a publicação e o processo do próprio período</label>
        <details className="detalhes"><summary>Campos fixos do layout</summary>
          <div className="form-grade">
            {(Object.keys(sad.fixos) as (keyof OpcoesSad['fixos'])[]).map((k) => <Campo key={k} rotulo={k}><input value={sad.fixos[k]} onChange={(e) => setFx(k, e.target.value)} /></Campo>)}
          </div>
          <p className="nota">SETOR, NOME_SETOR, NOME_SERVIDOR e OBS_PUBL vão em branco; período aquisitivo de 01/01 a 31/12 do exercício; SALDO_DIAS = dias do período.</p>
        </details>
        <Aviso tom={lote.pendentes.length ? 'alerta' : 'ok'}>
          {lote.linhas.length} período(s) no lote.{lote.pendentes.length ? ` ${lote.pendentes.length} ficaram fora (servidor civil ou militar sem nº funcional com vínculo): estão na aba "Fora do lote" da planilha.` : ''}
        </Aviso>
        {sad.filtro === 'reprog_sem_sgp' && lote.reprogIds.length > 0 && (
          <p className="nota">Depois de importar no SGP, marque as reprogramações como inseridas:{' '}
            <button className="link" onClick={async () => { try { const n = await rpc<number>('ferias_marcar_sgp', { p_ids: lote.reprogIds }); toast(`${n} reprogramação(ões) marcadas como inseridas no SGP.`); invalidar('ferias'); invalidar('pendencias'); } catch (e) { toast(msgErro(e), 'erro'); } }}>marcar {lote.reprogIds.length} como inseridas no SGP</button>
          </p>
        )}
      </>}
      <p className="nota">Toda exportação fica registrada; o arquivo traz dados pessoais: guarde em local protegido.</p>
    </Modal>
  );
}
