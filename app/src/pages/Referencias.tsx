import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useDominios, type Dominios } from '../lib/dominios';
import { invalidar, useConsulta } from '../lib/consulta';
import { carregarEfetivo } from '../lib/efetivo';
import { exportarXlsx, fmtCompetencia, fmtData, fmtDataHora, msgErro, rpc } from '../lib/util';
import {
  COLUNAS_QOD, conciliar, juntarAlmanaques, lerAlmanaque, lerQod, omeDoQod, somaQod,
  type LeituraAlmanaque, type LeituraQod, type MilitarSistema,
} from '../lib/referencias';
import { Abas, Aviso, Badge, Botao, Campo, Cartao, Carregando, Kpi, Modal, Tabela, useToast } from '../components/ui';

type Lido = { tipo: 'qod'; leitura: LeituraQod; arquivo: string } | { tipo: 'alm'; leitura: LeituraAlmanaque; arquivos: string[] };

export default function Referencias() {
  const dom = useDominios();
  const toast = useToast();
  const [lido, setLido] = useState<Lido | null>(null);
  const [lendo, setLendo] = useState<string | null>(null);
  const qodRef = useRef<HTMLInputElement>(null);
  const almRef = useRef<HTMLInputElement>(null);
  const hist = useConsulta('ref|hist', async () => {
    const { data, error } = await supabase.from('referencia_importacao').select('*').order('importado_em', { ascending: false }).limit(24);
    if (error) throw error;
    const ids = [...new Set((data || []).map((r: any) => r.importado_por).filter(Boolean))];
    const { data: us } = ids.length ? await supabase.from('perfil').select('id, nome, posto').in('id', ids) : { data: [] as any[] };
    const nomes = new Map((us || []).map((u: any) => [u.id, [u.posto, u.nome].filter(Boolean).join(' ')]));
    return (data || []).map((r: any) => ({ ...r, por: nomes.get(r.importado_por) || '' }));
  }, 60_000);

  const lerArquivos = async (tipo: 'qod' | 'alm', arquivos: File[]) => {
    try {
      const { lerPdf } = await import('../lib/pdfTexto');
      if (tipo === 'qod') {
        const f = arquivos[0];
        setLendo(`Lendo ${f.name}…`);
        const pags = await lerPdf(f, { ate: 12 });
        const leitura = lerQod(pags);
        if (!leitura.linhas.length) throw new Error(leitura.erros[0] || 'Não encontrei o Quadro nº 001 neste PDF. É mesmo o QOD?');
        setLido({ tipo, leitura, arquivo: f.name });
      } else {
        const ls: LeituraAlmanaque[] = [];
        for (const f of arquivos) {
          const pags = await lerPdf(f, { progresso: (i, n) => setLendo(`Lendo ${f.name}: página ${i} de ${n}`) });
          const l = lerAlmanaque(pags, f.name);
          if (!l.registros.length) throw new Error(`Nenhum militar encontrado em ${f.name}. É mesmo um volume do almanaque?`);
          ls.push(l);
        }
        setLido({ tipo, leitura: juntarAlmanaques(ls), arquivos: arquivos.map((f) => f.name) });
      }
    } catch (e) { toast(msgErro(e), 'erro'); } finally { setLendo(null); }
  };

  if (!dom) return <Carregando />;
  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Atualização mensal: QOD e almanaque</h1>
          <p className="sub">Os PDFs são lidos no seu computador e não ficam guardados. Antes de gravar, o sistema mostra tudo o que vai mudar; só as diferenças são gravadas.</p>
        </div>
      </div>
      <div className="grade-2">
        <Cartao titulo="QOD do mês (PDF)">
          <p className="nota">Lê o Quadro nº 001 (Distribuição Geral de Efetivo): previsto por OME, posto e quadro. Confere as somas de cada linha e o total com o efetivo fixado.</p>
          <Botao variante="primario" disabled={!!lendo} onClick={() => qodRef.current?.click()}>Escolher PDF do QOD</Botao>
          <input ref={qodRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) lerArquivos('qod', f); }} />
        </Cartao>
        <Cartao titulo="Almanaque (PDFs)">
          <p className="nota">Selecione juntos os 3 volumes: oficiais, subtenentes e sargentos, cabos e soldados. Atualiza posto/graduação, quadro, antiguidade, data de praça, nascimento, data da última promoção e nome de guerra (só onde estiver vazio). Nunca muda OME, seção ou afastamentos, nem inclui ou desliga ninguém.</p>
          <Botao variante="primario" disabled={!!lendo} onClick={() => almRef.current?.click()}>Escolher PDFs do almanaque</Botao>
          <input ref={almRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) lerArquivos('alm', f); }} />
        </Cartao>
      </div>
      {lendo && <Aviso tom="info"><span className="spinner" /> {lendo}</Aviso>}

      <Cartao titulo="Importações anteriores">
        {hist.erro ? <Aviso tom="erro">{hist.erro}</Aviso> : !hist.dados ? <Carregando /> : (
          <Tabela linhas={hist.dados} chave={(r: any) => String(r.id)} vazio="Nenhuma importação ainda." porPagina={12} colunas={[
            { id: 'importado_em', titulo: 'Quando', render: (r: any) => fmtDataHora(r.importado_em) },
            { id: 'tipo', titulo: 'Tipo', render: (r: any) => <Badge tom={r.tipo === 'QOD' ? 'azul' : 'roxo'}>{r.tipo === 'QOD' ? 'QOD' : 'Almanaque'}</Badge> },
            { id: 'referencia', titulo: 'Referência', render: (r: any) => (r.tipo === 'QOD' ? fmtCompetencia(r.referencia) : fmtData(r.referencia)) },
            { id: 'documento', titulo: 'Documento' },
            { id: 'resumo', titulo: 'Resultado', ordenavel: false, render: (r: any) => <span className="nota">{resumoTexto(r)}</span> },
            { id: 'por', titulo: 'Por' },
          ]} />
        )}
      </Cartao>

      {lido?.tipo === 'qod' && <PreviaQod leitura={lido.leitura} arquivo={lido.arquivo} dom={dom} onFechar={() => setLido(null)}
        onFeito={() => { setLido(null); invalidar('ref'); invalidar('qod'); invalidar('ind'); invalidar('pendencias'); }} />}
      {lido?.tipo === 'alm' && <PreviaAlmanaque leitura={lido.leitura} arquivos={lido.arquivos} dom={dom} ultimo={(hist.dados || []).find((h: any) => h.tipo === 'ALMANAQUE')}
        onFechar={() => setLido(null)} onFeito={() => { setLido(null); invalidar('ref'); invalidar('efetivo'); invalidar('painel'); invalidar('qod'); invalidar('ind'); }} />}
    </div>
  );
}

function resumoTexto(r: any) {
  const s = r.resumo || {};
  if (r.tipo === 'QOD') return `${s.linhas_gravadas ?? 0} linhas · total ${s.total ?? '—'}${s.alteracoes != null ? ` · ${s.alteracoes} célula(s) alterada(s)` : ''}`;
  return `${s.militares_atualizados ?? 0} militares atualizados${s.postos ? ` · ${s.postos} mudança(s) de posto` : ''}${s.sem_cadastro ? ` · ${s.sem_cadastro} sem cadastro` : ''}${s.ausentes ? ` · ${s.ausentes} fora do almanaque` : ''}`;
}

// ============================================================ QOD
function PreviaQod({ leitura, arquivo, dom, onFechar, onFeito }: { leitura: LeituraQod; arquivo: string; dom: Dominios; onFechar: () => void; onFeito: () => void }) {
  const toast = useToast();
  const [comp, setComp] = useState(leitura.competencia || '');
  const [escolha, setEscolha] = useState<Record<string, number>>({});
  const [gravando, setGravando] = useState(false);
  const omes = dom.omes.filter((o) => o.ativo);
  const base = useConsulta(`qod|pdf|${comp}`, async () => {
    const { data: al } = await supabase.from('qod_alias').select('chave, ome_id');
    const vig = comp ? await rpc<string | null>('qod_competencia_vigente', { p_competencia: comp }) : null;
    const { data: ant } = vig ? await supabase.from('qod').select('ome_id, posto_id, quadro_sigla, previsto').eq('competencia', vig) : { data: [] as any[] };
    return { alias: new Map<string, number>((al || []).map((a: any) => [a.chave, a.ome_id])), vig, anterior: ant || [] };
  });
  const auto = useMemo(() => {
    const m: Record<string, number | null> = {};
    if (base.dados) for (const l of leitura.linhas) m[l.chave] = omeDoQod(l.chave, omes, base.dados.alias);
    return m;
  }, [base.dados, leitura, omes]);
  const omeDe = (chave: string) => escolha[chave] ?? auto[chave] ?? null;

  const soma = somaQod(leitura.linhas);
  const falhas = leitura.linhas.filter((l) => !l.confere);
  const semOme = leitura.linhas.filter((l) => !omeDe(l.chave));
  const totalOk = (leitura.fixado == null || soma[19] === leitura.fixado) && (!leitura.totalImpresso || leitura.totalImpresso.every((v, i) => v === soma[i]));
  const pid = (s: string) => dom.postos.find((p) => p.sigla === s)?.id;

  // linhas para gravar, somando linhas que caem na mesma OME
  const novas = useMemo(() => {
    const acc = new Map<string, { ome_id: number; posto_id: number; quadro_sigla: string | null; previsto: number }>();
    for (const l of leitura.linhas) {
      const o = omeDe(l.chave); if (!o) continue;
      COLUNAS_QOD.forEach((c, i) => {
        if (!c.posto || !l.v[i]) return;
        const p = pid(c.posto); if (!p) return;
        const k = `${o}|${p}|${c.quadro || ''}`;
        const x = acc.get(k) || { ome_id: o, posto_id: p, quadro_sigla: c.quadro, previsto: 0 };
        x.previsto += l.v[i]; acc.set(k, x);
      });
    }
    return [...acc.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leitura, escolha, auto]);

  const difs = useMemo(() => {
    if (!base.dados) return [];
    const ant = new Map(base.dados.anterior.map((a: any) => [`${a.ome_id}|${a.posto_id}|${a.quadro_sigla || ''}`, a.previsto as number]));
    const nov = new Map(novas.map((n) => [`${n.ome_id}|${n.posto_id}|${n.quadro_sigla || ''}`, n.previsto]));
    const out: any[] = [];
    for (const k of new Set([...ant.keys(), ...nov.keys()])) {
      const a = ant.get(k) || 0, n = nov.get(k) || 0;
      if (a === n) continue;
      const [o, p, q] = k.split('|');
      const om = dom.omes.find((x) => x.id === +o), po = dom.postos.find((x) => x.id === +p);
      out.push({ k, ome: om?.sigla, ordem: om?.ordem ?? 999, posto: `${po?.sigla || ''}${q ? ' ' + q : ''}`, pordem: po?.ordem ?? 99, antes: a, depois: n, dif: n - a });
    }
    return out.sort((a, b) => a.ordem - b.ordem || a.pordem - b.pordem);
  }, [base.dados, novas, dom]);

  const pode = !!comp && !falhas.length && !semOme.length && totalOk && novas.length > 0 && !gravando;
  const gravar = async () => {
    setGravando(true);
    try {
      const aliases = leitura.linhas.filter((l) => escolha[l.chave] && escolha[l.chave] !== auto[l.chave]).map((l) => ({ chave: l.chave, ome_id: escolha[l.chave] }));
      const doc = `${leitura.documento}${leitura.atualizacao ? ` (atualizado em ${leitura.atualizacao})` : ''}`;
      const n = await rpc<number>('qod_importar', {
        p_competencia: comp, p_linhas: novas, p_documento: doc, p_aliases: aliases,
        p_resumo: { arquivo, total: soma[19], fixado: leitura.fixado, omes: new Set(novas.map((x) => x.ome_id)).size, alteracoes: base.dados?.vig ? difs.length : null },
      });
      toast(`QOD de ${fmtCompetencia(comp)} gravado: ${n} linhas.`);
      onFeito();
    } catch (e) { toast(msgErro(e), 'erro'); } finally { setGravando(false); }
  };

  const meses = useMemo(() => {
    const c = leitura.competencia || new Date().toISOString().slice(0, 8) + '01';
    const [a, m] = c.split('-').map(Number);
    return [-1, 0, 1].map((d) => { const x = new Date(a, m - 1 + d, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`; });
  }, [leitura.competencia]);

  return (
    <Modal aberto largo titulo={`QOD lido: ${leitura.documento}`} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={!pode} onClick={gravar}>{gravando ? 'Gravando…' : `Gravar QOD de ${fmtCompetencia(comp)}`}</Botao></>}>
      {base.erro && <Aviso tom="erro">{base.erro}</Aviso>}
      {!base.dados ? <Carregando /> : <>
        <div className="mini-kpis">
          <div><strong>{leitura.linhas.length}</strong><span>linhas de OME lidas</span></div>
          <div><strong>{leitura.linhas.length - falhas.length}/{leitura.linhas.length}</strong><span>com somas conferidas</span></div>
          <div><strong>{soma[19]}</strong><span>total lido{leitura.fixado != null ? ` · fixado ${leitura.fixado}` : ''}</span></div>
          <div><strong>{base.dados.vig ? difs.length : '—'}</strong><span>{base.dados.vig ? `células diferentes de ${fmtCompetencia(base.dados.vig)}` : 'sem QOD anterior'}</span></div>
        </div>
        <div className="filtros">
          <Campo rotulo="Competência do QOD">
            <select value={comp} onChange={(e) => setComp(e.target.value)}>
              {meses.map((m) => <option key={m} value={m}>{fmtCompetencia(m)}{m === leitura.competencia ? ' (do PDF)' : ''}</option>)}
            </select>
          </Campo>
        </div>
        {leitura.atualizacao && <p className="nota">Atualização do documento: {leitura.atualizacao}. Arquivo: {arquivo}.</p>}
        {!totalOk && <Aviso tom="erro">A soma das linhas ({soma[19]}) não confere com o total impresso{leitura.fixado != null ? ` / efetivo fixado (${leitura.fixado})` : ''}. O leiaute do PDF pode ter mudado: não grave e me envie o arquivo.</Aviso>}
        {falhas.length > 0 && <Aviso tom="erro">{falhas.length} linha(s) com soma que não confere: {falhas.map((f) => f.rotulo).join('; ')}.</Aviso>}
        {semOme.length > 0 && <Aviso tom="alerta">{semOme.length} nome(s) do QOD sem OME correspondente. Escolha a OME abaixo; a escolha fica salva para os próximos meses.</Aviso>}

        <details open={semOme.length > 0}>
          <summary>De-para: nome no QOD → OME do sistema ({leitura.linhas.length})</summary>
          <table className="tabela compacta">
            <thead><tr><th>No QOD</th><th>OME no sistema</th><th>Total previsto</th></tr></thead>
            <tbody>{leitura.linhas.map((l) => (
              <tr key={l.chave} className={!omeDe(l.chave) ? 'selecionada' : ''}>
                <td>{l.rotulo}</td>
                <td><select value={omeDe(l.chave) || ''} onChange={(e) => setEscolha({ ...escolha, [l.chave]: Number(e.target.value) })}>
                  <option value="">— escolha —</option>
                  {omes.map((o) => <option key={o.id} value={o.id}>{o.sigla}</option>)}
                </select></td>
                <td>{l.v[19]}</td>
              </tr>
            ))}</tbody>
          </table>
        </details>

        <details open>
          <summary>{base.dados.vig ? `Mudanças em relação ao QOD de ${fmtCompetencia(base.dados.vig)} (${difs.length})` : 'Primeiro QOD lançado: todas as linhas são novas'}</summary>
          {base.dados.vig && (difs.length === 0 ? <p className="nota">Nenhuma mudança: o QOD lido é igual ao anterior.</p> : (
            <Tabela linhas={difs} chave={(r: any) => r.k} porPagina={30} compacta colunas={[
              { id: 'ome', titulo: 'OME', valor: (r: any) => r.ordem },
              { id: 'posto', titulo: 'Posto/Grad.', valor: (r: any) => r.pordem },
              { id: 'antes', titulo: 'Antes' }, { id: 'depois', titulo: 'Agora' },
              { id: 'dif', titulo: 'Diferença', render: (r: any) => <Badge tom={r.dif > 0 ? 'azul' : 'amarelo'}>{r.dif > 0 ? '+' : ''}{r.dif}</Badge> },
            ]} />
          ))}
        </details>
      </>}
    </Modal>
  );
}

// ============================================================ ALMANAQUE
const CAMPOS_AUTO = [
  { id: 'ordem_antiguidade', rotulo: 'Antiguidade (nº no almanaque)', nome: 'antiguidade' },
  { id: 'data_ingresso', rotulo: 'Data de ingresso (data de praça)', nome: 'ingresso' },
  { id: 'quadro_sigla', rotulo: 'Quadro (QOC/QOA)', nome: 'quadro' },
  { id: 'nome_guerra', rotulo: 'Nome de guerra (só onde está vazio)', nome: 'nome de guerra' },
  { id: 'data_nascimento', rotulo: 'Data de nascimento', nome: 'nascimento' },
  { id: 'data_promocao', rotulo: 'Data da última promoção', nome: 'promoção' },
] as const;

function PreviaAlmanaque({ leitura, arquivos, dom, ultimo, onFechar, onFeito }: {
  leitura: LeituraAlmanaque; arquivos: string[]; dom: Dominios; ultimo?: any; onFechar: () => void; onFeito: () => void;
}) {
  const toast = useToast();
  const nav = useNavigate();
  const [aba, setAba] = useState('auto');
  const [campos, setCampos] = useState<Record<string, boolean>>({ ordem_antiguidade: true, data_ingresso: true, quadro_sigla: true, nome_guerra: true, data_nascimento: true, data_promocao: true });
  const [postosSel, setPostosSel] = useState<Set<string> | null>(null);
  const [gravando, setGravando] = useState(false);
  const sistema = useConsulta('ref|militares', () => carregarEfetivo(null, '',
    'id,matricula,nome,nome_guerra,posto_id,posto_sigla,quadro_sigla,ordem_antiguidade,ano_ingresso,data_ingresso,situacao,ome_sigla,posto_completo,data_nascimento,data_promocao') as Promise<MilitarSistema[]>, 5_000);
  const c = useMemo(() => (sistema.dados ? conciliar(leitura.registros, sistema.dados, dom.postos) : null), [sistema.dados, leitura, dom]);
  useEffect(() => { if (c && !postosSel) setPostosSel(new Set(c.postos.filter((p) => p.promocao).map((p) => p.m.id))); }, [c, postosSel]);

  const alteracoes = useMemo(() => {
    if (!c) return [];
    const mapa = new Map<string, any>();
    for (const a of c.automaticas) {
      const x: any = { id: a.m.id };
      for (const f of CAMPOS_AUTO) if (campos[f.id] && (a.alt as any)[f.id] != null) x[f.id] = (a.alt as any)[f.id];
      if (campos.data_ingresso && a.alt.ano_ingresso != null) x.ano_ingresso = a.alt.ano_ingresso;
      if (Object.keys(x).length > 1) mapa.set(a.m.id, x);
    }
    for (const p of c.postos) if (postosSel?.has(p.m.id)) mapa.set(p.m.id, { ...(mapa.get(p.m.id) || { id: p.m.id }), posto_id: p.posto_id, ...(p.quadro_sigla ? { quadro_sigla: p.quadro_sigla } : {}), ...(p.r.dataPromocao ? { data_promocao: p.r.dataPromocao } : {}), ...(p.r.ordem ? { ordem_antiguidade: p.r.ordem } : {}) });
    return [...mapa.values()];
  }, [c, campos, postosSel]);

  const gravar = async () => {
    if (!c) return;
    setGravando(true);
    try {
      const n = await rpc<number>('aplicar_almanaque', {
        p_referencia: leitura.referencia, p_documento: arquivos.join(', '), p_alteracoes: alteracoes,
        p_resumo: {
          lidos: leitura.registros.length, conferem: c.conferem, postos: alteracoes.filter((a) => a.posto_id).length,
          sem_cadastro: c.semCadastro.length, ausentes: c.ausentes.length,
          campos: Object.fromEntries(CAMPOS_AUTO.map((f) => [f.id, campos[f.id] ? alteracoes.filter((a) => a[f.id] != null).length : 0])),
        },
      });
      toast(`Almanaque aplicado: ${n} militar(es) atualizados.`);
      onFeito();
    } catch (e) { toast(msgErro(e), 'erro'); } finally { setGravando(false); }
  };

  const contaCampo = (id: string) => (c ? c.automaticas.filter((a) => (a.alt as any)[id] != null).length : 0);
  const fmtAlt = (a: { m: MilitarSistema; alt: any }) => CAMPOS_AUTO.filter((f) => a.alt[f.id] != null).map((f) => {
    const data = f.id === 'data_ingresso' || f.id === 'data_nascimento' || f.id === 'data_promocao';
    const antes = f.id === 'ordem_antiguidade' ? a.m.ordem_antiguidade : f.id === 'data_ingresso' ? (a.m.data_ingresso ? fmtData(a.m.data_ingresso) : a.m.ano_ingresso)
      : f.id === 'quadro_sigla' ? a.m.quadro_sigla : f.id === 'nome_guerra' ? a.m.nome_guerra : fmtData((a.m as any)[f.id]) || null;
    return `${f.nome}: ${antes ?? '—'} → ${data ? fmtData(a.alt[f.id]) : a.alt[f.id]}`;
  }).join(' · ');
  const repetido = ultimo && ultimo.referencia === leitura.referencia;

  return (
    <Modal aberto largo titulo={`Almanaque de ${fmtData(leitura.referencia)}: conciliação com o sistema`} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={!c || gravando || !alteracoes.length} onClick={gravar}>{gravando ? 'Gravando…' : `Aplicar em ${alteracoes.length} militar(es)`}</Botao></>}>
      {sistema.erro && <Aviso tom="erro">{sistema.erro}</Aviso>}
      {!c ? <Carregando texto="Comparando com o efetivo do sistema…" /> : <>
        {repetido && <Aviso tom="alerta">Este almanaque ({fmtData(leitura.referencia)}) já foi aplicado em {fmtDataHora(ultimo.importado_em)}. Aplicar de novo só grava o que mudou desde então.</Aviso>}
        <div className="mini-kpis">
          <div><strong>{leitura.registros.length}</strong><span>militares no almanaque</span></div>
          <div><strong>{c.conferem}</strong><span>já conferem</span></div>
          <div><strong>{c.automaticas.length}</strong><span>com atualização de cadastro</span></div>
          <div><strong>{c.postos.length}</strong><span>posto/graduação diferente</span></div>
          <div><strong>{c.semCadastro.length}</strong><span>sem cadastro no sistema</span></div>
          <div><strong>{c.ausentes.length}</strong><span>ativos fora do almanaque</span></div>
        </div>
        <Abas ativa={aba} onChange={setAba} abas={[
          { id: 'auto', rotulo: `Atualizações (${c.automaticas.length})` },
          { id: 'postos', rotulo: `Posto/graduação (${c.postos.length})` },
          { id: 'sem', rotulo: `Sem cadastro (${c.semCadastro.length})` },
          { id: 'aus', rotulo: `Fora do almanaque (${c.ausentes.length})` },
          { id: 'avisos', rotulo: `Avisos (${leitura.avisos.length + c.desligados.length + leitura.registros.filter((r) => !r.dvValido).length})` },
        ]} />

        {aba === 'auto' && <>
          <div className="checks-linha">
            {CAMPOS_AUTO.map((f) => (
              <label key={f.id} className="check"><input type="checkbox" checked={campos[f.id]} onChange={(e) => setCampos({ ...campos, [f.id]: e.target.checked })} /> {f.rotulo} <Badge>{contaCampo(f.id)}</Badge></label>
            ))}
          </div>
          <Tabela linhas={c.automaticas} chave={(a: any) => a.m.id} porPagina={25} compacta vazio="Nenhuma atualização: o cadastro já confere com o almanaque." colunas={[
            { id: 'posto', titulo: 'Posto', valor: (a: any) => a.m.posto_completo, render: (a: any) => a.m.posto_completo },
            { id: 'nome', titulo: 'Nome', valor: (a: any) => a.m.nome, render: (a: any) => <a className="link" onClick={() => nav(`/militar/${a.m.id}`)}>{a.m.nome}</a> },
            { id: 'ome', titulo: 'OME', valor: (a: any) => a.m.ome_sigla, render: (a: any) => a.m.ome_sigla },
            { id: 'alt', titulo: 'O que muda', ordenavel: false, render: (a: any) => <span className="nota">{fmtAlt(a)}</span> },
          ]} />
        </>}

        {aba === 'postos' && <>
          <p className="nota">Marcadas por padrão só as promoções (almanaque acima do sistema). Quando o sistema está acima do almanaque, a promoção pode ser posterior à data do almanaque: confira antes de marcar.</p>
          <Tabela linhas={c.postos} chave={(p: any) => p.m.id} porPagina={50} compacta vazio="Nenhuma diferença de posto/graduação." colunas={[
            { id: 'sel', titulo: '', ordenavel: false, largura: '28px', render: (p: any) => <input type="checkbox" aria-label="Aplicar" checked={!!postosSel?.has(p.m.id)}
              onChange={() => setPostosSel((s) => { const n = new Set(s || []); n.has(p.m.id) ? n.delete(p.m.id) : n.add(p.m.id); return n; })} /> },
            { id: 'nome', titulo: 'Militar', valor: (p: any) => p.m.nome, render: (p: any) => <>{p.m.nome} <span className="nota">{p.m.matricula}</span></> },
            { id: 'ome', titulo: 'OME', valor: (p: any) => p.m.ome_sigla, render: (p: any) => p.m.ome_sigla },
            { id: 'de', titulo: 'No sistema', valor: (p: any) => p.m.posto_completo, render: (p: any) => p.m.posto_completo },
            { id: 'para', titulo: 'No almanaque', valor: (p: any) => p.r.posto, render: (p: any) => `${p.r.posto}${p.r.quadro ? ' ' + p.r.quadro : ''}` },
            { id: 'tipo', titulo: '', valor: (p: any) => (p.promocao ? 1 : 0), render: (p: any) => <Badge tom={p.promocao ? 'verde' : 'amarelo'}>{p.promocao ? 'promoção' : 'sistema acima'}</Badge> },
          ]} />
        </>}

        {aba === 'sem' && <>
          <div className="exp-cab">
            <p className="nota">Constam no almanaque e não têm cadastro no sistema (nem desligado). Inclua pela ficha "+ Novo militar" na OME de lotação. Quando há um nome igual com outra matrícula, provavelmente é erro de digitação em um dos dois.</p>
            <Botao pequeno onClick={() => exportarXlsx('almanaque_sem_cadastro', `Almanaque de ${fmtData(leitura.referencia)}: sem cadastro no sistema`, [
              { titulo: 'Posto/Grad.', valor: (r: any) => `${r.posto}${r.quadro ? ' ' + r.quadro : ''}`, largura: 12 }, { titulo: 'Nº almanaque', valor: (r: any) => r.ordem, largura: 8 },
              { titulo: 'Matrícula', valor: (r: any) => r.matricula, largura: 11 }, { titulo: 'Nome', valor: (r: any) => r.nome, largura: 40 },
              { titulo: 'Ano de ingresso', valor: (r: any) => r.anoIngresso, largura: 10 },
              { titulo: 'Observação', valor: (r: any) => [!r.dvValido && 'dígito verificador inválido no almanaque', r.parecido && `no sistema com a matrícula ${r.parecido.matricula} (${r.parecido.ome_sigla})`].filter(Boolean).join('; '), largura: 50 },
            ], c.semCadastro)}>Exportar Excel</Botao>
          </div>
          <Tabela linhas={c.semCadastro} chave={(r: any) => r.matricula} porPagina={30} compacta colunas={[
            { id: 'posto', titulo: 'Posto', valor: (r: any) => r.posto, render: (r: any) => `${r.posto}${r.quadro ? ' ' + r.quadro : ''}` },
            { id: 'matricula', titulo: 'Matrícula' }, { id: 'nome', titulo: 'Nome' },
            { id: 'anoIngresso', titulo: 'Ingresso' },
            { id: 'obs', titulo: 'Observação', ordenavel: false, render: (r: any) => <>
              {!r.dvValido && <Badge tom="amarelo">dígito inválido no almanaque</Badge>}
              {r.parecido && <span className="nota"> no sistema: {r.parecido.matricula} ({r.parecido.ome_sigla})</span>}</> },
          ]} />
        </>}

        {aba === 'aus' && <>
          <div className="exp-cab">
            <p className="nota">Ativos no sistema que não constam no almanaque (aspirantes não entram nesta lista: o almanaque não os traz). Verifique se é matrícula divergente, desligamento não registrado ou ausência no almanaque.</p>
            <Botao pequeno onClick={() => exportarXlsx('ativos_fora_do_almanaque', `Ativos no sistema fora do almanaque de ${fmtData(leitura.referencia)}`, [
              { titulo: 'Posto/Grad.', valor: (m: any) => m.posto_completo, largura: 12 }, { titulo: 'Matrícula', valor: (m: any) => m.matricula, largura: 11 },
              { titulo: 'Nome', valor: (m: any) => m.nome, largura: 40 }, { titulo: 'OME', valor: (m: any) => m.ome_sigla, largura: 12 },
              { titulo: 'Observação', valor: (m: any) => (m.parecido ? `no almanaque com a matrícula ${m.parecido.matricula}${m.parecido.dvValido ? '' : ' (dígito inválido)'}` : ''), largura: 45 },
            ], c.ausentes)}>Exportar Excel</Botao>
          </div>
          <Tabela linhas={c.ausentes} chave={(m: any) => m.id} porPagina={30} compacta onLinha={(m: any) => nav(`/militar/${m.id}`)} colunas={[
            { id: 'posto_completo', titulo: 'Posto' }, { id: 'matricula', titulo: 'Matrícula' }, { id: 'nome', titulo: 'Nome' }, { id: 'ome_sigla', titulo: 'OME' },
            { id: 'obs', titulo: 'Observação', ordenavel: false, render: (m: any) => (m.parecido ? <span className="nota">no almanaque: {m.parecido.matricula}{m.parecido.dvValido ? '' : ' (dígito inválido)'}</span> : null) },
          ]} />
        </>}

        {aba === 'avisos' && <ul className="lista-avisos">
          {leitura.avisos.map((a, i) => <li key={'a' + i}>{a}</li>)}
          {leitura.registros.filter((r) => !r.dvValido).map((r) => <li key={r.matricula}>Dígito verificador inválido no almanaque: {r.posto} {r.nome}, matrícula {r.matricula}.</li>)}
          {c.desligados.map(({ m, r }) => <li key={m.id}>Consta no almanaque, mas está {m.situacao.toLowerCase()} no sistema: {r.posto} {m.nome} ({m.matricula}).</li>)}
          {!leitura.avisos.length && !c.desligados.length && !leitura.registros.some((r) => !r.dvValido) && <li>Nenhum aviso.</li>}
        </ul>}
      </>}
    </Modal>
  );
}
