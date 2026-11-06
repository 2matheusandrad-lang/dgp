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
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const fmtCompetencia = (v?: string | null) => {
  if (!v) return '';
  const [a, m] = String(v).slice(0, 10).split('-');
  return `${MESES[+m - 1]}/${a}`;
};
export const mesesAte = (iso: string, n: number) => {
  const [a, m] = iso.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(a, m - 1 - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
};

// ---------------- matrícula / telefone ----------------
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
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---------------- erros ----------------
export const msgErro = (e: any): string => {
  const m: string = e?.message || String(e);
  if (/row-level security/i.test(m)) return 'Sem permissão para esta operação nesta OME.';
  if (/militar_matricula_key|duplicate key.*matricula/i.test(m)) return 'Matrícula já cadastrada no sistema. Use "Receber militar transferido".';
  if (/solicitacao_pendente_unica/.test(m)) return 'Já existe pedido pendente para este militar.';
  if (/duplicate key/i.test(m)) return 'Registro duplicado.';
  if (/MATRICULA_NAO_CADASTRADA/.test(m)) return 'Matrícula não encontrada no sistema.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/violates check constraint.*data_inicio/i.test(m)) return 'Data de início inválida.';
  if (/violates check constraint.*dias/i.test(m)) return 'Quantidade de dias inválida (1 a 3650).';
  if (/violates check constraint.*email/i.test(m)) return 'E-mail inválido.';
  if (/violates check constraint.*cid/i.test(m)) return 'CID em formato inválido (ex.: M54.5).';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com o servidor.';
  return m;
};

// ---------------- consultas (Supabase entrega no máx. 1000 linhas por chamada) ----------------
// Busca a 1ª página; se vier cheia, busca as próximas em paralelo (em vez de uma por vez).
export async function buscarTodos<T = any>(montar: () => any, lote = 1000): Promise<T[]> {
  const primeira = await montar().range(0, lote - 1);
  if (primeira.error) throw primeira.error;
  const todos: T[] = [...(primeira.data || [])];
  let de = lote;
  while (todos.length === de) {
    const paginas = await Promise.all([0, 1, 2].map((i) => montar().range(de + i * lote, de + (i + 1) * lote - 1)));
    for (const p of paginas) {
      if (p.error) throw p.error;
      todos.push(...(p.data || []));
    }
    de += 3 * lote;
  }
  return todos;
}

export async function rpc<T = any>(fn: string, args?: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

// ---------------- colunas de exportação ----------------
export type Coluna<T = any> = { id?: string; titulo: string; valor: (r: T, i: number) => any; largura?: number; padrao?: boolean };

// ---------------- registro de exportações (LGPD) ----------------
let autorExportacao = '';
export const definirAutorExportacao = (nome: string) => { autorExportacao = nome; };
/** texto que vai no rodapé de todo PDF/Excel gerado */
export const marcaLgpd = () =>
  `Uso interno · contém dados pessoais (LGPD) · gerado por ${autorExportacao || 'usuário do sistema'} em ${new Date().toLocaleString('pt-BR')}`;
const PESSOAL = /telefone|e-?mail|endere|nascimento|cpf|rg\b|natureza|cid\b|contato/i;
/** registra quem exportou o quê (não bloqueia a exportação se o registro falhar) */
export async function registrarExportacao(tela: string, arquivo: string, formato: string, registros: number, colunas: string[], pessoal?: boolean) {
  try {
    await supabase.rpc('registrar_exportacao', {
      p_tela: tela, p_arquivo: arquivo, p_formato: formato, p_registros: registros, p_colunas: colunas,
      p_dados_pessoais: pessoal ?? colunas.some((c) => PESSOAL.test(c)),
    });
  } catch { /* registro é complementar */ }
}

export async function exportarXlsx<T>(arquivo: string, titulo: string, colunas: Coluna<T>[], linhas: T[], agrupar?: (r: T) => string) {
  const m = await import('./excel');
  registrarExportacao(titulo, arquivo, 'xlsx', linhas.length, colunas.map((c) => c.titulo));
  return m.exportarExcel(arquivo, titulo, colunas, linhas, agrupar);
}
export async function exportarPdf<T>(arquivo: string, titulo: string, subtitulo: string, colunas: Coluna<T>[], linhas: T[], agrupar?: (r: T) => string, assinatura = false) {
  const m = await import('./pdf');
  registrarExportacao(titulo, arquivo, 'pdf', linhas.length, colunas.map((c) => c.titulo));
  return m.pdfTabela({ arquivo, titulo, subtitulo, colunas, linhas, agrupar, assinatura });
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

// Processo SEI: copia para a área de transferência; se VITE_SEI_PESQUISA estiver definido, abre a pesquisa
export const SEI_URL = (import.meta.env.VITE_SEI_PESQUISA as string) || '';
export const linkSei = (processo?: string | null) =>
  processo && SEI_URL ? SEI_URL.replace('{processo}', encodeURIComponent(processo)) : null;

/** percentual no padrão brasileiro: 104,7% */
export const pct = (v: number | string | null | undefined, casas = 1) =>
  v == null || v === '' || isNaN(Number(v)) ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`;
