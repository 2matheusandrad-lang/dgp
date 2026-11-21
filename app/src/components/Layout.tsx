import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useConsulta } from '../lib/consulta';
import { PAPEL, rpc } from '../lib/util';
import { Badge } from './ui';

export default function Layout() {
  const { ctx, escopo, setEscopo, global, gestaoGlobal, podeEditarAlguma, sair } = useAuth();
  const [menuAberto, setMenuAberto] = useState(false);
  const [busca, setBusca] = useState(false);
  const location = useLocation();
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setBusca(true); }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);
  if (!ctx) return null;
  const grupos = gruposMenu({ gestaoGlobal, podeEditarAlguma });
  const caminho = location.pathname;
  const grupoAtual = grupos.find((g) => g.itens.some((i) => i.to === caminho) || (g.tambem || []).some((p) => caminho.startsWith(p)));
  const subAbas = grupoAtual && grupoAtual.itens.length > 1 && grupoAtual.itens.some((i) => i.to === caminho) ? grupoAtual.itens : null;
  const mostraSeletor = global || ctx.omes.length > 1;
  return (
    <div className={`app ${menuAberto ? 'menu-aberto' : ''}`}>
      <aside className="lateral">
        <div className="marca">
          <div className="marca-sigla">DGP</div>
          <div>
            <div className="marca-titulo">Controle do Efetivo</div>
            <div className="marca-sub">CBMPE</div>
          </div>
        </div>
        <nav onClick={() => setMenuAberto(false)}>
          {grupos.map((g) => (
            <NavLink key={g.id} to={g.itens[0].to} end={g.itens[0].to === '/'} className={() => (g === grupoAtual ? 'ativo' : '')}>
              <span className="icone" aria-hidden>{g.icone}</span>{g.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className="lateral-rodape">
          <div className="usuario-nome">{[ctx.posto, ctx.nome].filter(Boolean).join(' ') || ctx.email}</div>
          <div className="usuario-papel">{PAPEL[ctx.papel]}{!global && ctx.omes.length ? ' · ' + ctx.omes.map((o) => o.sigla).join(', ') : ''}</div>
          <div className="rodape-links">
            <NavLink to="/ajuda">Ajuda</NavLink><span aria-hidden>·</span>
            <NavLink to="/dicionario">Dicionário de dados</NavLink>
          </div>
          <button className="link" onClick={sair}>Sair</button>
        </div>
      </aside>
      <div className="principal">
        <header className="topo">
          <button className="menu-botao" onClick={() => setMenuAberto(!menuAberto)} aria-label="Menu">☰</button>
          <button className="busca-botao" onClick={() => setBusca(true)}>⌕ Buscar militar <kbd>Ctrl K</kbd></button>
          <div className="topo-dir">
            {mostraSeletor ? (
              <label className="escopo">
                <span>OME</span>
                <select value={escopo ?? ''} onChange={(e) => setEscopo(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{global ? 'Todas as OMEs' : 'Todas as minhas OMEs'}</option>
                  {ctx.omes.map((o) => <option key={o.id} value={o.id}>{o.sigla}</option>)}
                </select>
              </label>
            ) : (
              <div className="escopo"><span>OME</span><strong>{ctx.omes[0]?.sigla || '—'}</strong></div>
            )}
            {podeEditarAlguma && <Sino />}
          </div>
        </header>
        <main className="conteudo">
          {subAbas && (
            <nav className="subnav" aria-label={grupoAtual!.rotulo}>
              {subAbas.map((i) => <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? 'ativa' : '')}>{i.rotulo}</NavLink>)}
            </nav>
          )}
          <Outlet />
        </main>
      </div>
      {busca && <BuscaRapida onFechar={() => setBusca(false)} />}
    </div>
  );
}

// Menu em grupos: cada grupo abre na 1ª página; as demais aparecem como abas no topo do conteúdo.
// As rotas antigas continuam valendo (links das pendências, favoritos).
type ItemMenu = { to: string; rotulo: string };
type GrupoMenu = { id: string; rotulo: string; icone: string; itens: ItemMenu[]; tambem?: string[] };
export function gruposMenu({ gestaoGlobal, podeEditarAlguma }: { gestaoGlobal: boolean; podeEditarAlguma: boolean }): GrupoMenu[] {
  const g: GrupoMenu[] = [
    { id: 'painel', rotulo: 'Painel', icone: '▦', itens: [{ to: '/', rotulo: 'Painel' }] },
    { id: 'efetivo', rotulo: 'Efetivo', icone: '☰', tambem: ['/militar/'],
      itens: [{ to: '/efetivo', rotulo: gestaoGlobal ? 'Militares' : 'Minhas OMEs' }, { to: '/peculio', rotulo: 'Pecúlio geral (todo o CBMPE)' }] },
    { id: 'afastamentos', rotulo: 'Afastamentos', icone: '⏸', itens: [{ to: '/afastamentos', rotulo: 'Afastamentos' }] },
    { id: 'ferias', rotulo: 'Férias (PAF)', icone: '☀', itens: [{ to: '/ferias', rotulo: 'Férias (PAF)' }] },
    { id: 'comportamento', rotulo: 'Comportamento', icone: '◈', itens: [{ to: '/comportamento', rotulo: 'Comportamento' }] },
    { id: 'movimentacoes', rotulo: 'Movimentações', icone: '⇄', itens: [{ to: '/movimentacoes', rotulo: 'Inclusões e transferências' }, { to: '/desligamentos', rotulo: 'Desligamentos' }] },
    { id: 'mensal', rotulo: 'Rotina mensal', icone: '☑', itens: [
      ...(podeEditarAlguma ? [{ to: '/conferencia', rotulo: '1. Conferência' }] : []),
      { to: '/entregas', rotulo: podeEditarAlguma ? '2. Entrega mensal' : 'Entrega mensal' }] },
    { id: 'indicadores', rotulo: 'Indicadores', icone: '◔', itens: [{ to: '/indicadores', rotulo: 'Indicadores' }, { to: '/regioes', rotulo: 'Regiões e mapa' }, { to: '/qod', rotulo: 'QOD · previsto × existente' }] },
    { id: 'relatorios', rotulo: 'Relatórios', icone: '⎙', itens: [{ to: '/relatorios', rotulo: 'Relatórios prontos' }, { to: '/consultas', rotulo: 'Consultas' }] },
  ];
  if (gestaoGlobal || podeEditarAlguma) {
    g.push({ id: 'admin', rotulo: 'Administração', icone: '⚙', itens: [
      { to: '/admin', rotulo: gestaoGlobal ? 'Usuários e estrutura' : 'Seções da OME' },
      ...(gestaoGlobal ? [{ to: '/atualizacao-mensal', rotulo: 'QOD e almanaque' }] : []),
      { to: '/auditoria', rotulo: 'Histórico de alterações' },
      { to: '/dicionario', rotulo: 'Dicionário de dados' },
    ] });
  }
  return g;
}

export const usePendencias = () => {
  const { escopo } = useAuth();
  return useConsulta(`pendencias|${escopo}`, async () => {
    const [a, b] = await Promise.all([rpc<any[]>('minhas_pendencias', { p_ome: escopo }), rpc<any[]>('pendencias_extra', { p_ome: escopo }).catch(() => [])]);
    const ordem: Record<string, number> = { alta: 0, media: 1, info: 2 };
    return [...(a || []), ...(b || [])].sort((x, y) => (ordem[x.gravidade] ?? 3) - (ordem[y.gravidade] ?? 3));
  }, 60_000);
};

function Sino() {
  const { dados } = usePendencias();
  const [aberto, setAberto] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, []);
  const lista = dados || [];
  const altas = lista.filter((p) => p.gravidade !== 'info').length;
  return (
    <div className="sino" ref={ref}>
      <button className="sino-botao" onClick={() => setAberto(!aberto)} aria-label="Pendências">
        🔔{lista.length > 0 && <span className={`sino-contador ${altas ? 'alto' : ''}`}>{lista.length}</span>}
      </button>
      {aberto && (
        <div className="sino-painel">
          <div className="sino-titulo">Pendências</div>
          {lista.length === 0 && <div className="nota" style={{ padding: 12 }}>Nada pendente. 👍</div>}
          {lista.map((p) => (
            <button key={p.chave} className={`pendencia pend-${p.gravidade}`} onClick={() => { setAberto(false); nav(p.link); }}>
              <strong>{p.titulo}</strong><span>{p.detalhe}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BuscaRapida({ onFechar }: { onFechar: () => void }) {
  const [t, setT] = useState('');
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const r = useConsulta(t.trim().length >= 2 ? `busca|${t.trim()}` : null, () => rpc<any[]>('buscar_militar', { p_texto: t.trim() }), 30_000);
  const lista = r.dados || [];
  const ir = (m: any) => { onFechar(); nav(`/militar/${m.id}`); };
  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal busca-modal" role="dialog" aria-modal="true">
        <input autoFocus placeholder="Nome, nome de guerra ou matrícula…" value={t}
          onChange={(e) => { setT(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onFechar();
            if (e.key === 'ArrowDown') setI(Math.min(i + 1, lista.length - 1));
            if (e.key === 'ArrowUp') setI(Math.max(i - 1, 0));
            if (e.key === 'Enter' && lista[i]) ir(lista[i]);
          }} />
        <ul className="lista-sel">
          {lista.map((m, k) => (
            <li key={m.id} className={k === i ? 'ativo' : ''} onMouseEnter={() => setI(k)} onClick={() => ir(m)}>
              <span><strong>{m.posto_completo} {m.nome}</strong>{m.nome_guerra && <span className="nota"> · {m.nome_guerra}</span>} <span className="nota">{m.matricula}</span></span>
              <span>{m.ome_sigla} {m.situacao !== 'ATIVO' && <Badge tom="vermelho">{m.situacao.toLowerCase()}</Badge>}</span>
            </li>
          ))}
          {t.trim().length >= 2 && r.dados && !lista.length && <li className="nota">Nenhum militar encontrado nas OMEs que você acessa.</li>}
        </ul>
        <div className="nota busca-rodape">↑↓ para escolher · Enter abre a ficha · Esc fecha</div>
      </div>
    </div>
  );
}
