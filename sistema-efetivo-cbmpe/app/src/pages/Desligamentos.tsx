import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { invalidar, useConsulta } from '../lib/consulta';
import { SITUACAO, buscarTodos, fmtData, fmtDataHora, hojeISO, msgErro, rpc, somaDias } from '../lib/util';
import { Abas, Aviso, Badge, Botao, Campo, Carregando, Modal, Tabela, useToast } from '../components/ui';
import DesligamentoModal, { useMotivos } from '../components/Desligamento';
import Exportar from '../components/Exportar';

const TOM: Record<string, any> = { PENDENTE: 'amarelo', ATENDIDA: 'verde', DEVOLVIDA: 'vermelho', CANCELADA: 'neutro' };

export default function Desligamentos() {
  const { gestaoGlobal, podeEditarAlguma, escopo } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [aba, setAba] = useState(params.get('aba') || (podeEditarAlguma ? 'pedidos' : 'desligados'));
  const [ini, setIni] = useState(somaDias(hojeISO(), -365));
  const [fim, setFim] = useState(hojeISO());
  const [novo, setNovo] = useState(false);
  const [alvo, setAlvo] = useState<any>(null);
  const [decidir, setDecidir] = useState<{ s: any; acao: 'ATENDER' | 'DEVOLVER' } | null>(null);
  const [exp, setExp] = useState(false);
  const motivos = useMotivos().dados || [];

  const pedidos = useConsulta(`deslig|pedidos|${escopo}`, async () => {
    let q = supabase.from('v_solicitacao').select('*').order('solicitado_em', { ascending: false }).limit(500);
    if (escopo) q = q.eq('ome_id', escopo);
    const { data, error } = await q; if (error) throw error; return data || [];
  }, 15_000);
  const desligados = useConsulta(`deslig|lista|${escopo}|${ini}|${fim}`, () => buscarTodos(() => {
    let q = supabase.from('v_desligamento').select('*').gte('data_situacao', ini).lte('data_situacao', fim).order('data_situacao', { ascending: false }).order('militar_id');
    if (escopo) q = q.eq('ome_id', escopo);
    return q;
  }), 60_000);
  const recarregar = () => { invalidar('deslig'); invalidar('efetivo'); invalidar('painel'); invalidar('pendencias'); };
  const deslig = (pedidos.dados || []).filter((p: any) => p.tipo === 'DESLIGAMENTO');
  const correcoes = (pedidos.dados || []).filter((p: any) => p.tipo === 'CORRECAO');
  const pend = deslig.filter((p: any) => p.status === 'PENDENTE').length;
  const corr = correcoes.filter((p: any) => p.status === 'PENDENTE').length;

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div><h1>Desligamentos e pedidos</h1><p className="sub">Saídas do efetivo ativo (reserva, reforma, falecimento, exoneração…) e correções cadastrais. Registro exclusivo da DGP; as OMEs comunicam por pedido.</p></div>
        <div className="acoes">
          {podeEditarAlguma && <Botao variante="primario" onClick={() => setNovo(true)}>{gestaoGlobal ? 'Registrar desligamento' : 'Comunicar desligamento'}</Botao>}
        </div>
      </div>
      <Abas ativa={aba} onChange={setAba} abas={[
        ...(podeEditarAlguma ? [{ id: 'pedidos', rotulo: <>Pedidos das OMEs {pend > 0 && <Badge tom="amarelo">{pend}</Badge>}</> }] : []),
        ...(podeEditarAlguma ? [{ id: 'correcoes', rotulo: <>Correções cadastrais {corr > 0 && <Badge tom="amarelo">{corr}</Badge>}</> }] : []),
        { id: 'desligados', rotulo: 'Desligados no período' },
      ]} />

      {aba === 'pedidos' && (pedidos.erro ? <Aviso tom="erro">{pedidos.erro}</Aviso> : !pedidos.dados ? <Carregando /> : (
        <Tabela linhas={deslig} chave={(r: any) => r.id} vazio="Nenhum pedido." colunas={[
          { id: 'solicitado_em', titulo: 'Pedido em', render: (r: any) => fmtDataHora(r.solicitado_em) },
          { id: 'ome_sigla', titulo: 'OME' },
          { id: 'nome', titulo: 'Militar', render: (r: any) => <a className="link" onClick={() => nav(`/militar/${r.militar_id}`)}>{r.posto_completo} {r.nome}</a> },
          { id: 'motivo_nome', titulo: 'Motivo' },
          { id: 'data', titulo: 'Data', valor: (r: any) => r.dados?.data, render: (r: any) => fmtData(r.dados?.data) },
          { id: 'doc', titulo: 'Publicação / SEI', ordenavel: false, render: (r: any) => [r.dados?.publicacao, r.dados?.processo].filter(Boolean).join(' · ') },
          { id: 'solicitado_por_nome', titulo: 'Pedido por' },
          { id: 'status', titulo: 'Situação', render: (r: any) => <><Badge tom={TOM[r.status]}>{r.status.toLowerCase()}</Badge>{r.resposta && <div className="nota">{r.resposta}</div>}</> },
          { id: 'acoes', titulo: '', ordenavel: false, render: (r: any) => r.status !== 'PENDENTE' ? null : gestaoGlobal ? (
            <span className="acoes-linha"><Botao pequeno variante="primario" onClick={() => setDecidir({ s: r, acao: 'ATENDER' })}>Efetivar</Botao><Botao pequeno onClick={() => setDecidir({ s: r, acao: 'DEVOLVER' })}>Devolver</Botao></span>
          ) : <Botao pequeno variante="fantasma" onClick={async () => { try { await rpc('decidir_solicitacao', { p_id: r.id, p_acao: 'CANCELAR', p_resposta: null }); toast('Pedido cancelado.'); recarregar(); } catch (e) { toast(msgErro(e), 'erro'); } }}>Cancelar</Botao> },
        ]} />
      ))}

      {aba === 'correcoes' && (pedidos.erro ? <Aviso tom="erro">{pedidos.erro}</Aviso> : !pedidos.dados ? <Carregando /> : <>
        <p className="nota">Posto, quadro, nome, matrícula, antiguidade e data de ingresso só mudam pela DGP. As OMEs pedem a correção na ficha do militar.</p>
        <Tabela linhas={correcoes} chave={(r: any) => r.id} vazio="Nenhum pedido de correção." colunas={[
          { id: 'solicitado_em', titulo: 'Pedido em', render: (r: any) => fmtDataHora(r.solicitado_em) },
          { id: 'ome_sigla', titulo: 'OME' },
          { id: 'nome', titulo: 'Militar', render: (r: any) => <a className="link" onClick={() => nav(`/militar/${r.militar_id}`)}>{r.posto_completo} {r.nome}</a> },
          { id: 'campos', titulo: 'Correção pedida', ordenavel: false, render: (r: any) => <span className="nota">{descreverCorrecao(r)}</span> },
          { id: 'just', titulo: 'Justificativa', ordenavel: false, render: (r: any) => r.dados?.justificativa },
          { id: 'solicitado_por_nome', titulo: 'Pedido por' },
          { id: 'status', titulo: 'Situação', render: (r: any) => <><Badge tom={TOM[r.status]}>{r.status.toLowerCase()}</Badge>{r.resposta && <div className="nota">{r.resposta}</div>}</> },
          { id: 'acoes', titulo: '', ordenavel: false, render: (r: any) => r.status !== 'PENDENTE' ? null : gestaoGlobal ? (
            <span className="acoes-linha"><Botao pequeno variante="primario" onClick={() => setDecidir({ s: r, acao: 'ATENDER' })}>Aplicar</Botao><Botao pequeno onClick={() => setDecidir({ s: r, acao: 'DEVOLVER' })}>Devolver</Botao></span>
          ) : <Botao pequeno variante="fantasma" onClick={async () => { try { await rpc('decidir_solicitacao', { p_id: r.id, p_acao: 'CANCELAR', p_resposta: null }); toast('Pedido cancelado.'); recarregar(); } catch (e) { toast(msgErro(e), 'erro'); } }}>Cancelar</Botao> },
        ]} />
      </>)}

      {aba === 'desligados' && <>
        <div className="filtros">
          <Campo rotulo="De"><input type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></Campo>
          <Campo rotulo="Até"><input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>
          <div className="acoes fim"><Botao onClick={() => setExp(true)} disabled={!desligados.dados?.length}>Exportar</Botao></div>
        </div>
        {!desligados.dados ? <Carregando /> : (
          <Tabela linhas={desligados.dados} chave={(r: any) => r.militar_id} onLinha={(r: any) => nav(`/militar/${r.militar_id}`)} vazio="Nenhum desligamento no período." colunas={[
            { id: 'data_situacao', titulo: 'Data', render: (r: any) => fmtData(r.data_situacao) },
            { id: 'posto_completo', titulo: 'Posto', valor: (r: any) => r.posto_ordem },
            { id: 'nome', titulo: 'Nome' },
            { id: 'ome_sigla', titulo: 'Última OME' },
            { id: 'situacao', titulo: 'Situação', render: (r: any) => SITUACAO[r.situacao] },
            { id: 'motivo', titulo: 'Motivo' },
            { id: 'publicacao_desligamento', titulo: 'Publicação' },
            { id: 'processo_sei', titulo: 'Processo SEI' },
          ]} />
        )}
      </>}

      {novo && <BuscarMilitar titulo={gestaoGlobal ? 'Registrar desligamento' : 'Comunicar desligamento à DGP'} onFechar={() => setNovo(false)} onEscolher={(m) => { setNovo(false); setAlvo(m); }} />}
      <DesligamentoModal militar={alvo} modo={gestaoGlobal ? 'efetivar' : 'pedido'} onFechar={() => setAlvo(null)}
        onFeito={() => { toast(gestaoGlobal ? 'Desligamento registrado.' : 'Pedido enviado à DGP.'); setAlvo(null); recarregar(); }} />
      {decidir && <Decidir {...decidir} motivos={motivos} onFechar={() => setDecidir(null)} onFeito={() => { setDecidir(null); recarregar(); }} />}
      <Exportar aberto={exp} onFechar={() => setExp(false)} arquivo="desligamentos" titulo="Desligamentos" subtitulo={`${fmtData(ini)} a ${fmtData(fim)}`}
        qtd={desligados.dados?.length || 0} obterLinhas={async () => desligados.dados || []} colunas={[
          { id: 'data', titulo: 'Data', valor: (r) => fmtData(r.data_situacao), padrao: true },
          { id: 'posto', titulo: 'Posto/Grad.', valor: (r) => r.posto_completo, padrao: true },
          { id: 'mat', titulo: 'Matrícula', valor: (r) => r.matricula, padrao: true },
          { id: 'nome', titulo: 'Nome', valor: (r) => r.nome, largura: 40, padrao: true },
          { id: 'ome', titulo: 'Última OME', valor: (r) => r.ome_sigla, padrao: true },
          { id: 'motivo', titulo: 'Motivo', valor: (r) => r.motivo, largura: 28, padrao: true },
          { id: 'pub', titulo: 'Publicação', valor: (r) => r.publicacao_desligamento, largura: 20, padrao: true },
          { id: 'sei', titulo: 'Processo SEI', valor: (r) => r.processo_sei, largura: 26, padrao: true },
        ]} />
    </div>
  );
}

function Decidir({ s, acao, onFechar, onFeito }: { s: any; acao: 'ATENDER' | 'DEVOLVER'; motivos: any[]; onFechar: () => void; onFeito: () => void }) {
  const toast = useToast();
  const [resp, setResp] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal aberto titulo={acao === 'ATENDER' ? (s.tipo === 'CORRECAO' ? 'Aplicar correção cadastral' : 'Efetivar desligamento') : 'Devolver pedido à OME'} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante={acao === 'ATENDER' ? 'perigo' : 'primario'} onClick={async () => {
        setErro(null);
        try { await rpc('decidir_solicitacao', { p_id: s.id, p_acao: acao, p_resposta: resp || null }); toast(acao === 'ATENDER' ? (s.tipo === 'CORRECAO' ? 'Correção aplicada.' : 'Desligamento efetivado.') : 'Pedido devolvido.'); onFeito(); }
        catch (e) { setErro(msgErro(e)); }
      }}>{acao === 'ATENDER' ? (s.tipo === 'CORRECAO' ? 'Aplicar' : 'Efetivar') : 'Devolver'}</Botao></>}>
      <p><strong>{s.posto_completo} {s.nome}</strong> · {s.ome_sigla}</p>
      {s.tipo === 'CORRECAO' ? <><p>{descreverCorrecao(s)}</p><p className="nota">Justificativa: {s.dados?.justificativa}</p></> : <>
      <p>{s.motivo_nome} · {fmtData(s.dados?.data)} · {[s.dados?.publicacao, s.dados?.processo].filter(Boolean).join(' · ') || 'sem documento'}</p>
      {s.dados?.observacao && <p className="nota">Obs. da OME: {s.dados.observacao}</p>}</>}
      {acao === 'ATENDER' && s.tipo !== 'CORRECAO' && !s.dados?.publicacao && !s.dados?.processo && <Aviso tom="alerta">O pedido não tem publicação nem processo SEI: a efetivação vai recusar. Devolva pedindo o documento.</Aviso>}
      <Campo rotulo={acao === 'DEVOLVER' ? 'Motivo da devolução *' : 'Observação (opcional)'} largura="inteira"><textarea rows={2} value={resp} onChange={(e) => setResp(e.target.value)} /></Campo>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

export function BuscarMilitar({ titulo, onFechar, onEscolher }: { titulo: string; onFechar: () => void; onEscolher: (m: any) => void }) {
  const [t, setT] = useState('');
  const r = useConsulta(t.trim().length >= 3 ? `busca|${t.trim()}` : null, () => rpc<any[]>('buscar_militar', { p_texto: t.trim() }), 30_000);
  return (
    <Modal aberto titulo={titulo} onFechar={onFechar}>
      <Campo rotulo="Militar (nome, nome de guerra ou matrícula)"><input autoFocus value={t} onChange={(e) => setT(e.target.value)} /></Campo>
      {r.dados && (
        <ul className="lista-sel">
          {r.dados.filter((m) => m.situacao === 'ATIVO').map((m) => (
            <li key={m.id} onClick={() => onEscolher(m)}><span><strong>{m.posto_completo} {m.nome}</strong> <span className="nota">{m.matricula}</span></span><span>{m.ome_sigla}</span></li>
          ))}
          {!r.dados.some((m) => m.situacao === 'ATIVO') && <li className="nota">Nenhum militar ativo encontrado nas OMEs que você acessa.</li>}
        </ul>
      )}
    </Modal>
  );
}

const ROTULO_CORRECAO: Record<string, string> = { posto_id: 'posto/graduação', quadro_sigla: 'quadro', nome: 'nome', matricula: 'matrícula', ordem_antiguidade: 'antiguidade', data_ingresso: 'data de ingresso' };
const POSTOS_SIGLA: Record<string, string> = { '1': 'Cel', '2': 'Ten Cel', '3': 'Maj', '4': 'Cap', '5': '1ºTen', '6': '2ºTen', '7': 'Asp', '8': 'Subten', '9': '1ºSgt', '10': '2ºSgt', '11': '3ºSgt', '12': 'Cb', '13': 'Sd' };
function descreverCorrecao(s: any) {
  const c = s.dados?.campos || {}, a = s.dados?.antes || {};
  const v = (k: string, x: any) => (x == null || x === '' ? '—' : k === 'posto_id' ? POSTOS_SIGLA[String(x)] || x : k === 'data_ingresso' ? fmtData(x) : String(x));
  return Object.keys(c).map((k) => `${ROTULO_CORRECAO[k] || k}: ${v(k, a[k])} → ${v(k, c[k])}`).join(' · ');
}
