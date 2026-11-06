// Geração e leitura de Excel (carregado sob demanda: não pesa na abertura do sistema)
import ExcelJS from 'exceljs';
import type { Coluna } from './util';
import { marcaLgpd, registrarExportacao } from './util';

const VERMELHO = 'FF8F1D1D';
const CINZA = 'FFF2F0ED';

function baixar(buf: ArrayBuffer, nome: string) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const dataArquivo = () => new Date().toISOString().slice(0, 10);

function cabecalho(ws: ExcelJS.Worksheet, linha: number, titulos: string[]) {
  const r = ws.getRow(linha);
  titulos.forEach((t, i) => {
    const c = r.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERMELHO } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  r.height = 30;
}

/** Exporta uma lista para Excel, com título, filtros e (opcional) linhas de grupo */
export async function exportarExcel<T>(arquivo: string, titulo: string, colunas: Coluna<T>[], linhas: T[], agrupar?: (r: T) => string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Controle do Efetivo - DGP/CBMPE';
  const ws = wb.addWorksheet('Relatório', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.getCell('A1').value = titulo;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value = `CBMPE — DGP — ${linhas.length} registro(s) — ${marcaLgpd()}`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
  cabecalho(ws, 4, colunas.map((c) => c.titulo));
  let ln = 5;
  let grupoAnt: string | null = null;
  linhas.forEach((r, i) => {
    if (agrupar) {
      const g = agrupar(r);
      if (g !== grupoAnt) {
        const rg = ws.getRow(ln++);
        rg.getCell(1).value = g;
        rg.font = { bold: true, color: { argb: VERMELHO } };
        rg.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA } }));
        grupoAnt = g;
      }
    }
    ws.getRow(ln++).values = colunas.map((c) => {
      const v = c.valor(r, i);
      return v === null || v === undefined ? '' : v;
    });
  });
  colunas.forEach((c, i) => (ws.getColumn(i + 1).width = c.largura || Math.max(10, c.titulo.length + 2)));
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: colunas.length } };
  baixar(await wb.xlsx.writeBuffer(), `${arquivo}_${dataArquivo()}.xlsx`);
}

// =====================================================================
// PLANILHA DA OME (baixar preenchida -> editar -> subir)
// =====================================================================
export const COLS_PLANILHA = [
  { chave: 'matricula', titulo: 'Matrícula', largura: 11, edita: false },
  { chave: 'posto', titulo: 'Posto/Grad.', largura: 11, edita: false },
  { chave: 'nome', titulo: 'Nome', largura: 38, edita: false },
  { chave: 'nome_guerra', titulo: 'Nome de guerra', largura: 16, edita: true },
  { chave: 'secao', titulo: 'Seção', largura: 24, edita: true },
  { chave: 'atividade', titulo: 'Atividade', largura: 15, edita: true },
  { chave: 'email', titulo: 'E-mail', largura: 30, edita: true },
  { chave: 'telefone1', titulo: 'Telefone (WhatsApp)', largura: 17, edita: true },
  { chave: 'telefone2', titulo: 'Telefone 2', largura: 16, edita: true },
  { chave: 'endereco', titulo: 'Endereço', largura: 45, edita: true },
  { chave: 'ano_ingresso', titulo: 'Ano de ingresso', largura: 10, edita: true },
  { chave: 'nova_formacao_nivel', titulo: 'NOVA formação — nível', largura: 20, edita: true },
  { chave: 'nova_formacao_area', titulo: 'NOVA formação — área/curso', largura: 26, edita: true },
  { chave: 'escolaridade', titulo: 'Escolaridade atual (consulta)', largura: 20, edita: false },
  { chave: 'hoje', titulo: 'Situação hoje (consulta)', largura: 22, edita: false },
] as const;
export const COLS_AFAST = ['Matrícula', 'Tipo de afastamento', 'Data de início', 'Quantidade de dias', 'Processo SEI', 'Observação'];

export type DadosPlanilha = {
  ome: string; competencia: string;
  militares: Record<string, any>[];
  secoes: string[]; niveis: string[]; tiposAfast: string[];
};

export async function gerarPlanilhaOme(d: DadosPlanilha) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Controle do Efetivo - DGP/CBMPE';

  // Instruções
  const wi = wb.addWorksheet('Instruções');
  const instr = [
    `PLANILHA DE ATUALIZAÇÃO — ${d.ome} — competência ${d.competencia}`,
    '',
    '1. Na aba "Militares", altere SOMENTE as colunas brancas. As colunas cinzas (matrícula, posto, nome e as de consulta) são travadas.',
    '2. Seção, Atividade e Nova formação — nível têm lista: clique na célula e escolha a opção.',
    '3. Para registrar uma nova formação do militar, preencha "NOVA formação — nível" e "área/curso". As formações já cadastradas não aparecem aqui e não são apagadas.',
    '4. Para lançar afastamentos, use a aba "Afastamentos novos": uma linha por afastamento (matrícula, tipo, início, dias, processo SEI).',
    '5. Não inclua nem apague linhas de militares. Inclusões, transferências e desligamentos continuam pelo sistema.',
    '6. Salve e envie o arquivo em Conferência mensal > Enviar planilha. O sistema mostra TODAS as mudanças antes de gravar.',
    '',
    'Dados de saúde (natureza/CID) NÃO devem ser informados nesta planilha.',
  ];
  instr.forEach((t, i) => { wi.getCell(i + 1, 1).value = t; });
  wi.getCell(1, 1).font = { bold: true, size: 13 };
  wi.getColumn(1).width = 130;

  // Listas (oculta)
  const wl = wb.addWorksheet('Listas', { state: 'hidden' });
  const listas: [string, string[]][] = [
    ['Seções', d.secoes], ['Atividades', ['Operacional', 'Administrativo']], ['Níveis', d.niveis], ['Tipos', d.tiposAfast],
  ];
  listas.forEach(([nome, itens], c) => {
    wl.getCell(1, c + 1).value = nome;
    itens.forEach((v, i) => (wl.getCell(i + 2, c + 1).value = v));
  });
  const ref = (c: number, n: number) => `Listas!$${String.fromCharCode(65 + c)}$2:$${String.fromCharCode(65 + c)}$${Math.max(2, n + 1)}`;

  // Militares
  const ws = wb.addWorksheet('Militares', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  cabecalho(ws, 1, COLS_PLANILHA.map((c) => c.titulo));
  COLS_PLANILHA.forEach((c, i) => (ws.getColumn(i + 1).width = c.largura));
  d.militares.forEach((m, i) => {
    const r = ws.getRow(i + 2);
    COLS_PLANILHA.forEach((c, j) => {
      const cell = r.getCell(j + 1);
      cell.value = m[c.chave] ?? null;
      if (c.edita) {
        cell.protection = { locked: false };
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CINZA } };
      }
    });
    const idx = (k: string) => COLS_PLANILHA.findIndex((c) => c.chave === k) + 1;
    r.getCell(idx('secao')).dataValidation = { type: 'list', allowBlank: true, formulae: [ref(0, d.secoes.length)], showErrorMessage: true, errorTitle: 'Seção', error: 'Escolha uma seção da lista.' };
    r.getCell(idx('atividade')).dataValidation = { type: 'list', allowBlank: true, formulae: [ref(1, 2)], showErrorMessage: true, error: 'Escolha Operacional ou Administrativo.' };
    r.getCell(idx('nova_formacao_nivel')).dataValidation = { type: 'list', allowBlank: true, formulae: [ref(2, d.niveis.length)], showErrorMessage: true, error: 'Escolha um nível da lista.' };
    r.getCell(idx('ano_ingresso')).dataValidation = { type: 'whole', allowBlank: true, operator: 'between', formulae: [1950, 2100], showErrorMessage: true, error: 'Ano entre 1950 e 2100.' };
  });
  await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, autoFilter: true, sort: false });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS_PLANILHA.length } };

  // Afastamentos novos
  const wa = wb.addWorksheet('Afastamentos novos', { views: [{ state: 'frozen', ySplit: 1 }] });
  cabecalho(wa, 1, COLS_AFAST);
  [12, 34, 14, 12, 28, 30].forEach((w, i) => (wa.getColumn(i + 1).width = w));
  for (let i = 2; i <= 301; i++) {
    wa.getCell(i, 2).dataValidation = { type: 'list', allowBlank: true, formulae: [ref(3, d.tiposAfast.length)], showErrorMessage: true, error: 'Escolha um tipo da lista.' };
    wa.getCell(i, 3).dataValidation = { type: 'date', allowBlank: true, operator: 'greaterThan', formulae: [new Date(2000, 0, 1)], showErrorMessage: true, error: 'Informe uma data (dd/mm/aaaa).' };
    wa.getCell(i, 3).numFmt = 'dd/mm/yyyy';
    wa.getCell(i, 4).dataValidation = { type: 'whole', allowBlank: true, operator: 'between', formulae: [1, 3650], showErrorMessage: true, error: 'Dias entre 1 e 3650.' };
  }
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];
  registrarExportacao('Planilha da OME', `planilha_${d.ome}`, 'xlsx', d.militares.length, ['Telefone', 'E-mail', 'Endereço'], true);
  baixar(await wb.xlsx.writeBuffer(), `planilha_${d.ome.replace(/[^\w]+/g, '')}_${d.competencia.replace('/', '-')}.xlsx`);
}

const texto = (v: any): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('text' in v) return String(v.text ?? '').trim();
    if ('richText' in v) return v.richText.map((t: any) => t.text).join('').trim();
    if ('result' in v) return String(v.result ?? '').trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
};
const dataCelula = (v: any): string | null => {
  if (v instanceof Date) return new Date(v.getTime() + v.getTimezoneOffset() * 60000 + 12 * 3600000).toISOString().slice(0, 10);
  const s = texto(v);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  return null;
};

export type LidoPlanilha = {
  militares: Record<string, string>[];
  afastamentos: { linha: number; matricula: string; tipo: string; inicio: string | null; dias: number | null; processo: string; observacao: string; bruto: any[] }[];
  avisos: string[];
};

export async function lerPlanilhaOme(arquivo: File): Promise<LidoPlanilha> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await arquivo.arrayBuffer());
  const ws = wb.getWorksheet('Militares');
  if (!ws) throw new Error('Arquivo sem a aba "Militares". Use a planilha baixada do sistema.');
  const titulos = (ws.getRow(1).values as any[]).map(texto);
  const pos: Record<string, number> = {};
  COLS_PLANILHA.forEach((c) => {
    const i = titulos.indexOf(c.titulo);
    if (i > 0) pos[c.chave] = i;
  });
  if (!pos.matricula) throw new Error('Coluna "Matrícula" não encontrada. Use a planilha baixada do sistema, sem alterar os títulos.');
  const militares: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const reg: Record<string, string> = { _linha: String(n) };
    for (const [k, i] of Object.entries(pos)) reg[k] = texto(row.getCell(i).value);
    if (reg.matricula) militares.push(reg);
  });
  const afastamentos: LidoPlanilha['afastamentos'] = [];
  const wa = wb.getWorksheet('Afastamentos novos');
  wa?.eachRow((row, n) => {
    if (n === 1) return;
    const v = [1, 2, 3, 4, 5, 6].map((i) => row.getCell(i).value);
    if (v.every((x) => texto(x) === '')) return;
    const dias = parseInt(texto(v[3]), 10);
    afastamentos.push({ linha: n, matricula: texto(v[0]), tipo: texto(v[1]), inicio: dataCelula(v[2]), dias: isNaN(dias) ? null : dias,
      processo: texto(v[4]), observacao: texto(v[5]), bruto: v });
  });
  return { militares, afastamentos, avisos: [] };
}

// QOD: modelo OME x posto para preencher
export async function gerarModeloQod(omes: { id: number; sigla: string }[], postos: { id: number; sigla: string }[], valores: Record<string, number>, competencia: string) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('QOD', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
  ws.getCell('A1').value = `QOD — efetivo previsto — competência ${competencia}  (preencha os números; células vazias = 0)`;
  ws.getCell('A1').font = { bold: true };
  cabecalho(ws, 2, ['OME', ...postos.map((p) => p.sigla), 'TOTAL']);
  ws.getColumn(1).width = 18;
  omes.forEach((o, i) => {
    const r = ws.getRow(i + 3);
    r.getCell(1).value = o.sigla;
    postos.forEach((p, j) => {
      const v = valores[`${o.id}|${p.id}`];
      r.getCell(j + 2).value = v || null;
    });
    const col = (n: number) => ws.getColumn(n).letter;
    r.getCell(postos.length + 2).value = { formula: `SUM(${col(2)}${i + 3}:${col(postos.length + 1)}${i + 3})` } as any;
  });
  postos.forEach((_, j) => (ws.getColumn(j + 2).width = 8));
  baixar(await wb.xlsx.writeBuffer(), `QOD_${competencia.replace('/', '-')}.xlsx`);
}

export async function lerModeloQod(arquivo: File) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await arquivo.arrayBuffer());
  const ws = wb.worksheets[0];
  // localiza a linha de cabeçalho (a que tem "OME" na 1ª coluna)
  let lc = 0;
  ws.eachRow((row, n) => { if (!lc && texto(row.getCell(1).value).toUpperCase() === 'OME') lc = n; });
  if (!lc) throw new Error('Não encontrei a linha de títulos com "OME" na primeira coluna.');
  const titulos = (ws.getRow(lc).values as any[]).map(texto);
  const linhas: { ome: string; posto: string; previsto: number }[] = [];
  ws.eachRow((row, n) => {
    if (n <= lc) return;
    const ome = texto(row.getCell(1).value);
    if (!ome || ome.toUpperCase() === 'TOTAL') return;
    titulos.forEach((t, i) => {
      if (i < 2 || !t || t.toUpperCase() === 'TOTAL') return;
      const v = Number(texto(row.getCell(i).value).replace(',', '.'));
      if (!isNaN(v) && v > 0) linhas.push({ ome, posto: t, previsto: Math.round(v) });
    });
  });
  return linhas;
}

// ---------------- PAF (planilha de férias) ----------------
export type LinhaPafBruta = {
  aba: string; linha: number; anoAba: number; omeRecebida: string; matricula: string; nome: string; paf: string;
  previsto: string | null; diaIni: number | null; diaFim: number | null; mesGozo: string | null; sei: string; obs: string;
};
/** lê as abas "FÉRIAS AAAA" da planilha do PAF; nada é enviado ao servidor */
export async function lerPlanilhaPaf(arquivo: File) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await arquivo.arrayBuffer());
  const val = (v: any) => (v && typeof v === 'object' && 'result' in v ? v.result : v);
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  const num = (v: any) => { const x = Number(texto(val(v)).replace(',', '.')); return Number.isFinite(x) && x > 0 ? Math.round(x) : null; };
  const linhas: LinhaPafBruta[] = []; const abas: string[] = []; const complementar: { matricula: string; nome: string; ome: string }[] = [];
  for (const ws of wb.worksheets) {
    const nomeAba = norm(ws.name);
    if (nomeAba === 'CADASTRO COMPLEMENTAR') {
      ws.eachRow((row, n) => { if (n === 1) return; const mat = texto(val(row.getCell(1).value)); const nome = texto(val(row.getCell(4).value));
        if (mat && nome) complementar.push({ matricula: mat, nome, ome: texto(val(row.getCell(3).value)) }); });
      continue;
    }
    const mAno = nomeAba.match(/^FERIAS (\d{4})$/);
    if (!mAno) continue;
    let lc = 0;
    for (let r = 1; r <= 6 && !lc; r++) if ((ws.getRow(r).values as any[]).some((v) => norm(texto(val(v))) === 'MATRICULA')) lc = r;
    if (!lc) continue;
    abas.push(ws.name);
    const tit = (ws.getRow(lc).values as any[]).map((v) => norm(texto(val(v))));
    const col = (...nomes: string[]) => { for (const n of nomes) { const i = tit.findIndex((t) => t === n); if (i > 0) return i; } return 0; };
    const cMat = col('MATRICULA'), cPrev = col('MES ADITAMENTO');
    const c = {
      ome: col('OME RECEBIDA'), nome: col('NOME'), paf: col('PAF'), sei: col('SEI'), obs: col('OBS'),
      ini: col('DIA INICIO') || cPrev + 1, fim: col('DIA FIM') || cPrev + 2, gozo: col('MES GOZO', 'MES/ANO GOZO') || cPrev + 3,
    };
    ws.eachRow((row, n) => {
      if (n <= lc) return;
      const mat = texto(val(row.getCell(cMat).value));
      if (!/\d/.test(mat)) return;
      linhas.push({
        aba: ws.name, linha: n, anoAba: Number(mAno[1]), omeRecebida: texto(val(row.getCell(c.ome).value)), matricula: mat,
        nome: texto(val(row.getCell(c.nome).value)), paf: texto(val(row.getCell(c.paf).value)),
        previsto: cPrev ? dataCelula(val(row.getCell(cPrev).value)) : null,
        diaIni: num(row.getCell(c.ini).value), diaFim: num(row.getCell(c.fim).value), mesGozo: dataCelula(val(row.getCell(c.gozo).value)),
        sei: texto(val(row.getCell(c.sei).value)), obs: texto(val(row.getCell(c.obs).value)),
      });
    });
  }
  return { linhas, abas, complementar };
}
