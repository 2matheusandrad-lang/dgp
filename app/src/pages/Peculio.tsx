import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useDominios } from '../lib/dominios';
import { useConsulta } from '../lib/consulta';
import { mapaRegioes } from '../lib/regioes';
import { SEXO, buscarTodos, exportarXlsx, semAcento } from '../lib/util';
import { Aviso, Botao, Campo, Cartao, Carregando, Kpi, Tabela } from '../components/ui';

// Pecúlio geral: identificação e lotação de todo o efetivo ativo, para qualquer usuário (versão 1.4.1).
// Vem da função peculio_geral(), que não traz contato, endereço, nascimento, saúde nem disciplina.
// A ficha completa abre só para os militares das OMEs do usuário (ve_ficha).

export default function Peculio() {
  const dom = useDominios();
  const nav = useNavigate();
  const [busca, setBusca] = useState('');
  const [ome, setOme] = useState('');
  const [regiao, setRegiao] = useState('');
  const [posto, setPosto] = useState('');
  const [quadro, setQuadro] = useState('');
  const [sexo, setSexo] = useState('');
  const [cedidos, setCedidos] = useState(false);
  const lista = useConsulta('peculio', () => buscarTodos<any>(() => supabase.rpc('peculio_geral').select('*')
    .order('posto_ordem').order('quadro_ordem', { nullsFirst: false }).order('ordem_antiguidade', { nullsFirst: false })
    .order('data_ingresso', { nullsFirst: false }).order('nome').order('militar_id')), 300_000);
  const regioes = useMemo(() => mapaRegioes(dom), [dom]);

  const linhas = useMemo(() => (lista.dados || []).map((r, i) => ({ ...r, antig: i + 1, regiao: regioes.de(r.ome_id).rotulo })), [lista.dados, regioes]);
  const b = semAcento(busca);
  const filtradas = linhas.filter((r) => (!b || semAcento(`${r.nome} ${r.nome_guerra || ''} ${r.matricula} ${r.numero_funcional || ''}`).includes(b))
    && (!ome || r.ome_sigla === ome) && (!regiao || r.regiao === regiao) && (!posto || r.posto_sigla === posto)
    && (!quadro || r.quadro_sigla === quadro) && (!sexo || r.sexo === sexo) && (!cedidos || !!r.orgao_cessao));

  if (lista.erro) return <div className="pagina"><Aviso tom="erro">{lista.erro} — a versão 1.4.1 do banco já foi aplicada?</Aviso></div>;
  if (!lista.dados || !dom) return <div className="pagina"><Carregando /></div>;
  const omes = [...new Set(linhas.map((r) => r.ome_sigla))].sort((a, z) => a.localeCompare(z, 'pt-BR', { numeric: true }));
  const postos = [...new Map(linhas.map((r) => [r.posto_sigla, r.posto_ordem])).entries()].sort((a, z) => a[1] - z[1]).map((x) => x[0]);
  const exportar = () => exportarXlsx('peculio_geral', 'Pecúlio geral', [
    { titulo: 'Antig.', valor: (r: any) => r.antig, largura: 7 }, { titulo: 'Posto/Grad.', valor: (r: any) => r.posto_completo, largura: 12 },
    { titulo: 'Nome', valor: (r: any) => r.nome, largura: 40 }, { titulo: 'Nome de guerra', valor: (r: any) => r.nome_guerra || '', largura: 18 },
    { titulo: 'Matrícula', valor: (r: any) => r.matricula, largura: 11 }, { titulo: 'Nº funcional', valor: (r: any) => r.numero_funcional || '', largura: 13 },
    { titulo: 'Sexo', valor: (r: any) => r.sexo || '', largura: 6 }, { titulo: 'OME', valor: (r: any) => r.ome_sigla, largura: 12 },
    { titulo: 'Região', valor: (r: any) => r.regiao, largura: 14 }, { titulo: 'Município da OME', valor: (r: any) => r.municipio || '', largura: 22 },
    { titulo: 'Cedido a', valor: (r: any) => r.orgao_cessao || '', largura: 16 }, { titulo: 'Ingresso', valor: (r: any) => r.ano_ingresso ?? '', largura: 9 },
  ], filtradas);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Pecúlio geral</h1>
          <p className="sub">Efetivo ativo de todo o CBMPE, em ordem de antiguidade · só consulta · a ficha completa abre para os militares das suas OMEs</p>
        </div>
        <div className="acoes"><Botao onClick={exportar} disabled={!filtradas.length}>Exportar Excel</Botao></div>
      </div>
      <div className="kpis">
        <Kpi rotulo="Efetivo ativo" valor={linhas.length.toLocaleString('pt-BR')} detalhe={`${omes.length} OMEs`} />
        <Kpi rotulo="Na consulta" valor={filtradas.length.toLocaleString('pt-BR')} detalhe="com os filtros abaixo" />
        <Kpi rotulo="Cedidos a outros órgãos" valor={linhas.filter((r) => r.orgao_cessao).length} detalhe="pela coluna ÓRGÃO do pecúlio" onClick={() => setCedidos(true)} />
      </div>
      <div className="filtros">
        <Campo rotulo="Buscar"><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome, nome de guerra, matrícula ou nº funcional" /></Campo>
        <Campo rotulo="Região">
          <select aria-label="Região" value={regiao} onChange={(e) => setRegiao(e.target.value)}><option value="">todas</option>{regioes.lista.map((r) => <option key={r.rotulo} value={r.rotulo}>{r.rotulo}</option>)}</select>
        </Campo>
        <Campo rotulo="OME">
          <select aria-label="OME" value={ome} onChange={(e) => setOme(e.target.value)}><option value="">todas</option>{omes.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        </Campo>
        <Campo rotulo="Posto/Grad.">
          <select aria-label="Posto/Grad." value={posto} onChange={(e) => setPosto(e.target.value)}><option value="">todos</option>{postos.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </Campo>
        <Campo rotulo="Quadro">
          <select aria-label="Quadro" value={quadro} onChange={(e) => setQuadro(e.target.value)}><option value="">todos</option><option value="QOC">QOC</option><option value="QOA">QOA</option></select>
        </Campo>
        <Campo rotulo="Sexo">
          <select aria-label="Sexo" value={sexo} onChange={(e) => setSexo(e.target.value)}><option value="">todos</option>{Object.entries(SEXO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Campo>
        <label className="check-inline"><input type="checkbox" checked={cedidos} onChange={(e) => setCedidos(e.target.checked)} /> só cedidos</label>
      </div>
      <Cartao titulo={`${filtradas.length.toLocaleString('pt-BR')} militar(es)`}>
        <Tabela linhas={filtradas} chave={(r: any) => r.militar_id} compacta
          onLinha={(r: any) => r.ve_ficha && nav(`/militar/${r.militar_id}`)}
          linhaClasse={(r: any) => (r.ve_ficha ? 'clicavel' : 'so-consulta')}
          colunas={[
            { id: 'antig', titulo: 'Antig.', valor: (r: any) => r.antig },
            { id: 'posto_completo', titulo: 'Posto/Grad.', valor: (r: any) => r.antig },
            { id: 'nome', titulo: 'Nome', render: (r: any) => <><strong>{r.nome}</strong>{r.nome_guerra && <span className="nota"> · {r.nome_guerra}</span>}</> },
            { id: 'matricula', titulo: 'Matrícula' },
            { id: 'numero_funcional', titulo: 'Nº funcional' },
            { id: 'ome_sigla', titulo: 'OME' },
            { id: 'regiao', titulo: 'Região' },
            { id: 'municipio', titulo: 'Município' },
            { id: 'orgao_cessao', titulo: 'Cedido a' },
            { id: 'ano_ingresso', titulo: 'Ingresso' },
          ]} />
        <p className="nota">Telefone, endereço, nascimento, afastamentos, férias e disciplina ficam só nas fichas das suas OMEs. A antiguidade segue posto, quadro (QOC antes de QOA), nº do almanaque e data de ingresso.</p>
      </Cartao>
    </div>
  );
}
