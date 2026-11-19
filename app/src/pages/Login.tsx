import { FormEvent, useState } from 'react';
import { supabase, configurado } from '../lib/supabase';
import { Aviso, Botao, Campo } from '../components/ui';
import { msgErro } from '../lib/util';

export default function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null); setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(false);
    if (error) setErro(msgErro(error));
  };

  const esqueci = async () => {
    if (!email.trim()) { setErro('Informe o e-mail para receber o link de redefinição.'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/trocar-senha' });
    if (error) setErro(msgErro(error));
    else setInfo('Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha. Caso não chegue, procure o administrador na DGP.');
  };

  return (
    <div className="login-pagina">
      <form className="login-cartao" onSubmit={entrar}>
        <div className="login-marca">
          <div className="marca-sigla grande">DGP</div>
          <div>
            <h1>Controle do Efetivo</h1>
            <p>Corpo de Bombeiros Militar de Pernambuco</p>
          </div>
        </div>
        {!configurado && <Aviso tom="erro">Sistema não configurado: preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.</Aviso>}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {info && <Aviso tom="ok">{info}</Aviso>}
        <Campo rotulo="E-mail">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Campo>
        <Campo rotulo="Senha">
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </Campo>
        <Botao variante="primario" type="submit" disabled={enviando} className="largura-total">{enviando ? 'Entrando…' : 'Entrar'}</Botao>
        <button type="button" className="link centro" onClick={esqueci}>Esqueci minha senha</button>
        <p className="login-rodape">Acesso restrito. Cada acesso é individual e todas as alterações ficam registradas.</p>
      </form>
    </div>
  );
}
