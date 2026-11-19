const IGNORAR = new Set(['atualizado_em', 'atualizado_por', 'criado_em', 'criado_por', 'id', 'militar_id', 'ultimo_acesso']);

export const NOME_TABELA: Record<string, string> = {
  militar: 'Ficha', afastamento: 'Afastamento', afastamento_saude: 'Dados de saúde', registro_funcional: 'Situação funcional',
  punicao: 'Punição', formacao: 'Formação', militar_idioma: 'Idioma', movimentacao: 'Movimentação', perfil: 'Usuário',
  perfil_ome: 'Acesso a OME', entrega_mensal: 'Entrega mensal', ome: 'OME', secao: 'Seção', tipo_afastamento: 'Tipo de afastamento',
};
export const NOME_OPERACAO: Record<string, string> = { INSERT: 'Inclusão', UPDATE: 'Alteração', DELETE: 'Exclusão' };

const CAMPO: Record<string, string> = {
  matricula: 'matrícula', nome_guerra: 'nome de guerra', posto_id: 'posto (código)', quadro_sigla: 'quadro', ome_id: 'OME (código)',
  secao_id: 'seção (código)', ano_ingresso: 'ano de ingresso', ordem_antiguidade: 'ordem de antiguidade', telefone1: 'telefone',
  telefone2: 'telefone 2', endereco: 'endereço', situacao: 'situação', data_situacao: 'data da situação', documento_situacao: 'documento',
  observacoes: 'observações', tipo_id: 'tipo (código)', data_inicio: 'início', data_fim: 'término', processo_sei: 'processo SEI',
  observacao: 'observação', nivel_id: 'nível (código)', area: 'área', instituicao: 'instituição', ano_conclusao: 'conclusão',
  detalhe: 'detalhe', natureza: 'natureza', cid: 'CID', ome_origem_id: 'OME origem', ome_destino_id: 'OME destino',
  secao_destino_id: 'seção destino', militar_nome: 'militar', militar_matricula: 'matrícula', militar_posto: 'posto',
  registrado_por: 'registrado por', papel: 'perfil', pode_ver_saude: 'acesso à saúde', ativo: 'ativo', deve_trocar_senha: 'troca de senha',
};
const rot = (k: string) => CAMPO[k] || k;
const fmt = (v: any) => (v === null || v === undefined || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Lista "campo: antes → depois" de uma linha de auditoria */
export function diferencas(a: { operacao: string; antes: any; depois: any }): string[] {
  const antes = a.antes || {}, depois = a.depois || {};
  const chaves = Array.from(new Set([...Object.keys(antes), ...Object.keys(depois)])).filter((k) => !IGNORAR.has(k));
  if (a.operacao === 'INSERT') return chaves.filter((k) => depois[k] !== null && depois[k] !== '').map((k) => `${rot(k)}: ${fmt(depois[k])}`);
  if (a.operacao === 'DELETE') return chaves.filter((k) => antes[k] !== null && antes[k] !== '').map((k) => `${rot(k)}: ${fmt(antes[k])}`);
  return chaves.filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k])).map((k) => `${rot(k)}: ${fmt(antes[k])} → ${fmt(depois[k])}`);
}
