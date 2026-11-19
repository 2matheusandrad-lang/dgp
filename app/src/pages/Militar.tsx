import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios, secoesDa, Dominios } from '../lib/dominios';
import {
  ATIVIDADE, COMPORTAMENTO, ORDEM_COMPORTAMENTO, REGISTRO_TIPO, SEXO, SITUACAO, anosEntre, fmtData, fmtDataHora, hojeISO, linkSei,
  mascaraMatricula, mascaraTelefone, matriculaValida, msgErro, rpc, somaDias,
} from '../lib/util';
import { invalidar, useConsulta } from '../lib/consulta';
import { carregarAntiguidade } from '../lib/consultaLivre';
import { mapaRegioes } from '../lib/regioes';
import DesligamentoModal from '../components/Desligamento';
import { diferencas, NOME_OPERACAO, NOME_TABELA } from '../lib/auditoria';
import { Abas, Aviso, Badge, Botao, Campo, Carregando, Confirmar, Modal, Tabela, useToast } from '../components/ui';
import CrudFilho from '../components/CrudFilho';
import { Completude, marcadores, situacaoHoje } from './Efetivo';
import { FeriasMilitar } from './Ferias';

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
  const [modal, setModal] = useState<'' | 'transferir' | 'reincluir' | 'excluir'>('');
  const [desligar, setDesligar] = useState(false);
  const [gerandoFicha, setGerandoFicha] = useState(false);
  const ant = useConsulta(novo ? null : 'cl:ant', carregarAntiguidade, 300_000);

  const carregar = useCallback(async () => {
    if (novo) { setM({}); return; }
    const { data, error } = await supabase.from('v_militar').select('*').eq('id', id).maybeSingle();
    if (error) setErro(msgErro(error));
    else if (!data) setErro('Militar não encontrado ou fora das OMEs que você pode consultar.');
    else setM(data);
  }, [id, novo]);
  const [sp] = useSearchParams();
  useEffect(() => { setM(null); setErro(null); setAba(sp.get('aba') || 'dados'); carregar(); }, [carregar]); // eslint-disable-line
  const mudou = useCallback(() => { carregar(); ['efetivo', 'painel', 'pendencias', 'conferencia', 'ind', 'qod', 'comp:'].forEach(invalidar); }, [carregar]);

  const fichaPdf = async () => {
    setGerandoFicha(true);
    try {
      const q = (v: string, ordem: string) => supabase.from(v).select('*').eq('militar_id', m.id).order(ordem);
      const [a, r, f, i, mv, p] = await Promise.all([q('v_afastamento', 'data_inicio'), q('v_registro_funcional', 'criado_em'), q('v_formacao', 'nivel_ordem'),
        q('militar_idioma', 'idioma'), q('v_movimentacao', 'data'), q('v_punicao', 'data_contagem')]);
      const { pdfFicha } = await import('../lib/pdf');
      pdfFicha(m, a.data || [], r.data || [], f.data || [], i.data || [], mv.data || [], p.error ? null : p.data || []);
    } catch (e) { toast(msgErro(e), 'erro'); } finally { setGerandoFicha(false); }
  };

  if (erro) return <div className="pagina"><Aviso tom="erro">{erro}</Aviso><Botao onClick={() => nav('/efetivo')}>Voltar ao efetivo</Botao></div>;
  if (!m || !dom) return <Carregando />;

  const editavel = novo || (podeEditarOme(m.ome_id) && m.situacao === 'ATIVO');
  const editavelDgp = editavel && gestaoGlobal;   // situações funcionais, comportamento e punições (1.4.1)
  const soDgp = !gestaoGlobal && editavel && <p className="nota so-dgp">Consulta: este registro é lançado e alterado somente pela DGP.</p>;

  if (novo && !gestaoGlobal) return <div className="pagina"><Aviso tom="info">A inclusão de militares é feita pela DGP. Para um militar que chegou à OME, peça à DGP o registro da transferência.</Aviso><Botao onClick={() => nav('/efetivo')}>Voltar ao efetivo</Botao></div>;

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <button className="link voltar" onClick={() => nav(-1)}>‹ voltar</button>
          <h1>{novo ? 'Novo militar' : <>{m.posto_completo} {m.nome}</>}</h1>
          {!novo && (
            <p className="sub">
              Mat. {m.matricula} · {m.ome_sigla}{m.secao_nome ? ` · ${m.secao_nome}` : ''}{m.orgao_cessao ? ` · cedido: ${m.orgao_cessao}` : ''} · {m.situacao === 'ATIVO' ? situacaoHoje(m) : <Badge tom="vermelho">{SITUACAO[m.situacao]}</Badge>} {marcadores(m)}
              {m.posto_ordem >= 8 && m.comportamento && <> · comportamento <BadgeComportamento c={m.comportamento} /></>}
            </p>
          )}
          {!novo && ant.dados?.get(m.id) && (() => {
            const a = ant.dados.get(m.id);
            const reg = mapaRegioes(dom).de(m.ome_id);
            return (
              <p className="sub antiguidade-linha" title="Ordem: posto/graduação, quadro (QOC antes de QOA), número de antiguidade, data de ingresso">
                Antiguidade: <strong>{a.pos_posto}º de {a.total_posto}</strong> {m.posto_completo} · {a.pos_posto_ome}º de {a.total_posto_ome} na OME · {a.pos_ome}º de {a.total_ome} da OME · {a.pos_geral}º de {a.total_geral} geral{a.pos_regiao ? ` · ${a.pos_regiao}º de ${a.total_regiao} na ${reg.rotulo}` : ''}
              </p>
            );
          })()}
        </div>
        {!novo && (
          <div className="acoes">
            {m.situacao === 'ATIVO' && gestaoGlobal && <Botao onClick={() => setModal('transferir')}>Transferir</Botao>}
            {m.situacao === 'ATIVO' && gestaoGlobal && <Botao onClick={() => setDesligar(true)}>Registrar desligamento</Botao>}
            <Botao onClick={fichaPdf} disabled={gerandoFicha}>{gerandoFicha ? 'Gerando…' : 'Ficha em PDF'}</Botao>
            {m.situacao !== 'ATIVO' && gestaoGlobal && <Botao onClick={() => setModal('reincluir')}>Reincluir</Botao>}
            {admin && <Botao variante="perigo" onClick={() => setModal('excluir')}>Excluir cadastro</Botao>}
          </div>
        )}
      </div>

      {!novo && (
        <Abas ativa={aba} onChange={setAba} abas={[
          { id: 'dados', rotulo: 'Dados' }, { id: 'afast', rotulo: 'Afastamentos' }, { id: 'situacoes', rotulo: 'Situações funcionais' },
          { id: 'formacao', rotulo: 'Formação e idiomas' }, { id: 'punicoes', rotulo: m.posto_ordem >= 8 ? 'Comportamento e punições' : 'Punições' },
          { id: 'ferias', rotulo: 'Férias' }, { id: 'mov', rotulo: 'Movimentações' }, { id: 'hist', rotulo: 'Histórico' },
        ]} />
      )}

      {aba === 'dados' && <DadosMilitar m={m} novo={novo} editavel={editavel} dom={dom} onSalvo={(nid) => { toast('Ficha salva.'); ['efetivo', 'painel', 'pendencias', 'conferencia'].forEach(invalidar); novo ? nav(`/militar/${nid}`, { replace: true }) : carregar(); }} />}
      {aba === 'afast' && <AfastamentosMilitar m={m} editavel={editavel} dom={dom} onMudou={mudou} />}
      {aba === 'situacoes' && <>{soDgp}<SituacoesMilitar m={m} editavel={editavelDgp} onMudou={mudou} /></>}
      {aba === 'formacao' && <FormacaoMilitar m={m} editavel={editavel} dom={dom} onMudou={mudou} />}
      {aba === 'punicoes' && <>
        {soDgp}
        {m.posto_ordem >= 8 && <ComportamentoMilitar m={m} editavel={editavelDgp} onMudou={mudou} />}
        <PunicoesMilitar m={m} editavel={editavelDgp} dom={dom} onMudou={mudou} />
      </>}
      {aba === 'ferias' && <FeriasMilitar pessoa={{ militar_id: m.id }} />}
      {aba === 'mov' && <MovimentacoesMilitar m={m} />}
      {aba === 'hist' && <HistoricoMilitar m={m} />}

      {!novo && <AcoesMovimentacao modal={modal} setModal={setModal} m={m} dom={dom} onFeito={mudou} />}
      {!novo && desligar && gestaoGlobal && <DesligamentoModal militar={m} modo="efetivar" onFechar={() => setDesligar(false)}
        onFeito={() => { setDesligar(false); toast('Desligamento registrado.'); invalidar('deslig'); mudou(); }} />}
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
    sexo: '', data_nascimento: '', numero_funcional: '', orgao_cessao: '', data_promocao: '',
  } : { ...m, posto_id: m.posto_id, quadro_sigla: m.quadro_sigla || '', secao_id: m.secao_id || '', atividade: m.atividade || '', sexo: m.sexo || '' },
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
      matricula: f.matricula, nome: f.nome, posto_id: Number(f.posto_id),
      quadro_sigla: posto?.oficial && f.quadro_sigla ? f.quadro_sigla : null, secao_id: f.secao_id ? Number(f.secao_id) : null,
      atividade: f.atividade || null, data_ingresso: f.data_ingresso || null,
      ordem_antiguidade: f.ordem_antiguidade === '' || f.ordem_antiguidade === null ? null : Number(f.ordem_antiguidade),
      email: f.email?.trim() || null, telefone1: f.telefone1 || null, telefone2: f.telefone2 || null,
      endereco: f.endereco?.trim() || null, observacoes: f.observacoes?.trim() || null,
    };
    if (novo || gestaoGlobal) Object.assign(dados, {   // dados do pecúlio e do almanaque: na inclusão ou pela DGP
      ano_ingresso: f.ano_ingresso ? Number(f.ano_ingresso) : null,
      nome_guerra: f.nome_guerra || null, sexo: f.sexo || null, data_nascimento: f.data_nascimento || null, numero_funcional: f.numero_funcional?.trim() || null,
      orgao_cessao: f.orgao_cessao?.trim() || null, data_promocao: f.data_promocao || null,
    });
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
  const oficial = dis || (!novo && !gestaoGlobal);   // posto, quadro, nome, antiguidade e ingresso: só a DGP depois da inclusão
  return (
    <div className="cartao"><div className="cartao-corpo">
      {!novo && <div className="linha-info"><Completude v={m.completude} pend={m.pendencias} />{m.pendencias?.length > 0 && <span className="nota">Falta preencher: {m.pendencias.join(', ')}</span>}</div>}
      <div className="form-grade">
        <h4 className="form-secao">Identificação</h4>
        <Campo rotulo="Matrícula *" erro={f.matricula?.length === 8 && !matriculaValida(f.matricula) ? 'Dígito verificador não confere' : null}>
          <input value={f.matricula} disabled={dis || !novo} onChange={(e) => set('matricula', mascaraMatricula(e.target.value))} placeholder="000000-0" />
        </Campo>
        {onde && <Aviso tom="alerta">Esta matrícula já está cadastrada: {onde.posto} {onde.nome} ({onde.ome}). Use “Receber militar transferido” na tela de Efetivo.</Aviso>}
        <Campo rotulo="Nome completo *" largura="meia"><input value={f.nome} disabled={oficial} onChange={(e) => set('nome', e.target.value)} /></Campo>
        <Campo rotulo="Nome de guerra"><input value={f.nome_guerra || ''} disabled={oficial} onChange={(e) => set('nome_guerra', e.target.value)} /></Campo>
        <Campo rotulo="Nº funcional" dica="Do pecúlio, ex.: 2441616/01"><input value={f.numero_funcional || ''} disabled={oficial} onChange={(e) => set('numero_funcional', e.target.value.replace(/[^0-9/]/g, ''))} /></Campo>
        <Campo rotulo="Sexo">
          <select value={f.sexo || ''} disabled={oficial} onChange={(e) => set('sexo', e.target.value)}>
            <option value="">(não informado)</option>{Object.entries(SEXO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Data de nascimento" dica={f.data_nascimento ? `${anosEntre(f.data_nascimento)} anos` : 'Vem do almanaque'}>
          <input type="date" value={f.data_nascimento || ''} disabled={oficial} onChange={(e) => set('data_nascimento', e.target.value)} />
        </Campo>
        <Campo rotulo="Posto/graduação *">
          <select value={f.posto_id} disabled={oficial} onChange={(e) => set('posto_id', e.target.value)}>
            <option value="">Selecione</option>
            {dom.postos.map((p) => <option key={p.id} value={p.id}>{p.sigla} — {p.nome}</option>)}
          </select>
        </Campo>
        {posto?.oficial && (
          <Campo rotulo="Quadro">
            <select value={f.quadro_sigla} disabled={oficial} onChange={(e) => set('quadro_sigla', e.target.value)}>
              <option value="">—</option>
              {dom.quadros.map((q) => <option key={q.sigla} value={q.sigla}>{q.sigla}</option>)}
            </select>
          </Campo>
        )}
        <Campo rotulo="Ano de ingresso"><input type="number" min={1950} max={2100} value={f.ano_ingresso || ''} disabled={oficial || !!f.data_ingresso} onChange={(e) => set('ano_ingresso', e.target.value)} /></Campo>
        <Campo rotulo="Ordem de antiguidade" dica="Desempate dentro do mesmo posto (menor = mais antigo)">
          <input type="number" value={f.ordem_antiguidade ?? ''} disabled={oficial} onChange={(e) => set('ordem_antiguidade', e.target.value)} />
        </Campo>
        <Campo rotulo="Data de ingresso" dica="Data de praça (vem do almanaque)">
          <input type="date" value={f.data_ingresso || ''} disabled={oficial} onChange={(e) => set('data_ingresso', e.target.value)} />
        </Campo>
        <Campo rotulo="Data da última promoção" dica={f.data_promocao ? `${anosEntre(f.data_promocao)} ano(s) no posto` : 'Vem do almanaque'}>
          <input type="date" value={f.data_promocao || ''} disabled={oficial} onChange={(e) => set('data_promocao', e.target.value)} />
        </Campo>
        {!novo && !gestaoGlobal && editavel && (
          <div className="campo campo-meia"><span className="campo-rotulo">Dados oficiais</span>
            <span className="nota">Posto, quadro, nome, nome de guerra, nº funcional, sexo, nascimento, antiguidade, ingresso, promoção e órgão de cessão são mantidos pela DGP (pecúlio e almanaque). Se algo estiver errado, avise a DGP.</span></div>
        )}

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
        <Campo rotulo="Cedido a (órgão)" dica="Vazio = no CBMPE. Vem do pecúlio (coluna ÓRGÃO)">
          <input value={f.orgao_cessao || ''} disabled={oficial} onChange={(e) => set('orgao_cessao', e.target.value.toUpperCase())} placeholder="ex.: SDS, CAMIL, TJPE" />
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
      podeEditarLinha={(r: any) => !r.ferias_periodo_id} motivoBloqueio="pelo PAF (aba Férias)"
      descricao={<span className="nota">O término é calculado automaticamente (início + dias − 1). Férias são lançadas no módulo Férias e aparecem aqui sozinhas.</span>}
      colunas={[
        { id: 'tipo_nome', titulo: 'Tipo' },
        { id: 'data_inicio', titulo: 'Início', render: (r) => fmtData(r.data_inicio) },
        { id: 'dias', titulo: 'Dias' },
        { id: 'data_fim', titulo: 'Término', render: (r) => fmtData(r.data_fim) },
        { id: 'status', titulo: 'Status', render: (r) => statusAfast(r.status) },
        ...(saude ? [{ id: 'saude', titulo: 'Saúde', ordenavel: false, render: (r: any) => r.exige_saude ? <VerSaude id={r.id} tem={r.tem_dados_saude} /> : null }] : []),
        { id: 'processo_sei', titulo: 'Processo SEI', render: (r: any) => <Sei p={r.processo_sei} /> },
      ]}
      novo={() => ({ tipo_id: '', data_inicio: hojeISO(), dias: 30, processo_sei: '', observacao: '', natureza: '', cid: '', _saude: false })}
      form={(v, set) => {
        const tipo = dom.tiposAfast.find((t) => String(t.id) === String(v.tipo_id));
        const fim = v.data_inicio && Number(v.dias) > 0 ? somaDias(v.data_inicio, Number(v.dias) - 1) : '';
        return <>
          <Campo rotulo="Tipo *" largura="meia">
            <select value={v.tipo_id} onChange={(e) => set('tipo_id', e.target.value)}>
              <option value="">Selecione</option>
              {dom.tiposAfast.filter((t) => (t.ativo && t.codigo !== 'FERIAS') || String(t.id) === String(v.tipo_id)).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
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
          {tipo?.exige_saude && saude && (v.id && !v._saude ? (
            <div className="campo campo-meia"><span className="campo-rotulo">Natureza / CID</span>
              <Botao pequeno onClick={async () => {
                try { const r = await rpc<any[]>('ver_dados_saude', { p_afastamento: v.id }); set('natureza', r?.[0]?.natureza || ''); set('cid', r?.[0]?.cid || ''); set('_saude', true); }
                catch (e) { set('_erro', msgErro(e)); }
              }}>Ver / alterar dados de saúde</Botao>
              <span className="campo-dica">A consulta fica registrada (LGPD).</span></div>
          ) : <>
            <Campo rotulo="Natureza">
              <select value={v.natureza || ''} onChange={(e) => { set('natureza', e.target.value); set('_saude', true); }}>
                <option value="">—</option><option value="FISICO">Físico</option><option value="MENTAL">Mental</option>
              </select>
            </Campo>
            <Campo rotulo="CID" dica="Dado sensível (LGPD)"><input value={v.cid || ''} onChange={(e) => { set('cid', e.target.value.toUpperCase()); set('_saude', true); }} placeholder="M54.5" /></Campo>
          </>)}
          {tipo?.exige_saude && !saude && <Aviso tom="info">Natureza e CID só podem ser registrados por usuários com permissão de saúde.</Aviso>}
          <Campo rotulo="Observação" largura="inteira" dica="Não registre diagnóstico ou CID aqui (LGPD)."><input value={v.observacao || ''} onChange={(e) => set('observacao', e.target.value)} /></Campo>
        </>;
      }}
      salvar={async (v) => {
        if (!v.tipo_id || !v.data_inicio || !(Number(v.dias) > 0)) throw new Error('Preencha tipo, início e dias.');
        const dados = { militar_id: m.id, tipo_id: Number(v.tipo_id), data_inicio: v.data_inicio, dias: Number(v.dias), processo_sei: v.processo_sei || null, observacao: v.observacao || null };
        let aid = v.id;
        if (aid) { const { error } = await supabase.from('afastamento').update(dados).eq('id', aid); if (error) throw error; }
        else { const { data, error } = await supabase.from('afastamento').insert(dados).select('id').single(); if (error) throw error; aid = data.id; }
        const tipo = dom.tiposAfast.find((t) => t.id === Number(v.tipo_id));
        if (saude && v._saude) {
          await rpc('salvar_dados_saude', { p_afastamento: aid, p_natureza: tipo?.exige_saude ? v.natureza || null : null, p_cid: tipo?.exige_saude ? v.cid || null : null });
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

export const NATUREZA_PUN: Record<string, string> = { LEVE: 'Leve', MEDIA: 'Média', GRAVE: 'Grave' };
export const MOTIVO_CANCEL: Record<string, string> = {
  CANCELAMENTO: 'Cancelamento (arts. 60-62)', ELOGIO: 'Anulada por elogio (art. 67 §9)', RECURSO: 'Recurso provido', OUTRO: 'Outro',
};
export function BadgeComportamento({ c }: { c?: string | null }) {
  if (!c) return <Badge>sem registro</Badge>;
  const tom = ({ EXCEPCIONAL: 'verde', OTIMO: 'verde', BOM: 'azul', INSUFICIENTE: 'amarelo', MAU: 'vermelho' } as const)[c as 'BOM'] || 'neutro';
  return <Badge tom={tom}>{COMPORTAMENTO[c] || c}</Badge>;
}

function PunicoesMilitar({ m, editavel, dom, onMudou }: { m: any; editavel: boolean; dom: Dominios; onMudou: () => void }) {
  const [linhas, recarregar] = useLista('v_punicao', m.id, 'data_contagem');
  if (!linhas) return <Carregando />;
  const efeito = (id: any) => (dom.tiposPun as any[]).find((t) => String(t.id) === String(id))?.efeito_comportamento;
  return (
    <CrudFilho titulo="Punição" linhas={linhas} podeEditar={editavel} recarregar={() => { recarregar(); onMudou(); }}
      descricao={<span className="nota">Desde 27/12/2020 a pena conta a partir da <strong>publicação</strong> do ato, depois dos recursos (Decreto 50.014/2020, art. 9º); antes, a partir do fim do cumprimento (Lei 11.817/2000, art. 48). Advertência é verbal e não conta (art. 28 §3). Pena cancelada ou anulada por elogio deixa de contar na data do cancelamento.</span>}
      colunas={[
        { id: 'tipo_nome', titulo: 'Tipo', render: (r: any) => <>{r.tipo_nome}{r.natureza ? <span className="nota"> · {NATUREZA_PUN[r.natureza]}</span> : null}</> },
        { id: 'data_publicacao', titulo: 'Publicação', render: (r: any) => [fmtData(r.data_publicacao), r.publicacao].filter(Boolean).join(' · ') || <span className="nota">não informada</span> },
        { id: 'data_inicio', titulo: 'Cumprimento', render: (r: any) => (r.data_inicio ? `${fmtData(r.data_inicio)}${r.dias ? ` · ${r.dias} dia(s)` : ''}` : r.dias ? `${r.dias} dia(s)` : '') },
        { id: 'data_contagem', titulo: 'Conta desde', render: (r: any) => (r.efeito_comportamento === 'NENHUM' ? <span className="nota">não conta</span> : fmtData(r.data_contagem) || <Badge tom="amarelo">sem data</Badge>) },
        { id: 'cancelada_em', titulo: 'Cancelamento', render: (r: any) => (r.cancelada_em ? <span title={r.cancelamento_publicacao || ''}><Badge>{fmtData(r.cancelada_em)}</Badge> <span className="nota">{MOTIVO_CANCEL[r.cancelamento_motivo]}</span></span> : '') },
        { id: 'processo', titulo: 'Processo / documento' },
      ]}
      novo={() => ({ tipo_id: '', natureza: '', data_publicacao: '', publicacao: '', data_inicio: '', dias: '', cumprimento_fim: '', processo: '', observacao: '',
                     cancelada_em: '', cancelamento_motivo: '', cancelamento_publicacao: '' })}
      form={(v, set) => {
        const antiga = v.data_publicacao && v.data_publicacao < '2020-12-27';
        return <>
          <Campo rotulo="Tipo *" largura="meia">
            <select value={v.tipo_id} onChange={(e) => set('tipo_id', e.target.value)}>
              <option value="">Selecione</option>
              {dom.tiposPun.filter((t) => t.ativo || String(t.id) === String(v.tipo_id)).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Natureza da transgressão">
            <select value={v.natureza || ''} onChange={(e) => set('natureza', e.target.value)}>
              <option value="">—</option>{Object.entries(NATUREZA_PUN).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Data da publicação" dica="Do ato punitivo, depois dos recursos"><input type="date" value={v.data_publicacao || ''} onChange={(e) => set('data_publicacao', e.target.value)} /></Campo>
          <Campo rotulo="Publicação (BI/BGE)" largura="meia"><input value={v.publicacao || ''} onChange={(e) => set('publicacao', e.target.value)} placeholder="ex.: BI nº 150 de 20/08/2025" /></Campo>
          <Campo rotulo="Início do cumprimento" dica={antiga || !v.data_publicacao ? 'Penas até 26/12/2020' : 'Não se aplica depois de 27/12/2020'}><input type="date" value={v.data_inicio || ''} onChange={(e) => set('data_inicio', e.target.value)} /></Campo>
          <Campo rotulo="Dias"><input type="number" min={0} value={v.dias ?? ''} onChange={(e) => set('dias', e.target.value)} /></Campo>
          <Campo rotulo="Fim do cumprimento" dica="Se vazio: início + dias − 1"><input type="date" value={v.cumprimento_fim || ''} onChange={(e) => set('cumprimento_fim', e.target.value)} /></Campo>
          <Campo rotulo="Processo (SEI/SIGPAD)" largura="meia"><input value={v.processo || ''} onChange={(e) => set('processo', e.target.value)} /></Campo>
          <Campo rotulo="Observação" largura="inteira"><input value={v.observacao || ''} onChange={(e) => set('observacao', e.target.value)} /></Campo>
          <h4 className="form-secao">Cancelamento ou anulação</h4>
          <Campo rotulo="Data"><input type="date" value={v.cancelada_em || ''} onChange={(e) => set('cancelada_em', e.target.value)} /></Campo>
          <Campo rotulo="Motivo" largura="meia">
            <select value={v.cancelamento_motivo || ''} onChange={(e) => set('cancelamento_motivo', e.target.value)}>
              <option value="">—</option>{Object.entries(MOTIVO_CANCEL).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Publicação do cancelamento" largura="meia"><input value={v.cancelamento_publicacao || ''} onChange={(e) => set('cancelamento_publicacao', e.target.value)} /></Campo>
          {v.tipo_id && efeito(v.tipo_id) === 'NENHUM' && <Aviso tom="info">Este tipo não conta para o comportamento.</Aviso>}
        </>;
      }}
      salvar={async (v) => {
        if (!v.tipo_id) throw new Error('Escolha o tipo.');
        if (!!v.cancelada_em !== !!v.cancelamento_motivo) throw new Error('Para cancelar informe a data e o motivo; para desfazer, apague os dois.');
        const n = (x: any) => (x === '' || x == null ? null : x);
        const dados = {
          militar_id: m.id, tipo_id: Number(v.tipo_id), natureza: n(v.natureza), data_publicacao: n(v.data_publicacao), publicacao: n(v.publicacao?.trim()),
          data_inicio: n(v.data_inicio), dias: v.dias === '' || v.dias === null ? null : Number(v.dias), cumprimento_fim: n(v.cumprimento_fim),
          processo: n(v.processo?.trim()), observacao: n(v.observacao?.trim()), cancelada_em: n(v.cancelada_em), cancelamento_motivo: n(v.cancelamento_motivo),
          cancelamento_publicacao: n(v.cancelamento_publicacao?.trim()),
        };
        const { error } = v.id ? await supabase.from('punicao').update(dados).eq('id', v.id) : await supabase.from('punicao').insert(dados);
        if (error) throw error;
      }}
      excluir={async (r) => { const { error } = await supabase.from('punicao').delete().eq('id', r.id); if (error) throw error; }}
    />
  );
}

const SITUACAO_COMP: Record<string, { rotulo: string; tom: 'verde' | 'azul' | 'vermelho' | 'amarelo' }> = {
  EM_DIA: { rotulo: 'publicado em dia', tom: 'verde' }, MELHORIA: { rotulo: 'melhoria a publicar', tom: 'azul' },
  REBAIXAMENTO: { rotulo: 'reclassificação a publicar', tom: 'vermelho' }, SEM_BASE: { rotulo: 'sem comportamento publicado cadastrado', tom: 'amarelo' },
};
export const situacaoComp = (s: string) => <Badge tom={SITUACAO_COMP[s]?.tom || 'neutro'}>{SITUACAO_COMP[s]?.rotulo || s}</Badge>;

function ComportamentoMilitar({ m, editavel, onMudou }: { m: any; editavel: boolean; onMudou: () => void }) {
  const [calc, setCalc] = useState<any>(undefined);
  const [hist, recarregarHist] = useLista('comportamento_publicado', m.id, 'data_vigencia');
  const carregarCalc = useCallback(() => {
    supabase.from('v_comportamento').select('*').eq('militar_id', m.id).maybeSingle().then(({ data, error }) => { if (error) console.error(error); setCalc(data || null); });
  }, [m.id]);
  useEffect(() => { carregarCalc(); }, [carregarCalc, m]);   // a ficha recarrega (nova punição etc.): recalcula
  if (calc === undefined || !hist) return <Carregando />;
  const recarregar = () => { carregarCalc(); recarregarHist(); onMudou(); };
  return (
    <>
      <div className="cartao"><div className="cartao-corpo comportamento-resumo">
        {calc ? <>
          <div className="comp-linha">
            <div><span className="campo-rotulo">Publicado</span>
              <div>{calc.publicado ? <><BadgeComportamento c={calc.publicado} /> <span className="nota">desde {fmtData(calc.publicado_data)}{calc.publicado_publicacao ? ` · ${calc.publicado_publicacao}` : ''}</span></> : <span className="nota">nenhum cadastrado</span>}</div></div>
            <div><span className="campo-rotulo">Pelo cálculo (escala móvel)</span>
              <div><BadgeComportamento c={calc.calculado} /> <span className="nota">{calc.desde ? `desde ${fmtData(calc.desde)}` : ''}</span></div></div>
            <div><span className="campo-rotulo">Situação</span><div>{situacaoComp(calc.situacao)}</div></div>
            <div><span className="campo-rotulo">Próxima mudança prevista</span>
              <div>{calc.proxima_data ? <><BadgeComportamento c={calc.proximo} /> <span className="nota">em {fmtData(calc.proxima_data)}, se não houver nova punição</span></> : <span className="nota">nenhuma</span>}</div></div>
          </div>
          {calc.situacao === 'MELHORIA' && <Aviso tom="info">Pelo cálculo, o comportamento passou a <strong>{COMPORTAMENTO[calc.calculado]}</strong> em {fmtData(calc.desde)}. Publique a melhoria em boletim e registre aqui.</Aviso>}
          {calc.situacao === 'REBAIXAMENTO' && <Aviso tom="alerta">As punições cadastradas levam a <strong>{COMPORTAMENTO[calc.calculado]}</strong> desde {fmtData(calc.desde)}, pior que o publicado. Confira as punições e publique a reclassificação.</Aviso>}
          {calc.situacao === 'SEM_BASE' && <Aviso tom="alerta">Cadastre o último comportamento publicado (com a data e o boletim). Sem ele o cálculo considera só as punições lançadas no sistema.</Aviso>}
          {calc.base_estimada && <p className="nota">As punições cadastradas não explicam o comportamento publicado: o cálculo supõe, no pior caso, uma punição na data da publicação. Cadastre as punições anteriores (últimos 6 anos) para o cálculo ficar exato.</p>}
          {calc.punicoes_sem_data > 0 && <p className="nota">{calc.punicoes_sem_data} punição(ões) sem data de publicação ou de cumprimento não entram no cálculo.</p>}
        </> : <p className="nota">Comportamento não calculado (somente praças da ativa).</p>}
      </div></div>
      <CrudFilho titulo="Comportamento publicado" rotuloNovo="Registrar publicação" linhas={hist} podeEditar={editavel} recarregar={recarregar}
        descricao={<span className="nota">Classificação, reclassificação e melhoria publicadas em boletim (Lei 11.817/2000, art. 45 §1). O registro mais recente é o oficial.</span>}
        colunas={[
          { id: 'data_vigencia', titulo: 'A contar de', render: (r: any) => fmtData(r.data_vigencia) },
          { id: 'comportamento', titulo: 'Comportamento', valor: (r: any) => ORDEM_COMPORTAMENTO.indexOf(r.comportamento), render: (r: any) => <BadgeComportamento c={r.comportamento} /> },
          { id: 'publicacao', titulo: 'Publicação' },
          { id: 'origem', titulo: 'Tipo', render: (r: any) => ({ INCLUSAO: 'Inclusão', IMPORTACAO: 'Carga inicial', RECLASSIFICACAO: 'Reclassificação/melhoria', MANUAL: 'Registro' } as any)[r.origem] || r.origem },
          { id: 'observacao', titulo: 'Observação' },
        ]}
        novo={() => (calc && (calc.situacao === 'MELHORIA' || calc.situacao === 'REBAIXAMENTO')
          ? { comportamento: calc.calculado, data_vigencia: calc.desde || hojeISO(), publicacao: '', origem: 'RECLASSIFICACAO', observacao: '' }
          : { comportamento: calc?.publicado || 'BOM', data_vigencia: '', publicacao: '', origem: 'MANUAL', observacao: '' })}
        form={(v, set) => <>
          <Campo rotulo="Comportamento *">
            <select value={v.comportamento} onChange={(e) => set('comportamento', e.target.value)}>
              {ORDEM_COMPORTAMENTO.map((k) => <option key={k} value={k}>{COMPORTAMENTO[k]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="A contar de *"><input type="date" value={v.data_vigencia || ''} onChange={(e) => set('data_vigencia', e.target.value)} /></Campo>
          <Campo rotulo="Publicação" largura="meia" dica="Boletim que publicou"><input value={v.publicacao || ''} onChange={(e) => set('publicacao', e.target.value)} placeholder="ex.: BI nº 160 de 01/09/2025" /></Campo>
          <Campo rotulo="Tipo">
            <select value={v.origem} onChange={(e) => set('origem', e.target.value)}>
              <option value="MANUAL">Registro</option><option value="RECLASSIFICACAO">Reclassificação/melhoria</option><option value="INCLUSAO">Inclusão (Bom)</option><option value="IMPORTACAO">Carga inicial</option>
            </select>
          </Campo>
          <Campo rotulo="Observação" largura="inteira"><input value={v.observacao || ''} onChange={(e) => set('observacao', e.target.value)} /></Campo>
        </>}
        salvar={async (v) => {
          if (!v.comportamento || !v.data_vigencia) throw new Error('Informe o comportamento e a data.');
          const dados = { militar_id: m.id, comportamento: v.comportamento, data_vigencia: v.data_vigencia, publicacao: v.publicacao?.trim() || null, origem: v.origem, observacao: v.observacao?.trim() || null };
          const { error } = v.id ? await supabase.from('comportamento_publicado').update(dados).eq('id', v.id) : await supabase.from('comportamento_publicado').insert(dados);
          if (error) throw error;
        }}
        excluir={async (r: any) => { const { error } = await supabase.from('comportamento_publicado').delete().eq('id', r.id); if (error) throw error; }}
      />
    </>
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
  useEffect(() => { setF({ data: hojeISO(), documento: '', observacao: '', ome: '', secao: '' }); setErro(null); }, [modal]);
  const [impacto, setImpacto] = useState<any>(null);
  useEffect(() => {
    setImpacto(null);
    if (modal === 'transferir' && f.ome) rpc('qod_impacto', { p_militar: m.id, p_ome_destino: Number(f.ome) }).then(setImpacto).catch(() => setImpacto(null));
  }, [modal, f.ome, m.id]);
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
  const titulo = modal === 'transferir' ? 'Transferir militar' : 'Reincluir militar';
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
        <Campo rotulo="Data *"><input type="date" value={f.data} onChange={(e) => set('data', e.target.value)} /></Campo>
        <Campo rotulo="Documento *" dica="Nº do SP, BG ou processo SEI"><input value={f.documento} onChange={(e) => set('documento', e.target.value)} /></Campo>
        <Campo rotulo="Observação" largura="inteira"><input value={f.observacao} onChange={(e) => set('observacao', e.target.value)} /></Campo>
      </div>
      {modal === 'transferir' && impacto && !impacto.sem_qod && (
        <div className="impacto-qod">
          <strong>Impacto no QOD ({impacto.posto})</strong>
          {(['origem', 'destino'] as const).map((k) => {
            const x = impacto[k]; const dif = x.depois - x.previsto;
            return <div key={k}>{x.sigla}: {x.antes} → <strong>{x.depois}</strong> {x.previsto ? <>(previsto {x.previsto}; <span className={dif < 0 ? 'qod-falta' : dif > 0 ? 'qod-excesso' : 'qod-ok'}>{dif === 0 ? 'completo' : dif < 0 ? `faltam ${-dif}` : `excesso de ${dif}`}</span>)</> : <span className="nota">(sem QOD para este posto)</span>}</div>;
          })}
        </div>
      )}
      {modal === 'transferir' && <Aviso tom="info">Após a transferência, a ficha passa para a OME de destino e sai da sua lista. O histórico acompanha o militar.</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

// processo SEI: link para a pesquisa (se configurada) ou botão de copiar
export function Sei({ p }: { p?: string | null }) {
  const toast = useToast();
  if (!p) return null;
  const url = linkSei(p);
  return (
    <span className="sei" onClick={(e) => e.stopPropagation()}>
      {url ? <a href={url} target="_blank" rel="noreferrer">{p}</a> : p}
      <button className="link" title="Copiar" onClick={() => { navigator.clipboard?.writeText(p); toast('Processo copiado.'); }}>⧉</button>
    </span>
  );
}

function VerSaude({ id, tem }: { id: string; tem: boolean | null }) {
  const [dados, setDados] = useState<any>(null);
  const toast = useToast();
  if (!tem) return <span className="nota">—</span>;
  if (dados) return <span>{[dados.natureza === 'FISICO' ? 'Físico' : dados.natureza === 'MENTAL' ? 'Mental' : '', dados.cid].filter(Boolean).join(' · ') || '—'}</span>;
  return <button className="link" onClick={async (e) => {
    e.stopPropagation();
    try { const r = await rpc<any[]>('ver_dados_saude', { p_afastamento: id }); setDados(r?.[0] || {}); } catch (er) { toast(msgErro(er), 'erro'); }
  }} title="A consulta fica registrada">ver</button>;
}
