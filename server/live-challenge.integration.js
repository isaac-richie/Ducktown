import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { SimulatorObserver } from './simulator.js';
import { runSkillSmoke } from './skill-smoke.js';
import { captureSkillTelemetry } from './skill-telemetry.js';
import { runAndAttachChallenge } from './run-challenge.js';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const execFileAsync=promisify(execFile);

test('live SDK kick-and-return becomes a private receipt before owner sharing',
  {skip:process.env.DUCKTOWN_LIVE_CHALLENGE!=='1'},async t=>{
    assert.equal(process.env.DUCK_SIM_STATE,'/tmp/ducktown-sim-0927');
    assert.equal(process.env.DUCK_SIM_PORT,'17801');
    assert.equal(process.env.DUCK_SIM_SCENE,undefined);
    assert.equal(process.env.DUCK_SIM_CAMERAS,undefined);
    const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-live-challenge-'));
    t.after(()=>rm(folder,{recursive:true,force:true}));
    const dataFile=path.join(folder,'data.json'),evidenceDir=path.join(folder,'evidence');
    const {server}=await createApp({dataFile,evidenceDir});
    server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const baseUrl=`http://127.0.0.1:${server.address().port}`;
    const registered=await fetch(`${baseUrl}/api/v1/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:'live_challenge_test',password:'isolated-challenge-test-secret'})});
    assert.equal(registered.status,201);
    const cookie=registered.headers.get('set-cookie').split(';')[0];
    const root=path.join(project,'work/microduck'),rl=path.join(project,'work/microduck_rl');
    const lockDir=path.join(process.env.DUCK_SIM_STATE,'.ducktown-skill-smoke.lock');
    const runAttempt=async()=>{
      await mkdir(lockDir);
      try{return await runSkillSmoke({observer:new SimulatorObserver({root}),root,state:process.env.DUCK_SIM_STATE,rl,execute:execFileAsync,collectTelemetry:captureSkillTelemetry});}
      finally{await rmdir(lockDir);}
    };
    const result=await runAndAttachChallenge({handle:'live_challenge_test',dataFile,evidenceDir,baseUrl,runAttempt});
    assert.equal(result.status,'private_receipt_ready',JSON.stringify(result));
    const receipts=(await (await fetch(`${baseUrl}/api/v1/receipts`,{headers:{Cookie:cookie}})).json()).receipts;
    assert.equal(receipts.length,1);
    assert.deepEqual(receipts[0].timeline.map(item=>item.phase),['ready','move_seen','move_ended']);
    assert.equal((await (await fetch(`${baseUrl}/api/v1/posts`)).json()).posts.length,0);
    const shared=await fetch(`${baseUrl}/api/v1/receipts/${result.receiptId}/share`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{}'});
    assert.equal(shared.status,201);
    const {post}=await shared.json();
    assert.equal(post.origin,'simulator_telemetry_observed');
    assert.equal(post.evidence.completionVerified,false);
    assert.equal(post.evidence.performanceMeasured,false);
    assert.equal(post.evidence.hardwareConnected,false);
    assert.deepEqual(post.evidence.timeline,receipts[0].timeline);
    assert.ok(!JSON.stringify(post).includes('rawMonitorNdjson'));
  });
