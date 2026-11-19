"""Leitor do almanaque do CBMPE (texto extraído com: pdftotext -layout ALMANAQUE.pdf ALMANAQUE.txt).
Devolve um registro por matrícula: posto, quadro, nº de antiguidade, nome, nome de guerra,
nascimento (DN), data de praça (DP) e data da última promoção (a mais recente da linha "Promoções")."""
import re, datetime as dt, unicodedata

MESES = {'JAN': 1, 'FEV': 2, 'MAR': 3, 'ABR': 4, 'MAI': 5, 'MAIO': 5, 'JUN': 6, 'JUL': 7, 'AGO': 8, 'SET': 9, 'OUT': 10, 'NOV': 11, 'DEZ': 12}
SECOES = [  # (prefixo do cabeçalho sem acento/espacos, posto)
    ('TENENTESCORONEIS', 'TENCEL'), ('CORONEIS', 'CEL'), ('MAJORES', 'MAJ'), ('CAPITAES', 'CAP'),
    ('PRIMEIROSTENENTES', '1ºTEN'), ('SEGUNDOSTENENTES', '2ºTEN'), ('ASPIRANTES', 'ASP'),
    ('SUBTENENTES', 'SUBTEN'), ('PRIMEIROSSARGENTOS', '1ºSGT'), ('SEGUNDOSSARGENTOS', '2ºSGT'),
    ('TERCEIROSSARGENTOS', '3ºSGT'), ('CABOS', 'CB'), ('SOLDADOS', 'SD'),
]

def sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

def data2(s):
    """dd/mm/aa -> date (aa > 30 -> 19aa)."""
    try:
        d, m, a = (int(x) for x in s.split('/'))
        a = a + (1900 if a > 30 else 2000)
        return dt.date(a, m, d)
    except Exception:
        return None

def data_promo(s):
    m = re.fullmatch(r'(\d{1,2})([A-Z]{3,4})(\d{2})', s.strip().upper())
    if not m or m.group(2) not in MESES: return None
    try:
        a = int(m.group(3)); return dt.date(a + (1900 if a > 30 else 2000), MESES[m.group(2)], int(m.group(1)))
    except ValueError:
        return None

def guerra(nome):
    ps = [p for p in nome.split() if len(p) > 1 and p == p.upper() and re.search(r'[A-ZÀ-Ü]', p)]
    return ' '.join(ps) or None

def ler(caminho_txt):
    linhas = open(caminho_txt, encoding='utf-8').read().split('\n')
    out, avisos = [], []
    posto = quadro = None
    ativo = False
    i = 0
    while i < len(linhas):
        l = linhas[i]
        chave = re.sub(r'[^A-Z]', '', sem_acento(l).upper())
        if 'QUADRODEOFICIAISCOMBATENTES' in chave: quadro = 'QOC'
        elif 'QUADRODEOFICIAISDAADMINISTRACAO' in chave: quadro = 'QOA'
        if l.strip() and l.strip() == l.strip().upper() and len(chave) >= 5:
            achou = next((p for k, p in SECOES if chave == k), None)
            if achou:
                posto = achou; ativo = True
                if posto in ('SUBTEN', '1ºSGT', '2ºSGT', '3ºSGT', 'CB', 'SD'): quadro = None
            elif chave.startswith('CORPODEBOMBEIROSMILITARDEPERNAMBUCO') or chave.startswith('MOVIMENTOMILITAR'):
                ativo = False
        m = re.match(r'^\s*(\d{1,4})\.\s+(\S.*?)\s*$', l) if ativo else None
        if m:
            num, nome = int(m.group(1)), m.group(2)
            bloco = []
            j = i + 1
            while j < len(linhas) and j < i + 12 and not re.match(r'^\s*\d{1,4}\.\s+\S', linhas[j]):
                bloco.append(linhas[j]); j += 1
            texto = ' '.join(bloco)
            # nome quebrado em duas linhas
            prim = next((b for b in bloco if b.strip()), '')
            if prim and not prim.strip().startswith('DN') and 'Mat.' not in prim and len(prim.strip()) < 60:
                nome = nome + ' ' + prim.strip()
            mm = re.search(r'Mat\.?\s*([\d.]{4,8}-\d)', texto)
            dn = re.search(r'DN\s*(\d{2}/\d{2}/\d{2})', texto)
            dp = re.search(r'DP\s*(\d{2}/\d{2}/\d{2})', texto)
            dp2 = None if dp else re.search(r'DP\s*(\d{1,2}[A-Za-z]{3,4}\d{2})', texto)
            promos = re.findall(r'([A-Z0-9º°][A-Z0-9º° ]*?)\s*[–-]\s*(\d{1,2}[A-Za-z]{3,4}\d{2})', texto.split('Promoções')[-1]) if 'Promoções' in texto else []
            datas = [data_promo(p[1]) for p in promos]
            datas = [d for d in datas if d]
            if not mm:
                avisos.append(f'{caminho_txt.split("/")[-1]}: sem matrícula para "{nome}" ({posto} nº {num})')
            else:
                mat = mm.group(1).replace('.', '')
                out.append(dict(matricula=mat, posto=posto, quadro=quadro, numero=num, nome=re.sub(r'\s+', ' ', nome).strip(),
                                guerra=guerra(nome), dn=data2(dn.group(1)) if dn else None, dp=data2(dp.group(1)) if dp else (data_promo(dp2.group(1)) if dp2 else None),
                                promocao=max(datas) if datas else None))
            i = j
            continue
        i += 1
    # Comandante-Geral e Subcomandante-Geral aparecem só na biografia do início do volume
    MESX = {'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12}
    txt = '\n'.join(linhas[:140])
    for b in re.finditer(r'\d+\s*-\s*Cel BM\s+(.+?)\n.*?Nascido em .*?em (\d+) de (\w+) de (\d{4}).*?Praça de (\d+) de (\w+) de (\d{4}).*?Mat\.:\s*([\d-]+)', txt, re.S):
        if any(x['matricula'] == b.group(8) for x in out): continue
        try:
            out.append(dict(matricula=b.group(8), posto='CEL', quadro='QOC', numero=0, nome=b.group(1).strip(), guerra=guerra(b.group(1)),
                            dn=dt.date(int(b.group(4)), MESX[b.group(3).lower()], int(b.group(2))),
                            dp=dt.date(int(b.group(7)), MESX[b.group(6).lower()], int(b.group(5))), promocao=None))
        except Exception as e:
            avisos.append(f'biografia: {e}')
    return out, avisos

if __name__ == '__main__':
    import sys, collections
    for f in sys.argv[1:]:
        r, av = ler(f)
        c = collections.Counter((x['posto'], x['quadro']) for x in r)
        print(f.split('/')[-1], len(r), dict(c), 'sem DN', sum(1 for x in r if not x['dn']), 'sem promo', sum(1 for x in r if not x['promocao']), 'avisos', len(av))
        for a in av[:5]: print('  ', a)
        print('  ex:', r[0], r[-1])
