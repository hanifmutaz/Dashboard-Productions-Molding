import { spawnSync } from 'node:child_process';
import { createHash,randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { readFile,readdir,open,unlink,writeFile,rename } from 'node:fs/promises';
import path from 'node:path';
function need(k){const v=process.env[k];if(!v?.trim())throw new Error(`Missing ${k}`);return v;}
function run(cmd,args,env){const r=spawnSync(cmd,args,{env,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:3600000,maxBuffer:1024*1024,windowsHide:true});if(r.status!==0||r.error)throw new Error(`${path.basename(cmd)} failed`);return r.stdout.trim();}
async function hash(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
async function main(){
 if(need('MPD_RESTORE_ISOLATED')!=='YES')throw new Error('Restore requires isolated instance confirmation');
 const host=need('MPD_RESTORE_HOST'),port=need('MPD_RESTORE_PORT');
 if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535)throw new Error('Invalid restore port');
 const canonical=(s)=>s.trim().toLowerCase().replace(/\.$/,'');
 const appHost=need('APP_DB_HOST'),conmasHost=need('CONMAS_DB_HOST');
 if([appHost,conmasHost].some(h=>canonical(h)===canonical(host)))throw new Error('Restore host must be separate from configured live hosts');
 const resolve=async h=>new Set((await lookup(h,{all:true})).map(a=>a.address.replace(/^::ffff:/,'')));
 const target=await resolve(host);for(const live of [appHost,conmasHost]){const addresses=await resolve(live);if([...addresses].some(a=>target.has(a)))throw new Error('Restore host resolves to a configured live address');}
 const env={...process.env,PGHOST:host,PGPORT:port,PGDATABASE:'postgres',PGUSER:need('MPD_RESTORE_USER'),PGPASSWORD:need('MPD_RESTORE_PASSWORD'),PGSSLMODE:process.env.MPD_RESTORE_SSL==='true'?'verify-full':'disable'};
 delete env.PGSERVICE;delete env.PGSERVICEFILE;delete env.PGHOSTADDR;delete env.PGOPTIONS;
 const dir=path.resolve(need('MPD_BACKUP_DIR')),evidence=path.resolve(need('MPD_BACKUP_EVIDENCE_FILE'));
 const lockPath=path.join(dir,'.mpd-backup.lock'),lock=await open(lockPath,'wx',0o600);
 const db='mpd_restore_'+randomBytes(10).toString('hex'),temp=evidence+`.restore-${process.pid}`;
 const psql=process.env.MPD_PSQL||'psql',restore=process.env.MPD_PG_RESTORE||'pg_restore';let created=false,record,passed=false;
 try{
  record=JSON.parse(await readFile(evidence,'utf8'));if(!/^[a-f0-9]{64}$/.test(record.backupSha256??''))throw new Error('Invalid backup evidence');
  const files=(await readdir(dir)).filter(f=>/^mpd-.*\.dump$/.test(f)).sort().reverse();let archive;
  for(const f of files){const candidate=path.join(dir,f);if(await hash(candidate)===record.backupSha256){archive=candidate;break;}}
  if(!archive)throw new Error('No archive matching recorded digest');
  // This must be an explicitly dedicated empty test instance. Never use --clean against an existing DB.
  run(psql,['-X','-w','-v','ON_ERROR_STOP=1','-d','postgres','-c',`CREATE DATABASE ${db}`],env);created=true;
  run(restore,['--no-password','--exit-on-error','--no-owner','--no-privileges','--dbname',db,archive],env);
  const checked=run(psql,['-X','-w','-At','-v','ON_ERROR_STOP=1','-d',db,'-c',"SELECT CASE WHEN to_regclass('public.app_user') IS NOT NULL AND to_regclass('public.md_part') IS NOT NULL AND to_regclass('public.md_material') IS NOT NULL THEN 'OK' ELSE 'FAIL' END"],env);
  if(checked!=='OK')throw new Error('Required application tables missing');
  run(psql,['-X','-w','-At','-v','ON_ERROR_STOP=1','-d',db,'-c','SELECT count(*) FROM app_user; SELECT count(*) FROM md_part; SELECT count(*) FROM md_material;'],env);
  passed=true;
 }finally{
  try{
   if(created){try{run(psql,['-X','-w','-v','ON_ERROR_STOP=1','-d','postgres','-c',`DROP DATABASE ${db}`],env);}catch{passed=false;console.error('Isolated database cleanup failed; contact operator');}}
  }finally{
   try{if(record){await writeFile(temp,JSON.stringify({...record,restoreTestAt:new Date().toISOString(),restorePassed:passed},null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,evidence);}}
   finally{await unlink(temp).catch(()=>undefined);await lock.close();await unlink(lockPath);}
  }
 }
 if(!passed)throw new Error('Restore drill failed');console.log('Isolated archive restore and schema smoke test PASS');
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Restore failed');process.exitCode=1;});
