import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios, secoesDa } from '../lib/dominios';
import { invalidar, useConsulta } from '../lib/consulta';
import { COLUNAS_EFETIVO, carregarEfetivo } from '../lib/efetivo';
import { mapaRegioes } from '../lib/regioes';
import { carregarAntiguidade } from '../lib/consultaLivre';
import {
  ATIVIDADE, SITUACAO, fmtData, hojeISO, mascaraMatricula, mascaraTelefone, matriculaValida, msgErro, ordenarAntiguidade, rpc, semAcento,
} from '../lib/util';
import { Aviso, Badge, Botao, Campo, Carregando, Modal, Tabela, useToast } from '../components/ui';
import Exportar from '../components/Exportar';

export const situacaoHoje = (m: any) =>
  m.situacao && m.situacao !== 'ATIVO'
    ? <Badge tom="vermelho">{SITUACAO[m.situacao]}</Badge>
    : m.afastado_hoje
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

const ATALHOS: { id: string; rotulo: string; teste: (m: any) => boolean }[] = [
  { id: '', rotulo: 'Todos', teste: () => true },
  { id: 'disponivel', rotulo: 'Disponíveis', teste: (m) => !m.afastado_hoje },
  { id: 'afastado', rotulo: 'Afastados hoje', teste: (m) => m.afastado_hoje },
  { id: 'readaptado', rotulo: 'Readaptados', teste: (m) => m.readaptado },
  { id: 'he', rotulo: 'Horário especial', teste: (m) => m.horario_especial },
  { id: 'acumulacao', rotulo: 'Acumulação', teste: (m) => m.acumulacao_cargo },
  { id: 'pcd', rotulo: 'PCD', teste: (m) => m.pcd },
  { id: 'punicao', rotulo: 'Com punição', teste: (m) => m.qtd_punicoes > 0 },
  { id: 'incompleto', rotulo: 'Cadastro incompleto', teste: (m) => m.completude < 100 },
  { id: 'semsecao', rotulo: 'Sem seção', teste: (m) => !m.secao_id },
];

export default function Efetivo() {
  const { escopo, podeEditarAlguma, podeEditarOme, ctx, gestaoGlobal } = useAuth();
  const dom = useDominios();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const p = (k: string, def = '') => params.get(k) ?? def;
  const f = {
    q: p('q'), posto: p('posto'), secao: p('secao'), atividade: p('atividade'), condicao: p('condicao'),
    esc: p('esc'), area: p('area'), situacao: p('situacao', 'ATIVO'), quadro: p('quadro'), regiao: p('regiao'),
  };
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v === '' && k !== 'situacao') n.delete(k); else n.set(k, v);
    setParams(n, { replace: true });
  };
  const [busca, setBusca] = useState(f.q);
  useEffect(() => { const t = setTimeout(() => busca !== f.q && set('q', busca), 250); return () => clearTimeout(t); }, [busca]); // eslint-disable-line

  const { dados, carregando, atualizando, erro } = useConsulta(`efetivo|${escopo}|${f.situacao}`, () => carregarEfetivo(escopo, f.situacao));
  const ant = useConsulta('cl:ant', carregarAntiguidade, 300_000);
  const regioes = useMemo(() => mapaRegioes(dom), [dom]);
  const temRegioes = !!dom?.omes.some((o) => o.regional);
  const [, refazer] = useState(0);
  const [receber, setReceber] = useState(false);
  const [exportar, setExportar] = useState<'' | 'filtro' | 'selecao'>('');
  const [editar, setEditar] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [lote, setLote] = useState<'' | 'secao' | 'atividade' | 'afastamento'>('');

  const nomeEscopo = escopo ? ctx?.omes.find((o) => o.id === escopo)?.sigla : 'Todas as OMEs';
  const area = semAcento(f.area.trim());
  const b = semAcento(f.q.trim());
  const atalho = ATALHOS.find((a) => a.id === f.condicao) || ATALHOS[0];

  // filtros sem o atalho (para as contagens dos atalhos)
  const baseFiltrada = useMemo(() => (dados || []).filter((m: any) =>
    (!b || semAcento(m.nome).includes(b) || (m.matricula || '').includes(b) || semAcento(m.nome_guerra || '').includes(b)) &&
    (!f.posto || String(m.posto_id) === f.posto) &&
    (!f.secao || (f.secao === '-' ? !m.secao_id : String(m.secao_id) === f.secao)) &&
    (!f.atividade || (f.atividade === '-' ? !m.atividade : m.atividade === f.atividade)) &&
    (!f.esc || (f.esc === '-' ? !m.escolaridade : (m.escolaridade_ordem || 0) >= Number(f.esc))) &&
    (!area || semAcento(m.areas_formacao || '').includes(area)) &&
    (!f.quadro || (f.quadro === 'PRACA' ? !m.oficial : m.quadro_sigla === f.quadro)) &&
    (!f.regiao || regioes.de(m.ome_id).rotulo === f.regiao),
  ), [dados, b, f.posto, f.secao, f.atividade, f.esc, area, f.quadro, f.regiao, regioes]);
  const filtrados = useMemo(() => baseFiltrada.filter(atalho.teste).sort(ordenarAntiguidade), [baseFiltrada, atalho]);
  const contagem = useMemo(() => Object.fromEntries(ATALHOS.map((a) => [a.id, baseFiltrada.filter(a.teste).length])), [baseFiltrada]);
  const resumo = useMemo(() => {
    const porPosto = new Map<string, number>();
    let op = 0, adm = 0, af = 0;
    for (const m of filtrados as any[]) {
      porPosto.set(m.posto_sigla, (porPosto.get(m.posto_sigla) || 0) + 1);
      if (m.atividade === 'OPERACIONAL') op++; else if (m.atividade === 'ADMINISTRATIVO') adm++;
      if (m.afastado_hoje) af++;
    }
    return { porPosto: [...porPosto.entries()], op, adm, af };
  }, [filtrados]);

  const editavelEscopo = !!escopo && podeEditarOme(escopo);
  const podeIncluir = gestaoGlobal;   // inclusão e transferência: só a DGP (1.4.1)
  const selecionados = (filtrados as any[]).filter((m) => sel.has(m.id));
  const selEditaveis = selecionados.filter((m) => podeEditarOme(m.ome_id) && m.situacao === 'ATIVO');
  const omesSel = new Set(selEditaveis.map((m) => m.ome_id));
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todosMarcados = filtrados.length > 0 && filtrados.every((m: any) => sel.has(m.id));

  const salvarCampo = async (m: any, campo: string, valor: any, extra?: Record<string, any>) => {
    const { error } = await supabase.from('militar').update({ [campo]: valor === '' ? null : valor }).eq('id', m.id);
    if (error) { toast(msgErro(error), 'erro'); return; }
    Object.assign(m, { [campo]: valor === '' ? null : valor }, extra || {});
    refazer((x) => x + 1);
    invalidar('painel');
  };

  const obterLinhas = (lista: any[]) => async (contato: boolean) => {
    if (!contato) return lista;
    const ids = new Set(lista.map((m) => m.id));
    const completos = await carregarEfetivo(escopo, f.situacao, 'id,email,telefone2,endereco');
    const mapa = new Map(completos.filter((c: any) => ids.has(c.id)).map((c: any) => [c.id, c]));
    return lista.map((m) => ({ ...m, ...(mapa.get(m.id) || {}) }));
  };

  const filtroTexto = [atalho.id && atalho.rotulo, f.q && `busca "${f.q}"`, f.posto && dom?.postos.find((x) => String(x.id) === f.posto)?.sigla,
    f.quadro && (f.quadro === 'PRACA' ? 'praças' : f.quadro), f.regiao,
    f.area && `área "${f.area}"`, f.situacao !== 'ATIVO' && (SITUACAO[f.situacao] || 'todas as situações')].filter(Boolean).join(' · ');
  const secoes = escopo ? secoesDa(dom, escopo) : [];
  const ordemOme = (id: number) => String(dom?.omes.find((o) => o.id === id)?.ordem ?? 999).padStart(4, '0') + String(id).padStart(4, '0');
  const ordemSecao = (id: number | null) => (id ? dom?.secoes.find((s) => s.id === id)?.ordem ?? 999 : 9999);

  const colunasTabela: any[] = [
    ...(podeEditarAlguma ? [{
      id: 'sel', ordenavel: false, largura: '28px',
      titulo: <input type="checkbox" aria-label="Selecionar todos" checked={todosMarcados}
        onChange={(e) => setSel(e.target.checked ? new Set(filtrados.map((m: any) => m.id)) : new Set())} />,
      render: (m: any) => <span onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Selecionar" checked={sel.has(m.id)} onChange={() => alternar(m.id)} /></span>,
    }] : []),
    { id: 'posto_completo', titulo: 'Posto/Grad.', valor: (m: any) => m.posto_ordem },
    {
      id: 'antig', titulo: <span title="Posição na antiguidade do posto/quadro (passe o mouse para ver a geral e a da OME)">Antig.</span>,
      valor: (m: any) => ant.dados?.get(m.id)?.pos_geral ?? 1e9,
      render: (m: any) => { const a = ant.dados?.get(m.id); return a ? <span className="nota" title={`Geral: ${a.pos_geral}º de ${a.total_geral} · Na OME: ${a.pos_ome}º de ${a.total_ome}${a.pos_regiao ? ` · Na região: ${a.pos_regiao}º de ${a.total_regiao}` : ''}`}>{a.pos_posto}º/{a.total_posto}</span> : <span className="nota">—</span>; },
    },
    { id: 'matricula', titulo: 'Matrícula' },
    { id: 'nome', titulo: 'Nome', render: (m: any) => <><strong>{m.nome}</strong>{m.nome_guerra && <span className="nota"> · {m.nome_guerra}</span>}</> },
    ...(escopo ? [] : [{ id: 'ome_sigla', titulo: 'OME' }]),
    editar ? {
      id: 'secao_nome', titulo: 'Seção', ordenavel: false,
      render: (m: any) => (
        <span onClick={(e) => e.stopPropagation()}>
          <select value={m.secao_id || ''} onChange={(e) => salvarCampo(m, 'secao_id', e.target.value ? Number(e.target.value) : '', { secao_nome: secoes.find((s) => String(s.id) === e.target.value)?.nome || null })}>
            <option value="">—</option>{secoes.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </span>),
    } : { id: 'secao_nome', titulo: 'Seção' },
    editar ? {
      id: 'atividade', titulo: 'Atividade', ordenavel: false,
      render: (m: any) => (
        <span onClick={(e) => e.stopPropagation()}>
          <select value={m.atividade || ''} onChange={(e) => salvarCampo(m, 'atividade', e.target.value)}>
            <option value="">—</option><option value="OPERACIONAL">Operacional</option><option value="ADMINISTRATIVO">Administrativo</option>
          </select>
        </span>),
    } : { id: 'atividade', titulo: 'Atividade', render: (m: any) => ATIVIDADE[m.atividade] || <span className="nota">—</span> },
    editar ? {
      id: 'telefone1', titulo: 'Telefone', ordenavel: false,
      render: (m: any) => (
        <span onClick={(e) => e.stopPropagation()}>
          <input defaultValue={m.telefone1 || ''} placeholder="(81) 9XXXX-XXXX" style={{ width: 140 }}
            onBlur={(e) => { const v = mascaraTelefone(e.target.value); e.target.value = v; if (v !== (m.telefone1 || '')) salvarCampo(m, 'telefone1', v); }} />
        </span>),
    } : null,
    { id: 'situacao_hoje', titulo: 'Hoje', valor: (m: any) => (m.afastado_hoje ? 1 : 0), render: situacaoHoje },
    { id: 'marc', titulo: '', ordenavel: false, render: marcadores },
    { id: 'completude', titulo: 'Cadastro', render: (m: any) => <Completude v={m.completude} pend={m.pendencias} /> },
  ].filter(Boolean);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Efetivo</h1>
          <p className="sub">{dados ? `${filtrados.length} de ${dados.length} militares` : 'Carregando…'} · {nomeEscopo} · ordem de antiguidade{atualizando && dados ? ' · atualizando…' : ''}</p>
        </div>
        <div className="acoes">
          <Botao onClick={() => setExportar('filtro')} disabled={!filtrados.length}>Exportar Excel / PDF</Botao>
          {editavelEscopo && <Botao variante={editar ? 'primario' : 'secundario'} onClick={() => setEditar(!editar)}>{editar ? 'Concluir edição' : 'Editar na tabela'}</Botao>}
          {podeIncluir && <Botao onClick={() => setReceber(true)}>Receber transferido</Botao>}
          {podeIncluir && <Botao variante="primario" onClick={() => nav('/militar/novo')}>+ Novo militar</Botao>}
        </div>
      </div>

      <div className="atalhos">
        {ATALHOS.map((a) => (
          <button key={a.id} className={`atalho ${f.condicao === a.id ? 'ativo' : ''}`} onClick={() => set('condicao', a.id)}>
            {a.rotulo} <span>{contagem[a.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="filtros">
        <Campo rotulo="Buscar"><input placeholder="Nome, nome de guerra ou matrícula" value={busca} onChange={(e) => setBusca(e.target.value)} /></Campo>
        <Campo rotulo="Posto/Grad.">
          <select value={f.posto} onChange={(e) => set('posto', e.target.value)}>
            <option value="">Todos</option>
            {dom?.postos.map((x) => <option key={x.id} value={x.id}>{x.sigla}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Quadro">
          <select value={f.quadro} onChange={(e) => set('quadro', e.target.value)}>
            <option value="">Todos</option>
            {dom?.quadros.map((x) => <option key={x.sigla} value={x.sigla}>{x.sigla}</option>)}
            <option value="PRACA">Praças</option>
          </select>
        </Campo>
        {!escopo && temRegioes && (
          <Campo rotulo="Região">
            <select value={f.regiao} onChange={(e) => set('regiao', e.target.value)}>
              <option value="">Todas</option>
              {regioes.lista.map((r) => <option key={r.rotulo} value={r.rotulo}>{r.rotulo}</option>)}
            </select>
          </Campo>
        )}
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
        <Campo rotulo="Escolaridade mínima">
          <select value={f.esc} onChange={(e) => set('esc', e.target.value)}>
            <option value="">Todas</option><option value="-">(não informada)</option>
            {dom?.niveis.map((n) => <option key={n.id} value={n.ordem}>{n.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Área de formação"><input placeholder="ex.: engenharia" value={f.area} onChange={(e) => set('area', e.target.value)} /></Campo>
        <Campo rotulo="Situação">
          <select value={f.situacao} onChange={(e) => set('situacao', e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(SITUACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        {params.toString() && <button className="link" onClick={() => { setBusca(''); setParams(new URLSearchParams(), { replace: true }); }}>limpar filtros</button>}
      </div>

      {dados && filtrados.length > 0 && (
        <div className="resumo-linha">
          <span><strong>{filtrados.length}</strong> militares</span>
          <span>{resumo.op} operacional · {resumo.adm} administrativo{filtrados.length - resumo.op - resumo.adm ? ` · ${filtrados.length - resumo.op - resumo.adm} sem atividade` : ''}</span>
          <span>{resumo.af} afastado(s) hoje</span>
          <span className="resumo-postos">{resumo.porPosto.map(([s, n]) => <Badge key={s}>{s} {n}</Badge>)}</span>
        </div>
      )}

      {sel.size > 0 && (
        <div className="barra-lote">
          <strong>{selecionados.length} selecionado(s)</strong>
          {selEditaveis.length < selecionados.length && <span className="nota">{selecionados.length - selEditaveis.length} sem permissão de edição</span>}
          <Botao pequeno disabled={omesSel.size !== 1} title={omesSel.size !== 1 ? 'Selecione militares de uma única OME' : ''} onClick={() => setLote('secao')}>Alterar seção</Botao>
          <Botao pequeno disabled={!selEditaveis.length} onClick={() => setLote('atividade')}>Alterar atividade</Botao>
          <Botao pequeno disabled={!selEditaveis.length} onClick={() => setLote('afastamento')}>Lançar afastamento</Botao>
          <Botao pequeno disabled={!selEditaveis.length} onClick={async () => {
            try { const c = await rpc<string>('competencia_atual'); const n = await rpc<number>('conferir_militares', { p_competencia: c, p_militares: selEditaveis.map((m) => m.id), p_conferido: true }); toast(`${n} militar(es) marcados como conferidos.`); invalidar('conferencia'); }
            catch (e) { toast(msgErro(e), 'erro'); }
          }}>Marcar conferidos</Botao>
          <Botao pequeno onClick={() => setExportar('selecao')}>Exportar selecionados</Botao>
          <button className="link" onClick={() => setSel(new Set())}>limpar seleção</button>
        </div>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {carregando || !dados ? <Carregando /> : (
        <Tabela linhas={filtrados} chave={(m: any) => m.id} onLinha={editar ? undefined : (m: any) => nav(`/militar/${m.id}`)}
          linhaClasse={(m: any) => (sel.has(m.id) ? 'selecionada' : '')} colunas={colunasTabela} />
      )}

      <ReceberMilitar aberto={receber} onFechar={() => setReceber(false)} />
      <Exportar aberto={!!exportar} onFechar={() => setExportar('')} arquivo="efetivo"
        titulo="Efetivo" subtitulo={`${nomeEscopo}${filtroTexto ? ' — ' + filtroTexto : ''}${exportar === 'selecao' ? ' — seleção' : ''}`}
        qtd={exportar === 'selecao' ? selecionados.length : filtrados.length} colunas={COLUNAS_EFETIVO}
        obterLinhas={obterLinhas(exportar === 'selecao' ? selecionados : filtrados)}
        agrupamentos={[
          { id: 'ome', rotulo: 'OME', fn: (r) => r.ome_sigla, ordem: (r) => ordemOme(r.ome_id) },
          { id: 'secao', rotulo: 'OME e seção', fn: (r) => `${r.ome_sigla} — ${r.secao_nome || '(sem seção)'}`, ordem: (r) => `${ordemOme(r.ome_id)}|${String(ordemSecao(r.secao_id)).padStart(4, '0')}` },
          { id: 'posto', rotulo: 'Posto/graduação', fn: (r) => r.posto_sigla, ordem: (r) => String(r.posto_ordem).padStart(2, '0') }]} />
      <AcaoLote tipo={lote} onFechar={() => setLote('')} militares={selEditaveis} onFeito={() => { setLote(''); invalidar('efetivo'); invalidar('painel'); }} />
    </div>
  );
}

// ---------------- ações em lote ----------------
function AcaoLote({ tipo, onFechar, militares, onFeito }: { tipo: string; onFechar: () => void; militares: any[]; onFeito: () => void }) {
  const dom = useDominios();
  const toast = useToast();
  const [v, setV] = useState<any>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setV({ data_inicio: hojeISO(), dias: 30 }); setErro(null); }, [tipo]);
  if (!tipo) return null;
  const ome = militares[0]?.ome_id;
  const executar = async () => {
    setErro(null); setSalvando(true);
    try {
      const ids = militares.map((m) => m.id);
      if (tipo === 'secao') {
        const { error } = await supabase.from('militar').update({ secao_id: v.secao ? Number(v.secao) : null }).in('id', ids);
        if (error) throw error;
      } else if (tipo === 'atividade') {
        if (!v.atividade) throw new Error('Escolha a atividade.');
        const { error } = await supabase.from('militar').update({ atividade: v.atividade }).in('id', ids);
        if (error) throw error;
      } else {
        if (!v.tipo_id || !v.data_inicio || !(Number(v.dias) > 0)) throw new Error('Preencha tipo, início e dias.');
        const { error } = await supabase.from('afastamento').insert(ids.map((id) => ({
          militar_id: id, tipo_id: Number(v.tipo_id), data_inicio: v.data_inicio, dias: Number(v.dias), processo_sei: v.processo || null, observacao: v.obs || null,
        })));
        if (error) throw error;
      }
      toast(`${ids.length} militar(es) atualizado(s).`);
      onFeito();
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  };
  const titulo = tipo === 'secao' ? 'Alterar seção' : tipo === 'atividade' ? 'Alterar atividade' : 'Lançar afastamento para todos';
  return (
    <Modal aberto titulo={`${titulo} · ${militares.length} militar(es)`} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={executar}>Aplicar</Botao></>}>
      <div className="form-grade">
        {tipo === 'secao' && (
          <Campo rotulo="Nova seção" largura="meia">
            <select value={v.secao || ''} onChange={(e) => setV({ ...v, secao: e.target.value })}>
              <option value="">(sem seção)</option>{secoesDa(dom, ome).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </Campo>
        )}
        {tipo === 'atividade' && (
          <Campo rotulo="Atividade" largura="meia">
            <select value={v.atividade || ''} onChange={(e) => setV({ ...v, atividade: e.target.value })}>
              <option value="">Selecione</option><option value="OPERACIONAL">Operacional</option><option value="ADMINISTRATIVO">Administrativo</option>
            </select>
          </Campo>
        )}
        {tipo === 'afastamento' && <>
          <Campo rotulo="Tipo *" largura="meia">
            <select value={v.tipo_id || ''} onChange={(e) => setV({ ...v, tipo_id: e.target.value })}>
              <option value="">Selecione</option>{dom?.tiposAfast.filter((t) => t.ativo && t.codigo !== 'FERIAS').map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Início *"><input type="date" value={v.data_inicio} onChange={(e) => setV({ ...v, data_inicio: e.target.value })} /></Campo>
          <Campo rotulo="Dias *"><input type="number" min={1} value={v.dias} onChange={(e) => setV({ ...v, dias: e.target.value })} /></Campo>
          <Campo rotulo="Processo SEI" largura="meia"><input value={v.processo || ''} onChange={(e) => setV({ ...v, processo: e.target.value })} /></Campo>
          <Campo rotulo="Observação" largura="meia"><input value={v.obs || ''} onChange={(e) => setV({ ...v, obs: e.target.value })} placeholder="ex.: Curso de formação, férias da turma B" /></Campo>
        </>}
      </div>
      <p className="nota">{militares.slice(0, 8).map((m) => `${m.posto_completo} ${m.nome_guerra || m.nome}`).join(', ')}{militares.length > 8 ? ` e mais ${militares.length - 8}` : ''}</p>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}

// ---------------- receber militar transferido ----------------
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
      invalidar('efetivo'); invalidar('painel');
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
