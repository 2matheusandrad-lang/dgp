import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios, secoesDa } from '../lib/dominios';
import { ATIVIDADE, SITUACAO, buscarTodos, exportarXlsx, fmtData, hojeISO, mascaraMatricula, matriculaValida, msgErro, ordenarAntiguidade, rpc, semAcento } from '../lib/util';
import { Aviso, Badge, Botao, Campo, Carregando, Modal, Tabela, useToast } from '../components/ui';

export const situacaoHoje = (m: any) =>
  m.afastado_hoje
    ? <Badge tom="amarelo" title={m.afastamento_nome}>{m.afastamento_codigo} até {fmtData(m.afastamento_fim)}</Badge>
    : <Badge tom="verde">Disponível</Badge>;

export const marcadores = (m: any) => (
  <span className="marcadores">
    {m.readaptado && <Badge tom="roxo" title="Readaptado">RD</Badge>}
    {m.horario_especial && <Badge tom="azul" title="Horário especial de trabalho">HE</Badge>}
    {m.acumulacao_cargo && <Badge title="Acumulação de cargo público">AC</Badge>}
    {m.pcd && <Badge tom="azul" title="Pessoa com deficiência">PCD</Badge>}
    {m.qtd_punicoes > 0 && <Badge tom="vermelho" title="Possui punição registrada">P</Badge>}
  </span>
);

export const Completude = ({ v, pend }: { v: number; pend?: string[] }) => (
  <span className="completude" title={pend?.length ? 'Falta: ' + pend.join(', ') : 'Cadastro completo'}>
    <span className="completude-barra"><i style={{ width: `${v}%` }} className={v < 60 ? 'baixa' : v < 100 ? 'media' : ''} /></span>{v}%
  </span>
);

export default function Efetivo() {
  const { escopo, podeEditarAlguma, podeEditarOme, ctx } = useAuth();
  const dom = useDominios();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [dados, setDados] = useState<any[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [f, setF] = useState({
    busca: '', posto: '', secao: '', atividade: '', situacao: 'ATIVO',
    condicao: params.get('condicao') || '', escolaridade: '', area: '', pendentes: params.get('pendentes') === '1',
  });
  const [receber, setReceber] = useState(false);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    let vivo = true;
    setDados(null);
    buscarTodos(() => {
      let q = supabase.from('v_militar').select('*').order('posto_ordem').order('ordem_antiguidade', { nullsFirst: false }).order('id');
      if (escopo) q = q.eq('ome_id', escopo);
      if (f.situacao) q = q.eq('situacao', f.situacao);
      return q;
    }).then((d) => vivo && setDados(d)).catch((e) => vivo && setErro(msgErro(e)));
    return () => { vivo = false; };
  }, [escopo, f.situacao]);

  const filtrados = useMemo(() => {
    if (!dados) return [];
    const b = semAcento(f.busca.trim());
    const area = semAcento(f.area.trim());
    return dados.filter((m) =>
      (!b || semAcento(m.nome).includes(b) || (m.matricula || '').includes(b) || semAcento(m.nome_guerra || '').includes(b)) &&
      (!f.posto || String(m.posto_id) === f.posto) &&
      (!f.secao || (f.secao === '-' ? !m.secao_id : String(m.secao_id) === f.secao)) &&
      (!f.atividade || (f.atividade === '-' ? !m.atividade : m.atividade === f.atividade)) &&
      (!f.escolaridade || (f.escolaridade === '-' ? !m.escolaridade : (m.escolaridade_ordem || 0) >= Number(f.escolaridade))) &&
      (!area || semAcento(m.areas_formacao || '').includes(area)) &&
      (!f.pendentes || m.completude < 100) &&
      (!f.condicao ||
        (f.condicao === 'afastado' && m.afastado_hoje) || (f.condicao === 'disponivel' && !m.afastado_hoje) ||
        (f.condicao === 'readaptado' && m.readaptado) || (f.condicao === 'he' && m.horario_especial) ||
        (f.condicao === 'acumulacao' && m.acumulacao_cargo) || (f.condicao === 'pcd' && m.pcd) ||
        (f.condicao === 'punicao' && m.qtd_punicoes > 0)),
    ).sort(ordenarAntiguidade);
  }, [dados, f]);

  const exportar = () => exportarXlsx('efetivo', `Efetivo ${escopo ? ctx?.omes.find((o) => o.id === escopo)?.sigla : ''} — ${filtrados.length} militares`, [
    { titulo: 'Nº', valor: (_r, i) => i + 1, largura: 5 },
    { titulo: 'Posto/Grad.', valor: (r: any) => r.posto_completo },
    { titulo: 'Matrícula', valor: (r: any) => r.matricula, largura: 11 },
    { titulo: 'Nome', valor: (r: any) => r.nome, largura: 40 },
    { titulo: 'Nome de guerra', valor: (r: any) => r.nome_guerra },
    { titulo: 'OME', valor: (r: any) => r.ome_sigla },
    { titulo: 'Seção', valor: (r: any) => r.secao_nome, largura: 24 },
    { titulo: 'Atividade', valor: (r: any) => ATIVIDADE[r.atividade] },
    { titulo: 'Situação hoje', valor: (r: any) => (r.afastado_hoje ? `${r.afastamento_codigo} até ${fmtData(r.afastamento_fim)}` : 'Disponível'), largura: 22 },
    { titulo: 'Readaptado', valor: (r: any) => (r.readaptado ? 'Sim' : 'Não') },
    { titulo: 'Horário especial', valor: (r: any) => (r.horario_especial ? 'Sim' : 'Não') },
    { titulo: 'Acumulação', valor: (r: any) => (r.acumulacao_cargo ? 'Sim' : 'Não') },
    { titulo: 'PCD', valor: (r: any) => (r.pcd ? 'Sim' : 'Não') },
    { titulo: 'Escolaridade', valor: (r: any) => r.escolaridade, largura: 18 },
    { titulo: 'Áreas de formação', valor: (r: any) => r.areas_formacao, largura: 30 },
    { titulo: 'Idiomas', valor: (r: any) => r.idiomas },
    { titulo: 'E-mail', valor: (r: any) => r.email, largura: 30 },
    { titulo: 'Telefone', valor: (r: any) => r.telefone1, largura: 16 },
    { titulo: 'Telefone 2', valor: (r: any) => r.telefone2, largura: 16 },
    { titulo: 'Endereço', valor: (r: any) => r.endereco, largura: 50 },
    { titulo: 'Ano ingresso', valor: (r: any) => r.ano_ingresso },
    { titulo: 'Completude (%)', valor: (r: any) => r.completude },
    { titulo: 'Pendências', valor: (r: any) => (r.pendencias || []).join(', '), largura: 40 },
  ], filtrados);

  const secoes = escopo ? secoesDa(dom, escopo) : [];
  const podeIncluir = podeEditarAlguma && (escopo ? podeEditarOme(escopo) : true);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Efetivo</h1>
          <p className="sub">{dados ? `${filtrados.length} de ${dados.length} militares` : 'Carregando…'} · ordem de antiguidade</p>
        </div>
        <div className="acoes">
          <Botao onClick={exportar} disabled={!filtrados.length}>Exportar Excel</Botao>
          {podeIncluir && <Botao onClick={() => setReceber(true)}>Receber militar transferido</Botao>}
          {podeIncluir && <Botao variante="primario" onClick={() => nav('/militar/novo')}>+ Novo militar</Botao>}
        </div>
      </div>

      <div className="filtros">
        <Campo rotulo="Buscar"><input placeholder="Nome, nome de guerra ou matrícula" value={f.busca} onChange={(e) => set('busca', e.target.value)} /></Campo>
        <Campo rotulo="Posto/Grad.">
          <select value={f.posto} onChange={(e) => set('posto', e.target.value)}>
            <option value="">Todos</option>
            {dom?.postos.map((p) => <option key={p.id} value={p.id}>{p.sigla}</option>)}
          </select>
        </Campo>
        {escopo && (
          <Campo rotulo="Seção">
            <select value={f.secao} onChange={(e) => set('secao', e.target.value)}>
              <option value="">Todas</option><option value="-">(sem seção)</option>
              {secoes.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Campo>
        )}
        <Campo rotulo="Atividade">
          <select value={f.atividade} onChange={(e) => set('atividade', e.target.value)}>
            <option value="">Todas</option><option value="OPERACIONAL">Operacional</option><option value="ADMINISTRATIVO">Administrativo</option><option value="-">(não informada)</option>
          </select>
        </Campo>
        <Campo rotulo="Condição">
          <select value={f.condicao} onChange={(e) => set('condicao', e.target.value)}>
            <option value="">Todas</option>
            <option value="disponivel">Disponível hoje</option><option value="afastado">Afastado hoje</option>
            <option value="readaptado">Readaptado</option><option value="he">Horário especial</option>
            <option value="acumulacao">Acumulação de cargo</option><option value="pcd">PCD</option><option value="punicao">Com punição</option>
          </select>
        </Campo>
        <Campo rotulo="Escolaridade mínima">
          <select value={f.escolaridade} onChange={(e) => set('escolaridade', e.target.value)}>
            <option value="">Todas</option><option value="-">(não informada)</option>
            {dom?.niveis.map((n) => <option key={n.id} value={n.ordem}>{n.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Área de formação"><input placeholder="ex.: engenharia, direito" value={f.area} onChange={(e) => set('area', e.target.value)} /></Campo>
        <Campo rotulo="Situação">
          <select value={f.situacao} onChange={(e) => set('situacao', e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(SITUACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <label className="check"><input type="checkbox" checked={f.pendentes} onChange={(e) => set('pendentes', e.target.checked)} /> Só cadastros incompletos</label>
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!dados ? <Carregando /> : (
        <Tabela linhas={filtrados} chave={(m: any) => m.id} onLinha={(m: any) => nav(`/militar/${m.id}`)}
          colunas={[
            { id: 'posto_completo', titulo: 'Posto/Grad.', valor: (m: any) => m.posto_ordem },
            { id: 'matricula', titulo: 'Matrícula' },
            { id: 'nome', titulo: 'Nome', render: (m: any) => <><strong>{m.nome}</strong>{m.nome_guerra && <span className="nota"> · {m.nome_guerra}</span>}</> },
            ...(escopo ? [] : [{ id: 'ome_sigla', titulo: 'OME' }]),
            { id: 'secao_nome', titulo: 'Seção' },
            { id: 'atividade', titulo: 'Atividade', render: (m: any) => ATIVIDADE[m.atividade] || <span className="nota">—</span> },
            { id: 'situacao_hoje', titulo: 'Hoje', valor: (m: any) => (m.afastado_hoje ? 1 : 0), render: situacaoHoje },
            { id: 'marc', titulo: '', ordenavel: false, render: marcadores },
            { id: 'completude', titulo: 'Cadastro', render: (m: any) => <Completude v={m.completude} pend={m.pendencias} /> },
          ]} />
      )}
      <ReceberMilitar aberto={receber} onFechar={() => setReceber(false)} />
    </div>
  );
}

export function ReceberMilitar({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { ctx, escopo, podeEditarOme, gestaoGlobal } = useAuth();
  const dom = useDominios();
  const toast = useToast();
  const nav = useNavigate();
  const omesEditaveis = (gestaoGlobal ? dom?.omes.filter((o) => o.ativo) : ctx?.omes.filter((o) => podeEditarOme(o.id))) || [];
  const [mat, setMat] = useState('');
  const [achado, setAchado] = useState<any>(undefined);
  const [ome, setOme] = useState<number | ''>(escopo && podeEditarOme(escopo) ? escopo : '');
  const [secao, setSecao] = useState<number | ''>('');
  const [data, setData] = useState(hojeISO());
  const [doc, setDoc] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) { setMat(''); setAchado(undefined); setDoc(''); setErro(null); setSecao(''); }
    else if (!ome && omesEditaveis.length === 1) setOme(omesEditaveis[0].id);
  }, [aberto]); // eslint-disable-line

  useEffect(() => {
    setAchado(undefined);
    if (matriculaValida(mat)) rpc('localizar_matricula', { p_matricula: mat }).then((r) => setAchado(r || null)).catch(() => setAchado(null));
  }, [mat]);

  const confirmar = async () => {
    setErro(null);
    if (!ome) return setErro('Escolha a OME de destino.');
    if (!doc.trim()) return setErro('Informe o documento (nº do SP/BG ou processo SEI).');
    setSalvando(true);
    try {
      const id = await rpc<string>('receber_militar', { p_matricula: mat, p_ome_destino: ome, p_secao_destino: secao || null, p_data: data, p_documento: doc, p_observacao: null });
      toast('Militar incluído na OME.');
      onFechar();
      nav(`/militar/${id}`);
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  };

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="Receber militar transferido"
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={!achado || achado.situacao !== 'ATIVO' || salvando} onClick={confirmar}>Incluir na OME</Botao></>}>
      <p className="nota">Use quando o militar foi movimentado em SP para a sua OME e ainda consta em outra. A ficha dele é trazida com todo o histórico.</p>
      <div className="form-grade">
        <Campo rotulo="Matrícula" erro={mat.length === 8 && !matriculaValida(mat) ? 'Dígito verificador não confere' : null}>
          <input value={mat} onChange={(e) => setMat(mascaraMatricula(e.target.value))} placeholder="000000-0" autoFocus />
        </Campo>
        {achado === null && <Aviso tom="alerta">Matrícula não cadastrada no sistema. <a className="link" onClick={() => { onFechar(); nav('/militar/novo?matricula=' + mat); }}>Cadastrar como novo militar</a></Aviso>}
        {achado && (
          <Aviso tom={achado.situacao === 'ATIVO' ? 'info' : 'alerta'}>
            <strong>{achado.posto} {achado.nome}</strong> — atualmente no <strong>{achado.ome}</strong>
            {achado.situacao !== 'ATIVO' && ` (situação: ${SITUACAO[achado.situacao]}; reinclusão é feita pela DGP)`}
          </Aviso>
        )}
        <Campo rotulo="OME de destino">
          <select value={ome} onChange={(e) => { setOme(e.target.value ? Number(e.target.value) : ''); setSecao(''); }}>
            <option value="">Selecione</option>
            {omesEditaveis.map((o) => <option key={o.id} value={o.id}>{o.sigla}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Seção de destino">
          <select value={secao} onChange={(e) => setSecao(e.target.value ? Number(e.target.value) : '')}>
            <option value="">(definir depois)</option>
            {secoesDa(dom, ome || null).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Data da apresentação"><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Campo>
        <Campo rotulo="Documento" dica="Ex.: SP nº 045/2026"><input value={doc} onChange={(e) => setDoc(e.target.value)} /></Campo>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
