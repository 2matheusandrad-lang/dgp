import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider, Carregando, Aviso, Botao } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import TrocarSenha from './pages/TrocarSenha';
import Dashboard from './pages/Dashboard';
import Efetivo from './pages/Efetivo';
import Militar from './pages/Militar';
import Afastamentos from './pages/Afastamentos';
import Relatorios from './pages/Relatorios';
import Entregas from './pages/Entregas';
import Movimentacoes from './pages/Movimentacoes';
import Admin from './pages/Admin';
import Auditoria from './pages/Auditoria';

function Rotas() {
  const { session, ctx, carregando, erroCtx, sair, recarregar, podeEditarAlguma } = useAuth();
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
  return (
    <Routes>
      <Route path="/trocar-senha" element={<TrocarSenha />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="efetivo" element={<Efetivo />} />
        <Route path="militar/:id" element={<Militar />} />
        <Route path="afastamentos" element={<Afastamentos />} />
        <Route path="relatorios" element={<Relatorios />} />
        <Route path="entregas" element={<Entregas />} />
        <Route path="movimentacoes" element={<Movimentacoes />} />
        {podeEditarAlguma && <Route path="auditoria" element={<Auditoria />} />}
        {podeEditarAlguma && <Route path="admin" element={<Admin />} />}
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
