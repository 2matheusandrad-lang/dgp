import { supabase } from './supabase';
import { ATIVIDADE, Coluna, buscarTodos, fmtData } from './util';

// Colunas leves para a lista (contatos e endereço só são buscados ao exportar)
export const COLS_LISTA = [
  'id', 'matricula', 'nome', 'nome_guerra', 'posto_id', 'posto_sigla', 'posto_ordem', 'posto_completo', 'quadro_sigla', 'oficial',
  'ome_id', 'ome_sigla', 'secao_id', 'secao_nome', 'atividade', 'ano_ingresso', 'ordem_antiguidade', 'situacao', 'data_situacao',
  'afastado_hoje', 'afastamento_codigo', 'afastamento_nome', 'afastamento_fim', 'readaptado', 'horario_especial',
  'acumulacao_cargo', 'pcd', 'escolaridade', 'escolaridade_ordem', 'areas_formacao', 'idiomas', 'qtd_punicoes',
  'completude', 'pendencias', 'telefone1',
].join(',');

export async function carregarEfetivo(escopo: number | null, situacao: string, colunas = COLS_LISTA) {
  return buscarTodos(() => {
    let q = supabase.from('v_militar').select(colunas).order('posto_ordem').order('quadro_sigla', { ascending: false, nullsFirst: true }).order('ordem_antiguidade', { nullsFirst: false }).order('id');
    if (escopo) q = q.eq('ome_id', escopo);
    if (situacao) q = q.eq('situacao', situacao);
    return q;
  });
}

const sn = (b: boolean) => (b ? 'Sim' : 'Não');
export const COLUNAS_EFETIVO: (Coluna & { id: string; contato?: boolean })[] = [
  { id: 'n', titulo: 'Nº', valor: (_r, i) => i + 1, largura: 5, padrao: true },
  { id: 'posto', titulo: 'Posto/Grad.', valor: (r) => r.posto_completo, largura: 11, padrao: true },
  { id: 'matricula', titulo: 'Matrícula', valor: (r) => r.matricula, largura: 11, padrao: true },
  { id: 'nome', titulo: 'Nome', valor: (r) => r.nome, largura: 40, padrao: true },
  { id: 'guerra', titulo: 'Nome de guerra', valor: (r) => r.nome_guerra, largura: 16 },
  { id: 'ome', titulo: 'OME', valor: (r) => r.ome_sigla, largura: 10, padrao: true },
  { id: 'secao', titulo: 'Seção', valor: (r) => r.secao_nome, largura: 24, padrao: true },
  { id: 'atividade', titulo: 'Atividade', valor: (r) => ATIVIDADE[r.atividade] || '', largura: 14, padrao: true },
  { id: 'hoje', titulo: 'Situação hoje', valor: (r) => (r.situacao !== 'ATIVO' ? r.situacao : r.afastado_hoje ? `${r.afastamento_codigo} até ${fmtData(r.afastamento_fim)}` : 'Disponível'), largura: 22, padrao: true },
  { id: 'readaptado', titulo: 'Readaptado', valor: (r) => sn(r.readaptado), largura: 10 },
  { id: 'he', titulo: 'Horário especial', valor: (r) => sn(r.horario_especial), largura: 10 },
  { id: 'acumulacao', titulo: 'Acumulação', valor: (r) => sn(r.acumulacao_cargo), largura: 10 },
  { id: 'pcd', titulo: 'PCD', valor: (r) => sn(r.pcd), largura: 6 },
  { id: 'escolaridade', titulo: 'Escolaridade', valor: (r) => r.escolaridade, largura: 18 },
  { id: 'areas', titulo: 'Áreas de formação', valor: (r) => r.areas_formacao, largura: 30 },
  { id: 'idiomas', titulo: 'Idiomas', valor: (r) => r.idiomas, largura: 14 },
  { id: 'ingresso', titulo: 'Ano ingresso', valor: (r) => r.ano_ingresso, largura: 8 },
  { id: 'email', titulo: 'E-mail', valor: (r) => r.email, largura: 30, contato: true },
  { id: 'telefone', titulo: 'Telefone', valor: (r) => r.telefone1, largura: 16 },
  { id: 'telefone2', titulo: 'Telefone 2', valor: (r) => r.telefone2, largura: 16, contato: true },
  { id: 'endereco', titulo: 'Endereço', valor: (r) => r.endereco, largura: 50, contato: true },
  { id: 'completude', titulo: 'Cadastro (%)', valor: (r) => r.completude, largura: 9 },
  { id: 'pendencias', titulo: 'Pendências', valor: (r) => (r.pendencias || []).join(', '), largura: 40 },
  { id: 'assinatura', titulo: 'Visto', valor: () => '', largura: 14 },
];
