import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useConsulta } from '../lib/consulta';
import { hojeISO, msgErro, rpc } from '../lib/util';
import { Aviso, Botao, Campo, Modal } from './ui';

export const useMotivos = () => useConsulta('motivos', async () => {
  const { data, error } = await supabase.from('motivo_desligamento').select('*').order('ordem');
  if (error) throw error;
  return data as { id: number; nome: string; situacao: string; ativo: boolean }[];
}, 600_000);

/** modo 'efetivar' = DGP registra; modo 'pedido' = OME pede à DGP */
export default function DesligamentoModal({ militar, modo, onFechar, onFeito }: {
  militar: { id: string; nome: string; posto_completo: string; ome_sigla: string } | null; modo: 'efetivar' | 'pedido'; onFechar: () => void; onFeito: () => void;
}) {
  const motivos = useMotivos().dados || [];
  const [f, setF] = useState<any>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setF({ data: hojeISO(), motivo: '', publicacao: '', processo: '', obs: '' }); setErro(null); }, [militar]);
  if (!militar) return null;
  const set = (k: string, v: string) => setF((x: any) => ({ ...x, [k]: v }));
  const enviar = async () => {
    setErro(null);
    if (!f.motivo) return setErro('Escolha o motivo.');
    if (!f.data) return setErro('Informe a data.');
    if (modo === 'efetivar' && !f.publicacao.trim() && !f.processo.trim()) return setErro('Informe a publicação (BG/DOE) ou o processo SEI.');
    setSalvando(true);
    try {
      const args = { p_militar: militar.id, p_motivo: Number(f.motivo), p_data: f.data, p_publicacao: f.publicacao || null, p_processo: f.processo || null, p_observacao: f.obs || null };
      await rpc(modo === 'efetivar' ? 'desligar_militar' : 'solicitar_desligamento', args);
      onFeito();
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  };
  return (
    <Modal aberto titulo={modo === 'efetivar' ? 'Registrar desligamento' : 'Comunicar desligamento à DGP'} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante={modo === 'efetivar' ? 'perigo' : 'primario'} disabled={salvando} onClick={enviar}>{modo === 'efetivar' ? 'Desligar do efetivo' : 'Enviar pedido'}</Botao></>}>
      <p><strong>{militar.posto_completo} {militar.nome}</strong> · {militar.ome_sigla}</p>
      {modo === 'pedido' && <Aviso tom="info">O desligamento é registrado pela DGP. Este pedido entra na fila da DGP, que confere e efetiva (ou devolve com observação).</Aviso>}
      <div className="form-grade">
        <Campo rotulo="Motivo *" largura="meia">
          <select value={f.motivo} onChange={(e) => set('motivo', e.target.value)}>
            <option value="">Selecione</option>
            {motivos.filter((m) => m.ativo).map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Data *"><input type="date" value={f.data} onChange={(e) => set('data', e.target.value)} /></Campo>
        <Campo rotulo={`Publicação (BG/DOE)${modo === 'efetivar' ? ' *' : ''}`} dica="ex.: BG nº 210/2026"><input value={f.publicacao} onChange={(e) => set('publicacao', e.target.value)} /></Campo>
        <Campo rotulo="Processo SEI"><input value={f.processo} onChange={(e) => set('processo', e.target.value)} /></Campo>
        <Campo rotulo="Observação" largura="inteira"><input value={f.obs} onChange={(e) => set('obs', e.target.value)} /></Campo>
      </div>
      {modo === 'efetivar' && <Aviso tom="alerta">Afastamentos e situações funcionais em aberto serão encerrados na véspera da data do desligamento. O militar sai do efetivo ativo, mas a ficha e o histórico são mantidos.</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </Modal>
  );
}
