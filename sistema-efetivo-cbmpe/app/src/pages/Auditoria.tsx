import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmtDataHora, hojeISO, msgErro, somaDias } from '../lib/util';
import { diferencas, NOME_OPERACAO, NOME_TABELA } from '../lib/auditoria';
import { Aviso, Campo, Carregando, Tabela } from '../components/ui';

export default function Auditoria() {
  const { escopo } = useAuth();
  const nav = useNavigate();
  const [ini, setIni] = useState(somaDias(hojeISO(), -7));
  const [fim, setFim] = useState(hojeISO());
  const [tabela, setTabela] = useState('');
  const [linhas, setLinhas] = useState<any[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLinhas(null);
    let q = supabase.from('v_auditoria').select('*').gte('momento', ini + 'T00:00:00').lte('momento', fim + 'T23:59:59').order('momento', { ascending: false }).limit(2000);
    if (escopo) q = q.eq('ome_id', escopo);
    if (tabela) q = q.eq('tabela', tabela);
    q.then(({ data, error }) => (error ? setErro(msgErro(error)) : setLinhas(data || [])));
  }, [ini, fim, tabela, escopo]);

  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Histórico de alterações</h1><p className="sub">Registro automático de toda inclusão, alteração e exclusão (até 2.000 por consulta).</p></div></div>
      <div className="filtros">
        <Campo rotulo="De"><input type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></Campo>
        <Campo rotulo="Até"><input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>
        <Campo rotulo="Registro">
          <select value={tabela} onChange={(e) => setTabela(e.target.value)}>
            <option value="">Todos</option>{Object.entries(NOME_TABELA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!linhas ? <Carregando /> : (
        <Tabela linhas={linhas} chave={(r: any) => String(r.id)} onLinha={(r: any) => r.militar_id && r.militar_nome && nav(`/militar/${r.militar_id}`)} colunas={[
          { id: 'momento', titulo: 'Quando', render: (r: any) => fmtDataHora(r.momento) },
          { id: 'usuario_nome', titulo: 'Usuário', render: (r: any) => r.usuario_nome || 'sistema' },
          { id: 'ome_sigla', titulo: 'OME' },
          { id: 'tabela', titulo: 'O quê', render: (r: any) => `${NOME_OPERACAO[r.operacao]} · ${NOME_TABELA[r.tabela] || r.tabela}` },
          { id: 'militar_nome', titulo: 'Militar', render: (r: any) => r.militar_nome || <span className="nota">—</span> },
          { id: 'dif', titulo: 'Detalhes', ordenavel: false, render: (r: any) => <ul className="dif">{diferencas(r).slice(0, 6).map((d, i) => <li key={i}>{d}</li>)}</ul> },
        ]} />
      )}
    </div>
  );
}
