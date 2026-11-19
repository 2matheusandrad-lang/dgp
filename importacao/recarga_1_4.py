#!/usr/bin/env python3
"""
Recarga da base (versão 1.4): monta o cadastro a partir das três fontes, cada
campo vindo da fonte que a DGP definiu como oficial (decisão de 18/11/2026).

Uso (os almanaques em PDF são convertidos antes com: pdftotext -layout ARQ.pdf ARQ.txt):
    python3 recarga_1_4.py PECULIO.xlsx PLANILHA.xlsx ALM_OFICIAIS.txt ALM_ST_SGT.txt ALM_CB_SD.txt pasta_saida/

Gera em pasta_saida/ (CONTÊM DADOS PESSOAIS: não vão para o GitHub, Netlify ou e-mail aberto):
    recarga_1_4_parte1.sql   apaga os militares e o que depende deles e carrega o cadastro (rodar 1º)
    recarga_1_4_parte2.sql   afastamentos, situações funcionais, formação, idiomas e punições da planilha (rodar 2º)
    relatorio_recarga_1_4.xlsx  o que foi carregado, de onde veio cada dado e o que as OMEs precisam completar

Fonte de cada campo:
    Pecúlio (SGP): matrícula, nome, posto/graduação, quadro, OME, sexo, nº funcional, órgão de cessão,
                   nome de guerra (almanaque quando faltar), telefone só onde a planilha estiver vazia.
    Almanaque:     data de nascimento, data de praça (ingresso), nº de antiguidade e data da última
                   promoção (estes dois só quando o posto do almanaque é o mesmo do pecúlio).
    Planilha:      seção (só se a OME da planilha for a mesma do pecúlio), atividade, afastamentos,
                   readaptação, horário especial, acumulação, PCD, escolaridade, idiomas, contato.
    Raça/cor do pecúlio NÃO é carregada (LGPD art. 11).
Militar só no pecúlio entra sem seção; militar só na planilha não entra (vai para o relatório).
"""
import sys, os, re, uuid, collections, unicodedata, datetime as dt
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import importar_planilha as IP
import almanaque as ALM

OME_PECULIO = {'SG': 'SCG'}          # siglas do pecúlio que diferem das do sistema
APID = {'CEL': 1, 'TENCEL': 2, 'MAJ': 3, 'CAP': 4, '1ºTEN': 5, '2ºTEN': 6, 'ASP': 7, 'SUBTEN': 8,
        '1ºSGT': 9, '2ºSGT': 10, '3ºSGT': 11, 'CB': 12, 'SD': 13}
SIGLA = {1: 'Cel', 2: 'Ten Cel', 3: 'Maj', 4: 'Cap', 5: '1ºTen', 6: '2ºTen', 7: 'Asp', 8: 'Subten',
         9: '1ºSgt', 10: '2ºSgt', 11: '3ºSgt', 12: 'Cb', 13: 'Sd'}

def sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s or '')) if unicodedata.category(c) != 'Mn')
def nnome(s):
    return re.sub(r'\s+', ' ', sem_acento(s).upper().replace("'", '')).strip()
def limpo(v):
    s = re.sub(r'\s+', ' ', str(v if v is not None else '')).strip()
    return None if s.upper() in IP.VAZIOS else s
def posto_quadro(s):
    s = str(s or '').replace('Promo. Req.', '').strip()
    partes = s.split()
    q = next((p.upper() for p in partes if p.upper() in IP.QUADROS), None)
    pid = IP.POSTOS.get(''.join(p for p in partes if p.upper() not in IP.QUADROS).upper())
    if pid in (1, 2) and not q: q = 'QOC'      # Cel e Ten Cel só existem no QOC
    return pid, q
def telefones_peculio(v):
    s = limpo(v)
    if not s: return []
    out = []
    for parte in re.split(r'[/;,]| e ', str(s)):
        d = re.sub(r'\D', '', parte)
        if len(d) < 8: continue
        if len(d) == 8: out.append(f'{d[:4]}-{d[4:]}')
        else: out.append(IP.telefone(d)[0])
    return out[:2]
def mat6(m):
    """matrícula antiga com 5 dígitos (ex.: 12345-6) ganha o zero à esquerda: 012345-6"""
    m = re.sub(r'[\s.]', '', str(m or ''))
    return '0' + m if re.fullmatch(r'\d{5}-\d', m) else m
def fmt(d):
    return d.strftime('%d/%m/%Y') if isinstance(d, (dt.date, dt.datetime)) else d

def main():
    if len(sys.argv) < 7:
        print(__doc__); sys.exit(1)
    pec_arq, plan_arq, a1, a2, a3, pasta = sys.argv[1:7]
    os.makedirs(pasta, exist_ok=True)

    # ------------------------------------------------------------ pecúlio
    wb = openpyxl.load_workbook(pec_arq, read_only=True, data_only=True)
    rows = list(wb[wb.sheetnames[0]].iter_rows(values_only=True))
    hdr = [str(h).strip() if h else '' for h in rows[0]]
    P, invalidas, completadas = collections.OrderedDict(), [], []
    for r in rows[1:]:
        d = dict(zip(hdr, r))
        mat = limpo(d.get('Matrícula'))
        if not mat: continue
        if mat6(mat) != mat: completadas.append([mat6(mat), mat, limpo(d.get('Nome')), limpo(d.get('OME'))]); mat = mat6(mat)
        pid, q = posto_quadro(d.get('Posto/ Grad'))
        reg = dict(matricula=mat, posto_id=pid, quadro=q, posto_txt=d.get('Posto/ Grad'),
                   ome=OME_PECULIO.get(limpo(d.get('OME')) or '', limpo(d.get('OME'))),
                   municipio=limpo(d.get('Município')), orgao=limpo(d.get('ÓRGÃO')),
                   nfunc=limpo(d.get('nº Funcional')), nome=limpo(d.get('Nome')), guerra=limpo(d.get('Nome de Guerra')),
                   sexo=(limpo(d.get('SEXO')) or '')[:1].upper() or None, ano=d.get('Ano de ingresso'),
                   fones=telefones_peculio(d.get('Fones')))
        if not re.fullmatch(r'\d{6}-\d', mat) or not pid:
            invalidas.append(reg); continue
        P[mat] = reg

    # ------------------------------------------------------------ planilha (mesmas regras da carga inicial)
    IP.problemas.clear()
    linhas = IP.ler_linhas(openpyxl.load_workbook(plan_arq, data_only=True))
    militares, afast, saude, regs, forms, idiomas, puns, secoes, duplicados = IP.processar(linhas)
    L = {m['matricula']: m for m in militares}
    so_planilha = [m for m in L if m not in P]
    # mesmo nome no pecúlio com outra matrícula (erro de digitação na planilha): aproveita os dados da planilha
    por_nome = {nnome(L[m]['nome']): m for m in so_planilha}
    casados_por_nome = {}
    for mat, p in P.items():
        if mat not in L and nnome(p['nome']) in por_nome:
            casados_por_nome[mat] = por_nome.pop(nnome(p['nome']))
    excluidos = [L[m] for m in so_planilha if m not in casados_por_nome.values()]

    # ------------------------------------------------------------ almanaque
    A = {}
    for f in (a1, a2, a3):
        for x in ALM.ler(f)[0]:
            A.setdefault(mat6(x['matricula']), x)

    # ------------------------------------------------------------ montagem
    carga, sem_secao, datas_conferir, antig_nao, tel_pec, ome_mun = [], [], [], [], [], collections.defaultdict(collections.Counter)
    id_planilha = {}
    for mat, p in P.items():
        l = L.get(mat) or L.get(casados_por_nome.get(mat))
        a = A.get(mat)
        mesmo_posto = bool(a) and APID.get(a['posto']) == p['posto_id'] and (p['posto_id'] > 7 or (a['quadro'] or None) == (p['quadro'] or a['quadro']))
        quadro = p['quadro'] or (a['quadro'] if mesmo_posto and p['posto_id'] <= 7 else None)
        mid = l['id'] if l else str(uuid.uuid4())
        if l: id_planilha[l['id']] = mid
        secao = None
        if l and l['secao']:
            if (l['ome'] or '').upper() == (p['ome'] or '').upper(): secao = l['secao']
            else: sem_secao.append([mat, SIGLA[p['posto_id']], p['nome'], p['ome'], f"Planilha na OME {l['ome']} (seção {l['secao']}); pecúlio na {p['ome']}"])
        elif not l:
            sem_secao.append([mat, SIGLA[p['posto_id']], p['nome'], p['ome'],
                              'Turma 2026: ainda fora da planilha' if p['ano'] == 2026 else 'Não está na planilha da OME'])
        else:
            sem_secao.append([mat, SIGLA[p['posto_id']], p['nome'], p['ome'], 'Seção vazia na planilha'])
        t1, t2 = (l['t1'], l['t2']) if l else (None, None)
        if not t1 and not t2 and p['fones']:
            t1 = p['fones'][0]; t2 = p['fones'][1] if len(p['fones']) > 1 else None
            tel_pec.append(mat)
        dn = a['dn'] if a and a['dn'] and dt.date(1930, 1, 1) <= a['dn'] <= dt.date(2015, 12, 31) else None
        dp = a['dp'] if a and a['dp'] and dt.date(1970, 1, 1) <= a['dp'] <= dt.date.today() else None
        ano = dp.year if dp else (int(p['ano']) if p['ano'] else (l['ano'] if l else None))
        if a and not dn: datas_conferir.append([mat, SIGLA[p['posto_id']], p['nome'], p['ome'], 'Data de nascimento ausente ou impossível no almanaque', fmt(a['dn']) or ''])
        if a and not dp: datas_conferir.append([mat, SIGLA[p['posto_id']], p['nome'], p['ome'], 'Data de praça ausente ou impossível no almanaque', ''])
        if not a: datas_conferir.append([mat, SIGLA[p['posto_id']], p['nome'], p['ome'], 'Fora do almanaque de 15/09 (sem nascimento, data de praça e antiguidade)', f"ingresso {p['ano']}"])
        if dp and p['ano'] and abs(int(p['ano']) - dp.year) > 1:
            datas_conferir.append([mat, SIGLA[p['posto_id']], p['nome'], p['ome'], f"Ano de ingresso do pecúlio ({p['ano']}) difere da data de praça do almanaque", fmt(dp)])
        if a and not mesmo_posto:
            antig_nao.append([mat, SIGLA[p['posto_id']], p['nome'], p['ome'], f"{SIGLA.get(APID.get(a['posto']))} {a['quadro'] or ''}".strip(), a['numero']])
        nfunc = p['nfunc'] if p['nfunc'] and re.fullmatch(r'[0-9]{3,9}(/[0-9]{1,3})?', p['nfunc']) else None
        orgao = p['orgao'] if p['orgao'] and p['orgao'].upper() != 'CBMPE' else None
        if p['municipio']: ome_mun[p['ome']][p['municipio']] += 1
        carga.append(dict(id=mid, matricula=mat, nome=p['nome'], posto_id=p['posto_id'], quadro=quadro, ome=p['ome'], secao=secao,
                          atividade=l['atividade'] if l else None, ano=ano, ordem=a['numero'] if mesmo_posto and a['numero'] else None,
                          email=l['email'] if l else None, t1=t1, t2=t2, endereco=l['endereco'] if l else None, obs=l['obs'] if l else None,
                          guerra=p['guerra'] or (a['guerra'] if a else None), sexo=p['sexo'] if p['sexo'] in ('M', 'F') else None,
                          dn=dn, dp=dp, promocao=a['promocao'] if mesmo_posto and a['promocao'] else None, nfunc=nfunc, orgao=orgao))

    # detalhes da planilha só dos militares carregados (id da planilha -> id final)
    def remap(lista, chave='militar_id'):
        out = []
        for x in lista:
            if x[chave] in id_planilha:
                y = dict(x); y[chave] = id_planilha[x[chave]]; out.append(y)
        return out
    afast2, regs2, forms2, idiomas2, puns2 = remap(afast), remap(regs), remap(forms), remap(idiomas), remap(puns)
    ids_af = {a['id'] for a in afast2}
    saude2 = [s for s in saude if s['afastamento_id'] in ids_af]
    usadas = {(c['ome'], c['secao']) for c in carga if c['secao']}
    secoes2 = collections.OrderedDict((k, v) for k, v in secoes.items() if k in usadas)

    gerar_sql(pasta, carga, secoes2, afast2, saude2, regs2, forms2, idiomas2, puns2,
              {o: c.most_common(1)[0][0] for o, c in ome_mun.items()})
    gerar_relatorio(pasta, P, L, A, carga, sem_secao, datas_conferir, antig_nao, tel_pec, excluidos, casados_por_nome,
                    invalidas, completadas, duplicados, afast2, regs2, forms2, idiomas2, puns2)
    print(f'pecúlio {len(P)} | planilha {len(L)} | almanaque {len(A)} | carregados {len(carga)} | sem seção {len(sem_secao)} '
          f'| excluídos da planilha {len(excluidos)} | casados por nome {len(casados_por_nome)} | afastamentos {len(afast2)} '
          f'| formação {len(forms2)} | punições {len(puns2)} | telefone do pecúlio {len(tel_pec)}')

def q(v):
    return IP.q(v.isoformat() if isinstance(v, (dt.date, dt.datetime)) else v)

def gerar_sql(pasta, carga, secoes, afast, saude, regs, forms, idiomas, puns, ome_mun):
    hoje = dt.date.today()
    p1 = [f"""-- =====================================================================
-- RECARGA DA BASE — versão 1.4 — PARTE 1 de 2 (gerado em {hoje:%d/%m/%Y})
-- CONTÉM DADOS PESSOAIS (LGPD): não publique este arquivo, não envie por e-mail aberto.
--
-- APAGA: todos os militares e o que depende deles (afastamentos, saúde, férias do PAF,
--        formação, idiomas, punições, comportamentos, movimentações, conferências,
--        solicitações) e as entregas e fechamentos mensais de teste.
-- MANTÉM: usuários e permissões, OMEs, seções, regiões, QOD, servidores civis,
--         exercícios de férias, consultas salvas, dicionário, auditoria.
-- Depois: rode a PARTE 2 e reimporte o PAF pelo sistema (Férias > Importar planilha).
-- =====================================================================
-- CONFIRMAÇÃO: fez o backup? Então troque NAO por SIM na linha abaixo antes de rodar.
select set_config('recarga.confirmo', 'NAO', false);

set client_min_messages = warning;
begin;
select set_config('app.importacao', 'on', true);
do $$ begin
  if current_setting('recarga.confirmo', true) is distinct from 'SIM' then
    raise exception 'Recarga não confirmada: troque NAO por SIM na linha da confirmação (no início do arquivo).';
  end if;
  if not exists (select 1 from versao_sistema where versao = '1.4') then
    raise exception 'Aplique antes a versão 1.4 (20261222000000_versao_1_4.sql).';
  end if;
end $$;

truncate table militar, entrega_mensal, fechamento_mensal cascade;
"""]
    if secoes:
        p1.append('insert into secao (ome_id, nome, ordem)\nselect o.id, v.nome, v.ordem from (values\n' +
                  ',\n'.join(f'({q(o)}, {q(n)}, {k})' for (o, n), k in secoes.items()) +
                  '\n) v(ome, nome, ordem) join ome o on o.sigla = v.ome\non conflict (ome_id, nome) do nothing;\n')
    for bloco in IP.values(carga, None, lambda m: [q(m['id']), q(m['matricula']), q(m['nome']), q(m['posto_id']), q(m['quadro']),
                           q(m['ome']), q(m['secao']), q(m['atividade']), q(m['ano']), q(m['ordem']), q(m['email']), q(m['t1']),
                           q(m['t2']), q(m['endereco']), q(m['obs']), q(m['guerra']), q(m['sexo']), q(m['dn']), q(m['dp']),
                           q(m['promocao']), q(m['nfunc']), q(m['orgao'])]):
        p1.append(f"""insert into militar (id, matricula, nome, posto_id, quadro_sigla, ome_id, secao_id, atividade, ano_ingresso,
  ordem_antiguidade, email, telefone1, telefone2, endereco, observacoes, nome_guerra, sexo, data_nascimento, data_ingresso,
  data_promocao, numero_funcional, orgao_cessao)
select v.id::uuid, v.mat, v.nome, v.posto::smallint, v.quadro, o.id, s.id, v.atv::atividade_tipo, v.ano::smallint,
       v.ordem, v.email, v.t1, v.t2, v.endereco, v.obs, v.guerra, v.sexo, v.dn::date, v.dp::date, v.promo::date, v.nfunc, v.orgao
from (values
{bloco}
) v(id, mat, nome, posto, quadro, ome, secao, atv, ano, ordem, email, t1, t2, endereco, obs, guerra, sexo, dn, dp, promo, nfunc, orgao)
join ome o on o.sigla = v.ome
left join secao s on s.ome_id = o.id and s.nome = v.secao;
""")
    p1.append(f"""insert into movimentacao (militar_id, tipo, ome_destino_id, secao_destino_id, data, documento, observacao)
select id, 'INCLUSAO', ome_id, secao_id, current_date, 'Recarga 1.4', 'Pecúlio de 17/11/2026, almanaque de 15/09/2026 e planilha de controle'
from militar;

-- sede das OMEs ainda sem município: a do pecúlio
update ome set municipio_ibge = mu.codigo
from (values
{(',' + chr(10)).join(f'({q(o)}, {q(m)})' for o, m in sorted(ome_mun.items()))}
) v(ome, mun) join municipio mu on norm_nome(mu.nome) = norm_nome(v.mun)
where ome.sigla = v.ome and ome.municipio_ibge is null;

do $$
declare n integer;
begin
  select count(*) into n from militar;
  if n <> {len(carga)} then
    raise exception 'Esperados {len(carga)} militares, carregados %. Nada foi gravado.', n;
  end if;
end $$;
commit;
analyze militar;
select count(*) as militares_carregados,
       count(*) filter (where secao_id is null) as sem_secao,
       count(*) filter (where data_nascimento is not null) as com_nascimento,
       count(*) filter (where sexo is not null) as com_sexo
  from militar;
""")
    with open(os.path.join(pasta, 'recarga_1_4_parte1.sql'), 'w', encoding='utf-8') as f: f.write('\n'.join(p1))

    p2 = [f"""-- =====================================================================
-- RECARGA DA BASE — versão 1.4 — PARTE 2 de 2 (gerado em {hoje:%d/%m/%Y})
-- CONTÉM DADOS PESSOAIS E DE SAÚDE (LGPD): não publique este arquivo.
-- Afastamentos, situações funcionais, formação, idiomas e punições da planilha de controle.
-- =====================================================================
set client_min_messages = warning;
begin;
select set_config('app.importacao', 'on', true);
do $$ begin
  if (select count(*) from militar) <> {len(carga)} then
    raise exception 'Rode antes a PARTE 1 (a base não tem os {len(carga)} militares da recarga).';
  end if;
  if exists (select 1 from afastamento) or exists (select 1 from formacao) then
    raise exception 'A PARTE 2 já foi rodada (há afastamentos ou formação cadastrados).';
  end if;
end $$;
"""]
    for bloco in IP.values(afast, None, lambda a: [q(a['id']), q(a['militar_id']), q(a['tipo']), q(a['ini']), q(a['dias']), q(a['processo']), q(a['obs'])]):
        p2.append(f"""insert into afastamento (id, militar_id, tipo_id, data_inicio, dias, processo_sei, observacao)
select v.id::uuid, v.mil::uuid, t.id, v.ini::date, v.dias, v.proc, v.obs
from (values
{bloco}
) v(id, mil, tipo, ini, dias, proc, obs) join tipo_afastamento t on t.codigo = v.tipo;
""")
    if saude:
        p2.append('insert into afastamento_saude (afastamento_id, natureza, cid)\nselect v.id::uuid, v.nat::natureza_saude, v.cid from (values\n' +
                  ',\n'.join(f"({q(s['afastamento_id'])}, {q(s['natureza'])}, {q(s['cid'])})" for s in saude) + '\n) v(id, nat, cid);\n')
    if regs:
        p2.append('insert into registro_funcional (militar_id, tipo, detalhe, processo_sei)\nselect v.mil::uuid, v.tipo::registro_funcional_tipo, v.det, v.proc from (values\n' +
                  ',\n'.join(f"({q(r['militar_id'])}, {q(r['tipo'])}, {q(r['detalhe'])}, {q(r['processo'])})" for r in regs) + '\n) v(mil, tipo, det, proc);\n')
    for bloco in IP.values(forms, None, lambda f_: [q(f_['militar_id']), q(f_['nivel']), q(f_['area'])]):
        p2.append(f"""insert into formacao (militar_id, nivel_id, area)
select v.mil::uuid, v.nivel::smallint, v.area from (values
{bloco}
) v(mil, nivel, area);
""")
    if idiomas:
        p2.append('insert into militar_idioma (militar_id, idioma)\nselect v.mil::uuid, v.idioma from (values\n' +
                  ',\n'.join(f"({q(i['militar_id'])}, {q(i['idioma'])})" for i in idiomas) + '\n) v(mil, idioma) on conflict do nothing;\n')
    if puns:
        p2.append('insert into punicao (militar_id, tipo_id, dias, processo, observacao)\nselect v.mil::uuid, t.id, v.dias::int, v.proc, v.obs from (values\n' +
                  ',\n'.join(f"({q(p['militar_id'])}, {q(p['tipo'])}, {q(p['dias'])}, {q(p['processo'])}, {q(p['obs'])})" for p in puns) +
                  '\n) v(mil, tipo, dias, proc, obs) join tipo_punicao t on t.nome = v.tipo;\n')
    p2.append("""commit;
analyze;
select (select count(*) from afastamento) as afastamentos, (select count(*) from registro_funcional) as situacoes_funcionais,
       (select count(*) from formacao) as formacoes, (select count(*) from militar_idioma) as idiomas, (select count(*) from punicao) as punicoes;
""")
    with open(os.path.join(pasta, 'recarga_1_4_parte2.sql'), 'w', encoding='utf-8') as f: f.write('\n'.join(p2))

def gerar_relatorio(pasta, P, L, A, carga, sem_secao, datas_conferir, antig_nao, tel_pec, excluidos, casados, invalidas, completadas, duplicados,
                    afast, regs, forms, idiomas, puns):
    wb = openpyxl.Workbook()
    BOLD = Font(bold=True); HDR = PatternFill('solid', fgColor='DDE7F3'); WRAP = Alignment(wrap_text=True, vertical='top')
    def aba(nome, cab, linhas, larg=None, nota=None):
        w = wb.create_sheet(nome); r0 = 1
        if nota: w.cell(1, 1, nota).font = Font(italic=True); r0 = 3
        for j, c in enumerate(cab, 1):
            x = w.cell(r0, j, c); x.font = BOLD; x.fill = HDR; x.alignment = WRAP
        for i, l in enumerate(linhas, r0 + 1):
            for j, v in enumerate(l, 1): w.cell(i, j, fmt(v))
        for j, c in enumerate(cab, 1):
            w.column_dimensions[get_column_letter(j)].width = (larg or {}).get(j, max(10, min(45, len(str(c)) + 4)))
        w.freeze_panes = w.cell(r0 + 1, 1)
        w.auto_filter.ref = f"A{r0}:{get_column_letter(len(cab))}{r0 + max(1, len(linhas))}"
    res = wb.active; res.title = 'Resumo'
    cnt = lambda campo: sum(1 for c in carga if c[campo])
    linhas = [
        ['RECARGA DA BASE — VERSÃO 1.4 — USO INTERNO DGP (contém dados pessoais, LGPD)'],
        [f'Gerado em {dt.datetime.now():%d/%m/%Y %H:%M}. Pecúlio de 17/11/2026, almanaque de 15/09/2026, planilha de controle de 18/11/2026.'],
        [],
        ['Militares carregados (todos os do pecúlio com matrícula válida)', len(carga)],
        ['  …com seção (vinda da planilha)', len(carga) - len(sem_secao)],
        ['  …sem seção (a OME completa na conferência)', len(sem_secao)],
        ['  …casados por nome (matrícula da planilha digitada errada)', len(casados)],
        ['Da planilha que NÃO entram (não estão no pecúlio)', len(excluidos)],
        ['Linhas do pecúlio descartadas (matrícula ou posto inválido)', len(invalidas)],
        ['Matrículas de 5 dígitos completadas com zero à esquerda', len(completadas)],
        [],
        ['Cobertura dos campos', 'Militares'],
        ['Sexo (pecúlio)', cnt('sexo')], ['Nº funcional (pecúlio)', cnt('nfunc')], ['Cedidos a outro órgão (pecúlio)', cnt('orgao')],
        ['Data de nascimento (almanaque)', cnt('dn')], ['Data de praça (almanaque)', cnt('dp')],
        ['Nº de antiguidade (almanaque, mesmo posto)', cnt('ordem')], ['Data da última promoção (almanaque, mesmo posto)', cnt('promocao')],
        ['Nome de guerra', cnt('guerra')], ['Telefone', sum(1 for c in carga if c['t1'] or c['t2'])], ['  …vindo do pecúlio', len(tel_pec)],
        ['E-mail (planilha)', cnt('email')], ['Atividade (planilha)', cnt('atividade')],
        [],
        ['Detalhes da planilha carregados', ''],
        ['Afastamentos', len(afast)], ['Situações funcionais (readaptação, horário especial, acumulação, PCD)', len(regs)],
        ['Formações', len(forms)], ['Idiomas', len(idiomas)], ['Punições (sem data: entram para conferência)', len(puns)],
        [],
        ['Raça/cor do pecúlio: não carregada (decisão da DGP, LGPD art. 11).', ''],
    ]
    for i, l in enumerate(linhas, 1):
        for j, v in enumerate(l, 1): res.cell(i, j, v)
    res['A1'].font = Font(bold=True, size=12)
    res.column_dimensions['A'].width = 80; res.column_dimensions['B'].width = 14
    aba('Sem seção', ['Matrícula', 'Posto', 'Nome', 'OME (pecúlio)', 'Motivo'], sorted(sem_secao, key=lambda x: (x[3] or '', x[2] or '')), {3: 42, 5: 60},
        'A OME informa a seção na conferência do mês (ou o gestor edita a ficha).')
    aba('Datas a conferir', ['Matrícula', 'Posto', 'Nome', 'OME', 'Situação', 'Valor'], sorted(datas_conferir, key=lambda x: (x[4], x[3] or '', x[2] or '')), {3: 42, 5: 70})
    aba('Antiguidade pendente', ['Matrícula', 'Posto (pecúlio)', 'Nome', 'OME', 'Posto no almanaque de 15/09', 'Nº no almanaque'], antig_nao, {3: 42},
        'Promovidos depois do almanaque: entram sem nº de antiguidade e sem data de promoção até o próximo almanaque.')
    aba('Planilha fora do pecúlio', ['Matrícula', 'Posto', 'Nome', 'OME (planilha)', 'Seção'],
        [[m['matricula'], SIGLA.get(m['posto_id']), m['nome'], m['ome'], m['secao']] for m in excluidos], {3: 42})
    aba('Casados por nome', ['Matrícula (pecúlio)', 'Matrícula (planilha)', 'Nome'], [[p, l, P[p]['nome']] for p, l in casados.items()], {3: 42})
    aba('Matrícula completada', ['Matrícula no sistema', 'Como está no pecúlio', 'Nome', 'OME'], completadas, {3: 42},
        'Matrícula antiga com 5 dígitos: o sistema usa 6 (zero à esquerda). O dígito verificador continua válido; o PAF e as planilhas aceitam as duas formas.')
    aba('Pecúlio descartado', ['Matrícula', 'Posto', 'Nome', 'OME'], [[p['matricula'], p['posto_txt'], p['nome'], p['ome']] for p in invalidas], {3: 42})
    aba('Duplicidades planilha', ['Matrícula', 'Nome', 'Onde aparece', 'Coluna OME', 'Mantido em', 'Critério'], duplicados, {2: 40, 3: 40, 6: 40})
    wb.save(os.path.join(pasta, 'relatorio_recarga_1_4.xlsx'))

if __name__ == '__main__':
    main()
