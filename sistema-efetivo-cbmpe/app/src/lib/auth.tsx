import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Papel = 'ADMIN' | 'DGP' | 'LEITOR_GERAL' | 'GESTOR' | 'LEITOR';
export type Contexto = {
  id: string; email: string; nome: string | null; posto: string | null; matricula: string | null;
  papel: Papel; ativo: boolean; pode_ver_saude: boolean; deve_trocar_senha: boolean;
  omes: { id: number; sigla: string }[];
};

type AuthValor = {
  session: Session | null;
  ctx: Contexto | null;
  carregando: boolean;
  erroCtx: string | null;
  escopo: number | null;               // OME selecionada no topo (null = todas as permitidas)
  setEscopo: (v: number | null) => void;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
  global: boolean;                      // enxerga todas as OMEs
  gestaoGlobal: boolean;                // ADMIN ou DGP
  admin: boolean;
  podeEditarOme: (ome: number | null | undefined) => boolean;
  podeEditarAlguma: boolean;
};

const Ctx = createContext<AuthValor>(null as any);

const lerEscopo = () => {
  try { const v = localStorage.getItem('escopo_ome'); return v ? Number(v) : null; } catch { return null; }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCtx, setErroCtx] = useState<string | null>(null);
  const [escopo, setEscopoState] = useState<number | null>(lerEscopo());

  const carregarContexto = useCallback(async (s: Session | null) => {
    if (!s) { setCtx(null); setCarregando(false); return; }
    const { data, error } = await supabase.rpc('meu_contexto');
    setErroCtx(error ? error.message || 'Falha de comunicação com o servidor.' : null);
    if (error) { console.error(error); setCtx(null); }
    else {
      setCtx(data as Contexto);
      supabase.rpc('registrar_acesso').then(() => {});
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); carregarContexto(data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSession(s);
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') {
        setCarregando(true);
        carregarContexto(s);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [carregarContexto]);

  const setEscopo = (v: number | null) => {
    setEscopoState(v);
    try { v === null ? localStorage.removeItem('escopo_ome') : localStorage.setItem('escopo_ome', String(v)); } catch { /* sem storage */ }
  };

  const valor = useMemo<AuthValor>(() => {
    const papel = ctx?.papel;
    const global = papel === 'ADMIN' || papel === 'DGP' || papel === 'LEITOR_GERAL';
    const gestaoGlobal = papel === 'ADMIN' || papel === 'DGP';
    const idsOmes = new Set((ctx?.omes || []).map((o) => o.id));
    // escopo inválido para o usuário volta para "todas" (ou para a única OME dele)
    let esc = escopo;
    if (esc !== null && !idsOmes.has(esc)) esc = null;
    if (!global && ctx && ctx.omes.length === 1) esc = ctx.omes[0].id;
    return {
      session, ctx, carregando, erroCtx, escopo: esc, setEscopo,
      recarregar: async () => carregarContexto(session),
      sair: async () => { await supabase.auth.signOut(); },
      global, gestaoGlobal, admin: papel === 'ADMIN',
      podeEditarOme: (ome) => !!ome && (gestaoGlobal || (papel === 'GESTOR' && idsOmes.has(ome))),
      podeEditarAlguma: gestaoGlobal || (papel === 'GESTOR' && idsOmes.size > 0),
    };
  }, [session, ctx, carregando, erroCtx, escopo, carregarContexto]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
