import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useDominios } from '../lib/dominios';
import { invalidar, useConsulta } from '../lib/consulta';
import {
  COMPORTAMENTO, ORDEM_COMPORTAMENTO, buscarTodos, exportarXlsx, fmtData, hojeISO, msgErro, normMatricula, semAcento, somaDias,
} from '../lib/util';
import { Abas, Aviso, Badge, Botao, Campo, Cartao, Carregando, Kpi, Modal, Tabela, useToast } from '../components/ui';
import { BadgeComportamento, MOTIVO_CANCEL, NATUREZA_PUN, situacaoComp } from './Militar';

// Comportamento das praças: Lei 11.817/2000 (arts. 45-49 e 60-64) e Decreto 50.014/2020.
// O oficial é o publicado em boletim; o sistema calcula a escala móvel e mostra o que falta publicar.

const nomeComp = (c?: string | null) => (c ? COMPORTAMENTO[c] || c : '—');
const rotuloParaCodigo = (t?: string | null) => {
  const k = semAcento(t || '').toUpperCase().trim();
  return ORDEM_COMPORTAMENTO.find((c) => c === k || semAcento(COMPORTAMENTO[c]).toUpperCase() === k) || null;
};

export default function Comportamento() {
  const { escopo, gestaoGlobal, admin } = useAuth();
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba') || 'publicar';
  const setAba = (a: string) => setParams({ aba: a }, { replace: true });
  const lista = useConsulta(`comp:${escopo ?? 'todas'}`, () => buscarTodos<any>(() => {
    let q = supabase.from('v_comportamento').select('*').order('posto_ordem').order('ordem_antiguidade', { nullsFirst: false }).order('militar_id');
    if (escopo) q = q.eq('ome_id', escopo);
    return q;
  }), 120_000);

  const hoje = hojeISO();
  const k = useMemo(() => {
    const l = lista.dados || [];
    const umAno = somaDias(hoje, -365), em90 = somaDias(hoje, 90);
    const dist: Record<string, number> = {};
    for (const r of l) dist[r.publicado || '_'] = (dist[r.publicado || '_'] || 0) + 1;
    return {
      total: l.length, comBase: l.filter((r) => r.publicado).length, dist,
      melhoria: l.filter((r) => r.situacao === 'MELHORIA').length, rebaixamento: l.filter((r) => r.situacao === 'REBAIXAMENTO').length,
      proximas: l.filter((r) => r.proxima_data && r.proxima_data <= em90).length,
      mauAno: l.filter((r) => r.calculado === 'MAU' && r.desde && r.desde <= umAno).length,
      estimada: l.filter((r) => r.base_estimada).length, semData: l.filter((r) => r.punicoes_sem_data > 0).length,
    };
  }, [lista.dados, hoje]);

  if (lista.erro) return <div className="pagina"><Aviso tom="erro">{msgErro(lista.erro)} — a versão 1.4 do banco já foi aplicada?</Aviso></div>;
  if (!lista.dados) return <div className="pagina"><Carregando /></div>;
  const podeImportar = gestaoGlobal;   // comportamento e punições: só a DGP lança (1.4.1)

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Comportamento</h1>
          <p className="sub">Praças da ativa · Lei 11.817/2000 e Decreto 50.014/2020 · o oficial é o publicado em boletim; o sistema calcula a escala móvel</p>
        </div>
      </div>

      {!gestaoGlobal && <p className="nota so-dgp">Consulta: comportamento e punições são lançados e alterados somente pela DGP.</p>}
      {k.comBase < k.total && (
        <Aviso tom="alerta">{(k.total - k.comBase).toLocaleString('pt-BR')} de {k.total.toLocaleString('pt-BR')} praças ainda sem comportamento publicado cadastrado. Enquanto faltar, o cálculo considera só as punições lançadas no sistema. {podeImportar && <button className="link" onClick={() => setAba('importar')}>Importar pela planilha</button>}</Aviso>
      )}

      <div className="kpis">
        <Kpi rotulo="Praças" valor={k.total.toLocaleString('pt-BR')} detalhe={`${k.comBase.toLocaleString('pt-BR')} com comportamento publicado cadastrado`} />
        <Kpi rotulo="Melhorias a publicar" valor={k.melhoria} detalhe="o cálculo já alcançou classe melhor" tom={k.melhoria ? 'alerta' : 'ok'} onClick={() => setAba('publicar')} />
        <Kpi rotulo="Reclassificações a publicar" valor={k.rebaixamento} detalhe="punições levam a classe pior" tom={k.rebaixamento ? 'alerta' : 'ok'} onClick={() => setAba('publicar')} />
        <Kpi rotulo="Mudanças em 90 dias" valor={k.proximas} detalhe="escala móvel, se não houver nova punição" onClick={() => setAba('proximas')} />
        <Kpi rotulo="Mau há 1 ano ou mais" valor={k.mauAno} detalhe="Decreto 50.014, art. 3º, IV" tom={k.mauAno ? 'alerta' : undefined} onClick={() => { setAba('todas'); }} />
      </div>

      <Cartao titulo="Comportamento publicado">
        <div className="dist-comp">
          {[...ORDEM_COMPORTAMENTO, '_'].map((c) => {
            const n = k.dist[c] || 0;
            return (
              <div key={c} className={`dist-item comp-${c === '_' ? 'sem' : c.toLowerCase()}`} style={{ flexGrow: Math.max(n, k.total / 60) }} title={`${c === '_' ? 'Sem registro' : nomeComp(c)}: ${n}`}>
                <strong>{n.toLocaleString('pt-BR')}</strong><span>{c === '_' ? 'sem registro' : nomeComp(c)}</span>
              </div>
            );
          })}
        </div>
      </Cartao>

      <Abas ativa={aba} onChange={setAba} abas={[
        { id: 'publicar', rotulo: `A publicar (${k.melhoria + k.rebaixamento})` }, { id: 'proximas', rotulo: 'Próximas mudanças' },
        { id: 'todas', rotulo: 'Todas as praças' }, ...(podeImportar ? [{ id: 'importar', rotulo: 'Importar' }] : []), { id: 'regras', rotulo: 'Regras do cálculo' },
      ]} />
      {aba === 'publicar' && <APublicar linhas={lista.dados.filter((r) => r.situacao === 'MELHORIA' || r.situacao === 'REBAIXAMENTO')} />}
      {aba === 'proximas' && <Proximas linhas={lista.dados} />}
      {aba === 'todas' && <Todas linhas={lista.dados} />}
      {aba === 'importar' && podeImportar && <Importar pracas={lista.dados} />}
      {aba === 'regras' && <Regras admin={admin} />}
    </div>
  );
}

// ---------------------------------------------------------------------
const colPraca = [
  { id: 'posto_sigla', titulo: 'Posto/Grad.', valor: (r: any) => r.posto_ordem * 100000 + (r.ordem_antiguidade ?? 99999) },
  { id: 'nome', titulo: 'Nome', render: (r: any) => <Link to={`/militar/${r.militar_id}?aba=punicoes`} onClick={(e) => e.stopPropagation()}>{r.nome}</Link> },
  { id: 'matricula', titulo: 'Matrícula' },
  { id: 'ome_sigla', titulo: 'OME' },
];

function APublicar({ linhas }: { linhas: any[] }) {
  const { podeEditarOme: podeOme, gestaoGlobal } = useAuth();
  const podeEditarOme = (ome: number) => gestaoGlobal && podeOme(ome);
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState(false);
  const [pub, setPub] = useState('');
  const [gravando, setGravando] = useState(false);
  const editaveis = linhas.filter((r) => podeEditarOme(r.ome_id));
  const alterna = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exportar = () => exportarXlsx('comportamento_a_publicar', 'Comportamento a publicar', [
    { titulo: 'Posto/Grad.', valor: (r: any) => r.posto_sigla, largura: 10 }, { titulo: 'Matrícula', valor: (r: any) => r.matricula, largura: 11 },
    { titulo: 'Nome', valor: (r: any) => r.nome, largura: 38 }, { titulo: 'OME', valor: (r: any) => r.ome_sigla, largura: 12 },
    { titulo: 'Publicado', valor: (r: any) => nomeComp(r.publicado), largura: 13 }, { titulo: 'Publicado em', valor: (r: any) => fmtData(r.publicado_data), largura: 12 },
    { titulo: 'Passa a', valor: (r: any) => nomeComp(r.calculado), largura: 13 }, { titulo: 'A contar de', valor: (r: any) => fmtData(r.desde), largura: 12 },
    { titulo: 'Tipo', valor: (r: any) => (r.situacao === 'MELHORIA' ? 'Melhoria' : 'Reclassificação'), largura: 15 },
    { titulo: 'Base estimada', valor: (r: any) => (r.base_estimada ? 'Sim' : ''), largura: 12 },
  ], linhas, (r: any) => r.ome_sigla);
  const registrar = async () => {
    if (!pub.trim()) return toast('Informe a publicação (boletim).', 'erro');
    const itens = linhas.filter((r) => sel.has(r.militar_id) && podeEditarOme(r.ome_id))
      .map((r) => ({ militar_id: r.militar_id, comportamento: r.calculado, data_vigencia: r.desde || hojeISO(), publicacao: pub.trim(), origem: 'RECLASSIFICACAO' }));
    setGravando(true);
    try {
      for (let i = 0; i < itens.length; i += 500) {
        const { error } = await supabase.from('comportamento_publicado').insert(itens.slice(i, i + 500));
        if (error) throw error;
      }
      toast(`${itens.length} publicação(ões) registrada(s).`);
      setModal(false); setSel(new Set()); setPub(''); invalidar('comp:');
    } catch (e) { toast(msgErro(e), 'erro'); } finally { setGravando(false); }
  };
  return (
    <Cartao titulo="Melhorias e reclassificações a publicar" acoes={<>
      <Botao pequeno onClick={exportar} disabled={!linhas.length}>Exportar para a nota do boletim</Botao>
      {editaveis.length > 0 && <Botao pequeno variante="primario" disabled={!sel.size} onClick={() => setModal(true)}>Registrar publicação ({sel.size})</Botao>}
    </>}>
      <p className="nota">A data "a contar de" é a do cálculo: fim da janela da última punição, cancelamento ou tempo de serviço. Confira as marcadas com "base estimada" antes de publicar.</p>
      {editaveis.length > 0 && <p className="nota"><button className="link" onClick={() => setSel(new Set(editaveis.map((r) => r.militar_id)))}>selecionar todas</button> · <button className="link" onClick={() => setSel(new Set())}>limpar seleção</button></p>}
      <Tabela linhas={linhas} chave={(r: any) => r.militar_id} compacta vazio="Nada a publicar: o publicado confere com o cálculo." colunas={[
        { id: 'sel', titulo: '', ordenavel: false, render: (r: any) => podeEditarOme(r.ome_id) ? <input type="checkbox" aria-label={`Selecionar ${r.nome}`} checked={sel.has(r.militar_id)} onChange={() => alterna(r.militar_id)} /> : null },
        ...colPraca,
        { id: 'publicado', titulo: 'Publicado', valor: (r: any) => ORDEM_COMPORTAMENTO.indexOf(r.publicado), render: (r: any) => <><BadgeComportamento c={r.publicado} /> <span className="nota">{fmtData(r.publicado_data)}</span></> },
        { id: 'calculado', titulo: 'Passa a', valor: (r: any) => ORDEM_COMPORTAMENTO.indexOf(r.calculado), render: (r: any) => <BadgeComportamento c={r.calculado} /> },
        { id: 'desde', titulo: 'A contar de', render: (r: any) => fmtData(r.desde) },
        { id: 'situacao', titulo: 'Tipo', render: (r: any) => <>{situacaoComp(r.situacao)}{r.base_estimada ? <> <Badge tom="amarelo" title="As punições cadastradas não explicam o publicado: o cálculo supõe o pior caso">base estimada</Badge></> : null}</> },
      ]} />
      {modal && (
        <Modal aberto titulo="Registrar publicação" onFechar={() => setModal(false)}
          rodape={<><Botao onClick={() => setModal(false)}>Cancelar</Botao><Botao variante="primario" disabled={gravando} onClick={registrar}>{gravando ? 'Gravando…' : `Registrar ${sel.size}`}</Botao></>}>
          <p>Cada praça selecionada passa a ter o comportamento calculado, a contar da data indicada na lista.</p>
          <Campo rotulo="Publicação *" dica="Boletim que publicou a reclassificação/melhoria" largura="inteira">
            <input value={pub} onChange={(e) => setPub(e.target.value)} placeholder="ex.: BGE nº 230 de 10/12/2026" autoFocus />
          </Campo>
        </Modal>
      )}
    </Cartao>
  );
}

function Proximas({ linhas }: { linhas: any[] }) {
  const [dias, setDias] = useState(90);
  const ate = somaDias(hojeISO(), dias);
  const l = linhas.filter((r) => r.proxima_data && r.proxima_data <= ate).sort((a, b) => a.proxima_data.localeCompare(b.proxima_data));
  return (
    <Cartao titulo="Próximas mudanças pela escala móvel" acoes={
      <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período">
        {[30, 90, 180, 365].map((d) => <option key={d} value={d}>próximos {d} dias</option>)}
      </select>}>
      <p className="nota">Mudança prevista se a praça não sofrer nova punição até a data (Lei 11.817, art. 47).</p>
      <Tabela linhas={l} chave={(r: any) => r.militar_id} compacta vazio="Nenhuma mudança prevista no período." colunas={[
        ...colPraca,
        { id: 'calculado', titulo: 'Hoje', valor: (r: any) => ORDEM_COMPORTAMENTO.indexOf(r.calculado), render: (r: any) => <BadgeComportamento c={r.calculado} /> },
        { id: 'proximo', titulo: 'Passa a', valor: (r: any) => ORDEM_COMPORTAMENTO.indexOf(r.proximo), render: (r: any) => <BadgeComportamento c={r.proximo} /> },
        { id: 'proxima_data', titulo: 'Em', render: (r: any) => fmtData(r.proxima_data) },
      ]} ordemInicial={{ id: 'proxima_data', asc: true }} />
    </Cartao>
  );
}

const PENDENCIAS: Record<string, { rotulo: string; f: (r: any) => boolean }> = {
  SEM_BASE: { rotulo: 'Sem comportamento publicado', f: (r) => r.situacao === 'SEM_BASE' },
  ESTIMADA: { rotulo: 'Base estimada (faltam punições anteriores)', f: (r) => r.base_estimada },
  SEM_DATA: { rotulo: 'Punição sem data', f: (r) => r.punicoes_sem_data > 0 },
  MAU_ANO: { rotulo: 'Mau há 1 ano ou mais', f: (r) => r.calculado === 'MAU' && r.desde && r.desde <= somaDias(hojeISO(), -365) },
};

function Todas({ linhas }: { linhas: any[] }) {
  const [busca, setBusca] = useState('');
  const [comp, setComp] = useState('');
  const [qual, setQual] = useState<'publicado' | 'calculado'>('publicado');
  const [pend, setPend] = useState('');
  const b = semAcento(busca);
  const l = linhas.filter((r) => (!b || semAcento(`${r.nome} ${r.nome_guerra || ''} ${r.matricula}`).includes(b))
    && (!comp || (comp === '_' ? !r[qual] : r[qual] === comp)) && (!pend || PENDENCIAS[pend].f(r)));
  const exportar = () => exportarXlsx('comportamento', 'Comportamento das praças', [
    { titulo: 'Posto/Grad.', valor: (r: any) => r.posto_sigla, largura: 10 }, { titulo: 'Matrícula', valor: (r: any) => r.matricula, largura: 11 },
    { titulo: 'Nome', valor: (r: any) => r.nome, largura: 38 }, { titulo: 'OME', valor: (r: any) => r.ome_sigla, largura: 12 },
    { titulo: 'Publicado', valor: (r: any) => nomeComp(r.publicado), largura: 13 }, { titulo: 'Publicado em', valor: (r: any) => fmtData(r.publicado_data), largura: 12 },
    { titulo: 'Publicação', valor: (r: any) => r.publicado_publicacao || '', largura: 22 },
    { titulo: 'Calculado', valor: (r: any) => nomeComp(r.calculado), largura: 13 }, { titulo: 'Desde', valor: (r: any) => fmtData(r.desde), largura: 12 },
    { titulo: 'Próxima mudança', valor: (r: any) => (r.proxima_data ? `${nomeComp(r.proximo)} em ${fmtData(r.proxima_data)}` : ''), largura: 24 },
  ], l, (r: any) => r.ome_sigla);
  return (
    <>
      <div className="filtros">
        <Campo rotulo="Buscar"><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome, nome de guerra ou matrícula" /></Campo>
        <Campo rotulo="Comportamento">
          <select value={comp} onChange={(e) => setComp(e.target.value)}>
            <option value="">todos</option>{ORDEM_COMPORTAMENTO.map((c) => <option key={c} value={c}>{nomeComp(c)}</option>)}<option value="_">sem registro</option>
          </select>
        </Campo>
        <Campo rotulo="Considerar">
          <select value={qual} onChange={(e) => setQual(e.target.value as any)}><option value="publicado">o publicado</option><option value="calculado">o calculado</option></select>
        </Campo>
        <Campo rotulo="Pendência">
          <select value={pend} onChange={(e) => setPend(e.target.value)}>
            <option value="">qualquer</option>{Object.entries(PENDENCIAS).map(([k, p]) => <option key={k} value={k}>{p.rotulo}</option>)}
          </select>
        </Campo>
        <Botao onClick={exportar} disabled={!l.length}>Exportar Excel</Botao>
      </div>
      <Cartao titulo={`${l.length.toLocaleString('pt-BR')} praça(s)`}>
        <Tabela linhas={l} chave={(r: any) => r.militar_id} compacta colunas={[
          ...colPraca,
          { id: 'publicado', titulo: 'Publicado', valor: (r: any) => ORDEM_COMPORTAMENTO.indexOf(r.publicado), render: (r: any) => <><BadgeComportamento c={r.publicado} /> <span className="nota">{fmtData(r.publicado_data)}</span></> },
          { id: 'calculado', titulo: 'Calculado', valor: (r: any) => ORDEM_COMPORTAMENTO.indexOf(r.calculado), render: (r: any) => <BadgeComportamento c={r.calculado} /> },
          { id: 'situacao', titulo: 'Situação', render: (r: any) => situacaoComp(r.situacao) },
          { id: 'proxima_data', titulo: 'Próxima mudança', render: (r: any) => (r.proxima_data ? <span className="nota">{nomeComp(r.proximo)} em {fmtData(r.proxima_data)}</span> : '') },
        ]} />
      </Cartao>
    </>
  );
}

// ---------------------------------------------------------------------
const COLS_COMP = ['Matrícula', 'Posto/Grad.', 'Nome', 'OME', 'Comportamento', 'A contar de', 'Publicação', 'Observação'];
const COLS_PUN = ['Matrícula', 'Nome', 'Tipo', 'Natureza', 'Data da publicação', 'Publicação', 'Início do cumprimento', 'Dias',
  'Fim do cumprimento', 'Processo', 'Cancelada em', 'Motivo do cancelamento', 'Publicação do cancelamento', 'Observação'];

function Importar({ pracas }: { pracas: any[] }) {
  const { podeEditarOme, escopo } = useAuth();
  const dom = useDominios();
  const toast = useToast();
  const nav = useNavigate();
  const refC = useRef<HTMLInputElement>(null), refP = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<null | { tipo: 'comp' | 'pun'; ok: any[]; erros: { linha: number; msg: string }[]; iguais: number }>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const editaveis = pracas.filter((r) => podeEditarOme(r.ome_id));

  const baixarComp = async () => {
    const { gerarModelo } = await import('../lib/excel');
    await gerarModelo('modelo_comportamento', 'Comportamento', COLS_COMP.map((t) => ({
      titulo: t, largura: t === 'Nome' ? 38 : t === 'Publicação' || t === 'Observação' ? 26 : 13,
      lista: t === 'Comportamento' ? ORDEM_COMPORTAMENTO.map((c) => COMPORTAMENTO[c]) : undefined, data: t === 'A contar de',
    })), editaveis.map((r) => [r.matricula, r.posto_sigla, r.nome, r.ome_sigla, r.publicado ? COMPORTAMENTO[r.publicado] : '', r.publicado_data || '', r.publicado_publicacao || '', '']), [
      'COMPORTAMENTO PUBLICADO DAS PRAÇAS — modelo para preencher',
      'Uma linha por praça, já listadas as das OMEs que você administra. Preencha o ÚLTIMO comportamento publicado em boletim:',
      '  • Comportamento: Excepcional, Ótimo, Bom, Insuficiente ou Mau;  • A contar de: a data da classificação (dd/mm/aaaa);  • Publicação: o boletim (ex.: BI nº 160 de 01/09/2025).',
      'Linhas sem comportamento ou sem data são ignoradas. Linhas iguais ao que já está no sistema também.',
      'Praça incluída há menos de 4 anos e nunca punida: Bom desde a data de inclusão (Lei 11.817/2000, art. 45 §2).',
      'Volte em Comportamento > Importar > "Enviar planilha preenchida".',
    ]);
  };
  const baixarPun = async () => {
    const { gerarModelo } = await import('../lib/excel');
    await gerarModelo('modelo_punicoes', 'Punições', COLS_PUN.map((t) => ({
      titulo: t, largura: t === 'Nome' ? 34 : t.startsWith('Publicação') || t === 'Observação' || t === 'Processo' ? 24 : t === 'Tipo' || t === 'Motivo do cancelamento' ? 30 : 13,
      lista: t === 'Tipo' ? (dom?.tiposPun || []).filter((x) => x.ativo).map((x) => x.nome) : t === 'Natureza' ? Object.values(NATUREZA_PUN) : t === 'Motivo do cancelamento' ? Object.values(MOTIVO_CANCEL) : undefined,
      data: ['Data da publicação', 'Início do cumprimento', 'Fim do cumprimento', 'Cancelada em'].includes(t),
    })), [], [
      'PUNIÇÕES DISCIPLINARES — modelo para preencher (últimos 6 anos bastam para o comportamento)',
      'Uma linha por punição. O nome é só para conferência: vale a matrícula.',
      '  • Data da publicação: do ato punitivo depois dos recursos. Desde 27/12/2020 a pena conta a partir dela (Decreto 50.014/2020, art. 9º).',
      '  • Início do cumprimento e Dias: para penas publicadas até 26/12/2020, que contam do fim do cumprimento (Lei 11.817/2000, art. 48).',
      '  • Cancelada em / Motivo / Publicação do cancelamento: para penas canceladas (arts. 60-64) ou anuladas por elogio (art. 67 §9).',
      'Advertência é verbal e não vai à ficha (art. 28 §3). Punições iguais às já cadastradas são ignoradas.',
    ]);
  };

  const ler = async (f: File, tipo: 'comp' | 'pun') => {
    setOcupado('Lendo a planilha…'); setPrevia(null);
    try {
      const { lerModelo } = await import('../lib/excel');
      if (tipo === 'comp') {
        const linhas = await lerModelo(f, 'Comportamento', ['A contar de']);
        const porMat = new Map(pracas.map((r) => [r.matricula, r]));
        const ok: any[] = []; const erros: { linha: number; msg: string }[] = []; let iguais = 0;
        for (const { linha, v } of linhas) {
          const mat = normMatricula(v['Matrícula']);
          if (!v['Comportamento'] && !v['A contar de']) continue;
          const r = porMat.get(mat);
          if (!r) { erros.push({ linha, msg: `Matrícula ${mat || '(vazia)'} não é praça ativa visível para você` }); continue; }
          if (!podeEditarOme(r.ome_id)) { erros.push({ linha, msg: `${mat}: sem permissão na ${r.ome_sigla}` }); continue; }
          const c = rotuloParaCodigo(v['Comportamento']);
          if (!c) { erros.push({ linha, msg: `${mat}: comportamento "${v['Comportamento'] || ''}" não reconhecido` }); continue; }
          const d = v['A contar de'];
          if (!d || d.startsWith('!')) { erros.push({ linha, msg: `${mat}: data "${(d || '').replace('!', '')}" inválida` }); continue; }
          if (d > hojeISO()) { erros.push({ linha, msg: `${mat}: data no futuro` }); continue; }
          if (r.publicado === c && r.publicado_data === d) { iguais++; continue; }
          ok.push({ militar_id: r.militar_id, comportamento: c, data_vigencia: d, publicacao: v['Publicação'], observacao: v['Observação'], origem: 'IMPORTACAO', _r: r });
        }
        setPrevia({ tipo, ok, erros, iguais });
      } else {
        const linhas = await lerModelo(f, 'Punições', ['Data da publicação', 'Início do cumprimento', 'Fim do cumprimento', 'Cancelada em']);
        const [mil, exist] = await Promise.all([
          buscarTodos<any>(() => supabase.from('militar').select('id,matricula,ome_id,situacao').order('id')),
          buscarTodos<any>(() => supabase.from('punicao').select('militar_id,tipo_id,data_publicacao,data_inicio').order('id')),
        ]);
        const porMat = new Map(mil.map((m) => [m.matricula, m]));
        const chave = (p: any) => `${p.militar_id}|${p.tipo_id}|${p.data_publicacao || ''}|${p.data_inicio || ''}`;
        const ja = new Set(exist.map(chave));
        const tipos = new Map((dom?.tiposPun || []).map((t) => [semAcento(t.nome), t]));
        const nat = new Map(Object.entries(NATUREZA_PUN).map(([k2, t]) => [semAcento(t), k2]));
        const mot = new Map(Object.entries(MOTIVO_CANCEL).map(([k2, t]) => [semAcento(t), k2]));
        const ok: any[] = []; const erros: { linha: number; msg: string }[] = []; let iguais = 0;
        for (const { linha, v } of linhas) {
          const mat = normMatricula(v['Matrícula']);
          const m = porMat.get(mat);
          if (!m) { erros.push({ linha, msg: `Matrícula ${mat || '(vazia)'} não encontrada entre os militares visíveis para você` }); continue; }
          if (!podeEditarOme(m.ome_id)) { erros.push({ linha, msg: `${mat}: sem permissão na OME do militar` }); continue; }
          const t = tipos.get(semAcento(v['Tipo'] || ''));
          if (!t) { erros.push({ linha, msg: `${mat}: tipo "${v['Tipo'] || ''}" não reconhecido` }); continue; }
          const datas = ['Data da publicação', 'Início do cumprimento', 'Fim do cumprimento', 'Cancelada em'];
          const ruim = datas.find((d) => v[d]?.startsWith('!'));
          if (ruim) { erros.push({ linha, msg: `${mat}: "${ruim}" com data inválida` }); continue; }
          if (!v['Data da publicação'] && !v['Início do cumprimento']) { erros.push({ linha, msg: `${mat}: informe a data da publicação (ou, até 2020, o início do cumprimento)` }); continue; }
          const motivo = v['Motivo do cancelamento'] ? mot.get(semAcento(v['Motivo do cancelamento'])) : null;
          if (!!v['Cancelada em'] !== !!motivo) { erros.push({ linha, msg: `${mat}: cancelamento precisa de data e motivo da lista` }); continue; }
          const dias = v['Dias'] ? parseInt(v['Dias'], 10) : null;
          const p = {
            militar_id: m.id, tipo_id: t.id, natureza: v['Natureza'] ? nat.get(semAcento(v['Natureza'])) || null : null,
            data_publicacao: v['Data da publicação'], publicacao: v['Publicação'], data_inicio: v['Início do cumprimento'],
            dias: dias != null && !isNaN(dias) ? dias : null, cumprimento_fim: v['Fim do cumprimento'], processo: v['Processo'],
            cancelada_em: v['Cancelada em'], cancelamento_motivo: motivo, cancelamento_publicacao: v['Publicação do cancelamento'], observacao: v['Observação'],
          };
          if (ja.has(chave(p))) { iguais++; continue; }
          ja.add(chave(p));
          ok.push({ ...p, _r: { matricula: mat, nome: v['Nome'] || '', tipo: t.nome } });
        }
        setPrevia({ tipo, ok, erros, iguais });
      }
    } catch (e) { toast(msgErro(e), 'erro'); } finally { setOcupado(null); }
  };

  const gravar = async () => {
    if (!previa) return;
    const tabela = previa.tipo === 'comp' ? 'comportamento_publicado' : 'punicao';
    const itens = previa.ok.map(({ _r, ...x }) => x);
    try {
      for (let i = 0; i < itens.length; i += 500) {
        setOcupado(`Gravando ${Math.min(i + 500, itens.length)} de ${itens.length}…`);
        const { error } = await supabase.from(tabela).insert(itens.slice(i, i + 500));
        if (error) throw error;
      }
      toast(`${itens.length} registro(s) importado(s).`);
      setPrevia(null); invalidar('comp:'); nav('/comportamento?aba=publicar');
    } catch (e) { toast(msgErro(e), 'erro'); } finally { setOcupado(null); }
  };

  return (
    <>
      <div className="grade-2">
        <Cartao titulo="1. Comportamento publicado">
          <p className="nota">Baixe a planilha com as praças {escopo ? 'da OME selecionada' : 'das OMEs que você administra'} ({editaveis.length.toLocaleString('pt-BR')}), preencha o último comportamento publicado e envie de volta.</p>
          <div className="botoes-linha">
            <Botao onClick={baixarComp} disabled={!editaveis.length}>Baixar planilha</Botao>
            <Botao variante="primario" disabled={!!ocupado} onClick={() => refC.current?.click()}>Enviar planilha preenchida</Botao>
          </div>
          <input ref={refC} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) ler(f, 'comp'); }} />
        </Cartao>
        <Cartao titulo="2. Punições (últimos 6 anos)">
          <p className="nota">Para o cálculo ficar exato. Baixe o modelo, lance uma punição por linha (matrícula, tipo, publicação) e envie.</p>
          <div className="botoes-linha">
            <Botao onClick={baixarPun}>Baixar modelo</Botao>
            <Botao variante="primario" disabled={!!ocupado} onClick={() => refP.current?.click()}>Enviar planilha preenchida</Botao>
          </div>
          <input ref={refP} type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) ler(f, 'pun'); }} />
        </Cartao>
      </div>
      {ocupado && <Carregando texto={ocupado} />}
      {previa && (
        <Cartao titulo={previa.tipo === 'comp' ? 'Prévia: comportamento publicado' : 'Prévia: punições'} acoes={
          <><Botao pequeno onClick={() => setPrevia(null)}>Descartar</Botao><Botao pequeno variante="primario" disabled={!previa.ok.length || !!ocupado} onClick={gravar}>Gravar {previa.ok.length}</Botao></>}>
          <div className="mini-kpis">
            <div><strong>{previa.ok.length}</strong><span>a gravar</span></div>
            <div><strong>{previa.iguais}</strong><span>iguais ao sistema (ignoradas)</span></div>
            <div><strong>{previa.erros.length}</strong><span>com problema (ficam de fora)</span></div>
          </div>
          {previa.erros.length > 0 && <details open={previa.erros.length <= 20}><summary>Linhas com problema</summary>
            <ul className="lista-erros">{previa.erros.slice(0, 300).map((e, i) => <li key={i}>Linha {e.linha}: {e.msg}</li>)}</ul></details>}
          {previa.ok.length > 0 && <Tabela linhas={previa.ok} chave={(r: any) => `${r.militar_id}|${r.tipo_id ?? ''}|${r.data_vigencia ?? r.data_publicacao ?? r.data_inicio}`} compacta porPagina={20}
            colunas={previa.tipo === 'comp' ? [
              { id: 'm', titulo: 'Praça', render: (r: any) => `${r._r.posto_sigla} ${r._r.nome}` }, { id: 'o', titulo: 'OME', render: (r: any) => r._r.ome_sigla },
              { id: 'antes', titulo: 'No sistema', render: (r: any) => <BadgeComportamento c={r._r.publicado} /> },
              { id: 'comportamento', titulo: 'Planilha', render: (r: any) => <BadgeComportamento c={r.comportamento} /> },
              { id: 'data_vigencia', titulo: 'A contar de', render: (r: any) => fmtData(r.data_vigencia) }, { id: 'publicacao', titulo: 'Publicação' },
            ] : [
              { id: 'm', titulo: 'Matrícula', render: (r: any) => r._r.matricula }, { id: 'n', titulo: 'Nome', render: (r: any) => r._r.nome },
              { id: 't', titulo: 'Tipo', render: (r: any) => r._r.tipo }, { id: 'data_publicacao', titulo: 'Publicação', render: (r: any) => [fmtData(r.data_publicacao), r.publicacao].filter(Boolean).join(' · ') },
              { id: 'data_inicio', titulo: 'Cumprimento', render: (r: any) => (r.data_inicio ? `${fmtData(r.data_inicio)}${r.dias ? ` · ${r.dias} d` : ''}` : '') },
              { id: 'cancelada_em', titulo: 'Cancelada', render: (r: any) => fmtData(r.cancelada_em) },
            ]} />}
        </Cartao>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
function Regras({ admin }: { admin: boolean }) {
  const toast = useToast();
  const regra = useConsulta('comp-regra', async () => {
    const { data, error } = await supabase.from('comportamento_regra').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    return data;
  }, 300_000);
  const [ed, setEd] = useState<any>(null);
  const r = regra.dados;
  const salvar = async () => {
    const campos = ['peso_prisao', 'peso_detencao', 'peso_repreensao', 'excepcional_anos', 'otimo_anos', 'otimo_limite', 'bom_anos', 'bom_limite', 'mau_meses', 'mau_limite'];
    const dados: any = Object.fromEntries(campos.map((c) => [c, Number(String(ed[c]).replace(',', '.'))]));
    if (Object.values(dados).some((v: any) => isNaN(v) || v < 0)) return toast('Valores inválidos.', 'erro');
    dados.observacao = ed.observacao || null;
    const { error } = await supabase.from('comportamento_regra').update(dados).eq('id', 1);
    if (error) toast(msgErro(error), 'erro'); else { toast('Parâmetros salvos. O cálculo já usa os novos valores.'); setEd(null); invalidar('comp'); }
  };
  const n = (v: any) => Number(v).toLocaleString('pt-BR');
  return (
    <div className="grade-2">
      <Cartao titulo="Como o sistema calcula">
        <ol className="lista-regras">
          <li>Na inclusão a praça é <strong>Bom</strong> (art. 45 §2). Oficiais e aspirantes não são classificados (Decreto 50.014, art. 6º §2).</li>
          <li>Cada pena vale em "prisões": prisão {r ? n(r.peso_prisao) : 1}; detenção {r ? n(r.peso_detencao) : '0,5'} (art. 49: duas detenções = uma prisão); repreensão {r ? n(r.peso_repreensao) : '0,5'} (sanção menor). Condenação por crime conta como prisão e por contravenção como detenção (art. 47, parágrafo único). Advertência não conta.</li>
          <li>A pena conta a partir da <strong>publicação</strong> do ato, depois dos recursos, desde 27/12/2020 (Decreto 50.014, art. 9º); antes disso, do fim do cumprimento (art. 48). Pena cancelada ou anulada por elogio deixa de contar na data do cancelamento (arts. 60-64; art. 67 §9).</li>
          <li>Classificação, da melhor para a pior (art. 46): <strong>Excepcional</strong> — nenhuma pena em {r?.excepcional_anos ?? 6} anos e {r?.excepcional_anos ?? 6} anos de serviço; <strong>Ótimo</strong> — em {r?.otimo_anos ?? 4} anos, nenhuma prisão e soma até {r ? n(r.otimo_limite) : '0,5'} (até uma detenção) e {r?.otimo_anos ?? 4} anos de serviço; <strong>Bom</strong> — em {r?.bom_anos ?? 2} anos, soma até {r ? n(r.bom_limite) : 1}; <strong>Mau</strong> — em {r?.mau_meses ?? 12} meses, soma acima de {r ? n(r.mau_limite) : 2}; <strong>Insuficiente</strong> — os demais casos.</li>
          <li>A melhoria é automática pela escala móvel (art. 47): o sistema mostra a data em que cada praça muda de classe e lista o que falta publicar. O comportamento oficial continua sendo o publicado em boletim (art. 45 §1).</li>
          <li>Sem o histórico de punições, o cálculo parte do último comportamento publicado e supõe o pior caso (uma pena na data da publicação); a praça aparece com "base estimada" até as punições anteriores serem lançadas.</li>
        </ol>
        {r?.observacao && <p className="nota">{r.observacao}</p>}
      </Cartao>
      <Cartao titulo="Parâmetros" acoes={admin && !ed ? <Botao pequeno onClick={() => setEd({ ...r })}>Alterar</Botao> : undefined}>
        {!r ? <Carregando /> : !ed ? (
          <table className="tabela compacta"><tbody>
            {[['Peso da prisão', n(r.peso_prisao)], ['Peso da detenção', n(r.peso_detencao)], ['Peso da repreensão', n(r.peso_repreensao)],
              ['Excepcional: anos sem pena', r.excepcional_anos], ['Ótimo: janela (anos)', r.otimo_anos], ['Ótimo: soma máxima', n(r.otimo_limite)],
              ['Bom: janela (anos)', r.bom_anos], ['Bom: soma máxima', n(r.bom_limite)], ['Mau: janela (meses)', r.mau_meses], ['Mau: soma acima de', n(r.mau_limite)]]
              .map(([a, b]) => <tr key={String(a)}><th>{a}</th><td className="num">{b}</td></tr>)}
          </tbody></table>
        ) : (
          <>
            <Aviso tom="alerta">Altere só com base em norma ou parecer: o cálculo de todas as praças muda na hora.</Aviso>
            <div className="form-grade">
              {[['peso_prisao', 'Peso da prisão'], ['peso_detencao', 'Peso da detenção'], ['peso_repreensao', 'Peso da repreensão'], ['excepcional_anos', 'Excepcional: anos'],
                ['otimo_anos', 'Ótimo: anos'], ['otimo_limite', 'Ótimo: soma máx.'], ['bom_anos', 'Bom: anos'], ['bom_limite', 'Bom: soma máx.'], ['mau_meses', 'Mau: meses'], ['mau_limite', 'Mau: soma acima de']]
                .map(([c, t]) => <Campo key={c} rotulo={t}><input value={ed[c]} onChange={(e) => setEd({ ...ed, [c]: e.target.value })} /></Campo>)}
              <Campo rotulo="Fundamento / observação" largura="inteira"><input value={ed.observacao || ''} onChange={(e) => setEd({ ...ed, observacao: e.target.value })} /></Campo>
            </div>
            <div className="form-acoes"><Botao onClick={() => setEd(null)}>Cancelar</Botao><Botao variante="primario" onClick={salvar}>Salvar</Botao></div>
          </>
        )}
      </Cartao>
    </div>
  );
}
