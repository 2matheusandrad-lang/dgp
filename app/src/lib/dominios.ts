import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type Ome = { id: number; sigla: string; nome: string | null; tipo: string; ordem: number; ativo: boolean;
  comando_id?: number | null; regional?: boolean; municipio_ibge?: number | null; orgao_ensino?: boolean };
export type Secao = { id: number; ome_id: number; nome: string; ordem: number; ativo: boolean; municipio_ibge?: number | null };
export type Posto = { id: number; sigla: string; nome: string; circulo: string; oficial: boolean; ordem: number };
export type TipoAfast = { id: number; codigo: string; nome: string; exige_saude: boolean; ordem: number; ativo: boolean };
export type Nivel = { id: number; nome: string; ordem: number };
export type TipoPun = { id: number; nome: string; ordem: number; ativo: boolean; efeito_comportamento?: string };
export type Dominios = {
  omes: Ome[]; secoes: Secao[]; postos: Posto[]; quadros: { sigla: string; nome: string | null; ordem?: number }[];
  tiposAfast: TipoAfast[]; niveis: Nivel[]; tiposPun: TipoPun[];
};

let cache: Promise<Dominios> | null = null;
let ultimo: Dominios | null = null;   // já carregado: componentes novos nascem com os dados (sem render vazio)
const ouvintes = new Set<(d: Dominios) => void>();

async function carregar(): Promise<Dominios> {
  const sel = async (t: string, ordem: string) => {
    const { data, error } = await supabase.from(t).select('*').order(ordem);
    if (error) throw error;
    return data as any[];
  };
  const [omes, secoes, postos, quadros, tiposAfast, niveis, tiposPun] = await Promise.all([
    sel('ome', 'ordem'), sel('secao', 'ordem'), sel('posto_graduacao', 'ordem'), sel('quadro', 'sigla'),
    sel('tipo_afastamento', 'ordem'), sel('nivel_escolaridade', 'ordem'), sel('tipo_punicao', 'ordem'),
  ]);
  ultimo = { omes, secoes, postos, quadros, tiposAfast, niveis, tiposPun };
  return ultimo;
}

export function recarregarDominios() {
  cache = carregar();
  cache.then((d) => ouvintes.forEach((f) => f(d))).catch(() => {});
  return cache;
}

export function limparDominios() { cache = null; ultimo = null; }

export function useDominios() {
  const [dom, setDom] = useState<Dominios | null>(ultimo);
  useEffect(() => {
    if (!cache) cache = carregar();
    let vivo = true;
    cache.then((d) => vivo && setDom(d)).catch((e) => { console.error(e); cache = null; });
    const f = (d: Dominios) => vivo && setDom(d);
    ouvintes.add(f);
    return () => { vivo = false; ouvintes.delete(f); };
  }, []);
  return dom;
}

export const secoesDa = (dom: Dominios | null, ome?: number | null) =>
  (dom?.secoes || []).filter((s) => s.ome_id === ome && s.ativo).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
