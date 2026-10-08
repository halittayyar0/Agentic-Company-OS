import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const reportFile='artifacts/endurance-reports/ci-postgres-smoke.json';
if(!fs.existsSync(reportFile)){console.log('No report; no fixture cleanup ownership acquired');process.exit(0);}
const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
assert.match(report.runId,/^soak-[a-f0-9]{24}$/u);
const project='agentic-os-soak-'+report.runId;
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
const ids=kind=>docker([kind,'ls',...(kind==='container'?['--all']:[]),'--quiet','--filter','label=com.docker.compose.project='+project]).trim().split(/\s+/u).filter(Boolean);
const inspect=(kind,id)=>JSON.parse(docker([kind,'inspect',id]))[0];
const owned=(kind,id)=>{const x=inspect(kind,id);assert.equal((kind==='container'?x.Config.Labels:x.Labels)?.['com.docker.compose.project'],project);return x;};
const cleanup=()=>{
  const errors=[];
  for(const kind of ['container','volume','network']){
    let remaining;
    try{remaining=ids(kind);}catch{errors.push(new Error('owned_'+kind+'_inventory_failed'));continue;}
    for(const id of remaining)try{
      owned(kind,id);docker([kind,'rm',...(kind==='container'?['--force']:[]),id]);
    }catch{errors.push(new Error('owned_'+kind+'_cleanup_failed'));}
  }
  for(const kind of ['container','volume','network'])try{
    assert.equal(ids(kind).length,0);
  }catch{errors.push(new Error('owned_'+kind+'_absence_unproved'));}
  if(errors.length)throw new AggregateError(errors,'Owned fixture retirement failed');
  console.log(JSON.stringify({kind:'fixed_final_endurance_cleanup',ownedProjectRemoved:true}));
};
let snapshotError;
try{
 const initial=ids('container');
 if(!initial.length||report.pass!==false){
   console.log(JSON.stringify({kind:'fixed_final_endurance_state',retainedFixture:initial.length>0,reportPass:report.pass,snapshotNotRequired:true}));
 }else{
  const journal=fs.readFileSync('artifacts/endurance-reports/ci-postgres-smoke.jsonl','utf8').trim().split('\n').map(JSON.parse);
  const projectId=journal.find(x=>x.kind==='run_started').data.projectId;
  assert.ok(Number.isSafeInteger(projectId)&&projectId>0);
  const databases=initial.filter(id=>owned('container',id).Config.Labels['com.docker.compose.service']==='db');
  assert.equal(databases.length,1);
  const sql=fs.readFileSync('scripts/src/testing/fixed-final-state.sql','utf8');
  const output=docker(['exec','--interactive',databases[0],'psql','--no-psqlrc','--set=ON_ERROR_STOP=1','--set=projectId='+projectId,'--username=agentic','--dbname=agentic_os','--tuples-only','--no-align'],sql);
  const rows=output.split('\n').filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(rows.length,1);
  const snapshot=rows[0];assert.equal(snapshot.kind,'fixed_final_endurance_state');assert.equal(snapshot.projectId,projectId);
  assert.ok(snapshot.tasks?.length<=11&&snapshot.attempts?.length<=33&&snapshot.receipts?.length<=33);
  fs.writeFileSync('artifacts/endurance-reports/fixed-final-state.json',JSON.stringify({...snapshot,reportCompletedAt:report.completedAt},null,2)+'\n');
  console.log(JSON.stringify({kind:'fixed_final_endurance_state',captured:true,tasks:snapshot.tasks?.length,attempts:snapshot.attempts?.length,receipts:snapshot.receipts?.length}));
 }
}catch(error){snapshotError=error;}
try{cleanup();}catch(error){
 if(snapshotError)throw new AggregateError([snapshotError,error],'Fixture observation and retirement failed');
 throw error;
}
if(snapshotError)throw snapshotError;
