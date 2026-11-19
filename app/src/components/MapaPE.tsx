import { useMemo, useState } from 'react';
import { MAPA_VIEWBOX, MUNICIPIOS } from '../lib/mapaPE';

// Mapa de Pernambuco por município (malha do IBGE embutida: nenhum serviço externo de mapas).
// Cores em 5 faixas (quantis dos valores maiores que zero); cinza = sem registro.
const OPAC = [0.18, 0.34, 0.52, 0.72, 0.95];

export default function MapaPE({ valores, formatar = (v) => v.toLocaleString('pt-BR'), rotulo = 'militares', selecionado, onSelecionar, altura }: {
  valores: Map<number, number>;
  formatar?: (v: number) => string;
  rotulo?: string;
  selecionado?: number | null;
  onSelecionar?: (codigo: number | null) => void;
  altura?: number;
}) {
  const [hover, setHover] = useState<{ c: number; x: number; y: number } | null>(null);
  const faixas = useMemo(() => {
    const v = [...valores.values()].filter((x) => x > 0).sort((a, b) => a - b);
    if (!v.length) return [] as number[];
    const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    return [...new Set([q(0.2), q(0.4), q(0.6), q(0.8)])];
  }, [valores]);
  const classe = (v: number | undefined) => {
    if (!v) return -1;
    let i = 0;
    while (i < faixas.length && v > faixas[i]) i++;
    return Math.min(i + (5 - faixas.length - 1), 4);
  };
  const nomeHover = hover ? MUNICIPIOS.find((m) => m.c === hover.c) : null;
  const total = [...valores.values()].reduce((a, b) => a + b, 0);
  const comValor = [...valores.values()].filter((x) => x > 0).length;

  return (
    <div className="mapa-pe" style={altura ? { maxHeight: altura } : undefined}>
      <svg viewBox={MAPA_VIEWBOX} role="img" aria-label={`Mapa de Pernambuco: ${formatar(total)} ${rotulo} em ${comValor} municípios`}
        onMouseLeave={() => setHover(null)}>
        <rect x={895} y={292} width={102} height={46} rx={4} className="mapa-inset" />
        <text x={900} y={302} className="mapa-inset-txt">F. de Noronha</text>
        {MUNICIPIOS.map((m) => {
          const v = valores.get(m.c);
          const k = classe(v);
          return (
            <path key={m.c} d={m.d} fillRule="evenodd"
              className={`mapa-mun${k < 0 ? ' vazio' : ''}${selecionado === m.c ? ' sel' : ''}${onSelecionar ? ' clicavel' : ''}`}
              style={k >= 0 ? { fillOpacity: OPAC[k] } : undefined}
              onMouseMove={(e) => {
                const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setHover({ c: m.c, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              onClick={() => onSelecionar?.(selecionado === m.c ? null : m.c)}>
              <title>{`${m.n}: ${v ? formatar(v) : 'nenhum'}`}</title>
            </path>
          );
        })}
      </svg>
      {hover && nomeHover && (
        <div className="mapa-dica" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <strong>{nomeHover.n}</strong><br />{valores.get(hover.c) ? `${formatar(valores.get(hover.c)!)} ${rotulo}` : `nenhum registro`}
        </div>
      )}
      <div className="mapa-legenda">
        <span><i className="leg-vazio" /> nenhum</span>
        {faixas.length > 0 && OPAC.slice(5 - faixas.length - 1).map((o, i, arr) => {
          const de = i === 0 ? 1 : faixas[i - 1] + 1;
          const ate = i < faixas.length ? faixas[i] : null;
          return <span key={i}><i style={{ fillOpacity: o, opacity: o }} /> {ate == null ? `${formatar(de)}+` : de >= ate ? formatar(ate) : `${formatar(de)}–${formatar(ate)}`}{i === arr.length - 1 ? '' : ''}</span>;
        })}
      </div>
    </div>
  );
}
