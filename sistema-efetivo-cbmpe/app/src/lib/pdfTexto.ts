// Extrai o texto (com posição) de um PDF no próprio navegador. Nada é enviado ao servidor.
// Carregado sob demanda: só a tela de atualização mensal usa.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { Pagina } from './referencias';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function lerPdf(arquivo: File, opcoes: { ate?: number; progresso?: (feitas: number, total: number) => void } = {}): Promise<Pagina[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()), verbosity: 0 }).promise;
  const total = Math.min(doc.numPages, opcoes.ate || doc.numPages);
  const paginas: Pagina[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      const pg = await doc.getPage(i);
      const c = await pg.getTextContent();
      paginas.push(c.items.flatMap((it: any) => ('str' in it && it.str ? [{ s: it.str as string, x: it.transform[4] as number, y: it.transform[5] as number, w: it.width as number }] : [])));
      pg.cleanup();
      if (i % 5 === 0 || i === total) opcoes.progresso?.(i, total);
    }
  } finally {
    await doc.destroy();
  }
  return paginas;
}
