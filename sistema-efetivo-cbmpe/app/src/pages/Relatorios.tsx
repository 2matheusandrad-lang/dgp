import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios, Dominios } from '../lib/dominios';
import {
  ATIVIDADE, Coluna, REGISTRO_TIPO, SITUACAO, buscarTodos, exportarXlsx, fmtCompetencia, fmtData, hojeISO,
  msgErro, ordenarAntiguidade, semAcento, somaDias,
} from '../lib/util';
import { TIPO_MOV } from './Militar';
import { Aviso, Botao, Campo, Carregando, Vazio } from '../components/ui';

type Params = { ini: string; fim: string; nivel: string; area: string; tipoReg: string; competencia: string; tipoAfast: string };
type Resultado = { titulo: string; colunas: Coluna[]; linhas: any[]; agrupar?: (r: any) => string };
type Rel = { id: string; titulo: string; descricao: string; params: (keyof Params)[]; gerar: (p: Params, escopo: number | null, dom: Dominios) => Promise<Resultado> };

const escopoQ = (q: any, escopo: number | null) => (escopo ? q.eq('ome_id', escopo) : q);
const ordemOme = (dom: Dominios) => {
  const o = new Map(dom.omes.map((x) => [x.id, x.ordem]));
  return (a: any, b: any) => ((o.get(a.ome_id) ?? 999) - (o.get(b.ome_id) ?? 999)) || ordenarAntiguidade(a, b);
};
const militarCols: Coluna[] = [
  { titulo: 'Nº', valor: (_r, i) => i + 1, largura: 5 },
  { titulo: 'Posto/Grad.', valor: (r) => r.posto_completo, largura: 12 },
  { titulo: 'Matrícula', valor: (r) => r.matricula, largura: 11 },
  { titulo: 'Nome', valor: (r) => r.nome, largura: 42 },
  { titulo: 'OME', valor: (r) => r.ome_sigla, largura: 10 },
];

const RELATORIOS: Rel[] = [
  {
    id: 'nominal', titulo: 'Efetivo nominal por OME', descricao: 'Relação dos militares ativos em ordem de antiguidade, com seção, atividade e situação do dia.', params: [],
    gerar: async (_p, escopo, dom) => {
      const l = await buscarTodos(() => escopoQ(supabase.from('v_militar').select('*').eq('situacao', 'ATIVO').order('id'), escopo));
      return {
        titulo: 'Efetivo nominal', agrupar: (r) => r.ome_sigla, linhas: l.sort(ordemOme(dom)),
        colunas: [...militarCols,
          { titulo: 'Seção', valor: (r) => r.secao_nome, largura: 24 },
          { titulo: 'Atividade', valor: (r) => ATIVIDADE[r.atividade] || '' },
          { titulo: 'Situação hoje', valor: (r) => (r.afastado_hoje ? `${r.afastamento_codigo} até ${fmtData(r.afastamento_fim)}` : 'Disponível'), largura: 22 }],
      };
    },
  },
  {
    id: 'quadro', titulo: 'Quadro resumo (OME × posto/graduação)', descricao: 'Quantitativo por posto/graduação em cada OME (ou seção, quando uma OME está selecionada), com afastados do dia.', params: [],
    gerar: async (_p, escopo, dom) => {
      const l = await buscarTodos(() => escopoQ(supabase.from('v_militar').select('ome_id,ome_sigla,secao_nome,posto_sigla,afastado_hoje,atividade').eq('situacao', 'ATIVO').order('id'), escopo));
      const chave = (r: any) => (escopo ? r.secao_nome || '(sem seção)' : r.ome_sigla);
      const grupos = new Map<string, any>();
      for (const r of l) {
        const k = chave(r);
        if (!grupos.has(k)) grupos.set(k, { unidade: k, ome_id: r.ome_id, total: 0, afastados: 0, operacional: 0 });
        const g = grupos.get(k); g[r.posto_sigla] = (g[r.posto_sigla] || 0) + 1; g.total++;
        if (r.afastado_hoje) g.afastados++;
        if (r.atividade === 'OPERACIONAL') g.operacional++;
      }
      const ord = new Map(dom.omes.map((o) => [o.id, o.ordem]));
      const linhas = [...grupos.values()].sort((a, b) => (escopo ? b.total - a.total : (ord.get(a.ome_id) ?? 999) - (ord.get(b.ome_id) ?? 999)));
      const tot: any = { unidade: 'TOTAL', total: 0, afastados: 0, operacional: 0 };
      for (const g of linhas) for (const k of Object.keys(g)) if (typeof g[k] === 'number' && k !== 'ome_id') tot[k] = (tot[k] || 0) + g[k];
      linhas.push(tot);
      return {
        titulo: 'Quadro resumo do efetivo', linhas,
        colunas: [{ titulo: escopo ? 'Seção' : 'OME', valor: (r) => r.unidade, largura: 22 },
          ...dom.postos.map((p) => ({ titulo: p.sigla, valor: (r: any) => r[p.sigla] || 0, largura: 7 })),
          { titulo: 'Total', valor: (r) => r.total, largura: 8 }, { titulo: 'Operac.', valor: (r) => r.operacional, largura: 8 },
          { titulo: 'Afastados hoje', valor: (r) => r.afastados, largura: 10 },
          { titulo: 'Disponíveis', valor: (r) => r.total - r.afastados, largura: 10 }],
      };
    },
  },
  {
    id: 'afastamentos', titulo: 'Afastamentos no período', descricao: 'Todos os afastamentos que tiveram ao menos um dia dentro do período informado.', params: ['ini', 'fim', 'tipoAfast'],
    gerar: async (p, escopo, dom) => {
      const l = await buscarTodos(() => {
        let q = supabase.from('v_afastamento').select('*').lte('data_inicio', p.fim).gte('data_fim', p.ini).order('id');
        if (p.tipoAfast) q = q.eq('tipo_id', Number(p.tipoAfast));
        return escopoQ(q, escopo);
      });
      return {
        titulo: `Afastamentos de ${fmtData(p.ini)} a ${fmtData(p.fim)}`, agrupar: (r) => r.ome_sigla,
        linhas: l.sort((a, b) => ordemOme(dom)(a, b) || a.data_inicio.localeCompare(b.data_inicio)),
        colunas: [...militarCols, { titulo: 'Tipo', valor: (r) => r.tipo_nome, largura: 30 },
          { titulo: 'Início', valor: (r) => fmtData(r.data_inicio) }, { titulo: 'Dias', valor: (r) => r.dias, largura: 6 },
          { titulo: 'Término', valor: (r) => fmtData(r.data_fim) }, { titulo: 'Processo SEI', valor: (r) => r.processo_sei, largura: 28 }],
      };
    },
  },
  {
    id: 'situacoes', titulo: 'Situações funcionais vigentes', descricao: 'Readaptados, horário especial de trabalho, acumulação de cargo e PCD.', params: ['tipoReg'],
    gerar: async (p, escopo, dom) => {
      const l = await buscarTodos(() => {
        let q = supabase.from('v_registro_funcional').select('*').eq('vigente', true).eq('situacao', 'ATIVO').order('id');
        if (p.tipoReg) q = q.eq('tipo', p.tipoReg);
        return escopoQ(q, escopo);
      });
      return {
        titulo: `Situações funcionais vigentes${p.tipoReg ? ' — ' + REGISTRO_TIPO[p.tipoReg] : ''}`, agrupar: (r) => r.ome_sigla, linhas: l.sort(ordemOme(dom)),
        colunas: [...militarCols, { titulo: 'Seção', valor: (r) => r.secao_nome, largura: 22 }, { titulo: 'Situação', valor: (r) => REGISTRO_TIPO[r.tipo], largura: 18 },
          { titulo: 'Detalhe', valor: (r) => r.detalhe, largura: 24 }, { titulo: 'Início', valor: (r) => fmtData(r.data_inicio) },
          { titulo: 'Término', valor: (r) => fmtData(r.data_fim) || 'indeterminado' }, { titulo: 'Processo SEI', valor: (r) => r.processo_sei, largura: 28 }],
      };
    },
  },
  {
    id: 'formacao', titulo: 'Formação acadêmica', descricao: 'Localize militares por nível e área de formação (ex.: engenheiros civis, enfermeiros, bacharéis em Direito).', params: ['nivel', 'area'],
    gerar: async (p, escopo, dom) => {
      const l = await buscarTodos(() => {
        let q = supabase.from('v_formacao').select('*').eq('situacao', 'ATIVO').order('id');
        if (p.nivel) q = q.gte('nivel_ordem', Number(p.nivel));
        return escopoQ(q, escopo);
      });
      const a = semAcento(p.area.trim());
      return {
        titulo: `Formação${p.area ? ' — área contém "' + p.area + '"' : ''}`, agrupar: (r) => r.ome_sigla,
        linhas: l.filter((r) => !a || semAcento(r.area || '').includes(a)).sort(ordemOme(dom)),
        colunas: [...militarCols, { titulo: 'Nível', valor: (r) => r.nivel_nome, largura: 18 }, { titulo: 'Área', valor: (r) => r.area, largura: 30 },
          { titulo: 'Instituição', valor: (r) => r.instituicao, largura: 20 }, { titulo: 'E-mail', valor: (r) => r.email, largura: 28 }, { titulo: 'Telefone', valor: (r) => r.telefone1, largura: 16 }],
      };
    },
  },
  {
    id: 'pendencias', titulo: 'Pendências de cadastro', descricao: 'Fichas incompletas por OME — para cobrar o preenchimento de todas as colunas.', params: [],
    gerar: async (_p, escopo, dom) => {
      const l = await buscarTodos(() => escopoQ(supabase.from('v_militar').select('*').eq('situacao', 'ATIVO').lt('completude', 100).order('id'), escopo));
      return {
        titulo: 'Pendências de cadastro', agrupar: (r) => r.ome_sigla, linhas: l.sort(ordemOme(dom)),
        colunas: [...militarCols, { titulo: 'Completude', valor: (r) => `${r.completude}%`, largura: 10 }, { titulo: 'Falta preencher', valor: (r) => (r.pendencias || []).join(', '), largura: 60 }],
      };
    },
  },
  {
    id: 'contatos', titulo: 'Lista de contatos', descricao: 'E-mail, telefones e endereço do efetivo ativo.', params: [],
    gerar: async (_p, escopo, dom) => {
      const l = await buscarTodos(() => escopoQ(supabase.from('v_militar').select('*').eq('situacao', 'ATIVO').order('id'), escopo));
      return {
        titulo: 'Contatos do efetivo', agrupar: (r) => r.ome_sigla, linhas: l.sort(ordemOme(dom)),
        colunas: [...militarCols, { titulo: 'Seção', valor: (r) => r.secao_nome, largura: 22 }, { titulo: 'E-mail', valor: (r) => r.email, largura: 30 },
          { titulo: 'Telefone', valor: (r) => r.telefone1, largura: 16 }, { titulo: 'Telefone 2', valor: (r) => r.telefone2, largura: 16 }, { titulo: 'Endereço', valor: (r) => r.endereco, largura: 50 }],
      };
    },
  },
  {
    id: 'movimentacoes', titulo: 'Movimentações no período', descricao: 'Inclusões, transferências, desligamentos e reinclusões registradas.', params: ['ini', 'fim'],
    gerar: async (p, escopo) => {
      const l = await buscarTodos(() => {
        let q = supabase.from('v_movimentacao').select('*').gte('data', p.ini).lte('data', p.fim).order('data').order('id');
        if (escopo) q = q.or(`ome_origem_id.eq.${escopo},ome_destino_id.eq.${escopo}`);
        return q;
      });
      return {
        titulo: `Movimentações de ${fmtData(p.ini)} a ${fmtData(p.fim)}`, linhas: l.filter((r) => r.documento !== 'Carga inicial'),
        colunas: [{ titulo: 'Data', valor: (r) => fmtData(r.data) }, { titulo: 'Tipo', valor: (r) => TIPO_MOV[r.tipo] },
          { titulo: 'Posto/Grad.', valor: (r) => r.militar_posto }, { titulo: 'Matrícula', valor: (r) => r.militar_matricula, largura: 11 },
          { titulo: 'Nome', valor: (r) => r.militar_nome, largura: 40 }, { titulo: 'De', valor: (r) => r.ome_origem_sigla },
          { titulo: 'Para', valor: (r) => (r.tipo === 'DESLIGAMENTO' ? SITUACAO[r.situacao_nova] : r.ome_destino_sigla) },
          { titulo: 'Documento', valor: (r) => r.documento, largura: 22 }, { titulo: 'Registrado por', valor: (r) => r.registrado_por_nome, largura: 28 }],
      };
    },
  },
  {
    id: 'punicoes', titulo: 'Punições', descricao: 'Punições registradas com início no período.', params: ['ini', 'fim'],
    gerar: async (p, escopo, dom) => {
      const l = await buscarTodos(() => escopoQ(supabase.from('v_punicao').select('*').gte('data_inicio', p.ini).lte('data_inicio', p.fim).order('id'), escopo));
      return {
        titulo: `Punições de ${fmtData(p.ini)} a ${fmtData(p.fim)}`, linhas: l.sort(ordemOme(dom)),
        colunas: [...militarCols, { titulo: 'Tipo', valor: (r) => r.tipo_nome }, { titulo: 'Início', valor: (r) => fmtData(r.data_inicio) },
          { titulo: 'Dias', valor: (r) => r.dias }, { titulo: 'Processo', valor: (r) => r.processo, largura: 28 }],
      };
    },
  },
  {
    id: 'fechamento', titulo: 'Efetivo de competência fechada', descricao: 'A fotografia do efetivo salva no fechamento mensal (substitui a planilha "salva pela DGP" no 6º dia útil).', params: ['competencia'],
    gerar: async (p, escopo, dom) => {
      if (!p.competencia) throw new Error('Escolha a competência.');
      const l = await buscarTodos(() => escopoQ(supabase.from('fechamento_militar').select('ome_id, dados').eq('competencia', p.competencia).order('militar_id'), escopo));
      const linhas = l.map((x: any) => ({ ...x.dados, ome_id: x.ome_id })).sort(ordemOme(dom));
      return {
        titulo: `Efetivo da competência ${fmtCompetencia(p.competencia)}`, agrupar: (r) => r.ome_sigla, linhas,
        colunas: [...militarCols, { titulo: 'Seção', valor: (r) => r.secao_nome, largura: 22 }, { titulo: 'Atividade', valor: (r) => ATIVIDADE[r.atividade] || '' },
          { titulo: 'Afastamentos no mês', valor: (r) => (r.afastamentos_no_mes || []).map((a: any) => `${a.tipo} ${fmtData(a.inicio)}–${fmtData(a.fim)}`).join('; '), largura: 40 },
          { titulo: 'Readaptado', valor: (r) => (r.readaptado ? 'Sim' : 'Não') }, { titulo: 'HE', valor: (r) => (r.horario_especial ? 'Sim' : 'Não') },
          { titulo: 'Escolaridade', valor: (r) => r.escolaridade, largura: 18 }],
      };
    },
  },
];

export default function Relatorios() {
  const { escopo, ctx } = useAuth();
  const dom = useDominios();
  const [sel, setSel] = useState<Rel>(RELATORIOS[0]);
  const [p, setP] = useState<Params>({ ini: somaDias(hojeISO(), -30), fim: hojeISO(), nivel: '', area: '', tipoReg: '', competencia: '', tipoAfast: '' });
  const [res, setRes] = useState<Resultado | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [comps, setComps] = useState<any[]>([]);
  const set = (k: keyof Params, v: string) => setP((x) => ({ ...x, [k]: v }));

  useEffect(() => { supabase.from('fechamento_mensal').select('*').order('competencia', { ascending: false }).then(({ data }) => setComps(data || [])); }, []);
  useEffect(() => { setRes(null); setErro(null); }, [sel, escopo]);

  const gerar = async () => {
    if (!dom) return;
    setGerando(true); setErro(null); setRes(null);
    try { setRes(await sel.gerar(p, escopo, dom)); } catch (e) { setErro(msgErro(e)); } finally { setGerando(false); }
  };
  const nomeEscopo = escopo ? ctx?.omes.find((o) => o.id === escopo)?.sigla : 'Todas as OMEs';
  const MAX = 500;

  return (
    <div className="pagina">
      <div className="pagina-cab sem-imprimir"><div><h1>Relatórios</h1><p className="sub">Escopo: {nomeEscopo} (altere no seletor de OME no topo)</p></div></div>
      <div className="relatorios">
        <nav className="rel-lista sem-imprimir">
          {RELATORIOS.map((r) => <button key={r.id} className={r.id === sel.id ? 'ativo' : ''} onClick={() => setSel(r)}><strong>{r.titulo}</strong><span>{r.descricao}</span></button>)}
        </nav>
        <div className="rel-corpo">
          <div className="cartao sem-imprimir"><div className="cartao-corpo">
            <h3>{sel.titulo}</h3>
            <p className="nota">{sel.descricao}</p>
            {sel.params.length > 0 && <div className="filtros">
              {sel.params.includes('ini') && <Campo rotulo="De"><input type="date" value={p.ini} onChange={(e) => set('ini', e.target.value)} /></Campo>}
              {sel.params.includes('fim') && <Campo rotulo="Até"><input type="date" value={p.fim} onChange={(e) => set('fim', e.target.value)} /></Campo>}
              {sel.params.includes('tipoAfast') && (
                <Campo rotulo="Tipo de afastamento"><select value={p.tipoAfast} onChange={(e) => set('tipoAfast', e.target.value)}>
                  <option value="">Todos</option>{dom?.tiposAfast.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select></Campo>
              )}
              {sel.params.includes('tipoReg') && (
                <Campo rotulo="Situação"><select value={p.tipoReg} onChange={(e) => set('tipoReg', e.target.value)}>
                  <option value="">Todas</option>{Object.entries(REGISTRO_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></Campo>
              )}
              {sel.params.includes('nivel') && (
                <Campo rotulo="Nível mínimo"><select value={p.nivel} onChange={(e) => set('nivel', e.target.value)}>
                  <option value="">Qualquer</option>{dom?.niveis.map((n) => <option key={n.id} value={n.ordem}>{n.nome}</option>)}
                </select></Campo>
              )}
              {sel.params.includes('area') && <Campo rotulo="Área contém"><input value={p.area} onChange={(e) => set('area', e.target.value)} placeholder="ex.: engenharia civil" /></Campo>}
              {sel.params.includes('competencia') && (
                <Campo rotulo="Competência"><select value={p.competencia} onChange={(e) => set('competencia', e.target.value)}>
                  <option value="">Selecione</option>{comps.map((c) => <option key={c.competencia} value={c.competencia}>{fmtCompetencia(c.competencia)} ({c.total} militares)</option>)}
                </select></Campo>
              )}
            </div>}
            <div className="acoes">
              <Botao variante="primario" onClick={gerar} disabled={gerando || !dom}>{gerando ? 'Gerando…' : 'Gerar'}</Botao>
              {res && <Botao onClick={() => exportarXlsx(sel.id, `${res.titulo} — ${nomeEscopo}`, res.colunas, res.linhas)}>Exportar Excel</Botao>}
              {res && <Botao onClick={() => window.print()}>Imprimir / PDF</Botao>}
            </div>
          </div></div>

          {erro && <Aviso tom="erro">{erro}</Aviso>}
          {gerando && <Carregando texto="Gerando relatório…" />}
          {res && (
            <div className="cartao impressao"><div className="cartao-corpo">
              <div className="impressao-cab">
                <div><strong>CORPO DE BOMBEIROS MILITAR DE PERNAMBUCO</strong><br />Diretoria de Gestão de Pessoas</div>
                <div className="dir">{res.titulo}<br /><span className="nota">{nomeEscopo} · gerado em {new Date().toLocaleString('pt-BR')}</span></div>
              </div>
              {!res.linhas.length ? <Vazio>Nenhum registro.</Vazio> : (
                <>
                  <p className="nota sem-imprimir">{res.linhas.length} linhas{res.linhas.length > MAX ? ` — pré-visualização das primeiras ${MAX}; o Excel traz todas` : ''}.</p>
                  <div className="tabela-wrap">
                    <table className="tabela compacta">
                      <thead><tr>{res.colunas.map((c) => <th key={c.titulo}>{c.titulo}</th>)}</tr></thead>
                      <tbody>
                        {res.linhas.slice(0, MAX).map((r, i) => {
                          const g = res.agrupar?.(r);
                          const novoGrupo = res.agrupar && (i === 0 || res.agrupar(res.linhas[i - 1]) !== g);
                          return [
                            novoGrupo ? <tr key={'g' + i} className="grupo"><td colSpan={res.colunas.length}>{g}</td></tr> : null,
                            <tr key={i} className={r.unidade === 'TOTAL' ? 'total' : ''}>{res.colunas.map((c) => <td key={c.titulo}>{c.valor(r, i)}</td>)}</tr>,
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div></div>
          )}
        </div>
      </div>
    </div>
  );
}
