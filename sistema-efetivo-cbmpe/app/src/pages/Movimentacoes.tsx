import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { SITUACAO, buscarTodos, fmtData, hojeISO, msgErro, somaDias } from '../lib/util';
import { TIPO_MOV } from './Militar';
import { Aviso, Badge, Campo, Carregando, Tabela } from '../components/ui';

export default function Movimentacoes() {
  const { escopo } = useAuth();
  const nav = useNavigate();
  const [ini, setIni] = useState(somaDias(hojeISO(), -90));
  const [fim, setFim] = useState(hojeISO());
  const [tipo, setTipo] = useState('');
  const [linhas, setLinhas] = useState<any[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setLinhas(null);
    buscarTodos(() => {
      let q = supabase.from('v_movimentacao').select('*').gte('data', ini).lte('data', fim).order('data', { ascending: false }).order('id');
      if (tipo) q = q.eq('tipo', tipo);
      if (escopo) q = q.or(`ome_origem_id.eq.${escopo},ome_destino_id.eq.${escopo}`);
      return q;
    }).then((l) => setLinhas(l.filter((r) => r.documento !== 'Carga inicial'))).catch((e) => setErro(msgErro(e)));
  }, [ini, fim, tipo, escopo]);

  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>Movimentações</h1><p className="sub">Inclusões, transferências e desligamentos registrados pelas OMEs e pela DGP.</p></div></div>
      <div className="filtros">
        <Campo rotulo="De"><input type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></Campo>
        <Campo rotulo="Até"><input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>
        <Campo rotulo="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>{Object.entries(TIPO_MOV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!linhas ? <Carregando /> : (
        <Tabela linhas={linhas} chave={(r: any) => r.id} onLinha={(r: any) => nav(`/militar/${r.militar_id}`)} vazio="Nenhuma movimentação no período." colunas={[
          { id: 'data', titulo: 'Data', render: (r: any) => fmtData(r.data) },
          { id: 'tipo', titulo: 'Tipo', render: (r: any) => <Badge tom={r.tipo === 'DESLIGAMENTO' ? 'vermelho' : r.tipo === 'TRANSFERENCIA' ? 'azul' : 'verde'}>{TIPO_MOV[r.tipo]}</Badge> },
          { id: 'militar_posto', titulo: 'Posto' },
          { id: 'militar_nome', titulo: 'Nome' },
          { id: 'ome_origem_sigla', titulo: 'De' },
          { id: 'ome_destino_sigla', titulo: 'Para', render: (r: any) => (r.tipo === 'DESLIGAMENTO' ? SITUACAO[r.situacao_nova] : [r.ome_destino_sigla, r.secao_destino_nome].filter(Boolean).join(' · ')) },
          { id: 'documento', titulo: 'Documento' },
          { id: 'registrado_por_nome', titulo: 'Registrado por' },
        ]} />
      )}
    </div>
  );
}
