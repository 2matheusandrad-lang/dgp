import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { invalidar, useConsulta } from '../lib/consulta';
import { Coluna, exportarPdf, exportarXlsx, fmtDataHora, msgErro } from '../lib/util';
import { Aviso, Badge, Botao, Campo, Carregando, Modal, useToast } from '../components/ui';

export const SENSIB: Record<string, { rotulo: string; tom: 'neutro' | 'azul' | 'amarelo' | 'vermelho'; explica: string }> = {
  INTERNO: { rotulo: 'Interno', tom: 'neutro', explica: 'Informação organizacional, de uso interno' },
  PESSOAL: { rotulo: 'Pessoal', tom: 'azul', explica: 'Dado pessoal comum (LGPD, art. 5º, I)' },
  RESTRITO: { rotulo: 'Restrito', tom: 'amarelo', explica: 'Acesso limitado a quem precisa (disciplina, condições especiais)' },
  SENSIVEL: { rotulo: 'Sensível', tom: 'vermelho', explica: 'Dado pessoal sensível, como saúde (LGPD, art. 11): acesso registrado' },
};
const SITUACAO: Record<string, { rotulo: string; tom: 'verde' | 'amarelo' | 'neutro' }> = {
  EM_USO: { rotulo: 'em uso', tom: 'verde' }, PREVISTO: { rotulo: 'previsto', tom: 'amarelo' }, NAO_ARMAZENADO: { rotulo: 'não armazenado', tom: 'neutro' },
};

export default function Dicionario() {
  const { gestaoGlobal } = useAuth();
  const toast = useToast();
  const { dados, carregando, erro } = useConsulta('dicionario', async () => {
    const { data, error } = await supabase.from('catalogo_campo').select('*').order('ordem').order('campo');
    if (error) throw error;
    return data as any[];
  }, 300_000);
  const [edit, setEdit] = useState<any>(null);
  const [busca, setBusca] = useState('');

  if (erro) return <div className="pagina"><Aviso tom="erro">{erro}</Aviso></div>;
  if (carregando && !dados) return <div className="pagina"><Carregando /></div>;
  const b = busca.trim().toLowerCase();
  const linhas = (dados || []).filter((x) => !b || [x.grupo, x.campo, x.definicao, x.fonte, x.responsavel].some((v) => String(v || '').toLowerCase().includes(b)));
  const grupos = [...new Set(linhas.map((x) => x.grupo))];
  const cols: Coluna[] = [
    { titulo: 'Grupo', valor: (r: any) => r.grupo, largura: 16 }, { titulo: 'Informação', valor: (r: any) => r.campo, largura: 22 },
    { titulo: 'Definição', valor: (r: any) => r.definicao, largura: 44 }, { titulo: 'Fonte oficial', valor: (r: any) => r.fonte, largura: 26 },
    { titulo: 'Responsável', valor: (r: any) => r.responsavel, largura: 18 }, { titulo: 'Quem edita no sistema', valor: (r: any) => r.edicao, largura: 22 },
    { titulo: 'Sensibilidade', valor: (r: any) => SENSIB[r.sensibilidade]?.rotulo, largura: 12 }, { titulo: 'Atualização', valor: (r: any) => r.atualizacao, largura: 16 },
    { titulo: 'Situação', valor: (r: any) => SITUACAO[r.situacao]?.rotulo, largura: 12 }, { titulo: 'Observação', valor: (r: any) => r.observacao, largura: 24 },
  ];

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <h1>Dicionário de dados</h1>
          <p className="sub">O que cada informação significa, de onde vem, quem responde por ela e quem pode vê-la. Base para o regimento interno da DGP.</p>
        </div>
        <div className="acoes">
          <Botao onClick={() => exportarXlsx('dicionario_dados', 'Dicionário de dados', cols, linhas, (r: any) => r.grupo)}>Excel</Botao>
          <Botao onClick={() => exportarPdf('dicionario_dados', 'Dicionário de dados', 'Pertinência das informações do Sistema de Controle do Efetivo', cols, linhas, (r: any) => r.grupo)}>PDF</Botao>
          {gestaoGlobal && <Botao variante="primario" onClick={() => setEdit({ grupo: '', campo: '', sensibilidade: 'INTERNO', situacao: 'EM_USO', ordem: 999 })}>+ Informação</Botao>}
        </div>
      </div>

      <div className="legenda-sensib">
        {Object.entries(SENSIB).map(([k, v]) => <span key={k}><Badge tom={v.tom}>{v.rotulo}</Badge> {v.explica}</span>)}
      </div>
      <div className="filtros"><Campo rotulo="Buscar"><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Informação, fonte, responsável…" /></Campo></div>

      {grupos.map((g) => (
        <section key={g} className="dic-grupo">
          <h3>{g}</h3>
          <div className="tabela-rolagem">
            <table className="tabela cartoes dic-tabela">
              <thead><tr><th>Informação</th><th>Definição</th><th>Fonte oficial</th><th>Responsável</th><th>Quem edita</th><th>Sensibilidade</th><th>Atualização</th>{gestaoGlobal && <th />}</tr></thead>
              <tbody>
                {linhas.filter((x) => x.grupo === g).map((x) => (
                  <tr key={x.id}>
                    <td data-rotulo="Informação"><strong>{x.campo}</strong>{x.situacao !== 'EM_USO' && <> <Badge tom={SITUACAO[x.situacao]?.tom}>{SITUACAO[x.situacao]?.rotulo}</Badge></>}{x.observacao && <div className="nota">{x.observacao}</div>}</td>
                    <td data-rotulo="Definição">{x.definicao}</td>
                    <td data-rotulo="Fonte oficial">{x.fonte}</td>
                    <td data-rotulo="Responsável">{x.responsavel}</td>
                    <td data-rotulo="Quem edita">{x.edicao}</td>
                    <td data-rotulo="Sensibilidade"><Badge tom={SENSIB[x.sensibilidade]?.tom}>{SENSIB[x.sensibilidade]?.rotulo}</Badge></td>
                    <td data-rotulo="Atualização">{x.atualizacao}</td>
                    {gestaoGlobal && <td><button className="link" onClick={() => setEdit({ ...x })}>editar</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {dados && dados.length > 0 && <p className="nota">Última alteração: {fmtDataHora(dados.reduce((a, x) => (x.atualizado_em > a ? x.atualizado_em : a), ''))}</p>}

      <Modal aberto={!!edit} largo titulo={edit?.id ? `Editar: ${edit.campo}` : 'Nova informação'} onFechar={() => setEdit(null)}
        rodape={<>
          {edit?.id && <Botao variante="perigo" onClick={async () => {
            if (!confirm(`Excluir "${edit.campo}" do dicionário?`)) return;
            const { error } = await supabase.from('catalogo_campo').delete().eq('id', edit.id);
            if (error) toast(msgErro(error), 'erro'); else { invalidar('dicionario'); setEdit(null); }
          }}>Excluir</Botao>}
          <Botao onClick={() => setEdit(null)}>Cancelar</Botao>
          <Botao variante="primario" disabled={!edit?.grupo?.trim() || !edit?.campo?.trim()} onClick={async () => {
            const d = { grupo: edit.grupo.trim(), campo: edit.campo.trim(), definicao: edit.definicao || null, fonte: edit.fonte || null, responsavel: edit.responsavel || null,
              edicao: edit.edicao || null, sensibilidade: edit.sensibilidade, atualizacao: edit.atualizacao || null, situacao: edit.situacao, observacao: edit.observacao || null, ordem: Number(edit.ordem) || 999 };
            const { error } = edit.id ? await supabase.from('catalogo_campo').update(d).eq('id', edit.id) : await supabase.from('catalogo_campo').insert(d);
            if (error) toast(msgErro(error), 'erro'); else { toast('Dicionário atualizado.'); invalidar('dicionario'); setEdit(null); }
          }}>Salvar</Botao>
        </>}>
        {edit && (
          <div className="form-grade">
            <Campo rotulo="Grupo *"><input value={edit.grupo} onChange={(e) => setEdit({ ...edit, grupo: e.target.value })} /></Campo>
            <Campo rotulo="Informação *"><input value={edit.campo} onChange={(e) => setEdit({ ...edit, campo: e.target.value })} /></Campo>
            <Campo rotulo="Ordem"><input type="number" value={edit.ordem} onChange={(e) => setEdit({ ...edit, ordem: e.target.value })} /></Campo>
            <Campo rotulo="Definição" largura="inteira"><textarea rows={2} value={edit.definicao || ''} onChange={(e) => setEdit({ ...edit, definicao: e.target.value })} /></Campo>
            <Campo rotulo="Fonte oficial" largura="meia"><input value={edit.fonte || ''} onChange={(e) => setEdit({ ...edit, fonte: e.target.value })} /></Campo>
            <Campo rotulo="Responsável (seção/órgão)" largura="meia"><input value={edit.responsavel || ''} onChange={(e) => setEdit({ ...edit, responsavel: e.target.value })} /></Campo>
            <Campo rotulo="Quem edita no sistema" largura="meia"><input value={edit.edicao || ''} onChange={(e) => setEdit({ ...edit, edicao: e.target.value })} /></Campo>
            <Campo rotulo="Atualização"><input value={edit.atualizacao || ''} onChange={(e) => setEdit({ ...edit, atualizacao: e.target.value })} /></Campo>
            <Campo rotulo="Sensibilidade"><select value={edit.sensibilidade} onChange={(e) => setEdit({ ...edit, sensibilidade: e.target.value })}>
              {Object.entries(SENSIB).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}</select></Campo>
            <Campo rotulo="Situação"><select value={edit.situacao} onChange={(e) => setEdit({ ...edit, situacao: e.target.value })}>
              {Object.entries(SITUACAO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}</select></Campo>
            <Campo rotulo="Observação" largura="inteira"><input value={edit.observacao || ''} onChange={(e) => setEdit({ ...edit, observacao: e.target.value })} /></Campo>
          </div>
        )}
      </Modal>
    </div>
  );
}
