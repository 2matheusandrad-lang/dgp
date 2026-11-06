import { useEffect, useState } from 'react';
import { Aviso, Botao, Campo, Modal } from './ui';
import { Coluna, exportarPdf, exportarXlsx, msgErro } from '../lib/util';

type ColExp = Coluna & { id: string; contato?: boolean };
type Agrupamento = { id: string; rotulo: string; fn?: (r: any) => string; ordem?: (r: any) => string };

const lerPref = (k: string) => { try { return JSON.parse(localStorage.getItem('exp_' + k) || 'null'); } catch { return null; } };
const salvarPref = (k: string, v: any) => { try { localStorage.setItem('exp_' + k, JSON.stringify(v)); } catch { /* sem storage */ } };

/** Janela de exportação: escolha de formato, colunas e agrupamento */
export default function Exportar({ aberto, onFechar, arquivo, titulo, subtitulo, colunas, obterLinhas, agrupamentos = [], qtd }: {
  aberto: boolean; onFechar: () => void; arquivo: string; titulo: string; subtitulo: string; colunas: ColExp[];
  obterLinhas: (precisaContato: boolean) => Promise<any[]>; agrupamentos?: Agrupamento[]; qtd: number;
}) {
  const pref = lerPref(arquivo);
  const [formato, setFormato] = useState<'xlsx' | 'pdf'>(pref?.formato || 'xlsx');
  const [sel, setSel] = useState<string[]>(pref?.colunas || colunas.filter((c) => c.padrao).map((c) => c.id));
  const [agrupar, setAgrupar] = useState<string>(pref?.agrupar || '');
  const [assinatura, setAssinatura] = useState<boolean>(!!pref?.assinatura);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (aberto) setErro(null); }, [aberto]);

  const gerar = async () => {
    setErro(null); setGerando(true);
    try {
      const cols = colunas.filter((c) => sel.includes(c.id));
      if (!cols.length) throw new Error('Escolha ao menos uma coluna.');
      const ag = agrupamentos.find((a) => a.id === agrupar);
      const g = ag?.fn;
      let linhas = await obterLinhas(cols.some((c) => c.contato));
      if (g) {
        const k = ag?.ordem || g;   // ordenação estável: mantém a antiguidade dentro do grupo
        linhas = linhas.map((r, i) => ({ r, i })).sort((a, b) => k(a.r).localeCompare(k(b.r), 'pt-BR', { numeric: true }) || a.i - b.i).map((x) => x.r);
      }
      salvarPref(arquivo, { formato, colunas: sel, agrupar, assinatura });
      if (formato === 'xlsx') await exportarXlsx(arquivo, `${titulo} — ${subtitulo}`, cols, linhas, g);
      else await exportarPdf(arquivo, titulo, subtitulo, cols, linhas, g, assinatura);
      onFechar();
    } catch (e) { setErro(msgErro(e)); } finally { setGerando(false); }
  };

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={`Exportar ${qtd} registro(s)`} largo
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={gerando} onClick={gerar}>{gerando ? 'Gerando…' : `Gerar ${formato === 'xlsx' ? 'Excel' : 'PDF'}`}</Botao></>}>
      <div className="form-grade">
        <Campo rotulo="Formato">
          <select value={formato} onChange={(e) => setFormato(e.target.value as any)}>
            <option value="xlsx">Excel (.xlsx)</option><option value="pdf">PDF (paisagem)</option>
          </select>
        </Campo>
        {agrupamentos.length > 0 && (
          <Campo rotulo="Agrupar por">
            <select value={agrupar} onChange={(e) => setAgrupar(e.target.value)}>
              <option value="">Sem agrupamento</option>
              {agrupamentos.map((a) => <option key={a.id} value={a.id}>{a.rotulo}</option>)}
            </select>
          </Campo>
        )}
        {formato === 'pdf' && <label className="check"><input type="checkbox" checked={assinatura} onChange={(e) => setAssinatura(e.target.checked)} /> Campo de assinatura do responsável</label>}
      </div>
      <div className="exp-cab">
        <strong>Colunas</strong>
        <span>
          <button className="link" onClick={() => setSel(colunas.map((c) => c.id))}>todas</button> ·{' '}
          <button className="link" onClick={() => setSel(colunas.filter((c) => c.padrao).map((c) => c.id))}>padrão</button> ·{' '}
          <button className="link" onClick={() => setSel([])}>nenhuma</button>
        </span>
      </div>
      <div className="omes-check">
        {colunas.map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? colunas.filter((x) => x.id === c.id || sel.includes(x.id)).map((x) => x.id) : sel.filter((x) => x !== c.id))} />
            {c.titulo}
          </label>
        ))}
      </div>
      {formato === 'pdf' && sel.length > 11 && <Aviso tom="alerta">Muitas colunas para uma folha A4: o texto fica pequeno. Para planilhas largas, prefira Excel.</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
