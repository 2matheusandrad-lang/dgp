import { ReactNode, useState } from 'react';
import { Aviso, Botao, ColTabela, Confirmar, Modal, Tabela, useToast } from './ui';
import { msgErro } from '../lib/util';

/** Lista + formulário em modal para os registros ligados ao militar (afastamentos, formação etc.) */
export default function CrudFilho<T extends { id?: string }>({
  titulo, linhas, colunas, novo, form, salvar, excluir, podeEditar, recarregar, rotuloNovo = 'Adicionar', descricao,
}: {
  titulo: string;
  linhas: T[];
  colunas: ColTabela<T>[];
  novo: () => any;
  form: (v: any, set: (k: string, val: any) => void) => ReactNode;
  salvar: (v: any) => Promise<void>;
  excluir?: (r: T) => Promise<void>;
  podeEditar: boolean;
  recarregar: () => void;
  rotuloNovo?: string;
  descricao?: ReactNode;
}) {
  const toast = useToast();
  const [edit, setEdit] = useState<any | null>(null);
  const [apagar, setApagar] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const set = (k: string, val: any) => setEdit((e: any) => ({ ...e, [k]: val }));

  const confirmar = async () => {
    setErro(null); setSalvando(true);
    try { await salvar(edit); setEdit(null); toast('Salvo.'); recarregar(); }
    catch (e) { setErro(msgErro(e)); }
    finally { setSalvando(false); }
  };

  const cols: ColTabela<T>[] = podeEditar
    ? [...colunas, {
        id: '_acoes', titulo: '', ordenavel: false, className: 'acoes-linha',
        render: (r: T) => (
          <span onClick={(e) => e.stopPropagation()}>
            <Botao pequeno variante="fantasma" onClick={() => { setErro(null); setEdit({ ...r }); }}>Editar</Botao>
            {excluir && <Botao pequeno variante="fantasma" onClick={() => setApagar(r)}>Excluir</Botao>}
          </span>
        ),
      }]
    : colunas;

  return (
    <div className="crud">
      <div className="crud-cab">
        <div>{descricao}</div>
        {podeEditar && <Botao variante="primario" pequeno onClick={() => { setErro(null); setEdit(novo()); }}>+ {rotuloNovo}</Botao>}
      </div>
      <Tabela linhas={linhas} colunas={cols} chave={(r: any) => r.id || JSON.stringify(r)} porPagina={20} vazio="Nenhum registro." />
      <Modal aberto={!!edit} titulo={`${edit?.id ? 'Editar' : 'Novo'} · ${titulo}`} onFechar={() => setEdit(null)}
        rodape={<><Botao onClick={() => setEdit(null)}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={confirmar}>{salvando ? 'Salvando…' : 'Salvar'}</Botao></>}>
        {edit && <div className="form-grade">{form(edit, set)}</div>}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </Modal>
      <Confirmar aberto={!!apagar} titulo="Excluir registro" perigo rotuloSim="Excluir"
        texto="Confirma a exclusão deste registro? A exclusão fica registrada no histórico de alterações."
        onNao={() => setApagar(null)}
        onSim={async () => {
          try { await excluir!(apagar!); toast('Excluído.'); recarregar(); } catch (e) { toast(msgErro(e), 'erro'); }
          setApagar(null);
        }} />
    </div>
  );
}
