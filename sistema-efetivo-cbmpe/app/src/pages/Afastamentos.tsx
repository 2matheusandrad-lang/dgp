import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios } from '../lib/dominios';
import { buscarTodos, exportarXlsx, fmtData, hojeISO, msgErro, somaDias } from '../lib/util';
import { Abas, Aviso, Badge, Botao, Campo, Carregando, Tabela } from '../components/ui';

export default function Afastamentos() {
  const { escopo, ctx } = useAuth();
  const dom = useDominios();
  const nav = useNavigate();
  const [aba, setAba] = useState('curso');
  const [tipo, setTipo] = useState('');
  const [ini, setIni] = useState(somaDias(hojeISO(), -30));
  const [fim, setFim] = useState(hojeISO());
  const [dados, setDados] = useState<any[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = hojeISO();

  useEffect(() => {
    let vivo = true;
    setDados(null);
    buscarTodos(() => {
      let q = supabase.from('v_afastamento').select('*').eq('situacao', 'ATIVO').order('data_inicio', { ascending: false }).order('id');
      if (escopo) q = q.eq('ome_id', escopo);
      if (aba === 'curso') q = q.lte('data_inicio', hoje).gte('data_fim', hoje);
      if (aba === 'previstos') q = q.gt('data_inicio', hoje);
      if (aba === 'retornos') q = q.lte('data_inicio', hoje).gte('data_fim', hoje).lte('data_fim', somaDias(hoje, 15));
      if (aba === 'periodo') q = q.lte('data_inicio', fim).gte('data_fim', ini);
      return q;
    }).then((d) => vivo && setDados(d)).catch((e) => vivo && setErro(msgErro(e)));
    return () => { vivo = false; };
  }, [escopo, aba, ini, fim, hoje]);

  const linhas = useMemo(() => (dados || []).filter((a) => !tipo || String(a.tipo_id) === tipo), [dados, tipo]);
  const saude = !!ctx?.pode_ver_saude;

  const exportar = () => exportarXlsx('afastamentos', `Afastamentos — ${{ curso: 'em curso', previstos: 'previstos', retornos: 'retornos em 15 dias', periodo: `${fmtData(ini)} a ${fmtData(fim)}` }[aba]}`, [
    { titulo: 'Posto/Grad.', valor: (r: any) => r.posto_completo },
    { titulo: 'Matrícula', valor: (r: any) => r.matricula },
    { titulo: 'Nome', valor: (r: any) => r.nome, largura: 40 },
    { titulo: 'OME', valor: (r: any) => r.ome_sigla },
    { titulo: 'Seção', valor: (r: any) => r.secao_nome, largura: 22 },
    { titulo: 'Tipo', valor: (r: any) => r.tipo_nome, largura: 30 },
    { titulo: 'Início', valor: (r: any) => fmtData(r.data_inicio) },
    { titulo: 'Dias', valor: (r: any) => r.dias },
    { titulo: 'Término', valor: (r: any) => fmtData(r.data_fim) },
    { titulo: 'Status', valor: (r: any) => r.status },
    ...(saude ? [{ titulo: 'Natureza', valor: (r: any) => r.natureza }, { titulo: 'CID', valor: (r: any) => r.cid }] : []),
    { titulo: 'Processo SEI', valor: (r: any) => r.processo_sei, largura: 28 },
  ], linhas);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Afastamentos</h1><p className="sub">{dados ? `${linhas.length} registros` : 'Carregando…'}</p></div>
        <div className="acoes"><Botao onClick={exportar} disabled={!linhas.length}>Exportar Excel</Botao></div>
      </div>
      <Abas ativa={aba} onChange={setAba} abas={[
        { id: 'curso', rotulo: 'Em curso hoje' }, { id: 'retornos', rotulo: 'Retornos em até 15 dias' },
        { id: 'previstos', rotulo: 'Previstos' }, { id: 'periodo', rotulo: 'Por período' },
      ]} />
      <div className="filtros">
        <Campo rotulo="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {dom?.tiposAfast.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </Campo>
        {aba === 'periodo' && <>
          <Campo rotulo="De"><input type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></Campo>
          <Campo rotulo="Até"><input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>
        </>}
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!dados ? <Carregando /> : (
        <Tabela linhas={linhas} chave={(r: any) => r.id} onLinha={(r: any) => nav(`/militar/${r.militar_id}`)}
          colunas={[
            { id: 'posto_completo', titulo: 'Posto', valor: (r: any) => r.posto_ordem },
            { id: 'nome', titulo: 'Nome' },
            ...(escopo ? [] : [{ id: 'ome_sigla', titulo: 'OME' }]),
            { id: 'secao_nome', titulo: 'Seção' },
            { id: 'tipo_codigo', titulo: 'Tipo', render: (r: any) => <span title={r.tipo_nome}>{r.tipo_codigo}</span> },
            { id: 'data_inicio', titulo: 'Início', render: (r: any) => fmtData(r.data_inicio) },
            { id: 'dias', titulo: 'Dias' },
            { id: 'data_fim', titulo: 'Término', render: (r: any) => <>{fmtData(r.data_fim)}{r.status === 'EM CURSO' && <span className="nota"> ({r.dias_restantes}d)</span>}</> },
            { id: 'status', titulo: 'Status', render: (r: any) => <Badge tom={r.status === 'EM CURSO' ? 'amarelo' : r.status === 'PREVISTO' ? 'azul' : 'neutro'}>{r.status.toLowerCase()}</Badge> },
            { id: 'processo_sei', titulo: 'Processo SEI' },
          ]} />
      )}
    </div>
  );
}
