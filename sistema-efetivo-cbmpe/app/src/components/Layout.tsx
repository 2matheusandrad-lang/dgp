import { NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { PAPEL } from '../lib/util';

export default function Layout() {
  const { ctx, escopo, setEscopo, global, gestaoGlobal, podeEditarAlguma, sair } = useAuth();
  const [menuAberto, setMenuAberto] = useState(false);
  if (!ctx) return null;
  const itens = [
    { to: '/', rotulo: 'Painel', icone: '▦' },
    { to: '/efetivo', rotulo: 'Efetivo', icone: '☰' },
    { to: '/afastamentos', rotulo: 'Afastamentos', icone: '⏸' },
    { to: '/relatorios', rotulo: 'Relatórios', icone: '⎙' },
    { to: '/entregas', rotulo: 'Entrega mensal', icone: '✓' },
    { to: '/movimentacoes', rotulo: 'Movimentações', icone: '⇄' },
    ...(podeEditarAlguma ? [{ to: '/auditoria', rotulo: 'Histórico de alterações', icone: '⟲' }] : []),
    ...(gestaoGlobal || podeEditarAlguma ? [{ to: '/admin', rotulo: gestaoGlobal ? 'Administração' : 'Seções da OME', icone: '⚙' }] : []),
  ];
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
          {itens.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'ativo' : '')}>
              <span className="icone" aria-hidden>{i.icone}</span>{i.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className="lateral-rodape">
          <div className="usuario-nome">{[ctx.posto, ctx.nome].filter(Boolean).join(' ') || ctx.email}</div>
          <div className="usuario-papel">{PAPEL[ctx.papel]}{!global && ctx.omes.length ? ' · ' + ctx.omes.map((o) => o.sigla).join(', ') : ''}</div>
          <button className="link" onClick={sair}>Sair</button>
        </div>
      </aside>
      <div className="principal">
        <header className="topo">
          <button className="menu-botao" onClick={() => setMenuAberto(!menuAberto)} aria-label="Menu">☰</button>
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
        </header>
        <main className="conteudo"><Outlet /></main>
      </div>
    </div>
  );
}
