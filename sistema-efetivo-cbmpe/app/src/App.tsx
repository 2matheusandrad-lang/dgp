import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider, Carregando, Aviso, Botao } from './components/ui';
import Layout from './components/Layout';
import { lazy, Suspense } from 'react';
import Login from './pages/Login';
import TrocarSenha from './pages/TrocarSenha';
import Dashboard from './pages/Dashboard';
// telas carregadas sob demanda (abertura do sistema mais leve)
const Efetivo = lazy(() => import('./pages/Efetivo'));
const Militar = lazy(() => import('./pages/Militar'));
const Conferencia = lazy(() => import('./pages/Conferencia'));
const Afastamentos = lazy(() => import('./pages/Afastamentos'));
const Qod = lazy(() => import('./pages/Qod'));
const Indicadores = lazy(() => import('./pages/Indicadores'));
const Relatorios = lazy(() => import('./pages/Relatorios'));
const Entregas = lazy(() => import('./pages/Entregas'));
const Movimentacoes = lazy(() => import('./pages/Movimentacoes'));
const Desligamentos = lazy(() => import('./pages/Desligamentos'));
const Admin = lazy(() => import('./pages/Admin'));
const Auditoria = lazy(() => import('./pages/Auditoria'));
const Referencias = lazy(() => import('./pages/Referencias'));
const Ferias = lazy(() => import('./pages/Ferias'));
const Ajuda = lazy(() => import('./pages/Ajuda'));
import TermoUso from './pages/TermoUso';

function Rotas() {
  const { session, ctx, carregando, erroCtx, sair, recarregar, podeEditarAlguma, gestaoGlobal } = useAuth();
  if (carregando) return <div className="login-pagina"><Carregando /></div>;
  if (!session) return <Login />;
  if (erroCtx) {
    return (
      <div className="login-pagina">
        <div className="login-cartao">
          <h1>Não foi possível carregar seu acesso</h1>
          <Aviso tom="erro">{erroCtx}</Aviso>
          <Botao variante="primario" onClick={recarregar}>Tentar novamente</Botao>
          <Botao onClick={sair}>Sair</Botao>
        </div>
      </div>
    );
  }
  if (!ctx || !ctx.ativo) {
    return (
      <div className="login-pagina">
        <div className="login-cartao">
          <h1>Acesso pendente</h1>
          <Aviso tom="alerta">Seu usuário ainda não foi liberado (ou foi desativado). Procure o administrador do sistema na DGP informando o e-mail <strong>{session.user.email}</strong>.</Aviso>
          <Botao onClick={sair}>Sair</Botao>
        </div>
      </div>
    );
  }
  if (ctx.deve_trocar_senha) return <TrocarSenha obrigatoria />;
  if (ctx.termo_pendente) return <TermoUso versao={ctx.termo_pendente} />;
  const T = (el: JSX.Element) => <Suspense fallback={<Carregando />}>{el}</Suspense>;
  return (
    <Routes>
      <Route path="/trocar-senha" element={<TrocarSenha />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="efetivo" element={T(<Efetivo />)} />
        <Route path="militar/:id" element={T(<Militar />)} />
        {podeEditarAlguma && <Route path="conferencia" element={T(<Conferencia />)} />}
        <Route path="afastamentos" element={T(<Afastamentos />)} />
        <Route path="qod" element={T(<Qod />)} />
        <Route path="indicadores" element={T(<Indicadores />)} />
        <Route path="relatorios" element={T(<Relatorios />)} />
        <Route path="entregas" element={T(<Entregas />)} />
        <Route path="movimentacoes" element={T(<Movimentacoes />)} />
        <Route path="desligamentos" element={T(<Desligamentos />)} />
        <Route path="ferias" element={T(<Ferias />)} />
        <Route path="ajuda" element={T(<Ajuda />)} />
        {gestaoGlobal && <Route path="atualizacao-mensal" element={T(<Referencias />)} />}
        {podeEditarAlguma && <Route path="auditoria" element={T(<Auditoria />)} />}
        {podeEditarAlguma && <Route path="admin" element={T(<Admin />)} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Rotas />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
