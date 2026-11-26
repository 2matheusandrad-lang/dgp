// Relatórios do módulo Férias (carregado sob demanda): cópia completa do PAF, mapa mensal
// e o arquivo de lote do SGP no layout da SAD (GERAL_layout_ferias_importacao).
import ExcelJS from 'exceljs';
import { supabase } from './supabase';
import { buscarTodos, fmtData, marcaLgpd, registrarExportacao } from './util';
import { ORIGEM, STATUS, TIPO_REPROG, ativo, diasEfetivos, janela, rotuloMes } from './ferias';

const VERMELHO = 'FFC1272D';
const CINZA = 'FFF2F4F7';
const hoje = () => new Date().toISOString().slice(0, 10);
const fimMes = (iso: string) => { const [a, m] = iso.split('-').map(Number); return `${iso.slice(0, 8)}${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`; };
const dataCel = (iso?: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null);

function baixarArquivo(conteudo: BlobPart, nome: string, tipo: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function cabecalho(ws: ExcelJS.Worksheet, linha: number, titulos: string[], larguras?: number[]) {
  const r = ws.getRow(linha);
  titulos.forEach((t, i) => {
    const c = r.getCell(i + 1);
    c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERMELHO } };
    c.alignment = { vertical: 'middle', wrapText: true };
    if (larguras?.[i]) ws.getColumn(i + 1).width = larguras[i];
  });
  r.height = 30;
}
function titulo(ws: ExcelJS.Worksheet, t: string, sub: string) {
  ws.getCell('A1').value = t; ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value = `${sub} — ${marcaLgpd()}`; ws.getCell('A2').font = { italic: true, color: { argb: 'FF667085' } };
}
function tabela(ws: ExcelJS.Worksheet, linhaCab: number, cols: { t: string; w: number; v: (r: any) => any; data?: boolean }[], linhas: any[]) {
  cabecalho(ws, linhaCab, cols.map((c) => c.t), cols.map((c) => c.w));
  linhas.forEach((r, i) => {
    const row = ws.getRow(linhaCab + 1 + i);
    cols.forEach((c, j) => {
      const v = c.v(r);
      const cell = row.getCell(j + 1);
      cell.value = v === undefined || v === null || v === '' ? null : c.data ? dataCel(v) : v;
      if (c.data && v) cell.numFmt = 'dd/mm/yyyy';
    });
  });
  ws.views = [{ state: 'frozen', ySplit: linhaCab }];
  if (linhas.length) ws.autoFilter = { from: { row: linhaCab, column: 1 }, to: { row: linhaCab, column: cols.length } };
}

// ----------------------------------------------------------------------------- dados
export type DadosFerias = { periodos: any[]; reprog: any[]; pessoas: any[] };
/** omes = null: todas as OMEs que o usuário enxerga (o banco limita pelo perfil) */
export async function carregar(ano: number, omes: number[] | null): Promise<DadosFerias> {
  const so = (q: any) => (omes ? (omes.length === 1 ? q.eq('ome_id', omes[0]) : q.in('ome_id', omes)) : q);
  const [periodos, reprog, militares, civis] = await Promise.all([
    buscarTodos<any>(() => { let q = supabase.from('v_ferias').select('*').eq('exercicio', ano).order('ome_sigla').order('posto_ordem').order('ordem_antiguidade', { nullsFirst: false }).order('nome').order('data_inicio').order('id'); return so(q); }),
    buscarTodos<any>(() => { let q = supabase.from('v_ferias_reprogramacao').select('*').eq('exercicio', ano).order('solicitado_em').order('id'); return so(q); }),
    buscarTodos<any>(() => { let q = supabase.from('v_militar').select('id,matricula,numero_funcional,nome,nome_guerra,posto_completo,posto_sigla,posto_ordem,quadro_sigla,oficial,ordem_antiguidade,ome_id,ome_sigla,secao_id,secao_nome,ano_ingresso').eq('situacao', 'ATIVO').order('ome_sigla').order('posto_ordem').order('ordem_antiguidade', { nullsFirst: false }).order('id'); return so(q); }),
    (async () => { let q = supabase.from('servidor_civil').select('id,matricula,nome,ome_id,ome:ome_id(sigla)').eq('ativo', true).order('nome'); const { data, error } = await so(q); if (error) throw error; return data || []; })(),
  ]);
  const pessoas = [
    ...militares.map((m: any) => ({ ...m, tipo: 'MILITAR' })),
    ...civis.map((c: any) => ({ ...c, tipo: 'CIVIL', posto_completo: 'Civil', posto_ordem: 99, ome_sigla: c.ome?.sigla || '' })),
  ];
  return { periodos, reprog, pessoas };
}

/** um resumo por pessoa ativa: dias do exercício e períodos vigentes em ordem */
export function porPessoa(d: DadosFerias) {
  const por = new Map<string, any[]>();
  d.periodos.filter(ativo).forEach((p) => { if (!por.has(p.pessoa_id)) por.set(p.pessoa_id, []); por.get(p.pessoa_id)!.push(p); });
  return d.pessoas.map((p) => {
    const ps = (por.get(p.id) || []).sort((a, b) => a.data_inicio.localeCompare(b.data_inicio));
    const dias = ps.reduce((s, x) => s + diasEfetivos(x), 0);
    return { ...p, ps, dias, saldo: Math.max(0, 30 - dias) };
  });
}

// ----------------------------------------------------------------------------- cópia completa (backup)
export async function backupCompleto(d: DadosFerias, ex: any, escopo: string, filtros = '', sufixo = '') {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Controle do Efetivo - DGP/CBMPE';
  const sub = `PAF ${ex.ano} · ${escopo}${filtros ? ` · ${filtros}` : ''} · gerado em ${fmtData(hoje())}`;

  const leia = wb.addWorksheet('Leia-me');
  titulo(leia, `Cópia completa do PAF ${ex.ano}`, sub);
  const info: [string, any][] = [
    ['Exercício', `${ex.ano} (gozo de 01/12/${ex.ano} a 31/12/${ex.ano + 1})`],
    ['Situação do PAF', ex.situacao === 'PUBLICADO' ? 'publicado' : 'em elaboração'],
    ['Publicação', [ex.publicacao, fmtData(ex.data_publicacao)].filter(Boolean).join(' de ')],
    ['Processo SEI', ex.processo_sei || ''], ['Abrangência', escopo], ['Filtros', filtros || 'nenhum'],
    ['Períodos (todas as situações)', d.periodos.length], ['Reprogramações', d.reprog.length], ['Pessoas ativas', d.pessoas.length],
    ['', ''],
    ['Abas', 'Por pessoa: um resumo por militar/servidor ativo · Períodos: todos os períodos do exercício, inclusive reprogramados, interrompidos e não gozados · Reprogramações: pedidos, decisões e inserção no SGP'],
    ['Situação', 'proposta = antes da publicação · programada = publicada · reprogramada = substituída por reprogramação · interrompida · não gozada (art. 9º)'],
  ];
  info.forEach(([k, v], i) => { const r = leia.getRow(4 + i); r.getCell(1).value = k; r.getCell(1).font = { bold: true }; r.getCell(2).value = v; r.getCell(2).alignment = { wrapText: true }; });
  leia.getColumn(1).width = 30; leia.getColumn(2).width = 110;

  const res = wb.addWorksheet('Por pessoa');
  titulo(res, `PAF ${ex.ano} — resumo por pessoa`, sub);
  const pp = porPessoa(d);
  const max = Math.max(1, ...pp.map((p) => p.ps.length));
  tabela(res, 4, [
    { t: 'Região', w: 11, v: (r) => r.regiao }, { t: 'OME', w: 11, v: (r) => r.ome_sigla }, { t: 'Posto/Grad.', w: 12, v: (r) => r.posto_completo },
    { t: 'Matrícula', w: 11, v: (r) => r.matricula }, { t: 'Nº funcional', w: 13, v: (r) => r.numero_funcional },
    { t: 'Nome', w: 38, v: (r) => r.nome }, { t: 'Nome de guerra', w: 16, v: (r) => r.nome_guerra },
    { t: 'Seção', w: 18, v: (r) => r.secao_nome },
    ...Array.from({ length: max }, (_, i) => [
      { t: `${i + 1}º período: início`, w: 12, v: (r: any) => r.ps[i]?.data_inicio, data: true },
      { t: `${i + 1}º: fim`, w: 12, v: (r: any) => r.ps[i]?.data_fim, data: true },
      { t: `${i + 1}º: dias`, w: 7, v: (r: any) => (r.ps[i] ? diasEfetivos(r.ps[i]) : null) },
    ]).flat(),
    { t: 'Dias no exercício', w: 10, v: (r) => r.dias }, { t: 'Saldo', w: 7, v: (r) => r.saldo },
  ], pp);

  const per = wb.addWorksheet('Períodos');
  titulo(per, `PAF ${ex.ano} — todos os períodos`, sub);
  tabela(per, 4, [
    { t: 'Exercício', w: 9, v: (r) => r.exercicio }, { t: 'Região', w: 11, v: (r) => r.regiao }, { t: 'OME', w: 11, v: (r) => r.ome_sigla }, { t: 'Seção', w: 18, v: (r) => r.secao_nome },
    { t: 'Tipo', w: 9, v: (r) => (r.tipo_pessoa === 'CIVIL' ? 'Civil' : 'Militar') }, { t: 'Posto/Grad.', w: 12, v: (r) => r.posto_completo },
    { t: 'Matrícula', w: 11, v: (r) => r.matricula }, { t: 'Nº funcional', w: 13, v: (r) => r.numero_funcional },
    { t: 'Nome', w: 38, v: (r) => r.nome }, { t: 'Situação da pessoa', w: 11, v: (r) => r.situacao_pessoa },
    { t: 'Parcela', w: 8, v: (r) => r.parcela }, { t: 'Início', w: 12, v: (r) => r.data_inicio, data: true }, { t: 'Fim', w: 12, v: (r) => r.data_fim, data: true },
    { t: 'Dias', w: 6, v: (r) => r.dias }, { t: 'Dias gozados (interrupção)', w: 12, v: (r) => r.dias_gozados },
    { t: 'Situação', w: 13, v: (r) => STATUS[r.status]?.rotulo || r.status }, { t: 'Origem', w: 20, v: (r) => ORIGEM[r.origem] || r.origem },
    { t: 'Previsto (plano)', w: 12, v: (r) => r.previsto_inicio, data: true }, { t: 'Dia estimado', w: 9, v: (r) => (r.data_estimada ? 'sim' : '') },
    { t: 'Publicação', w: 22, v: (r) => r.publicacao }, { t: 'Processo SEI', w: 28, v: (r) => r.processo_sei },
    { t: 'Exceção', w: 30, v: (r) => r.excecao }, { t: 'Exceção autorizada em', w: 14, v: (r) => r.excecao_aprovada_em, data: true },
    { t: 'Observação', w: 40, v: (r) => r.observacao }, { t: 'Lançado em', w: 12, v: (r) => r.criado_em, data: true }, { t: 'Atualizado em', w: 12, v: (r) => r.atualizado_em, data: true },
  ], d.periodos);

  const rep = wb.addWorksheet('Reprogramações');
  titulo(rep, `PAF ${ex.ano} — reprogramações e interrupções`, sub);
  const porId = new Map(d.periodos.map((p) => [p.id, p]));
  tabela(rep, 4, [
    { t: 'Pedido em', w: 12, v: (r) => r.solicitado_em, data: true }, { t: 'Região', w: 11, v: (r) => r.regiao }, { t: 'OME', w: 11, v: (r) => r.ome_sigla },
    { t: 'Posto/Grad.', w: 12, v: (r) => r.posto_completo }, { t: 'Matrícula', w: 11, v: (r) => r.matricula }, { t: 'Nome', w: 38, v: (r) => r.nome },
    { t: 'Tipo', w: 30, v: (r) => TIPO_REPROG[r.tipo] || r.tipo }, { t: 'Motivo', w: 30, v: (r) => r.motivo },
    { t: 'Antes', w: 34, v: (r) => [...(r.cancelar || []), ...(r.interromper ? [r.interromper] : [])].map((id: string) => porId.get(id)).filter(Boolean).map((p: any) => `${fmtData(p.data_inicio)} a ${fmtData(p.data_fim)} (${p.dias}d)`).join('; ') },
    { t: 'Interrompida em', w: 12, v: (r) => r.interrupcao_em, data: true },
    { t: 'Depois', w: 34, v: (r) => (r.novos || []).map((n: any) => `${fmtData(n.inicio)} (${n.dias}d)`).join('; ') },
    { t: 'Processo SEI', w: 28, v: (r) => r.processo_sei }, { t: 'Deferimento da OME', w: 18, v: (r) => r.publicacao_ome },
    { t: 'Situação', w: 14, v: (r) => String(r.status || '').replace('_', ' ').toLowerCase() }, { t: 'Homologação', w: 18, v: (r) => r.publicacao_dgp },
    { t: 'Decidido em', w: 12, v: (r) => r.decidido_em, data: true }, { t: 'Inserido no SGP em', w: 12, v: (r) => r.sgp_em, data: true },
    { t: 'Exceção', w: 30, v: (r) => r.excecao }, { t: 'Observação', w: 30, v: (r) => r.observacao },
  ], d.reprog);

  registrarExportacao(`Cópia completa do PAF ${ex.ano}`, `paf_${ex.ano}_completo`, 'xlsx', d.periodos.length, ['Nome', 'Matrícula', 'Nº funcional', 'Períodos', 'Reprogramações'], true);
  baixarArquivo(await wb.xlsx.writeBuffer(), `paf_${ex.ano}${sufixo}_completo_${hoje()}.xlsx`, XLSX);
}

// ----------------------------------------------------------------------------- mapa mensal
export async function mapaMensal(d: DadosFerias, ex: any, escopo: string, filtros = '', sufixo = '') {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Controle do Efetivo - DGP/CBMPE';
  const ws = wb.addWorksheet('Mapa mensal');
  const meses = janela(ex.ano);
  titulo(ws, `Mapa mensal de férias — PAF ${ex.ano}`, `${escopo}${filtros ? ` · ${filtros}` : ''} · gerado em ${fmtData(hoje())} · cada célula mostra os dias de férias no mês`);
  const pp = porPessoa(d);
  const fixas = ['Região', 'OME', 'Posto/Grad.', 'Matrícula', 'Nome'];
  cabecalho(ws, 4, [...fixas, ...meses.map(rotuloMes), 'Dias'], [11, 11, 12, 11, 34, ...meses.map(() => 9), 7]);
  pp.forEach((p, i) => {
    const r = ws.getRow(5 + i);
    r.values = [p.regiao, p.ome_sigla, p.posto_completo, p.matricula, p.nome];
    meses.forEach((m, j) => {
      const f = fimMes(m);
      const aqui = p.ps.filter((x: any) => x.data_inicio <= f && x.data_fim >= m);
      if (!aqui.length) return;
      const c = r.getCell(6 + j);
      c.value = aqui.map((x: any) => `${x.data_inicio < m ? '01' : x.data_inicio.slice(8)}–${x.data_fim > f ? f.slice(8) : x.data_fim.slice(8)}`).join(' ');
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: aqui.some((x: any) => x.situacao === 'PROPOSTA') ? 'FFFFFAEB' : 'FFEFF8FF' } };
      c.alignment = { horizontal: 'center' };
    });
    r.getCell(6 + meses.length).value = p.dias;
  });
  const tot = ws.getRow(5 + pp.length);
  tot.getCell(5).value = 'Em férias no mês'; tot.font = { bold: true };
  meses.forEach((m, j) => {
    const f = fimMes(m);
    tot.getCell(6 + j).value = pp.filter((p) => p.ps.some((x: any) => x.data_inicio <= f && x.data_fim >= m)).length;
    tot.getCell(6 + j).alignment = { horizontal: 'center' };
  });
  tot.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA } }));
  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 5 }];
  registrarExportacao(`Mapa mensal de férias ${ex.ano}`, `paf_${ex.ano}_mapa`, 'xlsx', pp.length, ['Nome', 'Matrícula', 'Meses'], true);
  baixarArquivo(await wb.xlsx.writeBuffer(), `paf_${ex.ano}${sufixo}_mapa_mensal_${hoje()}.xlsx`, XLSX);
}

// ----------------------------------------------------------------------------- lote do SGP (layout da SAD)
export const COLUNAS_SAD = ['EMP_CODIGO', 'ESTABELECIMENTO', 'SETOR', 'NOME_SETOR', 'NOME_SERVIDOR', 'NUMFUNC', 'NUMVINC', 'DT_INI_PA', 'DT_FIM_PA',
  'SALDO_DIAS', 'DT_INI_FERIAS', 'DT_FIM_FERIAS', 'PAGTO_ABONO', 'ABONO_CONST', 'ABONO_PECU', 'ADIANT_13SAL', 'ADIANT_SAL', 'EMPRESTIMO',
  'PERC_EMPRESTIMO', 'TIPO_PUBL', 'MOTIVO_PUBL', 'NUMERO_PUBL', 'DATA_PUBL', 'TIPO_DO_PUBL', 'DATA_DO_PUBL', 'NUM_PROCESSO_PUBL', 'OBS_PUBL'];
const DATAS_SAD = new Set(['DT_INI_PA', 'DT_FIM_PA', 'DT_INI_FERIAS', 'DT_FIM_FERIAS', 'DATA_PUBL', 'DATA_DO_PUBL']);

export type OpcoesSad = {
  filtro: 'todos' | 'reprog_sem_sgp' | 'desde';
  desde: string; formatoData: 'texto' | 'serial'; usarDoPeriodo: boolean;
  fixos: { EMP_CODIGO: string; ESTABELECIMENTO: string; PAGTO_ABONO: string; ABONO_CONST: string; ABONO_PECU: string; ADIANT_13SAL: string; ADIANT_SAL: string; EMPRESTIMO: string; PERC_EMPRESTIMO: string };
  publ: { TIPO_PUBL: string; MOTIVO_PUBL: string; NUMERO_PUBL: string; DATA_PUBL: string; TIPO_DO_PUBL: string; DATA_DO_PUBL: string; NUM_PROCESSO_PUBL: string };
};
export const opcoesSadPadrao = (ex: any): OpcoesSad => ({
  filtro: 'todos', desde: hoje(), formatoData: 'texto', usarDoPeriodo: true,
  fixos: { EMP_CODIGO: '1', ESTABELECIMENTO: '3906', PAGTO_ABONO: 'I', ABONO_CONST: 'S', ABONO_PECU: 'N', ADIANT_13SAL: 'N', ADIANT_SAL: 'N', EMPRESTIMO: 'N', PERC_EMPRESTIMO: '0' },
  publ: { TIPO_PUBL: 'NOTA', MOTIVO_PUBL: 'REGULAR/PUBLICADO', NUMERO_PUBL: ex.publicacao || '', DATA_PUBL: ex.data_publicacao || '',
    TIPO_DO_PUBL: 'BG CBMPE', DATA_DO_PUBL: ex.data_publicacao || '', NUM_PROCESSO_PUBL: ex.processo_sei || '' },
});
/** "2441616/01" -> 2441616 e 1 */
export const numFuncional = (v?: string | null): { func: string; vinc: string } | null => {
  const m = String(v || '').trim().match(/^(\d{3,9})\s*\/\s*(\d{1,3})$/);
  return m ? { func: String(Number(m[1])), vinc: String(Number(m[2])) } : null;
};
const serialExcel = (iso: string) => String(Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 864e5));
const dataSad = (iso: string, fmt: 'texto' | 'serial') => (!iso ? '' : fmt === 'serial' ? serialExcel(iso) : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`);

export function montarLoteSad(d: DadosFerias, ex: any, o: OpcoesSad) {
  const semSgp = new Set(d.reprog.filter((r) => r.status === 'HOMOLOGADA' && !r.sgp_em).map((r) => r.id));
  const elegiveis = d.periodos.filter((p) => p.situacao === 'PROGRAMADA'
    && (o.filtro !== 'reprog_sem_sgp' || (p.reprogramacao_id && semSgp.has(p.reprogramacao_id)))
    && (o.filtro !== 'desde' || p.data_inicio >= o.desde));
  const linhas: { periodo: any; valores: Record<string, string> }[] = [];
  const pendentes: { periodo: any; motivo: string }[] = [];
  for (const p of elegiveis) {
    if (p.tipo_pessoa === 'CIVIL') { pendentes.push({ periodo: p, motivo: 'Servidor civil: sem nº funcional no sistema' }); continue; }
    const nf = numFuncional(p.numero_funcional);
    if (!nf) { pendentes.push({ periodo: p, motivo: p.numero_funcional ? `Nº funcional "${p.numero_funcional}" sem o vínculo (formato 0000000/01)` : 'Sem nº funcional (vem do pecúlio)' }); continue; }
    const doPer = o.usarDoPeriodo && p.publicacao && p.publicacao !== ex.publicacao;
    const v: Record<string, string> = {
      EMP_CODIGO: o.fixos.EMP_CODIGO, ESTABELECIMENTO: o.fixos.ESTABELECIMENTO, SETOR: '', NOME_SETOR: '', NOME_SERVIDOR: '',
      NUMFUNC: nf.func, NUMVINC: nf.vinc, DT_INI_PA: `${ex.ano}-01-01`, DT_FIM_PA: `${ex.ano}-12-31`,
      SALDO_DIAS: String(p.dias), DT_INI_FERIAS: p.data_inicio, DT_FIM_FERIAS: p.data_fim,
      PAGTO_ABONO: o.fixos.PAGTO_ABONO, ABONO_CONST: o.fixos.ABONO_CONST, ABONO_PECU: o.fixos.ABONO_PECU, ADIANT_13SAL: o.fixos.ADIANT_13SAL,
      ADIANT_SAL: o.fixos.ADIANT_SAL, EMPRESTIMO: o.fixos.EMPRESTIMO, PERC_EMPRESTIMO: o.fixos.PERC_EMPRESTIMO,
      TIPO_PUBL: o.publ.TIPO_PUBL, MOTIVO_PUBL: o.publ.MOTIVO_PUBL, NUMERO_PUBL: doPer ? p.publicacao : o.publ.NUMERO_PUBL,
      DATA_PUBL: o.publ.DATA_PUBL, TIPO_DO_PUBL: o.publ.TIPO_DO_PUBL, DATA_DO_PUBL: o.publ.DATA_DO_PUBL,
      NUM_PROCESSO_PUBL: (doPer && p.processo_sei) || o.publ.NUM_PROCESSO_PUBL, OBS_PUBL: '',
    };
    linhas.push({ periodo: p, valores: v });
  }
  const reprogIds = [...new Set(linhas.map((l) => l.periodo.reprogramacao_id).filter((id) => id && semSgp.has(id)))] as string[];
  return { linhas, pendentes, reprogIds };
}
const limpo = (s: string) => String(s ?? '').replace(/[;\r\n]+/g, ' ').trim();

/** o .csv que vai para a transação 131 do SGP: cabeçalho + uma linha por período, separados por ";" (como a coluna ARQUIVO DE CARGA) */
export function baixarCsvSad(lote: ReturnType<typeof montarLoteSad>, ex: any, o: OpcoesSad, sufixo = '') {
  const linhas = [COLUNAS_SAD.join(';') + ';',
    ...lote.linhas.map((l) => COLUNAS_SAD.map((c) => limpo(DATAS_SAD.has(c) ? dataSad(l.valores[c], o.formatoData) : l.valores[c])).join(';') + ';')];
  registrarExportacao(`Lote de férias do SGP (layout SAD) PAF ${ex.ano}`, `ferias_lote_sgp_${ex.ano}`, 'csv', lote.linhas.length, ['NUMFUNC', 'NUMVINC', 'Datas de férias'], true);
  baixarArquivo(linhas.join('\r\n') + '\r\n', `ferias_lote_sgp_PAF${ex.ano}${sufixo}_${hoje()}.csv`, 'text/csv;charset=utf-8');
}

/** a mesma carga na planilha GERAL_layout_ferias_importacao (para conferir antes de importar) */
export async function baixarPlanilhaSad(lote: ReturnType<typeof montarLoteSad>, ex: any, o: OpcoesSad, sufixo = '') {
  const wb = new ExcelJS.Workbook(); wb.creator = 'Controle do Efetivo - DGP/CBMPE';
  const ws = wb.addWorksheet('Plan1');
  const nCol = COLUNAS_SAD.length;
  ws.getRow(1).getCell(nCol + 2).value = 'ARQUIVO DE CARGA';
  COLUNAS_SAD.forEach((c, i) => { const cell = ws.getRow(2).getCell(i + 1); cell.value = c; cell.font = { bold: true }; ws.getColumn(i + 1).width = Math.max(11, c.length + 2); });
  ws.getRow(2).getCell(nCol + 1).value = 'obs'; ws.getRow(2).getCell(nCol + 1).font = { bold: true };
  ws.getRow(2).getCell(nCol + 2).value = COLUNAS_SAD.join(';') + ';';
  lote.linhas.forEach((l, i) => {
    const r = ws.getRow(3 + i);
    COLUNAS_SAD.forEach((c, j) => {
      const v = l.valores[c]; const cell = r.getCell(j + 1);
      if (DATAS_SAD.has(c)) { cell.value = v ? dataCel(v) : null; cell.numFmt = 'dd/mm/yyyy'; }
      else cell.value = v === '' ? null : /^\d+$/.test(v) && !['NUMERO_PUBL', 'NUM_PROCESSO_PUBL'].includes(c) ? Number(v) : v;
    });
    r.getCell(nCol + 1).value = `${l.periodo.posto_completo} ${l.periodo.nome} · ${l.periodo.ome_sigla}`;
    r.getCell(nCol + 2).value = COLUNAS_SAD.map((c) => limpo(DATAS_SAD.has(c) ? dataSad(l.valores[c], o.formatoData) : l.valores[c])).join(';') + ';';
  });
  ws.getColumn(nCol + 1).width = 40; ws.getColumn(nCol + 2).width = 60;
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  const pend = wb.addWorksheet('Fora do lote');
  titulo(pend, 'Períodos que não entraram no lote', `PAF ${ex.ano} · corrija no sistema e gere de novo`);
  tabela(pend, 4, [
    { t: 'OME', w: 11, v: (r) => r.periodo.ome_sigla }, { t: 'Posto/Grad.', w: 12, v: (r) => r.periodo.posto_completo },
    { t: 'Matrícula', w: 11, v: (r) => r.periodo.matricula }, { t: 'Nome', w: 38, v: (r) => r.periodo.nome },
    { t: 'Início', w: 12, v: (r) => r.periodo.data_inicio, data: true }, { t: 'Dias', w: 6, v: (r) => r.periodo.dias }, { t: 'Motivo', w: 50, v: (r) => r.motivo },
  ], lote.pendentes);
  const obs = wb.addWorksheet('obs');
  obs.getCell('A1').value = 'Como importar no SGP'; obs.getCell('A1').font = { bold: true, size: 13 };
  ['1. Confira as linhas da aba Plan1 (a coluna obs mostra quem é cada linha; ela não entra na carga).',
    '2. Use o arquivo .csv gerado junto (ou copie a coluna ARQUIVO DE CARGA, da linha 2 para baixo, num bloco de notas e salve como .csv).',
    '3. No SGP: transação 131 (Atualização de gozo de férias em lote) > Importação > desmarque Simulação > Escolher arquivo.',
    '4. Aguarde a situação CONCLUÍDO e baixe o retorno para ver o que foi e o que não foi lançado.',
  ].forEach((t, i) => (obs.getCell(`A${3 + i}`).value = t));
  obs.getColumn(1).width = 120;
  registrarExportacao(`Planilha de lote de férias do SGP PAF ${ex.ano}`, `GERAL_layout_ferias_importacao_${ex.ano}`, 'xlsx', lote.linhas.length, ['NUMFUNC', 'NUMVINC', 'Nome'], true);
  baixarArquivo(await wb.xlsx.writeBuffer(), `GERAL_layout_ferias_importacao_PAF${ex.ano}${sufixo}_${hoje()}.xlsx`, XLSX);
}
