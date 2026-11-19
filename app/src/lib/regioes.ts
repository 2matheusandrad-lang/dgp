import type { Dominios, Ome } from './dominios';

// Regiões = OMEs marcadas como "regional" (DIM, DInter/1, DInter/2). A região de uma OME é a
// primeira OME regional encontrada subindo pela cadeia de comando; sem nenhuma, "Demais OMEs".
export const DEMAIS = 'Demais OMEs';

export const rotuloRegiao = (sigla?: string | null) => {
  if (!sigla) return DEMAIS;
  const m = /^DInter\s*\/?\s*(\d)$/i.exec(sigla.trim());
  if (m) return 'DINTER ' + ['', 'I', 'II', 'III', 'IV'][Number(m[1])];
  return sigla;
};

export type Regiao = { id: number | null; sigla: string | null; rotulo: string; ordem: number };

export function mapaRegioes(dom: Dominios | null) {
  const porId = new Map<number, Ome>((dom?.omes || []).map((o) => [o.id, o]));
  const cache = new Map<number, Regiao>();
  const regionais = (dom?.omes || []).filter((o) => o.regional).sort((a, b) => a.ordem - b.ordem);
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

// Sugestão inicial de enquadramento (a confirmar pela DGP em Administração > Estrutura e regiões)
export const SUGESTAO_REGIOES: Record<string, string[]> = {
  DIM: ['GBI', 'GBAPH', 'GBMar', 'GBS', 'CAT/RMR'],
  'DInter/1': ['1ºGB', '2ºGB', '6ºGB', '7ºGB', '9ºGB', 'CAT Agreste', 'CAT Zona da Mata'],
  'DInter/2': ['3ºGB', '4ºGB', '5ºGB', 'CAT Sertão'],
};
