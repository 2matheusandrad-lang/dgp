import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { recarregarDominios, useDominios } from '../lib/dominios';
import { PAPEL, fmtData, fmtDataHora, mascaraMatricula, msgErro, semAcento } from '../lib/util';
import { Abas, Aviso, Badge, Botao, Campo, Cartao, Carregando, Modal, Tabela, useToast } from '../components/ui';

export default function Admin() {
  const { admin, gestaoGlobal } = useAuth();
  const [aba, setAba] = useState(admin ? 'usuarios' : 'omes');
  const abas = [
    ...(admin ? [{ id: 'usuarios', rotulo: 'Usuários e acessos' }] : []),
    { id: 'omes', rotulo: gestaoGlobal ? 'OMEs e seções' : 'Seções' },
    ...(gestaoGlobal ? [{ id: 'tabelas', rotulo: 'Tabelas' }] : []),
  ];
  return (
    <div className="pagina">
      <div className="pagina-cab"><div><h1>{gestaoGlobal ? 'Administração' : 'Seções da OME'}</h1></div></div>
      {abas.length > 1 && <Abas abas={abas} ativa={aba} onChange={setAba} />}
      {aba === 'usuarios' && admin && <Usuarios />}
      {aba === 'omes' && <OmesSecoes />}
      {aba === 'tabelas' && gestaoGlobal && <Tabelas />}
    </div>
  );
}

const gerarSenha = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(12); crypto.getRandomValues(a);
  return Array.from(a, (x) => c[x % c.length]).join('') + '#' + (a[0] % 90 + 10);
};

// =====================================================================
function Usuarios() {
  const dom = useDominios();
  const toast = useToast();
  const [lista, setLista] = useState<any[] | null>(null);
  const [busca, setBusca] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ email: string; senha: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    supabase.from('v_perfil').select('*').order('ativo').order('nome').then(({ data, error }) => (error ? setErro(msgErro(error)) : setLista(data || [])));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const set = (k: string, v: any) => setEdit((e: any) => ({ ...e, [k]: v }));
  const chamarFuncao = async (body: any) => {
    const { data, error } = await supabase.functions.invoke('admin-usuarios', { body });
    if (error) {
      let msg = error.message;
      try { const j = await (error as any).context?.json(); if (j?.erro) msg = j.erro; } catch { /* sem corpo */ }
      if (/Failed to send|not found|404/i.test(msg)) msg = 'A função "admin-usuarios" não está publicada no Supabase. Veja o README (passo 5) ou crie o usuário em Authentication > Users e libere-o aqui.';
      throw new Error(msg);
    }
    return data;
  };

  const salvar = async () => {
    setErro(null); setSalvando(true);
    try {
      if (!edit.email?.trim()) throw new Error('Informe o e-mail.');
      if ((edit.papel === 'GESTOR' || edit.papel === 'LEITOR') && !edit.omes_ids.length) throw new Error('Vincule ao menos uma OME.');
      const perfil = { nome: edit.nome || null, posto: edit.posto || null, matricula: edit.matricula || null, telefone: edit.telefone || null,
        papel: edit.papel, pode_ver_saude: !!edit.pode_ver_saude, ativo: !!edit.ativo };
      if (!edit.id) {
        const senha = gerarSenha();
        await chamarFuncao({ acao: 'criar', email: edit.email.trim().toLowerCase(), senha, perfil, omes: edit.omes_ids });
        setSenhaGerada({ email: edit.email, senha });
      } else {
        const { error } = await supabase.from('perfil').update(perfil).eq('id', edit.id);
        if (error) throw error;
        const { error: e1 } = await supabase.from('perfil_ome').delete().eq('perfil_id', edit.id);
        if (e1) throw e1;
        if (edit.omes_ids.length) {
          const { error: e2 } = await supabase.from('perfil_ome').insert(edit.omes_ids.map((o: number) => ({ perfil_id: edit.id, ome_id: o })));
          if (e2) throw e2;
        }
        toast('Usuário atualizado.');
      }
      setEdit(null); carregar();
    } catch (e) { setErro(msgErro(e)); } finally { setSalvando(false); }
  };

  const redefinir = async (u: any) => {
    try {
      const senha = gerarSenha();
      await chamarFuncao({ acao: 'redefinir_senha', id: u.id, senha });
      setSenhaGerada({ email: u.email, senha });
    } catch (e) { toast(msgErro(e), 'erro'); }
  };

  if (!lista || !dom) return erro ? <Aviso tom="erro">{erro}</Aviso> : <Carregando />;
  const b = semAcento(busca);
  const filtrada = lista.filter((u) => !b || semAcento(`${u.nome} ${u.email} ${u.omes_siglas} ${u.matricula}`).includes(b));
  const pendentes = lista.filter((u) => !u.ativo).length;

  return (
    <>
      {pendentes > 0 && <Aviso tom="alerta">{pendentes} usuário(s) aguardando liberação ou desativados.</Aviso>}
      <div className="filtros">
        <Campo rotulo="Buscar"><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="nome, e-mail, OME" /></Campo>
        <div className="acoes fim"><Botao variante="primario" onClick={() => { setErro(null); setEdit({ email: '', nome: '', posto: '', matricula: '', telefone: '', papel: 'GESTOR', pode_ver_saude: false, ativo: true, omes_ids: [] }); }}>+ Novo usuário</Botao></div>
      </div>
      <Tabela linhas={filtrada} chave={(u: any) => u.id} onLinha={(u: any) => { setErro(null); setEdit({ ...u, omes_ids: u.omes_ids || [] }); }} colunas={[
        { id: 'nome', titulo: 'Nome', render: (u: any) => <>{[u.posto, u.nome].filter(Boolean).join(' ')}<div className="nota">{u.email}</div></> },
        { id: 'papel', titulo: 'Perfil', render: (u: any) => PAPEL[u.papel] },
        { id: 'omes_siglas', titulo: 'OMEs', render: (u: any) => (['ADMIN', 'DGP', 'LEITOR_GERAL'].includes(u.papel) ? <span className="nota">todas</span> : u.omes_siglas || <Badge tom="vermelho">nenhuma</Badge>) },
        { id: 'pode_ver_saude', titulo: 'Saúde', render: (u: any) => (u.pode_ver_saude || u.papel === 'ADMIN' ? <Badge tom="roxo">sim</Badge> : '') },
        { id: 'ativo', titulo: 'Situação', render: (u: any) => (u.ativo ? <Badge tom="verde">ativo</Badge> : <Badge tom="amarelo">bloqueado</Badge>) },
        { id: 'ultimo_acesso', titulo: 'Último acesso', render: (u: any) => fmtDataHora(u.ultimo_acesso) || <span className="nota">nunca</span> },
        { id: 'r', titulo: '', ordenavel: false, render: (u: any) => <span onClick={(e) => e.stopPropagation()}><Botao pequeno variante="fantasma" onClick={() => redefinir(u)}>Nova senha</Botao></span> },
      ]} />

      <Modal largo aberto={!!edit} titulo={edit?.id ? 'Editar usuário' : 'Novo usuário'} onFechar={() => setEdit(null)}
        rodape={<><Botao onClick={() => setEdit(null)}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</Botao></>}>
        {edit && <>
          <div className="form-grade">
            <Campo rotulo="E-mail (login) *" largura="meia" dica={edit.id ? 'Para trocar o e-mail, crie um novo usuário.' : 'De preferência o e-mail institucional da SAAdm da OME'}>
              <input type="email" value={edit.email || ''} disabled={!!edit.id} onChange={(e) => set('email', e.target.value)} />
            </Campo>
            <Campo rotulo="Posto/Grad."><input value={edit.posto || ''} onChange={(e) => set('posto', e.target.value)} placeholder="ex.: 2º Ten" /></Campo>
            <Campo rotulo="Matrícula"><input value={edit.matricula || ''} onChange={(e) => set('matricula', mascaraMatricula(e.target.value))} /></Campo>
            <Campo rotulo="Nome" largura="meia"><input value={edit.nome || ''} onChange={(e) => set('nome', e.target.value)} /></Campo>
            <Campo rotulo="Telefone"><input value={edit.telefone || ''} onChange={(e) => set('telefone', e.target.value)} /></Campo>
            <Campo rotulo="Perfil de acesso *">
              <select value={edit.papel} onChange={(e) => set('papel', e.target.value)}>
                {Object.entries(PAPEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
            <label className="check"><input type="checkbox" checked={!!edit.ativo} onChange={(e) => set('ativo', e.target.checked)} /> Acesso liberado</label>
            <label className="check"><input type="checkbox" checked={!!edit.pode_ver_saude} onChange={(e) => set('pode_ver_saude', e.target.checked)} /> Pode ver/registrar natureza e CID (dado sensível)</label>
          </div>
          <p className="nota">{{
            ADMIN: 'Tudo, inclusive usuários e exclusão de cadastros.', DGP: 'Consulta e edita todas as OMEs; fecha a competência.',
            LEITOR_GERAL: 'Consulta todas as OMEs, sem editar.', GESTOR: 'Consulta e edita apenas as OMEs marcadas abaixo.', LEITOR: 'Apenas consulta as OMEs marcadas abaixo.',
          }[edit.papel as string]}</p>
          {(edit.papel === 'GESTOR' || edit.papel === 'LEITOR') && (
            <div className="omes-check">
              {dom.omes.filter((o) => o.ativo).map((o) => (
                <label key={o.id} className="check">
                  <input type="checkbox" checked={edit.omes_ids.includes(o.id)}
                    onChange={(e) => set('omes_ids', e.target.checked ? [...edit.omes_ids, o.id] : edit.omes_ids.filter((x: number) => x !== o.id))} />
                  {o.sigla}
                </label>
              ))}
            </div>
          )}
          {edit.criado_em && <p className="nota">Criado em {fmtData(edit.criado_em)} · último acesso {fmtDataHora(edit.ultimo_acesso) || 'nunca'}</p>}
          {erro && <Aviso tom="erro">{erro}</Aviso>}
        </>}
      </Modal>

      <Modal aberto={!!senhaGerada} titulo="Senha provisória" onFechar={() => setSenhaGerada(null)} rodape={<Botao variante="primario" onClick={() => setSenhaGerada(null)}>Fechar</Botao>}>
        <p>Envie ao usuário por canal seguro. Ela será trocada obrigatoriamente no primeiro acesso.</p>
        <div className="senha-box"><div>{senhaGerada?.email}</div><code>{senhaGerada?.senha}</code></div>
        <Botao onClick={() => { navigator.clipboard?.writeText(`Login: ${senhaGerada?.email}\nSenha provisória: ${senhaGerada?.senha}\nEndereço: ${window.location.origin}`); toast('Copiado.'); }}>Copiar mensagem</Botao>
      </Modal>
    </>
  );
}

// =====================================================================
function OmesSecoes() {
  const { gestaoGlobal, ctx, podeEditarOme } = useAuth();
  const dom = useDominios();
  const toast = useToast();
  const [omeSel, setOmeSel] = useState<number | null>(null);
  const [editOme, setEditOme] = useState<any>(null);
  const [novaSecao, setNovaSecao] = useState('');
  if (!dom) return <Carregando />;
  const omes = gestaoGlobal ? dom.omes : dom.omes.filter((o) => podeEditarOme(o.id) || ctx?.omes.some((x) => x.id === o.id));
  const sel = omeSel ?? omes[0]?.id;
  const secoes = dom.secoes.filter((s) => s.ome_id === sel).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  const podeSec = podeEditarOme(sel);

  const salvarSecao = async (s: any, mud: any) => {
    const { error } = await supabase.from('secao').update(mud).eq('id', s.id);
    if (error) toast(msgErro(error), 'erro'); else recarregarDominios();
  };

  return (
    <div className="grade-2 assimetrica">
      <Cartao titulo="OMEs" acoes={gestaoGlobal && <Botao pequeno onClick={() => setEditOme({ sigla: '', nome: '', tipo: 'OUTRA', ordem: 999, ativo: true })}>+ OME</Botao>}>
        <ul className="lista-sel">
          {omes.map((o) => (
            <li key={o.id} className={o.id === sel ? 'ativo' : ''} onClick={() => setOmeSel(o.id)}>
              <span><strong>{o.sigla}</strong> {o.nome && <span className="nota">{o.nome}</span>}</span>
              <span>{!o.ativo && <Badge>inativa</Badge>}{gestaoGlobal && <button className="link" onClick={(e) => { e.stopPropagation(); setEditOme({ ...o }); }}>editar</button>}</span>
            </li>
          ))}
        </ul>
      </Cartao>
      <Cartao titulo={`Seções · ${dom.omes.find((o) => o.id === sel)?.sigla || ''}`}>
        <p className="nota">Subgrupamentos, seções administrativas ou, para ADIDO, o órgão onde o militar está.</p>
        <table className="tabela compacta">
          <thead><tr><th>Nome</th><th style={{ width: 80 }}>Ordem</th><th style={{ width: 90 }}>Ativa</th></tr></thead>
          <tbody>
            {secoes.map((s) => (
              <tr key={s.id}>
                <td><input defaultValue={s.nome} disabled={!podeSec} onBlur={(e) => e.target.value.trim() && e.target.value !== s.nome && salvarSecao(s, { nome: e.target.value.trim() })} /></td>
                <td><input type="number" defaultValue={s.ordem} disabled={!podeSec} onBlur={(e) => Number(e.target.value) !== s.ordem && salvarSecao(s, { ordem: Number(e.target.value) })} /></td>
                <td><input type="checkbox" checked={s.ativo} disabled={!podeSec} onChange={(e) => salvarSecao(s, { ativo: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {podeSec && (
          <div className="linha-form">
            <input placeholder="Nova seção (ex.: 4ª SB (Cidade))" value={novaSecao} onChange={(e) => setNovaSecao(e.target.value)} />
            <Botao pequeno onClick={async () => {
              if (!novaSecao.trim()) return;
              const { error } = await supabase.from('secao').insert({ ome_id: sel, nome: novaSecao.trim(), ordem: secoes.length + 1 });
              if (error) toast(msgErro(error), 'erro'); else { setNovaSecao(''); recarregarDominios(); }
            }}>Adicionar</Botao>
          </div>
        )}
      </Cartao>

      <Modal aberto={!!editOme} titulo={editOme?.id ? 'Editar OME' : 'Nova OME'} onFechar={() => setEditOme(null)}
        rodape={<><Botao onClick={() => setEditOme(null)}>Cancelar</Botao><Botao variante="primario" onClick={async () => {
          const d = { sigla: editOme.sigla.trim(), nome: editOme.nome?.trim() || null, tipo: editOme.tipo, ordem: Number(editOme.ordem) || 999, ativo: !!editOme.ativo };
          const { error } = editOme.id ? await supabase.from('ome').update(d).eq('id', editOme.id) : await supabase.from('ome').insert(d);
          if (error) toast(msgErro(error), 'erro'); else { toast('OME salva.'); setEditOme(null); recarregarDominios(); }
        }}>Salvar</Botao></>}>
        {editOme && <div className="form-grade">
          <Campo rotulo="Sigla *"><input value={editOme.sigla} onChange={(e) => setEditOme({ ...editOme, sigla: e.target.value })} /></Campo>
          <Campo rotulo="Nome por extenso" largura="meia"><input value={editOme.nome || ''} onChange={(e) => setEditOme({ ...editOme, nome: e.target.value })} /></Campo>
          <Campo rotulo="Tipo"><select value={editOme.tipo} onChange={(e) => setEditOme({ ...editOme, tipo: e.target.value })}>
            <option value="GRUPAMENTO">Grupamento</option><option value="DIRETORIA">Diretoria</option><option value="ADIDOS">Adidos</option><option value="OUTRA">Outra</option>
          </select></Campo>
          <Campo rotulo="Ordem de exibição"><input type="number" value={editOme.ordem} onChange={(e) => setEditOme({ ...editOme, ordem: e.target.value })} /></Campo>
          <label className="check"><input type="checkbox" checked={!!editOme.ativo} onChange={(e) => setEditOme({ ...editOme, ativo: e.target.checked })} /> Ativa</label>
        </div>}
      </Modal>
    </div>
  );
}

// =====================================================================
function Tabelas() {
  const dom = useDominios();
  const toast = useToast();
  const [feriados, setFeriados] = useState<any[]>([]);
  const [novoTipo, setNovoTipo] = useState({ codigo: '', nome: '', exige_saude: false });
  const [novoFeriado, setNovoFeriado] = useState({ data: '', descricao: '' });
  const [novoQuadro, setNovoQuadro] = useState('');
  const carregarFeriados = () => supabase.from('feriado').select('*').gte('data', new Date().getFullYear() + '-01-01').order('data').then(({ data }) => setFeriados(data || []));
  useEffect(() => { carregarFeriados(); }, []);
  if (!dom) return <Carregando />;
  const salvarTipo = async (t: any, mud: any) => {
    const { error } = await supabase.from('tipo_afastamento').update(mud).eq('id', t.id);
    if (error) toast(msgErro(error), 'erro'); else recarregarDominios();
  };
  return (
    <div className="grade-2">
      <Cartao titulo="Tipos de afastamento">
        <p className="nota">“Saúde” habilita natureza (Físico/Mental) e CID no lançamento.</p>
        <table className="tabela compacta">
          <thead><tr><th>Código</th><th>Nome</th><th>Saúde</th><th>Ativo</th></tr></thead>
          <tbody>{dom.tiposAfast.map((t) => (
            <tr key={t.id}>
              <td>{t.codigo}</td>
              <td><input defaultValue={t.nome} onBlur={(e) => e.target.value !== t.nome && salvarTipo(t, { nome: e.target.value })} /></td>
              <td><input type="checkbox" checked={t.exige_saude} onChange={(e) => salvarTipo(t, { exige_saude: e.target.checked })} /></td>
              <td><input type="checkbox" checked={t.ativo} onChange={(e) => salvarTipo(t, { ativo: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table>
        <div className="linha-form">
          <input placeholder="CÓDIGO" value={novoTipo.codigo} onChange={(e) => setNovoTipo({ ...novoTipo, codigo: e.target.value.toUpperCase().replace(/\s/g, '_') })} style={{ maxWidth: 140 }} />
          <input placeholder="Nome" value={novoTipo.nome} onChange={(e) => setNovoTipo({ ...novoTipo, nome: e.target.value })} />
          <label className="check"><input type="checkbox" checked={novoTipo.exige_saude} onChange={(e) => setNovoTipo({ ...novoTipo, exige_saude: e.target.checked })} />saúde</label>
          <Botao pequeno onClick={async () => {
            if (!novoTipo.codigo || !novoTipo.nome) return;
            const { error } = await supabase.from('tipo_afastamento').insert({ ...novoTipo, ordem: 50 });
            if (error) toast(msgErro(error), 'erro'); else { setNovoTipo({ codigo: '', nome: '', exige_saude: false }); recarregarDominios(); }
          }}>Adicionar</Botao>
        </div>
      </Cartao>
      <div>
        <Cartao titulo="Feriados (cálculo do 5º dia útil)">
          <table className="tabela compacta">
            <tbody>{feriados.map((f) => (
              <tr key={f.data}><td>{fmtData(f.data)}</td><td>{f.descricao}</td>
                <td><button className="link" onClick={async () => { await supabase.from('feriado').delete().eq('data', f.data); carregarFeriados(); }}>remover</button></td></tr>
            ))}</tbody>
          </table>
          <div className="linha-form">
            <input type="date" value={novoFeriado.data} onChange={(e) => setNovoFeriado({ ...novoFeriado, data: e.target.value })} />
            <input placeholder="Descrição" value={novoFeriado.descricao} onChange={(e) => setNovoFeriado({ ...novoFeriado, descricao: e.target.value })} />
            <Botao pequeno onClick={async () => {
              if (!novoFeriado.data || !novoFeriado.descricao) return;
              const { error } = await supabase.from('feriado').insert(novoFeriado);
              if (error) toast(msgErro(error), 'erro'); else { setNovoFeriado({ data: '', descricao: '' }); carregarFeriados(); }
            }}>Adicionar</Botao>
          </div>
        </Cartao>
        <Cartao titulo="Quadros de oficiais">
          <div className="chips">{dom.quadros.map((q) => <Badge key={q.sigla}>{q.sigla}</Badge>)}</div>
          <div className="linha-form">
            <input placeholder="Sigla (ex.: QOS)" value={novoQuadro} onChange={(e) => setNovoQuadro(e.target.value.toUpperCase())} />
            <Botao pequeno onClick={async () => {
              if (!novoQuadro) return;
              const { error } = await supabase.from('quadro').insert({ sigla: novoQuadro });
              if (error) toast(msgErro(error), 'erro'); else { setNovoQuadro(''); recarregarDominios(); }
            }}>Adicionar</Botao>
          </div>
        </Cartao>
      </div>
    </div>
  );
}
