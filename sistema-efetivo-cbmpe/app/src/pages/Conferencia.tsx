import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios, secoesDa, Dominios } from '../lib/dominios';
import { invalidar, useConsulta } from '../lib/consulta';
import { COLS_LISTA, carregarEfetivo } from '../lib/efetivo';
import {
  ATIVIDADE, EMAIL_RE, buscarTodos, fmtCompetencia, fmtData, fmtDataHora, mascaraTelefone, msgErro, ordenarAntiguidade, rpc,
} from '../lib/util';
import { Aviso, Badge, Botao, Campo, Cartao, Carregando, Kpi, Modal, Tabela, Vazio, useToast } from '../components/ui';
import { situacaoHoje } from './Efetivo';

const CAMPOS_DIF: [string, string][] = [
  ['posto_completo', 'posto'], ['secao_nome', 'seção'], ['atividade', 'atividade'], ['afastamento_codigo', 'afastamento'],
  ['readaptado', 'readaptação'], ['horario_especial', 'horário especial'], ['telefone1', 'telefone'], ['email', 'e-mail'],
  ['endereco', 'endereço'], ['escolaridade', 'escolaridade'],
];

const igual = (a?: string | null, b?: string | null) => (a || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === (b || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export default function Conferencia() {
  const { escopo, ctx, podeEditarOme, gestaoGlobal } = useAuth();
  const dom = useDominios();
  const toast = useToast();
  const nav = useNavigate();
  const editaveis = (ctx?.omes || []).filter((o) => podeEditarOme(o.id));
  const [omeLocal, setOmeLocal] = useState<number | null>(null);
  const ome = escopo && podeEditarOme(escopo) ? escopo : omeLocal ?? (editaveis.length === 1 ? editaveis[0].id : null);
  const sigla = ctx?.omes.find((o) => o.id === ome)?.sigla || '';

  const comp = useConsulta('competencia', () => rpc<string>('competencia_atual'), 300_000);
  const competencia = comp.dados;

  const militares = useConsulta(ome ? `conferencia|mil|${ome}` : null,
    () => carregarEfetivo(ome, 'ATIVO', COLS_LISTA + ',email,endereco'));
  const conferidos = useConsulta(ome && competencia ? `conferencia|conf|${ome}|${competencia}` : null, async () => {
    const { data, error } = await supabase.from('conferencia').select('militar_id, conferido_em, conferido_por').eq('competencia', competencia!).eq('ome_id', ome!);
    if (error) throw error;
    return new Map((data || []).map((c: any) => [c.militar_id, c]));
  }, 10_000);
  // fotografia da última competência fechada (para mostrar o que mudou)
  const anterior = useConsulta(ome && competencia ? `conferencia|ant|${ome}|${competencia}` : null, async () => {
    const { data: f } = await supabase.from('fechamento_mensal').select('competencia').lt('competencia', competencia!).order('competencia', { ascending: false }).limit(1);
    const c = f?.[0]?.competencia;
    if (!c) return { competencia: null as string | null, mapa: new Map<string, any>() };
    const linhas = await buscarTodos(() => supabase.from('fechamento_militar').select('militar_id, dados').eq('competencia', c).eq('ome_id', ome!).order('militar_id'));
    return { competencia: c as string | null, mapa: new Map(linhas.map((l: any) => [l.militar_id, l.dados])) };
  }, 300_000);
  const entrega = useConsulta(ome && competencia ? `conferencia|ent|${ome}|${competencia}` : null, async () => {
    const l = await rpc<any[]>('situacao_entregas', { p_competencia: competencia });
    return l.find((x) => x.ome_id === ome) || null;
  }, 10_000);

  const [filtro, setFiltro] = useState<'todos' | 'pendentes' | 'conferidos' | 'mudancas' | 'incompletos'>('pendentes');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [entregar, setEntregar] = useState(false);
  const [planilha, setPlanilha] = useState<File | null>(null);
  const [gerando, setGerando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const lista = useMemo(() => {
    const mapaAnt = anterior.dados?.mapa;
    return [...(militares.dados || [])].sort(ordenarAntiguidade).map((m: any) => {
      const ant = mapaAnt?.get(m.id);
      const mudancas = !anterior.dados?.competencia ? [] : !ant ? ['novo na OME'] :
        CAMPOS_DIF.filter(([k]) => (ant[k] ?? null) !== (m[k] ?? null) && !(k === 'afastamento_codigo' && !ant[k] && !m[k])).map(([, r]) => r);
      return { ...m, _conf: conferidos.dados?.get(m.id), _mud: mudancas };
    });
  }, [militares.dados, conferidos.dados, anterior.dados]);
  const sairam = useMemo(() => {
    const ids = new Set((militares.dados || []).map((m: any) => m.id));
    return [...(anterior.dados?.mapa.entries() || [])].filter(([id]) => !ids.has(id)).map(([, d]) => d);
  }, [militares.dados, anterior.dados]);

  if (!ome) {
    return (
      <div className="pagina">
        <h1>Conferência mensal</h1>
        {editaveis.length > 1 || gestaoGlobal ? (
          <Cartao titulo="Escolha a OME">
            <p className="nota">A conferência é feita por OME. Escolha uma (ou use o seletor de OME no topo).</p>
            <select value="" onChange={(e) => setOmeLocal(Number(e.target.value))}>
              <option value="">Selecione</option>
              {(gestaoGlobal ? dom?.omes.filter((o) => o.ativo) || [] : editaveis).map((o) => <option key={o.id} value={o.id}>{o.sigla}</option>)}
            </select>
          </Cartao>
        ) : <Aviso tom="info">A conferência mensal é feita pelos gestores das OMEs.</Aviso>}
      </div>
    );
  }
  if (!militares.dados || !conferidos.dados || !competencia) return <Carregando />;

  const total = lista.length;
  const nConf = lista.filter((m) => m._conf).length;
  const pct = total ? Math.round((100 * nConf) / total) : 0;
  const visiveis = lista.filter((m) =>
    filtro === 'todos' || (filtro === 'pendentes' && !m._conf) || (filtro === 'conferidos' && m._conf) ||
    (filtro === 'mudancas' && m._mud.length) || (filtro === 'incompletos' && m.completude < 100));
  const recarregar = () => { invalidar('conferencia'); invalidar('efetivo'); invalidar('pendencias'); invalidar('painel'); };

  const conferir = async (ids: string[], valor = true) => {
    if (!ids.length) return;
    try {
      const n = await rpc<number>('conferir_militares', { p_competencia: competencia, p_militares: ids, p_conferido: valor });
      toast(valor ? `${n} militar(es) conferido(s).` : `${n} conferência(s) desfeita(s).`);
      setSel(new Set());
      invalidar(`conferencia|conf|${ome}`); invalidar('pendencias');
    } catch (e) { toast(msgErro(e), 'erro'); }
  };

  const baixarPlanilha = async () => {
    if (!dom) return;
    setGerando(true);
    try {
      const { gerarPlanilhaOme } = await import('../lib/excel');
      const completos = await carregarEfetivo(ome, 'ATIVO', 'id,email,telefone2,endereco,nome_guerra');
      const extra = new Map(completos.map((c: any) => [c.id, c]));
      await gerarPlanilhaOme({
        ome: sigla, competencia: fmtCompetencia(competencia),
        militares: lista.map((m: any) => {
          const x = extra.get(m.id) || {};
          return {
            matricula: m.matricula, posto: m.posto_completo, nome: m.nome, nome_guerra: x.nome_guerra || m.nome_guerra,
            secao: m.secao_nome, atividade: ATIVIDADE[m.atividade] || '', email: x.email, telefone1: m.telefone1, telefone2: x.telefone2,
            endereco: x.endereco, ano_ingresso: m.ano_ingresso, escolaridade: [m.escolaridade, m.areas_formacao].filter(Boolean).join(' — '),
            hoje: m.afastado_hoje ? `${m.afastamento_codigo} até ${fmtData(m.afastamento_fim)}` : 'Disponível',
          };
        }),
        secoes: secoesDa(dom, ome).map((s) => s.nome), niveis: dom.niveis.map((n) => n.nome),
        tiposAfast: dom.tiposAfast.filter((t) => t.ativo && t.codigo !== 'FERIAS').map((t) => t.nome),
      });
    } catch (e) { toast(msgErro(e), 'erro'); } finally { setGerando(false); }
  };

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Conferência mensal · {sigla}</h1>
          <p className="sub">Competência {fmtCompetencia(competencia)} · prazo {fmtData(entrega.dados?.prazo)} (5º dia útil){anterior.dados?.competencia ? ` · mudanças comparadas com ${fmtCompetencia(anterior.dados.competencia)}` : ''}</p>
        </div>
        <div className="acoes">
          <Botao onClick={baixarPlanilha} disabled={gerando}>{gerando ? 'Gerando…' : 'Baixar planilha da OME'}</Botao>
          <Botao onClick={() => arquivoRef.current?.click()}>Enviar planilha preenchida</Botao>
          <input ref={arquivoRef} type="file" accept=".xlsx" hidden onChange={(e) => { if (e.target.files?.[0]) setPlanilha(e.target.files[0]); e.target.value = ''; }} />
          <Botao variante="primario" onClick={() => setEntregar(true)}>Confirmar entrega</Botao>
        </div>
      </div>

      <div className="kpis">
        <Kpi rotulo="Conferidos" valor={`${nConf} / ${total}`} detalhe={<span className="progresso"><i style={{ width: `${pct}%` }} /></span>} tom={pct === 100 ? 'ok' : undefined} />
        <Kpi rotulo="Com mudança desde o mês anterior" valor={lista.filter((m) => m._mud.length).length} detalhe={anterior.dados?.competencia ? 'revise com atenção' : 'sem fechamento anterior para comparar'} onClick={() => setFiltro('mudancas')} />
        <Kpi rotulo="Cadastro incompleto" valor={lista.filter((m) => m.completude < 100).length} onClick={() => setFiltro('incompletos')} />
        <Kpi rotulo="Entrega" valor={entrega.dados?.confirmado_em ? 'Confirmada' : 'Pendente'} detalhe={entrega.dados?.confirmado_em ? fmtDataHora(entrega.dados.confirmado_em) : entrega.dados?.situacao?.toLowerCase()} tom={entrega.dados?.confirmado_em ? 'ok' : 'alerta'} />
      </div>

      {sairam.length > 0 && (
        <Aviso tom="info">Saíram da OME desde {fmtCompetencia(anterior.dados?.competencia)}: {sairam.map((d: any) => `${d.posto_completo} ${d.nome}`).join('; ')}.</Aviso>
      )}

      <div className="atalhos">
        {([['pendentes', 'A conferir', total - nConf], ['conferidos', 'Conferidos', nConf], ['mudancas', 'Com mudanças', lista.filter((m) => m._mud.length).length],
          ['incompletos', 'Cadastro incompleto', lista.filter((m) => m.completude < 100).length], ['todos', 'Todos', total]] as const).map(([id, r, n]) => (
          <button key={id} className={`atalho ${filtro === id ? 'ativo' : ''}`} onClick={() => setFiltro(id)}>{r} <span>{n}</span></button>
        ))}
      </div>

      <div className="barra-lote">
        <strong>{sel.size} selecionado(s)</strong>
        <Botao pequeno variante="primario" disabled={!sel.size} onClick={() => conferir([...sel])}>Marcar como conferidos</Botao>
        <Botao pequeno disabled={!sel.size} onClick={() => conferir([...sel], false)}>Desfazer conferência</Botao>
        <span className="nota">Abra a ficha para corrigir; depois marque como conferido.</span>
      </div>

      {visiveis.length === 0 ? <Vazio>{filtro === 'pendentes' ? 'Todos os militares foram conferidos.' : 'Nenhum militar neste filtro.'}</Vazio> : (
        <Tabela linhas={visiveis} chave={(m: any) => m.id} porPagina={100} onLinha={(m: any) => nav(`/militar/${m.id}`)}
          linhaClasse={(m: any) => (m._conf ? 'conferida' : '')}
          colunas={[
            { id: 'sel', ordenavel: false, largura: '28px',
              titulo: <input type="checkbox" aria-label="Selecionar todos" checked={visiveis.length > 0 && visiveis.every((m) => sel.has(m.id))}
                onChange={(e) => setSel(e.target.checked ? new Set(visiveis.map((m) => m.id)) : new Set())} />,
              render: (m: any) => <span onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Selecionar" checked={sel.has(m.id)}
                onChange={() => setSel((s) => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })} /></span> },
            { id: 'posto_completo', titulo: 'Posto', valor: (m: any) => m.posto_ordem },
            { id: 'nome', titulo: 'Nome', render: (m: any) => <strong>{m.nome}</strong> },
            { id: 'secao_nome', titulo: 'Seção' },
            { id: 'atividade', titulo: 'Atividade', render: (m: any) => ATIVIDADE[m.atividade] || <Badge tom="amarelo">informar</Badge> },
            { id: 'hoje', titulo: 'Hoje', render: situacaoHoje },
            { id: 'pend', titulo: 'Falta no cadastro', ordenavel: false, render: (m: any) => (m.pendencias?.length ? <span className="nota">{m.pendencias.join(', ')}</span> : <Badge tom="verde">completo</Badge>) },
            { id: 'mud', titulo: 'Mudou', ordenavel: false, render: (m: any) => <span className="chips">{m._mud.map((x: string) => <Badge key={x} tom="azul">{x}</Badge>)}</span> },
            { id: 'conf', titulo: 'Conferido', valor: (m: any) => (m._conf ? 1 : 0),
              render: (m: any) => <span onClick={(e) => e.stopPropagation()}>{m._conf
                ? <button className="link" title={`em ${fmtDataHora(m._conf.conferido_em)} — clique para desfazer`} onClick={() => conferir([m.id], false)}>✓ {fmtData(m._conf.conferido_em)}</button>
                : <Botao pequeno onClick={() => conferir([m.id])}>Conferir</Botao>}</span> },
          ]} />
      )}

      <ConfirmarEntrega aberto={entregar} onFechar={() => setEntregar(false)} ome={ome} sigla={sigla} competencia={competencia}
        faltam={total - nConf} total={total} onFeito={() => { setEntregar(false); recarregar(); }} />
      {planilha && dom && (
        <PreviaPlanilha arquivo={planilha} onFechar={() => setPlanilha(null)} ome={ome} competencia={competencia} dom={dom} lista={lista}
          onFeito={() => { setPlanilha(null); recarregar(); }} />
      )}
    </div>
  );
}

// ---------------- confirmar entrega ----------------
export function ConfirmarEntrega({ aberto, onFechar, ome, sigla, competencia, faltam, total, onFeito }: {
  aberto: boolean; onFechar: () => void; ome: number; sigla: string; competencia: string; faltam: number; total: number; onFeito: () => void;
}) {
  const toast = useToast();
  const [just, setJust] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const enviar = async () => {
    setErro(null);
    if (faltam > 0 && !just.trim()) return setErro('Informe a justificativa para os militares não conferidos.');
    try { await rpc('confirmar_entrega', { p_ome: ome, p_competencia: competencia, p_observacao: just.trim() || null }); toast('Entrega confirmada.'); onFeito(); }
    catch (e) { setErro(msgErro(e)); }
  };
  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={`Confirmar entrega · ${sigla} · ${fmtCompetencia(competencia)}`}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={enviar}>Confirmo</Botao></>}>
      <p>Declaro que os dados do efetivo do <strong>{sigla}</strong> ({total} militares) estão atualizados para a competência <strong>{fmtCompetencia(competencia)}</strong>: lotação, afastamentos, situações funcionais, punições, escolaridade e contatos.</p>
      {faltam > 0 && <>
        <Aviso tom="alerta">{faltam} militar(es) ainda não foram conferidos. Para confirmar mesmo assim, informe o motivo.</Aviso>
        <Campo rotulo="Justificativa" largura="inteira"><textarea rows={3} value={just} onChange={(e) => setJust(e.target.value)} placeholder="ex.: 3 militares em curso fora do estado; dados conferidos com a seção de origem" /></Campo>
      </>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

// ---------------- prévia da planilha enviada ----------------
type Mudanca = { militar: any; campo: string; antes: any; depois: any };
function PreviaPlanilha({ arquivo, onFechar, ome, competencia, dom, lista, onFeito }: {
  arquivo: File; onFechar: () => void; ome: number; competencia: string; dom: Dominios; lista: any[]; onFeito: () => void;
}) {
  const toast = useToast();
  const [conferir, setConferir] = useState(true);
  const [aplicando, setAplicando] = useState(false);
  const analise = useConsulta(`planilha|${arquivo.name}|${arquivo.lastModified}|${arquivo.size}`, async () => {
    const { lerPlanilhaOme } = await import('../lib/excel');
    const lido = await lerPlanilhaOme(arquivo);
    const completos = await carregarEfetivo(ome, 'ATIVO', 'id,email,telefone2,endereco,nome_guerra');
    const extra = new Map(completos.map((c: any) => [c.id, c]));
    const porMat = new Map(lista.map((m: any) => [m.matricula, { ...m, ...(extra.get(m.id) || {}) }]));
    const secoes = secoesDa(dom, ome);
    const erros: { linha: string; msg: string }[] = [];
    const mudancas: Mudanca[] = [];
    const lote: any[] = []; const formacoes: any[] = []; const afast: any[] = [];
    const vistos = new Set<string>();
    for (const r of lido.militares) {
      const m: any = porMat.get(r.matricula);
      if (!m) { erros.push({ linha: `Militares, linha ${r._linha}`, msg: `Matrícula ${r.matricula} não está no efetivo ativo do ${lista[0]?.ome_sigla || 'OME'}` }); continue; }
      vistos.add(r.matricula);
      const alt: any = { id: m.id };
      // célula idêntica ao que está no sistema = sem mudança (evita "mudanças" falsas por formatação de dados antigos)
      const comparar = (campo: string, rotulo: string, antes: any, depois: any, valorBanco: any = depois, bruto?: any) => {
        if (bruto !== undefined && String(bruto ?? '').trim() === String(antes ?? '').trim()) return;
        if ((antes ?? '') !== (depois ?? '')) { alt[campo] = valorBanco; mudancas.push({ militar: m, campo: rotulo, antes, depois }); }
      };
      const telefone = (campo: 'telefone1' | 'telefone2', rotulo: string) => {
        const bruto = String(r[campo] ?? '').trim(); const antes = m[campo] || '';
        if (bruto === antes.trim()) return;
        if (bruto && (/[a-zA-Z]/.test(bruto) || bruto.replace(/\D/g, '').length < 10)) { erros.push({ linha: `Militares, linha ${r._linha}`, msg: `${rotulo} "${bruto}" inválido (use DDD + número)` }); return; }
        comparar(campo, rotulo, antes, bruto ? mascaraTelefone(bruto) : '');
      };
      if ('nome_guerra' in r) comparar('nome_guerra', 'Nome de guerra', m.nome_guerra || '', r.nome_guerra.toUpperCase(), undefined, r.nome_guerra);
      if ('secao' in r) {
        const s = secoes.find((x) => igual(x.nome, r.secao));
        if (r.secao && !s) erros.push({ linha: `Militares, linha ${r._linha}`, msg: `Seção "${r.secao}" não existe na OME` });
        else comparar('secao_id', 'Seção', m.secao_nome || '', s?.nome || '', s?.id ?? '');
      }
      if ('atividade' in r) {
        const a = r.atividade.toUpperCase().startsWith('OPER') ? 'OPERACIONAL' : r.atividade.toUpperCase().startsWith('ADM') ? 'ADMINISTRATIVO' : r.atividade ? null : '';
        if (a === null) erros.push({ linha: `Militares, linha ${r._linha}`, msg: `Atividade "${r.atividade}" inválida` });
        else comparar('atividade', 'Atividade', ATIVIDADE[m.atividade] || '', ATIVIDADE[a] || '', a);
      }
      if ('email' in r) {
        const e = r.email.toLowerCase().replace(/\s/g, '');
        if (e && !EMAIL_RE.test(e)) erros.push({ linha: `Militares, linha ${r._linha}`, msg: `E-mail "${r.email}" inválido` });
        else comparar('email', 'E-mail', m.email || '', e, undefined, r.email);
      }
      if ('telefone1' in r) telefone('telefone1', 'Telefone');
      if ('telefone2' in r) telefone('telefone2', 'Telefone 2');
      if ('endereco' in r) comparar('endereco', 'Endereço', m.endereco || '', r.endereco, undefined, r.endereco);
      if ('ano_ingresso' in r) {
        const a = r.ano_ingresso ? Number(r.ano_ingresso) : null;
        if (a !== null && (isNaN(a) || a < 1950 || a > 2100)) erros.push({ linha: `Militares, linha ${r._linha}`, msg: `Ano de ingresso "${r.ano_ingresso}" inválido` });
        else comparar('ano_ingresso', 'Ano de ingresso', m.ano_ingresso ? String(m.ano_ingresso) : '', a ? String(a) : '', a ?? '');
      }
      if (r.nova_formacao_nivel || r.nova_formacao_area) {
        const n = dom.niveis.find((x) => igual(x.nome, r.nova_formacao_nivel));
        if (!n) erros.push({ linha: `Militares, linha ${r._linha}`, msg: 'Nova formação sem nível válido' });
        else { formacoes.push({ militar_id: m.id, nivel_id: n.id, area: r.nova_formacao_area || null }); mudancas.push({ militar: m, campo: 'Nova formação', antes: '', depois: `${n.nome}${r.nova_formacao_area ? ' — ' + r.nova_formacao_area : ''}` }); }
      }
      lote.push(alt);
    }
    const ausentes = lista.filter((m: any) => !vistos.has(m.matricula));
    for (const a of lido.afastamentos) {
      const m: any = porMat.get(a.matricula);
      const t = dom.tiposAfast.find((x) => igual(x.nome, a.tipo));
      const local = `Afastamentos, linha ${a.linha}`;
      if (!m) { erros.push({ linha: local, msg: `Matrícula ${a.matricula || '(vazia)'} não está no efetivo da OME` }); continue; }
      if (!t) { erros.push({ linha: local, msg: `Tipo "${a.tipo}" inválido` }); continue; }
      if (t.codigo === 'FERIAS') { erros.push({ linha: local, msg: 'Férias são lançadas no módulo Férias (PAF), não pela planilha' }); continue; }
      if (!a.inicio) { erros.push({ linha: local, msg: 'Data de início inválida' }); continue; }
      if (!a.dias || a.dias < 1 || a.dias > 3650) { erros.push({ linha: local, msg: 'Quantidade de dias inválida' }); continue; }
      afast.push({ militar_id: m.id, tipo_id: t.id, data_inicio: a.inicio, dias: a.dias, processo_sei: a.processo || null, observacao: a.observacao || null, _m: m, _t: t.nome });
    }
    return { mudancas, erros, lote, formacoes, afast, ausentes, linhas: lido.militares.length };
  }, 600_000);

  const a = analise.dados;
  const aplicar = async () => {
    if (!a) return;
    setAplicando(true);
    try {
      const r = await rpc<any>('aplicar_lote', {
        p_ome: ome, p_militares: a.lote.filter((x: any) => Object.keys(x).length > 1 || conferir), p_formacoes: a.formacoes,
        p_afastamentos: a.afast.map(({ _m, _t, ...x }: any) => x), p_conferir_competencia: conferir ? competencia : null,
      });
      toast(`Gravado: ${r.militares} ficha(s), ${r.afastamentos} afastamento(s), ${r.formacoes} formação(ões)${r.conferidos ? `, ${r.conferidos} conferido(s)` : ''}.`);
      onFeito();
    } catch (e) { toast(msgErro(e), 'erro'); } finally { setAplicando(false); }
  };
  return (
    <Modal aberto largo titulo={`Prévia da planilha · ${arquivo.name}`} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={!a || aplicando || (!a.mudancas.length && !a.afast.length && !conferir)} onClick={aplicar}>{aplicando ? 'Gravando…' : 'Gravar alterações'}</Botao></>}>
      {analise.erro && <Aviso tom="erro">{analise.erro}</Aviso>}
      {!a ? <Carregando texto="Lendo a planilha…" /> : <>
        <div className="kpis">
          <Kpi rotulo="Linhas lidas" valor={a.linhas} />
          <Kpi rotulo="Alterações" valor={a.mudancas.length} tom={a.mudancas.length ? 'ok' : undefined} />
          <Kpi rotulo="Afastamentos novos" valor={a.afast.length} />
          <Kpi rotulo="Erros (serão ignorados)" valor={a.erros.length} tom={a.erros.length ? 'alerta' : undefined} />
        </div>
        {a.ausentes.length > 0 && <Aviso tom="alerta">{a.ausentes.length} militar(es) do efetivo não estão na planilha e não serão alterados: {a.ausentes.slice(0, 10).map((m: any) => `${m.posto_completo} ${m.nome}`).join('; ')}{a.ausentes.length > 10 ? '…' : ''}. Se saíram da OME, registre a transferência ou peça o desligamento à DGP.</Aviso>}
        {a.erros.length > 0 && (
          <details open><summary><strong>Erros ({a.erros.length})</strong></summary>
            <table className="tabela compacta"><tbody>{a.erros.map((e: any, i: number) => <tr key={i}><td>{e.linha}</td><td>{e.msg}</td></tr>)}</tbody></table>
          </details>
        )}
        <details open><summary><strong>Alterações ({a.mudancas.length})</strong></summary>
          {a.mudancas.length ? (
            <table className="tabela compacta"><thead><tr><th>Militar</th><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
              <tbody>{a.mudancas.map((x: Mudanca, i: number) => <tr key={i}><td>{x.militar.posto_completo} {x.militar.nome}</td><td>{x.campo}</td><td className="antes">{String(x.antes || '∅')}</td><td className="depois">{String(x.depois || '∅')}</td></tr>)}</tbody></table>
          ) : <p className="nota">Nenhuma mudança nos dados dos militares.</p>}
        </details>
        {a.afast.length > 0 && (
          <details open><summary><strong>Afastamentos a lançar ({a.afast.length})</strong></summary>
            <table className="tabela compacta"><thead><tr><th>Militar</th><th>Tipo</th><th>Início</th><th>Dias</th><th>Processo</th></tr></thead>
              <tbody>{a.afast.map((x: any, i: number) => <tr key={i}><td>{x._m.posto_completo} {x._m.nome}</td><td>{x._t}</td><td>{fmtData(x.data_inicio)}</td><td>{x.dias}</td><td>{x.processo_sei}</td></tr>)}</tbody></table>
            <p className="nota">Afastamentos idênticos (mesmo militar, tipo e início) já lançados são ignorados.</p>
          </details>
        )}
        <label className="check"><input type="checkbox" checked={conferir} onChange={(e) => setConferir(e.target.checked)} /> Marcar como conferidos os {a.lote.length} militares da planilha</label>
      </>}
    </Modal>
  );
}
