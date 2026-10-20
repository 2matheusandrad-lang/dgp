import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// ---------------- botões e campos ----------------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: 'primario' | 'secundario' | 'perigo' | 'fantasma'; pequeno?: boolean };
export function Botao({ variante = 'secundario', pequeno, className = '', ...p }: BtnProps) {
  return <button {...p} className={`btn btn-${variante} ${pequeno ? 'btn-sm' : ''} ${className}`} />;
}

export function Campo({ rotulo, dica, erro, children, largura }: { rotulo: string; dica?: string; erro?: string | null; children: ReactNode; largura?: 'meia' | 'inteira' | 'terco' }) {
  return (
    <label className={`campo ${largura ? 'campo-' + largura : ''}`}>
      <span className="campo-rotulo">{rotulo}</span>
      {children}
      {erro ? <span className="campo-erro">{erro}</span> : dica ? <span className="campo-dica">{dica}</span> : null}
    </label>
  );
}

export function Badge({ tom = 'neutro', children, title }: { tom?: 'neutro' | 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'roxo'; children: ReactNode; title?: string }) {
  return <span className={`badge badge-${tom}`} title={title}>{children}</span>;
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return <div className="carregando"><span className="spinner" />{texto}</div>;
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="vazio">{children}</div>;
}

export function Aviso({ tom = 'info', children }: { tom?: 'info' | 'alerta' | 'erro' | 'ok'; children: ReactNode }) {
  return <div className={`aviso aviso-${tom}`}>{children}</div>;
}

export function Kpi({ rotulo, valor, detalhe, tom, onClick }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; tom?: 'alerta' | 'ok'; onClick?: () => void }) {
  return (
    <div className={`kpi ${tom ? 'kpi-' + tom : ''} ${onClick ? 'clicavel' : ''}`} onClick={onClick}>
      <div className="kpi-rotulo">{rotulo}</div>
      <div className="kpi-valor">{valor}</div>
      {detalhe && <div className="kpi-detalhe">{detalhe}</div>}
    </div>
  );
}

export function Cartao({ titulo, acoes, children, className = '' }: { titulo?: ReactNode; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`cartao ${className}`}>
      {(titulo || acoes) && <header className="cartao-cab"><h3>{titulo}</h3><div className="cartao-acoes">{acoes}</div></header>}
      <div className="cartao-corpo">{children}</div>
    </section>
  );
}

export function Abas({ abas, ativa, onChange }: { abas: { id: string; rotulo: ReactNode }[]; ativa: string; onChange: (id: string) => void }) {
  return (
    <div className="abas" role="tablist">
      {abas.map((a) => (
        <button key={a.id} role="tab" aria-selected={a.id === ativa} className={a.id === ativa ? 'ativa' : ''} onClick={() => onChange(a.id)}>{a.rotulo}</button>
      ))}
    </div>
  );
}

// ---------------- modal ----------------
export function Modal({ titulo, aberto, onFechar, children, rodape, largo }: { titulo: ReactNode; aberto: boolean; onFechar: () => void; children: ReactNode; rodape?: ReactNode; largo?: boolean }) {
  useEffect(() => {
    if (!aberto) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [aberto, onFechar]);
  if (!aberto) return null;
  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={`modal ${largo ? 'modal-largo' : ''}`} role="dialog" aria-modal="true">
        <header className="modal-cab"><h3>{titulo}</h3><button className="fechar" onClick={onFechar} aria-label="Fechar">×</button></header>
        <div className="modal-corpo">{children}</div>
        {rodape && <footer className="modal-rodape">{rodape}</footer>}
      </div>
    </div>
  );
}

// ---------------- avisos flutuantes ----------------
type Toast = { id: number; texto: string; tom: 'ok' | 'erro' };
const ToastCtx = createContext<(texto: string, tom?: 'ok' | 'erro') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const mostrar = useCallback((texto: string, tom: 'ok' | 'erro' = 'ok') => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l, { id, texto, tom }]);
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), tom === 'erro' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      <div className="toasts">{lista.map((t) => <div key={t.id} className={`toast toast-${t.tom}`}>{t.texto}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- tabela com ordenação e paginação ----------------
export type ColTabela<T> = {
  id: string; titulo: string; render?: (r: T) => ReactNode; valor?: (r: T) => any;
  ordenavel?: boolean; className?: string; largura?: string;
};
export function Tabela<T>({ colunas, linhas, chave, onLinha, porPagina = 50, vazio = 'Nenhum registro encontrado.', ordemInicial }: {
  colunas: ColTabela<T>[]; linhas: T[]; chave: (r: T) => string; onLinha?: (r: T) => void; porPagina?: number; vazio?: string;
  ordemInicial?: { id: string; asc: boolean };
}) {
  const [ordem, setOrdem] = useState<{ id: string; asc: boolean } | null>(ordemInicial || null);
  const [pag, setPag] = useState(0);
  useEffect(() => setPag(0), [linhas]);
  const ordenadas = useMemo(() => {
    if (!ordem) return linhas;
    const c = colunas.find((x) => x.id === ordem.id);
    if (!c) return linhas;
    const v = c.valor || ((r: any) => r[c.id]);
    return [...linhas].sort((a, b) => {
      const x = v(a), y = v(b);
      const r = x === y ? 0 : x === null || x === undefined ? 1 : y === null || y === undefined ? -1
        : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true });
      return ordem.asc ? r : -r;
    });
  }, [linhas, ordem, colunas]);
  const paginas = Math.max(1, Math.ceil(ordenadas.length / porPagina));
  const visiveis = ordenadas.slice(pag * porPagina, (pag + 1) * porPagina);
  if (!linhas.length) return <Vazio>{vazio}</Vazio>;
  return (
    <div className="tabela-wrap">
      <table className="tabela">
        <thead>
          <tr>
            {colunas.map((c) => (
              <th key={c.id} style={{ width: c.largura }} className={`${c.className || ''} ${c.ordenavel !== false ? 'ordenavel' : ''}`}
                onClick={() => c.ordenavel !== false && setOrdem((o) => (o?.id === c.id ? { id: c.id, asc: !o.asc } : { id: c.id, asc: true }))}>
                {c.titulo}{ordem?.id === c.id ? (ordem.asc ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visiveis.map((r) => (
            <tr key={chave(r)} onClick={onLinha ? () => onLinha(r) : undefined} className={onLinha ? 'clicavel' : ''}>
              {colunas.map((c) => <td key={c.id} className={c.className}>{c.render ? c.render(r) : (r as any)[c.id]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {paginas > 1 && (
        <div className="paginacao">
          <span>{ordenadas.length} registros · página {pag + 1} de {paginas}</span>
          <Botao pequeno disabled={pag === 0} onClick={() => setPag(0)}>«</Botao>
          <Botao pequeno disabled={pag === 0} onClick={() => setPag(pag - 1)}>‹</Botao>
          <Botao pequeno disabled={pag >= paginas - 1} onClick={() => setPag(pag + 1)}>›</Botao>
          <Botao pequeno disabled={pag >= paginas - 1} onClick={() => setPag(paginas - 1)}>»</Botao>
        </div>
      )}
    </div>
  );
}

export function Confirmar({ aberto, titulo, texto, onSim, onNao, perigo, rotuloSim = 'Confirmar' }: { aberto: boolean; titulo: string; texto: ReactNode; onSim: () => void; onNao: () => void; perigo?: boolean; rotuloSim?: string }) {
  return (
    <Modal aberto={aberto} titulo={titulo} onFechar={onNao}
      rodape={<><Botao onClick={onNao}>Cancelar</Botao><Botao variante={perigo ? 'perigo' : 'primario'} onClick={onSim}>{rotuloSim}</Botao></>}>
      <p>{texto}</p>
    </Modal>
  );
}
