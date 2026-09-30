import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { SimulatorObserver } from './simulator.js';
import { parsePolicyList } from './policies.js';

test('live official daemon output matches Ducktown API without producing a run',
  {skip:!process.env.DUCKTOWN_MICRODUCK_ROOT},async t=>{
    const simulator=new SimulatorObserver();
    const direct=await simulator.inspect('policies');
    assert.equal(direct.ok,true,direct.reason||'SDK policy command failed');
    const expected=parsePolicyList(direct.output);
    assert.ok(expected.slots.length>0,'Official daemon reported no policy slots');
    const folder=await mkdtemp(path.join(os.tmpdir(),'ducktown-live-sdk-'));
    t.after(()=>rm(folder,{recursive:true,force:true}));
    const {server}=await createApp({dataFile:path.join(folder,'data.json'),simulator});
    server.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/v1/installed-policies`)).status,401);
    const registration=await fetch(`${base}/api/v1/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({handle:'live_sdk_test',password:'isolated-live-sdk-test-secret'})});
    assert.equal(registration.status,201);
    const cookie=registration.headers.get('set-cookie').split(';')[0];
    const headers={Cookie:cookie};
    const response=await fetch(`${base}/api/v1/installed-policies`,{headers});
    assert.equal(response.status,200);
    const installed=await response.json();
    assert.equal(installed.verification,'sdk_reported_only');
    assert.equal(installed.isRun,false);
    assert.equal(installed.hardwareConnected,false);
    assert.deepEqual(installed.slots,expected.slots);
    assert.deepEqual(installed.skills,expected.skills);
    assert.deepEqual(installed.builtIn,expected.builtIn);
    let capture,failedAttempts=0;
    for(let attempt=0;attempt<3;attempt++){
      capture=await fetch(`${base}/api/v1/sdk-observations`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
      if(capture.status===201)break;
      assert.equal(capture.status,409,`Unexpected SDK capture status: ${capture.status}`);
      const failure=await capture.json();
      t.diagnostic(`Live SDK observation interrupted at ${failure.failedCheck}: ${failure.reason}`);
      failedAttempts++;
      assert.deepEqual((await (await fetch(`${base}/api/v1/sdk-observations`,{headers})).json()).observations,[]);
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    assert.equal(capture.status,201,`Official simulator failed all three read-only observation attempts (${failedAttempts} failures)`);
    const {observation}=await capture.json();
    assert.equal(observation.isRun,false);
    assert.equal(observation.verification,'unverified');
    assert.match(observation.checks.policies.outputSha256,/^[a-f0-9]{64}$/);
    assert.deepEqual((await (await fetch(`${base}/api/v1/posts`)).json()).posts,[]);
  });
