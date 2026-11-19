import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios } from '../lib/dominios';
import { buscarTodos, fmtData, hojeISO, msgErro, somaDias } from '../lib/util';
import Exportar from '../components/Exportar';
import { Sei } from './Militar';
import { Abas, Aviso, Badge, Botao, Campo, Carregando, Tabela } from '../components/ui';

export default function Afastamentos() {
  const { escopo, ctx } = useAuth();
  const dom = useDominios();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [aba, setAba] = useState(params.get('aba') || 'curso');
  const [tipo, setTipo] = useState('');
  const [exp, setExp] = useState(false);
  useEffect(() => {
    const cod = params.get('tipo');
    if (cod && dom) setTipo(String(dom.tiposAfast.find((t) => t.codigo === cod)?.id || ''));
  }, [params, dom]);
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
  const nomeEscopo = escopo ? ctx?.omes.find((o) => o.id === escopo)?.sigla : 'Todas as OMEs';
  const rotuloAba: Record<string, string> = { curso: 'em curso hoje', previstos: 'previstos', retornos: 'retornos em até 15 dias', periodo: `de ${fmtData(ini)} a ${fmtData(fim)}` };

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Afastamentos</h1><p className="sub">{dados ? `${linhas.length} registros` : 'Carregando…'}</p></div>
        <div className="acoes"><Botao onClick={() => setExp(true)} disabled={!linhas.length}>Exportar Excel / PDF</Botao></div>
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
            { id: 'processo_sei', titulo: 'Processo SEI', render: (r: any) => <Sei p={r.processo_sei} /> },
          ]} />
      )}
      <Exportar aberto={exp} onFechar={() => setExp(false)} arquivo="afastamentos" titulo={`Afastamentos ${rotuloAba[aba]}`} subtitulo={nomeEscopo || ''}
        qtd={linhas.length} obterLinhas={async () => [...linhas].sort((a: any, b: any) => a.posto_ordem - b.posto_ordem || a.nome.localeCompare(b.nome))}
        agrupamentos={[{ id: 'ome', rotulo: 'OME', fn: (r) => r.ome_sigla }, { id: 'tipo', rotulo: 'Tipo de afastamento', fn: (r) => r.tipo_nome }]}
        colunas={[
          { id: 'posto', titulo: 'Posto/Grad.', valor: (r: any) => r.posto_completo, padrao: true },
          { id: 'mat', titulo: 'Matrícula', valor: (r: any) => r.matricula, padrao: true },
          { id: 'nome', titulo: 'Nome', valor: (r: any) => r.nome, largura: 40, padrao: true },
          { id: 'ome', titulo: 'OME', valor: (r: any) => r.ome_sigla, padrao: true },
          { id: 'secao', titulo: 'Seção', valor: (r: any) => r.secao_nome, largura: 22 },
          { id: 'tipo', titulo: 'Tipo', valor: (r: any) => r.tipo_nome, largura: 30, padrao: true },
          { id: 'ini', titulo: 'Início', valor: (r: any) => fmtData(r.data_inicio), padrao: true },
          { id: 'dias', titulo: 'Dias', valor: (r: any) => r.dias, padrao: true },
          { id: 'fim', titulo: 'Término', valor: (r: any) => fmtData(r.data_fim), padrao: true },
          { id: 'status', titulo: 'Status', valor: (r: any) => r.status },
          { id: 'sei', titulo: 'Processo SEI', valor: (r: any) => r.processo_sei, largura: 28, padrao: true },
        ]} />
    </div>
  );
}
