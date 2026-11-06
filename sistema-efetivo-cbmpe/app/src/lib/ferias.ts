// Regras e utilitários do módulo Férias (Portaria do Comando Geral nº 312/2025)
import type { LinhaPafBruta } from './excel';

export const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** janela de gozo do exercício N: dez/N a dez/(N+1) (art. 1º) */
export const janela = (ano: number) => Array.from({ length: 13 }, (_, i) => {
  const d = new Date(ano, 11 + i, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
});
export const rotuloMes = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
export const fimDoMes = (iso: string) => { const [a, m] = iso.split('-').map(Number); return new Date(a, m, 0).getDate(); };
export const somaDiasIso = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export const STATUS: Record<string, { rotulo: string; tom: 'neutro' | 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'roxo' }> = {
  PROPOSTA: { rotulo: 'proposta', tom: 'amarelo' }, A_GOZAR: { rotulo: 'a gozar', tom: 'azul' }, EM_GOZO: { rotulo: 'em gozo', tom: 'roxo' },
  GOZADA: { rotulo: 'gozada', tom: 'verde' }, INTERROMPIDA: { rotulo: 'interrompida', tom: 'neutro' },
  CANCELADA: { rotulo: 'reprogramada', tom: 'neutro' }, NAO_GOZADA: { rotulo: 'não gozada', tom: 'vermelho' },
};
export const TIPO_REPROG: Record<string, string> = {
  A_PEDIDO: 'A pedido do militar (art. 11, II, a)', DE_OFICIO: 'De ofício pelo titular da OME (art. 11, II, b)',
  OBRIGATORIA: 'Obrigatória (art. 11, I)', INTERRUPCAO: 'Interrupção (art. 10)',
};
export const MOTIVOS_ART10 = ['Interesse da Segurança Nacional (art. 10, I)', 'Manutenção da ordem pública (art. 10, II)',
  'Extrema necessidade do serviço (art. 10, III)', 'Transferência para a inatividade (art. 10, IV)'];
export const MOTIVO_JA_AFASTADO = 'Militar já afastado no 1º dia das férias (art. 11, I, b)';
export const ativo = (p: { situacao: string }) => p.situacao === 'PROPOSTA' || p.situacao === 'PROGRAMADA' || p.situacao === 'INTERROMPIDA';
export const diasEfetivos = (p: any) => (p.situacao === 'INTERROMPIDA' ? p.dias_gozados || 0 : p.dias);

export type Verificacao = { codigo: string; nivel: 'bloqueio' | 'alerta' | 'info'; msg: string };

// ---------------- importação da planilha do PAF ----------------
export type PeriodoImportado = {
  matricula: string; exercicio: number; inicio: string; dias: number; previsto: string | null; estimada: boolean;
  sei: string | null; observacao: string | null; origem: string; nome: string; omeRecebida: string;
};
const exercicioDe = (paf: string, anoAba: number): number | 'certidao' => {
  const t = paf.toUpperCase();
  if (/CERTID/.test(t)) return 'certidao';
  const d = t.replace(/\D/g, '');
  if (!d) return anoAba;
  if (d.length === 4 && d.startsWith('20')) return Number(d);
  return 2000 + Number(d.slice(-2));
};
/** transforma as linhas da planilha em períodos: datas reais quando há reprogramação; senão, o mês previsto (dia estimado) */
export function montarImportacao(linhas: LinhaPafBruta[]) {
  const periodos: PeriodoImportado[] = []; const certidoes: LinhaPafBruta[] = []; const invalidas: { l: LinhaPafBruta; motivo: string }[] = [];
  const grupos = new Map<string, LinhaPafBruta[]>();
  for (const l of linhas) {
    const ex = exercicioDe(l.paf, l.anoAba);
    if (ex === 'certidao') { certidoes.push(l); continue; }
    const k = `${l.matricula}|${ex}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(l);
  }
  const vistos = new Set<string>(); let repetidas = 0;
  const add = (p: PeriodoImportado) => {
    const k = `${p.matricula}|${p.exercicio}|${p.inicio}|${p.dias}`;
    if (vistos.has(k)) { repetidas++; return; }
    vistos.add(k); periodos.push(p);
  };
  for (const [k, ls] of grupos) {
    const exercicio = Number(k.split('|')[1]);
    const comGozo = ls.filter((l) => l.diaIni && l.diaFim && l.mesGozo);
    for (const l of comGozo) {
      const ini = `${l.mesGozo!.slice(0, 8)}${String(l.diaIni).padStart(2, '0')}`;
      if (l.diaIni! > fimDoMes(l.mesGozo!)) { invalidas.push({ l, motivo: 'dia de início maior que o mês' }); continue; }
      const dias = l.diaFim! >= l.diaIni! ? l.diaFim! - l.diaIni! + 1 : fimDoMes(l.mesGozo!) - l.diaIni! + 1 + l.diaFim!;
      if (dias < 1 || dias > 60) { invalidas.push({ l, motivo: `quantidade de dias inválida (${dias})` }); continue; }
      add({ matricula: l.matricula, exercicio, inicio: ini, dias, previsto: l.previsto, estimada: false, sei: l.sei || null,
            observacao: l.obs || null, origem: `${l.aba}, linha ${l.linha}`, nome: l.nome, omeRecebida: l.omeRecebida });
    }
    if (comGozo.length) continue;
    // só o mês previsto: 1 linha = 30 dias no dia 1º; 2 linhas = 2 x 15 (dia 16 se cair no mesmo mês)
    const prev = ls.filter((l) => l.previsto).sort((a, b) => String(a.previsto).localeCompare(String(b.previsto)));
    if (!prev.length) { ls.forEach((l) => invalidas.push({ l, motivo: 'sem mês previsto nem datas de gozo' })); continue; }
    if (prev.length === 1) {
      const l = prev[0];
      add({ matricula: l.matricula, exercicio, inicio: l.previsto!, dias: 30, previsto: l.previsto, estimada: true, sei: l.sei || null,
            observacao: l.obs || null, origem: `${l.aba}, linha ${l.linha}`, nome: l.nome, omeRecebida: l.omeRecebida });
    } else {
      prev.slice(0, 2).forEach((l, i) => {
        const mesmo = i === 1 && prev[0].previsto === l.previsto;
        add({ matricula: l.matricula, exercicio, inicio: mesmo ? `${l.previsto!.slice(0, 8)}16` : l.previsto!, dias: 15, previsto: l.previsto,
              estimada: true, sei: l.sei || null, observacao: l.obs || null, origem: `${l.aba}, linha ${l.linha}`, nome: l.nome, omeRecebida: l.omeRecebida });
      });
      prev.slice(2).forEach((l) => invalidas.push({ l, motivo: 'mais de duas previsões sem datas no mesmo exercício' }));
    }
  }
  return { periodos, certidoes, invalidas, repetidas };
}
