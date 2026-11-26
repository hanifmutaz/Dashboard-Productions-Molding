import { describe, expect, it } from 'vitest';
import { columnName, makeXlsx, sheetXml } from '../lib/xlsx';

describe('Production Excel export',()=>{
  it('preserves numeric values, empty cells and literal formula-like text',()=>{
    const s=sheetXml([['=1+1',42,null,'A&B']]);
    expect(s).toContain('t="inlineStr"');expect(s).toContain('=1+1');expect(s).not.toContain('<f>');
    expect(s).toContain('<c r="B1"><v>42</v></c>');expect(s).not.toContain('r="C1"');expect(s).toContain('A&amp;B');
  });
  it('creates a ZIP with the required workbook and worksheet entries',()=>{
    const b=makeXlsx([['date','actual'],['2026-11-26',10]]);const v=new DataView(b.buffer);
    expect(v.getUint32(0,true)).toBe(0x04034b50);expect(v.getUint32(b.length-22,true)).toBe(0x06054b50);
    expect(v.getUint16(b.length-12,true)).toBe(5);expect(new TextDecoder().decode(b)).toContain('xl/worksheets/sheet1.xml');
    expect(columnName(26)).toBe('AA');
  });
});
