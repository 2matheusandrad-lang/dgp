import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios, secoesDa, Dominios } from '../lib/dominios';
import {
  ATIVIDADE, REGISTRO_TIPO, SITUACAO, fmtData, fmtDataHora, hojeISO, mascaraMatricula, mascaraTelefone,
  matriculaValida, msgErro, rpc, somaDias,
} from '../lib/util';
import { diferencas, NOME_OPERACAO, NOME_TABELA } from '../lib/auditoria';
import { Abas, Aviso, Badge, Botao, Campo, Carregando, Confirmar, Modal, Tabela, useToast } from '../components/ui';
import CrudFilho from '../components/CrudFilho';
import { Completude, marcadores, situacaoHoje } from './Efetivo';

export default function Militar() {
  const { id } = useParams();
  const novo = id === 'novo';
  const nav = useNavigate();
  const dom = useDominios();
  const { podeEditarOme, admin, gestaoGlobal } = useAuth();
  const toast = useToast();
  const [m, setM] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState('dados');
  const [modal, setModal] = useState<'' | 'transferir' | 'desligar' | 'reincluir' | 'excluir'>('');

  const carregar = useCallback(async () => {
    if (novo) { setM({}); return; }
    const { data, error } = await supabase.from('v_militar').select('*').eq('id', id).maybeSingle();
    if (error) setErro(msgErro(error));
    else if (!data) setErro('Militar não encontrado ou fora das OMEs que você pode consultar.');
    else setM(data);
  }, [id, novo]);
  useEffect(() => { setM(null); setErro(null); setAba('dados'); carregar(); }, [carregar]);

  if (erro) return <div className="pagina"><Aviso tom="erro">{erro}</Aviso><Botao onClick={() => nav('/efetivo')}>Voltar ao efetivo</Botao></div>;
  if (!m || !dom) return <Carregando />;

  const editavel = novo || (podeEditarOme(m.ome_id) && m.situacao === 'ATIVO');

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <button className="link voltar" onClick={() => nav(-1)}>‹ voltar</button>
          <h1>{novo ? 'Novo militar' : <>{m.posto_completo} {m.nome}</>}</h1>
          {!novo && (
            <p className="sub">
              Mat. {m.matricula} · {m.ome_sigla}{m.secao_nome ? ` · ${m.secao_nome}` : ''} · {m.situacao === 'ATIVO' ? situacaoHoje(m) : <Badge tom="vermelho">{SITUACAO[m.situacao]}</Badge>} {marcadores(m)}
            </p>
          )}
        </div>
        {!novo && (
          <div className="acoes">
            {m.situacao === 'ATIVO' && podeEditarOme(m.ome_id) && <Botao onClick={() => setModal('transferir')}>Transferir</Botao>}
            {m.situacao === 'ATIVO' && podeEditarOme(m.ome_id) && <Botao onClick={() => setModal('desligar')}>Desligar do efetivo</Botao>}
            {m.situacao !== 'ATIVO' && gestaoGlobal && <Botao onClick={() => setModal('reincluir')}>Reincluir</Botao>}
            {admin && <Botao variante="perigo" onClick={() => setModal('excluir')}>Excluir cadastro</Botao>}
          </div>
        )}
      </div>

      {!novo && (
        <Abas ativa={aba} onChange={setAba} abas={[
          { id: 'dados', rotulo: 'Dados' }, { id: 'afast', rotulo: 'Afastamentos' }, { id: 'situacoes', rotulo: 'Situações funcionais' },
          { id: 'formacao', rotulo: 'Formação e idiomas' }, { id: 'punicoes', rotulo: 'Punições' },
          { id: 'mov', rotulo: 'Movimentações' }, { id: 'hist', rotulo: 'Histórico' },
        ]} />
      )}

      {aba === 'dados' && <DadosMilitar m={m} novo={novo} editavel={editavel} dom={dom} onSalvo={(nid) => { toast('Ficha salva.'); novo ? nav(`/militar/${nid}`, { replace: true }) : carregar(); }} />}
      {aba === 'afast' && <AfastamentosMilitar m={m} editavel={editavel} dom={dom} onMudou={carregar} />}
      {aba === 'situacoes' && <SituacoesMilitar m={m} editavel={editavel} onMudou={carregar} />}
      {aba === 'formacao' && <FormacaoMilitar m={m} editavel={editavel} dom={dom} onMudou={carregar} />}
      {aba === 'punicoes' && <PunicoesMilitar m={m} editavel={editavel} dom={dom} onMudou={carregar} />}
      {aba === 'mov' && <MovimentacoesMilitar m={m} />}
      {aba === 'hist' && <HistoricoMilitar m={m} />}

      {!novo && <AcoesMovimentacao modal={modal} setModal={setModal} m={m} dom={dom} onFeito={carregar} />}
    </div>
  );
}

// =====================================================================
function DadosMilitar({ m, novo, editavel, dom, onSalvo }: { m: any; novo: boolean; editavel: boolean; dom: Dominios; onSalvo: (id?: string) => void }) {
  const { ctx, escopo, gestaoGlobal, podeEditarOme } = useAuth();
  const [params] = useSearchParams();
  const omesEditaveis = gestaoGlobal ? dom.omes.filter((o) => o.ativo) : (ctx?.omes || []).filter((o) => podeEditarOme(o.id));
  const inicial = useMemo(() => novo ? {
    matricula: params.get('matricula') || '', nome: '', nome_guerra: '', posto_id: '', quadro_sigla: '',
    ome_id: escopo && podeEditarOme(escopo) ? escopo : omesEditaveis.length === 1 ? omesEditaveis[0].id : '',
    secao_id: '', atividade: '', ano_ingresso: '', ordem_antiguidade: '', email: '', telefone1: '', telefone2: '', endereco: '', observacoes: '', documento: '',
  } : { ...m, posto_id: m.posto_id, quadro_sigla: m.quadro_sigla || '', secao_id: m.secao_id || '', atividade: m.atividade || '' },
  [m, novo]); // eslint-disable-line
  const [f, setF] = useState<any>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [onde, setOnde] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setF(inicial), [inicial]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const posto = dom.postos.find((p) => String(p.id) === String(f.posto_id));

  useEffect(() => {
    if (novo && matriculaValida(f.matricula)) rpc('localizar_matricula', { p_matricula: f.matricula }).then(setOnde).catch(() => setOnde(null));
    else setOnde(null);
  }, [f.matricula, novo]);

  const salvar = async () => {
    setErro(null);
    if (!matriculaValida(f.matricula)) return setErro('Matrícula inválida: confira o dígito verificador.');
    if (!f.nome?.trim() || !f.posto_id || !f.ome_id) return setErro('Preencha matrícula, nome, posto/graduação e OME.');
    const dados: any = {
      matricula: f.matricula, nome: f.nome, nome_guerra: f.nome_guerra || null, posto_id: Number(f.posto_id),
      quadro_sigla: posto?.oficial && f.quadro_sigla ? f.quadro_sigla : null, secao_id: f.secao_id ? Number(f.secao_id) : null,
      atividade: f.atividade || null, ano_ingresso: f.ano_ingresso ? Number(f.ano_ingresso) : null,
      ordem_antiguidade: f.ordem_antiguidade === '' || f.ordem_antiguidade === null ? null : Number(f.ordem_antiguidade),
      email: f.email?.trim() || null, telefone1: f.telefone1 || null, telefone2: f.telefone2 || null,
      endereco: f.endereco?.trim() || null, observacoes: f.observacoes?.trim() || null,
    };
    setSalvando(true);
    try {
      if (novo) {
        dados.ome_id = Number(f.ome_id);
        const { data, error } = await supabase.from('militar').insert(dados).select('id').single();
        if (error) throw error;
        const { data: u } = await supabase.auth.getUser();
        await supabase.from('movimentacao').insert({
          militar_id: data.id, tipo: 'INCLUSAO', ome_destino_id: dados.ome_id, secao_destino_id: dados.secao_id,
          documento: f.documento || null, registrado_por: u.user?.id,
        });
        onSalvo(data.id);
      } else {
        const { error } = await supabase.from('militar').update(dados).eq('id', m.id);
        if (error) throw error;
        onSalvo();
      }
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  };

  const dis = !editavel;
  return (
    <div className="cartao"><div className="cartao-corpo">
      {!novo && <div className="linha-info"><Completude v={m.completude} pend={m.pendencias} />{m.pendencias?.length > 0 && <span className="nota">Falta preencher: {m.pendencias.join(', ')}</span>}</div>}
      <div className="form-grade">
        <h4 className="form-secao">Identificação</h4>
        <Campo rotulo="Matrícula *" erro={f.matricula?.length === 8 && !matriculaValida(f.matricula) ? 'Dígito verificador não confere' : null}>
          <input value={f.matricula} disabled={dis || !novo} onChange={(e) => set('matricula', mascaraMatricula(e.target.value))} placeholder="000000-0" />
        </Campo>
        {onde && <Aviso tom="alerta">Esta matrícula já está cadastrada: {onde.posto} {onde.nome} ({onde.ome}). Use “Receber militar transferido” na tela de Efetivo.</Aviso>}
        <Campo rotulo="Nome completo *" largura="meia"><input value={f.nome} disabled={dis} onChange={(e) => set('nome', e.target.value)} /></Campo>
        <Campo rotulo="Nome de guerra"><input value={f.nome_guerra || ''} disabled={dis} onChange={(e) => set('nome_guerra', e.target.value)} /></Campo>
        <Campo rotulo="Posto/graduação *">
          <select value={f.posto_id} disabled={dis} onChange={(e) => set('posto_id', e.target.value)}>
            <option value="">Selecione</option>
            {dom.postos.map((p) => <option key={p.id} value={p.id}>{p.sigla} — {p.nome}</option>)}
          </select>
        </Campo>
        {posto?.oficial && (
          <Campo rotulo="Quadro">
            <select value={f.quadro_sigla} disabled={dis} onChange={(e) => set('quadro_sigla', e.target.value)}>
              <option value="">—</option>
              {dom.quadros.map((q) => <option key={q.sigla} value={q.sigla}>{q.sigla}</option>)}
            </select>
          </Campo>
        )}
        <Campo rotulo="Ano de ingresso"><input type="number" min={1950} max={2100} value={f.ano_ingresso || ''} disabled={dis} onChange={(e) => set('ano_ingresso', e.target.value)} /></Campo>
        <Campo rotulo="Ordem de antiguidade" dica="Desempate dentro do mesmo posto (menor = mais antigo)">
          <input type="number" value={f.ordem_antiguidade ?? ''} disabled={dis} onChange={(e) => set('ordem_antiguidade', e.target.value)} />
        </Campo>

        <h4 className="form-secao">Lotação</h4>
        <Campo rotulo="OME *" dica={novo ? undefined : 'Para mudar de OME use “Transferir”.'}>
          {novo ? (
            <select value={f.ome_id} onChange={(e) => { set('ome_id', e.target.value ? Number(e.target.value) : ''); set('secao_id', ''); }}>
              <option value="">Selecione</option>
              {omesEditaveis.map((o) => <option key={o.id} value={o.id}>{o.sigla}</option>)}
            </select>
          ) : <input value={m.ome_sigla} disabled />}
        </Campo>
        <Campo rotulo="Seção">
          <select value={f.secao_id} disabled={dis} onChange={(e) => set('secao_id', e.target.value)}>
            <option value="">(não informada)</option>
            {secoesDa(dom, Number(novo ? f.ome_id : m.ome_id)).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Atividade">
          <select value={f.atividade} disabled={dis} onChange={(e) => set('atividade', e.target.value)}>
            <option value="">(não informada)</option>
            {Object.entries(ATIVIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        {novo && <Campo rotulo="Documento de inclusão" dica="Ex.: SP nº 045/2026"><input value={f.documento} onChange={(e) => set('documento', e.target.value)} /></Campo>}

        <h4 className="form-secao">Contato</h4>
        <Campo rotulo="E-mail"><input type="email" value={f.email || ''} disabled={dis} onChange={(e) => set('email', e.target.value)} /></Campo>
        <Campo rotulo="Telefone (WhatsApp)"><input value={f.telefone1 || ''} disabled={dis} onChange={(e) => set('telefone1', mascaraTelefone(e.target.value))} placeholder="(81) 9XXXX-XXXX" /></Campo>
        <Campo rotulo="Telefone 2"><input value={f.telefone2 || ''} disabled={dis} onChange={(e) => set('telefone2', mascaraTelefone(e.target.value))} /></Campo>
        <Campo rotulo="Endereço" largura="inteira"><input value={f.endereco || ''} disabled={dis} onChange={(e) => set('endereco', e.target.value)} /></Campo>
        <Campo rotulo="Observações" largura="inteira"><textarea rows={2} value={f.observacoes || ''} disabled={dis} onChange={(e) => set('observacoes', e.target.value)} /></Campo>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {editavel && <div className="form-acoes"><Botao variante="primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : novo ? 'Cadastrar militar' : 'Salvar alterações'}</Botao></div>}
      {!editavel && !novo && <p className="nota">Somente leitura.</p>}
    </div></div>
  );
}

// =====================================================================
function useLista(view: string, militarId: string, ordem: string, asc = false) {
  const [linhas, setLinhas] = useState<any[] | null>(null);
  const carregar = useCallback(() => {
    supabase.from(view).select('*').eq('militar_id', militarId).order(ordem, { ascending: asc })
      .then(({ data, error }) => { if (error) console.error(error); setLinhas(data || []); });
  }, [view, militarId, ordem, asc]);
  useEffect(() => { carregar(); }, [carregar]);
  return [linhas, carregar] as const;
}

const statusAfast = (s: string) => <Badge tom={s === 'EM CURSO' ? 'amarelo' : s === 'PREVISTO' ? 'azul' : 'neutro'}>{s.toLowerCase()}</Badge>;

function AfastamentosMilitar({ m, editavel, dom, onMudou }: { m: any; editavel: boolean; dom: Dominios; onMudou: () => void }) {
  const { ctx } = useAuth();
  const [linhas, recarregar] = useLista('v_afastamento', m.id, 'data_inicio');
  if (!linhas) return <Carregando />;
  const saude = !!ctx?.pode_ver_saude;
  return (
    <CrudFilho titulo="Afastamento" linhas={linhas} podeEditar={editavel} recarregar={() => { recarregar(); onMudou(); }}
      descricao={<span className="nota">O término é calculado automaticamente (início + dias − 1).</span>}
      colunas={[
        { id: 'tipo_nome', titulo: 'Tipo' },
        { id: 'data_inicio', titulo: 'Início', render: (r) => fmtData(r.data_inicio) },
        { id: 'dias', titulo: 'Dias' },
        { id: 'data_fim', titulo: 'Término', render: (r) => fmtData(r.data_fim) },
        { id: 'status', titulo: 'Status', render: (r) => statusAfast(r.status) },
        ...(saude ? [{ id: 'natureza', titulo: 'Natureza/CID', render: (r: any) => [r.natureza === 'FISICO' ? 'Físico' : r.natureza === 'MENTAL' ? 'Mental' : '', r.cid].filter(Boolean).join(' · ') }] : []),
        { id: 'processo_sei', titulo: 'Processo SEI' },
      ]}
      novo={() => ({ tipo_id: '', data_inicio: hojeISO(), dias: 30, processo_sei: '', observacao: '', natureza: '', cid: '' })}
      form={(v, set) => {
        const tipo = dom.tiposAfast.find((t) => String(t.id) === String(v.tipo_id));
        const fim = v.data_inicio && Number(v.dias) > 0 ? somaDias(v.data_inicio, Number(v.dias) - 1) : '';
        return <>
          <Campo rotulo="Tipo *" largura="meia">
            <select value={v.tipo_id} onChange={(e) => set('tipo_id', e.target.value)}>
              <option value="">Selecione</option>
              {dom.tiposAfast.filter((t) => t.ativo || String(t.id) === String(v.tipo_id)).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Início *"><input type="date" value={v.data_inicio} onChange={(e) => set('data_inicio', e.target.value)} /></Campo>
          <Campo rotulo="Dias *"><input type="number" min={1} max={3650} value={v.dias} onChange={(e) => set('dias', e.target.value)} /></Campo>
          <Campo rotulo="Término" dica="ou informe a data de término para calcular os dias">
            <input type="date" value={fim} onChange={(e) => {
              if (e.target.value && v.data_inicio) {
                const d = Math.round((new Date(e.target.value + 'T12:00').getTime() - new Date(v.data_inicio + 'T12:00').getTime()) / 864e5) + 1;
                if (d > 0) set('dias', d);
              }
            }} />
          </Campo>
          <Campo rotulo="Processo SEI" largura="meia"><input value={v.processo_sei || ''} onChange={(e) => set('processo_sei', e.target.value)} placeholder="3900000272.000000/2026-00" /></Campo>
          {tipo?.exige_saude && saude && <>
            <Campo rotulo="Natureza">
              <select value={v.natureza || ''} onChange={(e) => set('natureza', e.target.value)}>
                <option value="">—</option><option value="FISICO">Físico</option><option value="MENTAL">Mental</option>
              </select>
            </Campo>
            <Campo rotulo="CID" dica="Dado sensível (LGPD)"><input value={v.cid || ''} onChange={(e) => set('cid', e.target.value.toUpperCase())} placeholder="M54.5" /></Campo>
          </>}
          {tipo?.exige_saude && !saude && <Aviso tom="info">Natureza e CID só podem ser registrados por usuários com permissão de saúde.</Aviso>}
          <Campo rotulo="Observação" largura="inteira"><input value={v.observacao || ''} onChange={(e) => set('observacao', e.target.value)} /></Campo>
        </>;
      }}
      salvar={async (v) => {
        if (!v.tipo_id || !v.data_inicio || !(Number(v.dias) > 0)) throw new Error('Preencha tipo, início e dias.');
        const dados = { militar_id: m.id, tipo_id: Number(v.tipo_id), data_inicio: v.data_inicio, dias: Number(v.dias), processo_sei: v.processo_sei || null, observacao: v.observacao || null };
        let aid = v.id;
        if (aid) { const { error } = await supabase.from('afastamento').update(dados).eq('id', aid); if (error) throw error; }
        else { const { data, error } = await supabase.from('afastamento').insert(dados).select('id').single(); if (error) throw error; aid = data.id; }
        const tipo = dom.tiposAfast.find((t) => t.id === Number(v.tipo_id));
        if (saude) {
          if (tipo?.exige_saude && (v.natureza || v.cid)) {
            const { error } = await supabase.from('afastamento_saude').upsert({ afastamento_id: aid, natureza: v.natureza || null, cid: v.cid || null });
            if (error) throw error;
          } else if (v.id) {
            await supabase.from('afastamento_saude').delete().eq('afastamento_id', aid);
          }
        }
      }}
      excluir={async (r) => { const { error } = await supabase.from('afastamento').delete().eq('id', r.id); if (error) throw error; }}
    />
  );
}

function SituacoesMilitar({ m, editavel, onMudou }: { m: any; editavel: boolean; onMudou: () => void }) {
  const [linhas, recarregar] = useLista('v_registro_funcional', m.id, 'criado_em');
  if (!linhas) return <Carregando />;
  return (
    <CrudFilho titulo="Situação funcional" linhas={linhas} podeEditar={editavel} recarregar={() => { recarregar(); onMudou(); }}
      descricao={<span className="nota">Readaptação, horário especial de trabalho, acumulação de cargo público e PCD. Deixe o término vazio se for por prazo indeterminado.</span>}
      colunas={[
        { id: 'tipo', titulo: 'Tipo', render: (r) => REGISTRO_TIPO[r.tipo] },
        { id: 'detalhe', titulo: 'Detalhe' },
        { id: 'data_inicio', titulo: 'Início', render: (r) => fmtData(r.data_inicio) },
        { id: 'data_fim', titulo: 'Término', render: (r) => fmtData(r.data_fim) || 'indeterminado' },
        { id: 'vigente', titulo: 'Vigente', render: (r) => (r.vigente ? <Badge tom="verde">sim</Badge> : <Badge>não</Badge>) },
        { id: 'processo_sei', titulo: 'Processo SEI' },
      ]}
      novo={() => ({ tipo: 'READAPTACAO', detalhe: '', data_inicio: '', data_fim: '', processo_sei: '' })}
      form={(v, set) => <>
        <Campo rotulo="Tipo *">
          <select value={v.tipo} onChange={(e) => set('tipo', e.target.value)}>
            {Object.entries(REGISTRO_TIPO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </Campo>
        <Campo rotulo={v.tipo === 'PCD' ? 'Tipo de deficiência' : v.tipo === 'ACUMULACAO_CARGO' ? 'Cargo acumulado' : 'Detalhe'} largura="meia">
          <input value={v.detalhe || ''} onChange={(e) => set('detalhe', e.target.value)} />
        </Campo>
        <Campo rotulo="Início"><input type="date" value={v.data_inicio || ''} onChange={(e) => set('data_inicio', e.target.value)} /></Campo>
        <Campo rotulo="Término"><input type="date" value={v.data_fim || ''} onChange={(e) => set('data_fim', e.target.value)} /></Campo>
        <Campo rotulo="Processo SEI" largura="meia"><input value={v.processo_sei || ''} onChange={(e) => set('processo_sei', e.target.value)} /></Campo>
      </>}
      salvar={async (v) => {
        const dados = { militar_id: m.id, tipo: v.tipo, detalhe: v.detalhe || null, data_inicio: v.data_inicio || null, data_fim: v.data_fim || null, processo_sei: v.processo_sei || null };
        const { error } = v.id ? await supabase.from('registro_funcional').update(dados).eq('id', v.id) : await supabase.from('registro_funcional').insert(dados);
        if (error) throw error;
      }}
      excluir={async (r) => { const { error } = await supabase.from('registro_funcional').delete().eq('id', r.id); if (error) throw error; }}
    />
  );
}

function FormacaoMilitar({ m, editavel, dom, onMudou }: { m: any; editavel: boolean; dom: Dominios; onMudou: () => void }) {
  const [linhas, recarregar] = useLista('v_formacao', m.id, 'nivel_ordem');
  const [idiomas, setIdiomas] = useState<any[]>([]);
  const [novoIdioma, setNovoIdioma] = useState({ idioma: '', nivel: '' });
  const toast = useToast();
  const carregarIdiomas = useCallback(() => {
    supabase.from('militar_idioma').select('*').eq('militar_id', m.id).order('idioma').then(({ data }) => setIdiomas(data || []));
  }, [m.id]);
  useEffect(() => { carregarIdiomas(); }, [carregarIdiomas]);
  if (!linhas) return <Carregando />;
  const NIVEL_IDIOMA: Record<string, string> = { BASICO: 'básico', INTERMEDIARIO: 'intermediário', AVANCADO: 'avançado', FLUENTE: 'fluente' };
  return (
    <>
      <CrudFilho titulo="Formação" linhas={linhas} podeEditar={editavel} recarregar={() => { recarregar(); onMudou(); }}
        descricao={<span className="nota">Cadastre todas as formações; a maior define a escolaridade do militar.</span>}
        colunas={[
          { id: 'nivel_nome', titulo: 'Nível', valor: (r) => r.nivel_ordem },
          { id: 'area', titulo: 'Área / curso' },
          { id: 'instituicao', titulo: 'Instituição' },
          { id: 'ano_conclusao', titulo: 'Conclusão' },
        ]}
        novo={() => ({ nivel_id: '', area: '', instituicao: '', ano_conclusao: '' })}
        form={(v, set) => <>
          <Campo rotulo="Nível *">
            <select value={v.nivel_id} onChange={(e) => set('nivel_id', e.target.value)}>
              <option value="">Selecione</option>
              {dom.niveis.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Área / curso" largura="meia"><input value={v.area || ''} onChange={(e) => set('area', e.target.value)} placeholder="ex.: Engenharia Civil" /></Campo>
          <Campo rotulo="Instituição" largura="meia"><input value={v.instituicao || ''} onChange={(e) => set('instituicao', e.target.value)} /></Campo>
          <Campo rotulo="Ano de conclusão"><input type="number" value={v.ano_conclusao || ''} onChange={(e) => set('ano_conclusao', e.target.value)} /></Campo>
        </>}
        salvar={async (v) => {
          if (!v.nivel_id) throw new Error('Escolha o nível.');
          const dados = { militar_id: m.id, nivel_id: Number(v.nivel_id), area: v.area?.trim() || null, instituicao: v.instituicao?.trim() || null, ano_conclusao: v.ano_conclusao ? Number(v.ano_conclusao) : null };
          const { error } = v.id ? await supabase.from('formacao').update(dados).eq('id', v.id) : await supabase.from('formacao').insert(dados);
          if (error) throw error;
        }}
        excluir={async (r) => { const { error } = await supabase.from('formacao').delete().eq('id', r.id); if (error) throw error; }}
      />
      <div className="cartao"><div className="cartao-corpo">
        <h4>Idiomas</h4>
        <div className="chips">
          {idiomas.length === 0 && <span className="nota">Nenhum idioma informado.</span>}
          {idiomas.map((i) => (
            <Badge key={i.idioma}>{i.idioma}{i.nivel ? ` (${NIVEL_IDIOMA[i.nivel]})` : ''}
              {editavel && <button className="chip-x" onClick={async () => {
                const { error } = await supabase.from('militar_idioma').delete().eq('militar_id', m.id).eq('idioma', i.idioma);
                if (error) toast(msgErro(error), 'erro'); else carregarIdiomas();
              }}>×</button>}
            </Badge>
          ))}
        </div>
        {editavel && (
          <div className="linha-form">
            <input placeholder="Idioma" value={novoIdioma.idioma} onChange={(e) => setNovoIdioma({ ...novoIdioma, idioma: e.target.value })} />
            <select value={novoIdioma.nivel} onChange={(e) => setNovoIdioma({ ...novoIdioma, nivel: e.target.value })}>
              <option value="">Nível</option>{Object.entries(NIVEL_IDIOMA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Botao pequeno onClick={async () => {
              const idioma = novoIdioma.idioma.trim();
              if (!idioma) return;
              const { error } = await supabase.from('militar_idioma').upsert({ militar_id: m.id, idioma: idioma[0].toUpperCase() + idioma.slice(1).toLowerCase(), nivel: novoIdioma.nivel || null });
              if (error) toast(msgErro(error), 'erro'); else { setNovoIdioma({ idioma: '', nivel: '' }); carregarIdiomas(); onMudou(); }
            }}>Adicionar</Botao>
          </div>
        )}
      </div></div>
    </>
  );
}

function PunicoesMilitar({ m, editavel, dom, onMudou }: { m: any; editavel: boolean; dom: Dominios; onMudou: () => void }) {
  const [linhas, recarregar] = useLista('v_punicao', m.id, 'data_inicio');
  if (!linhas) return <Carregando />;
  return (
    <CrudFilho titulo="Punição" linhas={linhas} podeEditar={editavel} recarregar={() => { recarregar(); onMudou(); }}
      colunas={[
        { id: 'tipo_nome', titulo: 'Tipo' },
        { id: 'data_inicio', titulo: 'Início', render: (r) => fmtData(r.data_inicio) },
        { id: 'dias', titulo: 'Dias' },
        { id: 'processo', titulo: 'Processo / documento' },
        { id: 'observacao', titulo: 'Observação' },
      ]}
      novo={() => ({ tipo_id: '', data_inicio: '', dias: '', processo: '', observacao: '' })}
      form={(v, set) => <>
        <Campo rotulo="Tipo *">
          <select value={v.tipo_id} onChange={(e) => set('tipo_id', e.target.value)}>
            <option value="">Selecione</option>
            {dom.tiposPun.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Início"><input type="date" value={v.data_inicio || ''} onChange={(e) => set('data_inicio', e.target.value)} /></Campo>
        <Campo rotulo="Dias"><input type="number" min={0} value={v.dias ?? ''} onChange={(e) => set('dias', e.target.value)} /></Campo>
        <Campo rotulo="Processo (SEI/SIGPAD/BG)" largura="meia"><input value={v.processo || ''} onChange={(e) => set('processo', e.target.value)} /></Campo>
        <Campo rotulo="Observação" largura="inteira"><input value={v.observacao || ''} onChange={(e) => set('observacao', e.target.value)} /></Campo>
      </>}
      salvar={async (v) => {
        if (!v.tipo_id) throw new Error('Escolha o tipo.');
        const dados = { militar_id: m.id, tipo_id: Number(v.tipo_id), data_inicio: v.data_inicio || null, dias: v.dias === '' || v.dias === null ? null : Number(v.dias), processo: v.processo || null, observacao: v.observacao || null };
        const { error } = v.id ? await supabase.from('punicao').update(dados).eq('id', v.id) : await supabase.from('punicao').insert(dados);
        if (error) throw error;
      }}
      excluir={async (r) => { const { error } = await supabase.from('punicao').delete().eq('id', r.id); if (error) throw error; }}
    />
  );
}

export const TIPO_MOV: Record<string, string> = { INCLUSAO: 'Inclusão', TRANSFERENCIA: 'Transferência', DESLIGAMENTO: 'Desligamento', REINCLUSAO: 'Reinclusão' };

function MovimentacoesMilitar({ m }: { m: any }) {
  const [linhas] = useLista('v_movimentacao', m.id, 'data');
  if (!linhas) return <Carregando />;
  return (
    <div className="cartao"><div className="cartao-corpo">
      <Tabela linhas={linhas} chave={(r: any) => r.id} vazio="Sem movimentações registradas." colunas={[
        { id: 'data', titulo: 'Data', render: (r: any) => fmtData(r.data) },
        { id: 'tipo', titulo: 'Tipo', render: (r: any) => TIPO_MOV[r.tipo] },
        { id: 'ome_origem_sigla', titulo: 'De' },
        { id: 'ome_destino_sigla', titulo: 'Para', render: (r: any) => r.tipo === 'DESLIGAMENTO' ? SITUACAO[r.situacao_nova] : [r.ome_destino_sigla, r.secao_destino_nome].filter(Boolean).join(' · ') },
        { id: 'documento', titulo: 'Documento' },
        { id: 'observacao', titulo: 'Observação' },
        { id: 'registrado_por_nome', titulo: 'Registrado por', render: (r: any) => r.registrado_por_nome || 'importação' },
      ]} />
    </div></div>
  );
}

function HistoricoMilitar({ m }: { m: any }) {
  const [linhas, setLinhas] = useState<any[] | null>(null);
  useEffect(() => {
    supabase.from('v_auditoria').select('*').eq('militar_id', m.id).order('momento', { ascending: false }).limit(300)
      .then(({ data }) => setLinhas(data || []));
  }, [m.id]);
  if (!linhas) return <Carregando />;
  return (
    <div className="cartao"><div className="cartao-corpo">
      <Tabela linhas={linhas} chave={(r: any) => String(r.id)} vazio="Sem alterações registradas desde a importação (ou você não tem acesso ao histórico)." colunas={[
        { id: 'momento', titulo: 'Quando', render: (r: any) => fmtDataHora(r.momento) },
        { id: 'usuario_nome', titulo: 'Usuário', render: (r: any) => r.usuario_nome || 'sistema' },
        { id: 'tabela', titulo: 'O quê', render: (r: any) => `${NOME_OPERACAO[r.operacao]} · ${NOME_TABELA[r.tabela] || r.tabela}` },
        { id: 'dif', titulo: 'Detalhes', ordenavel: false, render: (r: any) => <ul className="dif">{diferencas(r).slice(0, 8).map((d, i) => <li key={i}>{d}</li>)}</ul> },
      ]} />
    </div></div>
  );
}

// =====================================================================
function AcoesMovimentacao({ modal, setModal, m, dom, onFeito }: { modal: string; setModal: (v: any) => void; m: any; dom: Dominios; onFeito: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const { podeEditarOme } = useAuth();
  const [f, setF] = useState<any>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setF({ data: hojeISO(), documento: '', observacao: '', ome: '', secao: '', situacao: 'RESERVA' }); setErro(null); }, [modal]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const fechar = () => setModal('');

  const executar = async () => {
    setErro(null); setSalvando(true);
    try {
      if (modal === 'transferir') {
        if (!f.ome) throw new Error('Escolha a OME de destino.');
        await rpc('transferir_militar', { p_militar: m.id, p_ome_destino: Number(f.ome), p_secao_destino: f.secao ? Number(f.secao) : null, p_data: f.data, p_documento: f.documento, p_observacao: f.observacao || null });
        toast('Militar transferido.');
        fechar();
        if (!podeEditarOme(Number(f.ome))) { nav('/efetivo'); return; }
      } else if (modal === 'desligar') {
        await rpc('desligar_militar', { p_militar: m.id, p_situacao: f.situacao, p_data: f.data, p_documento: f.documento, p_observacao: f.observacao || null });
        toast('Militar desligado do efetivo ativo.');
        fechar();
      } else if (modal === 'reincluir') {
        if (!f.ome) throw new Error('Escolha a OME.');
        await rpc('reincluir_militar', { p_militar: m.id, p_ome: Number(f.ome), p_secao: f.secao ? Number(f.secao) : null, p_data: f.data, p_documento: f.documento, p_observacao: f.observacao || null });
        toast('Militar reincluído.');
        fechar();
      }
      onFeito();
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  };

  if (modal === 'excluir') {
    return <Confirmar aberto titulo="Excluir cadastro" perigo rotuloSim="Excluir definitivamente"
      texto={<>Isto apaga a ficha de <strong>{m.nome}</strong> e todos os registros ligados a ela. Use apenas para cadastros feitos por engano — para saída do efetivo use “Desligar”.</>}
      onNao={fechar}
      onSim={async () => {
        const { error } = await supabase.from('militar').delete().eq('id', m.id);
        if (error) toast(msgErro(error), 'erro'); else { toast('Cadastro excluído.'); nav('/efetivo'); }
        fechar();
      }} />;
  }
  if (!modal) return null;
  const titulo = modal === 'transferir' ? 'Transferir militar' : modal === 'desligar' ? 'Desligar do efetivo ativo' : 'Reincluir militar';
  return (
    <Modal aberto titulo={titulo} onFechar={fechar}
      rodape={<><Botao onClick={fechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={executar}>Confirmar</Botao></>}>
      <p className="nota">{m.posto_completo} {m.nome} · {m.ome_sigla}</p>
      <div className="form-grade">
        {(modal === 'transferir' || modal === 'reincluir') && <>
          <Campo rotulo="OME de destino *">
            <select value={f.ome} onChange={(e) => { set('ome', e.target.value); set('secao', ''); }}>
              <option value="">Selecione</option>
              {dom.omes.filter((o) => o.ativo && (modal === 'reincluir' || o.id !== m.ome_id)).map((o) => <option key={o.id} value={o.id}>{o.sigla}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Seção de destino">
            <select value={f.secao} onChange={(e) => set('secao', e.target.value)}>
              <option value="">(a OME de destino define)</option>
              {secoesDa(dom, Number(f.ome)).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Campo>
        </>}
        {modal === 'desligar' && (
          <Campo rotulo="Motivo *">
            <select value={f.situacao} onChange={(e) => set('situacao', e.target.value)}>
              {Object.entries(SITUACAO).filter(([k]) => k !== 'ATIVO').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
        )}
        <Campo rotulo="Data *"><input type="date" value={f.data} onChange={(e) => set('data', e.target.value)} /></Campo>
        <Campo rotulo="Documento *" dica="Nº do SP, BG ou processo SEI"><input value={f.documento} onChange={(e) => set('documento', e.target.value)} /></Campo>
        <Campo rotulo="Observação" largura="inteira"><input value={f.observacao} onChange={(e) => set('observacao', e.target.value)} /></Campo>
      </div>
      {modal === 'transferir' && <Aviso tom="info">Após a transferência, a ficha passa para a OME de destino e sai da sua lista. O histórico acompanha o militar.</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
