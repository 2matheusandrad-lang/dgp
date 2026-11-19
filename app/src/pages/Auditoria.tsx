import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmtDataHora, hojeISO, msgErro, somaDias } from '../lib/util';
import { diferencas, NOME_OPERACAO, NOME_TABELA } from '../lib/auditoria';
import { Abas, Aviso, Campo, Carregando, Tabela } from '../components/ui';

const ORIGEM: Record<string, string> = { planilha: 'planilha', almanaque: 'almanaque', qod_pdf: 'QOD em PDF', ferias: 'férias' };

export default function Auditoria() {
  const { escopo, admin } = useAuth();
  const [aba, setAba] = useState('alteracoes');
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
      {admin && <Abas ativa={aba} onChange={setAba} abas={[{ id: 'alteracoes', rotulo: 'Alterações' }, { id: 'saude', rotulo: 'Acessos a dados de saúde' },
        { id: 'exportacoes', rotulo: 'Exportações' }, { id: 'textos', rotulo: 'Saúde em texto livre' }]} />}
      {aba === 'saude' ? <AcessosSaude ini={ini} fim={fim} /> : aba === 'exportacoes' ? <Exportacoes ini={ini} fim={fim} /> : aba === 'textos' ? <TextosSaude /> : <>
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
          { id: 'tabela', titulo: 'O quê', render: (r: any) => <>{NOME_OPERACAO[r.operacao]} · {NOME_TABELA[r.tabela] || r.tabela}{ORIGEM[r.origem] && <span className="nota"> ({ORIGEM[r.origem]})</span>}</> },
          { id: 'militar_nome', titulo: 'Militar', render: (r: any) => r.militar_nome || <span className="nota">—</span> },
          { id: 'dif', titulo: 'Detalhes', ordenavel: false, render: (r: any) => <ul className="dif">{diferencas(r).slice(0, 6).map((d, i) => <li key={i}>{d}</li>)}</ul> },
        ]} />
      )}
      </>}
    </div>
  );
}

function AcessosSaude({ ini, fim }: { ini: string; fim: string }) {
  const [linhas, setLinhas] = useState<any[] | null>(null);
  useEffect(() => {
    setLinhas(null);
    (async () => {
      const { data } = await supabase.from('acesso_sensivel').select('*').gte('momento', ini + 'T00:00:00').lte('momento', fim + 'T23:59:59').order('momento', { ascending: false }).limit(2000);
      const ids = [...new Set((data || []).flatMap((a: any) => [a.usuario_id]))];
      const mil = [...new Set((data || []).map((a: any) => a.militar_id).filter(Boolean))];
      const [{ data: us }, { data: ms }] = await Promise.all([
        supabase.from('perfil').select('id, nome, posto, email').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
        supabase.from('militar').select('id, nome, matricula').in('id', mil.length ? mil : ['00000000-0000-0000-0000-000000000000']),
      ]);
      const u = new Map((us || []).map((x: any) => [x.id, [x.posto, x.nome].filter(Boolean).join(' ') || x.email]));
      const m = new Map((ms || []).map((x: any) => [x.id, `${x.nome} (${x.matricula})`]));
      setLinhas((data || []).map((a: any) => ({ ...a, usuario: u.get(a.usuario_id), militar: m.get(a.militar_id) })));
    })();
  }, [ini, fim]);
  if (!linhas) return <Carregando />;
  return (
    <>
      <p className="nota">Registro de cada consulta e gravação de natureza/CID (LGPD). Visível só para o administrador.</p>
      <Tabela linhas={linhas} chave={(r: any) => String(r.id)} vazio="Nenhum acesso no período." colunas={[
        { id: 'momento', titulo: 'Quando', render: (r: any) => fmtDataHora(r.momento) },
        { id: 'usuario', titulo: 'Usuário' },
        { id: 'acao', titulo: 'Ação', render: (r: any) => (r.acao === 'CONSULTA' ? 'Consulta' : 'Gravação') },
        { id: 'militar', titulo: 'Militar' },
      ]} />
    </>
  );
}

function Exportacoes({ ini, fim }: { ini: string; fim: string }) {
  const [linhas, setLinhas] = useState<any[] | null>(null);
  useEffect(() => {
    setLinhas(null);
    (async () => {
      const { data } = await supabase.from('registro_exportacao').select('*').gte('momento', ini + 'T00:00:00').lte('momento', fim + 'T23:59:59').order('momento', { ascending: false }).limit(2000);
      const ids = [...new Set((data || []).map((a: any) => a.usuario_id).filter(Boolean))];
      const { data: us } = await supabase.from('perfil').select('id, nome, posto, email').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      const u = new Map((us || []).map((x: any) => [x.id, [x.posto, x.nome].filter(Boolean).join(' ') || x.email]));
      setLinhas((data || []).map((a: any) => ({ ...a, usuario: u.get(a.usuario_id) })));
    })();
  }, [ini, fim]);
  if (!linhas) return <Carregando />;
  return <>
    <p className="nota">Toda exportação para Excel ou PDF, com quem, quando, quantos registros e se havia dados pessoais de contato (últimos 7 dias por padrão; ajuste as datas na aba Alterações).</p>
    <Tabela linhas={linhas} chave={(r: any) => String(r.id)} vazio="Nenhuma exportação no período." colunas={[
      { id: 'momento', titulo: 'Quando', render: (r: any) => fmtDataHora(r.momento) }, { id: 'usuario', titulo: 'Usuário' },
      { id: 'tela', titulo: 'O quê' }, { id: 'formato', titulo: 'Formato' }, { id: 'registros', titulo: 'Registros' },
      { id: 'dados_pessoais', titulo: 'Dados pessoais', render: (r: any) => (r.dados_pessoais ? 'sim' : 'não') },
    ]} />
  </>;
}

function TextosSaude() {
  const nav = useNavigate();
  const [linhas, setLinhas] = useState<any[] | null>(null);
  useEffect(() => { supabase.rpc('textos_com_saude').then(({ data }) => setLinhas(data || [])); }, []);
  if (!linhas) return <Carregando />;
  return <>
    <p className="nota">Campos de texto livre com padrão de CID (ex.: F32, M54.5) ou termos de saúde. Revise e, se for o caso, apague o trecho: dado de saúde só no campo próprio do afastamento (LGPD).</p>
    <Tabela linhas={linhas} chave={(r: any) => r.tabela + r.registro + r.campo} onLinha={(r: any) => nav(`/militar/${r.militar_id}`)} vazio="Nada encontrado." colunas={[
      { id: 'ome_sigla', titulo: 'OME' }, { id: 'militar', titulo: 'Militar' }, { id: 'tabela', titulo: 'Onde', render: (r: any) => `${NOME_TABELA[r.tabela] || r.tabela} · ${r.campo}` }, { id: 'trecho', titulo: 'Trecho' },
    ]} />
  </>;
}
