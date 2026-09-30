import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assessSkillTrace } from './skill-telemetry.js';
import { createApp } from './app.js';
import { readStoredState } from './test-helpers.js';
import { runAndAttachChallenge } from './run-challenge.js';

const sha256=value=>createHash('sha256').update(value).digest('hex');
function observedAttempt() {
  const frames=Array.from({length:43},(_,index)=>({t:index*0.02,policy:index>=5&&index<=29?'kick_left':'stand',fallen:false,hz:50,missed:0}));
  const rawMonitorNdjson=frames.map(frame=>JSON.stringify({jsonrpc:'2.0',method:'robot.state',params:{t:frame.t,policy:frame.policy,safety:{fallen:frame.fallen},loop:{hz:frame.hz,missed:frame.missed}}})).join('\n')+'\n';
  return {kind:'simulator_skill_attempt',origin:'official_daemon_simulator',skill:'kick_left',scene:{name:'scene.xml',sha256:'a'.repeat(64)},policy:{source:'pollen-robotics/microduck-policies',version:'v5',filename:'ball_kick_left.onnx',sha256:'b'.repeat(64)},preflight:{healthy:true,realtimeFactor:1},command:{state:'queued_acknowledged',reason:null},telemetry:{...assessSkillTrace(frames,{submittedAtIndex:5}),source:'robotctl monitor --hz 50 --json',frameCount:frames.length,submittedAtIndex:5,traceSha256:sha256(rawMonitorNdjson),rawMonitorNdjson,frames},executionObserved:true,postflight:{healthy:true,standing:true,samples:[{healthy:true}]},startedAt:'2026-09-27T00:00:00.000Z',endedAt:'2026-09-27T00:00:02.000Z',hardwareConnected:false,completionVerified:false,performanceMeasured:false};
}

test('fixed challenge goes from SDK trace to private owner review, then explicit sharing',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-challenge-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const dataFile=path.join(folder,'data.json'),evidenceDir=path.join(folder,'evidence');
  const {server}=await createApp({dataFile,evidenceDir});
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const registered=await fetch(`${baseUrl}/api/v1/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:'duck_alice',password:'long-enough-secret'})});
  assert.equal(registered.status,201);
  const cookie=registered.headers.get('set-cookie').split(';')[0];
  let runs=0;
  const runAttempt=async()=>{runs++;return observedAttempt();};
  const options={dataFile,evidenceDir,baseUrl,handle:'duck_alice',runAttempt};
  const result=await runAndAttachChallenge(options);
  assert.equal(runs,1);
  assert.equal(result.status,'private_receipt_ready');
  assert.equal(result.shared,false);
  assert.equal(result.attribution,'local_operator_assigned_unverified');
  const artifact=JSON.parse(await readFile(path.join(evidenceDir,result.artifactFile),'utf8'));
  assert.equal(artifact.executionObserved,true);
  assert.equal((await (await fetch(`${baseUrl}/api/v1/posts`)).json()).posts.length,0);
  const privateItems=(await (await fetch(`${baseUrl}/api/v1/receipts`,{headers:{Cookie:cookie}})).json()).receipts;
  assert.equal(privateItems.length,1);
  assert.deepEqual(privateItems[0].timeline,[{phase:'ready',atSeconds:0},{phase:'move_seen',atSeconds:0.1},{phase:'move_ended',atSeconds:0.6}]);
  assert.ok(!JSON.stringify(privateItems).includes('rawMonitorNdjson'));
  await assert.rejects(runAndAttachChallenge(options),/already attached/);
  assert.equal(runs,2); // Duplicate evidence is refused; no second public post.
  const shared=await fetch(`${baseUrl}/api/v1/receipts/${result.receiptId}/share`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{}'});
  assert.equal(shared.status,201);
  const {post}=await shared.json();
  assert.deepEqual(post.evidence.timeline,privateItems[0].timeline);
  assert.equal(post.evidence.performanceMeasured,false);
  assert.equal(post.evidence.completionVerified,false);
  assert.ok(!JSON.stringify(post).includes('rawMonitorNdjson'));
});

test('challenge refuses missing account or server before commanding the simulator',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-challenge-gate-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const dataFile=path.join(folder,'data.json');
  const {server}=await createApp({dataFile});
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  let runs=0;
  const runAttempt=async()=>{runs++;return observedAttempt();};
  await assert.rejects(runAndAttachChallenge({handle:'missing_user',dataFile,baseUrl,runAttempt}),/Create the exact Ducktown account/);
  assert.equal(runs,0);
  await fetch(`${baseUrl}/api/v1/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:'duck_alice',password:'long-enough-secret'})});
  await assert.rejects(runAndAttachChallenge({handle:'duck_alice',dataFile,baseUrl:'http://127.0.0.1:1',runAttempt}),/Start the local Ducktown server/);
  await assert.rejects(runAndAttachChallenge({handle:'duck_alice',dataFile,baseUrl:'https://example.com',runAttempt}),/loopback/);
  assert.equal(runs,0);
});

test('uncertain or inflated attempts are kept private and never attached',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-challenge-fail-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const dataFile=path.join(folder,'data.json'),evidenceDir=path.join(folder,'evidence');
  const {server}=await createApp({dataFile,evidenceDir});
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  await fetch(`${baseUrl}/api/v1/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:'duck_alice',password:'long-enough-secret'})});
  const options={handle:'duck_alice',dataFile,evidenceDir,baseUrl};
  const uncertain=observedAttempt();uncertain.executionObserved=false;uncertain.command={state:'unknown_after_error',reason:'CLI timed out'};
  const result=await runAndAttachChallenge({...options,runAttempt:async()=>uncertain});
  assert.equal(result.status,'not_observed');
  assert.equal((await (await fetch(`${baseUrl}/api/v1/posts`)).json()).posts.length,0);
  assert.equal(readStoredState(dataFile).receipts.length,0);
  const inflated=observedAttempt();inflated.completionVerified=true;
  await assert.rejects(runAndAttachChallenge({...options,runAttempt:async()=>inflated}),/unsupported result claim/);
  assert.equal(readStoredState(dataFile).receipts.length,0);
});
