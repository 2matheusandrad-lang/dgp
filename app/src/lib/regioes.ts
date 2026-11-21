import type { Dominios, Ome } from './dominios';

// Regiões = OMEs marcadas como "regional" (DIM, DInter/1, DInter/2 e DIEsp). Cada uma é OME (tem efetivo
// próprio) e também dá nome a uma região: a região de uma OME é a primeira OME regional encontrada
// subindo pela cadeia de comando (a própria regional inclusive); sem nenhuma, "Demais OMEs".
//   DIM: GBI, GBMar, GBS, GBAPH · DINTER I: 1º, 2º, 6º e 7º GB · DINTER II: 3º, 4º, 5º e 9º GB · DIESP: os 4 CATs
export const DEMAIS = 'Demais OMEs';

export const rotuloRegiao = (sigla?: string | null) => {
  if (!sigla) return DEMAIS;
  const m = /^DInter\s*\/?\s*(\d)$/i.exec(sigla.trim());
  if (m) return 'DINTER ' + ['', 'I', 'II', 'III', 'IV'][Number(m[1])];
  if (/^DIEsp$/i.test(sigla.trim())) return 'DIESP';
  return sigla;
};
// ordem fixa de apresentação das regiões
const ORDEM_REGIAO: Record<string, number> = { DIM: 0, 'DINTER I': 1, 'DINTER II': 2, DIESP: 3 };

export type Regiao = { id: number | null; sigla: string | null; rotulo: string; ordem: number };

export function mapaRegioes(dom: Dominios | null) {
  const porId = new Map<number, Ome>((dom?.omes || []).map((o) => [o.id, o]));
  const cache = new Map<number, Regiao>();
  const regionais = (dom?.omes || []).filter((o) => o.regional)
    .sort((a, b) => (ORDEM_REGIAO[rotuloRegiao(a.sigla)] ?? 9) - (ORDEM_REGIAO[rotuloRegiao(b.sigla)] ?? 9) || a.ordem - b.ordem);
  const ordem = new Map(regionais.map((o, i) => [o.id, i]));
  const de = (omeId: number | null | undefined): Regiao => {
    if (omeId == null) return { id: null, sigla: null, rotulo: DEMAIS, ordem: 99 };
    const c = cache.get(omeId);
    if (c) return c;
    let atual = porId.get(omeId);
    const vistos = new Set<number>();
    while (atual && !atual.regional && atual.comando_id != null && !vistos.has(atual.id)) {
      vistos.add(atual.id);
      atual = porId.get(atual.comando_id);
    }
    const r: Regiao = atual?.regional
      ? { id: atual.id, sigla: atual.sigla, rotulo: rotuloRegiao(atual.sigla), ordem: ordem.get(atual.id) ?? 50 }
      : { id: null, sigla: null, rotulo: DEMAIS, ordem: 99 };
    cache.set(omeId, r);
    return r;
  };
  const lista: Regiao[] = [
    ...regionais.map((o) => ({ id: o.id, sigla: o.sigla, rotulo: rotuloRegiao(o.sigla), ordem: ordem.get(o.id) ?? 50 })),
    { id: null, sigla: null, rotulo: DEMAIS, ordem: 99 },
  ];
  return { de, lista };
}

// Município efetivo de um militar: o da seção; sem seção (ou seção sem cidade), o da sede da OME.
export function municipioDe(dom: Dominios | null, omeId?: number | null, secaoId?: number | null): number | null {
  if (!dom) return null;
  if (secaoId != null) {
    const s = dom.secoes.find((x) => x.id === secaoId);
    if (s?.municipio_ibge) return s.municipio_ibge;
  }
  return dom.omes.find((o) => o.id === omeId)?.municipio_ibge ?? null;
}
