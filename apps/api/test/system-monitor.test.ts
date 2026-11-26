import { describe, expect, it } from 'vitest';
import { summarizeRequests } from '../src/modules/health/systemMonitor.js';

describe('system monitor', () => {
  it('does not report fake latency for an empty sample', () => {
    expect(summarizeRequests([])).toEqual({count:0,errors:0,clientErrors:0,avgMs:null,p95Ms:null});
  });
  it('counts errors and calculates nearest-rank p95', () => {
    const input = Array.from({length:20},(_,i)=>({ms:i+1,status:i===0?500:i===1?403:200}));
    expect(summarizeRequests(input)).toEqual({count:20,errors:1,clientErrors:1,avgMs:11,p95Ms:19});
  });
});
