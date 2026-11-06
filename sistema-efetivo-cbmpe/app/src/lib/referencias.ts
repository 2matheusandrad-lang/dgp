// Leitura do QOD e do almanaque em PDF.
// Funções puras: recebem o texto das páginas (itens com posição) e devolvem dados conferidos.
// A leitura do arquivo fica em pdfTexto.ts (carregada só na tela de atualização mensal).

export type Item = { s: string; x: number; y: number; w: number };
export type Pagina = Item[];

/** maiúsculas, sem acento, espaços simples */
export const normal = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const soLetras = (s: string) => normal(s).replace(/[^A-Z]/g, '');

/** junta os itens de uma página em linhas de texto (de cima para baixo, da esquerda para a direita) */
export function linhasDaPagina(itens: Pagina): string[] {
  const vis = itens.filter((i) => i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const grupos: Item[][] = [];
  for (const it of vis) {
    const g = grupos.find((gr) => Math.abs(gr[0].y - it.y) <= 2);
    if (g) g.push(it); else grupos.push([it]);
  }
  return grupos.map((g) => {
    g.sort((a, b) => a.x - b.x);
    let txt = '', fim = -1e9;
    for (const it of g) {
      txt += (txt && it.x - fim > 0.8 ? ' ' : '') + it.s;
      fim = it.x + it.w;
    }
    return txt.replace(/\s+/g, ' ').trim();
  });
}

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const iso = (a: number, m: number, d = 1) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// ===================================================================== QOD
/** colunas do Quadro nº 001, na ordem impressa */
export const COLUNAS_QOD = [
  { id: 'Cel', posto: 'Cel', quadro: null }, { id: 'Ten Cel', posto: 'Ten Cel', quadro: null },
  { id: 'Maj QOC', posto: 'Maj', quadro: 'QOC' }, { id: 'Cap QOC', posto: 'Cap', quadro: 'QOC' },
  { id: '1ºTen QOC', posto: '1ºTen', quadro: 'QOC' }, { id: '2ºTen QOC', posto: '2ºTen', quadro: 'QOC' },
  { id: 'soma_qoc', posto: null, quadro: null },
  { id: 'Maj QOA', posto: 'Maj', quadro: 'QOA' }, { id: 'Cap QOA', posto: 'Cap', quadro: 'QOA' },
  { id: '1ºTen QOA', posto: '1ºTen', quadro: 'QOA' }, { id: '2ºTen QOA', posto: '2ºTen', quadro: 'QOA' },
  { id: 'soma_qoa', posto: null, quadro: null },
  { id: 'Subten', posto: 'Subten', quadro: null }, { id: '1ºSgt', posto: '1ºSgt', quadro: null },
  { id: '2ºSgt', posto: '2ºSgt', quadro: null }, { id: '3ºSgt', posto: '3ºSgt', quadro: null },
  { id: 'Cb', posto: 'Cb', quadro: null }, { id: 'Sd', posto: 'Sd', quadro: null },
  { id: 'soma_pracas', posto: null, quadro: null }, { id: 'total', posto: null, quadro: null },
] as const;
const NC = COLUNAS_QOD.length;

export type LinhaQod = { rotulo: string; chave: string; v: number[]; confere: boolean; problema?: string };
export type LeituraQod = {
  competencia: string | null; documento: string; atualizacao: string | null;
  linhas: LinhaQod[]; totalImpresso: number[] | null; fixado: number | null; erros: string[];
};

/** chave do nome da OME no QOD: sem numeração ("3.2.2."), maiúsculas, sem acento */
export const chaveQod = (rotulo: string) => normal(rotulo.replace(/^\s*\d+(?:\.\d+)*[.)]?\s+/, ''));

export function lerQod(paginas: Pagina[]): LeituraQod {
  const erros: string[] = [];
  const linhasTxt = paginas.map(linhasDaPagina);
  const capa = linhasTxt[0] || [];
  const documento = (capa.find((l) => /QOD/i.test(l)) || 'QOD').replace(/\s*CAPA\s*$/i, '').trim();
  const at = capa.join(' ').match(/Atualiza[çc][ãa]o:?\s*Recife,?\s*(\d{1,2}) de (\w+) de (\d{4})/i);
  const atualizacao = at ? `${at[1].padStart(2, '0')}/${String(MESES.indexOf(normal(at[2])) + 1).padStart(2, '0')}/${at[3]}` : null;
  let fixado: number | null = null;
  for (const ls of linhasTxt.slice(0, 4)) {
    const i = ls.findIndex((l) => normal(l).startsWith('TOTAL GERAL'));
    if (i >= 0 && ls.some((l) => normal(l).includes('EFETIVO FIXADO'))) { const m = ls[i].match(/(\d+)\s*$/); if (m) fixado = +m[1]; }
  }

  let competencia: string | null = null;
  const brutas: { rotulo: string; nums: { x: number; n: number }[] }[] = [];
  paginas.forEach((itens, p) => {
    const txt = linhasTxt[p].join('\n');
    if (!/QUADRO\s*N[º°o.]?\s*0*01\b/i.test(txt) || !/DISTRIBUI[ÇC][ÃA]O GERAL/i.test(normal(txt))) return;
    if (!competencia) {
      const m = normal(txt).match(new RegExp(`\\b(${MESES.join('|')})\\s+(\\d{4})\\b`));
      if (m) competencia = iso(+m[2], MESES.indexOf(m[1]) + 1);
    }
    const cabCel = itens.find((i) => normal(i.s) === 'CEL');
    const xMin = cabCel ? cabCel.x - 20 : 200;
    const vis = itens.filter((i) => i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    const grupos: Item[][] = [];
    for (const it of vis) { const g = grupos.find((gr) => Math.abs(gr[0].y - it.y) <= 2); if (g) g.push(it); else grupos.push([it]); }
    for (const g of grupos) {
      const nums: { x: number; n: number }[] = []; const rot: Item[] = [];
      for (const it of g.sort((a, b) => a.x - b.x)) {
        const s = it.s.trim();
        if (it.x >= xMin && /^\d+(\s+\d+)*$/.test(s)) {
          const partes = s.split(/\s+/); const lw = it.w / s.length;
          let pos = 0;
          for (const pt of partes) { const ini = s.indexOf(pt, pos); nums.push({ x: it.x + lw * (ini + pt.length / 2), n: +pt }); pos = ini + pt.length; }
        } else if (it.x < xMin) rot.push(it);
      }
      const rotulo = linhasDaPagina(rot)[0] || '';
      if (nums.length >= 3 && rotulo && !/DISCRIMINA/i.test(rotulo)) brutas.push({ rotulo, nums });
    }
  });

  if (!brutas.length) {
    erros.push('Não encontrei o Quadro nº 001 (Distribuição Geral de Efetivo) nas primeiras páginas do PDF.');
    return { competencia, documento, atualizacao, linhas: [], totalImpresso: null, fixado, erros };
  }
  const completas = brutas.filter((b) => b.nums.length === NC);
  if (!completas.length) {
    erros.push('Não consegui identificar as colunas do Quadro nº 001 (nenhuma linha completa).');
    return { competencia, documento, atualizacao, linhas: [], totalImpresso: null, fixado, erros };
  }
  const centros = Array.from({ length: NC }, (_, i) => completas.reduce((s, b) => s + b.nums[i].x, 0) / completas.length);

  const linhas: LinhaQod[] = []; let totalImpresso: number[] | null = null;
  for (const b of brutas) {
    const v = Array(NC).fill(0); let problema: string | undefined;
    const usados = new Set<number>();
    for (const n of b.nums) {
      const c = centros.reduce((best, cx, i) => (Math.abs(cx - n.x) < Math.abs(centros[best] - n.x) ? i : best), 0);
      if (usados.has(c)) problema = 'dois números na mesma coluna';
      usados.add(c); v[c] = n.n;
    }
    const soma = (a: number, z: number) => v.slice(a, z).reduce((s, x) => s + x, 0);
    const confere = !problema && soma(0, 6) === v[6] && soma(7, 11) === v[11] && soma(12, 18) === v[18] && v[6] + v[11] + v[18] === v[19];
    if (!problema && !confere) problema = 'as somas da linha não conferem';
    if (/^(TOTAL|EFETIVO FIXADO)/.test(normal(b.rotulo))) { if (!problema && !totalImpresso) totalImpresso = v; continue; }
    linhas.push({ rotulo: b.rotulo, chave: chaveQod(b.rotulo), v, confere: !problema, problema });
  }
  if (!competencia) erros.push('Não encontrei o mês de referência no cabeçalho do Quadro nº 001.');
  return { competencia, documento, atualizacao, linhas, totalImpresso, fixado, erros };
}

/** soma das linhas lidas, coluna a coluna */
export const somaQod = (linhas: LinhaQod[]) => Array.from({ length: NC }, (_, i) => linhas.reduce((s, l) => s + l.v[i], 0));

/** OME do sistema para um nome do QOD: de-para salvo, sigla igual, ou "Nº GB Cidade" */
export function omeDoQod(chave: string, omes: { id: number; sigla: string }[], alias: Map<string, number>): number | null {
  if (alias.has(chave)) return alias.get(chave)!;
  const sem = (s: string) => normal(s).replace(/\s/g, '');
  const tok = chave.split(' ');
  for (const c of [chave, tok[0], tok.slice(0, 2).join(' ')]) {
    const o = omes.find((x) => sem(x.sigla) === sem(c));
    if (o) return o.id;
  }
  return null;
}

// ===================================================================== ALMANAQUE
const POSTOS_ALM: Record<string, string> = {
  CORONEIS: 'Cel', TENENTESCORONEIS: 'Ten Cel', MAJORES: 'Maj', CAPITAES: 'Cap', PRIMEIROSTENENTES: '1ºTen',
  SEGUNDOSTENENTES: '2ºTen', SUBTENENTES: 'Subten', PRIMEIROSSARGENTOS: '1ºSgt', SEGUNDOSSARGENTOS: '2ºSgt',
  TERCEIROSSARGENTOS: '3ºSgt', CABOS: 'Cb', SOLDADOS: 'Sd',
};
const PRACAS = new Set(['Subten', '1ºSgt', '2ºSgt', '3ºSgt', 'Cb', 'Sd']);

export type RegAlmanaque = {
  ordem: number; nome: string; posto: string; quadro: string | null; matricula: string;
  anoIngresso: number | null; dataIngresso: string | null; nomeGuerra: string | null; dvValido: boolean; arquivo: string;
};
export type LeituraAlmanaque = { referencia: string | null; registros: RegAlmanaque[]; avisos: string[] };

export const dvMatricula = (m: string) => {
  const d = m.replace(/\D/g, ''); if (d.length !== 7) return false;
  const s = [...d.slice(0, 6)].reduce((t, c, i) => t + +c * (7 - i), 0);
  const x = 11 - (s % 11); return (x >= 10 ? 0 : x) === +d[6];
};
/** nome de guerra = palavras em maiúsculas dentro do nome escrito em caixa mista */
export const guerraDoNome = (nome: string) => {
  if (!/[a-zà-ÿ]/.test(nome)) return null;
  const g = nome.split(/\s+/).filter((t) => { const l = t.replace(/[^A-Za-zÀ-ÿ]/g, ''); return l.length >= 2 && l === l.toUpperCase(); });
  return g.length ? g.join(' ').replace(/[^A-ZÀ-Ý ]/g, '').trim() || null : null;
};

export function lerAlmanaque(paginas: Pagina[], arquivo: string): LeituraAlmanaque {
  const avisos: string[] = []; const registros: RegAlmanaque[] = [];
  let referencia: string | null = null;
  let posto: string | null = null, quadro: string | null = null;
  let atual: Omit<RegAlmanaque, 'matricula' | 'anoIngresso' | 'dataIngresso' | 'dvValido'> | null = null;
  const linhas = paginas.flatMap(linhasDaPagina);
  for (const l of linhas.slice(0, 40)) {
    const m = normal(l).match(new RegExp(`(\\d{1,2}) DE (${MESES.join('|')}) DE (\\d{4})`));
    if (m) { referencia = iso(+m[3], MESES.indexOf(m[2]) + 1, +m[1]); break; }
  }
  for (const l of linhas) {
    const k = soLetras(l);
    if (k.startsWith('FATOSHISTORICOS')) break;
    if (k.startsWith('QUADRODEOFICIAISCOMBATENTES')) { quadro = 'QOC'; continue; }
    if (k.startsWith('QUADRODEOFICIAISDAADMINISTRACAO')) { quadro = 'QOA'; continue; }
    if (POSTOS_ALM[k]) { posto = POSTOS_ALM[k]; if (PRACAS.has(posto)) quadro = null; atual = null; continue; }
    if (!posto) {   // comandante e subcomandante-geral, no início de cada volume
      const c = l.match(/^0(\d)\s*-\s*Cel\s+BM\s+(.+)$/);
      if (c) atual = { ordem: +c[1], nome: c[2].trim(), posto: 'Cel', quadro: 'QOC', nomeGuerra: guerraDoNome(c[2]), arquivo };
    } else {
      const e = l.match(/^(\d+)\s*\.\s+(\S.*)$/);
      if (e && !/\d{2}\/\d{2}\/\d{2}/.test(l) && !/Promo/i.test(l)) {
        atual = { ordem: +e[1], nome: e[2].trim(), posto, quadro: PRACAS.has(posto) ? null : quadro, nomeGuerra: guerraDoNome(e[2]), arquivo };
        continue;
      }
    }
    if (atual && /Mat\b/.test(l)) {
      const mm = l.match(/Mat\.?:?\s*(\d{6})\s*-\s*(\d)\b/);
      if (!mm) { avisos.push(`${atual.posto} ${atual.nome}: matrícula ilegível no almanaque ("${l.slice(l.indexOf('Mat')).trim()}")`); atual = null; continue; }
      const dp = l.match(/DP\s*(\d{2})\/(\d{2})\/(\d{2})\b/);
      const praca = l.match(/Pra[çc]a de .*? de (\d{4})/i);   // formato do comandante e do subcomandante
      const yy = dp ? +dp[3] : null;
      const matricula = `${mm[1]}-${mm[2]}`;
      const ano = yy === null ? (praca ? +praca[1] : null) : yy >= 50 ? 1900 + yy : 2000 + yy;
      let dataIngresso: string | null = dp && ano ? `${ano}-${dp[2]}-${dp[1]}` : null;
      if (dataIngresso) {
        const d = new Date(dataIngresso + 'T12:00:00');
        if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dataIngresso) {
          avisos.push(`${atual.posto} ${atual.nome}: data de praça inválida no almanaque (${dp![0].replace(/^DP\s*/, '')}); a data de ingresso não será alterada.`);
          dataIngresso = null;
        }
      }
      registros.push({ ...atual, matricula, anoIngresso: dataIngresso || !dp ? ano : null, dataIngresso, dvValido: dvMatricula(matricula) });
      atual = null;
    }
  }
  return { referencia, registros, avisos };
}

/** junta os volumes (oficiais, subtenentes e sargentos, cabos e soldados) sem repetir matrícula */
export function juntarAlmanaques(leituras: LeituraAlmanaque[]): LeituraAlmanaque {
  const vistos = new Map<string, RegAlmanaque>();
  for (const l of leituras) for (const r of l.registros) if (!vistos.has(r.matricula)) vistos.set(r.matricula, r);
  const refs = leituras.map((l) => l.referencia).filter(Boolean) as string[];
  return { referencia: refs.sort().pop() || null, registros: [...vistos.values()], avisos: leituras.flatMap((l) => l.avisos) };
}

// ===================================================================== CONCILIAÇÃO
export type MilitarSistema = {
  id: string; matricula: string; nome: string; nome_guerra: string | null; posto_id: number; posto_sigla: string;
  quadro_sigla: string | null; ordem_antiguidade: number | null; ano_ingresso: number | null; data_ingresso?: string | null; situacao: string; ome_sigla: string;
  posto_completo: string;
};
export type PostoDom = { id: number; sigla: string; ordem: number };
export type Alteracao = { id: string; ordem_antiguidade?: number; ano_ingresso?: number; data_ingresso?: string; quadro_sigla?: string; nome_guerra?: string };
export type MudancaPosto = { m: MilitarSistema; r: RegAlmanaque; posto_id: number; quadro_sigla: string | null; promocao: boolean };
export type Conciliacao = {
  automaticas: { m: MilitarSistema; r: RegAlmanaque; alt: Alteracao; campos: string[] }[];
  postos: MudancaPosto[];
  semCadastro: (RegAlmanaque & { parecido?: MilitarSistema })[];
  ausentes: (MilitarSistema & { parecido?: RegAlmanaque })[];
  desligados: { m: MilitarSistema; r: RegAlmanaque }[];
  conferem: number;
};

export function conciliar(registros: RegAlmanaque[], militares: MilitarSistema[], postos: PostoDom[]): Conciliacao {
  const porMat = new Map(militares.map((m) => [m.matricula, m]));
  const pid = new Map(postos.map((p) => [p.sigla, p]));
  const ordemDe = new Map(postos.map((p) => [p.id, p.ordem]));
  const noAlm = new Set(registros.map((r) => r.matricula));
  const out: Conciliacao = { automaticas: [], postos: [], semCadastro: [], ausentes: [], desligados: [], conferem: 0 };
  for (const r of registros) {
    const m = porMat.get(r.matricula);
    if (!m) { out.semCadastro.push(r); continue; }
    if (m.situacao !== 'ATIVO') { out.desligados.push({ m, r }); continue; }
    const p = pid.get(r.posto);
    if (p && p.id !== m.posto_id) {
      out.postos.push({ m, r, posto_id: p.id, quadro_sigla: r.quadro, promocao: p.ordem < (ordemDe.get(m.posto_id) ?? 99) });
    }
    const alt: Alteracao = { id: m.id }; const campos: string[] = [];
    if (r.ordem && r.ordem !== m.ordem_antiguidade) { alt.ordem_antiguidade = r.ordem; campos.push('antiguidade'); }
    if (r.dataIngresso && r.dataIngresso !== m.data_ingresso) { alt.data_ingresso = r.dataIngresso; alt.ano_ingresso = r.anoIngresso!; campos.push('data de ingresso'); }
    else if (!r.dataIngresso && r.anoIngresso && r.anoIngresso !== m.ano_ingresso) { alt.ano_ingresso = r.anoIngresso; campos.push('ano de ingresso'); }
    if (p && p.id === m.posto_id && r.quadro && r.quadro !== m.quadro_sigla) { alt.quadro_sigla = r.quadro; campos.push('quadro'); }
    if (r.nomeGuerra && !m.nome_guerra) { alt.nome_guerra = r.nomeGuerra; campos.push('nome de guerra'); }
    if (campos.length) out.automaticas.push({ m, r, alt, campos }); else if (!(p && p.id !== m.posto_id)) out.conferem++;
  }
  const nomeSem = new Map(out.semCadastro.map((r) => [normal(r.nome), r]));
  for (const m of militares) {
    if (m.situacao !== 'ATIVO' || noAlm.has(m.matricula) || m.posto_sigla === 'Asp') continue;
    out.ausentes.push({ ...m, parecido: nomeSem.get(normal(m.nome)) });
  }
  const nomeAus = new Map(out.ausentes.map((m) => [normal(m.nome), m]));
  out.semCadastro = out.semCadastro.map((r) => ({ ...r, parecido: nomeAus.get(normal(r.nome)) }));
  return out;
}
