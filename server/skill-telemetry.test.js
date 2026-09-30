import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSkillTrace, captureSkillTelemetry } from './skill-telemetry.js';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';

const trace=()=>Array.from({length:43},(_,index)=>({
  t:index*0.02,policy:index>=5&&index<=29?'kick_left':'stand',fallen:false,hz:50,missed:0
}));
const assess=(frames,other={})=>assessSkillTrace(frames,{submittedAtIndex:5,...other});

test('bounded SDK policy transition supports only observed simulator execution',()=>{
  const result=assess(trace());
  assert.equal(result.executionObserved,true);
  assert.equal(result.windowEndObserved,true);
  assert.equal(result.observedSeconds,0.48);
});

test('trace fails closed on gaps, missed ticks, fall, concurrent action, and absent return',()=>{
  const cases=[
    frames=>{frames[12].t+=0.15;},
    frames=>{frames[12].missed=1;},
    frames=>{frames[12].fallen=true;},
    frames=>{frames[12].policy='ground_pick';},
    frames=>{frames.splice(31);},
    frames=>{frames[4].policy='kick_left';},
    frames=>{frames[35].policy='kick_left';}
  ];
  for(const change of cases){const frames=trace();change(frames);assert.equal(assess(frames).executionObserved,false);}
  assert.equal(assess(trace(),{streamError:'monitor died'}).executionObserved,false);
});

test('capture subscribes before command and hashes SDK frames',async()=>{
  const child=new EventEmitter();
  child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{child.emit('close',0);return true;};
  let spawnArgs,submitted=false;
  const spawnProcess=(file,args,options)=>{spawnArgs={file,args,options};return child;};
  const timer=setInterval(()=>{
    const index=Number(child._frameIndex||0);
    child._frameIndex=index+1;
    if(index>=44){clearInterval(timer);return;}
    const policy=index>=6&&index<=30?'kick_left':'stand';
    child.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'robot.state',params:{t:index*0.02,policy,safety:{fallen:false},loop:{hz:50,missed:0}}})+'\n');
  },8);
  try {
    const result=await captureSkillTelemetry({root:'/official/microduck',state:'/tmp/test',submit:async()=>{
      submitted=true;
      assert.ok(child._frameIndex>=3);
      return {state:'queued_acknowledged'};
    },spawnProcess});
    assert.equal(submitted,true);
    assert.deepEqual(spawnArgs.args.slice(-4),['monitor','--hz','50','--json']);
    assert.match(spawnArgs.file,/\/target\/debug\/robotctl$/);
    assert.equal(result.telemetry.executionObserved,true);
    assert.match(result.telemetry.traceSha256,/^[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(result.telemetry.rawMonitorNdjson).digest('hex'),result.telemetry.traceSha256);
  } finally {clearInterval(timer);}
});

test('monitor failure before baseline never submits a skill',async()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{child.emit('close',0);return true;};
  setTimeout(()=>child.emit('close',1),10);
  let submitted=false;
  const result=await captureSkillTelemetry({root:'/official/microduck',state:'/tmp/test',submit:async()=>{submitted=true;},spawnProcess:()=>child});
  assert.equal(submitted,false);
  assert.equal(result.command,null);
  assert.equal(result.telemetry.executionObserved,false);
});
