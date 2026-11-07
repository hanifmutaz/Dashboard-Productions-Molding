import re, json, openpyxl, os
SRC='/mnt/user-data/uploads/dashboard-molding-mockup-v1.10.html'
h=open(SRC,encoding='utf-8').read()
styles=[s for a,s in re.findall(r'<style([^>]*)>(.*?)</style>',h,re.S)]
tokens, main1, refine, a11y, mdcss = styles

def strip_comments(s): return re.sub(r'/\*.*?\*/','',s,flags=re.S)

def parse(s):
    s=strip_comments(s)
    def block(i):
        nodes=[]
        while i<len(s):
            while i<len(s) and s[i] in ' \t\r\n': i+=1
            if i>=len(s): break
            if s[i]=='}': return nodes,i+1
            j=s.find('{',i); pre=s[i:j].strip()
            if pre.startswith('@media') or pre.startswith('@supports'):
                kids,i=block(j+1); nodes.append(('at',pre,kids))
            elif pre.startswith('@keyframes'):
                depth=0;k=j
                while True:
                    if s[k]=='{':depth+=1
                    elif s[k]=='}':
                        depth-=1
                        if depth==0:break
                    k+=1
                nodes.append(('raw',s[i:k+1])); i=k+1
            else:
                k=s.find('}',j); nodes.append(('rule',pre,s[j+1:k].strip())); i=k+1
        return nodes,i
    return block(0)[0]

stats={'font':0,'hover':0,'dropped':0}
SMALL=['9p5','10','10p5','11','11p5']
def fixbody(b):
    def rep(m):
        stats['font']+=1; return 'font-size:var(--s-size-12)'
    return re.sub(r'font-size:var\(--s-size-(%s)\)'%'|'.join(SMALL),rep,b)
def splitsel(sel):
    parts=[];d=0;cur=''
    for c in sel:
        if c in '([':d+=1
        if c in ')]':d-=1
        if c==',' and d==0: parts.append(cur.strip());cur=''
        else: cur+=c
    parts.append(cur.strip()); return parts
DROP=re.compile(r'#simSel|\.mocktag')
def emit(nodes):
    out=[]
    for n in nodes:
        if n[0]=='raw': out.append(n[1]); continue
        if n[0]=='at':
            inner=emit(n[2])
            if inner.strip(): out.append('%s{%s}'%(n[1],inner))
            continue
        _,sel,body=n
        sels=[x for x in splitsel(sel) if not DROP.search(x)]
        if not sels: stats['dropped']+=1; continue
        body=fixbody(body)
        hov=[x for x in sels if ':hover' in x]; rest=[x for x in sels if ':hover' not in x]
        if rest: out.append('%s{%s}'%(','.join(rest),body))
        if hov: stats['hover']+=1; out.append('@media (hover:hover){%s{%s}}'%(','.join(hov),body))
    return '\n'.join(out)

HEAD='/* Derived from mockup v1.10 (baseline, ADR-026) by tools/extract-mockup.py.\n * Transformations: dev-only selectors removed, hover gated behind (hover:hover),\n * text below 12px raised to 12px (NFR-UI, see docs/06-testing/deviation-log.md).\n * Do not edit by hand without updating the deviation log. */\n'
os.makedirs('system/apps/web/src/styles',exist_ok=True)
app=emit(parse(main1))+'\n'+emit(parse(refine))+'\n'+emit(parse(a11y))
open('system/apps/web/src/styles/app.css','w').write(HEAD+app+'\n')
s1=dict(stats)
stats.update(font=0,hover=0,dropped=0)
DROP=re.compile(r"#simSel")
md=emit(parse(mdcss.replace(".mocktag",".srctag")))
os.makedirs('system/apps/web/src/features/machine-detail',exist_ok=True)
open('system/apps/web/src/features/machine-detail/machine-detail.css','w').write(HEAD+md+'\n')
print('app',s1,'md',stats)
os.makedirs('system/packages/ui-tokens',exist_ok=True)
open('system/packages/ui-tokens/tokens.css','w').write('/* Token source of truth extracted from mockup v1.10 <style id="v19-tokens">.\n * Layer 1 primitive (--p-*), Layer 2 semantic (--s-*), Layer 3 component (--c-*) plus\n * compatibility aliases. Components MUST consume semantic (--s-) and component (--c-) tokens or aliases only. */\n'+strip_comments(tokens).strip()+'\n')
logo=re.search(r'<img class="hlogo" src="(data:image/png;base64,[^"]+)"',h).group(1)
import base64
os.makedirs('system/apps/web/public',exist_ok=True)
open('system/apps/web/public/hrs-logo.png','wb').write(base64.b64decode(logo.split(',',1)[1]))
wb=openpyxl.load_workbook('/mnt/user-data/uploads/data cluster PCB Molding.xlsx')
ws=wb.active
rows=[r for r in ws.iter_rows(values_only=True) if r and isinstance(r[0],(int,float))]
header={};blocks=[];cur=None;slot=None;tail={}
for no,col,label,typ in rows[:]:
    label=str(label).strip()
    if label.startswith('JAM '):
        cur={'label':col,'slots':[]};blocks.append(cur);slot=None;continue
    if cur is None or no>=420:
        if no>=420: tail[col]=label
        else: header[col]=label
        continue
    if label=='QTY PCS':
        slot={'qty':col};cur['slots'].append(slot);continue
    key={'DETAIL':'detail','REJECT':'reject','QTY REJECT':'rejectQty','KRITERIA':'kriteria'}.get(label)
    if label.startswith('MENIT'): key='minutes'
    if label.startswith('KATEGORI'): key='category'
    slot[key]=col
json.dump({'header':header,'blocks':blocks,'tail':tail},open('fieldmap.json','w'),indent=1)
