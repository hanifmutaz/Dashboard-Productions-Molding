/** Minimal XLSX writer: uncompressed ZIP, inline strings (never formulas), numeric cells. */
type Cell = string | number | null;
const encoder = new TextEncoder();
// XML 1.0 forbids these control characters; stripping them is intentional.
// eslint-disable-next-line no-control-regex
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export function columnName(index: number): string {
  let s = ''; for (let n=index+1;n>0;n=Math.floor((n-1)/26)) s=String.fromCharCode(65+(n-1)%26)+s; return s;
}
export function sheetXml(rows: Cell[][]): string {
  if(rows.length>1048576 || rows.some(r=>r.length>16384)) throw new Error('Excel row or column limit exceeded.');
  return header+`<worksheet xmlns="${main}"><sheetData>`+rows.map((row,i)=>`<row r="${i+1}">`+row.map((cell,j)=>{
    const ref=columnName(j)+(i+1);
    if(cell===null)return '';
    if(typeof cell==='number' && Number.isFinite(cell))return `<c r="${ref}"><v>${cell}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(cell).slice(0,32767))}</t></is></c>`;
  }).join('')+'</row>').join('')+'</sheetData></worksheet>';
}
const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(data:Uint8Array){let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]!^(c>>>8);return (c^0xffffffff)>>>0;}
function bytes(size:number){const b=new Uint8Array(size);const v=new DataView(b.buffer);return {b,u16:(o:number,n:number)=>v.setUint16(o,n,true),u32:(o:number,n:number)=>v.setUint32(o,n,true)};}
export function makeXlsx(rows:Cell[][]): Uint8Array<ArrayBuffer> {
  const files:Record<string,string>={
    '[Content_Types].xml':header+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':header+`<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':header+`<workbook xmlns="${main}" xmlns:r="${office}"><sheets><sheet name="Production" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':header+`<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml':sheetXml(rows),
  };
  const local:Uint8Array[]=[];const central:Uint8Array[]=[];let offset=0,centralSize=0;
  for(const [name,value] of Object.entries(files)){
    const n=encoder.encode(name),d=encoder.encode(value),crc=crc32(d);
    const h=bytes(30);h.u32(0,0x04034b50);h.u16(4,20);h.u16(12,33);h.u32(14,crc);h.u32(18,d.length);h.u32(22,d.length);h.u16(26,n.length);
    const c=bytes(46);c.u32(0,0x02014b50);c.u16(4,20);c.u16(6,20);c.u16(14,33);c.u32(16,crc);c.u32(20,d.length);c.u32(24,d.length);c.u16(28,n.length);c.u32(42,offset);
    local.push(h.b,n,d);central.push(c.b,n);offset+=h.b.length+n.length+d.length;centralSize+=c.b.length+n.length;
  }
  const end=bytes(22);end.u32(0,0x06054b50);end.u16(8,Object.keys(files).length);end.u16(10,Object.keys(files).length);end.u32(12,centralSize);end.u32(16,offset);
  const out=new Uint8Array(offset+centralSize+22);let pos=0;for(const b of [...local,...central,end.b]){out.set(b,pos);pos+=b.length;}return out;
}
export function downloadXlsx(name:string, rows:Cell[][]){
  const url=URL.createObjectURL(new Blob([makeXlsx(rows)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
