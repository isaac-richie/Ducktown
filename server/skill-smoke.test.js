import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runSkillSmoke } from './skill-smoke.js';

const state='/tmp/ducktown-sim-test',root='/official/microduck',rl='/official/microduck_rl';
const policyPath=path.join(state,'policies/current/ball_kick_left.onnx');
const policyList=()=>JSON.stringify({policies:{mode:'walk',enabled:true,homed:true,sitting:false,slots:[]},skills:{skills:[{name:'kick_left',path:policyPath,duration:0.5}],built_in:[]}});
const health=()=>JSON.stringify({robot:{healthy:true,control_loop:{achieved_hz:50,missed:0}}});
const fixture=({policies=policyList(),realtime='the world is running at 1.01x real time',healthOutput=health(),execute=async()=>({stdout:'{"accepted":true}'})}={})=>{
  const calls=[];
  const outputs={status:'robot healthy\nthe duck: standing',health:healthOutput,policies,realtime};
  let healthReads=0;
  const observer={inspect:async name=>({configured:true,ok:true,output:name==='health'&&Array.isArray(healthOutput)?healthOutput[Math.min(healthReads++,healthOutput.length-1)]:outputs[name]})};
  const load=async file=>file.endsWith('.source')?'repo=pollen-robotics/microduck-policies\nversion=v5\n':file.endsWith('body.log')?'== scene.xml: 1 duck(s), starting at SIT\n':file.endsWith('scene.xml')?'scene XML':Buffer.from('official ONNX policy');
  const run=(options={})=>runSkillSmoke({observer,root,state,rl,load,wait:async()=>{},now:()=>new Date(0).toISOString(),execute:async(...args)=>{calls.push(args);return execute(...args);},...options});
  return {run,calls};
};

test('simulator-only smoke test acknowledges only a bounded SDK command',async()=>{
  const {run,calls}=fixture();
  const result=await run();
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0][1],['ctl','robot','do','kick_left','--json']);
  assert.equal(result.command.state,'queued_acknowledged');
  assert.equal(result.postflight.healthy,true);
  assert.equal(result.postflight.standing,true);
  assert.equal(result.hardwareConnected,false);
  assert.equal(result.completionVerified,false);
  assert.equal(result.performanceMeasured,false);
  assert.match(result.policy.sha256,/^[a-f0-9]{64}$/);
});

test('smoke test refuses missing, unhealthy, or slow SDK preflight without invoking skill',async()=>{
  const cases=[
    fixture({policies:JSON.stringify({policies:{mode:'walk',enabled:true,homed:true,sitting:false,slots:[]},skills:{skills:[],built_in:[]}})}),
    fixture({healthOutput:JSON.stringify({robot:{healthy:false}})}),
    fixture({realtime:'the world is at 0.80x real time — below 1.0'})
  ];
  for(const item of cases){await assert.rejects(item.run());assert.equal(item.calls.length,0);}
});

test('SDK refusal and uncertain timeout never become a success claim',async()=>{
  const refused=await fixture({execute:async()=>({stdout:'{"accepted":false,"reason":"robot not driving"}'})}).run();
  assert.equal(refused.command.state,'refused');
  assert.equal(refused.command.reason,'robot not driving');
  assert.equal(refused.completionVerified,false);
  const timeout=await fixture({execute:async()=>{throw Object.assign(new Error('timeout'),{killed:true});}}).run();
  assert.equal(timeout.command.state,'unknown_after_error');
  assert.equal(timeout.completionVerified,false);
});

test('transient postflight health failure is retained, then read-only recovery is recorded',async()=>{
  const transient=JSON.stringify({robot:{healthy:false}});
  const {run,calls}=fixture({healthOutput:[health(),transient,health()]});
  const result=await run();
  assert.equal(calls.length,1);
  assert.deepEqual(result.postflight.samples.map(item=>item.healthy),[false,true]);
  assert.equal(result.postflight.healthy,true);
  assert.equal(result.completionVerified,false);
});

test('missing monitor baseline prevents submission and a success claim',async()=>{
  const {run,calls}=fixture();
  const result=await run({collectTelemetry:async()=>({command:null,telemetry:{executionObserved:false,reason:'No baseline'}})});
  assert.equal(calls.length,0);
  assert.equal(result.command.state,'not_submitted');
  assert.equal(result.executionObserved,false);
  assert.equal(result.telemetry.reason,'No baseline');
});

test('an observed policy is rejected if postflight is unhealthy',async()=>{
  const {run}=fixture({healthOutput:[health(),JSON.stringify({robot:{healthy:false}}),health()]});
  const result=await run({collectTelemetry:async({submit})=>({command:await submit(),telemetry:{executionObserved:true,windowEndObserved:true}})});
  assert.equal(result.command.state,'queued_acknowledged');
  assert.equal(result.telemetry.executionObserved,true);
  assert.equal(result.executionObserved,false);
});
