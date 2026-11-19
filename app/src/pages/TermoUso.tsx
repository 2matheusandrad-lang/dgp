import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { msgErro } from '../lib/util';
import { Aviso, Botao, Carregando } from '../components/ui';

/** Aceite obrigatório do termo de responsabilidade (primeiro acesso e a cada nova versão). */
export default function TermoUso({ versao }: { versao: number }) {
  const { recarregar, sair, ctx } = useAuth();
  const [texto, setTexto] = useState<string | null>(null);
  const [li, setLi] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    supabase.from('termo_uso').select('texto').eq('versao', versao).single()
      .then(({ data, error }) => (error ? setErro(msgErro(error)) : setTexto(data.texto)));
  }, [versao]);
  const aceitar = async () => {
    setEnviando(true); setErro(null);
    const { error } = await supabase.rpc('aceitar_termo', { p_versao: versao });
    if (error) { setErro(msgErro(error)); setEnviando(false); return; }
    await recarregar();
  };
  return (
    <div className="login-pagina">
      <div className="login-cartao termo-cartao">
        <h1>Termo de responsabilidade</h1>
        <p className="nota">{[ctx?.posto, ctx?.nome].filter(Boolean).join(' ')} · versão {versao}</p>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {!texto ? <Carregando /> : <div className="termo-texto">{texto}</div>}
        <label className="check"><input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} /> Li e concordo com o termo acima.</label>
        <Botao variante="primario" className="largura-total" disabled={!li || !texto || enviando} onClick={aceitar}>{enviando ? 'Registrando…' : 'Aceitar e entrar'}</Botao>
        <button type="button" className="link centro" onClick={sair}>Sair</button>
      </div>
    </div>
  );
}
