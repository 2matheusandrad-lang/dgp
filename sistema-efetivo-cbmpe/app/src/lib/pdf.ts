// Geração de PDF (carregado sob demanda)
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Coluna } from './util';
import { fmtCompetencia, fmtData, fmtDataHora, marcaLgpd, pct, registrarExportacao } from './util';

const VERMELHO: [number, number, number] = [143, 29, 29];

function cabecalhoRodape(doc: jsPDF, titulo: string, subtitulo: string) {
  const n = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const gerado = marcaLgpd();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30);
    doc.text('CBMPE — DGP', 12, 10);
    doc.setFont('helvetica', 'normal');
    doc.text(titulo, w - 12, 10, { align: 'right' });
    if (subtitulo) { doc.setFontSize(8); doc.setTextColor(100); doc.text(subtitulo, w - 12, 14, { align: 'right' }); }
    doc.setDrawColor(...VERMELHO); doc.setLineWidth(0.4); doc.line(12, 16, w - 12, 16);
    doc.setFontSize(7.5); doc.setTextColor(110);
    doc.text(gerado, 12, h - 7);
    doc.text(`Página ${i} de ${n}`, w - 12, h - 7, { align: 'right' });
  }
}

const valor = (v: any) => (v === null || v === undefined ? '' : String(v));

export function pdfTabela<T>({ arquivo, titulo, subtitulo, colunas, linhas, agrupar, assinatura, retrato }: {
  arquivo: string; titulo: string; subtitulo: string; colunas: Coluna<T>[]; linhas: T[];
  agrupar?: (r: T) => string; assinatura?: boolean; retrato?: boolean;
}) {
  const doc = new jsPDF({ orientation: retrato ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' });
  const corpo: any[] = [];
  let g: string | null = null;
  linhas.forEach((r, i) => {
    if (agrupar) {
      const atual = agrupar(r);
      if (atual !== g) {
        const qtd = linhas.filter((x) => agrupar(x) === atual).length;
        corpo.push([{ content: `${atual}  (${qtd})`, colSpan: colunas.length, styles: { fontStyle: 'bold', textColor: VERMELHO, fillColor: [242, 240, 237] } }]);
        g = atual;
      }
    }
    corpo.push(colunas.map((c) => valor(c.valor(r, i))));
  });
  autoTable(doc, {
    head: [colunas.map((c) => c.titulo)], body: corpo, startY: 20, margin: { top: 20, left: 12, right: 12, bottom: 14 },
    styles: { fontSize: colunas.length > 9 ? 6.5 : 7.5, cellPadding: 1.2, overflow: 'linebreak' },
    headStyles: { fillColor: VERMELHO, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 249, 247] },
  });
  let y = (doc as any).lastAutoTable.finalY + 6;
  doc.setFontSize(8); doc.setTextColor(60);
  doc.text(`Total: ${linhas.length} registro(s)`, 12, y);
  if (assinatura) {
    const h = doc.internal.pageSize.getHeight();
    if (y + 28 > h - 14) { doc.addPage(); y = 24; }
    const w = doc.internal.pageSize.getWidth();
    doc.setDrawColor(80); doc.line(w / 2 - 45, y + 20, w / 2 + 45, y + 20);
    doc.text('Responsável pela informação (posto, nome e matrícula)', w / 2, y + 24, { align: 'center' });
  }
  cabecalhoRodape(doc, titulo, subtitulo);
  doc.save(`${arquivo}_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ---------------- Ficha individual ----------------
export function pdfFicha(m: any, afast: any[], sit: any[], form: any[], idiomas: any[], movs: any[], pun: any[] | null) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20);
  doc.text(`${m.posto_completo} ${m.nome}`, 12, 26);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80);
  doc.text(`Matrícula ${m.matricula}${m.nome_guerra ? ' — nome de guerra: ' + m.nome_guerra : ''}`, 12, 32);

  const dados: [string, any][] = [
    ['OME', m.ome_sigla], ['Seção', m.secao_nome], ['Atividade', m.atividade === 'OPERACIONAL' ? 'Operacional' : m.atividade === 'ADMINISTRATIVO' ? 'Administrativo' : ''],
    ['Situação', m.situacao === 'ATIVO' ? (m.afastado_hoje ? `Afastado (${m.afastamento_nome}) até ${fmtData(m.afastamento_fim)}` : 'Ativo — disponível') : m.situacao],
    ['Ano de ingresso', m.ano_ingresso], ['Escolaridade', m.escolaridade], ['Idiomas', m.idiomas],
    ['E-mail', m.email], ['Telefones', [m.telefone1, m.telefone2].filter(Boolean).join(' / ')], ['Endereço', m.endereco],
    ['Observações', m.observacoes],
  ];
  autoTable(doc, {
    startY: 36, body: dados.map(([k, v]) => [k, valor(v)]), theme: 'plain', margin: { left: 12, right: 12, top: 20 },
    styles: { fontSize: 8.5, cellPadding: 1 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 34 } },
  });
  const secao = (titulo: string, head: string[], linhas: any[][]) => {
    let y = (doc as any).lastAutoTable.finalY + 6;
    if (y > 260) { doc.addPage(); y = 24; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...VERMELHO);
    doc.text(titulo, 12, y);
    autoTable(doc, {
      startY: y + 2, head: [head], body: linhas.length ? linhas : [[{ content: 'Nenhum registro.', colSpan: head.length, styles: { textColor: 120 } }]],
      margin: { left: 12, right: 12, top: 20 }, styles: { fontSize: 7.5, cellPadding: 1 },
      headStyles: { fillColor: [235, 232, 228], textColor: 30 },
    });
  };
  secao('Afastamentos', ['Tipo', 'Início', 'Dias', 'Término', 'Processo SEI'],
    afast.map((a) => [a.tipo_nome, fmtData(a.data_inicio), a.dias, fmtData(a.data_fim), valor(a.processo_sei)]));
  secao('Situações funcionais', ['Tipo', 'Detalhe', 'Início', 'Término', 'Processo SEI'],
    sit.map((r) => [({ READAPTACAO: 'Readaptação', HORARIO_ESPECIAL: 'Horário especial', ACUMULACAO_CARGO: 'Acumulação de cargo', PCD: 'PCD' } as any)[r.tipo], valor(r.detalhe), fmtData(r.data_inicio), fmtData(r.data_fim) || 'indeterminado', valor(r.processo_sei)]));
  secao('Formação', ['Nível', 'Área / curso', 'Instituição', 'Conclusão'],
    form.map((f) => [f.nivel_nome, valor(f.area), valor(f.instituicao), valor(f.ano_conclusao)]));
  if (idiomas.length) secao('Idiomas', ['Idioma', 'Nível'], idiomas.map((i) => [i.idioma, valor(i.nivel)]));
  if (pun) secao('Punições', ['Tipo', 'Início', 'Dias', 'Processo'], pun.map((p) => [p.tipo_nome, fmtData(p.data_inicio), valor(p.dias), valor(p.processo)]));
  secao('Movimentações', ['Data', 'Tipo', 'De', 'Para', 'Documento'],
    movs.map((x) => [fmtData(x.data), NOME_MOV[x.tipo] || x.tipo, valor(x.ome_origem_sigla), valor(x.tipo === 'DESLIGAMENTO' ? x.situacao_nova : x.ome_destino_sigla), valor(x.documento)]));
  cabecalhoRodape(doc, 'Ficha individual', `${m.matricula}`);
  registrarExportacao('Ficha individual', `ficha_${m.matricula}`, 'pdf', 1, ['Ficha completa', 'Telefone', 'E-mail', 'Endereço'], true);
  doc.save(`ficha_${m.matricula}.pdf`);
  void w;
}

const NOME_MOV: Record<string, string> = { INCLUSAO: 'Inclusão', TRANSFERENCIA: 'Transferência', DESLIGAMENTO: 'Desligamento', REINCLUSAO: 'Reinclusão', CORRECAO: 'Correção' };

// ---------------- Boletim mensal ----------------
export function pdfBoletim(b: any) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ind = b.indicadores || {};
  const comp = fmtCompetencia(b.competencia);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(20);
  doc.text(`Boletim do Efetivo — competência ${comp}`, 12, 27);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90);
  doc.text(b.fechada ? `Fotografia do fechamento em ${fmtDataHora(b.fechamento?.fechado_em)}` : 'Competência ainda não fechada: números do dia da geração',
    12, 32);
  if (b.qod_competencia) doc.text(`QOD considerado: ${fmtCompetencia(b.qod_competencia)}`, 12, 36);

  const tot = (k: string) => (b.por_ome || []).reduce((s: number, x: any) => s + (x[k] || 0), 0);
  const prev = tot('previsto'), exist = tot('existente'), afast = tot('afastados');
  // a diferença só faz sentido onde há QOD: OMEs sem QOD não entram na conta
  const comQod = (b.por_ome || []).filter((o: any) => o.previsto);
  const existQ = comQod.reduce((s: number, o: any) => s + (o.existente || 0), 0);
  const parcial = (b.por_ome || []).some((o: any) => o.existente && !o.previsto);
  const kpis: [string, string][] = [
    ['Efetivo existente', String(exist)],
    ['Previsto (QOD)', prev ? String(prev) : '—'],
    [parcial ? `Diferença nas ${comQod.length} OMEs com QOD (existente - previsto)` : 'Diferença (existente - previsto)', prev ? `${existQ - prev} (${existQ} existentes / ${prev} previstos)` : '—'],
    ['Afastados', `${afast} (${pct(exist ? (100 * afast) / exist : 0)})`],
    ['Taxa de afastamento no mês (dias)', pct(ind.taxa_afastamento)],
    ['Qualidade cadastral (média)', pct(ind.qualidade?.completude_media)],
  ];
  autoTable(doc, { startY: 40, body: kpis, theme: 'grid', margin: { left: 12, right: 12, top: 20 },
    styles: { fontSize: 9, cellPadding: 1.6 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80 } } });

  const sec = (titulo: string, head: string[], body: any[][], foot?: any[]) => {
    let y = (doc as any).lastAutoTable.finalY + 7;
    if (y > 255) { doc.addPage(); y = 24; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...VERMELHO); doc.text(titulo, 12, y);
    autoTable(doc, { startY: y + 2, head: [head], body: body.length ? body : [[{ content: 'Sem registros.', colSpan: head.length }]], foot: foot ? [foot] : undefined,
      margin: { left: 12, right: 12, top: 20 }, styles: { fontSize: 7.5, cellPadding: 1 },
      headStyles: { fillColor: VERMELHO, textColor: 255 }, footStyles: { fillColor: [235, 232, 228], textColor: 20, fontStyle: 'bold' } });
  };
  sec('Efetivo por OME', ['OME', 'Previsto', 'Existente', 'Diferença', 'Afastados', 'Prontos'],
    (b.por_ome || []).filter((o: any) => o.existente || o.previsto).map((o: any) => [o.sigla, o.previsto || '—', o.existente, o.previsto ? o.existente - o.previsto : '—', o.afastados, o.existente - o.afastados]),
    ['TOTAL', prev || '—', exist, prev ? existQ - prev : '—', afast, exist - afast]);
  sec('Efetivo por posto/graduação', ['Posto/Grad.', 'Previsto', 'Existente', 'Diferença'],
    (b.por_posto || []).map((p: any) => [p.sigla, p.previsto || '—', p.existente, p.previsto && !parcial ? p.existente - p.previsto : '—']));
  if (parcial && prev) {
    const y = (doc as any).lastAutoTable.finalY + 4;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90);
    doc.text('QOD lançado só para parte das OMEs: a diferença por posto aparece quando todas as OMEs tiverem QOD.', 12, y);
  }
  sec('Afastamentos no mês por tipo', ['Tipo', 'Militares', 'Dias no mês'],
    (ind.afastamento_por_tipo || []).map((t: any) => [t.nome, t.militares, t.dias]));
  const mv = ind.movimentacoes || {};
  sec('Movimentações no mês', ['Data', 'Tipo', 'Militar', 'De', 'Para / situação', 'Documento'],
    (b.movimentacoes || []).map((m: any) => [fmtData(m.data), NOME_MOV[m.tipo] || m.tipo, `${m.militar_posto || ''} ${m.militar_nome || ''}`, valor(m.origem), valor(m.tipo === 'DESLIGAMENTO' ? m.situacao_nova : m.destino), valor(m.documento)]),
    [`Inclusões ${mv.inclusoes ?? 0} · transferências ${mv.transferencias_internas ?? 0} · desligamentos ${mv.desligamentos ?? 0}`, '', '', '', '', '']);
  const ent = b.entregas || [];
  const cont = (s: string) => ent.filter((e: any) => e.situacao === s).length;
  sec('Entrega mensal das OMEs', ['No prazo', 'Com atraso', 'Pendentes', 'Atrasadas'],
    [[cont('ENTREGUE NO PRAZO'), cont('ENTREGUE COM ATRASO'), cont('PENDENTE'), cont('ATRASADA')]]);
  const pend = ent.filter((e: any) => e.situacao === 'PENDENTE' || e.situacao === 'ATRASADA').map((e: any) => e.sigla);
  if (pend.length) {
    const y = (doc as any).lastAutoTable.finalY + 4;
    doc.setFontSize(8); doc.setTextColor(80);
    doc.text(doc.splitTextToSize('OMEs sem entrega: ' + pend.join(', '), 186), 12, y);
  }
  cabecalhoRodape(doc, 'Boletim do Efetivo', comp);
  registrarExportacao('Boletim mensal', `boletim_${b.competencia.slice(0, 7)}`, 'pdf', (b.por_ome || []).length, ['Totais por OME'], false);
  doc.save(`boletim_efetivo_${b.competencia.slice(0, 7)}.pdf`);
}
