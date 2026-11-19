// Motor das consultas livres: assuntos, campos, filtros e tabela dinâmica.
// Tudo roda no navegador sobre os dados que o usuário já pode ver (RLS do banco),
// então nenhuma consulta consegue mostrar além da permissão de quem pergunta.
import { supabase } from './supabase';
import type { Dominios } from './dominios';
import { mapaRegioes, municipioDe, rotuloRegiao } from './regioes';
import { nomeMunicipio } from './municipios';
import { ATIVIDADE, COMPORTAMENTO, ORDEM_COMPORTAMENTO, SEXO, SITUACAO, buscarTodos, fmtData, hojeISO } from './util';
import { MESES, STATUS } from './ferias';

export type Tipo = 'lista' | 'texto' | 'numero' | 'data' | 'bool' | 'periodo';
export type Campo = {
  id: string; rotulo: string; grupo: string; tipo: Tipo;
  valor: (r: any) => any;                       // valor bruto
  ordem?: (r: any) => number | string;          // ordem natural das categorias (posto, OME...)
  exibir?: (v: any) => string;                  // rótulo de exibição de uma categoria
  medida?: boolean;                             // pode ser somado / tirar média
  disponivel?: (linhas: any[]) => boolean;      // campo só aparece quando os dados existem
  dica?: string;
};
export type Op = 'in' | 'nin' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'entre' | 'contem' | 'ncontem' | 'vazio' | 'nvazio' | 'sim' | 'nao' | 'abrange' | 'cruza';
export type Filtro = { campo: string; op: Op; valor?: any; valor2?: any };
export type Medida = 'qtd' | 'pessoas' | 'soma' | 'media';
export type Spec = {
  assunto: string; filtros: Filtro[]; modo: 'E' | 'OU';
  linhas?: string | null; colunas?: string | null;
  medida: Medida; campoMedida?: string | null; pct?: 'nenhum' | 'linha' | 'coluna' | 'total';
  referencia?: string;          // 'hoje' ou competência fechada (AAAA-MM-01), só para militares
  exercicio?: number | null;    // exercício do PAF usado nos campos derivados de férias
};
export type Assunto = {
  id: string; rotulo: string; unidade: string; unidadeSing: string; descricao: string;
  pessoas: boolean;             // tem medida "pessoas distintas"
  campos: Campo[];
};
export type Contexto = { dom: Dominios; regiao: ReturnType<typeof mapaRegioes>; hoje: string };

export const VAZIO = '(não informado)';
const sn = (b: any) => (b == null ? null : b ? 'Sim' : 'Não');
const mesIso = (d?: string | null) => (d ? d.slice(0, 7) : null);
export const exibirMes = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? `${MESES[Number(v.slice(5, 7)) - 1]}/${v.slice(0, 4)}` : v);
const anos = (de: string | null | undefined, ate: string) => {
  if (!de) return null;
  const a = new Date(de + 'T12:00:00'), b = new Date(ate + 'T12:00:00');
  let n = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) n--;
  return n;
};
const faixa = (n: number | null, passo: number, max: number) => {
  if (n == null) return null;
  if (n >= max) return `${max} ou mais`;
  const i = Math.floor(n / passo) * passo;
  return `${String(i).padStart(2, '0')}–${String(i + passo - 1).padStart(2, '0')}`;
};
const TIPO_MOV: Record<string, string> = { INCLUSAO: 'Inclusão', TRANSFERENCIA: 'Transferência', DESLIGAMENTO: 'Desligamento', REINCLUSAO: 'Reinclusão' };

// ---------------------------------------------------------------------
// Campos do militar (servem a todos os assuntos: r.m = militar enriquecido)
// ---------------------------------------------------------------------
const M = (r: any) => r.m || {};
function camposMilitar(prefixo: string): Campo[] {
  const g = (x: string) => (prefixo ? `${prefixo} · ${x}` : x);
  return [
    { id: 'posto', rotulo: 'Posto/graduação', grupo: g('Carreira'), tipo: 'lista', valor: (r) => M(r).posto_sigla, ordem: (r) => M(r).posto_ordem ?? 99 },
    { id: 'quadro', rotulo: 'Quadro (QOC/QOA)', grupo: g('Carreira'), tipo: 'lista', valor: (r) => (M(r).oficial ? M(r).quadro_sigla || VAZIO : M(r).posto_sigla ? 'Praça' : null), ordem: (r) => (M(r).oficial ? (M(r).quadro_sigla === 'QOC' ? 1 : 2) : 9) },
    { id: 'posto_quadro', rotulo: 'Posto e quadro', grupo: g('Carreira'), tipo: 'lista', valor: (r) => M(r).posto_completo, ordem: (r) => (M(r).posto_ordem ?? 99) * 10 + (M(r).quadro_sigla === 'QOA' ? 1 : 0) },
    { id: 'circulo', rotulo: 'Oficial ou praça', grupo: g('Carreira'), tipo: 'lista', valor: (r) => (M(r).oficial == null ? null : M(r).oficial ? 'Oficial' : 'Praça') },
    { id: 'ano_ingresso', rotulo: 'Ano de ingresso', grupo: g('Carreira'), tipo: 'numero', valor: (r) => M(r).ano_ingresso, ordem: (r) => M(r).ano_ingresso ?? 0 },
    { id: 'data_ingresso', rotulo: 'Data de ingresso', grupo: g('Carreira'), tipo: 'data', valor: (r) => M(r).data_ingresso },
    { id: 'tempo_servico', rotulo: 'Tempo de serviço (anos)', grupo: g('Carreira'), tipo: 'numero', medida: true, valor: (r) => M(r)._tempo },
    { id: 'faixa_servico', rotulo: 'Faixa de tempo de serviço', grupo: g('Carreira'), tipo: 'lista', valor: (r) => faixa(M(r)._tempo, 5, 30) },
    { id: 'antig_posto', rotulo: 'Antiguidade no posto (nº)', grupo: g('Carreira'), tipo: 'numero', valor: (r) => M(r)._ant?.pos_posto, dica: 'Disponível na data de hoje' },
    { id: 'antig_geral', rotulo: 'Antiguidade geral (nº)', grupo: g('Carreira'), tipo: 'numero', valor: (r) => M(r)._ant?.pos_geral, dica: 'Disponível na data de hoje' },
    { id: 'tempo_posto', rotulo: 'Tempo no posto atual (anos)', grupo: g('Carreira'), tipo: 'numero', medida: true, valor: (r) => M(r)._tempoPosto, disponivel: (l) => l.some((r) => M(r)._tempoPosto != null), dica: 'Desde a última promoção (soldado: desde o ingresso)' },
    { id: 'ano_promocao', rotulo: 'Ano da última promoção', grupo: g('Carreira'), tipo: 'numero', valor: (r) => (M(r).data_promocao ? Number(String(M(r).data_promocao).slice(0, 4)) : null), disponivel: (l) => l.some((r) => M(r).data_promocao != null) },
    { id: 'regiao', rotulo: 'Região', grupo: g('Lotação'), tipo: 'lista', valor: (r) => M(r)._regiao?.rotulo, ordem: (r) => M(r)._regiao?.ordem ?? 99 },
    { id: 'ome', rotulo: 'OME', grupo: g('Lotação'), tipo: 'lista', valor: (r) => M(r).ome_sigla, ordem: (r) => M(r)._omeOrdem ?? 999 },
    { id: 'tipo_ome', rotulo: 'Tipo de OME', grupo: g('Lotação'), tipo: 'lista', valor: (r) => M(r)._omeTipo },
    { id: 'secao', rotulo: 'Seção', grupo: g('Lotação'), tipo: 'lista', valor: (r) => (M(r).secao_nome ? `${M(r).ome_sigla} · ${M(r).secao_nome}` : null) },
    { id: 'municipio', rotulo: 'Município', grupo: g('Lotação'), tipo: 'lista', valor: (r) => (M(r)._mun ? nomeMunicipio.get(M(r)._mun) : null) },
    { id: 'atividade', rotulo: 'Atividade', grupo: g('Lotação'), tipo: 'lista', valor: (r) => ATIVIDADE[M(r).atividade] || null },
    { id: 'cedido', rotulo: 'Cedido a outro órgão', grupo: g('Lotação'), tipo: 'bool', valor: (r) => (M(r).id ? !!M(r).orgao_cessao : null), disponivel: (l) => l.some((r) => M(r).orgao_cessao != null), dica: 'Pelo pecúlio (coluna ÓRGÃO)' },
    { id: 'orgao_cessao', rotulo: 'Órgão de cessão', grupo: g('Lotação'), tipo: 'lista', valor: (r) => M(r).orgao_cessao || (M(r).id ? 'CBMPE (não cedido)' : null), disponivel: (l) => l.some((r) => M(r).orgao_cessao != null) },
    { id: 'situacao', rotulo: 'Situação funcional', grupo: g('Situação'), tipo: 'lista', valor: (r) => SITUACAO[M(r).situacao] || M(r).situacao },
    { id: 'disponivel', rotulo: 'Situação no dia', grupo: g('Situação'), tipo: 'lista', valor: (r) => (M(r).situacao && M(r).situacao !== 'ATIVO' ? 'Fora do ativo' : M(r).afastado_hoje ? 'Afastado' : M(r).id ? 'Disponível' : null) },
    { id: 'afast_atual', rotulo: 'Afastamento em curso', grupo: g('Situação'), tipo: 'lista', valor: (r) => M(r).afastamento_nome || (M(r).id ? 'Nenhum' : null) },
    { id: 'sexo', rotulo: 'Sexo', grupo: g('Perfil'), tipo: 'lista', valor: (r) => SEXO[M(r).sexo] || M(r).sexo, disponivel: (l) => l.some((r) => M(r).sexo != null) },
    { id: 'idade', rotulo: 'Idade', grupo: g('Perfil'), tipo: 'numero', medida: true, valor: (r) => M(r)._idade, disponivel: (l) => l.some((r) => M(r)._idade != null) },
    { id: 'faixa_etaria', rotulo: 'Faixa etária', grupo: g('Perfil'), tipo: 'lista', valor: (r) => faixa(M(r)._idade, 5, 60), disponivel: (l) => l.some((r) => M(r)._idade != null) },
    { id: 'escolaridade', rotulo: 'Escolaridade', grupo: g('Perfil'), tipo: 'lista', valor: (r) => M(r).escolaridade, ordem: (r) => -(M(r).escolaridade_ordem ?? 0) },
    { id: 'areas', rotulo: 'Área de formação', grupo: g('Perfil'), tipo: 'texto', valor: (r) => M(r).areas_formacao },
    { id: 'idiomas', rotulo: 'Idiomas', grupo: g('Perfil'), tipo: 'texto', valor: (r) => M(r).idiomas },
    { id: 'readaptado', rotulo: 'Readaptado', grupo: g('Condições especiais'), tipo: 'bool', valor: (r) => M(r).readaptado },
    { id: 'horario_especial', rotulo: 'Horário especial', grupo: g('Condições especiais'), tipo: 'bool', valor: (r) => M(r).horario_especial },
    { id: 'acumulacao', rotulo: 'Acumulação de cargo', grupo: g('Condições especiais'), tipo: 'bool', valor: (r) => M(r).acumulacao_cargo },
    { id: 'pcd', rotulo: 'PCD', grupo: g('Condições especiais'), tipo: 'bool', valor: (r) => M(r).pcd },
    { id: 'comportamento', rotulo: 'Comportamento (publicado)', grupo: g('Disciplina'), tipo: 'lista',
      valor: (r) => (M(r).posto_ordem != null && M(r).posto_ordem < 8 ? 'Não se aplica (oficial/aspirante)' : COMPORTAMENTO[M(r).comportamento] || null),
      ordem: (r) => { const i = ORDEM_COMPORTAMENTO.indexOf(M(r).comportamento); return i < 0 ? 9 : i; },
      disponivel: (l) => l.some((r) => M(r).comportamento != null), dica: 'O último publicado. O cálculo da escala móvel fica na tela Comportamento.' },
    { id: 'punicoes', rotulo: 'Punições registradas (qtd)', grupo: g('Disciplina'), tipo: 'numero', medida: true, valor: (r) => M(r).qtd_punicoes },
    { id: 'completude', rotulo: 'Cadastro completo (%)', grupo: g('Qualidade do cadastro'), tipo: 'numero', medida: true, valor: (r) => M(r).completude },
  ].map((c) => (prefixo ? { ...c, id: 'm.' + c.id } : c)) as Campo[];
}

// Situação do militar num exercício do PAF (campos derivados)
const situacaoPaf = (ps: any[] | undefined) => {
  const v = (ps || []).filter((p) => p.situacao !== 'CANCELADA');
  if (!v.length) return 'Sem previsão';
  const st = v.map((p) => p.status);
  if (st.every((s) => s === 'NAO_GOZADA')) return 'Não gozadas (publicado)';
  if (st.every((s) => s === 'PROPOSTA')) return 'Só proposta';
  if (st.includes('EM_GOZO')) return 'Em gozo';
  const goz = st.filter((s) => s === 'GOZADA' || s === 'INTERROMPIDA').length;
  const aGozar = st.filter((s) => s === 'A_GOZAR' || s === 'PROPOSTA').length;
  if (goz && !aGozar) return 'Gozou todas as parcelas';
  if (goz && aGozar) return 'Gozou parte';
  return 'Nenhuma parcela gozada ainda';
};
const ORDEM_PAF = ['Gozou todas as parcelas', 'Gozou parte', 'Em gozo', 'Nenhuma parcela gozada ainda', 'Só proposta', 'Sem previsão', 'Não gozadas (publicado)'];

// ---------------------------------------------------------------------
// Assuntos
// ---------------------------------------------------------------------
export function assuntos(exercicio: number | null): Assunto[] {
  const ex = exercicio ? ` ${exercicio}` : '';
  return [
    {
      id: 'militares', rotulo: 'Militares (efetivo)', unidade: 'militares', unidadeSing: 'militar', pessoas: false,
      descricao: 'Um registro por militar. Responde "quantos", "quem" e "onde".',
      campos: [
        ...camposMilitar(''),
        { id: 'paf_situacao', rotulo: `Situação no PAF${ex}`, grupo: 'Férias (PAF)', tipo: 'lista', valor: (r) => (exercicio ? situacaoPaf(r._paf) : null), ordem: (r) => ORDEM_PAF.indexOf(situacaoPaf(r._paf)) },
        { id: 'paf_dias', rotulo: `Dias gozados no PAF${ex}`, grupo: 'Férias (PAF)', tipo: 'numero', medida: true, valor: (r) => (exercicio ? (r._paf || []).reduce((a: number, p: any) => a + (p.status === 'GOZADA' ? p.dias : p.status === 'INTERROMPIDA' ? p.dias_efetivos || 0 : 0), 0) : null) },
        { id: 'paf_parcelas', rotulo: `Parcelas no PAF${ex}`, grupo: 'Férias (PAF)', tipo: 'numero', valor: (r) => (exercicio ? (r._paf || []).filter((p: any) => p.situacao !== 'CANCELADA').length : null) },
      ],
    },
    {
      id: 'afastamentos', rotulo: 'Afastamentos', unidade: 'afastamentos', unidadeSing: 'afastamento', pessoas: true,
      descricao: 'Um registro por afastamento. Use "Vigente em" para saber quem estava afastado numa data.',
      campos: [
        { id: 'tipo', rotulo: 'Tipo de afastamento', grupo: 'Afastamento', tipo: 'lista', valor: (r) => r.tipo_nome },
        { id: 'vigente', rotulo: 'Vigente em (período)', grupo: 'Afastamento', tipo: 'periodo', valor: (r) => [r.data_inicio, r.data_fim] },
        { id: 'status', rotulo: 'Situação hoje', grupo: 'Afastamento', tipo: 'lista', valor: (r) => ({ 'EM CURSO': 'Em curso', ENCERRADO: 'Encerrado', PREVISTO: 'Previsto' } as any)[r.status] || r.status },
        { id: 'inicio', rotulo: 'Data de início', grupo: 'Afastamento', tipo: 'data', valor: (r) => r.data_inicio },
        { id: 'fim', rotulo: 'Data de término', grupo: 'Afastamento', tipo: 'data', valor: (r) => r.data_fim },
        { id: 'mes', rotulo: 'Mês de início', grupo: 'Afastamento', tipo: 'lista', valor: (r) => mesIso(r.data_inicio), exibir: exibirMes },
        { id: 'ano', rotulo: 'Ano de início', grupo: 'Afastamento', tipo: 'numero', valor: (r) => Number(String(r.data_inicio).slice(0, 4)) },
        { id: 'dias', rotulo: 'Dias', grupo: 'Afastamento', tipo: 'numero', medida: true, valor: (r) => r.dias },
        { id: 'pelo_paf', rotulo: 'Férias do PAF', grupo: 'Afastamento', tipo: 'bool', valor: (r) => !!r.ferias_periodo_id },
        { id: 'sei', rotulo: 'Com processo SEI', grupo: 'Afastamento', tipo: 'bool', valor: (r) => !!r.processo_sei },
        ...camposMilitar('Militar'),
      ],
    },
    {
      id: 'ferias', rotulo: 'Férias (períodos do PAF)', unidade: 'períodos', unidadeSing: 'período', pessoas: true,
      descricao: 'Um registro por período de férias (militares e servidores civis).',
      campos: [
        { id: 'exercicio', rotulo: 'Exercício (PAF)', grupo: 'Férias', tipo: 'lista', valor: (r) => String(r.exercicio) },
        { id: 'status', rotulo: 'Situação do período', grupo: 'Férias', tipo: 'lista', valor: (r) => STATUS[r.status]?.rotulo || r.status, ordem: (r) => ['PROPOSTA', 'A_GOZAR', 'EM_GOZO', 'GOZADA', 'INTERROMPIDA', 'NAO_GOZADA', 'CANCELADA'].indexOf(r.status) },
        { id: 'mes', rotulo: 'Mês de início', grupo: 'Férias', tipo: 'lista', valor: (r) => mesIso(r.data_inicio), exibir: exibirMes },
        { id: 'mes_previsto', rotulo: 'Mês planejado', grupo: 'Férias', tipo: 'lista', valor: (r) => mesIso(r.previsto_inicio), exibir: exibirMes },
        { id: 'aderencia', rotulo: 'Gozo no mês planejado', grupo: 'Férias', tipo: 'bool', valor: (r) => (r.previsto_inicio ? mesIso(r.previsto_inicio) === mesIso(r.data_inicio) : null), dica: 'Compara o mês em que o período começou com o mês do plano' },
        { id: 'parcela', rotulo: 'Parcela', grupo: 'Férias', tipo: 'lista', valor: (r) => (r.parcela ? `${r.parcela}ª parcela` : null) },
        { id: 'dias', rotulo: 'Dias', grupo: 'Férias', tipo: 'numero', medida: true, valor: (r) => r.dias_efetivos ?? r.dias },
        { id: 'vigente', rotulo: 'Em gozo em (período)', grupo: 'Férias', tipo: 'periodo', valor: (r) => [r.data_inicio, r.data_fim] },
        { id: 'origem', rotulo: 'Origem', grupo: 'Férias', tipo: 'lista', valor: (r) => ({ PAF: 'PAF', REPROGRAMACAO: 'Reprogramação', IMPORTACAO: 'Planilha (importação)' } as any)[r.origem] || r.origem },
        { id: 'estimada', rotulo: 'Dia estimado na importação', grupo: 'Férias', tipo: 'bool', valor: (r) => r.data_estimada },
        { id: 'excecao', rotulo: 'Com pedido de exceção', grupo: 'Férias', tipo: 'bool', valor: (r) => !!r.excecao },
        { id: 'pessoa', rotulo: 'Militar ou civil', grupo: 'Férias', tipo: 'lista', valor: (r) => (r.tipo_pessoa === 'CIVIL' ? 'Servidor civil' : 'Militar') },
        ...camposMilitar('Militar'),
      ],
    },
    {
      id: 'movimentacoes', rotulo: 'Movimentações', unidade: 'movimentações', unidadeSing: 'movimentação', pessoas: true,
      descricao: 'Inclusões, transferências, desligamentos e reinclusões registrados.',
      campos: [
        { id: 'tipo', rotulo: 'Tipo', grupo: 'Movimentação', tipo: 'lista', valor: (r) => TIPO_MOV[r.tipo] || r.tipo },
        { id: 'data', rotulo: 'Data', grupo: 'Movimentação', tipo: 'data', valor: (r) => r.data },
        { id: 'mes', rotulo: 'Mês', grupo: 'Movimentação', tipo: 'lista', valor: (r) => mesIso(r.data), exibir: exibirMes },
        { id: 'ano', rotulo: 'Ano', grupo: 'Movimentação', tipo: 'numero', valor: (r) => Number(String(r.data).slice(0, 4)) },
        { id: 'origem', rotulo: 'OME de origem', grupo: 'Movimentação', tipo: 'lista', valor: (r) => r.ome_origem_sigla, ordem: (r) => r._ordOrig ?? 999 },
        { id: 'destino', rotulo: 'OME de destino', grupo: 'Movimentação', tipo: 'lista', valor: (r) => r.ome_destino_sigla, ordem: (r) => r._ordDest ?? 999 },
        { id: 'regiao_origem', rotulo: 'Região de origem', grupo: 'Movimentação', tipo: 'lista', valor: (r) => r._regOrig },
        { id: 'regiao_destino', rotulo: 'Região de destino', grupo: 'Movimentação', tipo: 'lista', valor: (r) => r._regDest },
        { id: 'situacao_nova', rotulo: 'Nova situação', grupo: 'Movimentação', tipo: 'lista', valor: (r) => SITUACAO[r.situacao_nova] || r.situacao_nova },
        ...camposMilitar('Militar'),
      ],
    },
  ];
}

export const campoDe = (a: Assunto, id?: string | null) => (id ? a.campos.find((c) => c.id === id) || null : null);

// Categoria (texto) de um campo numa linha — é o que se compara nos filtros "lista" e se agrupa
export function categoria(c: Campo, r: any): string {
  const v = c.valor(r);
  if (v == null || v === '') return VAZIO;
  if (c.tipo === 'bool') return v ? 'Sim' : 'Não';
  if (c.tipo === 'data') return fmtData(v);
  return String(v);
}
export const exibirCategoria = (c: Campo | null, v: string) => (c?.exibir && v !== VAZIO ? c.exibir(v) : v);

// ---------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------
export const OPS: Record<Tipo, { op: Op; rotulo: string; valores: 0 | 1 | 2 }[]> = {
  lista: [{ op: 'in', rotulo: 'é um de', valores: 1 }, { op: 'nin', rotulo: 'não é nenhum de', valores: 1 }, { op: 'vazio', rotulo: 'não informado', valores: 0 }, { op: 'nvazio', rotulo: 'informado', valores: 0 }],
  texto: [{ op: 'contem', rotulo: 'contém', valores: 1 }, { op: 'ncontem', rotulo: 'não contém', valores: 1 }, { op: 'vazio', rotulo: 'não informado', valores: 0 }, { op: 'nvazio', rotulo: 'informado', valores: 0 }],
  numero: [{ op: 'eq', rotulo: '=', valores: 1 }, { op: 'neq', rotulo: '≠', valores: 1 }, { op: 'gt', rotulo: '>', valores: 1 }, { op: 'gte', rotulo: '≥', valores: 1 }, { op: 'lt', rotulo: '<', valores: 1 }, { op: 'lte', rotulo: '≤', valores: 1 }, { op: 'entre', rotulo: 'entre', valores: 2 }, { op: 'vazio', rotulo: 'não informado', valores: 0 }],
  data: [{ op: 'eq', rotulo: 'em', valores: 1 }, { op: 'gte', rotulo: 'a partir de', valores: 1 }, { op: 'lte', rotulo: 'até', valores: 1 }, { op: 'entre', rotulo: 'entre', valores: 2 }, { op: 'vazio', rotulo: 'não informada', valores: 0 }],
  bool: [{ op: 'sim', rotulo: 'sim', valores: 0 }, { op: 'nao', rotulo: 'não', valores: 0 }],
  periodo: [{ op: 'abrange', rotulo: 'na data', valores: 1 }, { op: 'cruza', rotulo: 'em algum dia entre', valores: 2 }],
};

const semAc = (s: any) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function testar(f: Filtro, c: Campo, r: any, hoje: string): boolean {
  const v = c.valor(r);
  const vazio = v == null || v === '' || (Array.isArray(v) && !v[0]);
  switch (f.op) {
    case 'vazio': return vazio;
    case 'nvazio': return !vazio;
    case 'sim': return v === true;
    case 'nao': return v === false;
    case 'in': return (f.valor || []).includes(categoria(c, r));
    case 'nin': return !(f.valor || []).includes(categoria(c, r));
    case 'contem': return !vazio && semAc(v).includes(semAc(f.valor));
    case 'ncontem': return vazio || !semAc(v).includes(semAc(f.valor));
    case 'abrange': { if (vazio) return false; const d = f.valor || hoje; return v[0] <= d && d <= v[1]; }
    case 'cruza': { if (vazio || !f.valor || !f.valor2) return false; return v[0] <= f.valor2 && v[1] >= f.valor; }
  }
  if (vazio) return false;
  const n = c.tipo === 'numero' ? Number(v) : String(v);
  const a = c.tipo === 'numero' ? Number(f.valor) : String(f.valor ?? '');
  const b = c.tipo === 'numero' ? Number(f.valor2) : String(f.valor2 ?? '');
  switch (f.op) {
    case 'eq': return n === a;
    case 'neq': return n !== a;
    case 'gt': return n > a;
    case 'gte': return n >= a;
    case 'lt': return n < a;
    case 'lte': return n <= a;
    case 'entre': return n >= a && n <= b;
  }
  return true;
}

export const filtroCompleto = (f: Filtro, c: Campo | null) => {
  if (!c) return false;
  const d = OPS[c.tipo].find((o) => o.op === f.op);
  if (!d) return false;
  if (d.valores === 0) return true;
  if (f.op === 'in' || f.op === 'nin') return Array.isArray(f.valor) && f.valor.length > 0;
  if (f.op === 'abrange') return true;
  if (d.valores === 2) return f.valor !== undefined && f.valor !== '' && f.valor2 !== undefined && f.valor2 !== '';
  return f.valor !== undefined && f.valor !== '';
};

export function aplicarFiltros(linhas: any[], a: Assunto, spec: Spec, hoje: string) {
  const ativos = spec.filtros.map((f) => ({ f, c: campoDe(a, f.campo) })).filter((x) => filtroCompleto(x.f, x.c)) as { f: Filtro; c: Campo }[];
  if (!ativos.length) return linhas;
  return linhas.filter((r) => (spec.modo === 'OU'
    ? ativos.some(({ f, c }) => testar(f, c, r, hoje))
    : ativos.every(({ f, c }) => testar(f, c, r, hoje))));
}

export function descreverFiltro(f: Filtro, c: Campo | null) {
  if (!c) return '';
  const d = OPS[c.tipo].find((o) => o.op === f.op);
  const val = (x: any) => (c.tipo === 'data' || c.tipo === 'periodo' ? fmtData(x) : String(x));
  let s = `${c.rotulo} ${d?.rotulo || f.op}`;
  if (f.op === 'in' || f.op === 'nin') s += ' ' + (f.valor || []).map((x: string) => exibirCategoria(c, x)).join(', ');
  else if (f.op === 'abrange') s += ' ' + (f.valor ? fmtData(f.valor) : 'de hoje');
  else if (d?.valores === 1) s += ' ' + val(f.valor);
  else if (d?.valores === 2) s += ` ${val(f.valor)} e ${val(f.valor2)}`;
  return s;
}

// ---------------------------------------------------------------------
// Tabela dinâmica
// ---------------------------------------------------------------------
type Acc = { n: number; pessoas: Set<string>; soma: number; cnt: number };
const novo = (): Acc => ({ n: 0, pessoas: new Set(), soma: 0, cnt: 0 });
export type Pivo = {
  linhas: string[]; colunas: string[];
  celula: (l: string, c: string) => number | null; totLinha: (l: string) => number | null; totColuna: (c: string) => number | null; total: number | null;
  bruto: (l: string | null, c: string | null) => number;   // contagem simples (para %)
};

export function pivotar(linhas: any[], a: Assunto, spec: Spec): Pivo {
  const cl = campoDe(a, spec.linhas), cc = campoDe(a, spec.colunas), cm = campoDe(a, spec.campoMedida);
  const TOT = '\u0000';
  const mapa = new Map<string, Map<string, Acc>>();
  const ordL = new Map<string, number | string>(), ordC = new Map<string, number | string>();
  const pessoa = (r: any) => r.pessoa_id || r.militar_id || r.id;
  const add = (l: string, c: string, r: any) => {
    let m = mapa.get(l); if (!m) { m = new Map(); mapa.set(l, m); }
    let x = m.get(c); if (!x) { x = novo(); m.set(c, x); }
    x.n++; x.pessoas.add(pessoa(r));
    if (cm) { const v = cm.valor(r); if (v != null && v !== '' && !isNaN(Number(v))) { x.soma += Number(v); x.cnt++; } }
  };
  for (const r of linhas) {
    const l = cl ? categoria(cl, r) : TOT, c = cc ? categoria(cc, r) : TOT;
    if (cl && !ordL.has(l)) ordL.set(l, cl.ordem ? cl.ordem(r) : cl.tipo === 'numero' ? Number(cl.valor(r)) : l);
    if (cc && !ordC.has(c)) ordC.set(c, cc.ordem ? cc.ordem(r) : cc.tipo === 'numero' ? Number(cc.valor(r)) : c);
    add(l, c, r);
    if (cc) add(l, TOT, r);
    if (cl) add(TOT, c, r);
    if (cl && cc) add(TOT, TOT, r);
  }
  const ordenar = (m: Map<string, number | string>) => [...m.keys()].sort((x, y) => {
    if (x === VAZIO) return 1; if (y === VAZIO) return -1;
    const a1 = m.get(x)!, b1 = m.get(y)!;
    if (typeof a1 === 'number' && typeof b1 === 'number' && a1 !== b1) return a1 - b1;
    return String(a1).localeCompare(String(b1), 'pt-BR', { numeric: true }) || x.localeCompare(y, 'pt-BR', { numeric: true });
  });
  const valor = (x?: Acc): number | null => {
    if (!x) return null;
    switch (spec.medida) {
      case 'pessoas': return x.pessoas.size;
      case 'soma': return cm ? x.soma : x.n;
      case 'media': return cm && x.cnt ? x.soma / x.cnt : null;
      default: return x.n;
    }
  };
  const get = (l: string, c: string) => mapa.get(l)?.get(c);
  return {
    linhas: cl ? ordenar(ordL) : [], colunas: cc ? ordenar(ordC) : [],
    celula: (l, c) => valor(get(l, c)), totLinha: (l) => valor(get(l, TOT)), totColuna: (c) => valor(get(TOT, c)),
    total: valor(get(TOT, TOT)) ?? (linhas.length ? null : 0),
    bruto: (l, c) => get(l ?? TOT, c ?? TOT)?.n || 0,
  };
}

export const linhaCasa = (a: Assunto, spec: Spec, r: any, l: string | null, c: string | null) => {
  const cl = campoDe(a, spec.linhas), cc = campoDe(a, spec.colunas);
  return (l == null || !cl || categoria(cl, r) === l) && (c == null || !cc || categoria(cc, r) === c);
};

// ---------------------------------------------------------------------
// Carga dos dados
// ---------------------------------------------------------------------
const COLS_MIL = ['id', 'matricula', 'nome', 'nome_guerra', 'posto_id', 'posto_sigla', 'posto_ordem', 'posto_completo', 'quadro_sigla', 'oficial',
  'ome_id', 'ome_sigla', 'secao_id', 'secao_nome', 'atividade', 'ano_ingresso', 'data_ingresso', 'ordem_antiguidade', 'situacao',
  'afastado_hoje', 'afastamento_codigo', 'afastamento_nome', 'afastamento_fim', 'readaptado', 'horario_especial', 'acumulacao_cargo', 'pcd',
  'escolaridade', 'escolaridade_ordem', 'areas_formacao', 'idiomas', 'qtd_punicoes', 'completude'];
// campos da versão 1.4 (pecúlio, almanaque e comportamento): se o banco ainda não tiver, a consulta segue sem eles
const COLS_14 = ['sexo', 'data_nascimento', 'orgao_cessao', 'data_promocao', 'comportamento', 'comportamento_data'];

export async function carregarMilitares(referencia: string, extras: string[] = []): Promise<any[]> {
  if (referencia && referencia !== 'hoje') {
    const l = await buscarTodos(() => supabase.from('fechamento_militar').select('dados').eq('competencia', referencia).order('militar_id'));
    return l.map((x: any) => x.dados);
  }
  const cols = [...COLS_MIL, ...COLS_14, ...extras].join(',');
  try {
    return await buscarTodos(() => supabase.from('v_militar').select(cols).order('id'));
  } catch {
    return await buscarTodos(() => supabase.from('v_militar').select(COLS_MIL.join(',')).order('id'));
  }
}

export async function carregarAntiguidade(): Promise<Map<string, any>> {
  const { data, error } = await supabase.rpc('antiguidade_lista');
  if (error) return new Map();
  return new Map((data || []).map((x: any) => [x.militar_id, x]));
}

export function enriquecer(ms: any[], ctx: Contexto, ant: Map<string, any> | null, referencia: string) {
  const ref = referencia && referencia !== 'hoje' ? referencia : ctx.hoje;
  const ordOme = new Map(ctx.dom.omes.map((o) => [o.id, o]));
  return ms.map((m) => {
    const o = ordOme.get(m.ome_id);
    return {
      ...m,
      _regiao: ctx.regiao.de(m.ome_id),
      _omeOrdem: o?.ordem ?? 999,
      _omeTipo: o ? ({ GRUPAMENTO: 'Grupamento', DIRETORIA: 'Diretoria', ADIDOS: 'Adidos', OUTRA: 'Outra' } as any)[o.tipo] || o.tipo : null,
      _mun: municipioDe(ctx.dom, m.ome_id, m.secao_id),
      _tempo: m.data_ingresso ? anos(m.data_ingresso, ref) : m.ano_ingresso ? Number(ref.slice(0, 4)) - m.ano_ingresso : null,
      _idade: m.data_nascimento ? anos(m.data_nascimento, ref) : null,
      _tempoPosto: m.data_promocao ? anos(m.data_promocao, ref) : m.posto_ordem === 13 && m.data_ingresso ? anos(m.data_ingresso, ref) : null,
      _ant: ant?.get(m.id) || null,
    };
  });
}

export const dataHoje = () => hojeISO();

// Consulta no endereço da página (link compartilhável): JSON em base64 próprio para URL
export const codificar = (s: Spec) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const decodificar = (q: string | null): Spec | null => {
  if (!q) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(q.replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return null; }
};
export { rotuloRegiao };
