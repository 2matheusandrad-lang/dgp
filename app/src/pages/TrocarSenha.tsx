import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Aviso, Botao, Campo } from '../components/ui';
import { msgErro } from '../lib/util';

export default function TrocarSenha({ obrigatoria }: { obrigatoria?: boolean }) {
  const { recarregar, sair } = useAuth();
  const [s1, setS1] = useState('');
  const [s2, setS2] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (s1.length < 10) return setErro('A senha deve ter pelo menos 10 caracteres.');
    if (!/[A-Za-z]/.test(s1) || !/\d/.test(s1)) return setErro('Use letras e números.');
    if (s1 !== s2) return setErro('As senhas não conferem.');
    const { error } = await supabase.auth.updateUser({ password: s1 });
    if (error) return setErro(msgErro(error));
    await supabase.rpc('marcar_senha_trocada');
    setOk(true);
    await recarregar();
  };

  return (
    <div className="login-pagina">
      <form className="login-cartao" onSubmit={salvar}>
        <h1>Definir nova senha</h1>
        {obrigatoria && <Aviso tom="info">Por segurança, troque a senha provisória antes de continuar.</Aviso>}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {ok && <Aviso tom="ok">Senha alterada.</Aviso>}
        <Campo rotulo="Nova senha" dica="Mínimo de 10 caracteres, com letras e números.">
          <input type="password" autoComplete="new-password" value={s1} onChange={(e) => setS1(e.target.value)} required />
        </Campo>
        <Campo rotulo="Repita a nova senha">
          <input type="password" autoComplete="new-password" value={s2} onChange={(e) => setS2(e.target.value)} required />
        </Campo>
        <Botao variante="primario" type="submit" className="largura-total">Salvar senha</Botao>
        <button type="button" className="link centro" onClick={sair}>Sair</button>
      </form>
    </div>
  );
}
