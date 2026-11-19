import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios } from '../lib/dominios';
import { invalidar, useConsulta } from '../lib/consulta';
import { mapaRegioes } from '../lib/regioes';
import { nomeMunicipio } from '../lib/municipios';
import {
  Assunto, Campo, Filtro, OPS, Spec, VAZIO, aplicarFiltros, assuntos, campoDe, carregarAntiguidade, carregarMilitares,
  categoria, codificar, decodificar, descreverFiltro, enriquecer, exibirCategoria, filtroCompleto, linhaCasa, pivotar,
} from '../lib/consultaLivre';
import { Coluna, buscarTodos, exportarPdf, exportarXlsx, fmtCompetencia, fmtData, hojeISO, msgErro } from '../lib/util';
import { Abas, Aviso, Badge, Botao, Campo as CampoUi, Cartao, Carregando, Modal, Tabela, Vazio, useToast } from '../components/ui';
import MapaPE from '../components/MapaPE';

// ---------------------------------------------------------------------
// Perguntas prontas (servem de ponto de partida; tudo pode ser ajustado)
// ---------------------------------------------------------------------
const ANO = new Date().getFullYear();
const ATIVOS: Filtro = { campo: 'situacao', op: 'in', valor: ['Ativo'] };
type Pronta = { id: string; titulo: string; spec: Spec; requer?: string };
const PRONTAS: Pronta[] = [
  { id: 'ome_posto', titulo: 'Efetivo por OME e posto/graduação', spec: { assunto: 'militares', filtros: [ATIVOS], modo: 'E', linhas: 'ome', colunas: 'posto', medida: 'qtd' } },
  { id: 'regiao_quadro', titulo: 'Efetivo por região, separando QOC, QOA e praças', spec: { assunto: 'militares', filtros: [ATIVOS], modo: 'E', linhas: 'regiao', colunas: 'quadro', medida: 'qtd' } },
  { id: 'qoc_qoa', titulo: 'Oficiais QOC × QOA por posto', spec: { assunto: 'militares', filtros: [ATIVOS, { campo: 'circulo', op: 'in', valor: ['Oficial'] }], modo: 'E', linhas: 'posto', colunas: 'quadro', medida: 'qtd' } },
  { id: 'sexo_omes', titulo: 'Militares masculinos e femininos por OME', requer: 'sexo', spec: { assunto: 'militares', filtros: [ATIVOS], modo: 'E', linhas: 'ome', colunas: 'sexo', medida: 'qtd' } },
  { id: 'disponiveis', titulo: 'Disponíveis × afastados hoje, por região', spec: { assunto: 'militares', filtros: [ATIVOS], modo: 'E', linhas: 'regiao', colunas: 'disponivel', medida: 'qtd', pct: 'linha' } },
  { id: 'afast_tipo', titulo: 'Afastamentos em curso hoje, por tipo e região', spec: { assunto: 'afastamentos', filtros: [{ campo: 'vigente', op: 'abrange' }], modo: 'E', linhas: 'tipo', colunas: 'm.regiao', medida: 'pessoas' } },
  { id: 'ingresso_paf', titulo: 'Ingressantes de um ano e situação no PAF', spec: { assunto: 'militares', filtros: [ATIVOS, { campo: 'ano_ingresso', op: 'eq', valor: ANO - 4 }], modo: 'E', linhas: 'paf_situacao', medida: 'qtd', exercicio: ANO - 1 } },
  { id: 'aderencia', titulo: 'Aderência ao PAF: gozo no mês planejado, por região', spec: { assunto: 'ferias', filtros: [{ campo: 'exercicio', op: 'in', valor: [String(ANO - 1)] }, { campo: 'status', op: 'in', valor: ['gozada'] }], modo: 'E', linhas: 'm.regiao', colunas: 'aderencia', medida: 'qtd', pct: 'linha' } },
  { id: 'ferias_mes', titulo: 'Férias por mês de início e região', spec: { assunto: 'ferias', filtros: [{ campo: 'exercicio', op: 'in', valor: [String(ANO)] }], modo: 'E', linhas: 'mes', colunas: 'm.regiao', medida: 'pessoas' } },
  { id: 'mov_ano', titulo: `Movimentações de ${ANO} por OME de destino`, spec: { assunto: 'movimentacoes', filtros: [{ campo: 'ano', op: 'eq', valor: ANO }], modo: 'E', linhas: 'destino', colunas: 'tipo', medida: 'qtd' } },
  { id: 'tempo_posto', titulo: 'Tempo médio de serviço por posto/graduação', spec: { assunto: 'militares', filtros: [ATIVOS], modo: 'E', linhas: 'posto', medida: 'media', campoMedida: 'tempo_servico' } },
  { id: 'faixa_etaria', titulo: 'Faixa etária por posto/graduação', requer: 'data_nascimento', spec: { assunto: 'militares', filtros: [ATIVOS], modo: 'E', linhas: 'posto', colunas: 'faixa_etaria', medida: 'qtd' } },
  { id: 'comportamento', titulo: 'Comportamento das praças por OME', requer: 'comportamento', spec: { assunto: 'militares', filtros: [ATIVOS, { campo: 'circulo', op: 'in', valor: ['Praça'] }], modo: 'E', linhas: 'ome', colunas: 'comportamento', medida: 'qtd' } },
  { id: 'cedidos', titulo: 'Militares cedidos a outros órgãos', requer: 'orgao_cessao', spec: { assunto: 'militares', filtros: [ATIVOS, { campo: 'cedido', op: 'sim' }], modo: 'E', linhas: 'orgao_cessao', colunas: 'posto', medida: 'qtd' } },
  { id: 'tempo_no_posto', titulo: 'Tempo médio no posto atual', requer: 'data_promocao', spec: { assunto: 'militares', filtros: [ATIVOS], modo: 'E', linhas: 'posto_quadro', medida: 'media', campoMedida: 'tempo_posto' } },
  { id: 'cadastro', titulo: 'Cadastros incompletos por OME', spec: { assunto: 'militares', filtros: [ATIVOS, { campo: 'completude', op: 'lt', valor: 100 }], modo: 'E', linhas: 'ome', medida: 'qtd' } },
];
const PADRAO: Spec = PRONTAS[0].spec;

const fmtNum = (v: number | null | undefined, media = false) =>
  v == null ? '—' : media ? v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : v.toLocaleString('pt-BR');
const CORES = ['var(--azul)', 'var(--verde)', 'var(--amarelo)', 'var(--roxo)', 'var(--marca)', 'var(--vermelho)', 'var(--texto-2)', 'var(--texto-3)'];

export default function Consultas() {
  const { gestaoGlobal, admin, ctx } = useAuth();
  const dom = useDominios();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [spec, setSpecState] = useState<Spec>(() => decodificar(params.get('q')) || PADRAO);
  const [visao, setVisao] = useState<'tabela' | 'grafico' | 'mapa' | 'lista'>('tabela');
  const [drill, setDrill] = useState<{ l?: string | null; c?: string | null; mun?: number | null } | null>(null);
  const [salvar, setSalvar] = useState(false);
  const setSpec = (s: Spec) => { setSpecState(s); setDrill(null); };

  useEffect(() => { setParams({ q: codificar(spec) }, { replace: true }); }, [spec]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- dados ----------------
  const hoje = hojeISO();
  const ref = spec.assunto === 'militares' ? spec.referencia || 'hoje' : 'hoje';
  const fech = useConsulta('cl:fechamentos', async () => {
    const { data } = await supabase.from('fechamento_mensal').select('competencia').order('competencia', { ascending: false });
    return (data || []).map((x: any) => x.competencia as string);
  }, 300_000);
  const exercicios = useConsulta('cl:exercicios', async () => {
    const { data } = await supabase.from('ferias_exercicio').select('ano').order('ano', { ascending: false });
    return (data || []).map((x: any) => x.ano as number);
  }, 300_000);
  const exercicio = spec.exercicio ?? exercicios.dados?.find((a) => a <= ANO - 1) ?? exercicios.dados?.[0] ?? null;
  const lista = useMemo(() => assuntos(exercicio), [exercicio]);
  const assunto = lista.find((a) => a.id === spec.assunto) || lista[0];
  const usados = [spec.linhas, spec.colunas, spec.campoMedida, ...spec.filtros.map((f) => f.campo)];
  const precisaPaf = spec.assunto === 'militares' && usados.some((c) => c?.startsWith('paf_'));

  const mil = useConsulta(`cl:mil:${ref}`, () => carregarMilitares(ref), 300_000);
  const ant = useConsulta(ref === 'hoje' ? 'cl:ant' : null, carregarAntiguidade, 300_000);
  const fer = useConsulta(spec.assunto === 'ferias' || precisaPaf ? 'cl:ferias' : null, () => buscarTodos(() => supabase.from('v_ferias')
    .select('id,exercicio,militar_id,civil_id,pessoa_id,tipo_pessoa,matricula,nome,posto_completo,ome_id,ome_sigla,data_inicio,data_fim,dias,dias_efetivos,previsto_inicio,data_estimada,situacao,status,origem,excecao,parcela').order('id')), 300_000);
  const afa = useConsulta(spec.assunto === 'afastamentos' ? 'cl:afast' : null, () => buscarTodos(() => supabase.from('v_afastamento')
    .select('id,militar_id,tipo_codigo,tipo_nome,data_inicio,dias,data_fim,processo_sei,status,matricula,nome,posto_completo,ome_id,ome_sigla,secao_nome,ferias_periodo_id').order('id')), 300_000);
  const mov = useConsulta(spec.assunto === 'movimentacoes' ? 'cl:mov' : null, () => buscarTodos(() => supabase.from('v_movimentacao')
    .select('id,militar_id,militar_matricula,militar_nome,militar_posto,tipo,ome_origem_id,ome_destino_id,situacao_nova,data,documento,ome_origem_sigla,ome_destino_sigla').order('id')), 300_000);
  const salvas = useConsulta('cl:salvas', async () => {
    const { data, error } = await supabase.from('consulta_salva').select('*').order('nome');
    if (error) throw error;
    return data as any[];
  }, 60_000);

  const regiao = useMemo(() => mapaRegioes(dom), [dom]);
  const militares = useMemo(() => {
    if (!dom || !mil.dados) return null;
    return enriquecer(mil.dados, { dom, regiao, hoje }, ref === 'hoje' ? ant.dados || null : null, ref);
  }, [dom, mil.dados, ant.dados, ref, regiao, hoje]);
  const porId = useMemo(() => new Map((militares || []).map((m) => [m.id, m])), [militares]);

  const linhasBase = useMemo(() => {
    if (!dom || !militares) return null;
    const semCad = (o: { ome_id?: number | null; ome_sigla?: string | null; posto_completo?: string | null }) => enriquecer([{ id: null, ...o }], { dom, regiao, hoje }, null, 'hoje')[0];
    switch (assunto.id) {
      case 'militares': {
        const paf = new Map<string, any[]>();
        if (precisaPaf) for (const f of fer.dados || []) if (f.militar_id && f.exercicio === exercicio) {
          const l = paf.get(f.militar_id) || []; l.push(f); paf.set(f.militar_id, l);
        }
        return militares.map((m) => { const r: any = { ...m, _paf: paf.get(m.id) }; r.m = r; return r; });
      }
      case 'afastamentos':
        return afa.dados ? afa.dados.map((a) => ({ ...a, m: porId.get(a.militar_id) || semCad(a) })) : null;
      case 'ferias':
        return fer.dados ? fer.dados.map((f) => ({ ...f, m: (f.militar_id && porId.get(f.militar_id)) || semCad({ ome_id: f.ome_id, ome_sigla: f.ome_sigla, posto_completo: f.posto_completo }) })) : null;
      case 'movimentacoes': {
        if (!mov.dados) return null;
        const ord = new Map(dom.omes.map((o) => [o.id, o.ordem]));
        return mov.dados.map((x) => ({
          ...x, m: porId.get(x.militar_id) || semCad({ ome_id: x.ome_destino_id, ome_sigla: x.ome_destino_sigla, posto_completo: x.militar_posto }),
          _ordOrig: ord.get(x.ome_origem_id), _ordDest: ord.get(x.ome_destino_id),
          _regOrig: x.ome_origem_id ? regiao.de(x.ome_origem_id).rotulo : null, _regDest: x.ome_destino_id ? regiao.de(x.ome_destino_id).rotulo : null,
        }));
      }
    }
    return null;
  }, [dom, militares, assunto.id, afa.dados, fer.dados, mov.dados, porId, regiao, hoje, precisaPaf, exercicio]);

  const campos = useMemo(() => assunto.campos.filter((c) => !c.disponivel || (linhasBase && c.disponivel(linhasBase))), [assunto, linhasBase]);
  const filtradas = useMemo(() => (linhasBase ? aplicarFiltros(linhasBase, { ...assunto, campos }, spec, hoje) : null), [linhasBase, assunto, campos, spec, hoje]);
  const pivo = useMemo(() => (filtradas ? pivotar(filtradas, { ...assunto, campos }, spec) : null), [filtradas, assunto, campos, spec]);
  const doDrill = useMemo(() => {
    if (!filtradas) return null;
    if (!drill) return filtradas;
    return filtradas.filter((r) => linhaCasa({ ...assunto, campos }, spec, r, drill.l ?? null, drill.c ?? null) && (drill.mun == null || r.m?._mun === drill.mun));
  }, [filtradas, drill, assunto, campos, spec]);

  const carregando = !dom || mil.carregando && !mil.dados || !linhasBase;
  const erro = mil.erro || fer.erro || afa.erro || mov.erro;
  const a2: Assunto = { ...assunto, campos };
  const cl = campoDe(a2, spec.linhas), cc = campoDe(a2, spec.colunas), cm = campoDe(a2, spec.campoMedida);
  const media = spec.medida === 'media';
  const unidade = spec.medida === 'pessoas' ? 'pessoas' : spec.medida === 'soma' ? `(soma de ${cm?.rotulo || '—'})` : spec.medida === 'media' ? `(média de ${cm?.rotulo || '—'})` : assunto.unidade;
  const camposAusentes = usados.filter((c) => c && !campoDe(a2, c));

  // ---------------- ações ----------------
  const abrir = (s: Spec) => { setSpec({ ...PADRAO, linhas: null, colunas: null, campoMedida: null, pct: 'nenhum', ...s, filtros: s.filtros || [] }); setVisao('tabela'); window.scrollTo({ top: 0 }); };
  const copiarLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); toast('Link da consulta copiado. Quem abrir verá só o que já pode ver.'); }
    catch { toast('Não foi possível copiar: copie o endereço do navegador.', 'erro'); }
  };
  const exportarPivo = async () => {
    if (!pivo) return;
    const linhas = (cl ? pivo.linhas : ['Total']).map((l) => ({ l }));
    const val = (l: string, c: string | null) => (cl ? (c == null ? pivo.totLinha(l) : pivo.celula(l, c)) : c == null ? pivo.total : pivo.totColuna(c));
    const cols: Coluna[] = [
      { titulo: cl?.rotulo || 'Resultado', valor: (r: any) => exibirCategoria(cl, r.l), largura: 28 },
      ...pivo.colunas.map((c) => ({ titulo: exibirCategoria(cc, c), valor: (r: any) => val(r.l, c), largura: 12 })),
      { titulo: 'Total', valor: (r: any) => val(r.l, null), largura: 12 },
    ];
    await exportarXlsx('consulta', resumo(spec, a2), cols, linhas);
  };

  if (erro) return <div className="pagina"><Aviso tom="erro">{erro}</Aviso></div>;

  return (
    <div className="pagina consultas">
      <div className="pagina-cab">
        <div>
          <h1>Consultas</h1>
          <p className="sub">Monte qualquer pergunta sobre o efetivo com filtros e agrupamentos. Você vê apenas o que seu acesso já permite.</p>
        </div>
        <div className="acoes">
          <Botao onClick={copiarLink}>Copiar link</Botao>
          <Botao onClick={() => setSalvar(true)}>Salvar consulta</Botao>
        </div>
      </div>

      <div className="consultas-grade">
        <aside>
          <Cartao titulo="Perguntas prontas">
            <ul className="lista-perguntas">
              {PRONTAS.map((p) => {
                const indisp = !!p.requer && !!militares && !militares.some((m) => m[p.requer!] != null);
                return (
                  <li key={p.id}>
                    <button className="link" disabled={!!indisp} onClick={() => abrir(p.spec)} title={indisp ? (p.requer === 'comportamento' ? 'Disponível depois de cadastrar os comportamentos publicados' : 'Disponível depois da recarga da base (versão 1.4)') : undefined}>{p.titulo}</button>
                    {indisp && <span className="nota"> · {p.requer === 'comportamento' ? 'após cadastrar o comportamento' : 'após a recarga'}</span>}
                  </li>
                );
              })}
            </ul>
          </Cartao>
          <Salvas lista={salvas.dados || []} meuId={ctx?.id} admin={admin} onAbrir={(s) => abrir(s)}
            onExcluir={async (id) => {
              const { error } = await supabase.from('consulta_salva').delete().eq('id', id);
              if (error) toast(msgErro(error), 'erro'); else { invalidar('cl:salvas'); toast('Consulta excluída.'); }
            }} />
        </aside>

        <div className="consultas-principal">
          <Cartao>
            <div className="consulta-linha">
              <CampoUi rotulo="Assunto">
                <select value={assunto.id} onChange={(e) => {
                  const novoA = lista.find((x) => x.id === e.target.value)!;
                  setSpec({ assunto: novoA.id, filtros: novoA.id === 'militares' ? [ATIVOS] : [], modo: 'E', linhas: novoA.id === 'militares' ? 'ome' : novoA.campos[0].id, colunas: null, medida: novoA.pessoas ? 'qtd' : 'qtd', exercicio: spec.exercicio });
                }}>
                  {lista.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
                </select>
              </CampoUi>
              {assunto.id === 'militares' && (
                <CampoUi rotulo="Data de referência" dica="Meses fechados guardam a fotografia do efetivo">
                  <select value={ref} onChange={(e) => setSpec({ ...spec, referencia: e.target.value })}>
                    <option value="hoje">Hoje</option>
                    {(fech.dados || []).map((c) => <option key={c} value={c}>Fechamento de {fmtCompetencia(c)}</option>)}
                  </select>
                </CampoUi>
              )}
              {(assunto.id === 'militares') && (exercicios.dados?.length || 0) > 0 && (
                <CampoUi rotulo="Exercício do PAF" dica="Usado nos campos de férias do militar">
                  <select value={exercicio ?? ''} onChange={(e) => setSpec({ ...spec, exercicio: Number(e.target.value) })}>
                    {(exercicios.dados || []).map((a) => <option key={a} value={a}>PAF {a}</option>)}
                  </select>
                </CampoUi>
              )}
            </div>
            <p className="nota">{assunto.descricao}</p>

            <h4>Filtros</h4>
            <Filtros spec={spec} assunto={a2} base={linhasBase || []} onChange={setSpec} hoje={hoje} />

            <h4>Resultado</h4>
            <div className="consulta-linha">
              <CampoUi rotulo="Agrupar em linhas por">
                <SelCampo campos={campos} valor={spec.linhas} vazio="(sem agrupamento)" agrupavel onChange={(v) => setSpec({ ...spec, linhas: v })} />
              </CampoUi>
              <CampoUi rotulo="e em colunas por">
                <SelCampo campos={campos} valor={spec.colunas} vazio="(nenhum)" agrupavel onChange={(v) => setSpec({ ...spec, colunas: v })} />
              </CampoUi>
              <CampoUi rotulo="Contar">
                <select value={spec.medida === 'soma' || spec.medida === 'media' ? `${spec.medida}:${spec.campoMedida || ''}` : spec.medida}
                  onChange={(e) => {
                    const [m, c] = e.target.value.split(':');
                    setSpec({ ...spec, medida: m as any, campoMedida: c || null, pct: m === 'media' ? 'nenhum' : spec.pct });
                  }}>
                  <option value="qtd">Quantidade de {assunto.unidade}</option>
                  {assunto.pessoas && <option value="pessoas">Pessoas distintas</option>}
                  {campos.filter((c) => c.medida).map((c) => <option key={'s' + c.id} value={`soma:${c.id}`}>Soma de {c.rotulo}</option>)}
                  {campos.filter((c) => c.medida).map((c) => <option key={'m' + c.id} value={`media:${c.id}`}>Média de {c.rotulo}</option>)}
                </select>
              </CampoUi>
              {!media && (
                <CampoUi rotulo="Percentual">
                  <select value={spec.pct || 'nenhum'} onChange={(e) => setSpec({ ...spec, pct: e.target.value as any })}>
                    <option value="nenhum">Sem percentual</option>
                    <option value="total">% do total</option>
                    {cc && <option value="linha">% da linha</option>}
                    {cc && cl && <option value="coluna">% da coluna</option>}
                  </select>
                </CampoUi>
              )}
            </div>
          </Cartao>

          {camposAusentes.length > 0 && <Aviso tom="alerta">Algum campo desta consulta ainda não está disponível nos dados (por exemplo, sexo e nascimento entram com a recarga da versão 1.4; o comportamento, quando for cadastrado). Ele foi ignorado.</Aviso>}

          <Cartao titulo={carregando ? 'Carregando…' : (
            <span>{fmtNum(pivo?.total, media)} <span className="nota">{unidade}</span>
              {spec.filtros.filter((f) => filtroCompleto(f, campoDe(a2, f.campo))).length > 0 && <span className="nota"> · {spec.filtros.filter((f) => filtroCompleto(f, campoDe(a2, f.campo))).map((f) => descreverFiltro(f, campoDe(a2, f.campo))).join(spec.modo === 'OU' ? ' OU ' : '; ')}</span>}
            </span>
          )} acoes={!carregando && (
            <div className="acoes">
              <Botao pequeno onClick={exportarPivo}>Exportar tabela</Botao>
            </div>
          )}>
            {carregando ? <Carregando /> : (
              <>
                <Abas ativa={visao} onChange={(v) => setVisao(v as any)} abas={[
                  { id: 'tabela', rotulo: 'Tabela' }, { id: 'grafico', rotulo: 'Gráfico' },
                  { id: 'mapa', rotulo: 'Mapa' }, { id: 'lista', rotulo: `Lista nominal${drill ? ' (recorte)' : ''}` },
                ]} />
                {visao === 'tabela' && pivo && <TabelaPivo pivo={pivo} spec={spec} cl={cl} cc={cc} media={media}
                  onCelula={(l, c) => { setDrill({ l, c }); setVisao('lista'); }} />}
                {visao === 'grafico' && pivo && <Grafico pivo={pivo} cl={cl} cc={cc} media={media} />}
                {visao === 'mapa' && filtradas && <MapaConsulta linhas={filtradas} spec={spec} rotulo={unidade}
                  onMunicipio={(c) => { setDrill({ mun: c }); setVisao('lista'); }} />}
                {visao === 'lista' && doDrill && <Lista linhas={doDrill} assunto={a2} spec={spec} drill={drill} cl={cl} cc={cc}
                  onLimparDrill={() => setDrill(null)} />}
              </>
            )}
          </Cartao>
        </div>
      </div>

      <SalvarModal aberto={salvar} onFechar={() => setSalvar(false)} spec={spec} assunto={a2} podeCompartilhar={gestaoGlobal} />
    </div>
  );
}

export function resumo(spec: Spec, a: Assunto) {
  const cl = campoDe(a, spec.linhas), cc = campoDe(a, spec.colunas);
  return `${a.rotulo}${cl ? ` por ${cl.rotulo.toLowerCase()}` : ''}${cc ? ` e ${cc.rotulo.toLowerCase()}` : ''}`;
}

// ---------------------------------------------------------------------
function SelCampo({ campos, valor, onChange, vazio, agrupavel }: { campos: Campo[]; valor?: string | null; onChange: (v: string | null) => void; vazio?: string; agrupavel?: boolean }) {
  const lista = agrupavel ? campos.filter((c) => c.tipo === 'lista' || c.tipo === 'bool' || (c.tipo === 'numero' && !c.medida) || c.id.endsWith('ano_ingresso')) : campos;
  const grupos = [...new Set(lista.map((c) => c.grupo))];
  return (
    <select value={valor || ''} onChange={(e) => onChange(e.target.value || null)}>
      {vazio && <option value="">{vazio}</option>}
      {grupos.map((g) => (
        <optgroup key={g} label={g}>
          {lista.filter((c) => c.grupo === g).map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function Filtros({ spec, assunto, base, onChange, hoje }: { spec: Spec; assunto: Assunto; base: any[]; onChange: (s: Spec) => void; hoje: string }) {
  const mudar = (i: number, f: Partial<Filtro>) => onChange({ ...spec, filtros: spec.filtros.map((x, j) => (j === i ? { ...x, ...f } : x)) });
  return (
    <div className="filtros-livres">
      {spec.filtros.map((f, i) => {
        const c = campoDe(assunto, f.campo);
        const ops = c ? OPS[c.tipo] : [];
        const def = ops.find((o) => o.op === f.op);
        return (
          <div key={i} className="filtro-livre">
            {i > 0 && <span className="filtro-conector">{spec.modo === 'OU' ? 'ou' : 'e'}</span>}
            <SelCampo campos={assunto.campos} valor={f.campo} onChange={(v) => {
              const nc = campoDe(assunto, v);
              if (nc) mudar(i, { campo: nc.id, op: OPS[nc.tipo][0].op, valor: undefined, valor2: undefined });
            }} />
            {c && (
              <select value={f.op} onChange={(e) => mudar(i, { op: e.target.value as any, valor: e.target.value === 'abrange' ? f.valor : (e.target.value === 'in' || e.target.value === 'nin') ? f.valor : undefined })}>
                {ops.map((o) => <option key={o.op} value={o.op}>{o.rotulo}</option>)}
              </select>
            )}
            {c && def && def.valores > 0 && (
              (f.op === 'in' || f.op === 'nin')
                ? <MultiSel campo={c} base={base} valor={f.valor || []} onChange={(v) => mudar(i, { valor: v })} />
                : c.tipo === 'data' || c.tipo === 'periodo'
                  ? <>
                      <input type="date" value={f.valor || (f.op === 'abrange' ? hoje : '')} onChange={(e) => mudar(i, { valor: e.target.value })} />
                      {def.valores === 2 && <><span className="nota">e</span><input type="date" value={f.valor2 || ''} onChange={(e) => mudar(i, { valor2: e.target.value })} /></>}
                    </>
                  : <>
                      <input type={c.tipo === 'numero' ? 'number' : 'text'} value={f.valor ?? ''} onChange={(e) => mudar(i, { valor: e.target.value })} className={c.tipo === 'numero' ? 'curto' : ''} />
                      {def.valores === 2 && <><span className="nota">e</span><input type="number" className="curto" value={f.valor2 ?? ''} onChange={(e) => mudar(i, { valor2: e.target.value })} /></>}
                    </>
            )}
            <button className="link perigo" title="Remover filtro" onClick={() => onChange({ ...spec, filtros: spec.filtros.filter((_, j) => j !== i) })}>remover</button>
          </div>
        );
      })}
      <div className="filtros-acoes">
        <Botao pequeno onClick={() => {
          const c = assunto.campos[0];
          onChange({ ...spec, filtros: [...spec.filtros, { campo: c.id, op: OPS[c.tipo][0].op }] });
        }}>+ Filtro</Botao>
        {spec.filtros.length > 1 && (
          <label className="nota">Combinar:{' '}
            <select value={spec.modo} onChange={(e) => onChange({ ...spec, modo: e.target.value as any })}>
              <option value="E">todas as condições (E)</option>
              <option value="OU">qualquer condição (OU)</option>
            </select>
          </label>
        )}
        {spec.filtros.length > 0 && <button className="link" onClick={() => onChange({ ...spec, filtros: [] })}>limpar filtros</button>}
      </div>
    </div>
  );
}

function MultiSel({ campo, base, valor, onChange }: { campo: Campo; base: any[]; valor: string[]; onChange: (v: string[]) => void }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  const opcoes = useMemo(() => {
    if (!aberto) return [];
    const m = new Map<string, { n: number; o: number | string }>();
    for (const r of base) {
      const k = categoria(campo, r);
      const x = m.get(k);
      if (x) x.n++; else m.set(k, { n: 1, o: campo.ordem ? campo.ordem(r) : campo.tipo === 'numero' ? Number(campo.valor(r)) : k });
    }
    valor.forEach((v) => { if (!m.has(v)) m.set(v, { n: 0, o: v }); });
    return [...m.entries()].sort((a, b) => (a[0] === VAZIO ? 1 : b[0] === VAZIO ? -1 : typeof a[1].o === 'number' && typeof b[1].o === 'number' ? a[1].o - b[1].o : String(a[1].o).localeCompare(String(b[1].o), 'pt-BR', { numeric: true })));
  }, [aberto, base, campo, valor]);
  const vis = opcoes.filter(([k]) => !busca || exibirCategoria(campo, k).toLowerCase().includes(busca.toLowerCase()));
  return (
    <div className="multisel" ref={ref}>
      <button type="button" className="multisel-botao" onClick={() => setAberto(!aberto)}>
        {valor.length === 0 ? 'escolher…' : valor.length <= 3 ? valor.map((v) => exibirCategoria(campo, v)).join(', ') : `${valor.length} selecionados`} ▾
      </button>
      {aberto && (
        <div className="multisel-caixa">
          <input autoFocus placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="multisel-acoes">
            <button className="link" onClick={() => onChange([...new Set([...valor, ...vis.map(([k]) => k)])])}>marcar {busca ? 'os visíveis' : 'todos'}</button>
            <button className="link" onClick={() => onChange([])}>limpar</button>
          </div>
          <div className="multisel-lista">
            {vis.map(([k, x]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={valor.includes(k)} onChange={(e) => onChange(e.target.checked ? [...valor, k] : valor.filter((v) => v !== k))} />
                <span>{exibirCategoria(campo, k)}</span><span className="nota">{x.n}</span>
              </label>
            ))}
            {!vis.length && <span className="nota">Nada encontrado.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function TabelaPivo({ pivo, spec, cl, cc, media, onCelula }: { pivo: ReturnType<typeof pivotar>; spec: Spec; cl: Campo | null; cc: Campo | null; media: boolean; onCelula: (l: string | null, c: string | null) => void }) {
  const pct = media ? 'nenhum' : spec.pct || 'nenhum';
  const fmt = (v: number | null, l: string | null, c: string | null) => {
    if (v == null) return '—';
    if (pct === 'nenhum') return fmtNum(v, media);
    const base = pct === 'total' ? pivo.total : pct === 'linha' ? (l == null ? pivo.total : pivo.totLinha(l)) : (c == null ? pivo.total : pivo.totColuna(c));
    const p = base ? (100 * v) / base : 0;
    return <>{fmtNum(v)} <span className="pct">{p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span></>;
  };
  if (!cl && !cc) {
    return (
      <div className="pivo-unico">
        <button className="kpi-botao" onClick={() => onCelula(null, null)}><span className="kpi-valor">{fmtNum(pivo.total, media)}</span><span className="nota">ver a lista</span></button>
        <p className="nota">Escolha um agrupamento acima para quebrar o resultado em linhas e colunas.</p>
      </div>
    );
  }
  const cols = cc ? pivo.colunas : [];
  const linhas = cl ? pivo.linhas : [null as any];
  const maxCel = Math.max(1, ...linhas.flatMap((l) => (cc ? cols.map((c) => Number(cl ? pivo.celula(l, c) : pivo.totColuna(c)) || 0) : [Number(pivo.totLinha(l)) || 0])));
  return (
    <div className="tabela-rolagem">
      <table className="tabela pivo">
        <thead>
          <tr>
            <th>{cl?.rotulo || ''}{cc ? <span className="nota"> × {cc.rotulo}</span> : ''}</th>
            {cols.map((c) => <th key={c} className="num">{exibirCategoria(cc, c)}</th>)}
            {(cc || cl) && <th className="num">{cc ? 'Total' : 'Resultado'}</th>}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l ?? 'total'}>
              <th>{cl ? exibirCategoria(cl, l) : 'Total'}</th>
              {cols.map((c) => {
                const v = cl ? pivo.celula(l, c) : pivo.totColuna(c);
                return (
                  <td key={c} className="num celula-pivo" onClick={() => v != null && onCelula(cl ? l : null, c)}
                    style={v ? { background: `color-mix(in srgb, var(--azul) ${Math.round(4 + 22 * (Number(v) / maxCel))}%, transparent)` } : undefined}>
                    {fmt(v, cl ? l : null, c)}
                  </td>
                );
              })}
              <td className="num total celula-pivo" onClick={() => onCelula(cl ? l : null, null)}>{fmt(cl ? pivo.totLinha(l) : pivo.total, cl ? l : null, null)}</td>
            </tr>
          ))}
        </tbody>
        {cl && (
          <tfoot>
            <tr>
              <th>Total</th>
              {cols.map((c) => <td key={c} className="num celula-pivo" onClick={() => onCelula(null, c)}>{fmt(pivo.totColuna(c), null, c)}</td>)}
              <td className="num total celula-pivo" onClick={() => onCelula(null, null)}>{fmt(pivo.total, null, null)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <p className="nota">Clique em qualquer número para ver quem está nele.</p>
    </div>
  );
}

function Grafico({ pivo, cl, cc, media }: { pivo: ReturnType<typeof pivotar>; cl: Campo | null; cc: Campo | null; media: boolean }) {
  if (!cl && !cc) return <Vazio>Escolha um agrupamento para ver o gráfico.</Vazio>;
  const eixo = cl ? pivo.linhas : pivo.colunas;
  const campoEixo = cl || cc;
  const total = (k: string) => Number(cl ? pivo.totLinha(k) : pivo.totColuna(k)) || 0;
  const linhas = eixo.slice(0, 40);
  const series = cl && cc && !media ? (() => {
    const ord = [...pivo.colunas].sort((a, b) => (Number(pivo.totColuna(b)) || 0) - (Number(pivo.totColuna(a)) || 0));
    return ord.length > 8 ? [...ord.slice(0, 7), '__outros'] : ord;
  })() : [];
  const max = Math.max(1, ...linhas.map(total));
  const seg = (l: string, s: string) => (s === '__outros'
    ? pivo.colunas.filter((c) => !series.includes(c)).reduce((a, c) => a + (Number(pivo.celula(l, c)) || 0), 0)
    : Number(pivo.celula(l, s)) || 0);
  return (
    <div className="grafico-barras">
      {series.length > 0 && (
        <div className="grafico-legenda">
          {series.map((s, i) => <span key={s}><i style={{ background: CORES[i % CORES.length] }} />{s === '__outros' ? 'Outros' : exibirCategoria(cc, s)}</span>)}
        </div>
      )}
      {linhas.map((l) => (
        <div key={l} className="gb-linha">
          <span className="gb-rotulo" title={exibirCategoria(campoEixo, l)}>{exibirCategoria(campoEixo, l)}</span>
          <span className="gb-barra">
            {series.length > 0
              ? series.map((s, i) => { const v = seg(l, s); return v ? <i key={s} title={`${s === '__outros' ? 'Outros' : exibirCategoria(cc, s)}: ${fmtNum(v)}`} style={{ width: `${(100 * v) / max}%`, background: CORES[i % CORES.length] }} /> : null; })
              : <i style={{ width: `${(100 * total(l)) / max}%`, background: CORES[0] }} />}
          </span>
          <span className="gb-valor">{fmtNum(total(l), media)}</span>
        </div>
      ))}
      {eixo.length > linhas.length && <p className="nota">Mostrando as 40 primeiras categorias de {eixo.length}.</p>}
    </div>
  );
}

function MapaConsulta({ linhas, spec, rotulo, onMunicipio }: { linhas: any[]; spec: Spec; rotulo: string; onMunicipio: (c: number) => void }) {
  const { valores, sem } = useMemo(() => {
    const p = new Map<number, Set<string>>(), n = new Map<number, number>();
    let semMun = 0;
    for (const r of linhas) {
      const c = r.m?._mun;
      if (!c) { semMun++; continue; }
      n.set(c, (n.get(c) || 0) + 1);
      const s = p.get(c) || new Set(); s.add(r.pessoa_id || r.militar_id || r.id); p.set(c, s);
    }
    const v = spec.medida === 'pessoas' ? new Map([...p].map(([k, s]) => [k, s.size])) : n;
    return { valores: v, sem: semMun };
  }, [linhas, spec.medida]);
  const top = [...valores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return (
    <div className="mapa-consulta">
      <MapaPE valores={valores} rotulo={spec.medida === 'pessoas' ? 'pessoas' : rotulo} onSelecionar={(c) => c && onMunicipio(c)} />
      <div className="mapa-lado">
        <h4>Maiores concentrações</h4>
        <ol>{top.map(([c, v]) => <li key={c}><button className="link" onClick={() => onMunicipio(c)}>{nomeMunicipio.get(c)}</button> <span className="nota">{v.toLocaleString('pt-BR')}</span></li>)}</ol>
        {sem > 0 && <p className="nota">{sem.toLocaleString('pt-BR')} registro(s) sem município: cadastre a cidade da seção ou da OME em Administração &gt; Estrutura e regiões.</p>}
        <p className="nota">Clique num município para ver a lista. O mapa conta registros (ou pessoas), independentemente do agrupamento.</p>
      </div>
    </div>
  );
}

function Lista({ linhas, assunto, spec, drill, cl, cc, onLimparDrill }: { linhas: any[]; assunto: Assunto; spec: Spec; drill: any; cl: Campo | null; cc: Campo | null; onLimparDrill: () => void }) {
  const extras = [...new Set([spec.linhas, spec.colunas, spec.campoMedida, ...spec.filtros.map((f) => f.campo)].filter(Boolean) as string[])]
    .map((id) => campoDe(assunto, id)).filter((c): c is Campo => !!c && !['posto', 'm.posto', 'ome', 'm.ome', 'posto_quadro', 'm.posto_quadro'].includes(c.id));
  const base: Coluna[] = [
    { titulo: 'Posto/Grad.', valor: (r: any) => r.m?.posto_completo || r.posto_completo || r.militar_posto, largura: 11 },
    { titulo: 'Matrícula', valor: (r: any) => r.m?.matricula || r.matricula || r.militar_matricula, largura: 11 },
    { titulo: 'Nome', valor: (r: any) => r.m?.nome || r.nome || r.militar_nome, largura: 36 },
    { titulo: 'OME', valor: (r: any) => r.m?.ome_sigla || r.ome_sigla, largura: 10 },
  ];
  const proprias: Coluna[] = assunto.id === 'afastamentos'
    ? [{ titulo: 'Tipo', valor: (r: any) => r.tipo_nome, largura: 20 }, { titulo: 'Início', valor: (r: any) => fmtData(r.data_inicio), largura: 11 }, { titulo: 'Término', valor: (r: any) => fmtData(r.data_fim), largura: 11 }, { titulo: 'Dias', valor: (r: any) => r.dias, largura: 6 }]
    : assunto.id === 'ferias'
      ? [{ titulo: 'PAF', valor: (r: any) => r.exercicio, largura: 6 }, { titulo: 'Início', valor: (r: any) => fmtData(r.data_inicio), largura: 11 }, { titulo: 'Término', valor: (r: any) => fmtData(r.data_fim), largura: 11 }, { titulo: 'Dias', valor: (r: any) => r.dias_efetivos ?? r.dias, largura: 6 }, { titulo: 'Situação', valor: (r: any) => categoria(campoDe(assunto, 'status')!, r), largura: 12 }]
      : assunto.id === 'movimentacoes'
        ? [{ titulo: 'Data', valor: (r: any) => fmtData(r.data), largura: 11 }, { titulo: 'Tipo', valor: (r: any) => categoria(campoDe(assunto, 'tipo')!, r), largura: 14 }, { titulo: 'Origem', valor: (r: any) => r.ome_origem_sigla, largura: 10 }, { titulo: 'Destino', valor: (r: any) => r.ome_destino_sigla, largura: 10 }, { titulo: 'Documento', valor: (r: any) => r.documento, largura: 22 }]
        : [{ titulo: 'Seção', valor: (r: any) => r.secao_nome, largura: 22 }];
  const cols: Coluna[] = [{ titulo: 'Nº', valor: (_r: any, i: number) => i + 1, largura: 5 }, ...base, ...proprias,
    ...extras.map((c) => ({ titulo: c.rotulo, valor: (r: any) => exibirCategoria(c, categoria(c, r)), largura: 16 }))];
  const ordenadas = useMemo(() => [...linhas].sort((a, b) => ((a.m?.posto_ordem ?? 99) - (b.m?.posto_ordem ?? 99)) || ((a.m?._ant?.pos_geral ?? 1e9) - (b.m?._ant?.pos_geral ?? 1e9)) || String(a.m?.nome || a.nome || '').localeCompare(String(b.m?.nome || b.nome || ''), 'pt-BR')), [linhas]);
  const titulo = resumo(spec, assunto);
  const dtxt = drill ? [drill.l != null && cl ? `${cl.rotulo}: ${exibirCategoria(cl, drill.l)}` : null, drill.c != null && cc ? `${cc.rotulo}: ${exibirCategoria(cc, drill.c)}` : null, drill.mun ? `Município: ${nomeMunicipio.get(drill.mun)}` : null].filter(Boolean).join(' · ') : '';
  return (
    <div>
      <div className="lista-cab">
        <span>{ordenadas.length.toLocaleString('pt-BR')} {ordenadas.length === 1 ? assunto.unidadeSing : assunto.unidade}{dtxt && <> · <Badge tom="azul">{dtxt}</Badge> <button className="link" onClick={onLimparDrill}>ver todos</button></>}</span>
        <span className="acoes">
          <Botao pequeno onClick={() => exportarXlsx('consulta_lista', titulo + (dtxt ? ` (${dtxt})` : ''), cols, ordenadas)}>Excel</Botao>
          <Botao pequeno onClick={() => exportarPdf('consulta_lista', titulo, dtxt || 'Lista nominal', cols, ordenadas)}>PDF</Botao>
        </span>
      </div>
      <Tabela linhas={ordenadas} chave={(r: any) => r.id || r.militar_id} porPagina={50} compacta
        onLinha={(r: any) => { const id = r.m?.id || r.militar_id; if (id) window.open(`/militar/${id}`, '_blank'); }}
        colunas={cols.slice(1).map((c, i) => ({ id: String(i), titulo: c.titulo, render: (r: any) => c.valor(r, 0), valor: (r: any) => c.valor(r, 0) }))} />
    </div>
  );
}

function Salvas({ lista, meuId, admin, onAbrir, onExcluir }: { lista: any[]; meuId?: string; admin: boolean; onAbrir: (s: Spec) => void; onExcluir: (id: string) => void }) {
  const minhas = lista.filter((x) => x.dono === meuId);
  const dgp = lista.filter((x) => x.compartilhada && x.dono !== meuId);
  const item = (x: any) => (
    <li key={x.id}>
      <button className="link" onClick={() => onAbrir(x.spec)} title={x.descricao || undefined}>{x.nome}</button>
      {x.compartilhada && <Badge tom="azul">DGP</Badge>}
      {(x.dono === meuId || admin) && <button className="link perigo" onClick={() => { if (confirm(`Excluir a consulta "${x.nome}"?`)) onExcluir(x.id); }}>excluir</button>}
    </li>
  );
  return (
    <>
      <Cartao titulo="Minhas consultas">
        {minhas.length ? <ul className="lista-perguntas">{minhas.map(item)}</ul> : <p className="nota">Monte uma consulta e use "Salvar consulta" para guardá-la aqui.</p>}
      </Cartao>
      {dgp.length > 0 && <Cartao titulo="Consultas da DGP"><ul className="lista-perguntas">{dgp.map(item)}</ul></Cartao>}
    </>
  );
}

function SalvarModal({ aberto, onFechar, spec, assunto, podeCompartilhar }: { aberto: boolean; onFechar: () => void; spec: Spec; assunto: Assunto; podeCompartilhar: boolean }) {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [compartilhar, setCompartilhar] = useState(false);
  useEffect(() => { if (aberto) { setNome(resumo(spec, assunto).slice(0, 120)); setDescricao(''); setCompartilhar(false); } }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal aberto={aberto} titulo="Salvar consulta" onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={nome.trim().length < 3} onClick={async () => {
        const { error } = await supabase.from('consulta_salva').insert({ nome: nome.trim(), descricao: descricao.trim() || null, assunto: spec.assunto, spec, compartilhada: compartilhar });
        if (error) toast(msgErro(error), 'erro'); else { invalidar('cl:salvas'); toast('Consulta salva.'); onFechar(); }
      }}>Salvar</Botao></>}>
      <div className="form-grade">
        <CampoUi rotulo="Nome *" largura="inteira"><input value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} /></CampoUi>
        <CampoUi rotulo="Descrição" largura="inteira"><input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Para que serve, quem pediu…" /></CampoUi>
        {podeCompartilhar && <label className="check"><input type="checkbox" checked={compartilhar} onChange={(e) => setCompartilhar(e.target.checked)} /> Compartilhar com todos os usuários (aparece em "Consultas da DGP")</label>}
      </div>
      <p className="nota">Salva-se apenas a receita da consulta (filtros e agrupamentos), nunca os dados. Cada pessoa que abrir verá somente o que o próprio acesso permite.</p>
    </Modal>
  );
}
