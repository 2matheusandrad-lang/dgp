import * as XLSX from 'xlsx';
import { supabase } from './supabase';

// ---------------- datas ----------------
export const hojeISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const somaDias = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
export const fmtData = (v?: string | null) => {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  const [a, m, d] = s.split('-');
  return d ? `${d}/${m}/${a}` : s;
};
export const fmtDataHora = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
export const fmtCompetencia = (v?: string | null) => {
  if (!v) return '';
  const [a, m] = String(v).slice(0, 10).split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${nomes[+m - 1]}/${a}`;
};

// ---------------- matrícula ----------------
export const mascaraMatricula = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 7);
  return d.length > 6 ? `${d.slice(0, 6)}-${d.slice(6)}` : d;
};
export const matriculaValida = (m: string) => {
  if (!/^\d{6}-\d$/.test(m)) return false;
  let s = 0;
  for (let i = 0; i < 6; i++) s += +m[i] * (7 - i);
  let dv = 11 - (s % 11);
  if (dv >= 10) dv = 0;
  return dv === +m[7];
};
export const mascaraTelefone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

// ---------------- erros ----------------
export const msgErro = (e: any): string => {
  const m: string = e?.message || String(e);
  if (/row-level security/i.test(m)) return 'Sem permissão para esta operação nesta OME.';
  if (/militar_matricula_key|duplicate key.*matricula/i.test(m)) return 'Matrícula já cadastrada no sistema. Use "Receber militar transferido".';
  if (/duplicate key/i.test(m)) return 'Registro duplicado.';
  if (/MATRICULA_NAO_CADASTRADA/.test(m)) return 'Matrícula não encontrada no sistema.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/violates check constraint.*data_inicio/i.test(m)) return 'Data de início inválida.';
  if (/violates check constraint.*dias/i.test(m)) return 'Quantidade de dias inválida (1 a 3650).';
  if (/violates check constraint.*email/i.test(m)) return 'E-mail inválido.';
  if (/violates check constraint.*cid/i.test(m)) return 'CID em formato inválido (ex.: M54.5).';
  if (/Failed to fetch/i.test(m)) return 'Sem conexão com o servidor.';
  return m;
};

// ---------------- consultas paginadas (Supabase limita 1000 linhas por chamada) ----------------
export async function buscarTodos<T = any>(montar: () => any, lote = 1000): Promise<T[]> {
  const todos: T[] = [];
  for (let de = 0; ; de += lote) {
    const { data, error } = await montar().range(de, de + lote - 1);
    if (error) throw error;
    todos.push(...(data || []));
    if (!data || data.length < lote) break;
  }
  return todos;
}

export async function rpc<T = any>(fn: string, args?: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// ---------------- exportação ----------------
export type Coluna<T = any> = { titulo: string; valor: (r: T, i: number) => any; largura?: number };

export function exportarXlsx<T>(arquivo: string, titulo: string, colunas: Coluna<T>[], linhas: T[]) {
  const cab = colunas.map((c) => c.titulo);
  const dados = linhas.map((r, i) => colunas.map((c) => {
    const v = c.valor(r, i);
    return v === null || v === undefined ? '' : v;
  }));
  const ws = XLSX.utils.aoa_to_sheet([[titulo], [`Gerado em ${new Date().toLocaleString('pt-BR')}`], [], cab, ...dados]);
  ws['!cols'] = colunas.map((c) => ({ wch: c.largura || Math.max(10, c.titulo.length + 2) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + dados.length, c: cab.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatório');
  XLSX.writeFile(wb, `${arquivo}_${hojeISO()}.xlsx`);
}

export const ATIVIDADE: Record<string, string> = { OPERACIONAL: 'Operacional', ADMINISTRATIVO: 'Administrativo' };
export const SITUACAO: Record<string, string> = {
  ATIVO: 'Ativo', RESERVA: 'Reserva', REFORMA: 'Reforma', FALECIDO: 'Falecido', EXCLUIDO: 'Excluído', OUTRO: 'Outro',
};
export const REGISTRO_TIPO: Record<string, string> = {
  READAPTACAO: 'Readaptação', HORARIO_ESPECIAL: 'Horário especial', ACUMULACAO_CARGO: 'Acumulação de cargo', PCD: 'PCD',
};
export const PAPEL: Record<string, string> = {
  ADMIN: 'Administrador (DGP)', DGP: 'Operador DGP', LEITOR_GERAL: 'Consulta geral', GESTOR: 'Gestor da OME', LEITOR: 'Consulta da OME',
};

export const ordenarAntiguidade = (a: any, b: any) =>
  (a.posto_ordem - b.posto_ordem) ||
  ((a.ordem_antiguidade ?? 1e9) - (b.ordem_antiguidade ?? 1e9)) ||
  ((a.ano_ingresso ?? 9999) - (b.ano_ingresso ?? 9999)) ||
  String(a.nome).localeCompare(String(b.nome), 'pt-BR');

export const semAcento = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
