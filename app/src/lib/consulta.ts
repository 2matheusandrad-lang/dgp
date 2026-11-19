// Cache simples de consultas: trocar de tela não refaz a busca; dados antigos aparecem na hora
// e são atualizados ao fundo. Após gravar algo, chame invalidar('prefixo').
import { useCallback, useEffect, useRef, useState } from 'react';
import { msgErro } from './util';

type Entrada = { quando: number; dados?: any; promessa?: Promise<any> };
const cache = new Map<string, Entrada>();
const ouvintes = new Map<string, Set<() => void>>();

export function invalidar(prefixo = '') {
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(prefixo)) {
      cache.delete(k);
      ouvintes.get(k)?.forEach((f) => f());
    }
  }
}

async function buscar<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const e = cache.get(chave);
  if (e?.promessa) return e.promessa;
  const promessa = fn()
    .then((dados) => { cache.set(chave, { quando: Date.now(), dados }); return dados; })
    .catch((err) => { cache.delete(chave); throw err; });
  cache.set(chave, { ...(e || { quando: 0 }), promessa });
  return promessa;
}

export function useConsulta<T>(chave: string | null, fn: () => Promise<T>, validadeMs = 60_000) {
  const [dados, setDados] = useState<T | undefined>(() => (chave ? cache.get(chave)?.dados : undefined));
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const executar = useCallback(async (forcar = false) => {
    if (!chave) return;
    const e = cache.get(chave);
    if (e?.dados !== undefined) setDados(e.dados);
    if (!forcar && e?.dados !== undefined && Date.now() - e.quando < validadeMs) return;
    if (forcar) cache.delete(chave);
    setCarregando(true); setErro(null);
    try { setDados(await buscar(chave, () => fnRef.current())); }
    catch (er) { setErro(msgErro(er)); }
    finally { setCarregando(false); }
  }, [chave, validadeMs]);

  useEffect(() => {
    if (!chave) return;
    setDados(cache.get(chave)?.dados);
    executar();
    const f = () => executar(true);
    if (!ouvintes.has(chave)) ouvintes.set(chave, new Set());
    ouvintes.get(chave)!.add(f);
    return () => { ouvintes.get(chave)?.delete(f); };
  }, [chave, executar]);

  return { dados, carregando: carregando && dados === undefined, atualizando: carregando, erro, recarregar: () => executar(true) };
}
