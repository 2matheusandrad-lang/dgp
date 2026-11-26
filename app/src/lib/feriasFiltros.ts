// Filtros do quadro de férias, compartilhados pela tela e pelos relatórios (mesma regra nos dois lugares).
import type { Dominios } from './dominios';
import { diasEfetivos, rotuloMes } from './ferias';

export type FiltrosFerias = { so: string; posto: string; quadro: string; secao: string; ingresso: string; mes: string; busca: string };
export const FILTROS_VAZIOS: FiltrosFerias = { so: 'todos', posto: '', quadro: '', secao: '', ingresso: '', mes: '', busca: '' };

export const SITUACOES_EX: [string, string][] = [
  ['todos', 'Todos'], ['sem', 'Sem previsão'], ['incompletos', 'Com menos de 30 dias'], ['completos', 'Com 30 dias programados'],
  ['agozar', 'Com parcela a gozar'], ['emgozo', 'Em gozo agora'], ['gozou', 'Já gozou tudo'],
  ['excecao', 'Com exceção pendente'], ['reprog', 'Com reprogramação'], ['estimada', 'Com dia estimado'],
];

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fimMes = (iso: string) => { const [a, m] = iso.split('-').map(Number); return `${iso.slice(0, 8)}${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`; };

/** ps = períodos vigentes da pessoa (qualquer exercício); ano = exercício em análise */
export function passaFiltro(p: any, ps: any[], ano: number, f: FiltrosFerias): boolean {
  const b = semAcento(f.busca.trim());
  if (b && !semAcento(`${p.nome} ${p.nome_guerra || ''} ${p.matricula}`).includes(b)) return false;
  if (f.posto && (p.tipo === 'CIVIL' ? f.posto !== 'CIVIL' : p.posto_sigla !== f.posto)) return false;
  if (f.quadro && (f.quadro === 'PRACA' ? p.tipo !== 'MILITAR' || p.oficial : p.quadro_sigla !== f.quadro)) return false;
  if (f.secao && String(p.secao_id || '-') !== f.secao) return false;
  if (f.ingresso && String(p.ano_ingresso || '') !== f.ingresso) return false;
  if (f.mes) { const fm = fimMes(f.mes); if (!ps.some((x) => x.data_inicio <= fm && x.data_fim >= f.mes)) return false; }
  const doEx = ps.filter((x) => x.exercicio === ano);
  const d = doEx.reduce((s, x) => s + diasEfetivos(x), 0);
  switch (f.so) {
    case 'sem': return d === 0;
    case 'incompletos': return d > 0 && d < 30;
    case 'completos': return d >= 30;
    case 'emgozo': return doEx.some((x) => x.status === 'EM_GOZO');
    case 'agozar': return doEx.some((x) => x.status === 'A_GOZAR' || x.status === 'PROPOSTA');
    case 'gozou': return doEx.length > 0 && doEx.every((x) => x.status === 'GOZADA' || x.status === 'INTERROMPIDA');
    case 'excecao': return doEx.some((x) => x.excecao && !x.excecao_aprovada_em);
    case 'estimada': return doEx.some((x) => x.data_estimada);
    case 'reprog': return doEx.some((x) => x.origem === 'REPROGRAMACAO');
  }
  return true;
}

export const contarFiltros = (f: FiltrosFerias) =>
  [f.posto, f.quadro, f.secao, f.ingresso, f.mes, f.so !== 'todos' ? f.so : '', f.busca.trim()].filter(Boolean).length;

/** texto curto dos filtros, para subtítulos e para a aba Leia-me */
export function descreverFiltros(f: FiltrosFerias, dom: Dominios | null): string {
  const partes: string[] = [];
  if (f.so !== 'todos') partes.push(SITUACOES_EX.find(([k]) => k === f.so)?.[1].toLowerCase() || f.so);
  if (f.posto) partes.push(f.posto === 'CIVIL' ? 'servidores civis' : f.posto);
  if (f.quadro) partes.push(f.quadro === 'PRACA' ? 'praças' : `quadro ${f.quadro}`);
  if (f.secao) partes.push(f.secao === '-' ? 'sem seção' : `seção ${dom?.secoes.find((s) => String(s.id) === f.secao)?.nome || f.secao}`);
  if (f.ingresso) partes.push(`ingresso em ${f.ingresso}`);
  if (f.mes) partes.push(`de férias em ${rotuloMes(f.mes)}`);
  if (f.busca.trim()) partes.push(`busca "${f.busca.trim()}"`);
  return partes.join(', ');
}
